// CPU opponent (plan §12/§13): it reads the opponent's SHAPE with a human-like
// reaction delay and a chance to react correctly. Difficulty = those two numbers.
import type { Sim } from '../core/sim';
import { SH, M_N1, M_N2, M_N3, M_S1, M_S2, KIND_GC, COST_UNIT } from '../core/compile';
import { IN_ATK, IN_S1, IN_S2, IN_STEP, IN_STICK } from '../core/input';
import {
  ST_FREE, ST_ATTACK, ST_BLOCKSTUN, ST_STEP, ST_STUN, ST_DOWN, ST_WAKE, ST_HITSTUN,
  MH_HIT, MH_BLOCK, MH_NONE, PH_FIGHT, type FighterState,
} from '../core/state';
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

const PREFERRED: Record<string, number> = { blaze: 2.6, zephyr: 3.3, bastion: 2.6 };

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

  input(): number {
    const s = this.sim.s;
    const me = s.f[this.me];
    const op = s.f[1 - this.me];
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
      return 0;
    }
    if (me.st === ST_HITSTUN || me.st === ST_STUN || me.st === ST_DOWN) return 0;
    if (me.st === ST_WAKE) return this.rng.chance(0.5) ? IN_STICK | ((away + (this.rng.chance(0.5) ? 8 : -8) + 32) % 32) : 0;
    if (me.justWin > 0) return mash();

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
      if (this.reaction === 'step') return me.steps > 0 ? IN_STEP | IN_STICK | ((away + (this.rng.chance(0.5) ? 6 : -6) + 32) % 32) : IN_STICK | away;
      if (this.reaction === 'guard') return 0;
    }

    // punish whiffed recovery / stunned opponent
    if (op.st === ST_STUN && dist < myReach + 0.3) return mash();
    if (op.st === ST_ATTACK && op.moveHit === MH_NONE) {
      const om = this.sim.moveOf(op)!;
      if (op.sf > om.S + om.A && om.T - op.sf > n1.S && dist < myReach) return IN_ATK;
    }

    // break a long guard
    if (this.hexFrames > 40 && dist < 3.2) {
      const s2 = c.moves[M_S2];
      if (s2.gb && me.cost >= s2.cost && this.rng.chance(0.08)) return IN_S2 | IN_STICK | toward;
      const s1 = c.moves[M_S1];
      if (s1.gb && me.cost >= s1.cost && this.rng.chance(0.08)) return IN_S1 | IN_STICK | toward;
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
    const pref = PREFERRED[c.def.id] ?? 2.8;
    if (--this.strafeT <= 0) {
      this.strafeT = 30 + this.rng.int(60);
      this.strafe = this.rng.chance(0.5) ? 1 : -1;
    }
    if (dist <= myReach && this.rng.chance(this.level.aggression * 3)) return IN_ATK | IN_STICK | toward;
    if (dist > pref + 1.6 && me.steps > 1 && this.rng.chance(0.01)) return IN_STEP | IN_STICK | toward;
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
        if (me.st === ST_HITSTUN || me.st === ST_STUN || me.st === ST_DOWN) this.hitSeen = 90;
        if (this.hitSeen > 0) {
          this.hitSeen--;
          return 0;
        }
        return IN_STICK | ((toward + 8) % 32);
      case 'mash':
        if (dist > 2.6) return IN_STICK | toward;
        return this.t % 2 ? IN_ATK : 0;
      case 'gb': {
        const c = this.sim.char(this.me);
        const gbSlot = c.moves[M_S2].gb ? IN_S2 : c.moves[M_S1].gb ? IN_S1 : IN_ATK;
        me.infCost = 1;
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
