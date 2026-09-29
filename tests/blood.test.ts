// ブラッド（自傷・過負荷）: S1 血の代償（体力→コスト、長押し、3秒CT、動けるのは移動だけ）、
// S2 オーバードライブ（コストが燃料・超強化・ガード3秒・ATK長押しでGB・燃え尽き後の弱体と歩行不能）。
import { describe, expect, it } from 'vitest';
import { Scenario, sequence, stick, guard, type Bot, IN_ATK, IN_S1, IN_S2, IN_STEP } from './harness';
import { getChar } from '../src/core/sim';
import { charIndex } from '../src/data/characters';
import { M_N1, M_N2, M_N3, M_S1, M_S2, SH, COST_UNIT } from '../src/core/compile';
import { EV_CHARGE, EV_DRIVE, EV_CRUSH, EV_GUARD_BREAK, EV_KNOCKDOWN } from '../src/core/events';
import { ST_ATTACK, ST_DOWN, ST_FREE, ST_STUN } from '../src/core/state';

const B = getChar(charIndex('blood'));
const held = (btn: number, from: number, to: number, base = 0): Bot => (_m, _o, _s, t) => (t >= from && t < to ? base | btn : base);
const q = (units: number) => units * COST_UNIT;
const idle: Bot = guard;
/** A bot that acts on ticks relative to the moment it is made (Scenario's tick counter keeps running across run() calls). */
const later = (sc: Scenario, fn: (k: number) => number): Bot => {
  const t0 = sc.t;
  return (_m, _o, _s, t) => fn(t - t0);
};

describe('ブラッド', () => {
  it('normals are weaker than Blaze: less damage and reach, more HP', () => {
    const blaze = getChar(charIndex('blaze'));
    for (const m of [M_N1, M_N2, M_N3]) {
      expect(B.moves[m].dmg).toBeLessThan(blaze.moves[m].dmg);
      expect(B.moves[m].reach).toBeLessThan(blaze.moves[m].reach);
    }
    expect(B.def.hp).toBeGreaterThan(blaze.def.hp);
  });

  describe('S1 血の代償', () => {
    it('costs 0 cost, pays 80 HP for +1.5 cost the moment it is pressed; a tap holds it for the minimum only', () => {
      const sc = new Scenario('blood', 'bastion', 8);
      sc.s.f[0].cost = q(2);
      sc.run(14, held(IN_S1, 0, 2), idle);
      expect(sc.s.f[0].hp).toBe(B.def.hp - 80);
      expect(sc.s.f[0].cost).toBe(q(2) + 6);
      expect(sc.s.f[0].st).toBe(ST_FREE);
      const c = sc.events(EV_CHARGE, 0);
      expect(c.length).toBe(1);
      expect([c[0].a, c[0].b]).toEqual([80, 6]);
    });

    it('holding turns life into cost every 20F (20 HP → +0.25) until the cost is full', () => {
      const sc = new Scenario('blood', 'bastion', 8);
      sc.s.f[0].cost = 0;
      sc.run(400, held(IN_S1, 0, 400), idle);
      const c = sc.events(EV_CHARGE, 0);
      // 80 HP (+1.5) then 20 HP (+0.25) per tick: 6 + 10 ticks = 16 quarters = the full cost 4
      expect(c.length).toBe(1 + 10);
      expect(sc.s.f[0].cost).toBe(q(4));
      expect(sc.s.f[0].hp).toBe(B.def.hp - 80 - 200);
      expect(sc.s.f[0].st).toBe(ST_FREE); // full → it stops by itself
    });

    it('while held only walking (−30%) works: ATK / S2 / step are ignored', () => {
      const walked = (btns: number, n = 30) => {
        const sc = new Scenario('blood', 'bastion', 8);
        sc.s.f[0].cost = 0;
        const y0 = sc.s.f[0].y;
        sc.run(n, (_m, _o, _s, t) => stick(8) | (t < 1 ? IN_S1 : 0) | (btns && t < 1 ? 0 : 0) | (t >= 1 ? IN_S1 | btns : 0), idle);
        return { dy: sc.s.f[0].y - y0, sc };
      };
      const free = new Scenario('blood', 'bastion', 8);
      const fy = free.s.f[0].y;
      free.run(30, () => stick(8), idle);
      const base = free.s.f[0].y - fy;
      const plain = walked(0);
      expect(plain.sc.s.f[0].move).toBe(M_S1);
      // 29 frames of walking at 70% (the press frame only starts it)
      expect(plain.dy).toBeGreaterThan(base * 0.62);
      expect(plain.dy).toBeLessThan(base * 0.72);
      // pressing every other action changes nothing
      const spam = walked(IN_ATK | IN_S2 | IN_STEP);
      expect(spam.sc.s.f[0].move).toBe(M_S1);
      expect(spam.sc.s.f[0].st).toBe(ST_ATTACK);
      expect(spam.dy).toBe(plain.dy);
    });

    it('a 3 s cooldown starts when it ends: it cannot be restarted for 180F', () => {
      const sc = new Scenario('blood', 'bastion', 8);
      sc.s.f[0].cost = 0;
      // mash S1 every 4 frames for 400F
      sc.run(400, (_m, _o, _s, t) => (t % 4 === 0 ? IN_S1 : 0), idle);
      const starts = sc.events(EV_CHARGE, 0).filter((e) => e.a === 80);
      expect(starts.length).toBeGreaterThanOrEqual(2);
      const gap = starts[1].lf - starts[0].lf;
      expect(gap).toBeGreaterThanOrEqual(180 + 6);
      expect(gap).toBeLessThan(180 + 8 + 12);
    });

    it('being hit ends it (the cooldown still runs) and it is not free of risk', () => {
      const sc = new Scenario('blood', 'bastion', 1.4);
      sc.s.f[0].cost = 0;
      sc.run(120, held(IN_S1, 0, 120), sequence('A'));
      expect(sc.hits(1).length).toBeGreaterThan(0);
      expect(sc.s.f[0].move).not.toBe(M_S1);
      expect(sc.s.f[0].s1Cd).toBeGreaterThan(0);
    });

    it('can charge while the opponent lies invulnerable (v1.6 lock: no attack / skill / step — but this one is no attack)', () => {
      const sc = new Scenario('blood', 'blaze', 2);
      sc.s.f[0].cost = 0;
      const d = sc.s.f[1];
      d.st = ST_DOWN;
      d.sf = 1;
      d.len = 75;
      d.downAge = 40; // past the OTG window: everything else is locked out
      sc.run(20, (_m, _o, _s, t) => (t < 4 ? IN_ATK : 0), idle);
      expect(sc.s.f[0].st).toBe(ST_FREE); // the attack did not start
      sc.run(30, later(sc, () => IN_S1), idle);
      expect(sc.events(EV_CHARGE, 0).length).toBeGreaterThanOrEqual(2); // the charge did, and keeps ticking
      expect(sc.s.f[0].move).toBe(M_S1);
    });

    it('never pays the last HP and is unavailable at full cost / in the overdrive', () => {
      const a = new Scenario('blood', 'bastion', 8);
      a.s.f[0].hp = 60;
      a.run(20, held(IN_S1, 0, 20), idle);
      expect(a.s.f[0].hp).toBe(60);
      expect(a.events(EV_CHARGE, 0).length).toBe(0);
      const b = new Scenario('blood', 'bastion', 8);
      b.s.f[0].cost = q(4);
      b.run(20, held(IN_S1, 0, 20), idle);
      expect(b.events(EV_CHARGE, 0).length).toBe(0);
      const c = new Scenario('blood', 'bastion', 8);
      c.s.f[0].cost = q(2);
      c.s.f[0].drive = 1;
      c.run(20, held(IN_S1, 0, 20), idle);
      expect(c.events(EV_CHARGE, 0).length).toBe(0);
    });
  });

  describe('S2 オーバードライブ', () => {
    it('needs at least 1 cost; starts on its 10th frame and burns 1 quarter per 75F (cost 4 = 20 s)', () => {
      const no = new Scenario('blood', 'bastion', 8);
      no.s.f[0].cost = q(0.5);
      no.run(60, held(IN_S2, 0, 2), idle);
      expect(no.s.f[0].drive).toBe(0);
      expect(no.events(EV_DRIVE, 0).length).toBe(0);

      const sc = new Scenario('blood', 'bastion', 8);
      sc.s.f[0].cost = q(4);
      sc.run(2000, held(IN_S2, 0, 2), idle, () => sc.s.f[0].exhaust > 0);
      const ev = sc.events(EV_DRIVE, 0);
      expect(ev[0].a).toBe(1);
      expect(ev[1].a).toBe(0);
      const secs = (ev[1].lf - ev[0].lf) / 60;
      expect(secs).toBeGreaterThan(19.9);
      expect(secs).toBeLessThan(20.1);
      expect(sc.s.f[0].cost).toBe(0);
    });

    it('half the fuel lasts half as long (cost 2 = 10 s)', () => {
      const sc = new Scenario('blood', 'bastion', 8);
      sc.s.f[0].cost = q(2);
      sc.run(2000, held(IN_S2, 0, 2), idle, () => sc.s.f[0].exhaust > 0);
      const ev = sc.events(EV_DRIVE, 0);
      expect((ev[1].lf - ev[0].lf) / 60).toBeCloseTo(10, 0);
    });

    it('cannot be canceled, stacked, or refilled: no cost is gained while it burns', () => {
      const sc = new Scenario('blood', 'bastion', 1.4);
      sc.s.f[0].cost = q(3);
      sc.s.f[0].drive = 1;
      const before = sc.s.f[0].cost;
      // press S2 again and hit things: the cost only goes down
      sc.run(60, (_m, _o, _s, t) => (t % 4 === 0 ? IN_S2 : t % 4 === 2 ? IN_ATK : 0), (me) => (me.statHitsTaken > 0 ? 0 : stick(16)));
      expect(sc.hits(0).length).toBeGreaterThan(0);
      expect(sc.s.f[0].cost).toBeLessThanOrEqual(before);
      expect(sc.events(EV_DRIVE, 0).length).toBe(0); // (drive was set directly: no second start)
    });

    it('+60% damage: 1→2→3 = 54+48+86 (instead of 34+30+54)', () => {
      const run = (drive: number) => {
        const sc = new Scenario('blood', 'bastion', 1.4);
        sc.s.f[0].drive = drive;
        sc.s.f[0].cost = q(4);
        sc.run(300, sequence('AAA'), (me) => (me.statHitsTaken > 0 ? 0 : stick(16)));
        return sc.hits(0).map((e) => e.a);
      };
      expect(run(0)).toEqual([34, 30, 54]);
      expect(run(1)).toEqual([54, 48, 86]);
    });

    it('+30% reach: hits from a distance the plain N1 cannot reach', () => {
      const N1 = B.moves[M_N1];
      const far = (N1.reach + N1.lunge) / 1000 + 0.5 + 0.3; // just past the plain max
      const plain = new Scenario('blood', 'bastion', far);
      plain.run(60, sequence('A'), idle);
      expect(plain.hits(0).length + plain.blocks(0).length).toBe(0);
      const od = new Scenario('blood', 'bastion', far);
      od.s.f[0].drive = 1;
      od.s.f[0].cost = q(4);
      od.run(60, sequence('A'), idle);
      expect(od.hits(0).length + od.blocks(0).length).toBe(1);
    });

    it('+40% walking speed', () => {
      const dist = (drive: number) => {
        const sc = new Scenario('blood', 'bastion', 8);
        sc.s.f[0].drive = drive;
        sc.s.f[0].cost = q(4);
        const y0 = sc.s.f[0].y;
        sc.run(30, () => stick(8), idle);
        return sc.s.f[0].y - y0;
      };
      expect(dist(1) / dist(0)).toBeGreaterThan(1.38);
      expect(dist(1) / dist(0)).toBeLessThan(1.42);
    });

    it('the guard gauge lasts 3 s instead of 1.5 s', () => {
      const breakAt = (drive: number) => {
        const sc = new Scenario('blood', 'bastion', 3);
        sc.s.f[0].drive = drive;
        sc.s.f[0].cost = q(4);
        sc.run(400, idle, idle);
        return sc.events(EV_GUARD_BREAK, 0)[0]?.lf ?? 999;
      };
      const plain = breakAt(0);
      const od = breakAt(1);
      expect(plain).toBeGreaterThan(80);
      expect(plain).toBeLessThan(100);
      expect(od).toBeGreaterThan(170);
      expect(od).toBeLessThan(190);
    });

    it('S1 is the 30F guard break while it burns (no life charge)', () => {
      const sc = new Scenario('blood', 'bastion', 2.5);
      sc.s.f[0].drive = 1;
      sc.s.f[0].cost = q(4);
      const hp = sc.s.f[0].hp;
      let shape = -1;
      sc.run(60, (me, _o, _s, t) => {
        if (t === 12) shape = me.st === ST_ATTACK ? getChar(me.char).moves[me.move].shape : -1;
        return t < 2 ? IN_S1 : 0;
      }, idle);
      expect(shape).toBe(SH.triangle);
      expect(sc.events(EV_CHARGE, 0).length).toBe(0);
      expect(sc.s.f[0].hp).toBe(hp);
      expect(sc.events(EV_CRUSH, 0)[0].lf).toBe(30);
    });

    it('ATK held 12F in a row → a 30F heavy blow that is guardable but throws even a guard 3.5u; a tap / a mash stays normal', () => {
      const tap = new Scenario('blood', 'bastion', 2.5);
      tap.s.f[0].drive = 1;
      tap.s.f[0].cost = q(4);
      tap.run(50, held(IN_ATK, 0, 3), idle);
      expect(tap.blocks(0).length).toBe(1);
      expect(tap.s.f[0].move).not.toBe(getChar(charIndex('blood')).moves.findIndex((m) => m.id === 'driveHeavy'));

      // a mash: presses every other frame for 60F — the hold never reaches 12F, so no heavy blow
      const mashed = new Scenario('blood', 'bastion', 2.5);
      mashed.s.f[0].drive = 1;
      mashed.s.f[0].cost = q(4);
      const heavyIdx = getChar(charIndex('blood')).moves.findIndex((m) => m.id === 'driveHeavy');
      let sawHeavy = false;
      mashed.run(120, (me, _o, _s, t) => {
        if (me.st === ST_ATTACK && me.move === heavyIdx) sawHeavy = true;
        return t < 100 && t % 2 === 0 ? IN_ATK : 0;
      }, idle);
      expect(sawHeavy).toBe(false);
      expect(mashed.events(EV_CRUSH, 0).length).toBe(0);

      // a 3-frames-on / 1-frame-off "stutter hold" also never reaches 12
      const stutter = new Scenario('blood', 'bastion', 2.5);
      stutter.s.f[0].drive = 1;
      stutter.s.f[0].cost = q(4);
      let sawHeavy2 = false;
      stutter.run(120, (me, _o, _s, t) => {
        if (me.st === ST_ATTACK && me.move === heavyIdx) sawHeavy2 = true;
        return t < 100 && t % 4 !== 3 ? IN_ATK : 0;
      }, idle);
      expect(sawHeavy2).toBe(false);

      // a real hold: heavy, 30F from the press, guardable, thrown far
      const sc = new Scenario('blood', 'bastion', 2.5);
      sc.s.f[0].drive = 1;
      sc.s.f[0].cost = q(4);
      const bx = sc.s.f[1].x;
      let shape = -1;
      sc.run(90, (me, _o, _s, t) => {
        if (t === 14) shape = me.st === ST_ATTACK ? getChar(me.char).moves[me.move].id === 'driveHeavy' ? SH.circle : -2 : -1;
        return t < 40 ? IN_ATK : 0;
      }, idle);
      expect(shape).toBe(SH.circle);
      const blk = sc.blocks(0);
      expect(blk.length).toBe(1);
      expect(blk[0].lf).toBe(30);
      expect((sc.s.f[1].x - bx) / 1000).toBeGreaterThan(3); // even guarded, 3.5u away
      // unguarded: 90 × 1.6 and a knockdown
      const open = new Scenario('blood', 'bastion', 2.5);
      open.s.f[0].drive = 1;
      open.s.f[0].cost = q(4);
      open.run(90, (_m, _o, _s, t) => (t < 40 ? IN_ATK : 0), (me) => (me.statHitsTaken > 0 ? 0 : stick(16)));
      expect(open.hits(0)[0].a).toBe(144);
      expect(open.events(EV_KNOCKDOWN, 1).length).toBe(1);
    });

    it('when the fuel is gone: 10 s of exhaustion (no new drive, −20% damage) and 3 s in which only steps move it', () => {
      const sc = new Scenario('blood', 'bastion', 8);
      sc.s.f[0].drive = 1;
      sc.s.f[0].cost = q(0.25);
      sc.run(80, idle, idle);
      expect(sc.s.f[0].drive).toBe(0);
      expect(sc.s.f[0].exhaust).toBeGreaterThan(500);
      expect(sc.s.f[0].noWalk).toBeGreaterThan(90);
      // walking does nothing…
      const x0 = sc.s.f[0].x;
      const y0 = sc.s.f[0].y;
      sc.run(30, () => stick(8), idle);
      expect(sc.s.f[0].y).toBe(y0);
      expect(sc.s.f[0].x).toBe(x0);
      // …a step still moves it
      sc.run(20, later(sc, (k) => (k === 0 ? IN_STEP | stick(8) : 0)), idle);
      expect(sc.s.f[0].y).toBeGreaterThan(y0 + 1000);
      // after 3 s it walks again
      sc.run(200, idle, idle);
      const y1 = sc.s.f[0].y;
      sc.run(20, () => stick(8), idle);
      expect(sc.s.f[0].y).toBeGreaterThan(y1);
      // S2 is locked for the whole exhaustion, even with the fuel
      sc.s.f[0].cost = q(4);
      sc.run(20, later(sc, (k) => (k < 2 ? IN_S2 : 0)), idle);
      expect(sc.s.f[0].drive).toBe(0);
      expect(sc.s.f[0].st).toBe(ST_FREE);
      // and it hits softer: 34 → 27
      const soft = new Scenario('blood', 'bastion', 1.4);
      soft.s.f[0].exhaust = 500;
      soft.run(120, sequence('A'), (me) => (me.statHitsTaken > 0 ? 0 : stick(16)));
      expect(soft.hits(0)[0].a).toBe(27);
      // the exhaustion wears off (+ a notice) after its 600F
      const done = new Scenario('blood', 'bastion', 8);
      done.s.f[0].exhaust = 30;
      done.run(40, idle, idle);
      expect(done.events(EV_DRIVE, 0).map((e) => e.a)).toEqual([2]);
      expect(done.s.f[0].exhaust).toBe(0);
    });

    it('is reset every round', () => {
      const sc = new Scenario('blood', 'bastion', 8);
      const f = sc.s.f[0];
      f.drive = 1;
      f.exhaust = 100;
      f.noWalk = 50;
      f.s1Cd = 90;
      sc.sim.startRound(false);
      expect([f.drive, f.exhaust, f.noWalk, f.s1Cd]).toEqual([0, 0, 0, 0]);
      expect(M_S2).toBeGreaterThan(0);
      expect(ST_STUN).toBeGreaterThan(0);
    });
  });
});
