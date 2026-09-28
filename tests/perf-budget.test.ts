// CPU budgets for the per-frame hot path (CLAUDE.md §12). Online play re-simulates up to
// 8 frames every display frame after a misprediction, so Sim.step and the rollback
// bookkeeping must stay tiny. Measured on a dev machine: step ≈1µs, both peers' rollback
// tick ≈15µs. The limits are ~20x that, so a slow CI runner passes but an accidental
// O(n²) loop, per-step allocation storm or debug hash in the hot path does not.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/core/sim';
import { RollbackSession } from '../src/net/rollback';
import { CpuPlayer, CPU_LEVELS } from '../src/ai/cpu';

const N = 20000;

/** A real match's inputs (HARD CPU vs HARD CPU), recorded once. */
function recordInputs(): [number, number][] {
  const sim = new Sim(0, 3);
  const a = new CpuPlayer(sim, 0, CPU_LEVELS[2], 11);
  const b = new CpuPlayer(sim, 1, CPU_LEVELS[2], 22);
  const ins: [number, number][] = [];
  for (let k = 0; k < N; k++) {
    const x = a.input();
    const y = b.input();
    ins.push([x, y]);
    sim.step(x, y);
    if (sim.s.matchWinner >= 0) sim.startRound(true);
  }
  return ins;
}

describe('perf budget', () => {
  const ins = recordInputs();

  it('Sim.step stays around a microsecond (budget 25µs)', () => {
    let best = Infinity;
    for (let rep = 0; rep < 3; rep++) {
      const sim = new Sim(0, 3);
      const t0 = performance.now();
      for (let k = 0; k < N; k++) {
        sim.step(ins[k][0], ins[k][1]);
        if (sim.s.matchWinner >= 0) sim.startRound(true);
      }
      best = Math.min(best, ((performance.now() - t0) / N) * 1000);
    }
    expect(best).toBeLessThan(25);
  });

  it('a rollback tick with 5F latency (both peers) stays small (budget 300µs)', () => {
    const q: { at: number; to: RollbackSession; d: Uint8Array }[] = [];
    let now = 0;
    const mk = (local: 0 | 1): RollbackSession =>
      new RollbackSession(new Sim(0, 3), { local, inputDelay: 2, send: (p) => q.push({ at: now + 5, to: local === 0 ? B : A, d: p.slice() }) });
    const A: RollbackSession = mk(0);
    const B: RollbackSession = mk(1);
    const t0 = performance.now();
    for (now = 0; now < N; now++) {
      for (let i = q.length - 1; i >= 0; i--) if (q[i].at <= now) { q[i].to.receive(q[i].d); q.splice(i, 1); }
      A.tick(ins[now][0]);
      B.tick(ins[now][1]);
    }
    const perTick = ((performance.now() - t0) / N) * 1000;
    expect(A.stats.rollbacks).toBeGreaterThan(0);
    expect(A.stats.desyncs + B.stats.desyncs).toBe(0);
    expect(perTick).toBeLessThan(300);
  });
});
