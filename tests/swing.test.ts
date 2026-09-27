// Swing (fan) attacks and hurt-side cost gain.
import { describe, expect, it } from 'vitest';
import { Scenario, sequence, stick, IN_ATK, type Bot } from './harness';
import { u, ANG } from '../src/core/fixed';
import { M_N1, M_N3, COST_UNIT } from '../src/core/compile';
import { getChar } from '../src/core/sim';
import { charIndex } from '../src/data/characters';
import { ST_ATTACK } from '../src/core/state';

const stand: Bot = (_m, _o, _s, t) => stick(t % 20 < 10 ? 8 : 24); // shuffle, never guards

/** Put the defender at `deg` relative to the attacker's facing (+ = attacker's right), distance `dist`. */
function place(sc: Scenario, deg: number, dist: number) {
  const [a, d] = sc.s.f;
  a.facing = 0;
  const r = (deg * Math.PI) / 180;
  d.x = a.x + Math.round(Math.cos(r) * dist * 1000);
  d.y = a.y + Math.round(Math.sin(r) * dist * 1000);
}

describe('swing attacks', () => {
  it('a 1st hit catches a target 65° to the side (homing alone could not)', () => {
    const sc = new Scenario('blaze', 'bastion', 1.6);
    place(sc, 65, 1.6);
    // attack without stick: auto-faces the target, so turn it away first via homing limits
    sc.s.f[0].facing = 0;
    sc.run(40, (me, _o, _s, t) => (t === 0 ? IN_ATK | stick(0) : 0), stand);
    expect(sc.hits(0).length).toBe(1);
  });

  it('right-first swing reaches the right side on its first active frame, the left side later', () => {
    const hitFrame = (deg: number) => {
      const sc = new Scenario('blaze', 'bastion', 1.8);
      place(sc, deg, 1.8);
      let at = -1;
      sc.run(40, (me, _o, _s, t) => {
        if (me.st === ST_ATTACK && me.moveHit && at < 0) at = me.moveHitAt;
        return t === 0 ? IN_ATK | stick(0) : 0;
      }, () => 0);
      return at;
    };
    const n1 = getChar(charIndex('blaze')).moves[M_N1];
    expect(n1.sweepFrom).toBeGreaterThan(0); // blaze swings from the right
    const right = hitFrame(60);
    const left = hitFrame(-60);
    expect(right).toBe(n1.S);
    expect(left).toBeGreaterThan(n1.S);
  });

  it('zephyr swings from the left', () => {
    expect(getChar(charIndex('zephyr')).moves[M_N1].sweepFrom).toBeLessThan(0);
  });

  it('the 3rd hit is a full spin (covers behind)', () => {
    const n3 = getChar(charIndex('blaze')).moves[M_N3];
    expect(Math.abs(n3.sweepTo - n3.sweepFrom)).toBe(ANG);
  });

  it('straight thrust skills do not sweep (Zephyr lance misses a side target)', () => {
    const sc = new Scenario('zephyr', 'bastion', 2);
    place(sc, 70, 2);
    sc.run(60, (_m, _o, _s, t) => (t === 0 ? (1 << 7) | stick(0) : 0), stand);
    expect(sc.hits(0).length).toBe(0);
  });
});

describe('cost', () => {
  it('the attacker gains 0.5 per contact and the hurt side 0.25 per hit (caps 1.5 / 0.75)', () => {
    const sc = new Scenario('blaze', 'bastion', 1.6);
    const start = sc.s.f.map((f) => f.cost);
    sc.run(300, sequence('AAA'), (me) => (me.statHitsTaken > 0 ? 0 : stick(16)));
    expect(sc.hits(0).length).toBe(3);
    expect(sc.s.f[0].cost - start[0]).toBe(1.5 * COST_UNIT);
    expect(sc.s.f[1].cost - start[1]).toBe(0.75 * COST_UNIT);
  });
});
void u;
