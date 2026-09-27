import { h, ICONS, shapeIcon, SHAPE_INFO } from '../ui';
import { sfx, unlockAudio } from '../../audio/sfx';
import { settings } from '../settings';
import type { Screen } from '../router';

export interface TitleActions {
  online: () => void;
  cpu: () => void;
  training: () => void;
  tutorial: () => void;
  local: () => void;
  howto: () => void;
  settings: () => void;
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export function titleScreen(a: TitleActions): Screen {
  const item = (cls: string, icon: string, label: string, sub: string, fn: () => void) => {
    const b = h('button', { class: `menu-item ${cls}` },
      h('span', { class: 'ico', html: icon }),
      h('span', { class: 'label' }, h('b', null, label), h('small', null, sub)),
    );
    b.onclick = () => {
      unlockAudio();
      sfx.confirm();
      fn();
    };
    return b;
  };
  const legend = h('div', { class: 'legend-strip' });
  for (const s of SHAPE_INFO.slice(0, 4)) {
    legend.append(h('span', { class: 'chip' }, h('span', { html: shapeIcon(s.shape, s.color) }), h('b', null, s.name), `→ ${s.act}`));
  }
  const firstTime = !settings.tutorialDone;
  const menu = h('div', { class: 'menu' },
    firstTime
      ? item('hero', shapeIcon('circle', '#6ff3ff'), 'チュートリアル', '約90秒。形の読み方を体で覚える', a.tutorial)
      : item('hero', ICONS.qr, '対戦する（2台）', 'QRを読み合うだけ。サーバー不要のP2P対戦', a.online),
    firstTime
      ? item('', ICONS.qr, '対戦する（2台）', 'QRを読み合うだけ。サーバー不要のP2P対戦', a.online)
      : item('', ICONS.cpu, 'CPUと戦う', '3段階の強さ。形への反応速度が違う', a.cpu),
    firstTime ? item('', ICONS.cpu, 'CPUと戦う', '3段階の強さ。形への反応速度が違う', a.cpu) : item('', ICONS.target, 'トレーニング', 'フレームメーター・判定表示・ダミー設定', a.training),
    h('div', { class: 'menu-row' },
      firstTime
        ? h('button', { class: 'btn small', onclick: () => { sfx.ui(); a.training(); } }, 'トレーニング')
        : h('button', { class: 'btn small', onclick: () => { sfx.ui(); a.tutorial(); } }, 'チュートリアル'),
      h('button', { class: 'btn small', onclick: () => { unlockAudio(); sfx.ui(); a.howto(); } }, '遊び方'),
      h('button', { class: 'btn small', onclick: () => { unlockAudio(); sfx.ui(); a.settings(); } }, h('span', { html: ICONS.gear, style: 'width:16px;height:16px;display:inline-flex' }), '設定'),
    ),
  );
  const hasKeyboard = matchMedia('(pointer: fine)').matches;
  const el = h('div', { class: 'screen title' },
    h('div', { class: 'brand' },
      h('h1', { class: 'logo' }, h('span', null, 'POLYGON'), h('span', null, 'DUEL')),
      h('p', { class: 'tagline' }, '形を読め。止まるか、動くか。', h('br'), '見下ろし型 1 vs 1 “形を読む” 対戦アクション'),
      legend,
    ),
    menu,
    h('div', { class: 'version' }, `v${__APP_VERSION__} · ${__BUILD_HASH__}`),
  );
  if (hasKeyboard) {
    const lb = h('button', { class: 'btn small ghost', style: 'position:absolute;left:calc(12px + var(--safe-l));bottom:calc(6px + var(--safe-b));font-size:11px;color:var(--muted)' },
      h('span', { html: ICONS.keyboard, style: 'width:16px;height:16px;display:inline-flex' }), 'キーボードで2人対戦');
    lb.onclick = () => {
      unlockAudio();
      sfx.ui();
      a.local();
    };
    el.append(lb);
  } else if (isIos() && !standalone()) {
    el.append(h('div', { class: 'install-hint' }, h('span', { html: ICONS.expand, style: 'width:14px;height:14px;display:inline-flex' }), '共有ボタン →「ホーム画面に追加」で全画面になります'));
  } else if (!standalone() && document.fullscreenEnabled) {
    const fs = h('button', { class: 'btn small ghost', style: 'position:absolute;left:calc(12px + var(--safe-l));bottom:calc(6px + var(--safe-b));font-size:11px;color:var(--muted)' },
      h('span', { html: ICONS.expand, style: 'width:16px;height:16px;display:inline-flex' }), '全画面にする');
    fs.onclick = () => {
      void document.documentElement.requestFullscreen?.().then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.('landscape').catch(() => undefined)).catch(() => undefined);
    };
    el.append(fs);
  }
  return { el };
}
