// ミラー（瞬間移動・分身）: S1 ミラーステップ（0F・攻撃中も・連続可・相手の向こうへ抜ける）、
// S2 ミラーイメージ（分身が同時に攻撃・0.75倍・コスト無し・当たらない・20秒）／分身中のS2＝入れ替え（硬直キャンセル・ガードされたら不可）。
import { describe, expect, it } from 'vitest';
import { Scenario, sequence, guard, stick, type Bot, IN_ATK, IN_S1, IN_S2 } from './harness';
import { getChar } from '../src/core/sim';
import { charIndex } from '../src/data/characters';
import { M_N1, M_N2, M_N3, M_S1, M_S2, COST_UNIT } from '../src/core/compile';
import { u } from '../src/core/fixed';
import { SYSTEM } from '../src/data/system';
import { EV_TELEPORT, EV_CLONE, EV_SWAP, EV_WALL, HF_CLONE } from '../src/core/events';
import { ST_ATTACK, ST_FREE, ST_HITSTUN, MH_HIT, cloneState, hashState } from '../src/core/state';

const M = getChar(charIndex('mirror'));
const blaze = getChar(charIndex('blaze'));
const q = (units: number) => units * COST_UNIT;
const later = (sc: Scenario, fn: (k: number) => number): Bot => {
  const t0 = sc.t;
  return (_m, _o, _s, t) => fn(t - t0);
};
/** A defender that is not guarding (walks into the attacker) until it is hit. */
const open: Bot = (me) => (me.statHitsTaken > 0 ? 0 : stick(16));
/** Stands without guarding (shuffles up and down). */
const shuffle: Bot = (_m, _o, _s, t) => stick(t % 24 < 12 ? 8 : 24);
/** The defender never got free between two logical frames. */
const neverFree = (sc: Scenario, a: number, b: number) => sc.freeAt[1].filter((f) => f > a && f < b).length === 0;

describe('ミラー', () => {
  it('low HP and damage, a slightly long reach; hit stun +6F (N2 recovery +6F keeps C3)', () => {
    expect(M.hp).toBeLessThan(blaze.hp);
    for (const m of [M_N1, M_N2, M_N3]) {
      expect(M.moves[m].dmg).toBeLessThan(blaze.moves[m].dmg);
      expect(M.moves[m].reach).toBeGreaterThan(blaze.moves[m].reach);
    }
    expect(M.moves[M_N1].hitstun).toBe(blaze.moves[M_N1].hitstun + 6);
    expect(M.moves[M_N2].hitstun).toBe(blaze.moves[M_N2].hitstun + 6);
    expect(M.moves[M_N2].T).toBe(blaze.moves[M_N2].T + 6);
    expect(M.moves[M_S1].cost).toBe(q(1.5));
    expect(M.moves[M_S2].cost).toBe(q(2.5));
    expect(M.moves[M.swapSlot].cost).toBe(q(1));
  });

  describe('S1 ミラーステップ', () => {
    it('1.5u along the stick on the frame it is pressed (cost 1.5), without starting a move', () => {
      const sc = new Scenario('mirror', 'bastion', 6);
      const { x, y } = sc.s.f[0];
      sc.run(1, () => IN_S1 | stick(8), guard);
      expect(sc.s.f[0].y - y).toBeGreaterThanOrEqual(1500); // (+ this frame's walk: the stick is held)
      expect(sc.s.f[0].y - y).toBeLessThan(1600);
      expect(sc.s.f[0].x).toBe(x);
      expect(sc.s.f[0].st).toBe(ST_FREE);
      expect(sc.s.f[0].cost).toBe(q(0.5));
      expect(sc.events(EV_TELEPORT, 0).length).toBe(1);
    });

    it('as many in a row as the cost allows (10F apart: a double press within 10F pays once)', () => {
      const sc = new Scenario('mirror', 'bastion', 8);
      sc.s.f[0].cost = q(4);
      sc.run(30, (_m, _o, _s, t) => (t === 0 || t === 4 || t === 12 ? IN_S1 | stick(24) : stick(24) & 0), guard);
      expect(sc.events(EV_TELEPORT, 0).length).toBe(2);
      expect(sc.s.f[0].cost).toBe(q(1));
      sc.run(20, (_m, _o, _s, t) => (t % 12 === 0 ? IN_S1 | stick(8) : 0), guard);
      expect(sc.events(EV_TELEPORT, 0).length).toBe(2); // (1 left: not enough)
    });

    it('during an attack: an N1 swung out of range lands after a teleport in (the swing goes on, turned to the opponent)', () => {
      const run = (tp: boolean) => {
        const sc = new Scenario('mirror', 'bastion', 4.6);
        sc.run(60, (me, _o, _s, t) => (t === 0 ? IN_ATK : tp && me.st === ST_ATTACK && me.move === M_N1 && me.sf === 9 ? IN_S1 | stick(0) : 0), shuffle);
        return sc;
      };
      expect(run(false).hits(0).length).toBe(0);
      const sc = run(true);
      expect(sc.events(EV_TELEPORT, 0).length).toBe(1);
      expect(sc.hits(0).length).toBe(1);
    });

    it('not while being hit or in guard stun', () => {
      const sc = new Scenario('mirror', 'blaze', 1.6);
      sc.s.f[0].cost = q(4);
      sc.run(60, (me) => (me.st === ST_HITSTUN ? IN_S1 | stick(16) : 0), sequence('A'));
      expect(sc.events(EV_TELEPORT, 0).length).toBe(0);
    });

    it('1 → S1 → 2 → 3: a teleport between the hits keeps the combo, and goes through the opponent (behind it)', () => {
      const sc = new Scenario('mirror', 'bastion', 1.6);
      let tp = false;
      const bot: Bot = (me, _op, _s, t) => {
        if (!tp && me.move === M_N1 && me.moveHit === MH_HIT && me.sf === 24) {
          tp = true;
          return IN_S1 | stick(0);
        }
        return t === 0 || (tp && t % 2) ? IN_ATK : 0;
      };
      sc.run(260, bot, open);
      expect(sc.s.f[0].x).toBeGreaterThan(sc.s.f[1].x); // behind it now
      const h = sc.hits(0);
      expect(h.length).toBe(3);
      expect(sc.events(EV_TELEPORT, 0).length).toBe(1);
      expect(neverFree(sc, h[0].lf, h[2].lf)).toBe(true);
      void bot;
    });

    it('1 → 2 → S1 → 3 also combos', () => {
      const sc = new Scenario('mirror', 'bastion', 1.6);
      let tp = false;
      sc.run(260, (me, _o, _s, t) => {
        if (!tp && me.move === M_N2 && me.moveHit === MH_HIT && me.sf === 22) {
          tp = true;
          return IN_S1 | stick(0);
        }
        return t % 2 ? IN_ATK : 0;
      }, open);
      const h = sc.hits(0);
      expect(h.length).toBe(3);
      expect(neverFree(sc, h[0].lf, h[2].lf)).toBe(true);
    });

    it('with her back to the wall: 1 → S1 through the opponent → 2 → 3 slams it into that wall', () => {
      const sc = new Scenario('mirror', 'bastion', 1.5);
      sc.s.f[0].x = u(0.6);
      sc.s.f[1].x = u(2.1);
      let tp = false;
      sc.run(300, (me, _o, _s, t) => {
        if (!tp && me.move === M_N1 && me.moveHit === MH_HIT && me.sf === 24) {
          tp = true;
          return IN_S1 | stick(0);
        }
        return t === 0 || (tp && t % 2) ? IN_ATK : 0;
      }, open);
      expect(sc.hits(0).length).toBe(3);
      expect(sc.s.f[0].x).toBeGreaterThan(sc.s.f[1].x); // the places are swapped
      expect(sc.events(EV_WALL, 1).length).toBe(1);
    });
  });

  describe('S2 ミラーイメージ・入れ替え', () => {
    /** Puts the clone out with a tap of S2 and waits until it is there. */
    const withClone = (sc: Scenario, opBot: Bot = guard) => {
      sc.s.f[0].cost = q(4);
      sc.run(40, (_m, _o, _s, t) => (t === 0 ? IN_S2 : 0), opBot, () => sc.s.f[0].cloneT > 0 && sc.s.f[0].st === ST_FREE);
    };

    it('a tap puts the clone on the far side of the opponent (mirrored, ≤2.5u from it); cost 2.5; 15 s', () => {
      const sc = new Scenario('mirror', 'bastion', 3);
      withClone(sc);
      const f = sc.s.f[0];
      const o = sc.s.f[1];
      expect(sc.events(EV_CLONE, 0)[0].a).toBe(1);
      expect(f.cloneX - o.x).toBe(2500);
      expect(f.cloneY).toBe(o.y);
      expect(f.cost).toBe(q(1.5));
      sc.run(930, shuffle, shuffle);
      expect(sc.events(EV_CLONE, 0).map((e) => e.a)).toEqual([1, 0]);
      expect(sc.s.f[0].cloneT).toBe(0);
    });

    it('an aimed press puts it where it was aimed (full reach = 6u)', () => {
      const sc = new Scenario('mirror', 'bastion', 3);
      sc.s.f[0].cost = q(4);
      const aimUp = IN_S2 | (1 << 10) | (192 << 11) | (3 << 19) | (31 << 22); // aim 270° (up), level 3, fine distance 31
      sc.s.f[0].y = u(SYSTEM.field.h) - u(1);
      sc.run(30, (_m, _o, _s, t) => (t === 0 ? aimUp : 0), guard);
      expect(sc.s.f[0].y - sc.s.f[0].cloneY).toBeGreaterThan(5900);
      expect(Math.abs(sc.s.f[0].cloneX - sc.s.f[0].x)).toBeLessThan(100);
    });

    it('the clone swings along with every normal (turned to the opponent), 75% damage, no cost for the owner', () => {
      const sc = new Scenario('mirror', 'bastion', 3);
      withClone(sc, shuffle);
      // the real one is out of reach: only the clone (moved 1.4u from the target: its reach is half) can land
      sc.s.f[0].x = sc.s.f[1].x - u(5);
      sc.s.f[0].cloneX = sc.s.f[1].x + u(1.4);
      const cost = sc.s.f[0].cost;
      sc.run(40, later(sc, (k) => (k < 2 ? IN_ATK : 0)), shuffle, () => sc.hits(0).length > 0);
      const h = sc.hits(0);
      expect(h.length).toBe(1);
      expect(h[0].b & HF_CLONE).toBeTruthy();
      expect(h[0].a).toBe(Math.trunc((38 * 75) / 100));
      expect(sc.s.f[0].cost).toBe(cost);
    });

    it('the clone swings with half the reach (v1.9b): 2.4u away it misses what the real one would hit', () => {
      const sc = new Scenario('mirror', 'bastion', 3);
      withClone(sc, shuffle);
      sc.s.f[0].x = sc.s.f[1].x - u(6);
      sc.s.f[0].cloneX = sc.s.f[1].x + u(2.4);
      sc.s.f[0].cloneY = sc.s.f[1].y;
      sc.run(40, later(sc, (k) => (k < 2 ? IN_ATK : 0)), guard);
      expect(sc.hits(0).length + sc.blocks(0).length).toBe(0);
      expect(M.moves[M_S2].clone!.reachPct).toBe(50);
    });

    it('a swing only the clone landed still chains: 1 → 2 → 3 from the clone alone is a combo', () => {
      const sc = new Scenario('mirror', 'bastion', 3);
      withClone(sc, shuffle);
      sc.s.f[0].x = sc.s.f[1].x - u(5);
      sc.s.f[0].cloneX = sc.s.f[1].x + u(1.4);
      sc.run(260, (_m, _o, _s, t) => (t % 2 ? IN_ATK : 0), (me) => (me.statHitsTaken > 0 ? 0 : shuffle(me, me, sc.s, sc.t)));
      const h = sc.hits(0);
      expect(h.length).toBe(3);
      expect(h.every((e) => e.b & HF_CLONE)).toBe(true);
      expect(neverFree(sc, h[0].lf, h[2].lf)).toBe(true);
    });

    it('both hitting on the same frame both count (sandwiched)', () => {
      const sc = new Scenario('mirror', 'bastion', 1.6);
      withClone(sc, shuffle);
      // clone 1.6u on the far side (the opponent is 1.6u away): exactly symmetric
      expect(sc.s.f[0].cloneX - sc.s.f[1].x).toBe(sc.s.f[1].x - sc.s.f[0].x);
      const hp = sc.s.f[1].hp;
      sc.run(40, later(sc, (k) => (k < 2 ? IN_ATK : 0)), shuffle, () => sc.hits(0).length >= 2);
      const h = sc.hits(0);
      expect(h.length).toBe(2);
      expect(h[0].frame).toBe(h[1].frame);
      expect(hp - sc.s.f[1].hp).toBe(38 + 28);
    });

    it('the opponent\'s attacks pass through the clone', () => {
      const sc = new Scenario('mirror', 'blaze', 3);
      withClone(sc);
      // blaze turns around and swings at the clone
      const o = sc.s.f[1];
      o.facing = 0;
      sc.run(80, () => 0, (_m, _o, _s, t) => (t % 2 ? IN_ATK | stick(0) : stick(0)));
      expect(sc.hits(1).length).toBe(0);
      expect(sc.s.f[0].cloneT).toBeGreaterThan(0);
    });

    it('with the clone out, S2 swaps places (cost 1) and cancels a whiffed swing\'s recovery', () => {
      const sc = new Scenario('mirror', 'bastion', 3);
      withClone(sc);
      sc.s.f[0].x = sc.s.f[1].x - u(6);
      // (the clone well away too: its copy of the swing whiffs as well — a guarded copy would forbid the swap)
      sc.s.f[0].cloneX = sc.s.f[1].x - u(3);
      sc.s.f[0].cloneY = sc.s.f[1].y - u(3.5);
      const a = { x: sc.s.f[0].x, y: sc.s.f[0].y };
      const c = { x: sc.s.f[0].cloneX, y: sc.s.f[0].cloneY };
      const cost = sc.s.f[0].cost;
      // N1 into nothing, then swap during its (whiff) recovery
      sc.run(40, later(sc, (k) => (k === 0 ? IN_ATK : sc.s.f[0].st === ST_ATTACK && sc.s.f[0].sf === 24 ? IN_S2 : 0)), guard, () => sc.events(EV_SWAP, 0).length > 0);
      expect(sc.events(EV_SWAP, 0).length).toBe(1);
      expect(sc.s.f[0].st).toBe(ST_FREE);
      expect(Math.abs(sc.s.f[0].x - c.x)).toBeLessThan(300);
      expect(Math.abs(sc.s.f[0].cloneX - a.x)).toBeLessThan(800);
      expect(sc.s.f[0].cost).toBe(cost - q(1));
    });

    it('1 → 2 → swap → 1 → 2 → 3 is one combo', () => {
      const sc = new Scenario('mirror', 'bastion', 1.6);
      withClone(sc, shuffle);
      let swapped = false;
      sc.run(400, (me, _o, _s, t) => {
        if (!swapped && me.move === M_N2 && (me.moveHit === MH_HIT || me.cloneHit === MH_HIT) && me.sf === 20) {
          swapped = true;
          return IN_S2;
        }
        return t % 2 && (swapped || me.move !== M_N2) ? IN_ATK : 0;
      }, (me) => (me.statHitsTaken > 0 ? 0 : shuffle(me, me, sc.s, sc.t)));
      expect(sc.events(EV_SWAP, 0).length).toBe(1);
      const body = sc.hits(0).filter((e) => !(e.b & HF_CLONE));
      expect(body.length).toBe(5);
      const h = sc.hits(0);
      expect(neverFree(sc, h[0].lf, h.at(-1)!.lf)).toBe(true);
    });

    it('a guarded attack can\'t be swapped out of (no escape from the punish)', () => {
      const sc = new Scenario('mirror', 'bastion', 1.6);
      withClone(sc);
      const cost = sc.s.f[0].cost;
      sc.run(60, later(sc, (k) => (k === 0 ? IN_ATK : sc.s.f[0].st === ST_ATTACK && sc.s.f[0].sf >= 22 && sc.s.f[0].sf <= 30 && k % 2 === 0 ? IN_S2 : 0)), guard);
      expect(sc.blocks(0).length).toBeGreaterThanOrEqual(1);
      expect(sc.events(EV_SWAP, 0).length).toBe(0);
      expect(sc.s.f[0].cost).toBe(cost + q(0.5)); // (only the blocked N1's gain: no swap was paid)
    });

    it('is part of the snapshot, and a new round removes the clone', () => {
      const sc = new Scenario('mirror', 'bastion', 3);
      withClone(sc);
      expect(hashState(cloneState(sc.s))).toBe(hashState(sc.s));
      sc.sim.startRound(false);
      expect(sc.s.f[0].cloneT).toBe(0);
      void SYSTEM;
    });
  });
});
