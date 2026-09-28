// v0.7 tempo rules: fast startups, short whiff recovery, step → attack with momentum,
// a short guard gauge that every blocked attack refills.
import { describe, expect, it } from 'vitest';
import { Scenario, stick, IN_ATK, IN_S2, IN_STEP, type Bot } from './harness';
import { getChar } from '../src/core/sim';
import { CHARACTERS, charIndex } from '../src/data/characters';
import { M_N1, M_S2 } from '../src/core/compile';
import { EV_CRUSH, EV_GUARD_BREAK } from '../src/core/events';
import { ST_ATTACK, ST_FREE, ST_STEP, ST_STUN } from '../src/core/state';
import { SYSTEM } from '../src/data/system';

describe('tempo', () => {
  it.each(CHARACTERS.map((c) => c.id))('%s: N1 starts around the edge of human reaction + online delay (15–21F, v0.9)', (id) => {
    const n1 = getChar(charIndex(id)).moves[M_N1];
    expect(n1.S).toBeGreaterThanOrEqual(15);
    expect(n1.S).toBeLessThanOrEqual(21);
  });

  it.each(CHARACTERS.map((c) => c.id))('%s: a whiffed N1 recovers faster than a blocked one', (id) => {
    const n1 = getChar(charIndex(id)).moves[M_N1];
    expect(n1.whiffT).toBeLessThan(n1.T);
    // whiff: nobody in range
    const whiff = new Scenario(id, 'bastion', 6).run(80, (_m, _o, _s, t) => (t === 0 ? IN_ATK : 0), () => 0);
    // blocked
    const block = new Scenario(id, 'bastion', 1.6).run(80, (_m, _o, _s, t) => (t === 0 ? IN_ATK : 0), () => 0);
    expect(block.blocks(0).length).toBe(1);
    expect(whiff.freeAt[0][0]).toBe(n1.whiffT + 1);
    expect(block.freeAt[0][0]).toBe(n1.T + 1);
  });

  it('step → attack: cancels from step frame 3 and keeps the step momentum', () => {
    const run = (stepFirst: boolean) => {
      const sc = new Scenario('blaze', 'bastion', 8);
      const x0 = sc.s.f[0].x;
      let started = -1;
      sc.run(40, (me, _o, _s, t) => {
        if (me.st === ST_ATTACK && started < 0) started = t;
        if (!stepFirst) return t === 0 ? IN_ATK | stick(0) : 0;
        if (t === 0) return IN_STEP | stick(0);
        return t === 1 ? IN_ATK | stick(0) : 0;
      }, () => 0);
      return { travel: sc.s.f[0].x - x0, started };
    };
    const plain = run(false);
    const stepped = run(true);
    // the attack came out of the step on its 3rd frame, not after the step
    expect(stepped.started).toBeLessThanOrEqual(3);
    // and travelled (almost) a whole step farther than a standing attack
    const step = CHARACTERS[charIndex('blaze')].step.dist * 1000;
    expect(stepped.travel - plain.travel).toBeGreaterThan(step * 0.9);
  });

  it('step → guard break works as a mixup (the step-in GB crushes a guard)', () => {
    const sc = new Scenario('blaze', 'bastion', 4.4);
    sc.run(120, (me, _o, _s, t) => (t === 0 ? IN_STEP | stick(0) : me.st === ST_STEP ? IN_S2 | stick(0) : 0), () => 0);
    expect(sc.moves(0).some((e) => e.a === M_S2)).toBe(true);
    expect(sc.events(EV_CRUSH, 0).length).toBe(1);
  });

  it.each(CHARACTERS.map((c) => c.id))('%s: idle guarding breaks after the gauge (~1.5s)', (id) => {
    const c = CHARACTERS[charIndex(id)];
    const sc = new Scenario(id, 'blaze', 2).run(200, () => 0, (_m, _o, _s, t) => stick(t % 40 < 20 ? 8 : 24)); // (stays within 5u)
    const br = sc.events(EV_GUARD_BREAK, 0);
    expect(br.length).toBe(1);
    expect(br[0].lf).toBeGreaterThanOrEqual(c.guardMax - 2);
    expect(br[0].lf).toBeLessThanOrEqual(c.guardMax + 4);
    expect(c.guardMax).toBeGreaterThanOrEqual(90);
    expect(c.guardMax).toBeLessThanOrEqual(110);
  });

  it('blocking refills the gauge: a defender who keeps blocking attacks never breaks', () => {
    // Blaze pokes N1 every 60F for 6 seconds; Bastion (90F-ish gauge) just guards
    const poke: Bot = (me, _o, _s, t) => (me.st === ST_FREE && t % 60 === 0 ? IN_ATK : 0);
    const sc = new Scenario('blaze', 'phantom', 1.6).run(360, poke, () => 0);
    expect(sc.blocks(0).length).toBeGreaterThanOrEqual(5);
    expect(sc.events(EV_GUARD_BREAK, 1).length).toBe(0);
    expect(sc.s.f[1].st).not.toBe(ST_STUN);
    void SYSTEM;
  });
});
