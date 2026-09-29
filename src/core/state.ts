// Simulation state: only integers, so snapshots are a flat Int32Array copy and
// checksums are a hash over it (plan §9-4). No references, no floats.

// Fighter states
export const ST_FREE = 0;
export const ST_ATTACK = 1;
export const ST_BLOCKSTUN = 2;
export const ST_HITSTUN = 3;
export const ST_STEP = 4;
export const ST_DOWN = 5;
export const ST_WAKE = 6;
export const ST_STUN = 7;
export const ST_KO = 8;
/** Out of ammo: a shooter whose bullet was just-dodged can't act until the JA lands (square). */
export const ST_JAM = 9;

// Result of the current move's contact
export const MH_NONE = 0;
export const MH_HIT = 1;
export const MH_BLOCK = 2;
/** Contact consumed without effect (just-dodged, countered, open GB). */
export const MH_SPENT = 3;

// Round phases
export const PH_INTRO = 0;
export const PH_FIGHT = 1;
export const PH_END = 2;
export const PH_MATCH_OVER = 3;

export interface FighterState {
  char: number;
  x: number;
  y: number;
  facing: number;
  hp: number;
  st: number;
  /** Frames elapsed in the state (1 on the entering frame). */
  sf: number;
  /** Duration of timed states (stun, down…). */
  len: number;
  move: number;
  moveHit: number;
  /** Move frame on which contact happened. */
  moveHitAt: number;
  /** Frames since guard started (0 = not guarding). Effective when >= 2. */
  guardF: number;
  /** Guard gauge in quarter-frames. */
  guardQ: number;
  /** Frames since last guard (for regen delay). */
  guardIdle: number;
  /** Cost in halves. */
  cost: number;
  /** Cost gained (halves) during the current combo as attacker. */
  comboGain: number;
  /** Cost gained (quarters) from taking damage during the current combo as defender. */
  hurtGain: number;
  steps: number;
  stepTimer: number;
  /** Direction of the current step / roll. */
  moveDir: number;
  /** Step frame at which a chained second step may start. */
  stepChain: number;
  /** Buffered presses: frames left. */
  bufAtk: number;
  bufS1: number;
  bufS2: number;
  bufStep: number;
  gcQueued: number;
  /** Blockstun came from a GC (GC-on-GC forbidden). */
  noGc: number;
  /** Frames left to start a just attack. */
  justWin: number;
  /** Just-attack multiplier chain active. */
  jaChain: number;
  chainResetUsed: number;
  otgUsed: number;
  /** Defender-side combo tracking. */
  comboHits: number;
  comboFrames: number;
  comboDmg: number;
  /** Frames since knockdown began (for OTG). */
  downAge: number;
  /** Knockback slide: remaining distance and angle. */
  kbDist: number;
  kbAngle: number;
  /** Post-wakeup limited frames (move & guard only). */
  limited: number;
  buff: number;
  healUses: number;
  /** Counter stance succeeded during this move. */
  csHit: number;
  /** Previous input word (for press edges). */
  prevIn: number;
  /** Last stick direction (for STEP default). */
  lastDir: number;
  /** Aim attached to the buffered ATK / S1 / S2 press: 0 = none, else 1 + angle + level*1024. */
  aimAtk: number;
  aimS1: number;
  aimS2: number;
  /** Current move was aimed (no homing). */
  aimed: number;
  /** Wall impacts taken during the current combo. */
  wallHits: number;
  /** Illusion (ghost) decoy: frames since start (0 = none), mode (1 step-in, 2 fake swing),
   *  current / start / target position, facing, and the frame its fake N1 starts. */
  ghostT: number;
  ghostMode: number;
  ghostX: number;
  ghostY: number;
  ghostSx: number;
  ghostSy: number;
  ghostTx: number;
  ghostTy: number;
  ghostFace: number;
  ghostAtk: number;
  /** Lunge / dash distance of the current move in % (reach level). */
  lungePct: number;
  /** Step momentum carried into an attack started from a step: the next step-table
   *  frame to keep applying (0 = none) and its direction. */
  momStep: number;
  momDir: number;
  /** Shooting mode (レイ): ATK fires bullets. Kept through hits, reset each round. */
  shootMode: number;
  /** The pending just attack came from a bullet just (no ×1.5). */
  justNoMul: number;
  /** The current guard pushback came from a bullet / blast: slamming the wall hurts. */
  wallGuard: number;
  /** Bullets (up to 3): shot number (0 = none), position, direction, range left. */
  sh0n: number; sh0x: number; sh0y: number; sh0a: number; sh0r: number;
  sh1n: number; sh1x: number; sh1y: number; sh1a: number; sh1r: number;
  sh2n: number; sh2x: number; sh2y: number; sh2a: number; sh2r: number;
  /** Guard setting: 0 = auto (stick centered = guard), 1 = manual (only while GUARD is held). Kept across rounds. */
  manualGuard: number;
  /** Attack direction setting: 1 = fresh attacks / skills without an aim face the opponent even while moving; 0 = the stick. Kept across rounds. */
  faceFoe: number;
  /** Attack power bonus in percent (ヴォルトのオーバーチャージ). Lasts until this fighter takes damage; 0 = none. */
  power: number;
  /** Frames left during which instant-skill presses are ignored (double-tap guard). */
  instLock: number;
  /** This fighter's telekinetic pull already dragged the opponent in this combo (once per combo). */
  pullUsed: number;
  /** Frames left of the after-wake step bonus (SYSTEM.wakeStep; the next step uses it up); stepPct = the running step's distance in %. */
  wakeBoost: number;
  stepPct: number;
  /** Ink trail (スケッチ): frames of drawing left, the next trail slot to write (ring), and "the pen was lifted" (the next point starts a new stroke). */
  inkT: number;
  /** Frames the ATK button has been held down without a break (the overdrive's hold-for-heavy needs a real hold, not a mash). */
  atkHold: number;
  trHead: number;
  trBrk: number;
  /** Overdrive (ブラッド): 1 while active, frames since the last cost quarter drained; frames of exhaustion / no-walking left; S1 cooldown left. */
  drive: number;
  driveTick: number;
  exhaust: number;
  noWalk: number;
  s1Cd: number;
  /** Floor field owned by this fighter: frames left (0 = none), center. */
  fieldT: number;
  fieldX: number;
  fieldY: number;
  // stats (for the result screen)
  statDmg: number;
  statGc: number;
  statJust: number;
  statCrush: number;
  statMaxCombo: number;
  statBlocks: number;
  statHitsTaken: number;
  // training flags
  infGuard: number;
  infCost: number;
}

export interface GameState {
  frame: number;
  phase: number;
  phaseF: number;
  /** Round timer in ticks. */
  timer: number;
  round: number;
  hitstop: number;
  /** (legacy) global freeze frames. */
  freeze: number;
  /** Just-dodge slow motion: real frames left, and who dodged. */
  slow: number;
  slowWho: number;
  winsA: number;
  winsB: number;
  /** -1 none, 0 / 1 = player, 2 = draw. */
  roundWinner: number;
  matchWinner: number;
  /** Training: HP refills when a combo ends. */
  trainingRefill: number;
  /** Disable round timer (training). */
  noTimer: number;
  seed: number;
  f: [FighterState, FighterState];
  /**
   * Ink trails (スケッチ), both fighters: per fighter TRAIL_N points of (x, y, meta) — meta = life << 1 | pen-up flag
   * (the point starts a new stroke: no segment joins it to the previous slot). A flat Int32Array so it stays in the
   * snapshot / hash without adding a hundred fields to every fighter.
   */
  trail: Int32Array;
}

/** Ink points per fighter (a ring: the oldest is overwritten), and ints per point / per fighter. */
export const TRAIL_N = 32;
export const TRAIL_STRIDE = 3;
export const TRAIL_FIGHTER = TRAIL_N * TRAIL_STRIDE;

export function newFighter(): FighterState {
  return {
    char: 0, x: 0, y: 0, facing: 0, hp: 0, st: 0, sf: 0, len: 0, move: -1, moveHit: 0, moveHitAt: 0,
    guardF: 0, guardQ: 0, guardIdle: 0, cost: 0, comboGain: 0, hurtGain: 0, steps: 0, stepTimer: 0, moveDir: 0, stepChain: 0,
    bufAtk: 0, bufS1: 0, bufS2: 0, bufStep: 0, gcQueued: 0, noGc: 0, justWin: 0, jaChain: 0,
    chainResetUsed: 0, otgUsed: 0, comboHits: 0, comboFrames: 0, comboDmg: 0, downAge: 0, kbDist: 0, kbAngle: 0,
    limited: 0, buff: 0, healUses: 0, csHit: 0, prevIn: 0, lastDir: 0,
    aimAtk: 0, aimS1: 0, aimS2: 0, aimed: 0, wallHits: 0, lungePct: 100, momStep: 0, momDir: 0,
    shootMode: 0, justNoMul: 0, wallGuard: 0, manualGuard: 0, faceFoe: 0, power: 0, instLock: 0, pullUsed: 0, wakeBoost: 0, stepPct: 100,
    drive: 0, driveTick: 0, exhaust: 0, noWalk: 0, s1Cd: 0, inkT: 0, atkHold: 0, trHead: 0, trBrk: 0,
    sh0n: 0, sh0x: 0, sh0y: 0, sh0a: 0, sh0r: 0, sh1n: 0, sh1x: 0, sh1y: 0, sh1a: 0, sh1r: 0, sh2n: 0, sh2x: 0, sh2y: 0, sh2a: 0, sh2r: 0,
    fieldT: 0, fieldX: 0, fieldY: 0,
    ghostT: 0, ghostMode: 0, ghostX: 0, ghostY: 0, ghostSx: 0, ghostSy: 0, ghostTx: 0, ghostTy: 0, ghostFace: 0, ghostAtk: 0,
    statDmg: 0, statGc: 0, statJust: 0, statCrush: 0, statMaxCombo: 0, statBlocks: 0, statHitsTaken: 0,
    infGuard: 0, infCost: 0,
  };
}

export function newGameState(): GameState {
  return {
    frame: 0, phase: 0, phaseF: 0, timer: 0, round: 0, hitstop: 0, freeze: 0, slow: 0, slowWho: 0, winsA: 0, winsB: 0,
    roundWinner: -1, matchWinner: -1, trainingRefill: 0, noTimer: 0, seed: 0,
    f: [newFighter(), newFighter()],
    trail: new Int32Array(2 * TRAIL_FIGHTER),
  };
}

const FIGHTER_KEYS = Object.keys(newFighter()) as (keyof FighterState)[];
const GAME_KEYS = (Object.keys(newGameState()) as (keyof GameState)[]).filter((k) => k !== 'f' && k !== 'trail') as Exclude<
  keyof GameState,
  'f' | 'trail'
>[];

export const SNAPSHOT_SIZE = GAME_KEYS.length + FIGHTER_KEYS.length * 2 + 2 * TRAIL_FIGHTER;

export function saveState(s: GameState, out: Int32Array): Int32Array {
  let i = 0;
  for (const k of GAME_KEYS) out[i++] = s[k] as number;
  for (const f of s.f) for (const k of FIGHTER_KEYS) out[i++] = f[k];
  for (let j = 0; j < s.trail.length; j++) out[i++] = s.trail[j];
  return out;
}

export function loadState(s: GameState, src: Int32Array): GameState {
  let i = 0;
  for (const k of GAME_KEYS) (s[k] as number) = src[i++];
  for (const f of s.f) for (const k of FIGHTER_KEYS) f[k] = src[i++];
  for (let j = 0; j < s.trail.length; j++) s.trail[j] = src[i++];
  return s;
}

export function cloneState(s: GameState): GameState {
  return loadState(newGameState(), saveState(s, new Int32Array(SNAPSHOT_SIZE)));
}

/** FNV-1a over the snapshot words. */
export function hashSnapshot(a: Int32Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < a.length; i++) {
    let v = a[i];
    for (let b = 0; b < 4; b++) {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193);
      v >>>= 8;
    }
  }
  return h >>> 0;
}

/** Bullet j (0..2) of fighter f, or null. */
export interface Shot {
  n: number;
  x: number;
  y: number;
  a: number;
  r: number;
}
const SHOT_KEYS = [0, 1, 2].map((j) => ({ n: `sh${j}n`, x: `sh${j}x`, y: `sh${j}y`, a: `sh${j}a`, r: `sh${j}r` }));
type Rec = Record<string, number>;
export function getShot(f: FighterState, j: number): Shot | null {
  const k = SHOT_KEYS[j];
  const r = f as unknown as Rec;
  return r[k.n] ? { n: r[k.n], x: r[k.x], y: r[k.y], a: r[k.a], r: r[k.r] } : null;
}
export function setShot(f: FighterState, j: number, s: Shot | null): void {
  const k = SHOT_KEYS[j];
  const r = f as unknown as Rec;
  r[k.n] = s ? s.n : 0;
  r[k.x] = s ? s.x : 0;
  r[k.y] = s ? s.y : 0;
  r[k.a] = s ? s.a : 0;
  r[k.r] = s ? s.r : 0;
}
export const MAX_SHOTS = 3;

const scratch = new Int32Array(SNAPSHOT_SIZE);
export const hashState = (s: GameState): number => hashSnapshot(saveState(s, scratch));
