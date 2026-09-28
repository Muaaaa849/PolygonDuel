// Deterministic simulation: step(state, inputs) → state + events (plan §11).
// Never touches DOM, clocks, Math.random or transcendental Math functions.
import { SYSTEM } from '../data/system';
import { CHARACTERS } from '../data/characters';
import {
  compileCharacter, type CChar, type CMove,
  M_N1, M_N2, M_GC, M_JA, M_S1, M_S2, M_STRIKE, KIND_GC, KIND_JA, KIND_NORMAL, KIND_SKILL, CANCEL_NEUTRAL, CANCEL_STEP, SH, COST_UNIT,
} from './compile';
import {
  ANG, U, angDiff, atan2A, clamp, idiv, isqrt, offX, offY, segPointDist2, turnToward, u,
} from './fixed';
import {
  type FighterState, type GameState, newGameState, getShot, setShot, MAX_SHOTS,
  ST_FREE, ST_ATTACK, ST_BLOCKSTUN, ST_HITSTUN, ST_STEP, ST_DOWN, ST_WAKE, ST_STUN, ST_KO, ST_JAM,
  MH_NONE, MH_HIT, MH_BLOCK, MH_SPENT,
  PH_INTRO, PH_FIGHT, PH_END, PH_MATCH_OVER,
} from './state';
import { IN_ATK, IN_S1, IN_S2, IN_STEP, IN_STICK, IN_GUARD, aimAngle, aimLevel, aimLungePct, dirAngle } from './input';
import {
  type SimEvent,
  EV_MOVE, EV_HIT, EV_BLOCK, EV_CRUSH, EV_GUARD_BREAK, EV_GB_OPEN, EV_JUST, EV_RIPOSTE, EV_KNOCKDOWN, EV_STEP,
  EV_HEAL, EV_KO, EV_ROUND, EV_FIGHT, EV_TIMEUP, EV_ROUND_END, EV_MATCH_END, EV_WAKE, EV_GUARD, EV_WALL, EV_BLINK, EV_GHOST, EV_GHOST_END,
  EV_SHOT, EV_MODE, EV_FIELD, EV_SHOCK, EV_JAM, EV_POWER, EV_PULL,
  HF_COUNTER, HF_JA, HF_OTG, HF_KNOCKDOWN, HF_FORCED_DOWN, HF_SHOT, HF_PUNISH, HF_PULL,
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
const COST_MAX = SYSTEM.cost.max * COST_UNIT;
const COST_GAIN = Math.round(SYSTEM.cost.gainOnContact * COST_UNIT);
const COST_COMBO_CAP = Math.round(SYSTEM.cost.maxGainPerCombo * COST_UNIT);
const COST_HURT = Math.round(SYSTEM.cost.gainOnHurt * COST_UNIT);
const COST_HURT_CAP = Math.round(SYSTEM.cost.maxHurtGainPerCombo * COST_UNIT);
const ROLL_DIST = u(SYSTEM.down.rollDist);
const LAUNCH = u(SYSTEM.down.launch);
const BLINK_DIST = u(SYSTEM.just.blinkDist);
/** Cost refunded when an opponent's attack is baited into an illusion (1.0). */
const GHOST_REFUND = COST_UNIT;
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

/** Per-character floor field spec (レイのS2), or null. */
const FIELD_OF = COMPILED.map((c) => c.moves.find((m) => m.field)?.field ?? null);

export interface SimOptions {
  /** Training: no timer, refill HP after combos, no KO. */
  training?: boolean;
}

/** Control setting bits (setControlModes): manual guard (hold GUARD), attacks face the opponent while moving. */
export const CTL_MANUAL_GUARD = 1;
export const CTL_FACE_FOE = 2;

export class Sim {
  s: GameState;
  events: SimEvent[] = [];
  /** Training-mode behaviour (not part of the synced state; only used offline). */
  training: boolean;

  /** Control settings per fighter (bits: CTL_MANUAL_GUARD, CTL_FACE_FOE). Set before the match starts; part of the state. */
  setControlModes(modes: readonly [number, number]): void {
    for (let i = 0; i < 2; i++) {
      this.s.f[i].manualGuard = modes[i] & CTL_MANUAL_GUARD ? 1 : 0;
      this.s.f[i].faceFoe = modes[i] & CTL_FACE_FOE ? 1 : 0;
    }
  }

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
    s.slow = 0;
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
        x: FIELD_W / 2 + (i === 0 ? -u(2.5) : u(2.5)), y: FIELD_H / 2, facing: i === 0 ? 0 : ANG / 2,
        hp: c.hp, st: ST_FREE, sf: 0, len: 0, move: -1, moveHit: 0, moveHitAt: 0,
        guardF: 0, guardQ: c.guardMaxQ, guardIdle: 0,
        cost: SYSTEM.cost.start * COST_UNIT, comboGain: 0, hurtGain: 0,
        steps: c.stepStock, stepTimer: 0, moveDir: 0, stepChain: 0,
        bufAtk: 0, bufS1: 0, bufS2: 0, bufStep: 0, gcQueued: 0, noGc: 0, justWin: 0, jaChain: 0,
        chainResetUsed: 0, otgUsed: 0, comboHits: 0, comboFrames: 0, comboDmg: 0, downAge: 0,
        kbDist: 0, kbAngle: 0, limited: 0, buff: 0, healUses: 0, csHit: 0,
        lastDir: i === 0 ? 0 : 16,
        aimAtk: 0, aimS1: 0, aimS2: 0, aimed: 0, lungePct: 100, wallHits: 0, momStep: 0, momDir: 0,
        ghostT: 0, ghostMode: 0, shootMode: 0, justNoMul: 0, wallGuard: 0, fieldT: 0, power: 0, instLock: 0, pullUsed: 0, wakeBoost: 0, stepPct: 100,
      });
      for (let j = 0; j < MAX_SHOTS; j++) setShot(f, j, null);
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

  /** Did the fighters advance on the last step? (false during hitstop / slow-motion skip frames) */
  advanced = false;

  step(inA: number, inB: number): void {
    const s = this.s;
    s.frame++;
    this.events.length = 0;
    this.advanced = false;

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
    if (s.slow > 0) {
      // just-dodge slow motion: fighters advance every slowDiv-th frame;
      // the dodger pressing ATK ends it at once (the JA starts this very frame)
      s.slow--;
      const dz = s.f[s.slowWho];
      if (dz.bufAtk > 0 && dz.justWin > 0) s.slow = 0;
      else if (s.slow % SYSTEM.just.slowDiv !== 0) return;
    }

    this.advanced = true;
    this.updateFighter(0, ins0);
    this.updateFighter(1, ins1);
    this.resolveBodies();
    this.detectHits();
    this.updateFields();
    this.updateShots();
    this.updateGhosts();
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
    // an aimed press carries its direction + reach level with the buffered press
    const ang = aimAngle(w);
    const aim = ang >= 0 ? 1 + ang + aimLevel(w) * ANG : 0;
    if (pressed & IN_ATK) {
      f.bufAtk = B;
      f.aimAtk = aim;
      if (f.st === ST_BLOCKSTUN && !f.noGc) f.gcQueued = 1;
    }
    if (pressed & IN_S1) {
      f.bufS1 = B;
      f.aimS1 = aim;
    }
    if (pressed & IN_S2) {
      f.bufS2 = B;
      f.aimS2 = aim;
    }
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
    if (f.wakeBoost > 0) f.wakeBoost--;
    this.tryInstant(i);
    f.sf++;
    if (f.st !== ST_ATTACK) f.momStep = 0;
    if (f.st !== ST_BLOCKSTUN) f.wallGuard = 0;

    this.slide(f);

    switch (f.st) {
      case ST_FREE:
        this.freeLogic(i, w);
        break;
      case ST_ATTACK: {
        const m = this.moveOf(f)!;
        this.carry(f);
        // a normal that touched nothing recovers faster (whiffT < T)
        if (f.sf > (f.moveHit === MH_NONE ? m.whiffT : f.moveHit === MH_HIT ? m.hitT : m.T)) {
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
      case ST_JAM:
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
          // just got up: the next step (within 3 s) goes 1.5× as far (a way out of a corner)
          f.wakeBoost = SYSTEM.wakeStep.frames;
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

  /** Step momentum: an attack started out of a step keeps travelling like the step would have. */
  private carry(f: FighterState): void {
    if (f.momStep <= 0) return;
    if (f.momStep > SYSTEM.step.moveFrames || f.moveHit !== MH_NONE) {
      f.momStep = 0;
      return;
    }
    const d = idiv(STEP_TABLE[f.char][f.momStep++] * f.stepPct, 100);
    f.x += offX(f.momDir, d);
    f.y += offY(f.momDir, d);
  }

  private slide(f: FighterState): void {
    if (f.kbDist <= 0) return;
    let d = idiv(f.kbDist, 4) + 12;
    if (d > f.kbDist) d = f.kbDist;
    const left = f.kbDist;
    f.kbDist -= d;
    f.x += offX(f.kbAngle, d);
    f.y += offY(f.kbAngle, d);
    // knocked into the arena edge by a hit → wall impact
    const lo = BODY_R;
    const hx = FIELD_W - BODY_R;
    const hy = FIELD_H - BODY_R;
    const side = f.x < lo ? 0 : f.x > hx ? 1 : f.y < lo ? 2 : f.y > hy ? 3 : -1;
    if (side >= 0) this.wallImpact(f, side, left);
  }

  private wallImpact(f: FighterState, side: number, speed: number): void {
    const s = this.s;
    const hurt = f.st === ST_HITSTUN || f.st === ST_DOWN || f.st === ST_STUN;
    f.x = clamp(f.x, BODY_R, FIELD_W - BODY_R);
    f.y = clamp(f.y, BODY_R, FIELD_H - BODY_R);
    if (f.st === ST_BLOCKSTUN && f.wallGuard) {
      // a bullet / blast guarded into the wall: flat damage, apart from the combo's wall limit;
      // the slide stops here, so the next bullet slams again
      f.wallGuard = 0;
      f.kbDist = 0;
      const who = s.f[0] === f ? 0 : 1;
      const dmg = this.rawDamage(s.f[1 - who], f, GUARD_WALL_DMG);
      s.hitstop = Math.max(s.hitstop, SYSTEM.wall.hitstop);
      const px = side === 0 ? 0 : side === 1 ? FIELD_W : f.x;
      const py = side === 2 ? 0 : side === 3 ? FIELD_H : f.y;
      this.emit(EV_WALL, who, dmg, side | 4, px, py);
      return;
    }
    if (!hurt || f.wallHits >= SYSTEM.wall.perCombo) return;
    f.kbDist = 0;
    f.wallHits++;
    const W = SYSTEM.wall;
    // faster impacts (more knockback left) hurt more
    const bonus = idiv(W.bonus * Math.min(speed, LAUNCH), LAUNCH);
    const sc = SYSTEM.scaling;
    const dmg = idiv((W.dmg + bonus) * sc[Math.min(f.comboHits, sc.length - 1)], 100);
    const who = s.f[0] === f ? 0 : 1;
    const a = s.f[1 - who];
    f.hp = s.trainingRefill ? Math.max(1, f.hp - dmg) : Math.max(0, f.hp - dmg);
    this.losePower(f, dmg);
    f.comboDmg += dmg;
    a.statDmg += dmg;
    s.hitstop = Math.max(s.hitstop, W.hitstop);
    const px = side === 0 ? 0 : side === 1 ? FIELD_W : f.x;
    const py = side === 2 ? 0 : side === 3 ? FIELD_H : f.y;
    this.emit(EV_WALL, who, dmg, side, px, py);
  }

  private wakeRoll(f: FighterState): void {
    if (f.moveDir < 0 || f.sf > 12) return;
    const d = idiv(ROLL_DIST, 12);
    f.x += offX(f.moveDir, d);
    f.y += offY(f.moveDir, d);
  }

  private canAfford(f: FighterState, m: CMove): boolean {
    if (m.ghost && f.ghostT > 0) return false;
    if (m.powerUp && f.power > 0) return false;
    if (!f.infCost && f.cost < m.cost) return false;
    if (m.usesPerRound > 0 && f.healUses >= m.usesPerRound) return false;
    return true;
  }

  /**
   * The move a skill button actually starts. Shooters (レイ): S1 turns the shooting mode on,
   * off while it is on, and out of N2 it is the switch blast. Everyone else: the slot itself.
   */
  skillSlot(f: FighterState, slot: number, from = -1): number {
    const sh = COMPILED[f.char].shooter;
    if (!sh || slot !== M_S1) return slot;
    if (from === M_N2) return sh.blast;
    return f.shootMode ? sh.off : slot;
  }

  /** The move S2 starts now (UI): skills[1], or `s2Neutral` unless the current move can cancel into skills[1]. */
  s2Slot(f: FighterState): number {
    const c = COMPILED[f.char];
    if (c.s2Neutral < 0) return M_S2;
    return f.st === ST_ATTACK && f.move >= 0 && c.moves[M_S2].cancelFrom & (1 << f.move) ? M_S2 : c.s2Neutral;
  }

  /** The move ATK starts from neutral / a step: N1, or the 1st shot in shooting mode. */
  atkSlot(f: FighterState): number {
    const sh = COMPILED[f.char].shooter;
    return sh && f.shootMode ? sh.shots[0] : M_N1;
  }

  /**
   * Instant (0F) skills: レイのモード切替 and ヴォルトのオーバーチャージ take effect the frame the
   * button is pressed, whatever the fighter is doing (attacking, stepping, guarding, in guard
   * stun…; not while being hit / downed), without interrupting it. A press that the current move
   * can still cancel into its skill (N2 → blast, dash → turnback) is left for that. After one
   * goes off the buttons are ignored for SYSTEM.instantLock frames, so a double tap never pays twice.
   */
  private tryInstant(i: number): void {
    const f = this.s.f[i];
    if (f.instLock > 0) f.instLock--;
    if (!f.bufS1 && !f.bufS2) return;
    const st = f.st;
    if (st !== ST_FREE && st !== ST_ATTACK && st !== ST_STEP && st !== ST_BLOCKSTUN && st !== ST_JAM && st !== ST_WAKE) return;
    const c = COMPILED[f.char];
    // the current move can still cancel into this button's skill → leave the press to it
    const reserved = (slot: number) => {
      if (st !== ST_ATTACK || f.move < 0 || !(c.moves[slot].cancelFrom & (1 << f.move))) return false;
      const cm = c.moves[f.move];
      const end = Math.max(cm.cancel ? cm.cancel.b : 0, cm.cancelAny ? cm.cancelAny.b : 0);
      return f.sf <= end;
    };
    if (f.bufS1) {
      const slot = this.skillSlot(f, M_S1);
      if (c.moves[slot].instant && !(c.shooter && reserved(M_S1))) {
        f.bufS1 = f.aimS1 = 0;
        if (f.instLock === 0) this.useInstant(i, slot);
      }
    }
    if (f.bufS2) {
      const slot = c.s2Neutral >= 0 ? c.s2Neutral : M_S2;
      if (c.moves[slot].instant && !reserved(M_S2)) {
        f.bufS2 = f.aimS2 = 0;
        if (f.instLock === 0) this.useInstant(i, slot);
      }
    }
  }

  private useInstant(i: number, slot: number): void {
    const f = this.s.f[i];
    const m = COMPILED[f.char].moves[slot];
    if (!this.canAfford(f, m)) return;
    if (!f.infCost) f.cost -= m.cost;
    f.instLock = SYSTEM.instantLock;
    if (m.mode >= 0 && m.mode !== f.shootMode) {
      f.shootMode = m.mode;
      this.emit(EV_MODE, i, m.mode, 0, f.x, f.y);
    }
    if (m.powerUp) {
      f.power = m.powerUp.pct;
      this.emit(EV_POWER, i, 1, 0, f.x, f.y);
    }
  }

  /** Skill press out of neutral (`from` mask: CANCEL_NEUTRAL, or | CANCEL_STEP in a step). */
  private freeSkill(f: FighterState, mask: number): number {
    const c = COMPILED[f.char];
    // (instant skills never start as moves: tryInstant handles those presses)
    if (f.bufS1 && c.moves[M_S1].cancelFrom & mask) {
      const r = this.skillSlot(f, M_S1);
      if (!c.moves[r].instant && this.canAfford(f, c.moves[r])) return r;
    }
    if (f.bufS2) {
      const s2 = c.s2Neutral >= 0 ? c.s2Neutral : M_S2;
      if (!c.moves[s2].instant && c.moves[s2].cancelFrom & mask && this.canAfford(f, c.moves[s2])) return s2;
    }
    return -1;
  }

  private freeLogic(i: number, w: number): void {
    const f = this.s.f[i];
    const c = COMPILED[f.char];
    if (f.limited > 0) {
      f.limited--;
    } else {
      if (f.justWin > 0 && f.bufAtk) return this.startMove(i, M_JA, w);
      const sk = this.freeSkill(f, CANCEL_NEUTRAL);
      if (sk >= 0) return this.startMove(i, sk, w);
      if (f.bufAtk) return this.startMove(i, this.atkSlot(f), w);
      if (f.bufStep && f.steps > 0) return this.startStep(i, w);
    }
    // guard: auto = stick released; manual = only while GUARD is held (it wins over the stick)
    const guardIn = f.manualGuard ? (w & IN_GUARD) !== 0 : (w & IN_STICK) === 0;
    if (!guardIn && w & IN_STICK) {
      // walk
      const a = dirAngle(w);
      f.facing = a;
      let sp = f.shootMode && c.shooter ? c.shooter.walk : c.walk;
      if (f.buff > 0) {
        const heal = this.healSpec(f);
        if (heal) sp = idiv(sp * (100 + heal.walkPct), 100);
      }
      f.x += offX(a, sp);
      f.y += offY(a, sp);
      if (f.guardF > 0) f.guardF = 0;
    } else if (!guardIn) {
      // manual guard, stick released, no GUARD: just standing (square, not guarding)
      f.guardF = 0;
    } else {
      // guarding (hexagon)
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
    if (f.steps === COMPILED[f.char].stepStock) f.stepTimer = 0;
    f.steps--;
    // after getting up: this one step goes further, and uses the bonus up
    f.stepPct = f.wakeBoost > 0 ? SYSTEM.wakeStep.pct : 100;
    f.wakeBoost = 0;
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
    const d = idiv(STEP_TABLE[f.char][f.sf] * f.stepPct, 100);
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
      let mi = this.freeSkill(f, CANCEL_NEUTRAL | CANCEL_STEP);
      if (mi < 0 && f.bufAtk) mi = this.atkSlot(f);
      if (mi >= 0) {
        // seamless: this frame's step travel still happens, the rest rides on the attack
        // (not on bullets / dashes: they have their own travel)
        this.stepMove(f);
        const next = f.sf + 1;
        const dir = f.moveDir;
        this.startMove(i, mi, w);
        const m = c.moves[mi];
        if (!m.proj && !m.dash) {
          f.momStep = next;
          f.momDir = dir;
        }
        return;
      }
    }
    this.stepMove(f);
  }

  private startMove(i: number, mi: number, w: number, chained = false): void {
    const f = this.s.f[i];
    const c = COMPILED[f.char];
    const m = c.moves[mi];
    if (mi === M_JA) {
      f.justWin = 0;
      // a bullet just gives the blink + a guaranteed combo, but no ×1.5
      f.jaChain = f.justNoMul ? 0 : 1;
      f.justNoMul = 0;
      // blink: reappear right in front of the opponent (on our side) so the JA always connects
      const o = this.s.f[1 - i];
      const back = atan2A(f.y - o.y, f.x - o.x);
      const ox = f.x;
      const oy = f.y;
      f.x = clamp(o.x + offX(back, BLINK_DIST), BODY_R, FIELD_W - BODY_R);
      f.y = clamp(o.y + offY(back, BLINK_DIST), BODY_R, FIELD_H - BODY_R);
      f.kbDist = 0;
      this.emit(EV_BLINK, i, ox, oy, f.x, f.y);
    } else if (m.kind === KIND_SKILL || m.kind === KIND_GC || (m.kind === KIND_NORMAL && !chained)) {
      f.jaChain = 0;
    }
    if (m.kind === KIND_SKILL && mi !== M_STRIKE) {
      if (!f.infCost) f.cost -= m.cost;
      if (m.usesPerRound > 0) f.healUses++;
    }
    // which button started it (shots = ATK; mode off / blast = S1)
    const sh = c.shooter;
    const btn = mi === M_N1 || mi === M_JA || m.proj ? 1 : mi === M_S1 || (sh && (mi === sh.off || mi === sh.blast)) ? 2 : mi === M_S2 || mi === c.s2Neutral ? 3 : 0;
    const aim = btn === 1 ? f.aimAtk : btn === 2 ? f.aimS1 : btn === 3 ? f.aimS2 : 0;
    if (btn === 1) f.bufAtk = f.aimAtk = 0;
    else if (btn === 2) f.bufS1 = f.aimS1 = 0;
    else if (btn === 3) f.bufS2 = f.aimS2 = 0;
    else if (chained) f.bufAtk = f.aimAtk = 0;
    f.st = ST_ATTACK;
    f.sf = 1;
    f.move = mi;
    f.momStep = 0;
    f.moveHit = MH_NONE;
    f.moveHitAt = 0;
    f.csHit = 0;
    f.guardF = 0;
    // Direction: auto-aim moves (GC/JA) face the opponent; an aimed press goes exactly
    // where it was aimed (fresh attacks and skills, also skill cancels) with no homing
    // and its reach level scaling the lunge; chained moves keep facing; other fresh
    // attacks go where the stick points (at the opponent with the faceFoe setting), or at the opponent (plan §4).
    f.aimed = 0;
    f.lungePct = 100;
    // (a dash chained out of a dash turns back toward the one it just passed)
    if (m.autoAim || (m.dash && chained)) f.facing = this.angleTo(i);
    else if (m.proj) {
      // every shot re-aims: where it was aimed, or at the opponent
      if (aim) {
        f.facing = (aim - 1) & (ANG - 1);
        f.aimed = 1;
      } else f.facing = this.angleTo(i);
    } else if (aim && (!chained || m.kind === KIND_SKILL)) {
      f.facing = (aim - 1) & (ANG - 1);
      f.aimed = 1;
      f.lungePct = aimLungePct((aim - 1) >> 10);
    } else if (!chained) f.facing = w & IN_STICK && !f.faceFoe ? dirAngle(w) : this.angleTo(i);
    this.emit(EV_MOVE, i, mi, 0, f.x, f.y);
    if (m.mode >= 0 && m.mode !== f.shootMode) {
      f.shootMode = m.mode;
      this.emit(EV_MODE, i, m.mode, 0, f.x, f.y);
    }
    if (m.ghost) this.startGhost(i, m);
    this.attackFrame(i);
  }

  // ───────────────────────────── illusion (ghost) ─────────────────────────────

  private startGhost(i: number, m: CMove): void {
    const f = this.s.f[i];
    const o = this.s.f[1 - i];
    const g = m.ghost!;
    const n1 = COMPILED[f.char].moves[M_N1];
    const face = this.angleTo(i);
    const dx = o.x - f.x;
    const dy = o.y - f.y;
    const d = isqrt(dx * dx + dy * dy);
    f.ghostT = 1;
    f.ghostFace = face;
    f.ghostX = f.ghostSx = f.x;
    f.ghostY = f.ghostSy = f.y;
    if (d <= n1.reach + n1.lunge + HURT_R) {
      // in range: the decoy swings N1 on the spot
      f.ghostMode = 2;
      f.ghostAtk = 1;
      f.ghostTx = f.x;
      f.ghostTy = f.y;
    } else {
      // out of range: the decoy steps in, then starts a swing and vanishes before it lands
      f.ghostMode = 1;
      const travel = Math.max(0, d - g.stopDist);
      f.ghostTx = clamp(f.x + offX(face, travel), BODY_R, FIELD_W - BODY_R);
      f.ghostTy = clamp(f.y + offY(face, travel), BODY_R, FIELD_H - BODY_R);
      f.ghostAtk = g.approach + 1;
    }
    this.emit(EV_GHOST, i, f.ghostMode, 0, f.x, f.y);
  }

  /** Decoy lifetime in frames for its mode. */
  private ghostLife(f: FighterState): number {
    const n1 = COMPILED[f.char].moves[M_N1];
    const g = COMPILED[f.char].moves.find((m) => m.ghost)?.ghost;
    // fake swing: until the blade has passed through (S + A); step-in: fixed length
    return f.ghostMode === 2 ? n1.S + n1.A : (g?.frames ?? 30);
  }

  /**
   * The decoy as a fighter-like state (for rendering and for what the opponent — and
   * the CPU — perceive), or null when there is none. Pure: not part of the state.
   */
  decoyOf(i: number): FighterState | null {
    const f = this.s.f[i];
    if (f.ghostT <= 0) return null;
    const fsf = f.ghostT - f.ghostAtk + 1;
    const attacking = fsf >= 1;
    return {
      ...f,
      x: f.ghostX,
      y: f.ghostY,
      facing: f.ghostFace,
      moveDir: f.ghostFace,
      st: attacking ? ST_ATTACK : ST_STEP,
      sf: attacking ? fsf : f.ghostT,
      move: attacking ? M_N1 : -1,
      moveHit: MH_NONE,
      guardF: 0,
      kbDist: 0,
    };
  }

  private updateGhosts(): void {
    for (let i = 0; i < 2; i++) {
      const f = this.s.f[i];
      if (f.ghostT <= 0) continue;
      const o = this.s.f[1 - i];
      // the real one revealing itself ends the illusion
      const acting = (f.st === ST_ATTACK && !this.moveOf(f)?.ghost) || f.st === ST_STEP;
      const hurt = f.st === ST_HITSTUN || f.st === ST_STUN || f.st === ST_DOWN || f.st === ST_BLOCKSTUN || f.st === ST_KO;
      if (acting || hurt || this.s.phase !== PH_FIGHT) {
        this.endGhost(i, 1);
        continue;
      }
      // an attack touching the decoy passes through it and dissolves it
      if (o.st === ST_ATTACK) {
        const m = this.moveOf(o);
        if (m && m.hasHitbox && o.sf >= m.S && o.sf < m.S + m.A && this.touches(o, this.decoyOf(i)!, m)) {
          this.endGhost(i, 2);
          continue;
        }
      }
      f.ghostT++;
      if (f.ghostMode === 1) {
        // step-in with an ease-out, like a real step
        const n = COMPILED[f.char].moves.find((m) => m.ghost)?.ghost?.approach ?? 18;
        const k = Math.min(f.ghostT, n);
        const e = n * n - (n - k) * (n - k);
        f.ghostX = f.ghostSx + idiv((f.ghostTx - f.ghostSx) * e, n * n);
        f.ghostY = f.ghostSy + idiv((f.ghostTy - f.ghostSy) * e, n * n);
        f.ghostFace = atan2A(o.y - f.ghostY, o.x - f.ghostX);
      }
      if (f.ghostT > this.ghostLife(f)) this.endGhost(i, 0);
    }
  }

  private endGhost(i: number, reason: number): void {
    const f = this.s.f[i];
    if (f.ghostT <= 0) return;
    // baited: the opponent swung at the decoy → half the illusion's cost comes back
    if (reason === 2) f.cost = Math.min(COST_MAX, f.cost + GHOST_REFUND);
    this.emit(EV_GHOST_END, i, reason, f.ghostMode, f.ghostX, f.ghostY);
    f.ghostT = 0;
    f.ghostMode = 0;
  }

  // ───────────────────────────── bullets / fields ─────────────────────────────

  /** Fires the move's bullet from the muzzle (a free slot; the oldest bullet is replaced if full). */
  private fire(i: number, m: CMove): void {
    const f = this.s.f[i];
    const c = COMPILED[f.char];
    const p = m.proj!;
    let slot = -1;
    let oldest = 1 << 30;
    for (let j = 0; j < MAX_SHOTS; j++) {
      const sh = getShot(f, j);
      if (!sh) {
        slot = j;
        break;
      }
      if (sh.r < oldest) {
        oldest = sh.r;
        slot = j;
      }
    }
    const n = c.shooter ? c.shooter.shots.indexOf(m.idx) + 1 : 1;
    const x = f.x + offX(f.facing, MUZZLE);
    const y = f.y + offY(f.facing, MUZZLE);
    setShot(f, slot, { n: Math.max(1, n), x, y, a: f.facing, r: p.range });
    this.emit(EV_SHOT, i, n, f.facing, x, y);
  }

  private shotSpec(f: FighterState, n: number): NonNullable<CMove['proj']> {
    const c = COMPILED[f.char];
    return c.moves[c.shooter ? c.shooter.shots[n - 1] : c.projSlot].proj!;
  }

  private clearShots(f: FighterState): void {
    for (let j = 0; j < MAX_SHOTS; j++) setShot(f, j, null);
  }

  /**
   * Moves bullets and resolves their contact (swept segment vs the hurt circle, no tunnelling):
   * a step still travelling (1–10F) = bullet just; a dash = punish; guard = slide (walls hurt);
   * otherwise a small flat hit.
   */
  private updateShots(): void {
    const s = this.s;
    const HR = HURT_R;
    for (let i = 0; i < 2; i++) {
      const f = s.f[i];
      if (!f.sh0n && !f.sh1n && !f.sh2n) continue;
      const o = s.f[1 - i];
      for (let j = 0; j < MAX_SHOTS; j++) {
        const sh = getShot(f, j);
        if (!sh) continue;
        const p = this.shotSpec(f, sh.n);
        const d = Math.min(p.speed, sh.r);
        const nx = sh.x + offX(sh.a, d);
        const ny = sh.y + offY(sh.a, d);
        const reach = HR + p.radius;
        const open = o.st !== ST_KO && o.st !== ST_DOWN && o.st !== ST_WAKE;
        // a decoy the bullet passes through dissolves (baited)
        if (o.ghostT > 0) {
          const g = this.decoyOf(1 - i)!;
          if (segPointDist2(sh.x, sh.y, nx, ny, g.x, g.y) <= reach * reach) this.endGhost(1 - i, 2);
        }
        if (open && segPointDist2(sh.x, sh.y, nx, ny, o.x, o.y) <= reach * reach) {
          setShot(f, j, null);
          if (o.st === ST_STEP && o.sf <= SYSTEM.step.moveFrames && !p.pull) {
            this.bulletJust(i);
            break; // every bullet is gone
          }
          this.shotContact(i, p, sh.a, nx, ny);
          continue;
        }
        const out = nx < 0 || nx > FIELD_W || ny < 0 || ny > FIELD_H;
        if (out || sh.r - d <= 0) setShot(f, j, null);
        else setShot(f, j, { n: sh.n, x: nx, y: ny, a: sh.a, r: sh.r - d });
      }
    }
  }

  /** Stepped into a bullet: slow motion + blink JA (no ×1.5); the shooter jams, bullets vanish. */
  private bulletJust(i: number): void {
    const s = this.s;
    const f = s.f[i];
    const o = s.f[1 - i];
    o.justWin = SYSTEM.just.window;
    o.justNoMul = 1;
    o.statJust++;
    s.slow = SYSTEM.just.slow;
    s.slowWho = 1 - i;
    this.clearShots(f);
    if (f.st !== ST_KO) {
      f.st = ST_JAM;
      f.sf = 1;
      f.len = JAM_LEN;
      f.move = -1;
      f.guardF = 0;
      f.gcQueued = 0;
      f.momStep = 0;
      this.emit(EV_JAM, i, 0, 0, f.x, f.y);
    }
    this.emit(EV_JUST, 1 - i, 0, 1, o.x, o.y);
  }

  private shotContact(i: number, p: NonNullable<CMove['proj']>, ang: number, x: number, y: number): void {
    const s = this.s;
    const f = s.f[i];
    const o = s.f[1 - i];
    if (p.pull) return this.pullContact(i, p, ang, x, y);
    if (this.isDashing(o)) {
      // a bullet catches a dash too (×1.5)
      const dmg = this.rawDamage(f, o, idiv(p.dmg * Math.round(SYSTEM.just.mul * 100), 100));
      this.stagger(o, p.hitstun + SYSTEM.counterHit.stunBonus, p.hitPush, ang);
      this.gainHurtCost(o);
      this.shotCost(f, p);
      s.hitstop = Math.max(s.hitstop, SHOT_HITSTOP + PUNISH_STOP);
      this.emit(EV_HIT, i, dmg, HF_SHOT | HF_PUNISH | HF_JA, x, y);
      return;
    }
    if (this.isGuarding(o)) {
      const left = o.st === ST_BLOCKSTUN ? o.len - o.sf + 1 : 0;
      o.st = ST_BLOCKSTUN;
      o.sf = 1;
      o.len = Math.max(left, p.blockstun);
      o.gcQueued = 0;
      o.move = -1;
      if (o.guardF < SYSTEM.guard.startup) o.guardF = SYSTEM.guard.startup;
      o.kbDist = p.guardPush;
      o.kbAngle = ang;
      o.wallGuard = 1;
      o.statBlocks++;
      this.shotCost(f, p);
      s.hitstop = Math.max(s.hitstop, SHOT_BLOCKSTOP);
      this.emit(EV_BLOCK, i, -1, 1, x, y);
      // bullets chip the guard gauge instead of refilling it (pressure on a turtling guard)
      if (!o.infGuard && p.guardDrainPct > 0) {
        o.guardQ -= idiv(COMPILED[o.char].guardMaxQ * p.guardDrainPct, 100);
        if (o.guardQ <= 0) this.breakGuard(1 - i);
      }
      return;
    }
    // hit: flat damage (outside the combo scaling), a short flinch
    const dmg = this.rawDamage(f, o, p.dmg);
    if (o.st === ST_HITSTUN || o.st === ST_STUN || o.st === ST_JAM) {
      o.len = Math.max(o.len, o.sf - 1 + p.hitstun);
    } else this.stagger(o, p.hitstun, p.hitPush, ang);
    this.gainHurtCost(o);
    this.shotCost(f, p);
    s.hitstop = Math.max(s.hitstop, SHOT_HITSTOP);
    this.emit(EV_HIT, i, dmg, HF_SHOT | (o.comboHits << 8), x, y);
  }

  /**
   * Telekinetic pull (キネシスのサイコプル). Guarded (v1.5): the guard is dragged in front of the
   * caster too, but takes no damage, gets only a short guard stun (no combo follows — both are
   * just point blank) and the guard gauge is NOT refilled (unlike a blocked attack). A target
   * in a normal-attack motion (N1–N3 / GC / JA, even before its hitbox is out) turns it around:
   * the caster is caught and dragged in front of the target, who gets a free combo. Otherwise the
   * target is dragged in front of the caster and held long enough for a normal combo — once per
   * combo; after that it is only a light hit (no N1 → N2 → pull loop).
   */
  private pullContact(i: number, p: NonNullable<CMove['proj']>, ang: number, x: number, y: number): void {
    const s = this.s;
    const f = s.f[i];
    const o = s.f[1 - i];
    const pl = p.pull!;
    const dx = f.x - o.x;
    const dy = f.y - o.y;
    const dist = isqrt(dx * dx + dy * dy);
    if (this.isGuarding(o)) {
      const left = o.st === ST_BLOCKSTUN ? o.len - o.sf + 1 : 0;
      o.st = ST_BLOCKSTUN;
      o.sf = 1;
      o.len = Math.max(left, p.blockstun);
      o.gcQueued = 0;
      o.move = -1;
      if (o.guardF < SYSTEM.guard.startup) o.guardF = SYSTEM.guard.startup;
      // dragged in all the same (guard up), but nothing else: no damage, no gauge refill
      o.kbDist = Math.max(0, dist - pl.to);
      o.kbAngle = atan2A(dy, dx);
      o.wallGuard = 0;
      o.statBlocks++;
      s.hitstop = Math.max(s.hitstop, SHOT_BLOCKSTOP);
      this.emit(EV_BLOCK, i, -1, 1, x, y);
      this.emit(EV_PULL, i, 3, 0, o.x, o.y);
      return;
    }
    const om = o.st === ST_ATTACK ? this.moveOf(o) : null;
    if (om && (om.kind === KIND_NORMAL || om.kind === KIND_GC || om.kind === KIND_JA)) {
      // caught by the swing: the caster is the one dragged in
      this.stagger(f, pl.reverseStun, Math.max(0, dist - pl.to), atan2A(-dy, -dx));
      s.hitstop = Math.max(s.hitstop, SHOT_HITSTOP);
      this.emit(EV_PULL, i, 1, 0, o.x, o.y);
      return;
    }
    const dmg = this.damage(f, o, p.dmg, false);
    this.gainHurtCost(o);
    s.hitstop = Math.max(s.hitstop, SHOT_HITSTOP);
    if (!f.pullUsed) {
      f.pullUsed = 1;
      const kb = Math.max(0, dist - pl.to);
      const toward = atan2A(dy, dx);
      if (o.st === ST_STUN) {
        // (a stunned target stays stunned, only moved)
        o.kbDist = kb;
        o.kbAngle = toward;
      } else this.stagger(o, pl.stun, kb, toward);
      this.emit(EV_HIT, i, dmg, HF_SHOT | HF_PULL | (o.comboHits << 8), x, y);
      this.emit(EV_PULL, i, 0, 0, o.x, o.y);
      return;
    }
    // already pulled in this combo: a light hit that does not extend the combo
    if (o.st === ST_HITSTUN || o.st === ST_STUN || o.st === ST_JAM) o.len = Math.max(o.len, o.sf - 1 + p.hitstun);
    else this.stagger(o, p.hitstun, p.hitPush, ang);
    this.emit(EV_HIT, i, dmg, HF_SHOT | (o.comboHits << 8), x, y);
    this.emit(EV_PULL, i, 2, 0, o.x, o.y);
  }

  /** Bullets gain half a melee hit's cost (within the same per-combo cap). */
  private shotCost(f: FighterState, p: NonNullable<CMove['proj']>): void {
    const g = Math.min(p.costGain, COST_COMBO_CAP - f.comboGain);
    if (g <= 0) return;
    f.comboGain += g;
    f.cost = Math.min(COST_MAX, f.cost + g);
  }

  /** Places the move's field: at the aimed distance, or at the opponent's feet (within reach). */
  private placeField(i: number, m: CMove): void {
    const f = this.s.f[i];
    const o = this.s.f[1 - i];
    const F = m.field!;
    let x: number;
    let y: number;
    if (f.aimed) {
      const dist = idiv(F.maxDist * f.lungePct, 100);
      x = f.x + offX(f.facing, dist);
      y = f.y + offY(f.facing, dist);
    } else {
      const dx = o.x - f.x;
      const dy = o.y - f.y;
      const d = isqrt(dx * dx + dy * dy);
      if (d > F.maxDist) {
        x = f.x + idiv(dx * idiv(F.maxDist, 10), idiv(d, 10));
        y = f.y + idiv(dy * idiv(F.maxDist, 10), idiv(d, 10));
      } else {
        x = o.x;
        y = o.y;
      }
    }
    f.fieldX = clamp(x, 0, FIELD_W);
    f.fieldY = clamp(y, 0, FIELD_H);
    f.fieldT = F.frames;
    this.emit(EV_FIELD, i, F.radius, 0, f.fieldX, f.fieldY);
  }

  /** Fields tick down; the opponent stepping inside (starting or entering) is shocked. */
  private updateFields(): void {
    const s = this.s;
    for (let i = 0; i < 2; i++) {
      const f = s.f[i];
      if (f.fieldT <= 0) continue;
      f.fieldT--;
      const F = FIELD_OF[f.char];
      if (!F) continue;
      const o = s.f[1 - i];
      if (o.st !== ST_STEP || o.sf > SYSTEM.step.moveFrames) continue;
      const r2 = F.radius * F.radius;
      const dx = o.x - f.fieldX;
      const dy = o.y - f.fieldY;
      let inside = dx * dx + dy * dy <= r2;
      if (!inside && o.sf === 1) {
        // started inside (the 1st frame's travel may already have carried it out)
        const d1 = idiv(STEP_TABLE[o.char][1] * o.stepPct, 100);
        const sx = dx - offX(o.moveDir, d1);
        const sy = dy - offY(o.moveDir, d1);
        inside = sx * sx + sy * sy <= r2;
      }
      if (!inside) continue;
      const dmg = this.rawDamage(f, o, F.dmg);
      this.stagger(o, F.stun, 0, 0);
      o.justWin = 0;
      this.gainHurtCost(o);
      s.hitstop = Math.max(s.hitstop, SHOCK_HITSTOP);
      this.emit(EV_SHOCK, 1 - i, dmg, 0, o.x, o.y);
    }
  }

  private inWin(win: { a: number; b: number } | null, f: number): boolean {
    return !!win && f >= win.a && f <= win.b;
  }

  /** S1 / S2 pressed during a cancel window of the current move. */
  private trySkillCancel(i: number, w: number): boolean {
    const f = this.s.f[i];
    const c = COMPILED[f.char];
    const bit = 1 << f.move;
    if (f.bufS1 && c.moves[M_S1].cancelFrom & bit && (!c.moves[M_S1].cancelHitOnly || f.moveHit === MH_HIT)) {
      const r = this.skillSlot(f, M_S1, f.move);
      if (this.canAfford(f, c.moves[r])) {
        this.startMove(i, r, w, true);
        return true;
      }
    }
    if (f.bufS2 && c.moves[M_S2].cancelFrom & bit && this.canAfford(f, c.moves[M_S2])) {
      this.startMove(i, M_S2, w, true);
      return true;
    }
    return false;
  }

  /** Chains and cancels out of a move that made contact. */
  private tryChain(i: number, w: number): boolean {
    const f = this.s.f[i];
    const c = COMPILED[f.char];
    const m = c.moves[f.move];
    const mf = f.sf;
    const hit = f.moveHit === MH_HIT;
    const blocked = f.moveHit === MH_BLOCK;
    // contact-free chains / cancels: a shot's next shot, a dash's turnback
    if (f.bufAtk && m.next >= 0 && this.inWin(m.chainAny, mf) && (!m.proj || f.shootMode)) {
      this.startMove(i, m.next, w, true);
      return true;
    }
    if (this.inWin(m.cancelAny, mf) && this.trySkillCancel(i, w)) return true;
    if (!hit && !blocked) return false;

    // skill cancel (GC may only cancel on hit)
    if ((hit || m.kind !== KIND_GC) && this.inWin(m.cancel, mf) && this.trySkillCancel(i, w)) return true;
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
    if (mf < m.S && mf <= SYSTEM.homingFrames && m.hasHitbox && !f.aimed) {
      f.facing = turnToward(f.facing, this.angleTo(i), HOMING_STEP);
    }
    let lunge = mf < m.lungeAt.length ? m.lungeAt[mf] : 0;
    if (f.lungePct !== 100) lunge = idiv(lunge * f.lungePct, 100);
    if (lunge > 0 && f.moveHit === MH_NONE) {
      f.x += offX(f.facing, lunge);
      f.y += offY(f.facing, lunge);
    }
    // dash: fixed travel on the active frames, through the opponent (no stop on contact)
    if (m.dash && mf >= m.S && mf < m.S + m.A) {
      f.x += offX(f.facing, m.dash.per);
      f.y += offY(f.facing, m.dash.per);
    }
    if (m.proj && mf === m.proj.at) this.fire(i, m);
    if (m.field && mf === m.field.at) this.placeField(i, m);
    if (m.powerUp && mf === m.powerUp.frame) {
      f.power = m.powerUp.pct;
      this.emit(EV_POWER, i, 1, 0, f.x, f.y);
    }
    if (m.heal && mf === m.heal.frame) {
      const c = COMPILED[f.char];
      f.hp = Math.min(c.hp, f.hp + m.heal.hp);
      f.buff = m.heal.buffFrames;
      this.emit(EV_HEAL, i, m.heal.hp, 0, f.x, f.y);
    }
  }

  // ───────────────────────────── bodies ─────────────────────────────

  /** A dash in its startup or active frames (it loses to any attack touching it). */
  isDashing(f: FighterState): boolean {
    if (f.st !== ST_ATTACK) return false;
    const m = this.moveOf(f);
    return !!m?.dash && f.sf < m.S + m.A;
  }

  /** A dash on its active frames: goes through the opponent's body. */
  private dashThrough(f: FighterState): boolean {
    if (f.st !== ST_ATTACK) return false;
    const m = this.moveOf(f);
    return !!m?.dash && f.sf >= m.S && f.sf < m.S + m.A;
  }

  private resolveBodies(): void {
    const [a, b] = this.s.f;
    const solid = (f: FighterState) => f.st !== ST_DOWN && f.st !== ST_KO;
    // a dash that ends inside the opponent comes out in front of them (forward, never back)
    for (const [f, o] of [[a, b], [b, a]] as const) {
      const m = f.st === ST_ATTACK ? this.moveOf(f) : null;
      if (!m?.dash || f.sf !== m.S + m.A || !solid(o)) continue;
      const min = BODY_R * 2;
      for (let k = 0; k < 30; k++) {
        const dx = o.x - f.x;
        const dy = o.y - f.y;
        if (dx * dx + dy * dy >= min * min) break;
        f.x += offX(f.facing, 100);
        f.y += offY(f.facing, 100);
      }
    }
    if (solid(a) && solid(b) && !this.dashThrough(a) && !this.dashThrough(b)) {
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

  /**
   * Swing progress on active frame k (1..A): the 1st active frame already reaches
   * the center line, so a target straight ahead is hit on frame S exactly like a
   * thrust (plan §6 frame math is unchanged); the rest of the fan follows.
   * Returns the current swing angle relative to facing.
   */
  swingAngle(m: CMove, sf: number): number {
    const k = sf - m.S + 1;
    const span = m.sweepTo - m.sweepFrom;
    if (m.A <= 1) return m.sweepTo;
    const kk = Math.max(1, Math.min(m.A, k));
    return m.sweepFrom + idiv(span * (m.A - 1 + kk - 1), 2 * (m.A - 1));
  }

  /** Current hitbox tip (bar end) of an attacking fighter, or null. */
  hitboxOf(f: FighterState): { x: number; y: number } | null {
    if (f.st !== ST_ATTACK) return null;
    const m = this.moveOf(f)!;
    if (!m.hasHitbox || f.sf < m.S || f.sf >= m.S + m.A) return null;
    const a = m.isSweep ? (f.facing + this.swingAngle(m, f.sf)) & (ANG - 1) : f.facing;
    return { x: f.x + offX(a, m.reach), y: f.y + offY(a, m.reach) };
  }

  /** Does the move's hitbox (thrust bar or swept fan so far) touch the defender? */
  private touches(a: FighterState, d: FighterState, m: CMove): boolean {
    if (m.radial) {
      // a burst all around (キネシスのサイコバースト)
      const dx = d.x - a.x;
      const dy = d.y - a.y;
      const r = m.reach + HURT_R;
      return dx * dx + dy * dy <= r * r;
    }
    if (!m.isSweep) {
      const tx = a.x + offX(a.facing, m.reach);
      const ty = a.y + offY(a.facing, m.reach);
      return segPointDist2(a.x, a.y, tx, ty, d.x, d.y) <= HURT_R2;
    }
    const dx = d.x - a.x;
    const dy = d.y - a.y;
    const d2 = dx * dx + dy * dy;
    const maxR = m.reach + HURT_R;
    if (d2 > maxR * maxR) return false;
    if (d2 <= HURT_R2) return true;
    const cur = this.swingAngle(m, a.sf);
    const lo = Math.min(m.sweepFrom, cur);
    const hi = Math.max(m.sweepFrom, cur);
    if (hi - lo >= ANG) return true;
    // angular half-width of the hurt circle as seen from the attacker
    const half = atan2A(HURT_R, isqrt(d2 - HURT_R2));
    const rel = angDiff(a.facing, atan2A(dy, dx));
    for (const r of [rel, rel + ANG, rel - ANG]) if (r >= lo - half && r <= hi + half) return true;
    return false;
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
      if (this.touches(a, d, m)) touching[i] = true;
    }
    if (!touching[0] && !touching[1]) return;
    // A dash loses to any attack touching it (never a trade): its own contact is void and
    // the attack lands as a punish (×1.5). Two dashes into each other trade normally.
    const punish = [false, false];
    for (let i = 0; i < 2; i++) {
      punish[i] = touching[i] && this.isDashing(s.f[1 - i]) && !this.isDashing(s.f[i]);
    }
    for (let i = 0; i < 2; i++) if (punish[i]) touching[1 - i] = false;
    // Classify both contacts against the pre-contact state, then apply (trades are symmetric).
    const kinds = [0, 0];
    const moves = [this.moveOf(s.f[0]), this.moveOf(s.f[1])];
    for (let i = 0; i < 2; i++) if (touching[i]) kinds[i] = punish[i] ? C_PUNISH : this.classify(i);
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
        d.justNoMul = 0;
        d.statJust++;
        s.slow = SYSTEM.just.slow;
        s.slowWho = 1 - i;
        this.emit(EV_JUST, 1 - i, 0, 0, d.x, d.y);
        return;
      }
      case C_RIPOSTE: {
        // caught: the strike lands at once, the attacker staggers and is pulled in, and the
        // strike chains into N2 → N3 (a full combo); the riposte's cost comes back
        const cs = dm!.cs!;
        a.moveHit = MH_SPENT;
        d.csHit = 1;
        const back = (away + ANG / 2) & (ANG - 1);
        d.facing = back;
        const dmg = this.damage(d, a, cs.dmg, false);
        this.gainHurtCost(a);
        a.st = ST_HITSTUN;
        a.sf = 1;
        a.len = cs.stagger;
        a.move = -1;
        a.guardF = 0;
        a.gcQueued = 0;
        a.momStep = 0;
        const dx = a.x - d.x;
        const dy = a.y - d.y;
        const dist = isqrt(dx * dx + dy * dy);
        a.kbDist = Math.max(0, dist - cs.pull);
        a.kbAngle = away; // toward the riposting fighter
        if (!d.infCost) d.cost = Math.min(COST_MAX, d.cost + cs.refund * COST_UNIT);
        d.st = ST_ATTACK;
        d.sf = 1;
        d.move = M_STRIKE;
        d.moveHit = MH_HIT;
        d.moveHitAt = 1;
        s.hitstop = Math.max(s.hitstop, dm!.hitstop);
        this.emit(EV_RIPOSTE, 1 - i, dmg, 0, ex, ey);
        return;
      }
      case C_BLOCK: {
        a.moveHit = MH_BLOCK;
        a.moveHitAt = a.sf;
        d.st = ST_BLOCKSTUN;
        d.sf = 1;
        // a dash keeps its advantage wherever on its active frames it was guarded
        d.len = m.dash ? Math.max(1, m.T + 1 + m.dash.advBlock - a.sf) : m.blockstun;
        d.noGc = m.kind === KIND_GC ? 1 : 0;
        d.gcQueued = 0;
        d.move = -1;
        if (d.guardF < SYSTEM.guard.startup) d.guardF = SYSTEM.guard.startup;
        d.kbDist = m.pushback;
        d.kbAngle = away;
        d.wallGuard = m.wallOnGuard ? 1 : 0;
        d.statBlocks++;
        // a blocked attack refills the guard gauge: only idle guarding breaks
        if (SYSTEM.guard.refillOnBlock) d.guardQ = COMPILED[d.char].guardMaxQ;
        this.gainCost(a, m);
        s.hitstop = Math.max(s.hitstop, m.hitstop);
        this.emit(EV_BLOCK, i, m.idx, 0, ex, ey);
        return;
      }
      case C_CRUSH: {
        a.moveHit = MH_HIT;
        a.moveHitAt = a.sf;
        const dmg = this.damage(a, d, m.gb!.dmgGuard, false);
        this.gainHurtCost(d);
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
          if (m.launch > 0) {
            // a launcher picks the downed body up and throws it again (サイコバースト)
            flags |= HF_KNOCKDOWN;
            this.knockDown(d, away, m.launch);
          } else {
            d.kbDist = u(0.4);
            d.kbAngle = away;
          }
        } else if (m.knockdown || forced) {
          flags |= HF_KNOCKDOWN;
          if (forced) flags |= HF_FORCED_DOWN;
          this.knockDown(d, away, m.launch);
        } else {
          d.st = ST_HITSTUN;
          d.sf = 1;
          const base = m.dash ? Math.max(1, m.T + 1 + m.dash.advHit - a.sf) : m.hitstun;
          d.len = base + (counter ? SYSTEM.counterHit.stunBonus : 0);
          d.move = -1;
          d.guardF = 0;
          d.gcQueued = 0;
          d.kbDist = m.knockback;
          d.kbAngle = away;
        }
        this.gainCost(a, m);
        this.gainHurtCost(d);
        s.hitstop = Math.max(s.hitstop, m.hitstop);
        this.emit(EV_HIT, i, dmg, flags | (d.comboHits << 8), ex, ey);
        return;
      }
      case C_PUNISH: {
        // caught a dash: the attack lands ×1.5 (JA rules, also its chain), even a guard break
        // flinches; a short impact freeze tells "you ran into it"
        a.moveHit = MH_HIT;
        a.moveHitAt = a.sf;
        a.jaChain = 1;
        const dmg = this.damage(a, d, m.gb ? m.gb.dmgGuard : m.dmg, false);
        let flags = HF_JA | HF_PUNISH;
        if (m.knockdown) {
          flags |= HF_KNOCKDOWN;
          this.knockDown(d, away, m.launch);
        } else this.stagger(d, m.hitstun > 0 ? m.hitstun : PUNISH_STUN, m.knockback, away);
        this.gainCost(a, m);
        this.gainHurtCost(d);
        s.hitstop = Math.max(s.hitstop, m.hitstop + PUNISH_STOP);
        this.emit(EV_HIT, i, dmg, flags | (d.comboHits << 8), ex, ey);
        return;
      }
    }
  }

  /** Puts d into hit stun (interrupting whatever it was doing). */
  private stagger(d: FighterState, len: number, kb: number, angle: number): void {
    d.st = ST_HITSTUN;
    d.sf = 1;
    d.len = len;
    d.move = -1;
    d.guardF = 0;
    d.gcQueued = 0;
    d.momStep = 0;
    d.kbDist = kb;
    d.kbAngle = angle;
  }

  /** Flat damage outside the combo count / scaling (bullets, shocks, guard walls). */
  private rawDamage(a: FighterState, d: FighterState, dmg: number): number {
    d.hp = this.s.trainingRefill ? Math.max(1, d.hp - dmg) : Math.max(0, d.hp - dmg);
    this.losePower(d, dmg);
    d.comboDmg += dmg;
    a.statDmg += dmg;
    return dmg;
  }

  /** Any damage taken ends the power-up (オーバーチャージ). */
  private losePower(d: FighterState, dmg: number): void {
    if (d.power === 0 || dmg <= 0) return;
    d.power = 0;
    this.emit(EV_POWER, this.s.f[0] === d ? 0 : 1, 0, 0, d.x, d.y);
  }

  private knockDown(d: FighterState, angle: number, launch = 0): void {
    d.st = ST_DOWN;
    d.sf = 1;
    d.len = SYSTEM.down.lying;
    d.downAge = 0;
    d.move = -1;
    d.guardF = 0;
    d.gcQueued = 0;
    // (launch < 0: knocked down where it stands — キネシスの3段目)
    d.kbDist = launch < 0 ? 0 : launch > 0 ? launch : LAUNCH;
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
    // (オーバーチャージ: +power% on top; the product stays well inside 2^53)
    const dmg = idiv(base * ja * ctr * scale * (100 + a.power), 100000000);
    d.comboHits++;
    d.comboDmg += dmg;
    if (this.s.trainingRefill) d.hp = Math.max(1, d.hp - dmg);
    else d.hp = Math.max(0, d.hp - dmg);
    this.losePower(d, dmg);
    a.statDmg += dmg;
    d.statHitsTaken++;
    if (d.comboHits > a.statMaxCombo) a.statMaxCombo = d.comboHits;
    return dmg;
  }

  /** The side taking damage gains a little cost too (half of the attacker's rate). */
  private gainHurtCost(d: FighterState): void {
    const g = Math.min(COST_HURT, COST_HURT_CAP - d.hurtGain);
    if (g <= 0) return;
    d.hurtGain += g;
    d.cost = Math.min(COST_MAX, d.cost + g);
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
    // (not after the round is decided: the winner idling in guard must not "break")
    if (s.phase !== PH_FIGHT) return;
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
        if (f.guardQ <= 0) this.breakGuard(i);
      } else {
        f.guardIdle++;
        if (f.guardIdle > SYSTEM.guard.regenDelay && f.guardQ < c.guardMaxQ) {
          f.guardQ = Math.min(c.guardMaxQ, f.guardQ + 2);
        }
      }
      // steps regenerate one at a time
      if (f.steps < c.stepStock && f.st !== ST_STEP) {
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

  /** The guard gauge ran out: star stun, the gauge comes back partly. */
  private breakGuard(i: number): void {
    const s = this.s;
    const f = s.f[i];
    const c = COMPILED[f.char];
    f.guardQ = idiv(c.guardMaxQ * Math.round(SYSTEM.guard.breakRefill * 100), 100);
    f.st = ST_STUN;
    f.sf = 1;
    f.len = SYSTEM.guard.breakStun;
    f.guardF = 0;
    f.gcQueued = 0;
    f.move = -1;
    f.kbDist = 0;
    f.wallGuard = 0;
    s.hitstop = Math.max(s.hitstop, SYSTEM.crushHitstop);
    this.emit(EV_GUARD_BREAK, i, 0, 0, f.x, f.y);
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
        d.hurtGain = 0;
        d.wallHits = 0;
        d.comboFrames = 0;
        d.comboDmg = 0;
        a.comboGain = 0;
        a.chainResetUsed = 0;
        a.otgUsed = 0;
        a.pullUsed = 0;
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
const C_PUNISH = 7;
/** Stagger when a guard break (no hitstun of its own) catches a dash. */
const PUNISH_STUN = 30;
/** Extra freeze on a dash punish. */
const PUNISH_STOP = 4;
/** Guarding a bullet / blast into the wall. */
const GUARD_WALL_DMG = 30;
/** Bullets leave this far in front of the shooter. */
const MUZZLE = u(0.6);
const SHOT_HITSTOP = 3;
const SHOT_BLOCKSTOP = 2;
const SHOCK_HITSTOP = 6;
/** Jammed shooter: the whole JA window (it also runs during the slow motion) + the JA's startup. */
const JAM_LEN = SYSTEM.just.window + SYSTEM.just.jaS + 2;

export { U };
