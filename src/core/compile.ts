// Compiles pure-data character definitions into integer tables for the sim.
import { u, U } from './fixed';
import { SYSTEM } from '../data/system';
import type { CharacterDef, MoveDef, Shape, Window } from '../data/types';

export const SHAPES: readonly Shape[] = ['square', 'hexagon', 'circle', 'triangle', 'arrow', 'pentagon', 'star'];
export const SH = {
  square: 0,
  hexagon: 1,
  circle: 2,
  triangle: 3,
  arrow: 4,
  pentagon: 5,
  star: 6,
} as const;

// Move slots per character
export const M_N1 = 0;
export const M_N2 = 1;
export const M_N3 = 2;
export const M_GC = 3;
export const M_JA = 4;
export const M_S1 = 5;
export const M_S2 = 6;
export const M_STRIKE = 7;
export const MOVE_SLOTS = 8;

export const KIND_NORMAL = 0;
export const KIND_GC = 1;
export const KIND_JA = 2;
export const KIND_SKILL = 3;

/** Cost is stored in quarters (1.0 cost = 4) so the hurt side can gain 0.25. */
export const COST_UNIT = 4;

/** Bit in cancelFrom mask meaning "from the free state". */
export const CANCEL_NEUTRAL = 1 << 15;

export interface CWindow {
  a: number;
  b: number;
}

export interface CMove {
  idx: number;
  id: string;
  name: string;
  kind: number;
  shape: number;
  S: number;
  A: number;
  T: number;
  reach: number;
  lunge: number;
  /** Per-frame lunge distance, index = move frame. */
  lungeAt: Int32Array;
  autoAim: boolean;
  /** Swing arc relative to facing, in angle units (0/0 = thrust). */
  sweepFrom: number;
  sweepTo: number;
  isSweep: boolean;
  dmg: number;
  hitstun: number;
  blockstun: number;
  hitstop: number;
  next: number;
  chainHit: CWindow | null;
  chainBlock: CWindow | null;
  cancel: CWindow | null;
  knockdown: boolean;
  knockback: number;
  pushback: number;
  /** Cost in halves (1.0 cost = 2). */
  cost: number;
  cancelFrom: number;
  usesPerRound: number;
  gb: { crush: number; dmgGuard: number; dmgOpen: number } | null;
  cs: { from: number; to: number; dmg: number; strikeT: number } | null;
  chainReset: CWindow | null;
  otg: boolean;
  heal: { frame: number; hp: number; buffFrames: number; walkPct: number; stepRegenMul: number } | null;
  /** Hitbox exists at all. */
  hasHitbox: boolean;
  def: MoveDef | null;
}

export interface CChar {
  idx: number;
  def: CharacterDef;
  hp: number;
  /** milli-u per tick */
  walk: number;
  stepDist: number;
  stepRegen: number;
  /** Guard gauge max, quarter-frames */
  guardMaxQ: number;
  moves: CMove[];
}

const win = (w?: Window): CWindow | null => (w ? { a: w[0], b: w[1] } : null);

function lungeTable(S: number, T: number, lunge: number, from?: number): Int32Array {
  const table = new Int32Array(T + 2);
  if (lunge <= 0) return table;
  const start = Math.max(1, from ?? S - 8);
  const end = Math.max(start, S - 1);
  const n = end - start + 1;
  const base = Math.trunc(lunge / n);
  let rem = lunge - base * n;
  for (let f = start; f <= end; f++) {
    table[f] = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
  }
  return table;
}

const degToAng = (d: number): number => Math.round((d * 1024) / 360);

function compileMove(idx: number, m: MoveDef, slotIds: Record<string, number>): CMove {
  const lunge = u(m.lunge);
  const sweepFrom = m.sweep ? degToAng(m.sweep[0]) : 0;
  const sweepTo = m.sweep ? degToAng(m.sweep[1]) : 0;
  let cancelFrom = 0;
  for (const src of m.cancelFrom ?? []) {
    if (src === 'neutral') cancelFrom |= CANCEL_NEUTRAL;
    else if (src in slotIds) {
      cancelFrom |= 1 << slotIds[src];
      // GC and JA behave as a 1st hit for cancel purposes
      if (src === 'n1') cancelFrom |= (1 << M_GC) | (1 << M_JA);
    }
  }
  return {
    idx,
    id: m.id,
    name: m.name,
    kind: m.kind === 'normal' ? KIND_NORMAL : m.kind === 'gc' ? KIND_GC : m.kind === 'ja' ? KIND_JA : KIND_SKILL,
    shape: SH[m.shape],
    S: m.S,
    A: m.A,
    T: m.T,
    reach: u(m.reach),
    lunge,
    lungeAt: lungeTable(m.S, m.T, lunge, m.lungeFrom),
    autoAim: !!m.autoAim,
    sweepFrom,
    sweepTo,
    isSweep: sweepFrom !== sweepTo,
    dmg: m.dmg,
    hitstun: m.hitstun,
    blockstun: m.blockstun,
    hitstop: m.hitstop,
    next: m.next ? slotIds[m.next] : -1,
    chainHit: win(m.chainHit),
    chainBlock: win(m.chainBlock),
    cancel: win(m.cancel),
    knockdown: !!m.knockdown,
    knockback: u(m.knockback ?? 0),
    pushback: u(m.pushback ?? 0),
    cost: Math.round((m.cost ?? 0) * COST_UNIT),
    cancelFrom,
    usesPerRound: m.usesPerRound ?? 0,
    gb: m.guardBreak ? { ...m.guardBreak } : null,
    cs: m.counterStance ? { ...m.counterStance } : null,
    chainReset: win(m.chainReset),
    otg: !!m.otg,
    heal: m.heal ? { ...m.heal } : null,
    hasHitbox: m.A > 0 && m.reach > 0,
    def: m,
  };
}

export function compileCharacter(def: CharacterDef, idx: number): CChar {
  const slotIds: Record<string, number> = { n1: M_N1, n2: M_N2, n3: M_N3, gc: M_GC, ja: M_JA };
  slotIds[def.skills[0].id] = M_S1;
  slotIds[def.skills[1].id] = M_S2;
  const n1 = def.normals.n1;
  const g = SYSTEM.gc;
  const j = SYSTEM.just;
  const gcDef: MoveDef = {
    id: 'gc', name: 'ガード反撃', kind: 'gc', shape: 'circle',
    S: g.S, A: g.A, T: g.T, reach: n1.reach, lunge: n1.lunge, autoAim: true,
    dmg: Math.trunc((n1.dmg * Math.round(g.dmgMul * 100)) / 100),
    hitstun: n1.hitstun, blockstun: g.blockstun, hitstop: 6,
    next: 'n2', chainHit: g.chainHit, cancel: g.chainHit,
    knockback: n1.knockback, pushback: n1.pushback,
  };
  const jaDef: MoveDef = {
    id: 'ja', name: 'ジャスト攻撃', kind: 'ja', shape: 'circle',
    S: j.jaS, A: j.jaA, T: j.jaT, reach: n1.reach, lunge: j.jaLunge, lungeFrom: 1, autoAim: true,
    dmg: n1.dmg, hitstun: n1.hitstun, blockstun: n1.blockstun, hitstop: 6,
    next: 'n2', chainHit: [j.jaS + 3, j.jaS + 12], cancel: [j.jaS + 3, j.jaS + 12],
    knockback: n1.knockback, pushback: n1.pushback,
  };
  const cs = def.skills.find((s) => s.counterStance)?.counterStance;
  const strikeDef: MoveDef = {
    id: 'strike', name: '反撃', kind: 'skill', shape: 'circle',
    S: 1, A: 0, T: cs?.strikeT ?? 20, reach: 0, lunge: 0,
    dmg: 0, hitstun: 0, blockstun: 0, hitstop: 0,
  };
  // Swings (fan attacks): N1 from the character's side, N2 back, N3 a full spin.
  const w = SYSTEM.swingHalfDeg;
  const sgn = def.swing === 'right' ? 1 : -1;
  const first = [sgn * w, -sgn * w] as const;
  const second = [-sgn * w, sgn * w] as const;
  const spin = [sgn * 180, sgn * 180 - sgn * 360] as const;
  const withSweep = (m: MoveDef, sw: readonly [number, number]): MoveDef => (m.sweep ? m : { ...m, sweep: sw });
  const src: MoveDef[] = [
    withSweep(n1, first), withSweep(def.normals.n2, second), withSweep(def.normals.n3, spin),
    withSweep(gcDef, first), withSweep(jaDef, first), def.skills[0], def.skills[1], strikeDef,
  ];
  const moves = src.map((m, i) => compileMove(i, m, slotIds));
  return {
    idx,
    def,
    hp: def.hp,
    walk: Math.round((def.walk * U) / SYSTEM.fps),
    stepDist: u(def.step.dist),
    stepRegen: def.step.regen,
    guardMaxQ: def.guardMax * 4,
    moves,
  };
}
