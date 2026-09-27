// Plan §6-9: the frame "inequalities" must hold for every character. These tests
// run the real simulation with scripted players — adding a character that breaks
// a rule fails CI.
import { describe, expect, it } from 'vitest';
import { Scenario, guard, sequence, pressWhen, mash, stick, IN_ATK, IN_S1, IN_STEP, type Bot } from './harness';
import { CHARACTERS } from '../src/data/characters';
import { getChar } from '../src/core/sim';
import { M_N1, M_N2, M_GC } from '../src/core/compile';
import { EV_CRUSH, EV_JUST, EV_RIPOSTE, HF_COUNTER, HF_JA, HF_OTG } from '../src/core/events';
import { ST_ATTACK, ST_BLOCKSTUN, MH_HIT, MH_BLOCK } from '../src/core/state';

const IDS = CHARACTERS.map((c) => c.id);

/** Dummy that walks into the attacker until hit once, then guards forever (training "ヒット後ガード"). */
const hitThenGuard: Bot = (me) => (me.statHitsTaken > 0 ? 0 : stick(16));
/** Guards; mashes attack only while in blockstun after `n` blocks → GC. */
const gcAfterBlocks = (n: number): Bot => (me, _o, _s, t) =>
  me.st === ST_BLOCKSTUN && me.statBlocks >= n ? (t % 2 === 0 ? IN_ATK : 0) : 0;

describe.each(IDS)('%s — normal chain rules', (id) => {
  const c = getChar(IDS.indexOf(id));
  const n1 = c.moves[M_N1];
  const n2 = c.moves[M_N2];

  it('C1/C2: 1→2→3 completes when the first hit lands (defender never gets to guard)', () => {
    const sc = new Scenario(id, 'bastion', 1.6).run(240, sequence('AAA'), hitThenGuard);
    expect(sc.hits(0).length).toBe(3);
    expect(sc.blocks(0).length).toBe(0);
  });

  it('C1: N2 input on the LAST frame of the hit window still combos', () => {
    const late: Bot = pressWhen(IN_ATK, (me) => me.st === ST_ATTACK && me.move === M_N1 && me.moveHit === MH_HIT && me.sf === n1.chainHit!.b - 1);
    const first = pressWhen(IN_ATK, () => true);
    const bot: Bot = (me, op, s, t) => first(me, op, s, t) | late(me, op, s, t);
    const sc = new Scenario(id, 'bastion', 1.6).run(200, bot, hitThenGuard);
    expect(sc.hits(0).length).toBe(2);
    expect(sc.blocks(0).length).toBe(0);
  });

  it('C2: N3 input on the LAST frame of the N2 window still combos', () => {
    const late: Bot = pressWhen(IN_ATK, (me) => me.st === ST_ATTACK && me.move === M_N2 && me.moveHit === MH_HIT && me.sf === n2.chainHit!.b - 1);
    const seq = sequence('AA');
    const bot: Bot = (me, op, s, t) => seq(me, op, s, t) | late(me, op, s, t);
    const sc = new Scenario(id, 'bastion', 1.6).run(260, bot, hitThenGuard);
    expect(sc.hits(0).length).toBe(3);
  });

  it('C3: stopping after N2 lets the defender act 3F earlier (no 1-2 loop)', () => {
    const sc = new Scenario(id, 'bastion', 1.6).run(220, sequence('AA', 0), hitThenGuard);
    expect(sc.hits(0).length).toBe(2);
    const atkFree = sc.freeAt[0].at(-1)!;
    const defFree = sc.freeAt[1].at(-1)!;
    expect(atkFree - defFree).toBe(3);
    // and a mashed N1 after that is blocked
    const sc2 = new Scenario(id, 'bastion', 1.6).run(260, sequence('AAA'.slice(0, 2), IN_ATK), hitThenGuard);
    void sc2;
    const loop = new Scenario(id, 'bastion', 1.6);
    let phase = 0;
    const looper: Bot = (me, op, s, t) => {
      if (phase === 0 && me.st === ST_ATTACK && me.move === M_N2) phase = 1;
      if (phase === 1 && me.st !== ST_ATTACK) phase = 2;
      if (phase === 1) return 0;
      return t % 2 === 0 ? IN_ATK : 0;
    };
    loop.run(260, looper, hitThenGuard);
    expect(loop.hits(0).length).toBe(2);
    expect(loop.blocks(0).length).toBeGreaterThanOrEqual(1);
  });

  it('C4: N1 blocked → mashing N2 loses to GC (GC counter-hits the N2 startup)', () => {
    const sc = new Scenario(id, 'bastion', 1.6).run(200, sequence('AA'), gcAfterBlocks(1));
    expect(sc.blocks(0).length).toBe(1);
    expect(sc.hits(1).length).toBeGreaterThanOrEqual(1);
    expect(sc.hits(1)[0].b & HF_COUNTER).toBeTruthy();
    expect(sc.hits(0).length).toBe(0);
  });

  it('C5: stopping after a blocked N1 is safe — the attacker blocks the GC', () => {
    const sc = new Scenario(id, 'bastion', 1.6).run(200, sequence('A', 0), gcAfterBlocks(1));
    expect(sc.blocks(0).length).toBe(1);
    expect(sc.hits(1).length).toBe(0);
    expect(sc.blocks(1).length).toBe(1); // the GC got blocked
  });

  it('C5: a blocked GC leaves the GC user at -4', () => {
    const sc = new Scenario(id, id, 1.6).run(220, sequence('A', 0), gcAfterBlocks(1));
    expect(sc.blocks(1).length).toBe(1);
    const blockerFree = sc.freeAt[0].at(-1)!;
    const gcUserFree = sc.freeAt[1].at(-1)!;
    expect(gcUserFree - blockerFree).toBe(4);
  });

  it('C6: N2 blocked → mashing N3 loses to GC', () => {
    const sc = new Scenario(id, 'bastion', 1.6).run(260, sequence('AAA'), gcAfterBlocks(2));
    expect(sc.blocks(0).length).toBe(2);
    expect(sc.hits(1).length).toBeGreaterThanOrEqual(1);
    expect(sc.hits(0).length).toBe(0);
  });

  it('C7: stopping after a blocked N2 → GC is guaranteed', () => {
    const sc = new Scenario(id, 'bastion', 1.6).run(260, sequence('AA', 0), gcAfterBlocks(2));
    expect(sc.blocks(0).length).toBe(2);
    expect(sc.hits(1).length).toBeGreaterThanOrEqual(1);
  });

  it('C8: N3 blocked → big punish guaranteed', () => {
    const sc = new Scenario(id, 'bastion', 1.6).run(320, sequence('AAA', 0), gcAfterBlocks(3));
    expect(sc.blocks(0).length).toBe(3);
    expect(sc.hits(1).length).toBeGreaterThanOrEqual(1);
  });

  it('GC-on-GC is impossible: the GC blocker cannot GC, and its N1 can be blocked', () => {
    // A: N1 (blocked) → guard → blocks the GC → mashes attack in that blockstun.
    let blockedGc = false;
    const a: Bot = (me, _o, _s, t) => {
      if (me.statBlocks > 0) blockedGc = true;
      if (!blockedGc) return me.st === ST_ATTACK ? 0 : t < 2 ? IN_ATK : 0;
      return me.st === ST_BLOCKSTUN ? (t % 2 === 0 ? IN_ATK : 0) : 0;
    };
    const sc = new Scenario(id, id, 1.6).run(300, a, gcAfterBlocks(1));
    expect(sc.moves(0).filter((e) => e.a === M_GC).length).toBe(0);
    expect(sc.hits(0).length).toBe(0);
  });

  it('JA is guaranteed on a just-dodged N1 whiff', () => {
    const attacker = pressWhen(IN_ATK, () => true);
    const dodger: Bot = (me, op, s, t) => {
      if (me.justWin > 0 || s.freeze > 0) return t % 2 === 0 ? IN_ATK : 0;
      return op.st === ST_ATTACK && op.move === M_N1 && op.sf === n1.S - 1 && me.st !== 4 ? IN_STEP : 0;
    };
    const sc = new Scenario(id, id, 1.6).run(120, attacker, dodger);
    expect(sc.events(EV_JUST, 1).length).toBe(1);
    expect(sc.hits(1).length).toBeGreaterThanOrEqual(1);
    expect(sc.hits(1)[0].b & HF_JA).toBeTruthy();
    expect(sc.hits(0).length).toBe(0);
  });

  it('JA is guaranteed on a just-dodged GC whiff', () => {
    const gc = c.moves[M_GC];
    let stepped = false;
    const a: Bot = (me, op, s, t) => {
      if (me.justWin > 0 || s.freeze > 0) return t % 2 === 0 ? IN_ATK : 0;
      if (!stepped && op.st === ST_ATTACK && op.move === M_GC && op.sf === gc.S - 1) {
        stepped = true;
        return IN_STEP;
      }
      if (me.statBlocks === 0 && me.st !== ST_ATTACK && t < 3) return IN_ATK;
      return 0;
    };
    const sc = new Scenario(id, id, 1.6).run(200, a, gcAfterBlocks(1));
    expect(sc.blocks(0).length).toBe(1);
    expect(sc.events(EV_JUST, 0).length).toBe(1);
    expect(sc.hits(0).length).toBeGreaterThanOrEqual(1);
    expect(sc.hits(0)[0].b & HF_JA).toBeTruthy();
  });
});

describe('skill & system rules (plan §6-9 table 2)', () => {
  it('Blaze: S1 hit → N1 chain reset combos', () => {
    const sc = new Scenario('blaze', 'bastion', 1.6).run(400, sequence('AA1AAA'), hitThenGuard);
    expect(sc.hits(0).length).toBe(6);
    expect(sc.blocks(0).length).toBe(0);
  });

  it('Blaze: N1 blocked → S1 beats a GC attempt (counter)', () => {
    const sc = new Scenario('blaze', 'bastion', 1.6).run(200, sequence('A1'), gcAfterBlocks(1));
    expect(sc.hits(0).length).toBe(1);
    expect(sc.hits(0)[0].b & HF_COUNTER).toBeTruthy();
    expect(sc.hits(1).length).toBe(0);
  });

  it('Blaze: S1 blocked → GC is guaranteed', () => {
    const sc = new Scenario('blaze', 'bastion', 1.6).run(260, sequence('A1', 0), gcAfterBlocks(2));
    expect(sc.blocks(0).length).toBe(2);
    expect(sc.hits(1).length).toBeGreaterThanOrEqual(1);
  });

  it('Blaze: N1 blocked → GB loses to GC', () => {
    const sc = new Scenario('blaze', 'bastion', 1.6).run(220, sequence('A2'), gcAfterBlocks(1));
    expect(sc.events(EV_CRUSH).length).toBe(0);
    expect(sc.hits(1).length).toBeGreaterThanOrEqual(1);
  });

  it.each(['blaze', 'bastion'])('%s: GB crush → full 1→2→3', (id) => {
    const sc = new Scenario(id, 'zephyr', 2.2).run(400, sequence('2AAA'), guard);
    expect(sc.events(EV_CRUSH, 0).length).toBe(1);
    expect(sc.hits(0).length).toBe(3);
  });

  it('Bastion: riposte canceled from a blocked N1 on frames 30–37 catches the GC', () => {
    for (let cf = 30; cf <= 37; cf++) {
      const a: Bot = (me, op, s, t) => {
        if (t === 0) return IN_ATK;
        if (me.st === ST_ATTACK && me.move === M_N1 && me.moveHit === MH_BLOCK && me.sf === cf - 1) return IN_S1;
        return 0;
      };
      const sc = new Scenario('bastion', 'blaze', 1.6).run(200, a, gcAfterBlocks(1));
      expect(sc.events(EV_RIPOSTE, 0).length, `cancel frame ${cf}`).toBe(1);
      expect(sc.hits(1).length, `cancel frame ${cf}`).toBe(0);
    }
  });

  it('Zephyr: N3 → S1 lands as a down-attack (OTG) within the window', () => {
    const sc = new Scenario('zephyr', 'bastion', 1.6).run(300, sequence('AAA1'), hitThenGuard);
    expect(sc.hits(0).length).toBe(4);
    expect(sc.hits(0)[3].b & HF_OTG).toBeTruthy();
  });

  it('JA→2→3 continues the 1.5x multiplier', () => {
    const attacker = pressWhen(IN_ATK, () => true);
    const n1 = getChar(0).moves[M_N1];
    let phase = 0;
    const dodger: Bot = (me, op, s, t) => {
      if (phase === 0 && op.st === ST_ATTACK && op.move === M_N1 && op.sf === n1.S - 1) {
        phase = 1;
        return IN_STEP;
      }
      if (phase >= 1) return t % 2 === 0 ? IN_ATK : 0;
      return 0;
    };
    const sc = new Scenario('blaze', 'blaze', 1.6).run(300, attacker, dodger);
    const hits = sc.hits(1);
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits.slice(0, 3).every((h) => h.b & HF_JA)).toBe(true);
  });
});

void mash;
void IN_S1;

describe('spacing (plan §7-2: distance control is rewarded)', () => {
  it("Zephyr lance tip (S1 at max range) is out of GC reach", () => {
    const s1 = getChar(IDS.indexOf('zephyr')).moves[5];
    const dist = (s1.reach + s1.lunge) / 1000 + 0.5 - 0.05;
    const sc = new Scenario('zephyr', 'blaze', dist).run(200, sequence('1', 0), gcAfterBlocks(1));
    expect(sc.blocks(0).length).toBe(1);
    expect(sc.blocks(1).length + sc.hits(1).length).toBe(0);
  });
});
