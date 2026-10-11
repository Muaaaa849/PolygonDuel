import { describe, expect, it, vi } from 'vitest';
import { RollbackSession, PKT_INPUT } from '../src/net/rollback';
import { Sim } from '../src/core/sim';
import { IN_ATK, IN_S1, aimBits } from '../src/core/input';
import { ST_BLOCKSTUN, hashState, saveState, loadState, SNAPSHOT_SIZE } from '../src/core/state';
import { EV_MOVE } from '../src/core/events';
import { M_GC } from '../src/core/compile';
import { Scenario, sequence, guard } from './harness';

function packet(first: number, inputs: number[], frame = first + inputs.length, adv = 0): Uint8Array {
  const p = new Uint8Array(15 + inputs.length * 4);
  const v = new DataView(p.buffer);
  v.setUint8(0, PKT_INPUT);
  v.setInt32(1, -1, true);
  v.setInt32(5, frame, true);
  v.setInt8(9, adv);
  v.setInt32(10, first, true);
  v.setUint8(14, inputs.length);
  inputs.forEach((w, i) => v.setUint32(15 + i * 4, w, true));
  return p;
}

describe('online input consumption', () => {
  it('keeps a released, aimed tap latched throughout a network stall', () => {
    const sim = new Sim(0, 1);
    sim.skipIntro();
    const session = new RollbackSession(sim, { local: 0, inputDelay: 0, send: () => {} });
    for (let i = 0; i < 8; i++) expect(session.tick(0)).toBe(true);
    // A touch / keyboard tap has already been released, but poll still holds its latch.
    const word = IN_S1 | aimBits(73, 2, 19);
    let latched = word;
    const poll = vi.fn(() => { const w = latched; latched = 0; return w; });
    for (let i = 0; i < 5; i++) expect(session.tick(poll)).toBe(false);
    expect(poll).not.toHaveBeenCalled();
    expect(latched).toBe(word);
    session.receive(packet(0, Array(9).fill(0)));
    expect(session.tick(poll)).toBe(true);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(sim.s.f[0].prevIn).toBe(word);
    expect(latched).toBe(0);
  });

  it('does not consume a press on a time-sync skip either', () => {
    const session = new RollbackSession(new Sim(0, 1), { local: 0, inputDelay: 0, send: () => {} });
    session.receive(packet(0, Array(32).fill(0), 1, -40));
    for (let i = 0; i < 21; i++) expect(session.tick(0)).toBe(true);
    const poll = vi.fn(() => IN_ATK);
    expect(session.tick(poll)).toBe(false);
    expect(session.stats.syncSkips).toBe(1);
    expect(poll).not.toHaveBeenCalled();
    expect(session.tick(poll)).toBe(true);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('polls against the corrected state after rollback', () => {
    const sim = new Sim(0, 1);
    sim.skipIntro();
    const session = new RollbackSession(sim, { local: 0, inputDelay: 0, send: () => {} });
    session.tick(0);
    session.receive(packet(0, [IN_ATK]));
    session.tick(() => {
      expect(sim.s.f[1].prevIn).toBe(IN_ATK);
      expect(session.stats.rollbacks).toBe(1);
      return 0;
    });
  });

  it('uses an out-of-order input without waiting for the missing earlier packet', () => {
    const sim = new Sim(0, 1);
    sim.skipIntro();
    const session = new RollbackSession(sim, { local: 0, inputDelay: 0, send: () => {} });
    session.tick(0);
    session.receive(packet(1, [IN_ATK]));
    session.tick(0);
    expect(session.remoteConfirmed).toBe(-1);
    expect(sim.s.f[1].prevIn).toBe(IN_ATK);
    session.receive(packet(0, [0]));
    session.tick(0);
    expect(session.stats.rollbacks).toBe(0);
  });

  it('corrects an already simulated out-of-order frame immediately', () => {
    const sim = new Sim(0, 1);
    sim.skipIntro();
    const session = new RollbackSession(sim, { local: 0, inputDelay: 0, send: () => {} });
    session.tick(0); session.tick(0);
    session.receive(packet(1, [IN_ATK]));
    session.tick(0);
    expect(session.stats.rollbacks).toBe(1);
    const ref = new Sim(0, 1);
    ref.skipIntro();
    ref.step(0, 0); ref.step(0, IN_ATK); ref.step(0, 0);
    expect(hashState(sim.s)).toBe(hashState(ref.s));
  });

  it('ignores truncated packets without advancing acknowledgements', () => {
    const session = new RollbackSession(new Sim(0, 1), { local: 0, inputDelay: 0, send: () => {} });
    const valid = packet(0, [IN_ATK]);
    for (let n = 0; n < valid.length; n++) expect(() => session.receive(valid.subarray(0, n))).not.toThrow();
    expect(session.remoteConfirmed).toBe(-1);
  });
});

// Two peers, real input queues, delayed/lost/reordered datagrams; react to the
// defender's observed block, not the attacker's authoritative frame.
function counterMatch(delay: number, latency: number, reaction: number, jitter = false) {
  const scenes = [new Scenario('blaze', 'bastion', 1.6, { inputDelay: delay }), new Scenario('blaze', 'bastion', 1.6, { inputDelay: delay })];
  const q: { at: number; to: number; data: Uint8Array }[] = [];
  let now = 0, observed = -1, pressed = false, move = -1, serial = 0;
  const sessions = scenes.map((sc, local) => new RollbackSession(sc.sim, {
    local: local as 0 | 1, inputDelay: delay,
    send: p => {
      serial++;
      if (jitter && serial % 11 === 0) return; // deterministic ~9% loss
      q.push({ at: now + latency + (jitter ? serial % 4 : 0), to: 1 - local, data: p.slice() });
    },
  }));
  for (const session of sessions) session.rttFrames = latency * 2;
  for (now = 0; now < 200; now++) {
    for (let i = q.length - 1; i >= 0; i--) if (q[i].at <= now) {
      const p = q.splice(i, 1)[0]; sessions[p.to].receive(p.data);
    }
    sessions[0].tick(() => sessions[0].frame === 20 ? IN_ATK : 0);
    sessions[1].tick(() => {
      const s = scenes[1].s;
      if (observed < 0 && s.f[1].statBlocks) observed = s.frame;
      if (!pressed && observed >= 0 && s.frame - observed + 1 >= reaction) { pressed = true; return IN_ATK; }
      return 0;
    });
    for (const e of scenes[1].sim.events) if (e.type === EV_MOVE && e.who === 1) move = e.a;
  }
  expect(sessions[0].stats.desyncs + sessions[1].stats.desyncs).toBe(0);
  expect(sessions[0].stats.checksumsCompared + sessions[1].stats.checksumsCompared).toBeGreaterThan(0);
  return { defender: scenes[1], move };
}

describe('same guard-counter deadline online and offline', () => {
  for (const delay of [0, 1, 2, 3]) for (const latency of [0, 3, 6]) {
    it(`10F press punishes, 11F press is guarded (delay ${delay}, latency ${latency})`, () => {
      const fast = counterMatch(delay, latency, 10);
      expect(fast.move).toBe(fast.defender.sim.char(1).fastGc);
      expect(fast.defender.s.f[0].statHitsTaken).toBe(1);
      expect(fast.defender.s.f[0].statBlocks).toBe(0);
      const late = counterMatch(delay, latency, 11);
      expect(late.move).toBe(M_GC);
      expect(late.defender.s.f[0].statHitsTaken).toBe(0);
      expect(late.defender.s.f[0].statBlocks).toBe(1);
    });
  }

  it('keeps the deadline with jitter, loss and reordering', () => {
    const fast = counterMatch(3, 4, 10, true);
    expect(fast.move).toBe(fast.defender.sim.char(1).fastGc);
    expect(fast.defender.s.f[0].statHitsTaken).toBe(1);
  });

  it('does not turn a pre-contact press into a counter; compensation survives rollback and rounds', () => {
    const sc = new Scenario('blaze', 'bastion', 1.6, { inputDelay: 3 });
    const attack = sequence('A', 0);
    while (sc.s.f[1].st !== ST_BLOCKSTUN) sc.tick(attack, guard);
    sc.tick(guard, () => IN_ATK); // applied at +1, sampled at -2
    expect(sc.s.f[1].gcQueued).toBe(0);
    sc.tick(guard, guard);
    const snapshot = saveState(sc.s, new Int32Array(SNAPSHOT_SIZE));
    sc.s.gcInputDelay = 0;
    loadState(sc.s, snapshot);
    expect(sc.s.gcInputDelay).toBe(3);
    sc.sim.startRound(false);
    expect(sc.s.gcInputDelay).toBe(3);
  });
});
