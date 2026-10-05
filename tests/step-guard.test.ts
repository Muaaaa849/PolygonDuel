import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/data/characters';
import { Scenario, stick, guard, IN_STEP, IN_ATK } from './harness';
import { IN_GUARD } from '../src/core/input';
import { ST_STEP, ST_FREE, ST_BLOCKSTUN, ST_HITSTUN, saveState, loadState, SNAPSHOT_SIZE, hashState } from '../src/core/state';
import { SYSTEM } from '../src/data/system';

describe.each(CHARACTERS)('$id — step guard', (character) => {
  it.each([false, true])('keeps remaining step travel when entering guard (manual=%s)', (manual) => {
    const reference = new Scenario(character.id, 'blaze', 8);
    const sliding = new Scenario(character.id, 'blaze', 8);
    sliding.s.f[0].manualGuard = manual ? 1 : 0;
    for (let t = 0; t < SYSTEM.step.total + 3; t++) {
      reference.tick(() => t >= SYSTEM.step.total ? 0 : stick(0) | (t === 0 ? IN_STEP : 0), guard);
      sliding.tick(() => t === 0 ? stick(0) | IN_STEP : t < 2 ? stick(0) : manual ? IN_GUARD | stick(0) : 0, guard);
      if (t === 1) expect(sliding.s.f[0].st).toBe(ST_STEP);
      if (t === 2) {
        expect(sliding.s.f[0].st).toBe(ST_FREE);
        expect(sliding.s.f[0].guardF).toBe(1);
      }
      if (t === 3) expect(sliding.s.f[0].guardF).toBeGreaterThanOrEqual(SYSTEM.guard.startup);
      // Not just a fixed total: the original deceleration curve is kept frame for frame.
      expect(sliding.s.f[0].x).toBe(reference.s.f[0].x);
      expect(sliding.s.f[0].y).toBe(reference.s.f[0].y);
    }
    expect(sliding.s.f[0].momStep).toBe(0);
    expect(sliding.s.f[0].steps).toBe(reference.s.f[0].steps);
  });
});

it('manual guard requires GUARD, not merely releasing the stick', () => {
  const sc = new Scenario('blaze', 'bastion', 8);
  sc.s.f[0].manualGuard = 1;
  sc.run(6, (_me, _op, _s, t) => t === 0 ? IN_STEP | stick(0) : 0, guard);
  expect(sc.s.f[0].st).toBe(ST_STEP);
  expect(sc.s.f[0].guardF).toBe(0);
});

it('guard can also cancel step recovery after its travel has ended', () => {
  const sc = new Scenario('blaze', 'bastion', 8);
  sc.run(12, (_me, _op, _s, t) => t === 0 ? IN_STEP | stick(0) : t < 11 ? stick(0) : 0, guard);
  expect(sc.s.f[0].st).toBe(ST_FREE);
  expect(sc.s.f[0].guardF).toBe(1);
});

it('waking-up boosted step keeps its boosted travel through guard', () => {
  const sc = new Scenario('blaze', 'bastion', 8);
  const ref = new Scenario('blaze', 'bastion', 8);
  sc.s.f[0].wakeBoost = ref.s.f[0].wakeBoost = 180;
  for (let t = 0; t < 12; t++) {
    sc.tick(() => t === 0 ? IN_STEP | stick(0) : t < 2 ? stick(0) : 0, guard);
    ref.tick(() => stick(0) | (t === 0 ? IN_STEP : 0), guard);
    expect(sc.s.f[0].x).toBe(ref.s.f[0].x);
  }
  expect(sc.s.f[0].stepPct).toBe(SYSTEM.wakeStep.pct);
});

it('a sliding guard blocks an incoming normal and still moves during blockstun', () => {
  const sc = new Scenario('bastion', 'blaze', 1.1);
  for (let t = 0; t < 25; t++) {
    sc.tick(() => t === 0 ? IN_ATK : 0, () => t === 14 ? IN_STEP | stick(0) : t === 15 ? stick(0) : 0);
    if (sc.s.f[1].st === ST_BLOCKSTUN && sc.s.f[1].momStep > 0) {
      const x = sc.s.f[1].x;
      while (sc.s.hitstop) sc.tick(guard, guard);
      sc.tick(guard, guard);
      expect(sc.s.f[1].x).toBeGreaterThan(x);
      expect(sc.hits(0).length).toBe(0);
      return;
    }
  }
  throw new Error('normal did not contact the sliding guard');
});

it('losing guard to movement ends guard momentum', () => {
  const sc = new Scenario('blaze', 'bastion', 8);
  sc.tick(() => IN_STEP | stick(0), guard);
  sc.tick(() => stick(0), guard);
  sc.tick(guard, guard);
  expect(sc.s.f[0].momStep).toBeGreaterThan(0);
  sc.tick(() => stick(8), guard);
  expect(sc.s.f[0].guardF).toBe(0);
  expect(sc.s.f[0].momStep).toBe(0);
});

it('being hit clears sliding momentum and snapshot restoration preserves it before impact', () => {
  const sc = new Scenario('blaze', 'bastion', 8);
  sc.tick(() => IN_STEP | stick(0), guard);
  sc.tick(() => stick(0), guard);
  sc.tick(guard, guard);
  const snapshot = saveState(sc.s, new Int32Array(SNAPSHOT_SIZE));
  const replay = () => { for (let i = 0; i < 20; i++) sc.sim.step(0, 0); return hashState(sc.s); };
  const expected = replay();
  loadState(sc.s, snapshot);
  expect(replay()).toBe(expected);
  loadState(sc.s, snapshot);
  sc.s.f[0].st = ST_HITSTUN;
  sc.s.f[0].len = 20;
  sc.tick(guard, guard);
  expect(sc.s.f[0].momStep).toBe(0);
});
