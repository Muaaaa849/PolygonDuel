// Aimed presses (hold → drag → release on touch): direction + reach level ride on the press.
import { describe, expect, it } from 'vitest';
import { Scenario, stick, IN_ATK, type Bot } from './harness';
import { IN_S1, aimBits, aimAngle, aimLevel } from '../src/core/input';
import { u } from '../src/core/fixed';
import { ST_ATTACK } from '../src/core/state';
import { Sim } from '../src/core/sim';
import { charIndex } from '../src/data/characters';
import { hashState } from '../src/core/state';

const idle: Bot = (_m, _o, _s, t) => stick(t % 20 < 10 ? 8 : 24); // shuffles in place, never guards

describe('aimed presses', () => {
  it('encodes 64 directions and 4 reach levels', () => {
    for (const [d, l] of [[0, 0], [17, 3], [63, 1]]) {
      const w = aimBits(d, l) | IN_ATK;
      expect(aimAngle(w)).toBe(d * 16);
      expect(aimLevel(w)).toBe(l);
    }
    expect(aimAngle(IN_ATK)).toBe(-1);
  });

  it('an aimed attack faces exactly the aimed direction and does not home', () => {
    const sc = new Scenario('blaze', 'bastion', 3);
    // opponent is to the right (angle 0); aim straight up (dir 48 = 768)
    const facings: number[] = [];
    sc.run(18, (me, _o, _s, t) => {
      if (me.st === ST_ATTACK) facings.push(me.facing);
      return t === 0 ? IN_ATK | aimBits(48, 3) : 0;
    }, () => 0);
    expect(facings.length).toBeGreaterThan(8);
    expect(new Set(facings)).toEqual(new Set([768]));
  });

  it('an unaimed attack still homes toward the opponent', () => {
    const sc = new Scenario('blaze', 'bastion', 3);
    sc.s.f[1].y += u(1.5);
    let last = -1;
    sc.run(12, (me, _o, _s, t) => {
      if (me.st === ST_ATTACK) last = me.facing;
      return t === 0 ? IN_ATK | stick(0) : 0;
    }, () => 0);
    expect(last).toBeGreaterThan(0);
  });

  it('attack while retreating: stick held away, aim toward the opponent', () => {
    const sc = new Scenario('blaze', 'bastion', 2);
    let moveFacing = -1;
    sc.run(40, (me, _o, _s, t) => {
      if (me.st === ST_ATTACK && moveFacing < 0) moveFacing = me.facing;
      // retreat left for 6 frames, then fire aimed right while still holding left
      return stick(16) | (t === 6 ? IN_ATK | aimBits(0, 3) : 0);
    }, idle);
    expect(moveFacing).toBe(0);
    expect(sc.hits(0).length).toBe(1);
  });

  it('reach level scales a dash (flare rush)', () => {
    const dash = (level: number) => {
      const sc = new Scenario('blaze', 'bastion', 8);
      const x0 = sc.s.f[0].x;
      sc.run(30, (_m, _o, _s, t) => (t === 0 ? IN_S1 | aimBits(0, level) : 0), () => 0);
      return sc.s.f[0].x - x0;
    };
    const full = dash(3);
    const short = dash(0);
    expect(full).toBeGreaterThan(u(2.9));
    expect(short).toBeLessThan(full * 0.45);
    expect(short).toBeGreaterThan(full * 0.35);
  });

  it('aim bits are deterministic (same inputs → same hash)', () => {
    const run = () => {
      const sim = new Sim(charIndex('zephyr'), charIndex('blaze'));
      sim.skipIntro();
      for (let t = 0; t < 600; t++) {
        const a = t % 37 === 0 ? IN_ATK | aimBits(t % 64, t % 4) : stick(t % 32);
        const b = t % 53 === 0 ? IN_S1 | aimBits((t * 7) % 64, 2) : stick((t * 3) % 32);
        sim.step(a, b);
      }
      return hashState(sim.s);
    };
    expect(run()).toBe(run());
  });
});
