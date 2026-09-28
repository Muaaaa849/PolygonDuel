// Frame pacing (src/app/frame-clock.ts): steady 60Hz ticks from any display rate, the scene
// drawn once per tick (not per display frame), frozen while paused behind a modal.
import { describe, expect, it } from 'vitest';
import { FrameClock, TICK_MS, snapVsync } from '../src/app/frame-clock';

/** rAF timestamps of a `hz` display for `secs`, coarsened to 0.1ms like browsers do. */
function timestamps(hz: number, secs: number, offset = 0.37): number[] {
  const out: number[] = [];
  for (let k = 0; k <= Math.round(hz * secs); k++) out.push(Math.round((offset + (k * 1000) / hz) * 10) / 10);
  return out;
}

function run(hz: number, secs = 5) {
  const ts = timestamps(hz, secs);
  const clock = new FrameClock();
  let ticks = 0;
  let draws = 0;
  const perFrame: number[] = [];
  const drawGaps: number[] = [];
  let lastDraw = 0;
  for (let i = 1; i < ts.length; i++) {
    const st = clock.frame(ts[i] - ts[i - 1]);
    ticks += st.ticks;
    perFrame.push(st.ticks);
    if (st.draw) {
      draws++;
      if (lastDraw) drawGaps.push(ts[i] - lastDraw);
      lastDraw = ts[i];
    }
  }
  return { ticks, draws, perFrame, drawGaps };
}

describe('frame clock', () => {
  it('snaps coarsened 60Hz / 120Hz intervals to whole (half) ticks', () => {
    expect(snapVsync(16.6)).toBe(TICK_MS);
    expect(snapVsync(16.7)).toBe(TICK_MS);
    expect(snapVsync(33.3)).toBe(TICK_MS * 2);
    expect(snapVsync(8.3)).toBe(TICK_MS / 2);
    expect(snapVsync(11.1)).toBe(11.1); // 90Hz: not a multiple, left alone
  });

  it('60Hz: exactly one tick and one draw per display frame (no 0/2 jitter)', () => {
    const r = run(60);
    expect(new Set(r.perFrame)).toEqual(new Set([1]));
    expect(r.draws).toBe(r.perFrame.length);
  });

  it('59.94Hz: still one tick per frame', () => {
    const r = run(59.94);
    expect(new Set(r.perFrame)).toEqual(new Set([1]));
  });

  for (const hz of [90, 120, 144]) {
    it(`${hz}Hz: 60 ticks/s and the scene drawn ~60 times/s, only on ticking frames`, () => {
      const secs = 5;
      const r = run(hz, secs);
      expect(Math.abs(r.ticks - 60 * secs)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.draws - 60 * secs)).toBeLessThanOrEqual(1);
      expect(Math.max(...r.perFrame)).toBe(1); // never 2 ticks in one frame at a steady rate
      // no gap between draws longer than one display frame beyond a tick
      expect(Math.max(...r.drawGaps)).toBeLessThan(TICK_MS + 1000 / hz + 0.5);
    });
  }

  it('120Hz: ticks alternate 0/1 in a steady pattern', () => {
    const r = run(120, 2);
    for (let i = 2; i < r.perFrame.length; i++) expect(r.perFrame[i] + r.perFrame[i - 1]).toBe(1);
  });

  it('a long frame catches up (capped), drawn once', () => {
    const c = new FrameClock();
    c.frame(TICK_MS);
    const st = c.frame(100);
    expect(st.ticks).toBe(6);
    expect(st.draw).toBe(true);
    expect(c.frame(1000).ticks).toBe(8); // clamped to 250ms (15 ticks), capped at 8, the rest dropped
    expect(c.frame(TICK_MS).ticks).toBe(1);
  });

  it('paused behind a modal: no ticks, nothing drawn, no effect time passes; a resize still draws', () => {
    const c = new FrameClock();
    c.frame(TICK_MS);
    for (let i = 0; i < 30; i++) {
      const st = c.frame(TICK_MS, true, true);
      expect(st.ticks).toBe(0);
      expect(st.draw).toBe(false);
    }
    const rs = c.frame(TICK_MS, true, true, true);
    expect(rs.draw).toBe(true);
    expect(rs.drawDt).toBeLessThanOrEqual(TICK_MS + 0.01);
    // resuming: the first draw does not jump effects by the whole pause
    const back = c.frame(TICK_MS);
    expect(back.ticks).toBe(1);
    expect(back.drawDt).toBeLessThanOrEqual(TICK_MS + 0.01);
  });

  it('dev pause (not frozen): keeps drawing at most ~60 times/s without ticks', () => {
    const c = new FrameClock();
    let draws = 0;
    for (let i = 0; i < 240; i++) if (c.frame(1000 / 240, true, false).draw) draws++;
    expect(draws).toBeGreaterThanOrEqual(55);
    expect(draws).toBeLessThanOrEqual(62);
  });
});
