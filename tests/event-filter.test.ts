// Online effect de-duplication (src/net/event-filter.ts): rollback re-simulation must not
// replay an effect, even when the corrected timeline shifts it by a frame or two.
import { describe, expect, it } from 'vitest';
import { EventFilter } from '../src/net/event-filter';
import { EV_HIT, EV_STEP, EV_BLOCK, type SimEvent } from '../src/core/events';
import { Sim } from '../src/core/sim';
import { RollbackSession } from '../src/net/rollback';
import { IN_ATK, IN_STICK } from '../src/core/input';

const ev = (type: number, frame: number, who = 0): SimEvent => ({ type, frame, who, a: 42, b: 0, x: 0, y: 0 });

describe('event filter', () => {
  it('shows new events once; an identical re-emission is dropped', () => {
    const f = new EventFilter();
    expect(f.accept(ev(EV_HIT, 100), false)).toBe(true);
    expect(f.accept(ev(EV_HIT, 100), true)).toBe(false);
  });

  it('a re-simulated event shifted by 1–2 frames is the same event (not replayed)', () => {
    const f = new EventFilter();
    expect(f.accept(ev(EV_HIT, 100), false)).toBe(true);
    expect(f.accept(ev(EV_HIT, 101), true)).toBe(false);
    expect(f.accept(ev(EV_STEP, 50, 1), false)).toBe(true);
    expect(f.accept(ev(EV_STEP, 48, 1), true)).toBe(false);
  });

  it('other fighter / other type / farther away / live (not re-simulated) events still show', () => {
    const f = new EventFilter();
    f.accept(ev(EV_HIT, 100, 0), false);
    expect(f.accept(ev(EV_HIT, 101, 1), true)).toBe(true);
    expect(f.accept(ev(EV_BLOCK, 101, 0), true)).toBe(true);
    expect(f.accept(ev(EV_HIT, 104, 0), true)).toBe(true);
    expect(f.accept(ev(EV_HIT, 106, 0), false)).toBe(true);
  });

  it('in a real rollback session every effect reaches the screen exactly once', () => {
    // A hits B; B's inputs arrive late (mispredicted walking) so A's frames are re-simulated
    const shown: SimEvent[] = [];
    let raw = 0;
    const filter = new EventFilter();
    const q: { at: number; to: RollbackSession; d: Uint8Array }[] = [];
    let now = 0;
    const a: RollbackSession = new RollbackSession(new Sim(0, 2), {
      local: 0,
      inputDelay: 1,
      send: (p) => q.push({ at: now + 6, to: b, d: p.slice() }),
      onEvents: (evs, resim) => {
        for (const e of evs) {
          if (e.type === EV_HIT && e.who === 0) raw++;
          if (filter.accept(e, resim)) shown.push({ ...e });
        }
      },
    });
    const b: RollbackSession = new RollbackSession(new Sim(0, 2), { local: 1, inputDelay: 1, send: (p) => q.push({ at: now + 6, to: a, d: p.slice() }) });
    for (const s of [a.sim, b.sim]) {
      s.skipIntro();
      s.s.f[0].x = 7000;
      s.s.f[1].x = 8800;
    }
    for (now = 0; now < 600; now++) {
      for (let i = q.length - 1; i >= 0; i--) if (q[i].at <= now) { q[i].to.receive(q[i].d); q.splice(i, 1); }
      a.tick(now % 70 === 10 ? IN_ATK : 0);
      // B keeps nudging up / down: A's predictions of B are often wrong → re-simulated hits
      b.tick(now % 9 < 4 ? IN_STICK | (now % 18 < 9 ? 8 : 24) : 0);
    }
    const hits = shown.filter((e) => e.type === EV_HIT && e.who === 0);
    expect(hits.length).toBeGreaterThan(0);
    expect(a.stats.rollbacks).toBeGreaterThan(0);
    expect(raw).toBeGreaterThan(hits.length); // re-simulation did re-emit hits…
    // no two shown hits by the same attacker closer than a chain allows
    for (let i = 1; i < hits.length; i++) expect(hits[i].frame - hits[i - 1].frame).toBeGreaterThan(2);
  });
});
