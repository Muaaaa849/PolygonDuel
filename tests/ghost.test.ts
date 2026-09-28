// Phantom's illusion (S1 ゴースト): a decoy the opponent sees as the real piece.
import { describe, expect, it } from 'vitest';
import { Scenario, stick, IN_ATK, IN_S1, IN_S2, guard, type Bot } from './harness';
import { u } from '../src/core/fixed';
import { EV_GHOST, EV_GHOST_END, EV_HIT, EV_CRUSH } from '../src/core/events';
import { ST_ATTACK, ST_STEP } from '../src/core/state';
import { COST_UNIT, M_N1 } from '../src/core/compile';
import { getChar } from '../src/core/sim';
import { charIndex } from '../src/data/characters';

const idle: Bot = () => stick(8) & 0; // stands (guards)

describe('ghost (illusion)', () => {
  it('out of range: the decoy steps in toward the opponent while the real one stays', () => {
    const sc = new Scenario('phantom', 'blaze', 5);
    const x0 = sc.s.f[0].x;
    let maxDecoyX = 0;
    let decoyStepped = false;
    sc.run(40, (_m, _o, _s, t) => (t === 0 ? IN_S1 : 0), idle);
    // replay to observe
    const sc2 = new Scenario('phantom', 'blaze', 5);
    for (let t = 0; t < 40; t++) {
      sc2.tick((_m, _o, _s, tt) => (tt === 0 ? IN_S1 : 0), idle);
      const d = sc2.sim.decoyOf(0);
      if (d) {
        maxDecoyX = Math.max(maxDecoyX, d.x);
        if (d.st === ST_STEP) decoyStepped = true;
      }
    }
    expect(sc.events(EV_GHOST, 0)[0].a).toBe(1);
    expect(decoyStepped).toBe(true);
    // stopped ~1.5u short of the opponent, real one never moved
    expect(maxDecoyX).toBeGreaterThan(sc.s.f[1].x - u(1.7));
    expect(maxDecoyX).toBeLessThan(sc.s.f[1].x - u(1.3));
    expect(sc.s.f[0].x).toBe(x0);
    // ~0.5s later it is gone (timed out), no damage dealt
    expect(sc.events(EV_GHOST_END, 0)[0].a).toBe(0);
    expect(sc.s.f[1].hp).toBe(900);
    expect(sc.s.f[0].cost).toBe(0);
  });

  it('in range: the decoy swings N1, passes through without damage, then dissolves', () => {
    const sc = new Scenario('phantom', 'blaze', 1.8);
    let decoyAttacked = false;
    for (let t = 0; t < 60; t++) {
      sc.tick((_m, _o, _s, tt) => (tt === 0 ? IN_S1 : 0), idle);
      if (sc.sim.decoyOf(0)?.st === ST_ATTACK) decoyAttacked = true;
    }
    expect(sc.events(EV_GHOST, 0)[0].a).toBe(2);
    expect(decoyAttacked).toBe(true);
    expect(sc.hits(0).length).toBe(0);
    expect(sc.blocks(0).length).toBe(0);
    const end = sc.events(EV_GHOST_END, 0)[0];
    expect(end.a).toBe(0);
    // dissolves right after its fake blade passes through (N1's S + A)
    const pn1 = getChar(charIndex('phantom')).moves[M_N1];
    expect(end.lf).toBeGreaterThanOrEqual(pn1.S + pn1.A - 2);
    expect(end.lf).toBeLessThanOrEqual(pn1.S + pn1.A + 8);
  });

  it('the real one moves freely during the illusion', () => {
    const sc = new Scenario('phantom', 'blaze', 5);
    const y0 = sc.s.f[0].y;
    sc.run(28, (_m, _o, _s, t) => (t === 0 ? IN_S1 : stick(8)), idle);
    expect(sc.s.f[0].y).toBeGreaterThan(y0 + u(0.8));
    expect(sc.s.f[0].ghostT).toBeGreaterThan(0);
  });

  it('attacking with the real one reveals it (ends the illusion)', () => {
    const sc = new Scenario('phantom', 'blaze', 5);
    sc.run(30, (_m, _o, _s, t) => (t === 0 ? IN_S1 : t === 14 ? IN_ATK : 0), idle);
    expect(sc.events(EV_GHOST_END, 0)[0].a).toBe(1);
  });

  it("an attack touching the decoy dissolves it (and doesn't hit anyone)", () => {
    const sc = new Scenario('phantom', 'blaze', 5);
    // blaze swings early so its blade meets the incoming decoy
    sc.run(60, (_m, _o, _s, t) => (t === 0 ? IN_S1 : stick(16)), (_m, _o, _s, t) => (t === 2 ? IN_ATK | stick(16) : 0));
    const end = sc.events(EV_GHOST_END, 0)[0];
    expect(end.a).toBe(2);
    expect(sc.hits(1).length).toBe(0);
    // baited: half the cost (1.0) comes back
    expect(sc.s.f[0].cost).toBe(COST_UNIT);
  });

  it('bait → guard → soul ripper crush (the intended combo, cost 4)', () => {
    const sc = new Scenario('phantom', 'blaze', 1.9);
    sc.s.f[0].cost = 4 * COST_UNIT;
    sc.run(200, (_m, _o, _s, t) => (t === 0 ? IN_S1 : t === 12 ? IN_S2 | stick(0) : t > 60 && t % 4 === 0 ? IN_ATK : 0), guard);
    expect(sc.events(EV_CRUSH, 0).length).toBe(1);
    expect(sc.events(EV_HIT, 0).length).toBeGreaterThanOrEqual(3);
  });

  it('cannot stack a second illusion while one is active', () => {
    const sc = new Scenario('phantom', 'blaze', 5);
    sc.s.f[0].cost = 4 * COST_UNIT;
    sc.run(40, (_m, _o, _s, t) => (t === 0 || t === 12 ? IN_S1 : 0), idle);
    expect(sc.events(EV_GHOST, 0).length).toBe(1);
  });
});
