import './styles.css';
import { initPixi, setAmbient } from './render/pixi-app';
import { show } from './app/router';
import { applySettingsToDom, saveSettings } from './app/settings';
import { titleScreen } from './app/screens/title';
import { selectScreen } from './app/screens/select';
import { howtoScreen, settingsScreen } from './app/screens/info';
import { battleScreen, type BattleConfig } from './app/screens/battle';
import { onlineHome, joinScreen } from './app/screens/online';
import { createTutorial } from './app/screens/tutorial';
import { extractCode } from './net/qr-signaling';
import { charIndex } from './data/characters';
import { h, modal } from './app/ui';
import { unlockAudio } from './audio/sfx';

function menuMode(): void {
  setAmbient(true);
}

function battle(cfg: BattleConfig): void {
  show(battleScreen(cfg));
}

const nav = {
  title(): void {
    menuMode();
    show(titleScreen({
      online: () => show(onlineHome(nav)),
      cpu: () => nav.select('cpu'),
      training: () => nav.select('training'),
      tutorial: () => nav.tutorial(),
      local: () => nav.select('local'),
      howto: () => show(howtoScreen(() => nav.title())),
      settings: () => show(settingsScreen(() => nav.title())),
    }));
  },
  select(mode: 'cpu' | 'training' | 'local'): void {
    menuMode();
    show(selectScreen({
      mode,
      onBack: () => nav.title(),
      onConfirm: (p1, p2, level) => nav.fight(mode, p1, p2, level),
    }));
  },
  fight(mode: 'cpu' | 'training' | 'local', p1: number, p2: number, level: number): void {
    battle({
      mode,
      chars: [p1, p2],
      local: 0,
      cpuLevel: level,
      onExit: (a) => {
        if (a === 'rematch') nav.fight(mode, p1, p2, level);
        else if (a === 'select') nav.select(mode);
        else nav.title();
      },
    });
  },
  tutorial(): void {
    const tut = createTutorial(() => {
      saveSettings({ tutorialDone: true });
      const m = modal(
        h('div', { class: 'list' },
          h('h3', null, 'TUTORIAL COMPLETE'),
          h('p', { class: 'prose' }, '形を見て、正しい対処。これで基本はすべてです。次はCPUか、友だちと2台で対戦してみましょう。'),
          h('div', { class: 'actions' },
            h('button', { class: 'btn primary', onclick: () => { m.close(); nav.select('cpu'); } }, 'CPUと戦う'),
            h('button', { class: 'btn', onclick: () => { m.close(); show(onlineHome(nav)); } }, '2台で対戦'),
            h('button', { class: 'btn', onclick: () => { m.close(); nav.title(); } }, 'タイトル'),
          ),
        ),
      );
    });
    battle({
      mode: 'tutorial',
      chars: [charIndex('blaze'), charIndex('bastion')],
      local: 0,
      tutorial: tut,
      onExit: (a) => (a === 'rematch' ? nav.tutorial() : nav.title()),
    });
  },
};

async function boot(): Promise<void> {
  applySettingsToDom();
  document.body.classList.add('needs-landscape');
  await initPixi();
  // Pixi text uses the display font; make sure it is loaded before the first battle.
  void document.fonts?.load('700 20px "Chakra Petch"');
  window.addEventListener('pointerdown', () => unlockAudio(), { once: true });

  const code = extractCode(decodeURIComponent(location.hash || ''));
  if (code) {
    history.replaceState(null, '', location.pathname + location.search);
    menuMode();
    show(joinScreen(nav, code));
  } else {
    nav.title();
  }

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  }
}

void boot();
