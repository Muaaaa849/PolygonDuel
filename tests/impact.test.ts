// Wall impacts and the just-dodge slow motion → teleporting just attack.
import { describe, expect, it } from 'vitest';
import { Scenario, stick, IN_ATK, IN_STEP, type Bot } from './harness';
import { u } from '../src/core/fixed';
import { SYSTEM } from '../src/data/system';
import { EV_BLINK, EV_HIT, EV_JUST, EV_WALL, HF_JA } from '../src/core/events';
import { ST_ATTACK } from '../src/core/state';
import { getChar } from '../src/core/sim';
import { charIndex } from '../src/data/characters';
import { M_N1 } from '../src/core/compile';

const zn1 = getChar(charIndex('zephyr')).moves[M_N1];

const guardless: Bot = (_m, _o, _s, t) => stick(t % 20 < 10 ? 8 : 24);

describe('wall impact', () => {
  it('a 3rd hit launching the opponent into the edge deals extra damage', () => {
    const run = (nearWall: boolean) => {
      const sc = new Scenario('blaze', 'bastion', 1.6);
      if (nearWall) {
        sc.s.f[1].x = u(SYSTEM.field.w) - u(0.9);
        sc.s.f[0].x = sc.s.f[1].x - u(1.6);
      }
      // mash ATK from 1st hit to 3rd (the defender never guards), then stop (no okizeme)
      sc.run(160, (_m, _o, _s, t) => (t % 4 === 0 && t < 70 ? IN_ATK : 0), guardless);
      return { hp: sc.s.f[1].hp, walls: sc.events(EV_WALL) };
    };
    const open = run(false);
    const wall = run(true);
    expect(open.walls.length).toBe(0);
    expect(wall.walls.length).toBeGreaterThanOrEqual(1);
    expect(wall.walls.length).toBeLessThanOrEqual(SYSTEM.wall.perCombo);
    expect(wall.walls[0].a).toBeGreaterThanOrEqual(SYSTEM.wall.dmg);
    expect(wall.hp).toBeLessThan(open.hp);
    expect(open.hp - wall.hp).toBe(wall.walls.reduce((n, e) => n + e.a, 0));
  });

  it('blocked pushback into the edge does nothing', () => {
    const sc = new Scenario('bastion', 'blaze', 1.8);
    sc.s.f[1].x = u(SYSTEM.field.w) - u(0.55);
    sc.s.f[0].x = sc.s.f[1].x - u(1.8);
    sc.run(80, (_m, _o, _s, t) => (t === 0 ? IN_ATK : 0), () => 0);
    expect(sc.events(EV_WALL).length).toBe(0);
  });
});

describe('just dodge', () => {
  it('slows time, then ATK blinks in front of the opponent and the JA always connects', () => {
    // defender steps away from a far attack at the edge of the step's just frames; press ATK late in the slow-mo
    const sc = new Scenario('zephyr', 'blaze', 2.2);
    let pressedAt = -1;
    sc.run(
      200,
      (_m, _o, _s, t) => (t === 0 ? IN_ATK | stick(0) : 0),
      (me, op, s, t) => {
        // step back just as the swing lands
        if (me.st === 0 && op.st === ST_ATTACK && op.sf === zn1.S - 1) return IN_STEP | stick(16);
        if (s.slow > 0 && s.slow < 8 && pressedAt < 0) {
          pressedAt = t;
          return IN_ATK;
        }
        return 0;
      },
    );
    const just = sc.events(EV_JUST);
    expect(just.length).toBe(1);
    const blink = sc.events(EV_BLINK, 1);
    expect(blink.length).toBe(1);
    const ja = sc.events(EV_HIT, 1).filter((e) => e.b & HF_JA);
    expect(ja.length).toBeGreaterThanOrEqual(1);
  });
});
