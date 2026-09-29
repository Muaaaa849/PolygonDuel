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
  | 'star' // stunned → full combo
  | 'diamond'; // shooting / a bullet → step INTO it (bullet just), guard in the open, eat it at a wall

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
  /** Damage of the retaliation strike (the 1st hit of a combo). */
  dmg: number;
  /** Recovery of the retaliation strike. */
  strikeT: number;
  /** Hitstun the caught attacker suffers (long enough for the strike → N2 chain). */
  stagger: number;
  /** Strike frames on which ATK chains into N2 (→ N3). */
  chain: Window;
  /** The caught attacker is pulled in to this distance (u) so N2 reaches. */
  pull: number;
  /** Cost given back when the riposte lands (whole units). */
  refund: number;
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

/** A bullet fired by the move (レイの射撃). Distances in u, speed in u per frame. */
export interface ProjectileSpec {
  /** Move frame the bullet leaves the muzzle. */
  at: number;
  speed: number;
  range: number;
  radius: number;
  dmg: number;
  hitstun: number;
  blockstun: number;
  /** Slide on hit / on guard (u). A guarded bullet can slam the target into the wall. */
  hitPush: number;
  guardPush: number;
  /** Cost gained by the shooter on hit or guard (whole units; melee gives 0.5). */
  costGain: number;
  /**
   * Share of the target's guard gauge a guarded bullet chips away (0..1). Bullets never
   * refill the gauge like melee blocks do: standing in guard against a volley is a slow loss.
   */
  guardDrain?: number;
  /**
   * Telekinetic pull (キネシスのサイコプル): instead of a flinch, the target is dragged to `to` u in
   * front of the caster and held `stun` F (a normal combo follows). Once per combo; later pulls
   * only deal `dmg` with the short `hitstun`. A target in a normal-attack motion (N1–N3 / GC / JA,
   * startup included) reverses it: the caster is dragged to the target and held `reverseStun` F.
   * Not a diamond: stepping into it is no bullet-just.
   */
  pull?: { to: number; stun: number; reverseStun: number };
}

/** A zone placed on the floor (レイのスタティックフィールド). */
export interface FieldSpec {
  /** Move frame the field is placed. */
  at: number;
  radius: number;
  frames: number;
  /** Aimed placement distance at full reach (u); a tap places it at the opponent's feet (clamped). */
  maxDist: number;
  /** Starting a step inside it, or stepping into it: damage + stagger, the step is cut. */
  dmg: number;
  stun: number;
}

/** A dash thrust (ヴォルトのダッシュスラスト): travels through the opponent on its active frames. */
export interface DashSpec {
  /** Travel over the active frames (u). Bodies don't push while it is active. */
  dist: number;
  /** Frame advantage on hit / on block (stun is set so this holds on any active frame). */
  advHit: number;
  advBlock: number;
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
  /** ATK on these frames starts `next` whether or not the move touched anything (連射). */
  chainAny?: Window;
  /** Skill cancel window that works on hit, block AND whiff (ダッシュ → ターンバック). */
  cancelAny?: Window;
  projectile?: ProjectileSpec;
  field?: FieldSpec;
  dash?: DashSpec;
  /** Canceling INTO this skill from another move (cancelFrom a move id) needs that move to have hit. */
  cancelHitOnly?: boolean;
  /** Knockdown launch distance (u) instead of the system's. */
  launch?: number;
  /** Knocks down where the target stands (no launch slide). */
  pinDown?: boolean;
  /** Hits all around the attacker (a burst of radius `reach`), from the first active frame. */
  radial?: boolean;
  /** Its guard pushback can slam the guard into the wall (wall damage while guarding). */
  wallOnGuard?: boolean;
  /** Power-up (ヴォルトのオーバーチャージ): on `frame`, attack damage +pct% until you take damage. */
  powerUp?: { frame: number; pct: number };
  /**
   * Hold-to-charge skill (ブラッドのS1): the move stays up while the button is held. It pays `hp` HP for `gain`
   * cost (quarters) on its 1st frame, then `tickHp` HP for `tickGain` cost every `every` frames; you can walk
   * at `walkPct`% speed but do nothing else. It ends on release (after `minHold` frames), when the cost is full
   * or the HP is too low, or when hit. `cooldown` frames of it come after it ends.
   */
  channel?: { hp: number; gain: number; every: number; tickHp: number; tickGain: number; cooldown: number; walkPct: number; minHold: number };
  /**
   * Ink trail (スケッチのS1): from frame `at`, for `draw` frames, the fighter's path leaves ink (a point every `gap` u
   * moved) that stays `life` frames. It is no obstacle to walking; but an OPPONENT who is knocked back (hit stun / down /
   * stun) across it hits it like a wall — `dmg` + up to `bonus` (scaled by the knockback left, like the arena wall's
   * 30 + 30) — and that piece of ink is gone.
   */
  ink?: { at: number; draw: number; life: number; gap: number; dmg: number; bonus: number };
  /** The knockback goes in the direction the attacker is holding on the stick when it lands (not where it faces). */
  dirKnock?: boolean;
  /** Starts the character's overdrive (`CharacterDef.drive`) on this move frame. */
  driveOn?: number;
  /** Sets the shooting mode at its 1st frame (1 = on, 0 = off). */
  mode?: 0 | 1;
  /**
   * 0F skill: its effect (mode / powerUp) applies the frame the button is pressed, during any
   * action (attacking, stepping, guarding…) without interrupting it. S/A/T are unused.
   */
  instant?: boolean;
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
  /** `stock`: step stock (default SYSTEM.step.maxStock = 2). */
  step: { dist: number; regen: number; stock?: number };
  /** Guard gauge in frames of continuous guarding (refilled by every blocked attack). */
  guardMax: number;
  /** Which side the 1st swing starts from (N1 right→left, N2 back, N3 spin). */
  swing: 'right' | 'left';
  normals: { n1: MoveDef; n2: MoveDef; n3: MoveDef };
  skills: [MoveDef, MoveDef];
  /** Extra moves (slots 8+), reached through `shooter` or skill resolution. */
  extraMoves?: MoveDef[];
  /**
   * Shooting-mode character (レイ): S1 toggles the mode (skills[0] turns it on, `off` turns it
   * off, from N2 it becomes `blast`); in the mode ATK fires `shots` (a chain of up to 3).
   */
  shooter?: { walk: number; shots: [string, string, string]; off: string; blast: string };
  /** S2 pressed from neutral / a step starts this extra move instead (skills[1] then only comes out of its cancelFrom moves). */
  s2Neutral?: string;
  /** How the normals are drawn: a swung blade (default) or telekinesis (the hit area itself ripples). */
  style?: 'blade' | 'psychic';
  /**
   * Overdrive (ブラッドのS2): while it lasts the cost gauge drains (1 quarter per `drainFrames`; no cost can be gained)
   * and the fighter gets `power` % damage, `walk` % speed, `reach` % reach and a guard gauge that drains at half speed (3 s).
   * Holding ATK for `hold.at` frames after a fresh 1st normal turns it into the guard break `hold.move`.
   * When the cost runs out: `exhaust.frames` of weakness (damage `exhaust.power` %, no overdrive) and
   * `exhaust.noWalk` frames in which only steps move the fighter.
   */
  drive?: {
    drainFrames: number;
    /** Minimum cost (whole units) to start it. */
    minCost: number;
    power: number;
    walk: number;
    reach: number;
    hold: { at: number; move: string };
    exhaust: { frames: number; noWalk: number; power: number };
  };
  /** Suggested combos for tutorial / move list. */
  combos: { route: string; cost: number; note: string }[];
  tips: string[];
}
