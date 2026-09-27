// Scenario harness: drives the real Sim with scripted "bots" and records what happened.
import { Sim } from '../src/core/sim';
import { charIndex } from '../src/data/characters';
import { u } from '../src/core/fixed';
import { SYSTEM } from '../src/data/system';
import { type SimEvent, EV_HIT, EV_BLOCK, EV_MOVE } from '../src/core/events';
import { IN_ATK, IN_S1, IN_S2, IN_STEP, IN_STICK } from '../src/core/input';
import type { FighterState, GameState } from '../src/core/state';
import { ST_FREE, ST_ATTACK } from '../src/core/state';

export type Bot = (me: FighterState, op: FighterState, s: GameState, t: number) => number;

export interface Logged extends SimEvent {
  /** Logical frame (frames where fighters actually advanced). */
  lf: number;
}

export class Scenario {
  sim: Sim;
  log: Logged[] = [];
  /** Logical frame counter — excludes hitstop / freeze frames. */
  lf = 0;
  t = 0;
  /** Logical frame each fighter last became free (st FREE after not being free). */
  freeAt: [number[], number[]] = [[], []];

  constructor(a: string, b: string, dist = 2, opts: { training?: boolean } = {}) {
    this.sim = new Sim(charIndex(a), charIndex(b), opts);
    this.sim.skipIntro();
    const s = this.sim.s;
    s.noTimer = 1;
    s.f[0].x = u(SYSTEM.field.w / 2) - Math.round((dist * 1000) / 2);
    s.f[1].x = s.f[0].x + Math.round(dist * 1000);
    s.f[0].y = s.f[1].y = u(SYSTEM.field.h / 2);
    s.f[0].facing = 0;
    s.f[1].facing = 512;
  }

  get s(): GameState {
    return this.sim.s;
  }

  tick(botA: Bot, botB: Bot): void {
    const s = this.sim.s;
    const advancing = s.hitstop === 0 && s.freeze === 0;
    const wasFree = [s.f[0].st === ST_FREE, s.f[1].st === ST_FREE];
    const ia = botA(s.f[0], s.f[1], s, this.t);
    const ib = botB(s.f[1], s.f[0], s, this.t);
    this.sim.step(ia, ib);
    if (advancing) this.lf++;
    this.t++;
    for (const e of this.sim.events) this.log.push({ ...e, lf: this.lf });
    for (let i = 0; i < 2; i++) if (!wasFree[i] && s.f[i].st === ST_FREE) this.freeAt[i].push(this.lf);
  }

  run(frames: number, botA: Bot, botB: Bot, until?: () => boolean): this {
    for (let i = 0; i < frames; i++) {
      this.tick(botA, botB);
      if (until?.()) break;
    }
    return this;
  }

  events(type: number, who?: number): Logged[] {
    return this.log.filter((e) => e.type === type && (who === undefined || e.who === who));
  }

  hits(who: number): Logged[] {
    return this.events(EV_HIT, who);
  }
  blocks(who: number): Logged[] {
    return this.events(EV_BLOCK, who);
  }
  moves(who: number): Logged[] {
    return this.events(EV_MOVE, who);
  }
}

// ── bots ──
export const guard: Bot = () => 0;
/** Face-right / face-left stick, used to walk. */
export const hold = (w: number): Bot => () => w;
export const stick = (dir: number): number => IN_STICK | (dir & 31);

/** Press a button on every other frame (a human mash). */
export const mash = (btn: number, base = 0): Bot => (_m, _o, _s, t) => base | (t % 2 === 0 ? btn : 0);

/** Press `btn` once, on the first tick where `cond` holds; otherwise output `base`. */
export function pressWhen(
  btn: number,
  cond: (me: FighterState, op: FighterState, s: GameState, t: number) => boolean,
  base = 0,
): Bot {
  let done = false;
  let releasing = false;
  return (me, op, s, t) => {
    if (releasing) {
      releasing = false;
      return base;
    }
    if (!done && cond(me, op, s, t)) {
      done = true;
      releasing = true;
      return base | btn;
    }
    return base;
  };
}

/**
 * Sequence bot: mashes each button in turn; advances when a new move starts.
 * Buttons: 'A' attack, '1' S1, '2' S2, 'T' step. After the list is exhausted it outputs `after`.
 */
export function sequence(seq: string, after = 0): Bot {
  const map: Record<string, number> = { A: IN_ATK, '1': IN_S1, '2': IN_S2, T: IN_STEP };
  let idx = 0;
  let prevSt = -1;
  let prevMove = -1;
  let prevSf = 0;
  return (me, _op, _s, t) => {
    const started = me.st === ST_ATTACK && (prevSt !== ST_ATTACK || me.move !== prevMove || me.sf < prevSf);
    if (started) idx++;
    prevSt = me.st;
    prevMove = me.move;
    prevSf = me.sf;
    if (idx >= seq.length) return after;
    return t % 2 === 0 ? map[seq[idx]] : 0;
  };
}

export { IN_ATK, IN_S1, IN_S2, IN_STEP, IN_STICK };
