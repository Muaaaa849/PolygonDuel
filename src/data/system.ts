// Shared system numbers (plan §5). Frames at 60 ticks/sec, distances in u.
export const SYSTEM = {
  fps: 60,
  /**
   * 24.75u×13.95u (v0.9: 1.5× the v0.3 arena). The camera frames an 11u×6.2u window at zoom 1 (pieces stay big on
   * screen) and follows the fighters around the larger arena.
   */
  field: { w: 24.75, h: 13.95 },
  /** Camera framing at zoom 1 (u). The field is larger than this, so the camera follows the fighters. */
  view: { w: 11, h: 6.2 },
  bodyRadius: 0.5,
  hurtRadius: 0.5,

  guard: {
    /** Guard becomes effective on its 2nd frame. */
    startup: 2,
    /** Frames of not guarding before the gauge regenerates. */
    regenDelay: 20,
    /** Regen per frame (in frames of gauge). */
    regenPerFrame: 0.5,
    /** Drain per frame while guarding. */
    drainPerFrame: 1,
    /** Drain when the opponent is at least `farDist` away (plan proposal). */
    drainFar: 0.25,
    farDist: 5,
    /** Gauge-out stun. */
    breakStun: 60,
    /** Gauge after a break (fraction of max). */
    breakRefill: 0.25,
    /** Hexagon shrinks down to this scale at empty gauge. */
    minScale: 0.45,
    /**
     * Blocking an attack refills the gauge: guarding against real attacks never breaks,
     * only standing in guard with nothing coming (the gauge is short: ~1.5s) does.
     */
    refillOnBlock: true,
  },

  /**
   * A normal that touched nothing (a real whiff, not a just-dodged one) recovers faster:
   * only this share of its recovery is played. Placing attacks is less of a gamble.
   */
  whiffRecovery: 0.6,

  gc: {
    S: 14,
    A: 3,
    T: 38,
    dmgMul: 0.8,
    /** Block stun inflicted by a blocked GC (→ GC user is -4). */
    blockstun: 21,
    chainHit: [17, 26] as const,
  },

  cost: {
    start: 2,
    max: 4,
    gainOnContact: 0.5,
    maxGainPerCombo: 1.5,
    /** The side taking damage gains half of what the attacker gains. */
    gainOnHurt: 0.25,
    maxHurtGainPerCombo: 0.75,
  },

  step: {
    total: 18,
    moveFrames: 10,
    maxStock: 2,
    /** A second step may be started from this frame of the first. */
    chainFrom: 8,
    /**
     * Attacks / skills may cancel the step from this frame (after the just-dodge frames),
     * keeping the step's remaining travel as momentum: step-in attacks close distance fast.
     */
    attackCancelFrom: 3,
    /** Just-dodge frames (hit on these step frames = just). */
    justFrames: 2,
  },

  just: {
    /** (unused since v0.4: replaced by the slow-motion below) */
    freeze: 0,
    /**
     * Just dodge = slow motion: `slow` real frames (0.6s) during which the fighters
     * advance only every `slowDiv`-th frame. Pressing ATK ends it at once and starts the JA.
     */
    slow: 36,
    slowDiv: 4,
    /** Frames (fighter-advancing) the JA can be started after the dodge. */
    window: 20,
    /** The JA teleports to this distance in front of the opponent (u), on the dodger's side. */
    blinkDist: 1.3,
    jaS: 8,
    jaA: 3,
    jaT: 30,
    jaLunge: 0.3,
    mul: 1.5,
  },

  /** Knocked into the arena edge by a hit: extra damage + impact (max `perCombo` per combo). */
  wall: {
    /** Base damage, + up to `bonus` scaled by the knockback left when hitting the wall. */
    dmg: 30,
    bonus: 30,
    perCombo: 2,
    hitstop: 8,
  },

  /** Normal swings: a fan in front (half-width in degrees). */
  swingHalfDeg: 35,

  guardBreakOpenHitstop: 4,
  crushHitstop: 14,

  counterHit: { dmgMul: 1.2, stunBonus: 4 },

  down: {
    lying: 45,
    wake: 15,
    rollDist: 1.2,
    limited: 8,
    otgWindow: 30,
    launch: 1.6,
  },

  /** Combo scaling by hit number (1-based). */
  scaling: [100, 100, 100, 80, 70, 60],
  comboForceDownFrames: 240,

  round: {
    seconds: 60,
    winsNeeded: 2,
    introFirst: 180,
    intro: 100,
    koPause: 150,
    maxRounds: 5,
  },

  /** Default input buffer for presses (frames). */
  buffer: 6,
  /** Homing: first N startup frames may turn toward the opponent by at most `homingDeg`/F. */
  homingFrames: 8,
  homingDeg: 4,
} as const;
