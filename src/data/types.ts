// Character / move definitions are pure data (plan §11). Distances are in u
// (1u = one piece's diameter) and frames are 60 ticks/sec. They are compiled to
// integer milli-units once at load (see core/compile.ts).

/** Shape = what the opponent should do about it (plan §3). */
export type Shape =
  | 'square' // free: anything goes
  | 'hexagon' // guard → break it with a triangle
  | 'circle' // guardable attack → stop and guard
  | 'triangle' // guard break → move / step away
  | 'arrow' // step → punish the recovery
  | 'pentagon' // heal / buff → go hit them
  | 'star'; // stunned → full combo

export type Window = readonly [number, number];

export interface GuardBreakSpec {
  /** Stun frames inflicted on a guarding opponent (crush). */
  crush: number;
  /** Damage on crush. */
  dmgGuard: number;
  /** Damage on a non-guarding opponent (no flinch). */
  dmgOpen: number;
}

export interface CounterStanceSpec {
  from: number;
  to: number;
  dmg: number;
  /** Recovery of the retaliation strike. */
  strikeT: number;
}

export interface HealSpec {
  frame: number;
  hp: number;
  buffFrames: number;
  /** Walk speed bonus in percent while buffed. */
  walkPct: number;
  /** Step regen multiplier while buffed. */
  stepRegenMul: number;
}

/**
 * Illusion (ファントムの「ゴースト」): a decoy of yourself that the OPPONENT sees as you,
 * while the real you turns invisible to them and may act freely. Out of range the decoy
 * steps in and starts a swing; in range it swings N1 right away. It has no hitbox and
 * dissolves when its fake swing passes through, when an attack touches it, or when the
 * real you attacks / steps / gets hit.
 */
export interface GhostSpec {
  /** Frames the decoy's step-in takes (out-of-range mode). */
  approach: number;
  /** The decoy stops this far from the opponent (u). */
  stopDist: number;
  /** Total lifetime of the out-of-range decoy (frames). */
  frames: number;
}

export interface MoveDef {
  id: string;
  name: string;
  kind: 'normal' | 'gc' | 'ja' | 'skill';
  shape: Shape;
  /** Startup: first active frame (the press frame is frame 1). */
  S: number;
  /** Active frames. */
  A: number;
  /** Total frames. */
  T: number;
  /** Hitbox bar length from the fighter's center (u). */
  reach: number;
  /** Forward travel during startup (u). */
  lunge: number;
  /** Frame lunge travel starts (default: max(1, S - 8)). Travel ends at S - 1. */
  lungeFrom?: number;
  /**
   * Swing arc in degrees relative to facing (+ = clockwise = the piece's right).
   * Normals/GC/JA derive it from the character's `swing`; omit for a straight thrust.
   * |to - from| >= 360 is a full spin.
   */
  sweep?: readonly [number, number];
  /** Auto-aim toward the opponent at start (GC / JA). */
  autoAim?: boolean;
  dmg: number;
  hitstun: number;
  blockstun: number;
  hitstop: number;
  /** Next normal in the chain. */
  next?: string;
  chainHit?: Window;
  chainBlock?: Window;
  /** Skill-cancel window (on hit or block). */
  cancel?: Window;
  knockdown?: boolean;
  /** Distance the defender slides on hit / block (u). */
  knockback?: number;
  pushback?: number;
  // ── skill-only fields ──
  /** Cost in whole units (0.5 steps allowed). */
  cost?: number;
  /** Move ids this skill may cancel from; 'neutral' = from free state. */
  cancelFrom?: string[];
  usesPerRound?: number;
  guardBreak?: GuardBreakSpec;
  counterStance?: CounterStanceSpec;
  /** Chain reset: on hit, N1 may follow in this window (once per combo). */
  chainReset?: Window;
  /** Can hit a downed opponent within `otgWindow` frames of the knockdown (once per combo). */
  otg?: boolean;
  heal?: HealSpec;
  ghost?: GhostSpec;
  /** Short description for UI. */
  desc?: string;
}

export interface CharacterDef {
  id: string;
  name: string;
  nameEn: string;
  /** Main color (0xRRGGBB). */
  color: number;
  /** Alternate color for mirror matches. */
  altColor: number;
  theme: string;
  blurb: string;
  hp: number;
  /** u / second */
  walk: number;
  step: { dist: number; regen: number };
  /** Guard gauge in frames. */
  guardMax: number;
  /** Which side the 1st swing starts from (N1 right→left, N2 back, N3 spin). */
  swing: 'right' | 'left';
  normals: { n1: MoveDef; n2: MoveDef; n3: MoveDef };
  skills: [MoveDef, MoveDef];
  /** Suggested combos for tutorial / move list. */
  combos: { route: string; cost: number; note: string }[];
  tips: string[];
}
