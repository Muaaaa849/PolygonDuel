// CPU opponent (plan §12/§13): it reads the opponent's SHAPE with a human-like
// reaction delay and a chance to react correctly. Difficulty = those two numbers.
import type { Sim } from '../core/sim';
import { SH, M_N1, M_N2, M_N3, M_S1, M_S2, KIND_GC, COST_UNIT } from '../core/compile';
import { IN_ATK, IN_S1, IN_S2, IN_STEP, IN_STICK } from '../core/input';
import {
  ST_FREE, ST_ATTACK, ST_BLOCKSTUN, ST_STEP, ST_STUN, ST_DOWN, ST_WAKE, ST_HITSTUN,
  MH_HIT, MH_BLOCK, MH_NONE, PH_FIGHT, type FighterState, getShot, MAX_SHOTS,
} from '../core/state';
import { SYSTEM } from '../data/system';
import { Rng } from '../core/rng';

export interface CpuLevel {
  name: string;
  /** Reaction delay in frames. */
  react: number;
  /** Chance to pick the right answer to a circle / triangle. */
  accuracy: number;
  /** Chance to GC after blocking. */
  gc: number;
  /** Chance to confirm a hit into the full chain. */
  confirm: number;
  aggression: number;
}

export const CPU_LEVELS: CpuLevel[] = [
  { name: 'EASY', react: 30, accuracy: 0.35, gc: 0.25, confirm: 0.6, aggression: 0.012 },
  { name: 'NORMAL', react: 19, accuracy: 0.65, gc: 0.6, confirm: 0.9, aggression: 0.02 },
  { name: 'HARD', react: 13, accuracy: 0.85, gc: 0.9, confirm: 1, aggression: 0.03 },
];

const PREFERRED: Record<string, number> = { blaze: 2.6, zephyr: 3.3, bastion: 2.6, phantom: 3.0, ray: 2.5, volt: 2.9 };
const FIELD_W = SYSTEM.field.w;
const FIELD_H = SYSTEM.field.h;

function dirIndex(dx: number, dy: number): number {
  const a = Math.atan2(dy, dx);
  return (((Math.round((a / (Math.PI * 2)) * 32) % 32) + 32) % 32);
}

export class CpuPlayer {
  private rng: Rng;
  private seen: { shape: number; sf: number; st: number; move: number; moveHit: number }[] = [];
  private decidedFor = -1;
  private reaction: 'guard' | 'step' | 'ignore' | null = null;
  private strafe = 1;
  private strafeT = 0;
  private hexFrames = 0;
  private holdGuard = 0;
  private t = 0;
  private mashParity = 0;
  private opInstance = 0;
  private riposteFor = -1;
  private lastOpMove = -1;
  private lastOpSf = 0;
  private stepIn = false;
  /** Bullets already reacted to (slot:number:direction). */
  private shotSeen = '';
  private shotReaction: 'guard' | 'step' | 'take' | null = null;
  /** Ray: the frame of the current shot to fire the next one on (-1 = stop). */
  private nextShotAt = -1;
  private shotFor = -1;
  /** Volt: plan after a dash (0 none, 1 N1, 2 turnback, 3 guard). */
  private dashPlan = 0;
  private dashFor = -1;
  private stepSeenFor = -1;
  private shotAware = 0;

  constructor(private sim: Sim, private me: 0 | 1, public level: CpuLevel, seed = 1) {
    this.rng = new Rng(seed * 7919 + 17);
  }

  private shapeOf(f: FighterState): number {
    switch (f.st) {
      case ST_FREE:
        return f.guardF >= 1 ? SH.hexagon : SH.square;
      case ST_ATTACK:
        return this.sim.moveOf(f)?.shape ?? SH.square;
      case ST_BLOCKSTUN:
        return SH.hexagon;
      case ST_STEP:
        return SH.arrow;
      case ST_STUN:
        return SH.star;
      default:
        return SH.square;
    }
  }

  /** Standing in the opponent's static field (stepping there gets shocked). */
  private inField(me: FighterState, op: FighterState): boolean {
    if (op.fieldT <= 0) return false;
    const F = this.sim.char(1 - this.me).moves.find((m) => m.field)?.field;
    if (!F) return false;
    return Math.hypot(me.x - op.fieldX, me.y - op.fieldY) <= F.radius + 300;
  }

  /** The nearest bullet flying at us: distance (u), its direction and a key, or null. */
  private incoming(me: FighterState, op: FighterState): { d: number; a: number; key: string } | null {
    let best: { d: number; a: number; key: string } | null = null;
    for (let j = 0; j < MAX_SHOTS; j++) {
      const b = getShot(op, j);
      if (!b) continue;
      const a = (b.a / 1024) * Math.PI * 2;
      const rx = (me.x - b.x) / 1000;
      const ry = (me.y - b.y) / 1000;
      const along = rx * Math.cos(a) + ry * Math.sin(a);
      const side = Math.abs(-rx * Math.sin(a) + ry * Math.cos(a));
      if (along < -0.3 || side > 0.9) continue;
      if (!best || along < best.d) best = { d: along, a: b.a, key: `${j}:${b.n}:${b.a}` };
    }
    return best;
  }

  /** Near the wall the bullet would push us into (guarding there costs 30 per bullet). */
  private wallBehind(me: FighterState, ang: number): boolean {
    const a = (ang / 1024) * Math.PI * 2;
    const x = me.x / 1000 + Math.cos(a) * 2.2;
    const y = me.y / 1000 + Math.sin(a) * 2.2;
    return x < 0.6 || x > FIELD_W - 0.6 || y < 0.6 || y > FIELD_H - 0.6;
  }

  input(): number {
    const s = this.sim.s;
    const me = s.f[this.me];
    // the CPU is fooled by an illusion exactly like a player: it perceives the decoy
    const op = this.sim.decoyOf(1 - this.me) ?? s.f[1 - this.me];
    this.t++;
    // perception with delay
    this.seen.push({ shape: this.shapeOf(op), sf: op.sf, st: op.st, move: op.move, moveHit: op.moveHit });
    if (this.seen.length > 60) this.seen.shift();
    const seen = this.seen[Math.max(0, this.seen.length - 1 - this.level.react)];
    if (s.phase !== PH_FIGHT) return 0;

    const dx = (op.x - me.x) / 1000;
    const dy = (op.y - me.y) / 1000;
    const dist = Math.hypot(dx, dy);
    const toward = dirIndex(dx, dy);
    const away = (toward + 16) % 32;
    const c = this.sim.char(this.me);
    const n1 = c.moves[M_N1];
    const myReach = n1.reach / 1000 + n1.lunge / 1000 + 0.5;
    const mash = () => ((this.mashParity ^= 1) ? IN_ATK : 0);

    if (op.st === ST_ATTACK && (op.move !== this.lastOpMove || op.sf < this.lastOpSf)) this.opInstance++;
    this.lastOpMove = op.st === ST_ATTACK ? op.move : -1;
    this.lastOpSf = op.sf;
    if (seen.shape === SH.hexagon) this.hexFrames++;
    else this.hexFrames = 0;

    // ── in blockstun: GC?
    if (me.st === ST_BLOCKSTUN) {
      if (this.decidedFor !== -1 - this.opInstance) {
        this.decidedFor = -1 - this.opInstance;
        this.reaction = this.rng.chance(this.level.gc) ? 'ignore' : 'guard';
      }
      return this.reaction === 'ignore' && !me.noGc ? mash() : 0;
    }

    // ── my attack: chain / confirm
    if (me.st === ST_ATTACK) {
      const m = this.sim.moveOf(me)!;
      const id = c.def.id;
      // ray: a volley — one shot and watch, or all three at a wall / into a field; the
      // next shot on a random frame of its window (the rhythm is harder to step into)
      if (m.proj && m.chainAny && m.next >= 0) {
        if (this.shotFor !== this.t - me.sf) {
          this.shotFor = this.t - me.sf;
          const pinned = this.wallBehind(op, me.facing) || this.inField(op, me);
          const hitLast = op.st === ST_HITSTUN;
          const go = pinned ? 0.9 : hitLast ? 0.2 : 0.45;
          this.nextShotAt = this.rng.chance(go) ? m.chainAny.a + this.rng.int(m.chainAny.b - m.chainAny.a + 1) : -1;
        }
        return me.sf === this.nextShotAt - 1 ? IN_ATK : 0;
      }
      // ray: 1 → 2 → switch blast (sends them far, into shooting range / the wall)
      if (id === 'ray' && me.move === M_N2 && me.moveHit === MH_HIT && me.cost >= COST_UNIT && this.wallBehind(op, me.facing) && this.rng.chance(0.6)) return IN_S1;
      // volt: after a guarded dash, rock-paper-scissors (N1 / turnback / guard)
      if (m.dash) {
        if (this.dashFor !== this.t - me.sf) {
          this.dashFor = this.t - me.sf;
          this.dashPlan = 0;
        }
        if (me.moveHit === MH_BLOCK && this.dashPlan === 0) {
          const r = this.rng.next();
          this.dashPlan = r < 0.4 ? 1 : r < 0.7 && me.cost >= c.moves[M_S2].cost ? 2 : 3;
        }
        if (this.dashPlan === 2 && me.sf >= m.S + m.A) return IN_S2;
        if (this.dashPlan === 1 && me.sf >= m.T - 4) return IN_ATK;
        return 0;
      }
      if (me.moveHit === MH_HIT && m.next >= 0 && this.rng.chance(this.level.confirm)) {
        // blaze sometimes extends with S1 after N2
        if (me.move === M_N2 && c.def.id === 'blaze' && me.cost >= COST_UNIT && !me.chainResetUsed && this.rng.chance(0.5)) return IN_S1;
        return mash();
      }
      if (me.moveHit === MH_HIT && me.move === M_N3 && c.def.id === 'zephyr' && me.cost >= COST_UNIT) return IN_S1;
      if (me.moveHit === MH_HIT && m.chainReset && !me.chainResetUsed) return mash();
      if (me.moveHit === MH_BLOCK && me.move === M_N1) {
        // mixup after a blocked N1: mostly stop, sometimes a read
        const r = this.rng.next();
        if (c.def.id === 'bastion' && me.cost >= COST_UNIT && r < 0.05) return IN_S1;
        if (c.def.id === 'blaze' && me.cost >= COST_UNIT && r < 0.03) return IN_S1;
        return 0;
      }
      if (m.kind === KIND_GC && me.moveHit === MH_HIT) return mash();
      return me.moveHit === MH_NONE ? IN_STICK | toward : 0;
    }

    if (me.st === ST_STEP) {
      if (me.justWin > 0) return mash();
      // volt: a step turns into the dash — into a startup (before it becomes active), or
      // through a guard (then the turnback). Not into a riposte stance.
      if (c.def.id === 'volt' && me.sf >= SYSTEM.step.attackCancelFrom && me.cost >= c.moves[M_S1].cost && dist < 4) {
        const om = op.st === ST_ATTACK ? this.sim.moveOf(op) : null;
        const riposte = !!om?.cs || (op.st === ST_FREE && this.sim.char(1 - this.me).moves[M_S1].cs && op.cost >= COST_UNIT && op.guardF > 0);
        const startup = !!om && om.hasHitbox && op.sf < om.S - 4;
        const guarding = op.st === ST_FREE && op.guardF >= 2;
        if (!riposte && ((startup && this.rng.chance(0.5)) || (guarding && me.cost >= 2 * COST_UNIT && this.rng.chance(0.35)) || (this.stepIn && this.rng.chance(0.3)))) {
          this.stepIn = false;
          return IN_S1 | IN_STICK | toward;
        }
      }
      // a step in toward the opponent turns into an attack with the step's momentum
      if (this.stepIn && dist < myReach + 1.2) {
        this.stepIn = false;
        const s2 = c.moves[M_S2];
        if (s2.gb && me.cost >= s2.cost && this.hexFrames > 6 && this.rng.chance(0.5)) return IN_S2 | IN_STICK | toward;
        return IN_ATK | IN_STICK | toward;
      }
      return 0;
    }
    this.stepIn = false;
    if (me.st === ST_HITSTUN || me.st === ST_STUN || me.st === ST_DOWN) return 0;
    if (me.st === ST_WAKE) return this.rng.chance(0.5) ? IN_STICK | ((away + (this.rng.chance(0.5) ? 8 : -8) + 32) % 32) : 0;
    if (me.justWin > 0) return mash();

    const fielded = this.inField(me, op);
    const canStep = me.steps > 0 && !fielded;

    // ── a bullet coming: step INTO it (bullet just) / guard in the open / take it at a wall
    // (only once the shot's startup has been perceived, with the usual reaction delay:
    // a first bullet from afar is a surprise, a volley's rhythm is not)
    const sawShot = seen.st === ST_ATTACK && !!this.sim.char(1 - this.me).moves[seen.move]?.proj;
    if (sawShot) this.shotAware = 40;
    else if (this.shotAware > 0) this.shotAware--;
    const inc = this.shotAware > 0 ? this.incoming(me, op) : null;
    if (inc && inc.d < 2.4) {
      if (this.shotSeen !== inc.key) {
        this.shotSeen = inc.key;
        // stepping into a bullet is a timing read (harder than seeing a triangle)
        const correct = this.rng.chance(this.level.accuracy * 0.5);
        const wall = this.wallBehind(me, inc.a);
        this.shotReaction = correct && canStep ? 'step' : wall ? 'take' : 'guard';
      }
      const back = (dirIndex(-Math.cos((inc.a / 1024) * Math.PI * 2), -Math.sin((inc.a / 1024) * Math.PI * 2)) + 32) % 32;
      if (this.shotReaction === 'step' && inc.d < 1.7 && canStep) return IN_STEP | IN_STICK | back;
      if (this.shotReaction === 'take') return IN_STICK | ((back + 8) % 32);
      if (this.shotReaction === 'guard') return 0;
    }
    // ── a volt stepping in: put an attack out (a dash loses to anything touching it)
    if (op.st === ST_STEP && seen.st === ST_STEP && this.sim.char(1 - this.me).def.id === 'volt' && op.cost >= COST_UNIT && dist < myReach + 2.2) {
      if (this.stepSeenFor !== this.opInstance + op.steps * 1000 + this.t - op.sf) {
        this.stepSeenFor = this.opInstance + op.steps * 1000 + this.t - op.sf;
        if (this.rng.chance(this.level.accuracy * 0.6)) return IN_ATK | IN_STICK | toward;
      }
    }

    // ── free: react to what we see
    const opAttacking = seen.st === ST_ATTACK && op.st === ST_ATTACK;
    if (opAttacking && dist < 5) {
      if (this.decidedFor !== this.opInstance) {
        // decide once per opponent move instance
        this.decidedFor = this.opInstance;
        const correct = this.rng.chance(this.level.accuracy);
        if (seen.shape === SH.triangle) this.reaction = correct ? 'step' : 'guard';
        else if (seen.shape === SH.circle) this.reaction = correct ? 'guard' : this.rng.chance(0.5) ? 'ignore' : 'step';
        else if (seen.shape === SH.pentagon) this.reaction = 'ignore';
        else this.reaction = 'guard';
      }
      if (seen.shape === SH.pentagon && dist < myReach + 1.5) return this.rng.chance(0.5) ? IN_ATK : IN_STICK | toward;
      // counter-stance characters sometimes answer a circle with the riposte (hexagon)
      if (this.reaction === 'guard' && seen.shape === SH.circle && c.moves[M_S1].cs && me.cost >= c.moves[M_S1].cost) {
        if (this.decidedFor !== this.riposteFor) {
          this.riposteFor = this.decidedFor;
          if (this.rng.chance(0.4)) return IN_S1;
        }
      }
      if (this.reaction === 'step') return canStep ? IN_STEP | IN_STICK | ((away + (this.rng.chance(0.5) ? 6 : -6) + 32) % 32) : IN_STICK | away;
      // guard — unless the gauge is about to run out (idle guarding breaks in ~1.5s)
      if (this.reaction === 'guard') return me.guardQ < c.guardMaxQ * 0.2 ? IN_STICK | ((away + this.strafe * 8 + 32) % 32) : 0;
    }

    // punish whiffed recovery / stunned opponent
    if (op.st === ST_STUN && dist < myReach + 0.3) return mash();
    if (op.st === ST_ATTACK && op.moveHit === MH_NONE) {
      const om = this.sim.moveOf(op)!;
      const end = op.moveHit === MH_NONE ? om.whiffT : om.T;
      if (op.sf > om.S + om.A && end - op.sf > n1.S && dist < myReach) return IN_ATK;
    }

    // ── volt: the dash also comes out on its own — through a slow startup (seen with the
    // reaction delay, before its hitbox is out) or a guard; never into a riposte stance
    if (c.def.id === 'volt' && me.cost >= c.moves[M_S1].cost && dist < 3.6 && dist > 1.2) {
      const om = op.st === ST_ATTACK ? this.sim.moveOf(op) : null;
      const seenAtk = seen.st === ST_ATTACK && !!om && om.hasHitbox && op.sf < om.S - 5;
      const riposte = !!om?.cs || (!!this.sim.char(1 - this.me).moves[M_S1].cs && op.cost >= COST_UNIT && op.st === ST_FREE && op.guardF > 0);
      if (!riposte && ((seenAtk && this.rng.chance(0.35)) || (this.hexFrames > 20 && me.cost >= 2 * COST_UNIT && this.rng.chance(0.03)))) return IN_S1 | IN_STICK | toward;
    }

    // ── ray: modes, shots, field
    if (c.def.id === 'ray') {
      if (me.shootMode) {
        // too close: slip back out with a step, or give up the gun
        if (dist < 3.2 && canStep && op.st !== ST_DOWN && this.rng.chance(0.04)) {
          const nearWall = (d: number) => {
            const a = (d / 32) * Math.PI * 2;
            const x = me.x / 1000 + Math.cos(a) * 2.4;
            const y = me.y / 1000 + Math.sin(a) * 2.4;
            return x < 0.8 || x > FIELD_W - 0.8 || y < 0.8 || y > FIELD_H - 0.8;
          };
          let d = (away + this.strafe * 3 + 32) % 32;
          if (nearWall(d)) d = (away + this.strafe * 9 + 32) % 32;
          if (!nearWall(d)) return IN_STEP | IN_STICK | d;
        }
        // the gun is useless up close: back to melee before they arrive
        if (dist < 2.6 && op.st !== ST_DOWN && this.rng.chance(0.1)) return IN_S1;
        // shoot when a step-in can't answer it (no steps, in the field, pinned, busy guarding);
        // into a fresh opponent with steps in stock only now and then
        const pinned = this.inField(op, me) || this.wallBehind(op, (toward * 32) & 1023);
        const guarding = (op.st === ST_FREE && op.guardF > 0) || op.st === ST_BLOCKSTUN;
        const safe = pinned || op.steps === 0 || guarding || op.st === ST_HITSTUN || op.st === ST_STUN;
        if (dist > 2.6 && op.st !== ST_DOWN && op.st !== ST_STEP && this.rng.chance(safe ? (guarding ? 0.18 : 0.1) : 0.05)) return IN_ATK | IN_STICK | toward;
      } else if (this.hexFrames > 6 && this.sim.char(1 - this.me).moves[M_S1].cs && op.cost >= COST_UNIT) {
        // a hexagon that may be a riposte stance: don't swing a circle into it — the gun's
        // diamonds can't be caught (back off, or switch to shooting)
        if (me.cost >= COST_UNIT && dist > 2.4 && this.rng.chance(0.15)) return IN_S1;
        if (dist < 3) return IN_STICK | ((away + this.strafe * 4 + 32) % 32);
      } else if (me.cost >= COST_UNIT) {
        // into the gun: from afar, over a knocked-down opponent, or against a turtle
        // (no guard break of her own: guarded bullets chip the gauge instead)
        const turtle = this.hexFrames > 24 && dist > 2.8 && dist < 6.5;
        if (((op.st === ST_DOWN && dist >= 3.4) || dist >= 5 || turtle) && this.rng.chance(turtle ? 0.12 : 0.05)) return IN_S1;
      }
      const s2 = c.moves[M_S2];
      if (me.shootMode && me.cost >= s2.cost && me.fieldT === 0 && dist > 4 && dist < 5.2 && this.rng.chance(0.008)) return IN_S2;
    }

    // break a long guard
    if (this.hexFrames > 40 && dist < 3.2) {
      const s2 = c.moves[M_S2];
      if (s2.gb && me.cost >= s2.cost && this.rng.chance(0.08)) return IN_S2 | IN_STICK | toward;
      const s1 = c.moves[M_S1];
      if (s1.gb && me.cost >= s1.cost && this.rng.chance(0.08)) return IN_S1 | IN_STICK | toward;
    }
    // phantom: send an illusion to bait a guard / an attack, then break the guard,
    // punish the whiff, or walk in and hit for real while invisible
    if (c.def.id === 'phantom') {
      const s1 = c.moves[M_S1];
      const s2 = c.moves[M_S2];
      const real = s.f[1 - this.me];
      const rdx = (real.x - me.x) / 1000;
      const rdy = (real.y - me.y) / 1000;
      const rdist = Math.hypot(rdx, rdy);
      const rtoward = dirIndex(rdx, rdy);
      if (me.ghostT > 0) {
        const guarding = real.st === ST_FREE && real.guardF >= 2;
        // the fake swing keeps a fooled opponent guarding for a while: break it right away
        if ((guarding || me.ghostMode === 2) && rdist < 2.8 && me.cost >= s2.cost) return IN_S2 | IN_STICK | rtoward;
        if (real.st === ST_ATTACK && real.moveHit === MH_NONE && rdist < myReach + 0.3) return IN_ATK | IN_STICK | rtoward;
        if (!guarding && rdist < myReach - 0.2 && this.rng.chance(0.3)) return IN_ATK | IN_STICK | rtoward;
        // slip in from the side while invisible
        return IN_STICK | ((rtoward + this.strafe * 3 + 32) % 32);
      }
      // illusion only with the guard break in reserve (the bait → crush plan): mostly the
      // in-range fake swing (a circle the opponent will guard), sometimes a step-in from afar
      if (me.cost >= s1.cost + s2.cost) {
        if (rdist <= myReach && op.st === ST_FREE && this.rng.chance(0.08)) return IN_S1;
        if (rdist > 3.2 && rdist < 5.5 && this.rng.chance(0.01)) return IN_S1;
      }
      if (this.hexFrames > 20 && rdist < 2.6 && me.cost >= s2.cost && this.rng.chance(0.1)) return IN_S2 | IN_STICK | rtoward;
    }
    // zephyr heal when far
    if (c.def.id === 'zephyr' && dist > 6 && me.cost >= 3 * COST_UNIT && me.hp < c.hp * 0.8 && this.rng.chance(0.02)) return IN_S2;

    // standing guard for a moment (bait GC) — but don't burn the gauge
    if (this.holdGuard > 0) {
      this.holdGuard--;
      return 0;
    }
    if (dist < myReach + 0.4 && me.guardQ > c.guardMaxQ * 0.5 && this.rng.chance(0.01)) this.holdGuard = 20 + this.rng.int(30);

    // spacing
    const pref = c.def.id === 'ray' && me.shootMode ? 5.2 : PREFERRED[c.def.id] ?? 2.8;
    if (--this.strafeT <= 0) {
      this.strafeT = 30 + this.rng.int(60);
      this.strafe = this.rng.chance(0.5) ? 1 : -1;
    }
    if (dist <= myReach && this.rng.chance(this.level.aggression * 3)) return IN_ATK | IN_STICK | toward;
    if (dist > pref + 1.6 && me.steps > 1 && canStep && this.rng.chance(0.01)) return IN_STEP | IN_STICK | toward;
    // step in and attack out of the step (the step's momentum carries the attack); volt lives on steps
    const stepRate = c.def.id === 'volt' ? this.level.aggression * 2.5 : this.level.aggression;
    if (dist > myReach && dist < myReach + (c.def.id === 'volt' ? 3.2 : 2.4) && canStep && this.rng.chance(stepRate)) {
      this.stepIn = true;
      return IN_STEP | IN_STICK | toward;
    }
    if (dist > pref + 0.3) return IN_STICK | ((toward + this.strafe * 2 + 32) % 32);
    if (dist < pref - 0.6) return IN_STICK | ((away + this.strafe * 3 + 32) % 32);
    if (this.rng.chance(this.level.aggression)) return IN_STICK | toward | (dist <= myReach + 0.6 ? IN_ATK : 0);
    return IN_STICK | ((toward + this.strafe * 8 + 32) % 32);
  }
}

// ───────────── training dummies (plan §13) ─────────────
export type DummyMode = 'stand' | 'guard' | 'hitGuard' | 'mash' | 'gb' | 'stepSpam' | 'cpu';

export const DUMMY_MODES: { id: DummyMode; label: string; desc: string }[] = [
  { id: 'stand', label: '棒立ち', desc: '動かない（四角のまま）' },
  { id: 'guard', label: '無限ガード', desc: 'GBの確認・ガードゲージ無限' },
  { id: 'hitGuard', label: 'ヒット後ガード', desc: 'コンボが繋がっているかの確認' },
  { id: 'mash', label: '攻撃ブンブン', desc: 'GC・ジャスト回避の練習' },
  { id: 'gb', label: 'GB連発', desc: '三角を見て避ける練習' },
  { id: 'stepSpam', label: 'ステップ連発', desc: 'ステップ硬直を狩る練習' },
  { id: 'cpu', label: 'CPU', desc: '通常のCPU' },
];

export class Dummy {
  private t = 0;
  private hitSeen = 0;
  private cpu: CpuPlayer;
  constructor(private sim: Sim, private me: 0 | 1, public mode: DummyMode) {
    this.cpu = new CpuPlayer(sim, me, CPU_LEVELS[1], 3);
  }
  input(): number {
    const s = this.sim.s;
    const me = s.f[this.me];
    const op = s.f[1 - this.me];
    this.t++;
    me.infGuard = this.mode === 'guard' ? 1 : 0;
    const toward = dirIndex(op.x - me.x, op.y - me.y);
    const dist = Math.hypot(op.x - me.x, op.y - me.y) / 1000;
    switch (this.mode) {
      case 'stand':
        // never guards: shuffle in place (square)
        return IN_STICK | ((toward + (Math.floor(this.t / 20) % 2 ? 8 : 24)) % 32);
      case 'guard':
        return 0;
      case 'hitGuard':
        if (me.st === ST_HITSTUN || me.st === ST_STUN || me.st === ST_DOWN) this.hitSeen = 60;
        if (this.hitSeen > 0) {
          this.hitSeen--;
          return 0;
        }
        // (guard only ~1s after a hit: the guard gauge is short)
        return IN_STICK | ((toward + 8) % 32);
      case 'mash':
        if (dist > 2.6) return IN_STICK | toward;
        return this.t % 2 ? IN_ATK : 0;
      case 'gb': {
        const c = this.sim.char(this.me);
        const gbSlot = c.moves[M_S2].gb ? IN_S2 : c.moves[M_S1].gb ? IN_S1 : IN_ATK;
        me.infCost = 1;
        if (c.moves[M_S2].def?.cancelFrom?.includes('dashThrust')) {
          // ヴォルト: its guard break only comes out of a dash (step → dash → turnback)
          if (dist > 3.6) return IN_STICK | toward;
          if (this.t % 60 === 0) return IN_STEP | IN_STICK | toward;
          if (this.t % 60 === 3) return IN_S1 | IN_STICK | toward;
          return me.move === M_S1 && me.sf === 12 ? IN_S2 : 0;
        }
        if (dist > 2.8) return IN_STICK | toward;
        return this.t % 50 === 0 ? gbSlot | IN_STICK | toward : 0;
      }
      case 'stepSpam':
        return this.t % 40 === 0 ? IN_STEP | IN_STICK | ((toward + (this.t % 80 === 0 ? 8 : 24)) % 32) : IN_STICK | toward;
      case 'cpu':
        return this.cpu.input();
    }
  }
}
