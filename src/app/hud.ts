// DOM HUD: HP (with delayed damage trail), round wins, timer, cost & step stock.
// Only writes to the DOM when a value changes.
import type { Sim } from '../core/sim';
import type { BattleView } from '../render/battle-view';
import { SYSTEM } from '../data/system';
import { COST_UNIT } from '../core/compile';
import { h, hex } from './ui';

export function buildHud(sim: Sim, view: BattleView, tags: [string, string]) {
  const el = h('div', { class: 'hud' });
  const sides = [0, 1].map((i) => {
    const def = sim.char(i).def;
    const color = hex(view.colorOf(i));
    const wins = h('span', { class: 'wins' });
    for (let k = 0; k < SYSTEM.round.winsNeeded; k++) wins.append(h('i'));
    const fill = h('i', { class: 'fill' });
    const lag = h('i', { class: 'lag' });
    const hp = h('div', { class: 'hp' }, lag, fill);
    const pips = h('span', { class: 'pips' });
    for (let k = 0; k < SYSTEM.cost.max; k++) pips.append(h('i'));
    const steps = h('span', { class: 'steps-pips' });
    for (let k = 0; k < SYSTEM.step.maxStock; k++) steps.append(h('i'));
    const side = h('div', { class: `side ${i === 0 ? 'left' : 'right'}`, style: `--c:${color}` },
      h('div', { class: 'nameline' }, h('span', { class: 'tag' }, tags[i]), h('span', null, def.name), h('span', { class: 'spacer' }), wins),
      hp,
      h('div', { class: 'res' }, pips, steps),
    );
    return { side, fill, lag, hp, wins, pips, steps, last: { hp: -1, win: -1, cost: -1, steps: -1 } };
  });
  const clock = h('div', { class: 'clock' }, '60');
  const clockSub = h('small', null, 'ROUND 1');
  const clockWrap = h('div', { class: 'hud-center' }, clock, clockSub);
  el.append(sides[0].side, clockWrap, sides[1].side);
  let lastT = -1;
  let lastRound = -1;

  return {
    el,
    center: clockWrap,
    update() {
      const s = sim.s;
      for (let i = 0; i < 2; i++) {
        const f = s.f[i];
        const d = sides[i];
        const max = sim.char(i).hp;
        if (f.hp !== d.last.hp) {
          const r = Math.max(0, f.hp / max);
          d.fill.style.transform = `scaleX(${r})`;
          if (f.hp < d.last.hp || d.last.hp < 0) d.lag.style.transform = `scaleX(${r})`;
          else d.lag.style.transform = `scaleX(${r})`;
          d.hp.classList.toggle('low', r < 0.25);
          d.last.hp = f.hp;
        }
        const w = i === 0 ? s.winsA : s.winsB;
        if (w !== d.last.win) {
          [...d.wins.children].forEach((c, k) => c.classList.toggle('on', k < w));
          d.last.win = w;
        }
        if (f.cost !== d.last.cost) {
          [...d.pips.children].forEach((c, k) => (c as HTMLElement).style.setProperty('--f', String(Math.max(0, Math.min(1, f.cost / COST_UNIT - k)))));
          d.last.cost = f.cost;
        }
        if (f.steps !== d.last.steps) {
          [...d.steps.children].forEach((c, k) => c.classList.toggle('off', k >= f.steps));
          d.last.steps = f.steps;
        }
      }
      const t = s.noTimer ? -2 : Math.ceil(s.timer / 60);
      if (t !== lastT) {
        clock.textContent = t === -2 ? '∞' : String(t);
        clock.classList.toggle('hurry', t >= 0 && t <= 10);
        lastT = t;
      }
      if (s.round !== lastRound) {
        clockSub.textContent = s.noTimer ? 'TRAINING' : `ROUND ${s.round}`;
        lastRound = s.round;
      }
    },
  };
}
