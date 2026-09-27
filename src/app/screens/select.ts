// Character select. Each card animates the character's 1st hit at real speed,
// so "how fast is the circle / how long is the bar" is felt, not read (plan §13 step 2).
import { CHARACTERS } from '../../data/characters';
import type { CharacterDef } from '../../data/types';
import { CPU_LEVELS } from '../../ai/cpu';
import { settings, saveSettings } from '../settings';
import { backButton, h, hex, shapeIcon } from '../ui';
import { sfx } from '../../audio/sfx';
import { openMoveSheet } from './move-sheet';
import type { Screen } from '../router';

function statRows(c: CharacterDef): [string, number][] {
  const n1 = c.normals.n1;
  return [
    ['体力', (c.hp - 800) / 400],
    ['速さ', (c.walk - 3.6) / 1.8],
    ['リーチ', (n1.reach + n1.lunge - 2.0) / 1.0],
    ['円の速さ', (28 - n1.S) / 9],
    ['ガード', (c.guardMax - 180) / 140],
  ];
}

/** Real-time preview of N1: telegraph arrow grows over the startup, then the bar. */
function preview(c: CharacterDef): { canvas: HTMLCanvasElement; stop: () => void } {
  const canvas = h('canvas') as HTMLCanvasElement;
  let raf = 0;
  let t = 0;
  let last = performance.now();
  const n1 = c.normals.n1;
  const cycle = 40 + n1.T + 30;
  const col = hex(c.color);
  const draw = (now: number) => {
    raf = requestAnimationFrame(draw);
    t += (now - last) / (1000 / 60);
    last = now;
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (canvas.width !== Math.round(r.width * dpr)) {
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const u = Math.min(W / 5.2, H / 2.2);
    const cx = u * 0.9;
    const cy = H / 2;
    // grid
    ctx.strokeStyle = 'rgba(111,140,255,.12)';
    ctx.lineWidth = 1;
    for (let k = 0; k <= 5; k++) {
      ctx.beginPath();
      ctx.moveTo(cx + k * u, 0);
      ctx.lineTo(cx + k * u, H);
      ctx.stroke();
    }
    const f = Math.floor(t % cycle) - 40;
    // body
    let shape: 'square' | 'circle' | 'hexagon' = 'square';
    if (f >= 1 && f <= n1.T) shape = 'circle';
    else if (f > n1.T) shape = 'hexagon';
    ctx.save();
    ctx.translate(cx, cy);
    ctx.shadowColor = col;
    ctx.shadowBlur = 16 * dpr;
    ctx.fillStyle = col;
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    const R = u * 0.5;
    if (shape === 'circle') ctx.arc(0, 0, R, 0, Math.PI * 2);
    else if (shape === 'hexagon') for (let k = 0; k < 6; k++) ctx.lineTo(Math.cos((k * Math.PI) / 3) * R * 1.1, Math.sin((k * Math.PI) / 3) * R * 1.1);
    else ctx.rect(-R * 0.85, -R * 0.85, R * 1.7, R * 1.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    // arrow / bar
    const reach = n1.reach * u;
    const edge = R * 1.05;
    if (f >= 1 && f < n1.S) {
      const p = f / (n1.S - 1);
      const len = edge + (reach - edge) * p;
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.lineWidth = 3 * dpr;
      ctx.beginPath();
      ctx.moveTo(edge, 0);
      ctx.lineTo(len, 0);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(len + 8 * dpr, 0);
      ctx.lineTo(len - 5 * dpr, -7 * dpr);
      ctx.lineTo(len - 5 * dpr, 7 * dpr);
      ctx.fill();
    } else if (f >= n1.S && f < n1.S + n1.A + 4) {
      // 70° swing from the character's side
      const sgn = c.swing === 'right' ? 1 : -1;
      const half = (35 * Math.PI) / 180;
      const p = Math.min(1, 0.5 + (0.5 * (f - n1.S)) / Math.max(1, n1.A - 1));
      const a0 = sgn * half;
      const a1 = a0 - sgn * 2 * half * p;
      ctx.fillStyle = col + '44';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, reach, Math.min(a0, a1), Math.max(a0, a1));
      ctx.closePath();
      ctx.fill();
      ctx.rotate(a1);
      ctx.strokeStyle = col;
      ctx.lineCap = 'round';
      ctx.lineWidth = 9 * dpr;
      ctx.beginPath();
      ctx.moveTo(edge, 0);
      ctx.lineTo(reach, 0);
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3 * dpr;
      ctx.stroke();
    } else if (f < 1) {
      ctx.fillStyle = 'rgba(255,255,255,.6)';
      ctx.beginPath();
      ctx.moveTo(R * 1.55, 0);
      ctx.lineTo(R * 1.25, -5 * dpr);
      ctx.lineTo(R * 1.25, 5 * dpr);
      ctx.fill();
    }
    ctx.restore();
    // labels
    ctx.fillStyle = 'rgba(200,210,240,.75)';
    ctx.font = `${10 * dpr}px Chakra Petch, sans-serif`;
    ctx.fillText(`発生 ${n1.S}F`, 8 * dpr, 14 * dpr);
    ctx.fillText(`リーチ ${n1.reach}u`, 8 * dpr, H - 8 * dpr);
    if (f >= 1 && f < n1.S) {
      ctx.fillStyle = col;
      ctx.fillText(`${f}F`, W - 30 * dpr, 14 * dpr);
    }
  };
  raf = requestAnimationFrame(draw);
  return { canvas, stop: () => cancelAnimationFrame(raf) };
}

export interface CardsApi {
  el: HTMLElement;
  select: (i: number) => void;
  selected: () => number;
  mark: (i: number, label: string | null) => void;
  /** Show a "YOU" badge on card i. */
  you: (i: number) => void;
  stop: () => void;
}

export function charCards(onSelect: (i: number) => void, initial = 0): CardsApi {
  // 4+ characters: a denser card (one-line theme, one skill per row)
  const grid = h('div', { class: `select-grid${CHARACTERS.length >= 4 ? ' dense' : ''}`, style: `--n:${CHARACTERS.length}` });
  const stops: (() => void)[] = [];
  const cards: HTMLElement[] = [];
  const badges: (HTMLElement | null)[] = CHARACTERS.map(() => null);
  let sel = initial;
  CHARACTERS.forEach((c, i) => {
    const pv = preview(c);
    stops.push(pv.stop);
    const stats = h('div', { class: 'stats' });
    for (const [label, v] of statRows(c)) {
      stats.append(h('span', null, label), h('div', { class: 'bar' }, h('i', { style: `width:${Math.round(Math.max(0.08, Math.min(1, v)) * 100)}%` })));
    }
    // skill chips: always one row of two; tap one for the full move sheet
    const skills = h('div', { class: 'skills' },
      ...c.skills.map((s, k) => {
        const tag = h('span', { class: 'skill-tag', role: 'button', 'aria-label': `S${k + 1} ${s.name}の詳細` },
          h('span', { class: 'ic', html: shapeIcon(s.shape, hex(c.color)) }, h('small', null, `S${k + 1}`)),
          h('span', { class: 'nm' }, s.name),
          h('span', { class: 'more' }, 'i'),
        );
        tag.addEventListener('click', (e) => {
          e.stopPropagation();
          api.select(i);
          onSelect(i);
          openMoveSheet(c, k);
        });
        return tag;
      }),
    );
    const card = h('button', { class: 'char-card', style: `--c:${hex(c.color)}` },
      h('div', { class: 'preview' }, pv.canvas),
      h('div', { class: 'info' },
        h('div', { class: 'name' }, h('b', null, c.name), h('span', { class: 'en' }, c.nameEn)),
        h('div', { class: 'theme' }, h('b', null, c.theme), h('span', { class: 'blurb' }, ` — ${c.blurb}`)),
        stats,
        skills,
      ),
    );
    card.onclick = () => {
      sfx.ui();
      api.select(i);
      onSelect(i);
    };
    cards.push(card);
    grid.append(card);
  });
  const api: CardsApi = {
    el: grid,
    select(i) {
      sel = i;
      cards.forEach((c, k) => c.classList.toggle('selected', k === i));
    },
    selected: () => sel,
    mark(i, label) {
      badges.forEach((b) => b?.remove());
      if (label === null) return;
      const b = h('span', { class: 'pick-badge p2' }, label);
      cards[i].append(b);
      badges[i] = b;
    },
    you(i) {
      grid.querySelectorAll('.pick-badge.me').forEach((b) => b.remove());
      cards[i].append(h('span', { class: 'pick-badge me' }, 'YOU'));
    },
    stop: () => stops.forEach((s) => s()),
  };
  api.select(initial);
  return api;
}

export interface SelectOptions {
  mode: 'cpu' | 'training' | 'local';
  onBack: () => void;
  onConfirm: (p1: number, p2: number, level: number) => void;
}

export function selectScreen(opts: SelectOptions): Screen {
  const initial = Math.max(0, CHARACTERS.findIndex((c) => c.id === settings.lastChar));
  let p1 = initial;
  let p2 = (initial + 1) % CHARACTERS.length;
  let level = settings.cpuLevel;
  let stage = 0; // local 2P: 0 = picking 1P, 1 = picking 2P
  const hint = h('div', { class: 'hint' });
  const confirm = h('button', { class: 'btn primary' }, '決定');
  const cards = charCards((i) => {
    if (opts.mode === 'local' && stage === 1) p2 = i;
    else p1 = i;
    refresh();
  }, initial);

  const oppSeg = h('div', { class: 'segmented' });
  const levelSeg = h('div', { class: 'segmented' });
  const refreshSeg = () => {
    oppSeg.innerHTML = '';
    CHARACTERS.forEach((c, i) => {
      const b = h('button', { class: i === p2 ? 'on' : '', style: i === p2 ? `color:${hex(c.color)}` : '' }, c.name);
      b.onclick = () => {
        sfx.ui();
        p2 = i;
        refresh();
      };
      oppSeg.append(b);
    });
    levelSeg.innerHTML = '';
    CPU_LEVELS.forEach((l, i) => {
      const b = h('button', { class: i === level ? 'on' : '' }, l.name);
      b.onclick = () => {
        sfx.ui();
        level = i;
        refresh();
      };
      levelSeg.append(b);
    });
  };

  function refresh(): void {
    refreshSeg();
    if (opts.mode === 'local') {
      cards.mark(stage === 0 ? p2 : p1, stage === 0 ? null : '1P');
      if (stage === 1) cards.mark(p1, '1P');
      hint.textContent = stage === 0 ? '1P のキャラを選んでください（WASD + F/G/H + Shift）' : '2P のキャラを選んでください（矢印 + , . / + 右Shift）';
      confirm.textContent = stage === 0 ? '1P 決定' : '対戦開始';
    } else if (opts.mode === 'cpu') {
      hint.textContent = '';
    } else {
      hint.textContent = 'ダミー相手に何度でも練習できます。';
    }
  }

  confirm.onclick = () => {
    sfx.confirm();
    if (opts.mode === 'local' && stage === 0) {
      stage = 1;
      cards.select(p2);
      refresh();
      return;
    }
    saveSettings({ lastChar: CHARACTERS[p1].id, cpuLevel: level });
    opts.onConfirm(p1, p2, level);
  };

  const footer = h('div', { class: 'select-footer' });
  if (opts.mode === 'cpu') {
    footer.append(h('span', { style: 'font-size:12px;color:var(--muted)' }, '相手'), oppSeg, h('span', { style: 'font-size:12px;color:var(--muted)' }, '強さ'), levelSeg);
  } else if (opts.mode === 'training') {
    footer.append(h('span', { style: 'font-size:12px;color:var(--muted)' }, 'ダミー'), oppSeg);
  }
  footer.append(hint, confirm);

  const title = opts.mode === 'cpu' ? 'VS CPU' : opts.mode === 'training' ? 'TRAINING' : 'LOCAL 2P';
  const el = h('div', { class: 'screen' },
    h('div', { class: 'topbar' }, backButton(() => { sfx.back(); if (stage === 1) { stage = 0; cards.select(p1); refresh(); } else opts.onBack(); }), h('h2', null, title), h('span', { class: 'sub' }, 'キャラクター選択')),
    cards.el,
    footer,
  );
  refresh();
  return {
    el,
    dispose: () => cards.stop(),
    onBack: () => {
      opts.onBack();
      return true;
    },
  };
}
