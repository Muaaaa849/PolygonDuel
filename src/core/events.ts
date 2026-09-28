// The sim emits events; render/audio turn them into effects (plan §9-4:
// "演出は状態に入れない"). Events carry the frame so rollback re-sims can be de-duplicated.
export const EV_MOVE = 1;
export const EV_HIT = 2;
export const EV_BLOCK = 3;
export const EV_CRUSH = 4;
export const EV_GUARD_BREAK = 5;
export const EV_GB_OPEN = 6;
export const EV_JUST = 7;
export const EV_RIPOSTE = 8;
export const EV_KNOCKDOWN = 9;
export const EV_STEP = 10;
export const EV_HEAL = 11;
export const EV_KO = 12;
export const EV_ROUND = 13;
export const EV_FIGHT = 14;
export const EV_TIMEUP = 15;
export const EV_ROUND_END = 16;
export const EV_MATCH_END = 17;
export const EV_WAKE = 18;
export const EV_WHIFF = 19;
export const EV_GUARD = 20;
/** Knocked into the arena edge: a = damage, b = side (0 left, 1 right, 2 top, 3 bottom), x/y = impact point. */
export const EV_WALL = 21;
/** JA teleport: x/y = destination, a/b = origin x/y. */
export const EV_BLINK = 22;
/** Illusion started: a = mode (1 step-in, 2 fake swing), x/y = decoy start. */
export const EV_GHOST = 23;
/** Illusion ended: a = reason (0 timed out, 1 real revealed itself, 2 an attack touched the decoy), x/y = decoy position. */
export const EV_GHOST_END = 24;
/** A bullet left the muzzle: a = shot number, x/y = muzzle. */
export const EV_SHOT = 25;
/** Shooting mode changed: a = new mode (1 on, 0 off). */
export const EV_MODE = 26;
/** A floor field was placed: x/y = center, a = radius (milli-u). */
export const EV_FIELD = 27;
/** who = the fighter shocked by a field (stepped in it); a = damage. */
export const EV_SHOCK = 28;
/** who = the shooter jammed (a bullet was just-dodged). */
export const EV_JAM = 29;
/** Power-up (ヴォルトのオーバーチャージ): a = 1 gained (x/y = body), 0 lost (took damage). */
export const EV_POWER = 30;
/** Telekinetic pull landed: who = caster, a = 0 dragged the target in, 1 reversed (the caster got dragged), 2 no pull (already used), 3 dragged a guard in (no combo); x/y = target. */
export const EV_PULL = 31;

export const EV_NAMES: Record<number, string> = {
  [EV_MOVE]: 'move', [EV_HIT]: 'hit', [EV_BLOCK]: 'block', [EV_CRUSH]: 'crush', [EV_GUARD_BREAK]: 'guardBreak',
  [EV_GB_OPEN]: 'gbOpen', [EV_JUST]: 'just', [EV_RIPOSTE]: 'riposte', [EV_KNOCKDOWN]: 'knockdown', [EV_STEP]: 'step',
  [EV_HEAL]: 'heal', [EV_KO]: 'ko', [EV_ROUND]: 'round', [EV_FIGHT]: 'fight', [EV_TIMEUP]: 'timeup',
  [EV_ROUND_END]: 'roundEnd', [EV_MATCH_END]: 'matchEnd', [EV_WAKE]: 'wake', [EV_WHIFF]: 'whiff', [EV_GUARD]: 'guard', [EV_WALL]: 'wall', [EV_BLINK]: 'blink', [EV_GHOST]: 'ghost', [EV_GHOST_END]: 'ghostEnd', [EV_SHOT]: 'shot', [EV_MODE]: 'mode', [EV_FIELD]: 'field', [EV_SHOCK]: 'shock', [EV_JAM]: 'jam', [EV_POWER]: 'power', [EV_PULL]: 'pull',
};

// HIT flags
export const HF_COUNTER = 1;
export const HF_JA = 2;
export const HF_OTG = 4;
export const HF_KNOCKDOWN = 8;
export const HF_FORCED_DOWN = 16;
/** The hit / block came from a bullet (EV_HIT flags; EV_BLOCK b = 1). */
export const HF_SHOT = 32;
/** An attack caught a dash in its startup / active frames (×1.5). */
export const HF_PUNISH = 64;
/** The hit came from a telekinetic pull (EV_HIT flags). */
export const HF_PULL = 128;

export interface SimEvent {
  type: number;
  frame: number;
  /** Actor: attacker for hit-like events, the subject otherwise. */
  who: number;
  /** Generic payload: damage / move index / … */
  a: number;
  /** Generic payload: flags / combo count / … */
  b: number;
  /** World position (milli-u) for effects. */
  x: number;
  y: number;
}

/** Stable key for de-duplication across rollbacks. */
export const eventKey = (e: SimEvent): string => `${e.frame}:${e.type}:${e.who}`;
