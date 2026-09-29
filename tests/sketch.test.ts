// スケッチ（お絵かき）: S1 インクトレイル（動いた跡が残る・通り抜け・ノックバックで触れると壁より痛い・当たると消える）、
// S2 フリック（当たった瞬間のスティック方向へ吹き飛ばす・1→2→S2が確定）。
import { describe, expect, it } from 'vitest';
import { Scenario, sequence, guard, stick, type Bot, IN_S1, IN_S2, IN_STEP } from './harness';
import { getChar, CTL_FACE_FOE } from '../src/core/sim';
import { charIndex } from '../src/data/characters';
import { M_N1, M_N2, M_S1, M_S2, COST_UNIT } from '../src/core/compile';
import { u } from '../src/core/fixed';
import { SYSTEM } from '../src/data/system';
import { EV_INK, EV_TRAIL, EV_WALL, EV_KNOCKDOWN } from '../src/core/events';
import { ST_FREE, ST_HITSTUN, TRAIL_FIGHTER, TRAIL_STRIDE, cloneState, hashState } from '../src/core/state';

const K = getChar(charIndex('sketch'));
const q = (units: number) => units * COST_UNIT;
const cx = u(SYSTEM.field.w / 2);
const cy = u(SYSTEM.field.h / 2);
const later = (sc: Scenario, fn: (k: number) => number): Bot => {
  const t0 = sc.t;
  return (_m, _o, _s, t) => fn(t - t0);
};
/** Paint ink for fighter `who` by hand: a stroke through the given points (life frames left). */
function paint(sc: Scenario, who: number, pts: [number, number][], life = 480): void {
  const t = sc.s.trail;
  const base = who * TRAIL_FIGHTER;
  const head = sc.s.f[who].trHead;
  pts.forEach(([x, y], k) => {
    const at = base + ((head + k) % (TRAIL_FIGHTER / TRAIL_STRIDE)) * TRAIL_STRIDE;
    t[at] = x;
    t[at + 1] = y;
    t[at + 2] = (life << 1) | (k === 0 ? 1 : 0);
  });
  sc.s.f[who].trHead = (head + pts.length) % (TRAIL_FIGHTER / TRAIL_STRIDE);
}
const inkOf = (sc: Scenario, who = 0) => {
  const segs: number[][] = [];
  sc.sim.forEachInk(who, (x0, y0, x1, y1, life, slot) => segs.push([x0, y0, x1, y1, life, slot]));
  return segs;
};
/** A bot with the stick held toward `dir` the whole time. */
const withStick = (bot: Bot, dir: number): Bot => (m, o, s, t) => bot(m, o, s, t) | stick(dir);
/** The defender stands (guarding: input 0). */
const stand: Bot = () => 0;
/** A defender that is not guarding (it presses on toward the attacker) until it is hit. */
const open: Bot = (me) => (me.statHitsTaken > 0 ? 0 : stick(16));
/** …the same for a defender standing on the right of the attacker being on its left. */
const openR: Bot = (me) => (me.statHitsTaken > 0 ? 0 : stick(0));

describe('スケッチ', () => {
  it('modest normals (Blaze frames), S1 cost 1, S2 cost 2', () => {
    const blaze = getChar(charIndex('blaze'));
    for (const m of [M_N1, M_N2]) {
      expect(K.moves[m].S).toBe(blaze.moves[m].S);
      expect(K.moves[m].dmg).toBeLessThan(blaze.moves[m].dmg);
    }
    expect(K.moves[M_S1].cost).toBe(q(1));
    expect(K.moves[M_S2].cost).toBe(q(2));
  });

  describe('S1 インクトレイル', () => {
    it('after its 6th frame, for 5 s, a walk leaves ink every 0.8u; standing still leaves none', () => {
      const sc = new Scenario('sketch', 'bastion', 8);
      sc.s.f[0].cost = q(2);
      sc.run(2, (_m, _o, _s, t) => (t === 0 ? IN_S1 : 0), stand);
      expect(sc.s.f[0].cost).toBe(q(1)); // paid 1
      sc.run(40, () => 0, stand); // standing (the move's own 22F, then idle)
      expect(inkOf(sc).length).toBe(0);
      const x0 = sc.s.f[0].x;
      sc.run(60, () => stick(8), stand); // 60F straight down
      const segs = inkOf(sc);
      const walked = (sc.s.f[0].y - cy) / 1000;
      expect(walked).toBeGreaterThan(3);
      expect(segs.length).toBeGreaterThanOrEqual(Math.floor(walked / 0.8) - 2);
      expect(segs.length).toBeLessThanOrEqual(Math.ceil(walked / 0.8) + 1);
      for (const [ax, , bx] of segs) expect(Math.abs(ax - x0) + Math.abs(bx - x0)).toBeLessThan(200);
      expect(sc.events(EV_INK, 0).map((e) => e.a)).toEqual([1]);
    });

    it('draws for 300F, then the pen lifts; it cannot be restarted while drawing; the ink fades after 480F', () => {
      const sc = new Scenario('sketch', 'bastion', 8);
      sc.s.f[0].cost = q(4);
      sc.run(20, (_m, _o, _s, t) => (t % 2 === 0 ? IN_S1 : 0), stand);
      expect(sc.s.f[0].cost).toBe(q(3)); // the second press did nothing
      sc.run(330, later(sc, (k) => (k % 120 < 60 ? stick(0) : stick(16))), stand); // pace back and forth the whole time
      expect(sc.events(EV_INK, 0).map((e) => e.a)).toEqual([1, 0]);
      const dur = sc.events(EV_INK, 0)[1].lf - sc.events(EV_INK, 0)[0].lf;
      expect(dur).toBeGreaterThanOrEqual(295);
      expect(dur).toBeLessThanOrEqual(310);
      const n = inkOf(sc).length;
      expect(n).toBeGreaterThan(5);
      sc.run(200, later(sc, (k) => (k % 120 < 60 ? stick(0) : stick(16))), stand); // more walking: no new ink
      expect(inkOf(sc).length).toBeLessThanOrEqual(n);
      sc.run(400, () => 0, stand);
      expect(inkOf(sc).length).toBe(0); // 480F after it was laid
    });

    it('both fighters walk straight through the ink (nothing blocks)', () => {
      const sc = new Scenario('sketch', 'bastion', 8);
      paint(sc, 0, [[cx, cy - 3000], [cx, cy], [cx, cy + 3000]]);
      const y0 = sc.s.f[1].y;
      sc.run(120, () => 0, () => stick(16)); // the opponent walks left across x = cx
      expect(sc.s.f[1].x).toBeLessThan(cx - 1000);
      expect(sc.events(EV_TRAIL).length).toBe(0);
      expect(sc.s.f[1].y).toBe(y0);
    });

    it('a knocked-back opponent crossing the ink is slammed like a wall — harder (45–90 vs 30–60) — and the ink is used up', () => {
      const sc = new Scenario('sketch', 'bastion', 1.4);
      const vx = sc.s.f[1].x;
      // a wall of ink 1.2u behind the target (the knockback is 1.9u)
      paint(sc, 0, [[vx + 1200, cy - 2500], [vx + 1200, cy], [vx + 1200, cy + 2500]]);
      const before = inkOf(sc).length;
      sc.s.f[0].cost = q(4);
      // AA then S2 with the stick right at the moment it lands
      sc.run(200, withStick(sequence('AA2'), 0), open);
      const t = sc.events(EV_TRAIL, 1);
      expect(t.length).toBe(1);
      expect(t[0].a).toBeGreaterThanOrEqual(45 * 0.9);
      expect(t[0].a).toBeLessThanOrEqual(90);
      expect(inkOf(sc).length).toBe(before - 1); // one piece of ink used up (the one it crossed)
      expect(sc.events(EV_WALL, 1).length).toBe(0);
    });

    it('the ink hurts more than the arena wall for the same knockback', () => {
      // the same S2 knock, once into the arena wall and once into ink, both at a full-speed impact
      const dmg = (into: 'ink' | 'wall') => {
        const sc = new Scenario('sketch', 'bastion', 1.4);
        sc.s.f[0].cost = q(4);
        if (into === 'wall') {
          // put the target 0.6u from the right wall
          sc.s.f[0].x = u(SYSTEM.field.w) - u(2.2);
          sc.s.f[1].x = u(SYSTEM.field.w) - u(0.8);
        } else {
          paint(sc, 0, [[sc.s.f[1].x + 700, cy - 2500], [sc.s.f[1].x + 700, cy], [sc.s.f[1].x + 700, cy + 2500]]);
        }
        sc.run(200, withStick(sequence('AA2'), 0), open);
        return (into === 'wall' ? sc.events(EV_WALL, 1) : sc.events(EV_TRAIL, 1))[0]?.a ?? 0;
      };
      expect(dmg('wall')).toBeGreaterThan(0);
      expect(dmg('ink')).toBeGreaterThan(dmg('wall'));
    });

    it('only a body that is being knocked back touches it: not a walker, a stepper, a guard, or the owner', () => {
      const sc = new Scenario('sketch', 'bastion', 8);
      paint(sc, 0, [[cx + 1500, cy - 4000], [cx + 1500, cy], [cx + 1500, cy + 4000]]);
      // opponent steps and walks through
      sc.run(90, () => 0, later(sc, (k) => (k === 5 ? IN_STEP | stick(0) : stick(0))));
      expect(sc.events(EV_TRAIL).length).toBe(0);
      // the owner knocked into its own ink: nothing (only the opponent's trail counts for a victim)
      const own = new Scenario('bastion', 'sketch', 1.4);
      paint(own, 1, [[own.s.f[0].x - 1200, cy - 2500], [own.s.f[0].x - 1200, cy], [own.s.f[0].x - 1200, cy + 2500]]);
      own.s.f[1].cost = q(4);
      own.run(200, openR, withStick(sequence('AA2'), 16));
      expect(own.events(EV_TRAIL, 1).length).toBe(0); // (fighter 1 is the owner: it is not the one that gets hit)
      expect(own.events(EV_TRAIL, 0).length).toBe(1); // …the bastion (0) crossing it IS
    });

    it('shares the 2-impacts-per-combo limit with the arena wall', () => {
      const sc = new Scenario('sketch', 'bastion', 1.4);
      const vx = sc.s.f[1].x;
      paint(sc, 0, [[vx + 1200, cy - 2500], [vx + 1200, cy], [vx + 1200, cy + 2500]]);
      sc.s.f[0].cost = q(4);
      const bot = withStick(sequence('AA2'), 0);
      sc.run(200, bot, open, () => sc.hits(0).length >= 1);
      sc.s.f[1].wallHits = SYSTEM.wall.perCombo; // (this combo already had its two wall / ink impacts)
      sc.run(200, bot, open);
      expect(sc.hits(0).length).toBe(3);
      expect(sc.events(EV_TRAIL, 1).length).toBe(0);
    });

    it('is part of the snapshot: a copy hashes the same, and a new round clears the ink', () => {
      const sc = new Scenario('sketch', 'bastion', 8);
      sc.s.f[0].cost = q(4);
      sc.run(80, later(sc, (k) => (k < 2 ? IN_S1 : stick(8))), stand);
      expect(inkOf(sc).length).toBeGreaterThan(3);
      expect(hashState(cloneState(sc.s))).toBe(hashState(sc.s));
      sc.sim.startRound(false);
      expect(inkOf(sc).length).toBe(0);
      expect(sc.s.f[0].inkT).toBe(0);
    });
  });

  describe('S2 フリック', () => {
    const hitWith = (dir: number | null, dist = 1.4) => {
      const sc = new Scenario('sketch', 'bastion', dist);
      sc.sim.setControlModes([CTL_FACE_FOE, 0]); // (the default setting: attacks face the opponent, whatever the stick says)
      sc.s.f[0].cost = q(4);
      // (the stick is held until it has landed, then let go: walking on afterwards would push the target further)
      const bot: Bot = (_m, _o, _s, t) => (t === 0 ? IN_S2 | (dir === null ? 0 : stick(dir)) : dir !== null && t < 24 ? stick(dir) : 0);
      sc.run(120, bot, open, () => sc.hits(0).length >= 1);
      const v0 = { x: sc.s.f[1].x, y: sc.s.f[1].y }; // (the target may have walked in before the hit landed)
      sc.run(60, bot, open);
      return { sc, dx: (sc.s.f[1].x - v0.x) / 1000, dy: (sc.s.f[1].y - v0.y) / 1000 };
    };

    it('knocks the target 1.9u toward the stick, whichever way the piece faces', () => {
      for (const [dir, ex, ey] of [[0, 1, 0], [8, 0, 1], [24, 0, -1], [4, 0.71, 0.71], [28, 0.71, -0.71]] as const) {
        const { sc, dx, dy } = hitWith(dir);
        expect(sc.hits(0).length).toBe(1);
        // (the piece faces the target — to the right — in every case)
        expect(Math.abs(dx - ex * 1.9)).toBeLessThan(0.4);
        expect(Math.abs(dy - ey * 1.9)).toBeLessThan(0.4);
      }
    });

    it('toward the attacker: the target slides into the attacker\'s body (bodies still push each other), it never passes through', () => {
      const { sc, dx } = hitWith(16);
      expect(dx).toBeLessThan(0);
      const d = Math.hypot(sc.s.f[0].x - sc.s.f[1].x, sc.s.f[0].y - sc.s.f[1].y);
      expect(d).toBeGreaterThanOrEqual(u(1) - 5);
    });

    it('with the stick released it goes straight away from the attacker', () => {
      const { dx, dy } = hitWith(null);
      expect(dx).toBeGreaterThan(1.5);
      expect(Math.abs(dy)).toBeLessThan(0.2);
    });

    it('the direction is the stick when it LANDS, not when it was pressed', () => {
      const sc = new Scenario('sketch', 'bastion', 1.4);
      sc.sim.setControlModes([CTL_FACE_FOE, 0]);
      sc.s.f[0].cost = q(4);
      const y0 = sc.s.f[1].y;
      // pressed with the stick up; by the time the hit lands (S16) it points down
      sc.run(120, (_m, _o, _s, t) => (t === 0 ? IN_S2 | stick(24) : t < 8 ? stick(24) : stick(8)), open);
      expect(sc.s.f[1].y).toBeGreaterThan(y0 + 1000);
    });

    it('is a stronger knock than N3\'s launch (1.6u), without a knockdown', () => {
      expect(K.moves[M_S2].knockback).toBeGreaterThan(u(1.6));
      const { sc } = hitWith(0);
      expect(sc.events(EV_KNOCKDOWN, 1).length).toBe(0);
      expect(sc.s.f[1].st === ST_HITSTUN || sc.s.f[1].st === ST_FREE).toBe(true);
    });

    it('1→2→S2 is a true combo even on the latest cancel frame (S2 comes out of N2 on hit)', () => {
      const sc = new Scenario('sketch', 'bastion', 1.4);
      sc.s.f[0].cost = q(2);
      // the defender never got free between the first and the last hit
      sc.run(300, sequence('AA2'), (me) => (me.statHitsTaken > 0 ? 0 : stick(16)));
      const h = sc.hits(0);
      expect(h.length).toBe(3);
      expect(h.map((e) => e.a)).toEqual([40, 36, 40]);
      expect(sc.freeAt[1].filter((f) => f > h[0].lf && f < h[2].lf).length).toBe(0);
      expect(sc.s.f[0].cost).toBeLessThanOrEqual(q(1)); // (paid 2, gained back some)
    });

    it('guarded: an ordinary circle — blocked, pushed straight back (no directional knock)', () => {
      const sc = new Scenario('sketch', 'bastion', 1.4);
      sc.sim.setControlModes([CTL_FACE_FOE, 0]);
      sc.s.f[0].cost = q(4);
      const y0 = sc.s.f[1].y;
      sc.run(80, (_m, _o, _s, t) => (t === 0 ? IN_S2 | stick(24) : stick(24)), guard);
      expect(sc.blocks(0).length).toBe(1);
      expect(Math.abs(sc.s.f[1].y - y0)).toBeLessThan(300);
    });

    it('can be canceled into from N2 only (or from neutral), not from N1', () => {
      const def = K.moves[M_S2].def!;
      expect(def.cancelFrom).toEqual(['n2', 'neutral']);
      expect(K.moves[M_S1].def!.cancelFrom).toEqual(['neutral']);
      expect(ST_FREE).toBe(0);
    });
  });
});
