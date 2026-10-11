import { describe, expect, it } from 'vitest';
import { CHARACTERS, charIndex } from '../src/data/characters';
import { SYSTEM } from '../src/data/system';
import { getChar } from '../src/core/sim';
import { M_GC, M_S1 } from '../src/core/compile';
import { ST_BLOCKSTUN, saveState, loadState, SNAPSHOT_SIZE, hashState } from '../src/core/state';
import { Scenario, sequence, guard, IN_ATK, IN_S1, type Bot } from './harness';

/** Delay is in real ticks after the block, including hitstop. */
function counterAfter(delay: number, repeat = false): Bot {
  let sent = false;
  return (me, _op, s, t) => {
    if (me.st !== ST_BLOCKSTUN || s.frame + 1 - me.gcBlockFrame < delay) return 0;
    if (sent) return repeat && t % 2 === 0 ? IN_ATK : 0;
    sent = true;
    return IN_ATK;
  };
}

// These constraints automatically cover new characters registered in CHARACTERS.
describe.each(CHARACTERS)('$id — early guard counter', (attacker) => {
  it('punishes a stopped N1 for every defender at close range in 16 directions', () => {
    for (const defender of CHARACTERS) for (const dist of [1, 1.6, 2]) for (let dir = 0; dir < 16; dir++) {
      const sc = new Scenario(attacker.id, defender.id, dist);
      const [a, b] = sc.s.f;
      const cx = (a.x + b.x) / 2;
      const cy = a.y;
      const angle = dir * Math.PI / 8;
      const dx = Math.round(dist * 500 * Math.cos(angle));
      const dy = Math.round(dist * 500 * Math.sin(angle));
      a.x = cx - dx; b.x = cx + dx; a.y = cy - dy; b.y = cy + dy;
      a.facing = dir * 64; b.facing = (dir * 64 + 512) % 1024;
      sc.run(130, sequence('A', 0), counterAfter(SYSTEM.gc.fastWindow));
      const context = `${attacker.id} -> ${defender.id}, ${dist}u, direction ${dir}`;
      expect(sc.blocks(0).length, context).toBe(1);
      expect(sc.moves(1)[0].a, context).toBe(getChar(charIndex(defender.id)).fastGc);
      expect(sc.hits(1).length, context).toBe(1);
      expect(sc.blocks(1).length, context).toBe(0);
    }
  });

  it('one tick past the deadline reserves the old GC and lets stopped N1 guard', () => {
    for (const defender of CHARACTERS) {
      const sc = new Scenario(attacker.id, defender.id, 1.6).run(150, sequence('A', 0), counterAfter(SYSTEM.gc.fastWindow + 1));
      expect(sc.moves(1)[0].a, defender.id).toBe(M_GC);
      expect(sc.hits(1).length, defender.id).toBe(0);
      expect(sc.blocks(1).length, defender.id).toBe(1);
    }
  });

  it('early and late reservations both start when the same blockstun ends', () => {
    const early = new Scenario(attacker.id, 'bastion', 1.6).run(100, sequence('A', 0), counterAfter(1));
    const late = new Scenario(attacker.id, 'bastion', 1.6).run(100, sequence('A', 0), counterAfter(11));
    expect(early.moves(1)[0].lf).toBe(late.moves(1)[0].lf);
  });

  it('preserves the punish for every defender with 1–3F of negotiated input delay', () => {
    for (const inputDelay of [1, 2, 3]) for (const defender of CHARACTERS) {
      const sc = new Scenario(attacker.id, defender.id, 1.6, { inputDelay });
      sc.run(130, sequence('A', 0), counterAfter(SYSTEM.gc.fastWindow + inputDelay));
      expect(sc.moves(1)[0].a, defender.id).toBe(sc.sim.char(1).fastGc);
      expect(sc.hits(1).length, defender.id).toBe(1);
      expect(sc.blocks(1).length, defender.id).toBe(0);
    }
  });
});

it('later mashing cannot downgrade an already reserved fast counter', () => {
  const sc = new Scenario('blaze', 'bastion', 1.6).run(100, sequence('A', 0), counterAfter(1, true));
  expect(sc.moves(1)[0].a).toBe(getChar(charIndex('bastion')).fastGc);
});

it('holding ATK from before contact does not reserve a counter', () => {
  const sc = new Scenario('blaze', 'bastion', 1.6);
  sc.s.f[1].prevIn = IN_ATK;
  sc.run(100, sequence('A', 0), () => IN_ATK);
  expect(sc.blocks(0).length).toBe(1);
  expect(sc.moves(1).length).toBe(0);
});

it('a fast counter still cannot be countered with GC', () => {
  const sc = new Scenario('blaze', 'bastion', 1.6);
  sc.s.f[0].st = ST_BLOCKSTUN;
  sc.s.f[0].sf = 1;
  sc.s.f[0].len = 1;
  sc.s.f[0].gcBlockFrame = sc.s.frame;
  sc.run(120, counterAfter(1), (me, _op, _s, t) => me.st === ST_BLOCKSTUN && t % 2 === 0 ? IN_ATK : 0);
  expect(sc.moves(0)[0].a).toBe(getChar(charIndex('blaze')).fastGc);
  expect(sc.blocks(0).length).toBe(1);
  expect(sc.moves(1).some(e => [M_GC, getChar(charIndex('bastion')).fastGc].includes(e.a))).toBe(false);
});

it('fast counter still chains to N2 and N3 on hit', () => {
  let countered = false;
  const sc = new Scenario('blaze', 'bastion', 1.6).run(200, sequence('A', 0), (me, _op, _s, t) => {
    if (me.st === ST_BLOCKSTUN) countered = true;
    return countered && t % 2 === 0 ? IN_ATK : 0;
  });
  expect(sc.hits(1).length).toBe(3);
});

it('fast counter inherits N1 skill cancel permissions', () => {
  const blaze = getChar(charIndex('blaze'));
  expect(blaze.moves[M_S1].cancelFrom & (1 << blaze.fastGc)).not.toBe(0);
  const sc = new Scenario('bastion', 'blaze', 1.6);
  let countered = false;
  sc.run(200, sequence('A', 0), (me, _op, _s, t) => {
    if (!countered && me.st === ST_BLOCKSTUN) { countered = true; return IN_ATK; }
    return countered && t % 2 === 0 ? IN_S1 : 0;
  });
  expect(sc.moves(1).some(e => e.a === M_S1)).toBe(true);
});

it('snapshot restoration replays the reservation and its deadline deterministically', () => {
  const sc = new Scenario('blaze', 'bastion', 1.6);
  const attack = sequence('A', 0);
  while (!sc.s.f[1].statBlocks) sc.tick(attack, guard);
  sc.tick(guard, () => IN_ATK); // inside hitstop, reservation is already classified
  expect(sc.s.f[1].gcQueued).toBe(2);
  const saved = saveState(sc.s, new Int32Array(SNAPSHOT_SIZE));
  const run = () => { for (let i = 0; i < 100; i++) sc.sim.step(0, 0); return hashState(sc.s); };
  const expected = run();
  loadState(sc.s, saved);
  expect(sc.s.f[1].gcQueued).toBe(2);
  expect(run()).toBe(expected);
});
