import { describe, expect, it } from 'vitest';
import { CHARACTERS, charIndex } from '../src/data/characters';
import { getChar } from '../src/core/sim';
import { M_S1, M_N1 } from '../src/core/compile';
import { ST_ATTACK, ST_BLOCKSTUN } from '../src/core/state';
import { Scenario, IN_ATK, IN_S1 } from './harness';

const volt = getChar(charIndex('volt'));
describe.each(CHARACTERS)('Volt guarded dash against $id', (defender) => {
  it('stays +7 on block and its fastest N1 beats the fast counter', () => {
    for (const dist of [1.6, 2.4, 3.2, 4]) for (const reversed of [false, true]) {
      const sc = new Scenario('volt', defender.id, dist);
      if (reversed) {
        const [a, b] = sc.s.f;
        [a.x, b.x] = [b.x, a.x];
        a.facing = 512; b.facing = 0;
      }
      const passive = new Scenario('volt', defender.id, dist);
      for (let i = 0; i < 2; i++) {
        passive.s.f[i].x = sc.s.f[i].x;
        passive.s.f[i].facing = sc.s.f[i].facing;
      }
      passive.run(90, (_me, _op, _s, t) => t === 0 ? IN_S1 : 0, () => 0);
      expect(passive.blocks(0).length).toBe(1);
      expect(passive.freeAt[1][0] - passive.freeAt[0][0]).toBe(7);
      sc.run(140,
        (me, _op, _s, t) => t === 0 ? IN_S1 : me.st === ST_ATTACK && me.move === M_S1 && me.sf === volt.moves[M_S1].T - 1 ? IN_ATK : 0,
        me => me.st === ST_BLOCKSTUN ? IN_ATK : 0);
      const context = `${defender.id}, ${dist}u, reversed=${reversed}`;
      expect(sc.blocks(0).length, context).toBe(1);
      expect(sc.moves(1)[0].a, context).toBe(getChar(charIndex(defender.id)).fastGc);
      expect(sc.moves(0).map(e => e.a), context).toEqual([M_S1, M_N1]);
      expect(sc.hits(0).length, context).toBe(1);
      expect(sc.hits(1).length, context).toBe(0);
    }
  });
});
