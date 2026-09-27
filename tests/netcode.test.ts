// Rollback netcode + determinism (plan §9-4, §11 "決定論テスト").
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/core/sim';
import { RollbackSession, CHECKSUM_INTERVAL } from '../src/net/rollback';
import { hashState, cloneState, saveState, loadState, SNAPSHOT_SIZE } from '../src/core/state';
import { Rng } from '../src/core/rng';
import { IN_ATK, IN_S1, IN_S2, IN_STEP, IN_STICK } from '../src/core/input';

/** A plausible, bursty random player. */
function randomPlayer(seed: number) {
  const rng = new Rng(seed);
  let dir = rng.int(32);
  let stickOn = true;
  let hold = 0;
  return (): number => {
    if (hold-- <= 0) {
      hold = rng.int(20);
      stickOn = rng.int(3) !== 0;
      dir = rng.int(32);
    }
    let w = stickOn ? IN_STICK | dir : 0;
    const r = rng.int(100);
    if (r < 8) w |= IN_ATK;
    else if (r < 10) w |= IN_S1;
    else if (r < 12) w |= IN_S2;
    else if (r < 14) w |= IN_STEP;
    return w;
  };
}

interface Net {
  latencyMin: number;
  latencyMax: number;
  loss: number;
}

function simulate(net: Net, frames: number, seed: number, delayA = 2, delayB = 2) {
  const rng = new Rng(seed);
  const queues: { at: number; to: 0 | 1; data: Uint8Array }[] = [];
  let now = 0;
  const mk = (local: 0 | 1, delay: number) => {
    const sim = new Sim(0, 2);
    return new RollbackSession(sim, {
      local,
      inputDelay: delay,
      send: (pkt) => {
        if (rng.int(1000) < net.loss * 1000) return;
        const lat = net.latencyMin + rng.int(net.latencyMax - net.latencyMin + 1);
        queues.push({ at: now + lat, to: (1 - local) as 0 | 1, data: pkt.slice() });
      },
    });
  };
  const a = mk(0, delayA);
  const b = mk(1, delayB);
  const pa = randomPlayer(seed + 1);
  const pb = randomPlayer(seed + 2);
  // inputs actually applied per frame (for the reference run)
  const sessions = [a, b];
  for (now = 0; now < frames; now++) {
    // deliver due packets (random order among the due ones = reordering)
    const due = queues.filter((q) => q.at <= now);
    for (let i = due.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [due[i], due[j]] = [due[j], due[i]];
    }
    for (const q of due) {
      sessions[q.to].receive(q.data);
      queues.splice(queues.indexOf(q), 1);
    }
    a.tick(pa());
    b.tick(pb());
  }
  // drain: perfect network until both have fully confirmed each other
  for (let k = 0; k < 400; k++) {
    for (const q of queues.splice(0)) sessions[q.to].receive(q.data);
    a.flush();
    b.flush();
    for (const q of queues.splice(0)) sessions[q.to].receive(q.data);
    a.tick(0);
    b.tick(0);
  }
  return { a, b };
}

describe('rollback netcode', () => {
  it.each([
    ['LAN (0-1F)', { latencyMin: 0, latencyMax: 1, loss: 0 }],
    ['tethering w/ loss (1-2F, 5%)', { latencyMin: 1, latencyMax: 2, loss: 0.05 }],
    ['mobile (3-6F, 10% loss, jitter)', { latencyMin: 3, latencyMax: 6, loss: 0.1 }],
  ] as const)('both peers stay in sync — %s', (_n, net) => {
    const { a, b } = simulate(net, 3000, 1234);
    expect(a.stats.desyncs).toBe(0);
    expect(b.stats.desyncs).toBe(0);
    expect(a.stats.checksumsCompared + b.stats.checksumsCompared).toBeGreaterThan(20);
    expect(a.stats.maxRollbackSeen).toBeLessThanOrEqual(8);
    // Every checksum both recorded for the same frame must agree.
    let compared = 0;
    for (let f = CHECKSUM_INTERVAL; f < 3000; f += CHECKSUM_INTERVAL) {
      const ha = a.sumAt(f);
      const hb = b.sumAt(f);
      if (ha !== undefined && hb !== undefined) {
        expect(ha).toBe(hb);
        compared++;
      }
    }
    void compared;
  });

  it('rolled-back state equals a straight run with the same inputs', () => {
    // Record the confirmed inputs by replaying a session's view.
    const net = { latencyMin: 2, latencyMax: 5, loss: 0.08 };
    const rng = new Rng(99);
    const pa = randomPlayer(5);
    const pb = randomPlayer(6);
    const inputsA: number[] = [];
    const inputsB: number[] = [];
    const queues: { at: number; to: 0 | 1; data: Uint8Array }[] = [];
    let now = 0;
    const sessions: RollbackSession[] = [];
    for (const local of [0, 1] as const) {
      sessions.push(
        new RollbackSession(new Sim(1, 0), {
          local,
          inputDelay: 2,
          send: (pkt) => {
            if (rng.int(100) < net.loss * 100) return;
            queues.push({ at: now + net.latencyMin + rng.int(net.latencyMax - net.latencyMin + 1), to: (1 - local) as 0 | 1, data: pkt.slice() });
          },
        }),
      );
    }
    const [a, b] = sessions;
    // capture each side's local input queue as it is applied
    const origA = a.tick.bind(a);
    const origB = b.tick.bind(b);
    for (now = 0; now < 2000; now++) {
      for (const q of queues.filter((q) => q.at <= now)) {
        sessions[q.to].receive(q.data);
        queues.splice(queues.indexOf(q), 1);
      }
      const ia = pa();
      const ib = pb();
      const fa = a.frame;
      const fb = b.frame;
      if (origA(ia)) inputsA[fa + 2] = ia;
      if (origB(ib)) inputsB[fb + 2] = ib;
    }
    for (let k = 0; k < 300; k++) {
      for (const q of queues.splice(0)) sessions[q.to].receive(q.data);
      a.flush();
      b.flush();
      for (const q of queues.splice(0)) sessions[q.to].receive(q.data);
      const fa = a.frame;
      const fb = b.frame;
      if (a.tick(0)) inputsA[fa + 2] = 0;
      if (b.tick(0)) inputsB[fb + 2] = 0;
    }
    const upTo = Math.min(a.frame, b.frame) - 10;
    // reference
    const ref = new Sim(1, 0);
    const hashes = new Map<number, number>();
    for (let f = 0; f < upTo; f++) {
      if (f % CHECKSUM_INTERVAL === 0) hashes.set(f, hashState(ref.s));
      ref.step(inputsA[f] ?? 0, inputsB[f] ?? 0);
    }
    let checked = 0;
    for (const [f, h] of hashes) {
      const ha = a.sumAt(f);
      if (ha !== undefined) {
        expect(ha, `frame ${f}`).toBe(h);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('determinism', () => {
  it('same inputs → same final hash (twice), and snapshot/restore is lossless', () => {
    const run = () => {
      const sim = new Sim(2, 1);
      const pa = randomPlayer(42);
      const pb = randomPlayer(43);
      for (let i = 0; i < 5000; i++) sim.step(pa(), pb());
      return hashState(sim.s);
    };
    expect(run()).toBe(run());

    const sim = new Sim(0, 1);
    const pa = randomPlayer(7);
    const pb = randomPlayer(8);
    for (let i = 0; i < 1000; i++) sim.step(pa(), pb());
    const snap = saveState(sim.s, new Int32Array(SNAPSHOT_SIZE));
    const copy = cloneState(sim.s);
    expect(hashState(copy)).toBe(hashState(sim.s));
    loadState(sim.s, snap);
    expect(hashState(sim.s)).toBe(hashState(copy));
  });

  it('state contains only 32-bit integers', () => {
    const sim = new Sim(0, 2);
    const pa = randomPlayer(11);
    const pb = randomPlayer(12);
    for (let i = 0; i < 4000; i++) {
      sim.step(pa(), pb());
      const check = (o: object) => {
        for (const [k, v] of Object.entries(o)) {
          if (typeof v === 'object') continue;
          if (!Number.isInteger(v) || v !== (v | 0)) throw new Error(`non-int ${k}=${v} at ${i}`);
        }
      };
      check(sim.s);
      check(sim.s.f[0]);
      check(sim.s.f[1]);
    }
  });
});
