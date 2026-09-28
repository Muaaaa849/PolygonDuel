// v0.7 tempo rules: fast startups, short whiff recovery, step → attack with momentum,
// a short guard gauge that every blocked attack refills.
import { describe, expect, it } from 'vitest';
import { Scenario, stick, sequence, IN_ATK, IN_S2, IN_STEP, type Bot } from './harness';
import { getChar, CTL_FACE_FOE, CTL_MANUAL_GUARD } from '../src/core/sim';
import { CHARACTERS, charIndex } from '../src/data/characters';
import { M_N1, M_N3, M_S1, M_S2 } from '../src/core/compile';
import { EV_CRUSH, EV_GUARD_BREAK } from '../src/core/events';
import { ST_ATTACK, ST_DOWN, ST_FREE, ST_STEP, ST_STUN, ST_WAKE } from '../src/core/state';
import { SYSTEM } from '../src/data/system';
import { IN_GUARD } from '../src/core/input';

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

describe('guard setting (v0.9)', () => {
  it('manual guard: standing still does not guard; holding GUARD does (even with the stick)', () => {
    const atk: Bot = (_m, _o, _s, t) => (t === 0 ? IN_ATK : 0);
    // standing still, no GUARD → the hit lands
    const a = new Scenario('blaze', 'bastion', 1.6);
    a.sim.setControlModes([0, 1]);
    a.run(60, atk, () => 0);
    expect(a.hits(0).length).toBe(1);
    // GUARD held while pushing the stick → blocked
    const b = new Scenario('blaze', 'bastion', 1.6);
    b.sim.setControlModes([0, 1]);
    b.run(60, atk, () => IN_GUARD | stick(8));
    expect(b.blocks(0).length).toBe(1);
    // standing still in manual mode never drains the gauge
    const c = new Scenario('blaze', 'bastion', 2);
    c.sim.setControlModes([0, 1]);
    c.run(200, () => 0, () => 0);
    expect(c.events(EV_GUARD_BREAK, 1).length).toBe(0);
    expect(c.events(EV_GUARD_BREAK, 0).length).toBe(1); // (the auto side idles in guard and breaks)
    // auto mode ignores the GUARD bit: walking with it held is still walking
    const d = new Scenario('blaze', 'bastion', 1.6);
    d.run(60, atk, () => IN_GUARD | stick(8));
    expect(d.hits(0).length).toBe(1);
  });

  it('the guard mode survives into the next round', () => {
    const sc = new Scenario('blaze', 'bastion', 2);
    sc.sim.setControlModes([1, 0]);
    sc.s.f[1].hp = 0;
    sc.run(400, () => 0, () => 0, () => sc.s.round === 2);
    expect(sc.s.round).toBe(2);
    expect(sc.s.f[0].manualGuard).toBe(1);
  });

  it('v1.2 attack direction: with CTL_FACE_FOE an attack pressed while moving swings at the opponent', () => {
    // walking down (stick 8 = +y), then ATK without aim; the opponent is to the right
    const walkAtk: Bot = (_m, _o, _s, t) => stick(8) | (t === 5 ? IN_ATK : 0);
    const foe = new Scenario('blaze', 'bastion', 2);
    foe.sim.setControlModes([CTL_FACE_FOE, 0]);
    foe.run(40, walkAtk, () => 0);
    expect(foe.blocks(0).length + foe.hits(0).length).toBe(1);
    // the stick setting: the swing goes where you walk (down) and misses
    const st = new Scenario('blaze', 'bastion', 2);
    st.run(40, walkAtk, () => 0);
    expect(st.blocks(0).length + st.hits(0).length).toBe(0);
    // the bits are independent and kept per fighter
    const both = new Scenario('blaze', 'bastion', 2);
    both.sim.setControlModes([CTL_FACE_FOE | CTL_MANUAL_GUARD, CTL_FACE_FOE]);
    expect([both.s.f[0].faceFoe, both.s.f[0].manualGuard, both.s.f[1].faceFoe, both.s.f[1].manualGuard]).toEqual([1, 1, 1, 0]);
  });

  it('v1.2 costs: Ray static field 2, Bastion riposte 2', () => {
    expect(getChar(charIndex('ray')).moves[M_S2].cost).toBe(2 * 4);
    expect(getChar(charIndex('bastion')).moves[M_S1].cost).toBe(2 * 4);
  });

  it.each(CHARACTERS.map((c) => c.id))('v1.4 %s: the combo-ending N3 that hits recovers in half (a guarded one keeps its full recovery)', (id) => {
    const c = getChar(charIndex(id));
    const n3 = c.moves[M_N3];
    const act = n3.S + n3.A - 1;
    expect(n3.hitT).toBe(act + Math.ceil((n3.T - act) / 2));
    const hitThenGuard: Bot = (me) => (me.statHitsTaken > 0 ? 0 : stick(16));
    const sc = new Scenario(id, 'bastion', 1.4);
    let start = -1;
    const seq = sequence('AAA');
    sc.run(300, (me, o, s, t) => {
      if (start < 0 && me.st === ST_ATTACK && me.move === M_N3) start = sc.lf - 1;
      return seq(me, o, s, t);
    }, hitThenGuard);
    expect(sc.hits(0).length).toBe(3);
    const free = sc.freeAt[0].find((f) => f > start)!;
    expect(free - start).toBe(n3.hitT + 1); // free on sf = hitT + 1 (was T + 1)
  });

  it('v1.4.2: after getting up, the first step within 3 seconds travels 1.5× as far — then steps are normal again', () => {
    const run = (boost: boolean, steps: number) => {
      const sc = new Scenario('blaze', 'zephyr', 6);
      if (boost) sc.s.f[0].wakeBoost = SYSTEM.wakeStep.frames;
      const d: number[] = [];
      for (let k = 0; k < steps; k++) {
        const y0 = sc.s.f[0].y;
        sc.run(20, (_m, _o, _s, t) => (t === 20 * k ? IN_STEP | stick(k % 2 ? 24 : 8) : 0), () => 0);
        d.push(Math.abs(sc.s.f[0].y - y0));
      }
      return { d, sc };
    };
    const normal = run(false, 1).d[0];
    const boosted = run(true, 2);
    expect(boosted.d[0] / normal).toBeGreaterThan(1.45);
    expect(boosted.d[0] / normal).toBeLessThan(1.55);
    expect(boosted.d[1]).toBe(normal); // used up by the first step
    expect(boosted.sc.s.f[0].wakeBoost).toBe(0);
    // the bonus starts when the wake-up ends and runs out after SYSTEM.wakeStep.frames
    const sc = new Scenario('blaze', 'blaze', 1.4);
    sc.run(300, sequence('AAA'), (me) => (me.statHitsTaken > 0 ? 0 : stick(16)));
    const df = sc.s.f[1];
    expect(df.st === ST_DOWN || df.st === ST_WAKE).toBe(false);
    expect(df.wakeBoost).toBeGreaterThan(0);
    sc.run(SYSTEM.wakeStep.frames, () => 0, () => 0);
    expect(sc.s.f[1].wakeBoost).toBe(0);
  });
});
