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

export const EV_NAMES: Record<number, string> = {
  [EV_MOVE]: 'move', [EV_HIT]: 'hit', [EV_BLOCK]: 'block', [EV_CRUSH]: 'crush', [EV_GUARD_BREAK]: 'guardBreak',
  [EV_GB_OPEN]: 'gbOpen', [EV_JUST]: 'just', [EV_RIPOSTE]: 'riposte', [EV_KNOCKDOWN]: 'knockdown', [EV_STEP]: 'step',
  [EV_HEAL]: 'heal', [EV_KO]: 'ko', [EV_ROUND]: 'round', [EV_FIGHT]: 'fight', [EV_TIMEUP]: 'timeup',
  [EV_ROUND_END]: 'roundEnd', [EV_MATCH_END]: 'matchEnd', [EV_WAKE]: 'wake', [EV_WHIFF]: 'whiff', [EV_GUARD]: 'guard',
};

// HIT flags
export const HF_COUNTER = 1;
export const HF_JA = 2;
export const HF_OTG = 4;
export const HF_KNOCKDOWN = 8;
export const HF_FORCED_DOWN = 16;

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
