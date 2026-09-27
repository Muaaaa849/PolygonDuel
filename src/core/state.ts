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
  /** Lunge / dash distance of the current move in % (reach level). */
  lungePct: number;
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
}

export function newFighter(): FighterState {
  return {
    char: 0, x: 0, y: 0, facing: 0, hp: 0, st: 0, sf: 0, len: 0, move: -1, moveHit: 0, moveHitAt: 0,
    guardF: 0, guardQ: 0, guardIdle: 0, cost: 0, comboGain: 0, hurtGain: 0, steps: 0, stepTimer: 0, moveDir: 0, stepChain: 0,
    bufAtk: 0, bufS1: 0, bufS2: 0, bufStep: 0, gcQueued: 0, noGc: 0, justWin: 0, jaChain: 0,
    chainResetUsed: 0, otgUsed: 0, comboHits: 0, comboFrames: 0, comboDmg: 0, downAge: 0, kbDist: 0, kbAngle: 0,
    limited: 0, buff: 0, healUses: 0, csHit: 0, prevIn: 0, lastDir: 0,
    aimAtk: 0, aimS1: 0, aimS2: 0, aimed: 0, wallHits: 0, lungePct: 100,
    statDmg: 0, statGc: 0, statJust: 0, statCrush: 0, statMaxCombo: 0, statBlocks: 0, statHitsTaken: 0,
    infGuard: 0, infCost: 0,
  };
}

export function newGameState(): GameState {
  return {
    frame: 0, phase: 0, phaseF: 0, timer: 0, round: 0, hitstop: 0, freeze: 0, slow: 0, slowWho: 0, winsA: 0, winsB: 0,
    roundWinner: -1, matchWinner: -1, trainingRefill: 0, noTimer: 0, seed: 0,
    f: [newFighter(), newFighter()],
  };
}

const FIGHTER_KEYS = Object.keys(newFighter()) as (keyof FighterState)[];
const GAME_KEYS = (Object.keys(newGameState()) as (keyof GameState)[]).filter((k) => k !== 'f') as Exclude<
  keyof GameState,
  'f'
>[];

export const SNAPSHOT_SIZE = GAME_KEYS.length + FIGHTER_KEYS.length * 2;

export function saveState(s: GameState, out: Int32Array): Int32Array {
  let i = 0;
  for (const k of GAME_KEYS) out[i++] = s[k] as number;
  for (const f of s.f) for (const k of FIGHTER_KEYS) out[i++] = f[k];
  return out;
}

export function loadState(s: GameState, src: Int32Array): GameState {
  let i = 0;
  for (const k of GAME_KEYS) (s[k] as number) = src[i++];
  for (const f of s.f) for (const k of FIGHTER_KEYS) f[k] = src[i++];
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

const scratch = new Int32Array(SNAPSHOT_SIZE);
export const hashState = (s: GameState): number => hashSnapshot(saveState(s, scratch));
