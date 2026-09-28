// CPU vs CPU soak: every matchup finishes, nothing throws, and matches look like fights.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/core/sim';
import { CpuPlayer, CPU_LEVELS } from '../src/ai/cpu';
import { PH_MATCH_OVER } from '../src/core/state';
import { EV_HIT, EV_BLOCK, EV_CRUSH, EV_JUST } from '../src/core/events';
import { CHARACTERS } from '../src/data/characters';

function play(a: number, b: number, seed: number) {
  const sim = new Sim(a, b);
  const ca = new CpuPlayer(sim, 0, CPU_LEVELS[2], seed);
  const cb = new CpuPlayer(sim, 1, CPU_LEVELS[2], seed + 1000);
  const count = { hit: 0, block: 0, crush: 0, just: 0 };
  let frames = 0;
  while (sim.s.phase !== PH_MATCH_OVER && frames < 60 * 60 * 12) {
    sim.step(ca.input(), cb.input());
    for (const e of sim.events) {
      if (e.type === EV_HIT) count.hit++;
      if (e.type === EV_BLOCK) count.block++;
      if (e.type === EV_CRUSH) count.crush++;
      if (e.type === EV_JUST) count.just++;
    }
    frames++;
  }
  return { winner: sim.s.matchWinner, frames, rounds: sim.s.round, count };
}

describe('CPU soak', () => {
  it('all matchups finish with real exchanges', () => {
    const n = CHARACTERS.length;
    const wins = Array.from({ length: n }, () => [0, 0]);
    let totalRoundsFrames = 0;
    let rounds = 0;
    const agg = { hit: 0, block: 0, crush: 0, just: 0 };
    for (let a = 0; a < n; a++)
      for (let b = 0; b < n; b++)
        for (let k = 0; k < 6; k++) {
          const r = play(a, b, 17 + k * 31 + a * 7 + b * 3);
          expect(r.winner).toBeGreaterThanOrEqual(0);
          totalRoundsFrames += r.frames;
          rounds += r.rounds;
          for (const key of Object.keys(agg) as (keyof typeof agg)[]) agg[key] += r.count[key];
          if (a !== b && r.winner !== 2) {
            wins[a][1]++;
            wins[b][1]++;
            wins[r.winner === 0 ? a : b][0]++;
          }
        }
    const report = CHARACTERS.map((c, i) => `${c.id} ${((wins[i][0] / wins[i][1]) * 100).toFixed(0)}%`).join(', ');
    console.log(`win rates: ${report}; avg round ${(totalRoundsFrames / rounds / 60).toFixed(1)}s; events ${JSON.stringify(agg)}`);
    expect(agg.hit).toBeGreaterThan(100);
    expect(agg.block).toBeGreaterThan(20);
  }, 120000);
});
