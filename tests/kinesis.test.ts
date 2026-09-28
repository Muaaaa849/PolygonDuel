// キネシス（念動力）: 3段目はその場でダウン、S1サイコプル（引き寄せ・反転・1コンボ1回）、
// S2サイコバースト（周囲・ガードで無効・ダウン中にも当たって吹き飛ばす・壁）。
import { describe, expect, it } from 'vitest';
import { Scenario, sequence, guard, stick, hold, type Bot, IN_ATK, IN_S1, IN_S2, IN_STEP } from './harness';
import { getChar } from '../src/core/sim';
import { charIndex } from '../src/data/characters';
import { M_N1, M_N2, M_N3, M_S1, M_S2 } from '../src/core/compile';
import { u } from '../src/core/fixed';
import { SYSTEM } from '../src/data/system';
import { EV_PULL, EV_KNOCKDOWN, EV_JUST, EV_WALL, EV_BLOCK } from '../src/core/events';
import { ST_ATTACK, ST_FREE, ST_HITSTUN } from '../src/core/state';

const K = getChar(charIndex('kinesis'));
const hitThenGuard: Bot = (me) => (me.statHitsTaken > 0 ? 0 : stick(16));
const dist = (sc: Scenario) => Math.hypot(sc.s.f[0].x - sc.s.f[1].x, sc.s.f[0].y - sc.s.f[1].y) / 1000;
/** The defender never got free between the first and the last hit. */
function oneCombo(sc: Scenario): boolean {
  const h = sc.hits(0);
  return sc.freeAt[1].filter((f) => f > h[0].lf && f < h[h.length - 1].lf).length === 0;
}

describe('キネシス', () => {
  it('shortest reach (shorter than Volt), average speed, heavy normals', () => {
    const volt = getChar(charIndex('volt'));
    const blaze = getChar(charIndex('blaze'));
    expect(K.moves[M_N1].reach).toBeLessThan(volt.moves[M_N1].reach);
    expect(K.def.walk).toBeGreaterThanOrEqual(4.6);
    expect(K.def.walk).toBeLessThanOrEqual(4.8);
    for (const m of [M_N1, M_N2, M_N3]) expect(K.moves[m].dmg).toBeGreaterThan(blaze.moves[m].dmg);
  });

  it('N3 knocks down in place (no launch)', () => {
    const sc = new Scenario('kinesis', 'blaze', 1.4);
    let x0 = 0;
    sc.run(200, sequence('AAA'), (me, op) => {
      if (op.move === M_N3 && op.sf === K.moves[M_N3].S - 1) x0 = me.x;
      return me.statHitsTaken > 0 ? 0 : stick(16);
    });
    expect(sc.events(EV_KNOCKDOWN, 1).length).toBe(1);
    expect(Math.abs(sc.s.f[1].x - x0)).toBeLessThan(u(0.1));
  });

  it('1→2→3→S2: the burst hits the downed target and throws it away', () => {
    const sc = new Scenario('kinesis', 'bastion', 1.4);
    sc.s.f[0].cost = 16;
    sc.run(300, sequence('AAA2'), hitThenGuard);
    expect(sc.hits(0).length).toBe(4);
    expect(sc.hits(0).map((e) => e.a)).toEqual([52, 46, 80, 40]); // 4th hit 80%
    expect(sc.events(EV_KNOCKDOWN, 1).length).toBe(2); // N3 in place, then the burst's throw
    expect(dist(sc)).toBeGreaterThan(5);
  });

  it('S1 from afar pulls the target in front of her → 1→2→3→S2 is one combo', () => {
    const sc = new Scenario('kinesis', 'bastion', 6);
    sc.s.f[0].cost = 16;
    let pulledTo = -1;
    sc.run(400, sequence('1AAA2'), (me, op) => {
      if (pulledTo < 0 && me.st === ST_HITSTUN && me.kbDist === 0 && op.st === ST_ATTACK && op.move === M_N1) pulledTo = dist(sc);
      return hitThenGuard(me, op, sc.s, 0);
    });
    expect(sc.events(EV_PULL, 0).map((e) => e.a)).toEqual([0]);
    expect(pulledTo).toBeGreaterThan(1.0);
    expect(pulledTo).toBeLessThan(1.5);
    expect(sc.hits(0).length).toBe(5);
    expect(oneCombo(sc)).toBe(true);
  });

  it('1→2→S1→1→2→3→S2 is one combo (the pull extends it once)', () => {
    const sc = new Scenario('kinesis', 'bastion', 1.4);
    sc.s.f[0].cost = 16;
    sc.run(500, sequence('AA1AAA2'), hitThenGuard);
    expect(sc.moves(0).map((e) => e.a)).toEqual([M_N1, M_N2, M_S1, M_N1, M_N2, M_N3, M_S2]);
    expect(sc.hits(0).length).toBe(7);
    expect(oneCombo(sc)).toBe(true);
  });

  it('only one pull per combo: 1→2→S1→1→2→S1 → the 2nd pull is a light hit and the combo ends', () => {
    const sc = new Scenario('kinesis', 'bastion', 1.4);
    sc.s.f[0].cost = 16;
    sc.run(400, sequence('AA1AA1AAA'), hitThenGuard);
    expect(sc.events(EV_PULL, 0).map((e) => e.a)).toEqual([0, 2]);
    // the N1 after the 2nd S1 is guarded (the loop does not go on)
    expect(sc.blocks(0).length).toBeGreaterThan(0);
  });

  it('a target in a normal-attack motion (even its startup) reverses the pull and combos her', () => {
    // Blaze starts N1 just before the pull arrives
    const sc = new Scenario('kinesis', 'blaze', 4.5);
    sc.s.f[0].cost = 16;
    sc.run(200, (_m, _o, _s, t) => (t === 0 ? IN_S1 : 0), (me, op, _s, t) => {
      if (me.st === ST_FREE && op.move === M_S1 && op.sf === K.moves[M_S1].proj!.at + 2 && me.statHitsTaken === 0) return IN_ATK;
      return me.move === M_N1 || me.move === M_N2 ? (t % 2 ? IN_ATK : 0) : 0;
    });
    expect(sc.events(EV_PULL, 0).map((e) => e.a)).toEqual([1]);
    expect(sc.hits(0).length).toBe(0);
    expect(sc.hits(1).length).toBe(3); // Blaze's 1→2→3 on the dragged-in caster
  });

  it('guard stops the pull; stepping into it is no bullet-just (it is not a diamond)', () => {
    const g = new Scenario('kinesis', 'blaze', 4);
    g.run(60, (_m, _o, _s, t) => (t === 0 ? IN_S1 : 0), guard);
    expect(g.events(EV_BLOCK, 0).length).toBe(1);
    expect(g.events(EV_PULL, 0).length).toBe(0);
    expect(dist(g)).toBeGreaterThan(3.5);
    const st = new Scenario('kinesis', 'blaze', 4);
    st.run(60, (_m, _o, _s, t) => (t === 0 ? IN_S1 : 0), (me, op) => (op.move === M_S1 && op.sf === 12 && me.st === ST_FREE ? IN_STEP | stick(16) : stick(16)));
    expect(st.events(EV_JUST, 1).length).toBe(0);
    expect(st.events(EV_PULL, 0).map((e) => e.a)).toEqual([0]);
  });

  it('S2: guarded = no effect; it hits all around (behind too); off center it slams into the wall', () => {
    const g = new Scenario('kinesis', 'blaze', 1.5);
    g.run(60, (_m, _o, _s, t) => (t === 0 ? IN_S2 : 0), guard);
    expect(g.events(EV_BLOCK, 0).length).toBe(1);
    expect(g.events(EV_KNOCKDOWN, 1).length).toBe(0);
    // behind: Kinesis faces away (stick to the left) and bursts
    const b = new Scenario('kinesis', 'blaze', 1.5);
    b.s.f[0].facing = 512;
    b.run(60, (_m, _o, _s, t) => (t === 0 ? IN_S2 | stick(16) : 0), hold(stick(8)));
    expect(b.hits(0).length).toBe(1);
    expect(b.events(EV_KNOCKDOWN, 1).length).toBe(1);
    // 3u off center toward the right wall → thrown into it
    const w = new Scenario('kinesis', 'blaze', 1.5);
    const shift = u(3);
    w.s.f[0].x += shift;
    w.s.f[1].x += shift;
    w.run(60, (_m, _o, _s, t) => (t === 0 ? IN_S2 : 0), hold(stick(8)));
    expect(w.events(EV_WALL, 1).length).toBe(1);
    expect(u(SYSTEM.field.w) - w.s.f[1].x).toBeLessThan(u(0.6));
  });

  it('damage: S1→1→2→3→S2 and 1→2→S1→1→2→3→S2', () => {
    const a = new Scenario('kinesis', 'bastion', 6);
    a.s.f[0].cost = 16;
    a.run(400, sequence('1AAA2'), hitThenGuard);
    // 20 + 52 + 46 + 80×0.8 + 50×0.7
    expect(a.hits(0).map((e) => e.a)).toEqual([20, 52, 46, 64, 35]);
    const b = new Scenario('kinesis', 'bastion', 1.4);
    b.s.f[0].cost = 16;
    b.run(500, sequence('AA1AAA2'), hitThenGuard);
    // 52 + 46 + 20 + 52×0.8 + 46×0.7 + 80×0.6 + 50×0.6
    expect(b.hits(0).map((e) => e.a)).toEqual([52, 46, 20, 41, 32, 48, 30]);
  });
});
