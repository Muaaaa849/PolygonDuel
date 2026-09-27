// Shared system numbers (plan §5). Frames at 60 ticks/sec, distances in u.
export const SYSTEM = {
  fps: 60,
  /**
   * 16.5u×9.3u. The camera frames an 11u×6.2u window at zoom 1 (pieces stay big on
   * screen) and follows the fighters around the larger arena.
   */
  field: { w: 16.5, h: 9.3 },
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
  },

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
    /** Attack may cancel the recovery from this frame. */
    attackCancelFrom: 11,
    /** Just-dodge frames (hit on these step frames = just). */
    justFrames: 2,
  },

  just: {
    freeze: 10,
    window: 20,
    jaS: 8,
    jaA: 3,
    jaT: 30,
    jaLunge: 2.0,
    mul: 1.5,
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
