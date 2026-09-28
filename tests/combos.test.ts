// Plan §7: every listed combo route must deal exactly the listed damage.
import { describe, expect, it } from 'vitest';
import { Scenario, sequence, guard, stick, IN_STEP, type Bot } from './harness';
import { getChar } from '../src/core/sim';
import { charIndex } from '../src/data/characters';
import { M_N1, M_N2, M_STRIKE } from '../src/core/compile';
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
    ['ray', 'AAA', 136],
    ['ray', 'AA1', 106],
    ['volt', 'AAA', 138],
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
    ['ray', 'AAA', 204],
    ['volt', 'AAA', 207],
  ];
  it.each(ja)('%s JA route %s = %i', (id, seq, dmg) => {
    const sc = new Scenario('blaze', id, 1.6).run(500, (_m, _o, _s, t) => (t === 0 ? IN_ATK : 0), justThen(seq, 'blaze'));
    expect(dealt(sc, 1)).toBe(dmg);
  });

  it('bastion riposte → 2 → 3 = 210, and the riposte cost comes back', () => {
    // Blaze attacks into a neutral riposte; Bastion mashes ATK after the strike.
    const a: Bot = (_m, _o, _s, t) => (t === 10 ? IN_ATK : 0);
    let cost0 = -1;
    const b: Bot = (me, op, _s, t) => {
      if (cost0 < 0) cost0 = me.cost;
      if (op.st === ST_ATTACK && op.sf === 10 && me.st !== ST_ATTACK) return 1 << 7;
      return me.move === M_STRIKE || me.move === M_N2 ? (t % 2 ? IN_ATK : 0) : 0;
    };
    const sc = new Scenario('blaze', 'bastion', 1.6).run(200, a, b);
    expect(sc.events(EV_RIPOSTE, 1).length).toBe(1);
    expect(dealt(sc, 1)).toBe(210);
    // paid 1, got 1 back (+ the cost N2 / N3 earn)
    expect(sc.s.f[1].cost).toBeGreaterThanOrEqual(cost0);
  });

  it('bastion riposte pulls a far attacker in so the combo reaches (Zephyr lance)', () => {
    const a: Bot = (_m, _o, _s, t) => (t === 10 ? IN_ATK : 0);
    const b: Bot = (me, op, _s, t) => {
      if (op.st === ST_ATTACK && op.sf === 10 && me.st !== ST_ATTACK) return 1 << 7;
      return me.move === M_STRIKE || me.move === M_N2 ? (t % 2 ? IN_ATK : 0) : 0;
    };
    const sc = new Scenario('zephyr', 'bastion', 2.7).run(200, a, b);
    expect(sc.events(EV_RIPOSTE, 1).length).toBe(1);
    expect(sc.hits(1).length).toBe(2); // strike damage is on the riposte event; N2 and N3 hit
  });
});
void ST_BLOCKSTUN;
