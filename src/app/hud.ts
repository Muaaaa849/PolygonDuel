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
    for (let k = 0; k < sim.char(i).stepStock; k++) steps.append(h('i'));
    // shooters: a badge while the shooting mode is on (both players can see it)
    const mode = h('span', { class: 'mode-badge' }, '◆ SHOT');
    // overcharge (ヴォルト): attack up until hit
    const power = h('span', { class: 'mode-badge power' }, '⚡ ATK+');
    // ブラッド: the overdrive's remaining seconds / the exhaustion
    const drive = h('span', { class: 'mode-badge drive' }, '🔥 DRIVE');
    const side = h('div', { class: `side ${i === 0 ? 'left' : 'right'}`, style: `--c:${color}` },
      h('div', { class: 'nameline' }, h('span', { class: 'tag' }, tags[i]), h('span', null, def.name), h('span', { class: 'spacer' }), wins),
      hp,
      h('div', { class: 'res' }, pips, steps, mode, power, drive),
    );
    return { side, fill, lag, hp, wins, pips, steps, mode, power, drive, last: { hp: -1, win: -1, cost: -1, steps: -1, mode: -1, power: -1, drive: -1 } };
  });
  const clock = h('div', { class: 'clock' }, String(SYSTEM.round.seconds));
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
        // (the opponent can't see the cost an illusion took — view.shownCost hides it)
        const cost = view.shownCost(i);
        if (cost !== d.last.cost) {
          [...d.pips.children].forEach((c, k) => (c as HTMLElement).style.setProperty('--f', String(Math.max(0, Math.min(1, cost / COST_UNIT - k)))));
          d.last.cost = cost;
        }
        if (f.steps !== d.last.steps) {
          [...d.steps.children].forEach((c, k) => c.classList.toggle('off', k >= f.steps));
          d.last.steps = f.steps;
        }
        if (f.shootMode !== d.last.mode) {
          d.mode.classList.toggle('on', f.shootMode === 1);
          d.last.mode = f.shootMode;
        }
        // overdrive: seconds of fuel left (cost × 1.25 s) / the exhaustion (seconds left); nothing otherwise
        const dr = sim.char(i).drive;
        if (dr) {
          const key = f.drive ? 1 + Math.ceil((f.cost * dr.drainFrames - f.driveTick) / 60) : f.exhaust > 0 ? -1 - Math.ceil(f.exhaust / 60) : 0;
          if (key !== d.last.drive) {
            d.drive.textContent = key > 0 ? `🔥 DRIVE ${key - 1}s` : key < 0 ? `💤 EXHAUST ${-key - 1}s` : '';
            d.drive.classList.toggle('on', key !== 0);
            d.drive.classList.toggle('spent', key < 0);
            d.last.drive = key;
          }
        }
        if (f.power !== d.last.power) {
          d.power.textContent = `⚡ ATK+${f.power}%`;
          d.power.classList.toggle('on', f.power > 0);
          d.last.power = f.power;
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
