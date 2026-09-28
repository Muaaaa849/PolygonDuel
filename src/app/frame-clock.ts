// Frame pacing for the battle loop (CLAUDE.md §12): turns rAF intervals into fixed 60Hz sim
// ticks, and decides which display frames get drawn. Pure (no DOM), so it is unit-tested
// for 60 / 90 / 120 / 144Hz screens (tests/frame-clock.test.ts).
export const TICK_MS = 1000 / 60;
/** Catch-up cap: after a long stall run at most this many ticks in one frame, drop the rest. */
const MAX_TICKS = 8;

/**
 * rAF timestamps are coarsened (~0.1ms), so a 60Hz frame measures 16.6 or 16.7ms and a plain
 * accumulator ticks 0, 2, 1, 1, 0, 2… times per frame: uneven motion, uneven input sampling.
 * An interval within 1ms of a whole number of ticks (or of half a tick: 120Hz) is snapped to
 * it, so every frame gets a steady cadence. Real-time drift is < 0.1% (online time sync absorbs it).
 */
export function snapVsync(dt: number): number {
  const k = Math.round(dt / TICK_MS);
  if (k >= 1 && Math.abs(dt - k * TICK_MS) < 1) return k * TICK_MS;
  if (Math.abs(dt - TICK_MS / 2) < 0.5) return TICK_MS / 2;
  return dt;
}

export interface FrameStep {
  /** Sim ticks to run this frame. */
  ticks: number;
  /** Draw this frame? */
  draw: boolean;
  /** ms since the last drawn frame (drives effect animation), capped at 250. */
  drawDt: number;
}

export class FrameClock {
  private acc = 0;
  private sinceDraw = 0;

  /**
   * One display frame of `dtMs` (raw rAF interval).
   * - `paused`: no ticks.
   * - `frozen`: paused behind a modal — nothing is drawn (the modal's blurred backdrop then
   *   isn't recomputed every frame) and effect time does not pass.
   * - `force`: draw regardless (the canvas was resized, which clears it).
   * Drawn frames are the ones where the sim ticked: a 90/120/144Hz screen would otherwise
   * draw every 60Hz state twice or more (same picture, double GPU work, heat and battery, and
   * the camera judders against 60Hz motion). Without ticks (dev pause) at most ~60 draws/s.
   */
  frame(dtMs: number, paused = false, frozen = false, force = false): FrameStep {
    let dt = dtMs > 0 ? dtMs : 0; // rAF timestamps can precede a performance.now() taken just before
    if (dt > 250) dt = 250;
    dt = snapVsync(dt);
    let ticks = 0;
    if (!paused) {
      this.acc += dt;
      // (1µs slack: k snapped ticks added then subtracted one by one must give exactly k)
      while (this.acc > TICK_MS - 0.001 && ticks < MAX_TICKS) {
        this.acc -= TICK_MS;
        ticks++;
      }
      if (ticks === MAX_TICKS) this.acc = 0;
    }
    this.sinceDraw = frozen && !force ? 0 : this.sinceDraw + dt;
    const draw = force || (ticks > 0 && !frozen) || (!frozen && this.sinceDraw >= TICK_MS - 1);
    if (!draw) return { ticks, draw, drawDt: 0 };
    const drawDt = Math.min(this.sinceDraw, 250);
    this.sinceDraw = 0;
    return { ticks, draw, drawDt };
  }
}
