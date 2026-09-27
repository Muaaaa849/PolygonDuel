// Deterministic simulation: step(state, inputs) → state + events (plan §11).
// Never touches DOM, clocks, Math.random or transcendental Math functions.
import { SYSTEM } from '../data/system';
import { CHARACTERS } from '../data/characters';
import {
  compileCharacter, type CChar, type CMove,
  M_N1, M_GC, M_JA, M_S1, M_S2, M_STRIKE, KIND_GC, KIND_JA, KIND_NORMAL, KIND_SKILL, CANCEL_NEUTRAL, SH,
} from './compile';
import {
  ANG, U, atan2A, clamp, idiv, isqrt, offX, offY, segPointDist2, turnToward, u,
} from './fixed';
import {
  type FighterState, type GameState, newGameState,
  ST_FREE, ST_ATTACK, ST_BLOCKSTUN, ST_HITSTUN, ST_STEP, ST_DOWN, ST_WAKE, ST_STUN, ST_KO,
  MH_NONE, MH_HIT, MH_BLOCK, MH_SPENT,
  PH_INTRO, PH_FIGHT, PH_END, PH_MATCH_OVER,
} from './state';
import { IN_ATK, IN_S1, IN_S2, IN_STEP, IN_STICK, dirAngle } from './input';
import {
  type SimEvent,
  EV_MOVE, EV_HIT, EV_BLOCK, EV_CRUSH, EV_GUARD_BREAK, EV_GB_OPEN, EV_JUST, EV_RIPOSTE, EV_KNOCKDOWN, EV_STEP,
  EV_HEAL, EV_KO, EV_ROUND, EV_FIGHT, EV_TIMEUP, EV_ROUND_END, EV_MATCH_END, EV_WAKE, EV_GUARD,
  HF_COUNTER, HF_JA, HF_OTG, HF_KNOCKDOWN, HF_FORCED_DOWN,
} from './events';

const COMPILED: CChar[] = CHARACTERS.map((c, i) => compileCharacter(c, i));
export const getChar = (idx: number): CChar => COMPILED[idx];

const R = SYSTEM.round;
const FIELD_W = u(SYSTEM.field.w);
const FIELD_H = u(SYSTEM.field.h);
const BODY_R = u(SYSTEM.bodyRadius);
const HURT_R = u(SYSTEM.hurtRadius);
const HURT_R2 = HURT_R * HURT_R;
const FAR_D2 = u(SYSTEM.guard.farDist) * u(SYSTEM.guard.farDist);
const HOMING_STEP = Math.round((SYSTEM.homingDeg * ANG) / 360);
const COST_MAX = SYSTEM.cost.max * 2;
const COST_GAIN = Math.round(SYSTEM.cost.gainOnContact * 2);
const COST_COMBO_CAP = Math.round(SYSTEM.cost.maxGainPerCombo * 2);
const ROLL_DIST = u(SYSTEM.down.rollDist);
const LAUNCH = u(SYSTEM.down.launch);
const STEP_W = [16, 15, 14, 12, 11, 9, 8, 7, 5, 3]; // ease-out profile, sums to 100

/** Per-character step distance for each move frame (1-based). */
const STEP_TABLE: Int32Array[] = COMPILED.map((c) => {
  const t = new Int32Array(SYSTEM.step.moveFrames + 1);
  let sum = 0;
  for (let i = 0; i < STEP_W.length; i++) {
    t[i + 1] = idiv(c.stepDist * STEP_W[i], 100);
    sum += t[i + 1];
  }
  t[1] += c.stepDist - sum;
  return t;
});

export interface SimOptions {
  /** Training: no timer, refill HP after combos, no KO. */
  training?: boolean;
}

export class Sim {
  s: GameState;
  events: SimEvent[] = [];
  /** Training-mode behaviour (not part of the synced state; only used offline). */
  training: boolean;

  constructor(charA: number, charB: number, opts: SimOptions = {}) {
    this.training = !!opts.training;
    this.s = newGameState();
    this.s.f[0].char = charA;
    this.s.f[1].char = charB;
    this.s.noTimer = this.training ? 1 : 0;
    this.s.trainingRefill = this.training ? 1 : 0;
    this.startRound(true);
  }

  char(i: number): CChar {
    return COMPILED[this.s.f[i].char];
  }

  moveOf(f: FighterState): CMove | null {
    return f.move >= 0 ? COMPILED[f.char].moves[f.move] : null;
  }

  private emit(type: number, who: number, a = 0, b = 0, x = 0, y = 0): void {
    this.events.push({ type, frame: this.s.frame, who, a, b, x, y });
  }

  // ───────────────────────────── rounds ─────────────────────────────

  startRound(first: boolean): void {
    const s = this.s;
    s.phase = PH_INTRO;
    s.phaseF = first ? -(R.introFirst - R.intro) : 0;
    s.timer = R.seconds * SYSTEM.fps;
    s.hitstop = 0;
    s.freeze = 0;
    s.roundWinner = -1;
    if (first) {
      s.round = 1;
      s.winsA = 0;
      s.winsB = 0;
      s.matchWinner = -1;
    }
    for (let i = 0; i < 2; i++) {
      const f = s.f[i];
      const c = COMPILED[f.char];
      const keepChar = f.char;
      const keepStats = [f.statDmg, f.statGc, f.statJust, f.statCrush, f.statMaxCombo, f.statBlocks, f.statHitsTaken];
      const keepTraining = [f.infGuard, f.infCost];
      Object.assign(f, {
        x: i === 0 ? u(5) : u(11), y: u(4.5), facing: i === 0 ? 0 : ANG / 2,
        hp: c.hp, st: ST_FREE, sf: 0, len: 0, move: -1, moveHit: 0, moveHitAt: 0,
        guardF: 0, guardQ: c.guardMaxQ, guardIdle: 0,
        cost: SYSTEM.cost.start * 2, comboGain: 0,
        steps: SYSTEM.step.maxStock, stepTimer: 0, moveDir: 0, stepChain: 0,
        bufAtk: 0, bufS1: 0, bufS2: 0, bufStep: 0, gcQueued: 0, noGc: 0, justWin: 0, jaChain: 0,
        chainResetUsed: 0, otgUsed: 0, comboHits: 0, comboFrames: 0, comboDmg: 0, downAge: 0,
        kbDist: 0, kbAngle: 0, limited: 0, buff: 0, healUses: 0, csHit: 0,
        lastDir: i === 0 ? 0 : 16,
      });
      f.char = keepChar;
      if (!first) {
        [f.statDmg, f.statGc, f.statJust, f.statCrush, f.statMaxCombo, f.statBlocks, f.statHitsTaken] = keepStats;
      } else {
        f.statDmg = f.statGc = f.statJust = f.statCrush = f.statMaxCombo = f.statBlocks = f.statHitsTaken = 0;
      }
      [f.infGuard, f.infCost] = keepTraining;
    }
    this.emit(EV_ROUND, 0, s.round);
  }

  /** Skip intro (training / tests). */
  skipIntro(): void {
    this.s.phase = PH_FIGHT;
    this.s.phaseF = 0;
  }

  // ───────────────────────────── main step ─────────────────────────────

  step(inA: number, inB: number): void {
    const s = this.s;
    s.frame++;
    this.events.length = 0;

    if (s.phase === PH_MATCH_OVER) return;

    const fighting = s.phase === PH_FIGHT;
    const ins0 = fighting ? inA : 0;
    const ins1 = fighting ? inB : 0;
    this.readInput(0, ins0);
    this.readInput(1, ins1);

    if (s.phase === PH_INTRO) {
      s.phaseF++;
      if (s.phaseF >= R.intro) {
        s.phase = PH_FIGHT;
        s.phaseF = 0;
        this.emit(EV_FIGHT, 0);
      }
      return;
    }

    if (s.hitstop > 0) {
      s.hitstop--;
      return;
    }
    if (s.freeze > 0) {
      s.freeze--;
      return;
    }

    this.updateFighter(0, ins0);
    this.updateFighter(1, ins1);
    this.resolveBodies();
    this.detectHits();
    this.updateGauges();
    this.updateCombos();

    if (s.phase === PH_FIGHT) {
      this.checkKo();
      if (s.phase === PH_FIGHT && !s.noTimer) {
        s.timer--;
        if (s.timer <= 0) this.timeUp();
      }
    } else if (s.phase === PH_END) {
      s.phaseF++;
      if (s.phaseF >= R.koPause) this.endRound();
    }
  }

  private readInput(i: number, w: number): void {
    const f = this.s.f[i];
    const pressed = w & ~f.prevIn;
    f.prevIn = w;
    if (w & IN_STICK) f.lastDir = w & 31;
    const B = SYSTEM.buffer + 1; // decremented once before use this frame
    if (pressed & IN_ATK) {
      f.bufAtk = B;
      if (f.st === ST_BLOCKSTUN && !f.noGc) f.gcQueued = 1;
    }
    if (pressed & IN_S1) f.bufS1 = B;
    if (pressed & IN_S2) f.bufS2 = B;
    if (pressed & IN_STEP) f.bufStep = B;
  }

  // ───────────────────────────── fighter update ─────────────────────────────

  private angleTo(i: number): number {
    const f = this.s.f[i];
    const o = this.s.f[1 - i];
    return atan2A(o.y - f.y, o.x - f.x);
  }

  private updateFighter(i: number, w: number): void {
    const f = this.s.f[i];
    if (f.bufAtk > 0) f.bufAtk--;
    if (f.bufS1 > 0) f.bufS1--;
    if (f.bufS2 > 0) f.bufS2--;
    if (f.bufStep > 0) f.bufStep--;
    if (f.justWin > 0) f.justWin--;
    if (f.buff > 0) f.buff--;
    f.sf++;

    this.slide(f);

    switch (f.st) {
      case ST_FREE:
        this.freeLogic(i, w);
        break;
      case ST_ATTACK: {
        const m = this.moveOf(f)!;
        if (f.sf > m.T) {
          this.toFree(f);
          this.freeLogic(i, w);
        } else if (!this.tryChain(i, w)) {
          this.attackFrame(i);
        }
        break;
      }
      case ST_BLOCKSTUN:
        if (f.sf > f.len) {
          if (f.gcQueued) {
            f.gcQueued = 0;
            f.statGc++;
            this.startMove(i, M_GC, w);
          } else {
            f.st = ST_FREE;
            f.sf = 1;
            f.noGc = 0;
            this.freeLogic(i, w);
          }
        }
        break;
      case ST_HITSTUN:
      case ST_STUN:
        if (f.sf > f.len) {
          this.toFree(f);
          this.freeLogic(i, w);
        }
        break;
      case ST_STEP:
        this.stepLogic(i, w);
        break;
      case ST_DOWN:
        f.downAge++;
        if (f.sf > f.len) {
          f.st = ST_WAKE;
          f.sf = 1;
          f.len = SYSTEM.down.wake;
          f.moveDir = w & IN_STICK ? dirAngle(w) : -1;
          this.emit(EV_WAKE, i);
          this.wakeRoll(f);
        }
        break;
      case ST_WAKE:
        if (f.sf > f.len) {
          this.toFree(f);
          f.limited = SYSTEM.down.limited;
          this.freeLogic(i, w);
        } else {
          this.wakeRoll(f);
        }
        break;
      case ST_KO:
        break;
    }
  }

  private toFree(f: FighterState): void {
    f.st = ST_FREE;
    f.sf = 1;
    f.move = -1;
    f.guardF = 0;
  }

  private slide(f: FighterState): void {
    if (f.kbDist <= 0) return;
    let d = idiv(f.kbDist, 4) + 12;
    if (d > f.kbDist) d = f.kbDist;
    f.kbDist -= d;
    f.x += offX(f.kbAngle, d);
    f.y += offY(f.kbAngle, d);
  }

  private wakeRoll(f: FighterState): void {
    if (f.moveDir < 0 || f.sf > 12) return;
    const d = idiv(ROLL_DIST, 12);
    f.x += offX(f.moveDir, d);
    f.y += offY(f.moveDir, d);
  }

  private canAfford(f: FighterState, m: CMove): boolean {
    if (!f.infCost && f.cost < m.cost) return false;
    if (m.usesPerRound > 0 && f.healUses >= m.usesPerRound) return false;
    return true;
  }

  private freeLogic(i: number, w: number): void {
    const f = this.s.f[i];
    const c = COMPILED[f.char];
    if (f.limited > 0) {
      f.limited--;
    } else {
      if (f.justWin > 0 && f.bufAtk) return this.startMove(i, M_JA, w);
      const s1 = c.moves[M_S1];
      const s2 = c.moves[M_S2];
      if (f.bufS1 && s1.cancelFrom & CANCEL_NEUTRAL && this.canAfford(f, s1)) return this.startMove(i, M_S1, w);
      if (f.bufS2 && s2.cancelFrom & CANCEL_NEUTRAL && this.canAfford(f, s2)) return this.startMove(i, M_S2, w);
      if (f.bufAtk) return this.startMove(i, M_N1, w);
      if (f.bufStep && f.steps > 0) return this.startStep(i, w);
    }
    if (w & IN_STICK) {
      // walk
      const a = dirAngle(w);
      f.facing = a;
      let sp = c.walk;
      if (f.buff > 0) {
        const heal = this.healSpec(f);
        if (heal) sp = idiv(sp * (100 + heal.walkPct), 100);
      }
      f.x += offX(a, sp);
      f.y += offY(a, sp);
      if (f.guardF > 0) f.guardF = 0;
    } else {
      // stick released = guard (hexagon)
      if (f.guardF === 0) this.emit(EV_GUARD, i);
      if (f.guardF < 1000) f.guardF++;
      f.facing = this.angleTo(i);
    }
  }

  private healSpec(f: FighterState) {
    const c = COMPILED[f.char];
    return c.moves[M_S1].heal ?? c.moves[M_S2].heal;
  }

  private startStep(i: number, w: number): void {
    const f = this.s.f[i];
    f.bufStep = 0;
    f.moveDir = w & IN_STICK ? dirAngle(w) : (this.angleTo(i) + ANG / 2) & (ANG - 1);
    if (f.steps === SYSTEM.step.maxStock) f.stepTimer = 0;
    f.steps--;
    f.st = ST_STEP;
    f.sf = 1;
    f.move = -1;
    f.guardF = 0;
    f.jaChain = 0;
    this.emit(EV_STEP, i, f.moveDir, 0, f.x, f.y);
    this.stepMove(f);
  }

  private stepMove(f: FighterState): void {
    if (f.sf > SYSTEM.step.moveFrames) return;
    const d = STEP_TABLE[f.char][f.sf];
    f.x += offX(f.moveDir, d);
    f.y += offY(f.moveDir, d);
  }

  private stepLogic(i: number, w: number): void {
    const f = this.s.f[i];
    const c = COMPILED[f.char];
    if (f.justWin > 0 && f.bufAtk) return this.startMove(i, M_JA, w);
    if (f.sf > SYSTEM.step.total) {
      this.toFree(f);
      return this.freeLogic(i, w);
    }
    if (f.sf >= SYSTEM.step.chainFrom && f.bufStep && f.steps > 0) return this.startStep(i, w);
    if (f.sf >= SYSTEM.step.attackCancelFrom) {
      const s1 = c.moves[M_S1];
      const s2 = c.moves[M_S2];
      if (f.bufS1 && s1.cancelFrom & CANCEL_NEUTRAL && this.canAfford(f, s1)) return this.startMove(i, M_S1, w);
      if (f.bufS2 && s2.cancelFrom & CANCEL_NEUTRAL && this.canAfford(f, s2)) return this.startMove(i, M_S2, w);
      if (f.bufAtk) return this.startMove(i, M_N1, w);
    }
    this.stepMove(f);
  }

  private startMove(i: number, mi: number, w: number, chained = false): void {
    const f = this.s.f[i];
    const c = COMPILED[f.char];
    const m = c.moves[mi];
    if (mi === M_JA) {
      f.justWin = 0;
      f.jaChain = 1;
    } else if (m.kind === KIND_SKILL || m.kind === KIND_GC || (m.kind === KIND_NORMAL && !chained)) {
      f.jaChain = 0;
    }
    if (m.kind === KIND_SKILL && mi !== M_STRIKE) {
      if (!f.infCost) f.cost -= m.cost;
      if (m.usesPerRound > 0) f.healUses++;
    }
    if (mi === M_N1 || mi === M_JA) f.bufAtk = 0;
    else if (mi === M_S1) f.bufS1 = 0;
    else if (mi === M_S2) f.bufS2 = 0;
    else if (chained) f.bufAtk = 0;
    f.st = ST_ATTACK;
    f.sf = 1;
    f.move = mi;
    f.moveHit = MH_NONE;
    f.moveHitAt = 0;
    f.csHit = 0;
    f.guardF = 0;
    // Direction: auto-aim moves face the opponent; chained moves keep facing;
    // fresh attacks go where the stick points (plan §4).
    if (m.autoAim) f.facing = this.angleTo(i);
    else if (!chained) f.facing = w & IN_STICK ? dirAngle(w) : this.angleTo(i);
    this.emit(EV_MOVE, i, mi, 0, f.x, f.y);
    this.attackFrame(i);
  }

  private inWin(win: { a: number; b: number } | null, f: number): boolean {
    return !!win && f >= win.a && f <= win.b;
  }

  /** Chains and cancels out of a move that made contact. */
  private tryChain(i: number, w: number): boolean {
    const f = this.s.f[i];
    const c = COMPILED[f.char];
    const m = c.moves[f.move];
    const mf = f.sf;
    const hit = f.moveHit === MH_HIT;
    const blocked = f.moveHit === MH_BLOCK;
    if (!hit && !blocked) return false;

    // skill cancel (GC may only cancel on hit)
    if ((hit || m.kind !== KIND_GC) && this.inWin(m.cancel, mf)) {
      const bit = 1 << f.move;
      const s1 = c.moves[M_S1];
      const s2 = c.moves[M_S2];
      if (f.bufS1 && s1.cancelFrom & bit && this.canAfford(f, s1)) {
        this.startMove(i, M_S1, w, true);
        return true;
      }
      if (f.bufS2 && s2.cancelFrom & bit && this.canAfford(f, s2)) {
        this.startMove(i, M_S2, w, true);
        return true;
      }
    }
    if (!f.bufAtk) return false;
    // chain reset: skill hit → N1 (once per combo)
    if (hit && m.chainReset && !f.chainResetUsed && this.inWin(m.chainReset, mf)) {
      f.chainResetUsed = 1;
      this.startMove(i, M_N1, w, true);
      return true;
    }
    if (m.next >= 0) {
      if ((hit && this.inWin(m.chainHit, mf)) || (blocked && this.inWin(m.chainBlock, mf))) {
        this.startMove(i, m.next, w, true);
        return true;
      }
    }
    return false;
  }

  /** Per-frame behaviour of the current move: lunge, homing, heal. */
  private attackFrame(i: number): void {
    const f = this.s.f[i];
    const m = this.moveOf(f)!;
    const mf = f.sf;
    if (mf < m.S && mf <= SYSTEM.homingFrames && m.hasHitbox) {
      f.facing = turnToward(f.facing, this.angleTo(i), HOMING_STEP);
    }
    const lunge = mf < m.lungeAt.length ? m.lungeAt[mf] : 0;
    if (lunge > 0 && f.moveHit === MH_NONE) {
      f.x += offX(f.facing, lunge);
      f.y += offY(f.facing, lunge);
    }
    if (m.heal && mf === m.heal.frame) {
      const c = COMPILED[f.char];
      f.hp = Math.min(c.hp, f.hp + m.heal.hp);
      f.buff = m.heal.buffFrames;
      this.emit(EV_HEAL, i, m.heal.hp, 0, f.x, f.y);
    }
  }

  // ───────────────────────────── bodies ─────────────────────────────

  private resolveBodies(): void {
    const [a, b] = this.s.f;
    const solid = (f: FighterState) => f.st !== ST_DOWN && f.st !== ST_KO;
    if (solid(a) && solid(b)) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      const min = BODY_R * 2;
      if (d2 < min * min) {
        const d = isqrt(d2);
        const push = min - d;
        let nx: number;
        let ny: number;
        if (d === 0) {
          nx = 1000;
          ny = 0;
        } else {
          nx = idiv(dx * 1000, d);
          ny = idiv(dy * 1000, d);
        }
        const ha = idiv(push, 2);
        const hb = push - ha;
        a.x -= idiv(nx * ha, 1000);
        a.y -= idiv(ny * ha, 1000);
        b.x += idiv(nx * hb, 1000);
        b.y += idiv(ny * hb, 1000);
      }
    }
    for (const f of this.s.f) {
      f.x = clamp(f.x, BODY_R, FIELD_W - BODY_R);
      f.y = clamp(f.y, BODY_R, FIELD_H - BODY_R);
    }
  }

  // ───────────────────────────── contact ─────────────────────────────

  /** Current hitbox tip of an attacking fighter, or null. */
  hitboxOf(f: FighterState): { x: number; y: number } | null {
    if (f.st !== ST_ATTACK) return null;
    const m = this.moveOf(f)!;
    if (!m.hasHitbox || f.sf < m.S || f.sf >= m.S + m.A) return null;
    return { x: f.x + offX(f.facing, m.reach), y: f.y + offY(f.facing, m.reach) };
  }

  isGuarding(f: FighterState): boolean {
    return (f.st === ST_FREE && f.guardF >= SYSTEM.guard.startup) || f.st === ST_BLOCKSTUN;
  }

  private detectHits(): void {
    const s = this.s;
    const touching = [false, false];
    for (let i = 0; i < 2; i++) {
      const a = s.f[i];
      const d = s.f[1 - i];
      if (a.st !== ST_ATTACK || a.moveHit !== MH_NONE) continue;
      const m = this.moveOf(a)!;
      if (!m.hasHitbox || a.sf < m.S || a.sf >= m.S + m.A) continue;
      if (d.st === ST_KO || d.st === ST_WAKE) continue;
      if (d.st === ST_DOWN && !(m.otg && !a.otgUsed && d.downAge <= SYSTEM.down.otgWindow)) continue;
      const tx = a.x + offX(a.facing, m.reach);
      const ty = a.y + offY(a.facing, m.reach);
      if (segPointDist2(a.x, a.y, tx, ty, d.x, d.y) <= HURT_R2) touching[i] = true;
    }
    if (!touching[0] && !touching[1]) return;
    // Classify both contacts against the pre-contact state, then apply (trades are symmetric).
    const kinds = [0, 0];
    const moves = [this.moveOf(s.f[0]), this.moveOf(s.f[1])];
    for (let i = 0; i < 2; i++) if (touching[i]) kinds[i] = this.classify(i);
    for (let i = 0; i < 2; i++) if (touching[i]) this.applyContact(i, kinds[i], moves[i]!, moves[1 - i]);
  }

  private classify(i: number): number {
    const a = this.s.f[i];
    const d = this.s.f[1 - i];
    const m = this.moveOf(a)!;
    const dm = this.moveOf(d);
    if (d.st === ST_STEP && d.sf <= SYSTEM.step.justFrames) return C_JUST;
    if (d.st === ST_ATTACK && dm?.cs && !d.csHit && d.sf >= dm.cs.from && d.sf <= dm.cs.to) {
      if (m.gb) return C_CRUSH;
      if (m.shape === SH.circle) return C_RIPOSTE;
    }
    if (this.isGuarding(d)) return m.gb ? C_CRUSH : C_BLOCK;
    if (m.gb) return C_GB_OPEN;
    return C_HIT;
  }

  private applyContact(i: number, kind: number, m: CMove, dm: CMove | null): void {
    const s = this.s;
    const a = s.f[i];
    const d = s.f[1 - i];
    const ex = idiv(a.x + d.x, 2);
    const ey = idiv(a.y + d.y, 2);
    const away = atan2A(d.y - a.y, d.x - a.x);

    switch (kind) {
      case C_JUST: {
        a.moveHit = MH_SPENT;
        d.justWin = SYSTEM.just.window;
        d.statJust++;
        s.freeze = Math.max(s.freeze, SYSTEM.just.freeze);
        this.emit(EV_JUST, 1 - i, 0, 0, d.x, d.y);
        return;
      }
      case C_RIPOSTE: {
        const cs = dm!.cs!;
        a.moveHit = MH_SPENT;
        d.csHit = 1;
        d.facing = (away + ANG / 2) & (ANG - 1);
        const dmg = this.damage(d, a, cs.dmg, false);
        this.knockDown(a, (away + ANG / 2) & (ANG - 1));
        d.st = ST_ATTACK;
        d.sf = 1;
        d.move = M_STRIKE;
        d.moveHit = MH_HIT;
        s.hitstop = Math.max(s.hitstop, dm!.hitstop);
        this.emit(EV_RIPOSTE, 1 - i, dmg, 0, ex, ey);
        return;
      }
      case C_BLOCK: {
        a.moveHit = MH_BLOCK;
        a.moveHitAt = a.sf;
        d.st = ST_BLOCKSTUN;
        d.sf = 1;
        d.len = m.blockstun;
        d.noGc = m.kind === KIND_GC ? 1 : 0;
        d.gcQueued = 0;
        d.move = -1;
        if (d.guardF < SYSTEM.guard.startup) d.guardF = SYSTEM.guard.startup;
        d.kbDist = m.pushback;
        d.kbAngle = away;
        d.statBlocks++;
        this.gainCost(a, m);
        s.hitstop = Math.max(s.hitstop, m.hitstop);
        this.emit(EV_BLOCK, i, m.idx, 0, ex, ey);
        return;
      }
      case C_CRUSH: {
        a.moveHit = MH_HIT;
        a.moveHitAt = a.sf;
        const dmg = this.damage(a, d, m.gb!.dmgGuard, false);
        d.st = ST_STUN;
        d.sf = 1;
        d.len = m.gb!.crush;
        d.move = -1;
        d.guardF = 0;
        d.gcQueued = 0;
        a.statCrush++;
        s.hitstop = Math.max(s.hitstop, SYSTEM.crushHitstop);
        this.emit(EV_CRUSH, i, dmg, 0, d.x, d.y);
        return;
      }
      case C_GB_OPEN: {
        a.moveHit = MH_SPENT;
        const dmg = this.damage(a, d, m.gb!.dmgOpen, false);
        s.hitstop = Math.max(s.hitstop, SYSTEM.guardBreakOpenHitstop);
        this.emit(EV_GB_OPEN, i, dmg, 0, ex, ey);
        return;
      }
      case C_HIT: {
        a.moveHit = MH_HIT;
        a.moveHitAt = a.sf;
        const counter = d.st === ST_ATTACK && d.moveHit === MH_NONE && !!dm && d.sf < dm.S && dm.idx !== M_STRIKE;
        const otg = d.st === ST_DOWN;
        let flags = 0;
        if (counter) flags |= HF_COUNTER;
        if (a.jaChain) flags |= HF_JA;
        const forced = d.comboFrames > SYSTEM.comboForceDownFrames;
        const dmg = this.damage(a, d, m.dmg, counter);
        if (otg) {
          a.otgUsed = 1;
          flags |= HF_OTG;
          d.kbDist = u(0.4);
          d.kbAngle = away;
        } else if (m.knockdown || forced) {
          flags |= HF_KNOCKDOWN;
          if (forced) flags |= HF_FORCED_DOWN;
          this.knockDown(d, away);
        } else {
          d.st = ST_HITSTUN;
          d.sf = 1;
          d.len = m.hitstun + (counter ? SYSTEM.counterHit.stunBonus : 0);
          d.move = -1;
          d.guardF = 0;
          d.gcQueued = 0;
          d.kbDist = m.knockback;
          d.kbAngle = away;
        }
        this.gainCost(a, m);
        s.hitstop = Math.max(s.hitstop, m.hitstop);
        this.emit(EV_HIT, i, dmg, flags | (d.comboHits << 8), ex, ey);
        return;
      }
    }
  }

  private knockDown(d: FighterState, angle: number): void {
    d.st = ST_DOWN;
    d.sf = 1;
    d.len = SYSTEM.down.lying;
    d.downAge = 0;
    d.move = -1;
    d.guardF = 0;
    d.gcQueued = 0;
    d.kbDist = LAUNCH;
    d.kbAngle = angle;
    const who = this.s.f[0] === d ? 0 : 1;
    this.emit(EV_KNOCKDOWN, who, 0, 0, d.x, d.y);
  }

  /** Applies damage with JA / counter multipliers and combo scaling. Returns damage dealt. */
  private damage(a: FighterState, d: FighterState, base: number, counter: boolean): number {
    const sc = SYSTEM.scaling;
    const scale = sc[Math.min(d.comboHits, sc.length - 1)];
    const ja = a.jaChain ? Math.round(SYSTEM.just.mul * 100) : 100;
    const ctr = counter ? Math.round(SYSTEM.counterHit.dmgMul * 100) : 100;
    const dmg = idiv(base * ja * ctr * scale, 1000000);
    d.comboHits++;
    d.comboDmg += dmg;
    if (this.s.trainingRefill) d.hp = Math.max(1, d.hp - dmg);
    else d.hp = Math.max(0, d.hp - dmg);
    a.statDmg += dmg;
    d.statHitsTaken++;
    if (d.comboHits > a.statMaxCombo) a.statMaxCombo = d.comboHits;
    return dmg;
  }

  private gainCost(a: FighterState, m: CMove): void {
    if (m.kind !== KIND_NORMAL && m.kind !== KIND_GC && m.kind !== KIND_JA) return;
    const g = Math.min(COST_GAIN, COST_COMBO_CAP - a.comboGain);
    if (g <= 0) return;
    a.comboGain += g;
    a.cost = Math.min(COST_MAX, a.cost + g);
  }

  // ───────────────────────────── per-frame bookkeeping ─────────────────────────────

  private updateGauges(): void {
    const s = this.s;
    const [a, b] = s.f;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const far = dx * dx + dy * dy >= FAR_D2;
    for (let i = 0; i < 2; i++) {
      const f = s.f[i];
      const c = COMPILED[f.char];
      const guarding = (f.st === ST_FREE && f.guardF >= 1) || f.st === ST_BLOCKSTUN;
      if (guarding) {
        f.guardIdle = 0;
        if (!f.infGuard) f.guardQ -= far ? 1 : 4;
        if (f.guardQ <= 0) {
          f.guardQ = idiv(c.guardMaxQ * Math.round(SYSTEM.guard.breakRefill * 100), 100);
          f.st = ST_STUN;
          f.sf = 1;
          f.len = SYSTEM.guard.breakStun;
          f.guardF = 0;
          f.gcQueued = 0;
          f.move = -1;
          s.hitstop = Math.max(s.hitstop, SYSTEM.crushHitstop);
          this.emit(EV_GUARD_BREAK, i, 0, 0, f.x, f.y);
        }
      } else {
        f.guardIdle++;
        if (f.guardIdle > SYSTEM.guard.regenDelay && f.guardQ < c.guardMaxQ) {
          f.guardQ = Math.min(c.guardMaxQ, f.guardQ + 2);
        }
      }
      // steps regenerate one at a time
      if (f.steps < SYSTEM.step.maxStock && f.st !== ST_STEP) {
        f.stepTimer++;
        let regen = c.stepRegen;
        if (f.buff > 0) {
          const heal = this.healSpec(f);
          if (heal) regen = idiv(regen, heal.stepRegenMul);
        }
        if (f.stepTimer >= regen) {
          f.steps++;
          f.stepTimer = 0;
        }
      }
    }
  }

  private updateCombos(): void {
    const s = this.s;
    for (let i = 0; i < 2; i++) {
      const d = s.f[i];
      const a = s.f[1 - i];
      const inCombo = d.st === ST_HITSTUN || d.st === ST_STUN || d.st === ST_DOWN || d.st === ST_KO;
      const inPressure = inCombo || d.st === ST_BLOCKSTUN;
      if (d.comboHits > 0 && inCombo) d.comboFrames++;
      if (!inPressure) {
        if (d.comboHits > 0 && s.trainingRefill) {
          d.hp = COMPILED[d.char].hp;
        }
        d.comboHits = 0;
        d.comboFrames = 0;
        d.comboDmg = 0;
        a.comboGain = 0;
        a.chainResetUsed = 0;
        a.otgUsed = 0;
      }
      if (s.trainingRefill && a.infCost) a.cost = COST_MAX;
    }
  }

  private checkKo(): void {
    const s = this.s;
    if (s.trainingRefill) return;
    const ko0 = s.f[0].hp <= 0;
    const ko1 = s.f[1].hp <= 0;
    if (!ko0 && !ko1) return;
    for (let i = 0; i < 2; i++) {
      const f = s.f[i];
      if (f.hp <= 0) {
        f.st = ST_KO;
        f.sf = 1;
        f.move = -1;
        this.emit(EV_KO, i, 0, 0, f.x, f.y);
      }
    }
    this.finishRound(ko0 && ko1 ? 2 : ko0 ? 1 : 0);
  }

  private timeUp(): void {
    const s = this.s;
    const [a, b] = s.f;
    const ca = COMPILED[a.char];
    const cb = COMPILED[b.char];
    // compare HP ratios without division
    const ra = a.hp * cb.hp;
    const rb = b.hp * ca.hp;
    this.emit(EV_TIMEUP, 0);
    this.finishRound(ra > rb ? 0 : rb > ra ? 1 : 2);
  }

  private finishRound(winner: number): void {
    const s = this.s;
    s.phase = PH_END;
    s.phaseF = 0;
    s.roundWinner = winner;
    if (winner === 0 || winner === 2) s.winsA++;
    if (winner === 1 || winner === 2) s.winsB++;
    this.emit(EV_ROUND_END, winner);
  }

  private endRound(): void {
    const s = this.s;
    const need = R.winsNeeded;
    if (s.winsA >= need || s.winsB >= need || s.round >= R.maxRounds) {
      s.phase = PH_MATCH_OVER;
      s.matchWinner = s.winsA > s.winsB ? 0 : s.winsB > s.winsA ? 1 : 2;
      this.emit(EV_MATCH_END, s.matchWinner);
      return;
    }
    s.round++;
    this.startRound(false);
  }
}

// contact classes
const C_HIT = 1;
const C_BLOCK = 2;
const C_CRUSH = 3;
const C_GB_OPEN = 4;
const C_JUST = 5;
const C_RIPOSTE = 6;

export { U };
