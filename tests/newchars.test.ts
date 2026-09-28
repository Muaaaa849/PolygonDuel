// レイ（射撃）／ヴォルト（ステップ）の規約 R1〜R14 と、新しい仕組み（弾・弾ジャスト・弾切れ・
// ガード時の壁ダメージ・フィールド・ステップ3つ・突進の必敗・ターンバック）。
import { describe, expect, it } from 'vitest';
import { Scenario, guard, stick, hold, sequence, type Bot, IN_ATK, IN_S1, IN_S2, IN_STEP } from './harness';
import { getChar } from '../src/core/sim';
import { charIndex, CHARACTERS } from '../src/data/characters';
import { M_N1, M_GC, M_S1, M_S2 } from '../src/core/compile';
import { u } from '../src/core/fixed';
import { SYSTEM } from '../src/data/system';
import {
  EV_RIPOSTE, EV_STEP, EV_GUARD_BREAK, EV_MODE, EV_JUST, EV_JAM, EV_WALL, EV_SHOT, EV_SHOCK, EV_CRUSH, EV_MOVE, EV_FIELD,
  HF_SHOT, HF_PUNISH, HF_JA,
} from '../src/core/events';
import {
  type FighterState, ST_ATTACK, ST_BLOCKSTUN, ST_FREE, ST_HITSTUN, ST_JAM, ST_STEP, ST_DOWN, getShot,
} from '../src/core/state';

const RAY = charIndex('ray');
const VOLT = charIndex('volt');
const ray = getChar(RAY);
const volt = getChar(VOLT);
const sh = ray.shooter!;
const shot1 = ray.moves[sh.shots[0]].proj!;
const FW = u(SYSTEM.field.w);

/** Ray (P1) already in shooting mode. */
function shooting(opp: string, dist: number): Scenario {
  const sc = new Scenario('ray', opp, dist);
  sc.s.f[0].shootMode = 1;
  return sc;
}

/** Shooter bot: fires `n` bullets, each as early as the chain window allows (+ `delay`). */
function shoot(n: number, delay = 0): Bot {
  let fired = 0;
  return (me, _o, _s, t) => {
    if (fired === 0 && t === 0) {
      fired = 1;
      return IN_ATK;
    }
    if (fired < n && me.st === ST_ATTACK && me.move === sh.shots[fired - 1] && me.sf === 12 + delay) {
      fired++;
      return IN_ATK;
    }
    return 0;
  };
}

/** Distance (milli-u) from the nearest live bullet of `f` to `o`, or Infinity. */
function nearestShot(f: FighterState, o: FighterState): number {
  let best = Infinity;
  for (let j = 0; j < 3; j++) {
    const b = getShot(f, j);
    if (b) best = Math.min(best, Math.hypot(b.x - o.x, b.y - o.y));
  }
  return best;
}

describe('レイ: 弾', () => {
  it('R1: a bullet hit stuns briefly — free before the next bullet can come (≤ 12 − 4)', () => {
    expect(shot1.hitstun).toBeLessThanOrEqual(12 - 4);
    const sc = shooting('blaze', 4).run(60, shoot(1), hold(stick(16)));
    const hits = sc.hits(0);
    expect(hits.length).toBe(1);
    expect(hits[0].b & HF_SHOT).toBeTruthy();
    expect(hits[0].a).toBe(shot1.dmg);
    // unscaled single hit: no combo count
    expect(sc.s.f[1].comboHits).toBe(0);
    const free = sc.freeAt[1].find((f) => f > hits[0].lf)!;
    expect(free - hits[0].lf).toBeLessThanOrEqual(shot1.hitstun);
  });

  it('R2 + R5: stepping into the next bullet = bullet just → jam → the JA always lands (no ×1.5)', () => {
    for (let k = 1; k <= 3; k++) {
      const sc = shooting('blaze', 3);
      let blocked = 0;
      let phase = 0;
      const dodger: Bot = (me, op) => {
        if (phase === 0) {
          blocked = sc.blocks(0).length;
          if (blocked >= k - 1 && me.st === ST_FREE && nearestShot(op, me) < u(1.6)) {
            phase = 1;
            return stick(16) | IN_STEP;
          }
          return 0;
        }
        if (phase === 1 && me.justWin > 0) {
          phase = 2;
          return IN_ATK;
        }
        return 0;
      };
      sc.run(240, shoot(3), dodger);
      expect(sc.events(EV_JUST, 1).length, `shot ${k}`).toBe(1);
      expect(sc.events(EV_JUST, 1)[0].b).toBe(1);
      expect(sc.events(EV_JAM, 0).length).toBe(1);
      // every bullet vanished at the just
      const justT = sc.events(EV_JUST, 1)[0].lf;
      expect(sc.hits(0).filter((e) => e.lf > justT).length).toBe(0);
      const ja = sc.hits(1);
      expect(ja.length, `JA after shot ${k}`).toBeGreaterThanOrEqual(1);
      expect(ja[0].a).toBe(getChar(charIndex('blaze')).moves[M_N1].dmg); // ×1.0
      expect(ja[0].b & HF_JA).toBe(0);
    }
  });

  it('the jammed shooter cannot act until the JA lands', () => {
    const sc = shooting('blaze', 3);
    let stepped = false;
    const dodger: Bot = (me, op) => {
      if (!stepped && me.st === ST_FREE && nearestShot(op, me) < u(1.6)) {
        stepped = true;
        return stick(16) | IN_STEP;
      }
      return 0; // never presses ATK
    };
    let jamLen = 0;
    const raybot: Bot = (me, o, s, t) => {
      if (me.st === ST_JAM) jamLen++;
      return shoot(1)(me, o, s, t) | (me.st === ST_JAM ? IN_ATK : 0);
    };
    sc.run(200, raybot, dodger);
    expect(sc.events(EV_JAM, 0).length).toBe(1);
    // slow motion + 20F after it
    expect(jamLen).toBeGreaterThanOrEqual(SYSTEM.just.window);
  });

  it('R3: a step that slips sideways out of the line is no just (a plain dodge)', () => {
    const sc = shooting('blaze', 5);
    let stepped = false;
    const dodger: Bot = (me, op) => {
      if (!stepped && me.st === ST_FREE && nearestShot(op, me) < u(3.4)) {
        stepped = true;
        return stick(8) | IN_STEP; // straight down
      }
      return 0;
    };
    sc.run(80, shoot(1), dodger);
    expect(stepped).toBe(true);
    expect(sc.events(EV_JUST).length).toBe(0);
    expect(sc.hits(0).length).toBe(0);
  });

  it('a step still recovering (after its travel) is hit normally', () => {
    const sc = shooting('blaze', 7);
    let stepped = false;
    const dodger: Bot = () => {
      // step early, away along the line: the bullet catches up in the recovery frames
      if (!stepped && sc.events(EV_SHOT, 0).length > 0) {
        stepped = true;
        return stick(0) | IN_STEP;
      }
      return 0;
    };
    sc.run(80, shoot(1), dodger);
    const h = sc.hits(0);
    expect(sc.events(EV_JUST).length).toBe(0);
    expect(h.length).toBe(1);
  });

  it('guarding in the open: 0 damage, slid back ~2u', () => {
    const sc = shooting('bastion', 4);
    const x0 = sc.s.f[1].x;
    sc.run(60, shoot(1), guard);
    expect(sc.blocks(0).length).toBe(1);
    expect(sc.s.f[1].hp).toBe(getChar(charIndex('bastion')).hp);
    expect(sc.s.f[1].x - x0).toBeGreaterThan(u(1.8));
  });

  it('R4: guarding at the wall costs 30 per bullet (> a 20 hit); the slide stops there', () => {
    expect(30).toBeGreaterThan(shot1.dmg);
    const sc = shooting('bastion', 4);
    sc.s.f[1].x = FW - u(1.0);
    sc.s.f[0].x = sc.s.f[1].x - u(4);
    sc.s.f[1].infGuard = 1; // (only the wall here; the gauge chip is tested below)
    sc.run(120, shoot(3), guard);
    const walls = sc.events(EV_WALL, 1).filter((e) => e.b & 4);
    expect(walls.length).toBe(3);
    for (const w of walls) expect(w.a).toBe(30);
    expect(sc.hits(0).length).toBe(0);
    expect(sc.s.f[1].hp).toBe(getChar(charIndex('bastion')).hp - 90);
  });

  it('guarded bullets chip the guard gauge (no refill): a volley leaves it low, the next one breaks it', () => {
    const sc = shooting('bastion', 5);
    const max = getChar(charIndex('bastion')).guardMaxQ;
    sc.run(90, shoot(3), guard);
    expect(sc.blocks(0).length).toBe(3);
    expect(sc.events(EV_GUARD_BREAK, 1).length).toBe(0);
    expect(sc.s.f[1].guardQ).toBeLessThan(max * 0.3);
    // melee blocks still refill it
    const m = new Scenario('blaze', 'bastion', 1.6).run(40, (_m, _o, _s, t) => (t === 0 ? IN_ATK : 0), guard);
    expect(m.blocks(0).length).toBe(1);
    expect(m.s.f[1].guardQ).toBeGreaterThan(max * 0.7);
  });

  it('R8: bullets gain half a melee contact (+0.25 cost)', () => {
    expect(shot1.costGain * 2).toBe(Math.round(SYSTEM.cost.gainOnContact * 4));
    const sc = shooting('blaze', 4);
    const c0 = sc.s.f[0].cost;
    sc.run(60, shoot(1), hold(stick(16)));
    expect(sc.hits(0).length).toBe(1);
    expect(sc.s.f[0].cost - c0).toBe(shot1.costGain);
  });

  it('every shot re-aims at the opponent; bullets vanish at the arena edge', () => {
    const sc = shooting('blaze', 4);
    sc.run(40, shoot(2), hold(stick(8)));
    const e = sc.events(EV_SHOT, 0)[1];
    expect(e).toBeTruthy();
    // opponent moved downward → the bullet leaves slightly downward
    expect(e.b).toBeGreaterThan(0);
    expect(e.b).toBeLessThan(256);
    sc.run(80, () => 0, hold(stick(8)));
    expect(getShot(sc.s.f[0], 0) || getShot(sc.s.f[0], 1) || getShot(sc.s.f[0], 2)).toBeNull();
  });

  it('shots can be delayed inside the 12–22F window; 3 at most per volley', () => {
    // the bot sees the frame before the press lands: delay 9 = the last window frame (22)
    const sc = shooting('bastion', 6).run(160, shoot(3, 9), guard);
    const shots = sc.events(EV_SHOT, 0);
    expect(shots.length).toBe(3);
    expect(shots[1].lf - shots[0].lf).toBe(22 - 1);
    // one frame later is outside the window: the press only starts a new volley
    const late = shooting('bastion', 6).run(80, shoot(3, 10), guard);
    expect(late.moves(0).map((e) => e.a).slice(0, 2)).toEqual([sh.shots[0], sh.shots[0]]);
    const sc2 = shooting('bastion', 6).run(200, (_m, _o, _s, t) => (t % 2 ? 0 : IN_ATK), guard);
    // mashing: 3 bullets, then a new volley — never 4 inside one volley
    const moves = sc2.moves(0).map((e) => e.a);
    expect(moves.slice(0, 4)).toEqual([sh.shots[0], sh.shots[1], sh.shots[2], sh.shots[0]]);
  });

  it('step → shot is allowed (without momentum)', () => {
    const sc = shooting('blaze', 5);
    sc.run(40, (me, _o, _s, t) => (t === 0 ? stick(8) | IN_STEP : me.st === ST_STEP && me.sf === 4 ? IN_ATK : 0), guard);
    expect(sc.events(EV_SHOT, 0).length).toBe(1);
  });
});

describe('レイ: モード切替・ブラスト・フィールド', () => {
  it('v1.3: the mode switch works mid-attack without interrupting it; after N2 S1 is still the blast', () => {
    const sc = new Scenario('ray', 'blaze', 2);
    sc.run(60, (me, _o, _s, t) => (t === 0 ? IN_ATK : me.st === ST_ATTACK && me.sf === 3 ? IN_S1 : 0), (me) => (me.statHitsTaken > 0 ? 0 : stick(16)));
    expect(sc.s.f[0].shootMode).toBe(1);
    expect(sc.moves(0).length).toBe(1);
    expect(sc.hits(0).length).toBe(1); // the N1 still landed
    const bl = new Scenario('ray', 'blaze', 2);
    bl.run(120, sequence('AA1'), (me) => (me.statHitsTaken > 0 ? 0 : stick(16)));
    expect(bl.moves(0).map((e) => e.a)).toEqual([M_N1, M_N1 + 1, ray.shooter!.blast]);
  });

  it('S1 costs 1 into shooting mode, 0 back; the mode survives hits and resets each round', () => {
    const sc = new Scenario('ray', 'blaze', 6);
    const c0 = sc.s.f[0].cost;
    sc.run(1, () => IN_S1, guard);
    // v1.3: 0F — switched the frame it is pressed, no move
    expect(sc.s.f[0].shootMode).toBe(1);
    expect(sc.s.f[0].st).toBe(ST_FREE);
    sc.run(19, () => 0, guard);
    expect(sc.s.f[0].cost).toBe(c0 - 4);
    sc.run(20, (_m, _o, _s, t) => (t === 20 ? IN_S1 : 0), guard);
    expect(sc.s.f[0].shootMode).toBe(0);
    expect(sc.s.f[0].cost).toBe(c0 - 4);
    sc.s.f[0].shootMode = 1;
    sc.s.f[0].hp = 0;
    sc.run(300, () => 0, guard, () => sc.s.round === 2);
    expect(sc.s.round).toBe(2);
    expect(sc.s.f[0].shootMode).toBe(0);
  });

  it('in shooting mode ATK shoots (no melee N1), GC stays melee', () => {
    const sc = shooting('blaze', 1.6);
    sc.run(40, (me, _o, _s, t) => (t === 0 ? IN_ATK : 0), guard);
    expect(sc.moves(0)[0].a).toBe(sh.shots[0]);
    // GC out of a guard is the melee GC
    const sc2 = shooting('blaze', 1.6);
    sc2.run(80, (me) => (me.st === ST_BLOCKSTUN ? IN_ATK : 0), (_m, _o, _s, t) => (t === 0 ? IN_ATK : 0));
    expect(sc2.moves(0).some((e) => e.a === M_GC)).toBe(true);
  });

  it('R6: 1→2→blast is guaranteed (like C2), knocks down far and switches to shooting mode', () => {
    const n2 = ray.moves[1];
    const bl = ray.moves[sh.blast];
    expect(n2.cancel!.b + bl.S - 1).toBeLessThan(n2.S + n2.hitstun);
    const hitThenGuard: Bot = (me) => (me.statHitsTaken > 0 ? 0 : stick(16));
    let t0 = 0;
    const seq: Bot = (me, _o, _s, t) => {
      // latest possible S1 press in the N2 cancel window
      if (me.st === ST_ATTACK && me.move === 1 && me.moveHit && me.sf === n2.cancel!.b - 1) return IN_S1;
      if (t0 === 0 && t % 2 === 0) return me.move === 1 ? 0 : IN_ATK;
      return 0;
    };
    const sc = new Scenario('ray', 'blaze', 1.6).run(200, seq, hitThenGuard);
    const h = sc.hits(0);
    expect(h.length).toBe(3);
    expect(sc.s.f[0].shootMode).toBe(1);
    expect(sc.s.f[1].x - sc.s.f[0].x).toBeGreaterThan(u(4));
  });

  it('R7: center 1→2→blast (106) < 1→2→3 (136)', () => {
    const b = ray.moves[sh.blast].dmg;
    expect(ray.moves[0].dmg + ray.moves[1].dmg + b).toBeLessThan(ray.moves[0].dmg + ray.moves[1].dmg + ray.moves[2].dmg);
  });

  it('a guarded blast slides 3u and slams the wall (30)', () => {
    const sc = new Scenario('ray', 'bastion', 1.6);
    sc.s.f[1].x = FW - u(2.0);
    sc.s.f[0].x = sc.s.f[1].x - u(1.6);
    sc.s.f[0].cost = 16;
    let blasted = false;
    const bot: Bot = (me, _o, _s, t) => {
      if (me.move === sh.blast) blasted = true;
      if (blasted) return 0;
      if (me.st === ST_ATTACK && me.move === 1 && me.moveHit && me.sf === 16) return IN_S1;
      return me.move === 1 ? 0 : t % 2 ? 0 : IN_ATK;
    };
    sc.run(200, bot, guard);
    expect(sc.moves(0).some((e) => e.a === sh.blast)).toBe(true);
    const walls = sc.events(EV_WALL, 1).filter((e) => e.b & 4);
    expect(walls.length).toBe(1);
    expect(walls[0].a).toBe(30);
  });

  it('static field: tap = at the feet; stepping inside shocks (40 + 30F), walking is safe', () => {
    const F = ray.moves[M_S2].field!;
    const sc = new Scenario('ray', 'blaze', 4);
    sc.s.f[0].cost = 16;
    sc.run(F.at + 2, (_m, _o, _s, t) => (t === 0 ? IN_S2 : 0), guard);
    const fe = sc.events(EV_FIELD, 0);
    expect(fe.length).toBe(1);
    expect(Math.abs(fe[0].x - sc.s.f[1].x)).toBeLessThan(u(0.1));
    expect(sc.s.f[0].fieldT).toBeGreaterThan(0);
    // walking inside is safe
    sc.run(8, () => 0, hold(stick(8)));
    expect(sc.events(EV_SHOCK).length).toBe(0);
    // a step (started inside, heading out) is cut
    sc.run(40, () => 0, (_m, _o, _s, t) => (t === F.at + 10 ? stick(8) | IN_STEP : 0));
    const sh2 = sc.events(EV_SHOCK, 1);
    expect(sh2.length).toBe(1);
    expect(sh2[0].a).toBe(F.dmg);
    expect(sc.s.f[1].hp).toBe(getChar(charIndex('blaze')).hp - F.dmg);
    // the field lasts 180F
    const sc2 = new Scenario('ray', 'blaze', 4);
    sc2.s.f[0].cost = 16;
    sc2.run(F.at + F.frames + 2, (_m, _o, _s, t) => (t === 0 ? IN_S2 : 0), hold(stick(4)));
    expect(sc2.s.f[0].fieldT).toBe(0);
  });

  it('an aimed field lands at the aimed reach (max 5u)', () => {
    const sc = new Scenario('ray', 'blaze', 2);
    sc.s.f[0].cost = 16;
    // aim straight left (away from the opponent) at full reach: bit10 aim, dir 512/4=128, level 3
    const aimed = IN_S2 | (1 << 10) | (128 << 11) | (3 << 19);
    sc.run(30, (_m, _o, _s, t) => (t === 0 ? aimed : 0), guard);
    const fe = sc.events(EV_FIELD, 0)[0];
    expect(Math.abs(fe.y - sc.s.f[0].y)).toBeLessThan(u(0.05));
    expect(sc.s.f[0].x - fe.x).toBeGreaterThan(u(4.9));
  });
});

/** Volt (P1) steps toward the opponent at `stepAt` and dashes on step frame 3. */
function dashBot(stepAt: number, then?: Bot): Bot {
  return (me, op, s, t) => {
    if (t === stepAt) return stick(0) | IN_STEP;
    if (me.st === ST_STEP && me.sf === 3 && t < stepAt + 10) return IN_S1 | stick(0);
    return then ? then(me, op, s, t) : 0;
  };
}

describe('ヴォルト', () => {
  it('3 steps in stock', () => {
    expect(volt.stepStock).toBe(3);
    const sc = new Scenario('volt', 'blaze', 6);
    expect(sc.s.f[0].steps).toBe(3);
    let n = 0;
    sc.run(80, (me, _o, _s, t) => {
      if (t % 2 === 0 && me.st !== ST_STEP) {
        n++;
        return stick(8) | IN_STEP;
      }
      return me.st === ST_STEP && me.sf >= 9 && t % 2 === 0 ? stick(8) | IN_STEP : 0;
    }, guard);
    expect(sc.events(EV_STEP, 0).length).toBeGreaterThanOrEqual(3);
  });

  it('R14 (v0.9): the dash also comes out on its own (from neutral), passing behind a guard at +2', () => {
    const sc = new Scenario('volt', 'blaze', 2.4);
    sc.run(60, (_m, _o, _s, t) => (t === 0 ? IN_S1 : 0), guard);
    expect(sc.moves(0)[0].a).toBe(M_S1);
    expect(sc.s.f[0].cost).toBe(SYSTEM.cost.start * 4 - volt.moves[M_S1].cost);
    expect(sc.blocks(0).length).toBe(1);
    expect(sc.s.f[0].x).toBeGreaterThan(sc.s.f[1].x);
    // and the steps stay free for moving: 3 in stock after it
    expect(sc.s.f[0].steps).toBe(3);
  });

  it('R9: a guarded dash passes behind at +2; a hit is +3 and no combo', () => {
    const sc = new Scenario('volt', 'blaze', 4).run(80, dashBot(0), guard);
    expect(sc.blocks(0).length).toBe(1);
    expect(sc.s.f[0].x).toBeGreaterThan(sc.s.f[1].x); // behind
    const blk = sc.blocks(0)[0].lf;
    const vFree = sc.freeAt[0].find((f) => f > blk)!;
    const bFree = sc.freeAt[1].find((f) => f > blk)!;
    expect(bFree - vFree).toBe(volt.moves[M_S1].dash!.advBlock);

    // hit (walking in), then Volt mashes ATK: the fastest N1 is guarded
    const walkIn: Bot = (me) => (me.statHitsTaken > 0 ? 0 : stick(16));
    const sc2 = new Scenario('volt', 'blaze', 4).run(120, dashBot(0, (me, _o, _s, t) => (me.st === ST_FREE && t % 2 === 0 ? IN_ATK : 0)), walkIn);
    const h = sc2.hits(0);
    expect(h.length).toBe(1);
    expect(h[0].a).toBe(volt.moves[M_S1].dmg);
    const vf = sc2.freeAt[0].find((f) => f > h[0].lf)!;
    const bf = sc2.freeAt[1].find((f) => f > h[0].lf)!;
    expect(bf - vf).toBe(volt.moves[M_S1].dash!.advHit);
    expect(sc2.blocks(0).length).toBeGreaterThanOrEqual(1);
  });

  const gcBot: Bot = (me) => (me.st === ST_BLOCKSTUN ? IN_ATK : 0);

  it('R10: guarded dash → turnback loses to the fastest GC (v1.0: the GB is faster, but on an attacking GC it only chips)', () => {
    const tb: Bot = (me) => (me.move === M_S1 && me.sf === 12 ? IN_S2 : 0);
    // turnback vs a plain guard: crush
    const a = new Scenario('volt', 'blaze', 4).run(120, dashBot(0, tb), guard);
    expect(a.events(EV_CRUSH, 0).length).toBe(1);
    // head-on: the GC wins (the turnback reaches a GC in its startup: no guard to break → no crush)
    const c = new Scenario('volt', 'blaze', 4).run(120, dashBot(0, tb), gcBot);
    expect(c.hits(1).length).toBeGreaterThanOrEqual(1);
    expect(c.events(EV_CRUSH, 0).length).toBe(0);
    expect(volt.moves[M_S2].S).toBeGreaterThanOrEqual(21); // R12
  });

  it('R11: guarded dash → N1 beats the fastest GC', () => {
    const n1: Bot = (me) => (me.move === M_S1 && me.sf === 22 ? IN_ATK : 0);
    const sc = new Scenario('volt', 'blaze', 4).run(120, dashBot(0, n1), gcBot);
    const vh = sc.hits(0);
    expect(vh.length).toBe(1);
    expect(sc.moves(0).some((e) => e.a === M_N1)).toBe(true);
    expect(sc.hits(1).length).toBe(0);
  });

  it('R13: any attack touching the dash wins, ×1.5, never a trade (all characters)', () => {
    for (let ci = 0; ci < CHARACTERS.length; ci++) {
      const c = getChar(ci);
      const tries: [string, number, number][] = [
        ['N1', M_N1, c.moves[M_N1].dmg],
        ['GC', M_GC, c.moves[M_GC].dmg],
      ];
      const gb = [M_S1, M_S2].find((k) => c.moves[k].gb);
      if (gb !== undefined) tries.push(['GB', gb, c.moves[gb].gb!.dmgGuard]);
      for (const [name, mi, base] of tries) {
        for (const dashSf of [2, volt.moves[M_S1].S - 1]) {
          const m = c.moves[mi];
          const sc = new Scenario('volt', CHARACTERS[ci].id, 1.2);
          const [v, o] = sc.s.f;
          v.st = ST_ATTACK; v.move = M_S1; v.sf = dashSf; v.moveHit = 0; v.facing = 0;
          o.st = ST_ATTACK; o.move = mi; o.sf = m.S - 1; o.moveHit = 0; o.facing = 512; o.aimed = 1; o.lungePct = 0;
          sc.run(1, () => 0, () => 0);
          const oh = sc.hits(1);
          expect(oh.length, `${CHARACTERS[ci].id} ${name} @${dashSf}`).toBe(1);
          expect(oh[0].b & HF_PUNISH).toBeTruthy();
          expect(oh[0].a).toBe(Math.floor((base * 150) / 100));
          expect(sc.hits(0).length).toBe(0);
          expect([ST_HITSTUN, ST_DOWN]).toContain(v.st);
        }
      }
    }
  });

  it('R13: the punish keeps ×1.5 through the chain (N1 → 2 → 3)', () => {
    const sc = new Scenario('volt', 'blaze', 1.2);
    const [v, o] = sc.s.f;
    const bl = getChar(charIndex('blaze'));
    v.st = ST_ATTACK; v.move = M_S1; v.sf = 5; v.facing = 0;
    o.st = ST_ATTACK; o.move = M_N1; o.sf = bl.moves[M_N1].S - 1; o.facing = 512; o.aimed = 1; o.lungePct = 0;
    sc.run(200, () => 0, (_m, _o, _s, t) => (t % 2 ? IN_ATK : 0));
    const h = sc.hits(1);
    expect(h.length).toBe(3);
    expect(h.map((e) => e.a)).toEqual([67, 60, 105]);
  });

  it('R13: a bullet catches a dash too (×1.5)', () => {
    const sc = new Scenario('ray', 'volt', 5);
    sc.s.f[0].shootMode = 1;
    sc.run(60, shoot(1), (me, op, _s, t) => {
      if (me.st === ST_FREE && nearestShot(op, me) < u(3.2) && me.steps === 3) return stick(16) | IN_STEP;
      if (me.st === ST_STEP && me.sf === 3) return stick(16) | IN_S1;
      return 0;
    });
    const h = sc.hits(0);
    // either the bullet was just-dodged by the step's travel, or it caught the dash
    if (sc.events(EV_JUST, 1).length === 0) {
      expect(h.length).toBe(1);
      expect(h[0].b & HF_PUNISH).toBeTruthy();
      expect(h[0].a).toBe(30);
    }
  });

  it('v1.0: a dash that hits chains into the next dash by mashing S1 — 4 cost = 4 hits (a skill-only combo, ×0.8 damage)', () => {
    const d = volt.moves[M_S1];
    expect(d.dmg).toBe(44);
    const walkIn: Bot = (me) => (me.statHitsTaken > 0 ? 0 : stick(16));
    const mashS1: Bot = (_m, _o, _s, t) => (t % 2 ? 0 : IN_S1);
    const sc = new Scenario('volt', 'blaze', 3);
    sc.s.f[0].cost = 16;
    sc.run(240, mashS1, walkIn);
    const h = sc.hits(0);
    expect(h.length).toBe(4);
    expect(h.map((e) => e.a)).toEqual([44, 44, 44, 35]); // 4th hit: 80% scaling
    expect(sc.s.f[0].cost).toBe(0);
    // the chain is one combo: the defender never gets out of hit stun between the dashes
    const free = sc.freeAt[1].filter((f) => f > h[0].lf && f < h[3].lf);
    expect(free.length).toBe(0);
    // 2 cost → 2 hits
    const two = new Scenario('volt', 'blaze', 3);
    two.s.f[0].cost = 8;
    two.run(240, mashS1, walkIn);
    expect(two.hits(0).length).toBe(2);
  });

  it('v1.0: a guarded or whiffed dash does not chain (the next dash only after its recovery)', () => {
    const sc = new Scenario('volt', 'blaze', 3);
    sc.s.f[0].cost = 16;
    const first: Bot = (me, _o, _s, t) => (t === 0 ? IN_S1 : me.move === M_S1 && me.sf >= 12 && me.sf <= 18 && t % 2 === 0 ? IN_S1 : 0); // (presses expire before its recovery ends)
    sc.run(40, first, guard);
    expect(sc.blocks(0).length).toBe(1);
    expect(sc.moves(0).length).toBe(1);
    const w = new Scenario('volt', 'blaze', 9);
    w.s.f[0].cost = 16;
    w.run(40, first, guard);
    expect(w.moves(0).length).toBe(1);
  });

  it('riposte (hexagon) catches the dash (a circle)', () => {
    const sc = new Scenario('volt', 'bastion', 4);
    sc.s.f[1].cost = 16;
    sc.run(80, dashBot(0), (me, op) => (op.st === ST_ATTACK && op.move === M_S1 && op.sf === 2 && me.st === ST_FREE ? IN_S1 : 0));
    expect(sc.events(EV_RIPOSTE, 1).length).toBe(1);
  });

  it('turnback only right after a dash', () => {
    // from neutral, S2 is the (instant) overcharge — never the turnback, and no move starts
    const sc = new Scenario('volt', 'blaze', 3);
    sc.run(30, (_m, _o, _s, t) => (t === 0 ? IN_S2 : 0), guard);
    expect(sc.moves(0).length).toBe(0);
    expect(sc.s.f[0].power).toBe(25);
    // too late (after the 8F window)
    const late = new Scenario('volt', 'blaze', 4).run(100, dashBot(0, (me) => (me.move === M_S1 && me.sf === 21 ? IN_S2 : 0)), guard);
    expect(late.moves(0).some((e) => e.a === M_S2)).toBe(false);
    expect(late.events(EV_MOVE, 0).length).toBe(1);
  });

  describe('v1.2: オーバーチャージ（何もしていない時のS2）', () => {
    const oc = volt.moves[volt.s2Neutral];
    const walkIn: Bot = (me) => (me.statHitsTaken > 0 ? 0 : stick(16));
    const mashS1: Bot = (_m, _o, _s, t) => (t % 2 ? 0 : IN_S1);

    it('v1.3: costs 2 and charges the frame S2 is pressed (0F), without starting a move', () => {
      expect(oc.cost).toBe(2 * 4);
      expect(oc.instant).toBe(true);
      const sc = new Scenario('volt', 'blaze', 6);
      sc.run(1, () => IN_S2, guard);
      expect(sc.s.f[0].power).toBe(25);
      expect(sc.s.f[0].cost).toBe(0); // start 2 − 2
      expect(sc.s.f[0].st).toBe(ST_FREE);
      expect(sc.moves(0).length).toBe(0);
    });

    it('v1.3: works during any action — an attack, a step, guard stun — without interrupting it', () => {
      // mid-N1: the swing goes on and lands for 50 (40 × 1.25)
      const a = new Scenario('volt', 'blaze', 2);
      a.run(60, (me, _o, _s, t) => (t === 0 ? IN_ATK : me.st === ST_ATTACK && me.sf === 5 ? IN_S2 : 0), (me) => (me.statHitsTaken > 0 ? 0 : stick(16)));
      expect(a.moves(0).length).toBe(1);
      expect(a.hits(0).map((e) => e.a)).toEqual([50]);
      // mid-step: the step keeps going
      const b = new Scenario('volt', 'blaze', 6);
      b.run(20, (me, _o, _s, t) => (t === 0 ? IN_STEP | stick(8) : me.st === ST_STEP && me.sf === 4 ? IN_S2 : 0), guard);
      expect(b.s.f[0].power).toBe(25);
      expect(b.events(EV_STEP, 0).length).toBe(1);
      // in guard stun
      const c = new Scenario('volt', 'blaze', 2);
      c.run(40, (me) => (me.st === ST_BLOCKSTUN && me.sf === 2 ? IN_S2 : 0), (_m, _o, _s, t) => (t === 0 ? IN_ATK : 0));
      expect(c.blocks(1).length).toBe(1);
      expect(c.s.f[0].power).toBe(25);
    });

    it('+25% to every attack until Volt takes damage (dash ×4: 55/55/55/44)', () => {
      const sc = new Scenario('volt', 'blaze', 3);
      sc.s.f[0].power = 25;
      sc.s.f[0].cost = 16;
      sc.run(240, mashS1, walkIn);
      expect(sc.hits(0).map((e) => e.a)).toEqual([55, 55, 55, 44]);
      expect(sc.s.f[0].power).toBe(25); // dealing damage keeps it
      // N1 → N2 → N3 ×1.25
      const n = new Scenario('volt', 'blaze', 2);
      n.s.f[0].power = 25;
      n.run(200, sequence('AAA'), (me) => (me.statHitsTaken > 0 ? 0 : stick(16)));
      expect(n.hits(0).map((e) => e.a)).toEqual([50, 45, 77]);
    });

    it('taking any damage ends it', () => {
      const sc = new Scenario('volt', 'blaze', 2);
      sc.s.f[0].power = 25;
      sc.run(60, hold(stick(8)), (_m, _o, _s, t) => (t === 0 ? IN_ATK : 0));
      expect(sc.hits(1).length).toBe(1);
      expect(sc.s.f[0].power).toBe(0);
    });

    it('while charged S2 does nothing (no stacking); a double tap pays once; not while being hit', () => {
      const sc = new Scenario('volt', 'blaze', 6);
      sc.s.f[0].power = 25;
      sc.s.f[0].cost = 16;
      sc.run(30, (_m, _o, _s, t) => (t === 0 ? IN_S2 : 0), guard);
      expect(sc.moves(0).length).toBe(0);
      expect(sc.s.f[0].cost).toBe(16);
      // double tap: the 2nd press within the lock is swallowed (not buffered either)
      const d = new Scenario('ray', 'blaze', 6);
      d.s.f[0].cost = 16;
      d.run(30, (_m, _o, _s, t) => (t === 0 || t === 6 ? IN_S1 : 0), guard);
      expect(d.s.f[0].shootMode).toBe(1);
      expect(d.s.f[0].cost).toBe(12);
      expect(d.events(EV_MODE, 0).length).toBe(1);
      // after the lock a new press works again
      d.run(10, (_m, _o, _s, t) => (t === 30 + SYSTEM.instantLock ? IN_S1 : 0), guard);
      d.run(10, (_m, _o, _s, t) => (t === 40 ? IN_S1 : 0), guard);
      expect(d.events(EV_MODE, 0).length).toBe(2);
      expect(d.s.f[0].shootMode).toBe(0);
      // being hit: no charge
      const p = new Scenario('volt', 'blaze', 2);
      p.run(30, (me) => (me.st === ST_HITSTUN ? IN_S2 : stick(8)), (_m, _o, _s, t) => (t === 0 ? IN_ATK : 0));
      expect(p.hits(1).length).toBe(1);
      expect(p.s.f[0].power).toBe(0);
    });

    it('right after a dash S2 is still the turnback guard break', () => {
      const sc = new Scenario('volt', 'blaze', 4);
      sc.s.f[0].cost = 16;
      sc.run(120, dashBot(0, (me) => (me.move === M_S1 && me.sf === 15 ? IN_S2 : 0)), guard);
      expect(sc.moves(0).map((e) => e.a)).toEqual([M_S1, M_S2]);
      expect(sc.events(EV_CRUSH, 0).length).toBe(1);
      expect(sc.s.f[0].power).toBe(0);
    });

    it('power resets at the next round', () => {
      const sc = new Scenario('volt', 'blaze', 2);
      sc.s.f[0].power = 25;
      sc.s.f[1].hp = 0;
      sc.run(300, () => 0, guard, () => sc.s.round === 2);
      expect(sc.s.round).toBe(2);
      expect(sc.s.f[0].power).toBe(0);
    });
  });
});
