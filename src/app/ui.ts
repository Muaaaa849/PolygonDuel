// Tiny DOM helpers + the shape icon set (the same language as the game).
import type { Shape } from '../data/types';

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v as string;
      else if (k === 'style') el.setAttribute('style', v as string);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'html') el.innerHTML = v as string;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function svg(markup: string, cls = ''): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  const el = t.content.firstElementChild as SVGSVGElement;
  if (cls) el.setAttribute('class', cls);
  return el;
}

export const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** Polygon points for an n-gon in a 100x100 box, first vertex at `rot` degrees. */
function ngon(n: number, r = 40, rot = -90, cx = 50, cy = 50): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((rot + (360 / n) * i) * Math.PI) / 180;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(' ');
}

/** Icon for a shape. `fill` colors the body; `stroke` the outline. */
export function shapeIcon(shape: Shape | 'none', fill = 'currentColor', extra = ''): string {
  const common = `fill="${fill}" stroke="rgba(255,255,255,.85)" stroke-width="3" stroke-linejoin="round"`;
  let body = '';
  switch (shape) {
    case 'square':
      body = `<rect x="18" y="18" width="64" height="64" rx="4" ${common}/><path d="M86 50 l8 0" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`;
      break;
    case 'hexagon':
      body = `<polygon points="${ngon(6, 40, 0)}" ${common}/>`;
      break;
    case 'circle':
      body = `<circle cx="38" cy="50" r="30" ${common}/><rect x="66" y="45" width="32" height="10" rx="3" fill="#fff"/>`;
      break;
    case 'triangle':
      body = `<polygon points="${ngon(3, 44, 0, 46, 50)}" ${common}/><polygon points="${ngon(3, 44, 0, 46, 50)}" fill="none" stroke="#ffd060" stroke-width="3" opacity=".9"/>`;
      break;
    case 'arrow':
      body = `<polygon points="92,50 26,16 42,50 26,84" ${common}/>`;
      break;
    case 'pentagon':
      body = `<polygon points="${ngon(5, 42)}" ${common}/>`;
      break;
    case 'diamond':
      body = `<polygon points="92,50 50,26 12,50 50,74" ${common}/><polygon points="92,50 50,26 12,50 50,74" fill="none" stroke="#fff3a0" stroke-width="2" opacity=".7" transform="translate(50 50) scale(.5) translate(-50 -50)"/>`;
      break;
    case 'star':
      body = `<rect x="24" y="30" width="52" height="52" rx="4" ${common}/><polygon points="${ngon(3, 9, -90, 24, 14)}" fill="#ffd060"/><polygon points="${ngon(3, 9, -90, 50, 9)}" fill="#ffd060"/><polygon points="${ngon(3, 9, -90, 76, 14)}" fill="#ffd060"/>`;
      break;
    default:
      body = '';
  }
  return `<svg viewBox="0 0 100 100" ${extra}>${body}</svg>`;
}

/** What the opponent should do about each shape (plan §3). */
export const SHAPE_INFO: { shape: Shape; name: string; state: string; act: string; color: string }[] = [
  { shape: 'circle', name: '円＋棒', state: '攻撃（ガード可）', act: '止まってガード', color: '#ff6a5a' },
  { shape: 'triangle', name: '三角', state: 'ガードブレイク', act: '動く・ステップで避ける', color: '#ffb020' },
  { shape: 'hexagon', name: '六角', state: 'ガード中', act: '三角(GB)で崩せ', color: '#5aa0ff' },
  { shape: 'diamond', name: '菱形', state: '射撃（弾）', act: 'ステップで弾に飛び込め', color: '#f5c518' },
  { shape: 'arrow', name: '矢印', state: 'ステップ', act: '硬直を狩れ', color: '#58f0a0' },
  { shape: 'square', name: '四角', state: '通常・移動中', act: '何でもできる', color: '#c7d0ea' },
  { shape: 'star', name: '星つき四角', state: 'スタン', act: 'フルコンボ！', color: '#ffd060' },
  { shape: 'pentagon', name: '五角', state: '回復・バフ・引き寄せ', act: '殴りに行け', color: '#b58cff' },
];

export const ICONS = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5" stroke-linecap="round"/></svg>',
  wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1.2" fill="currentColor"/></svg>',
  qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M20 20h-3v-3M14 20h.01"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  cpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" stroke-linecap="round"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke-linecap="round"/></svg>',
  keyboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" stroke-linecap="round"/></svg>',
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg>',
};

export function backButton(onClick: () => void): HTMLButtonElement {
  return h('button', { class: 'back', 'aria-label': '戻る', onclick: onClick, html: ICONS.back });
}

export function toast(msg: string, ms = 2200): void {
  const el = h('div', { class: 'toast' }, msg);
  document.getElementById('ui')!.append(el);
  setTimeout(() => el.remove(), ms);
}

export function modal(content: HTMLElement, opts: { wide?: boolean; onBackdrop?: () => void } = {}): { close: () => void; el: HTMLElement } {
  const box = h('div', { class: `modal${opts.wide ? ' wide' : ''}` }, content);
  const back = h('div', { class: 'modal-back' }, box);
  back.addEventListener('pointerdown', (e) => {
    if (e.target === back) opts.onBackdrop?.();
  });
  document.getElementById('ui')!.append(back);
  return { el: box, close: () => back.remove() };
}
