// Plan §7: every listed combo route must deal exactly the listed damage.
import { describe, expect, it } from 'vitest';
import { Scenario, sequence, guard, stick, IN_STEP, type Bot } from './harness';
import { getChar } from '../src/core/sim';
import { charIndex } from '../src/data/characters';
import { M_N1 } from '../src/core/compile';
import { EV_RIPOSTE } from '../src/core/events';
import { ST_ATTACK, ST_BLOCKSTUN } from '../src/core/state';
import { IN_ATK } from '../src/core/input';

const hitThenGuard: Bot = (me) => (me.statHitsTaken > 0 ? 0 : stick(16));
const dealt = (sc: Scenario, who = 0) => sc.hits(who).reduce((a, e) => a + e.a, 0) + sc.log.filter((e) => e.who === who && (e.type === 4 || e.type === 8)).reduce((a, e) => a + e.a, 0);

/** Dodger bot: just-dodges the opponent's N1, then runs `seq` starting with the JA. */
function justThen(seq: string, oppChar: string): Bot {
  const n1 = getChar(charIndex(oppChar)).moves[M_N1];
  const run = sequence(seq);
  let phase = 0;
  return (me, op, s, t) => {
    if (phase === 0 && op.st === ST_ATTACK && op.move === M_N1 && op.sf === n1.S - 1) {
      phase = 1;
      return IN_STEP;
    }
    if (phase === 1) return run(me, op, s, t);
    return 0;
  };
}

describe('combo damage table (plan §7)', () => {
  const plain: [string, string, number][] = [
    ['blaze', 'AAA', 155],
    ['blaze', 'AA1AAA', 251],
    ['zephyr', 'AAA', 147],
    ['zephyr', 'AAA1', 195],
    ['zephyr', 'AA1', 142],
    ['bastion', 'AAA', 195],
    ['phantom', 'AAA', 146],
  ];
  it.each(plain)('%s %s = %i', (id, seq, dmg) => {
    const sc = new Scenario(id, 'bastion', 1.6).run(500, sequence(seq), hitThenGuard);
    expect(sc.hits(0).length).toBe(seq.length);
    expect(dealt(sc)).toBe(dmg);
  });

  const crush: [string, string, number][] = [
    ['blaze', '2AAA', 171],
    ['blaze', '2AA1AAA', 260],
    ['bastion', '2AAA', 217],
    ['phantom', '2AAA', 162],
  ];
  it.each(crush)('%s %s (crush) = %i', (id, seq, dmg) => {
    const sc = new Scenario(id, 'zephyr', 2.2).run(600, sequence(seq), guard);
    expect(dealt(sc)).toBe(dmg);
  });

  const ja: [string, string, number][] = [
    ['blaze', 'AAA', 232],
    ['zephyr', 'AAA1', 268],
    ['bastion', 'AAA', 292],
    ['phantom', 'AAA', 219],
  ];
  it.each(ja)('%s JA route %s = %i', (id, seq, dmg) => {
    const sc = new Scenario('blaze', id, 1.6).run(500, (_m, _o, _s, t) => (t === 0 ? IN_ATK : 0), justThen(seq, 'blaze'));
    expect(dealt(sc, 1)).toBe(dmg);
  });

  it('bastion riposte = 110 + knockdown', () => {
    // Blaze attacks into a neutral riposte.
    const a: Bot = (_m, _o, _s, t) => (t === 10 ? IN_ATK : 0);
    const b: Bot = (me, op) => (op.st === ST_ATTACK && op.sf === 12 && me.st !== ST_ATTACK ? 1 << 7 : 0);
    const sc = new Scenario('blaze', 'bastion', 1.6).run(120, a, b);
    expect(sc.events(EV_RIPOSTE, 1).length).toBe(1);
    expect(dealt(sc, 1)).toBe(110);
  });
});
void ST_BLOCKSTUN;
