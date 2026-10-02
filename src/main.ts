import { installFullscreenKeeper } from './app/fullscreen';
import { installNoZoom } from './app/no-zoom';
import './styles.css';
import { initPixi, setAmbient } from './render/pixi-app';
import { fxSources, loadFx } from './render/fx-sprites';
import { warmShaders, warmTextures } from './render/warmup';
import { show } from './app/router';
import { applySettingsToDom, saveSettings } from './app/settings';
import { titleScreen } from './app/screens/title';
import { selectScreen } from './app/screens/select';
import { howtoScreen, settingsScreen } from './app/screens/info';
import { battleScreen, type BattleConfig } from './app/screens/battle';
import { onlineHome, joinScreen, roomJoinScreen } from './app/screens/online';
import { parseRoomCode } from './net/relay';
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
  const pixi = await initPixi();
  // compile the battle's filters while the title is up (first-use hitches: render/warmup.ts)
  warmShaders(pixi.renderer);
  // Pixi text uses the display font; make sure it is loaded before the first battle.
  void document.fonts?.load('700 20px "Chakra Petch"');
  // effect sprite sheets stream in the background (battles work before they arrive), then
  // go up to the GPU one per frame, so no hit in a fight ever waits for a texture upload
  void loadFx().then(() => warmTextures(pixi.renderer, fxSources()));
  window.addEventListener('pointerdown', () => unlockAudio(), { once: true });
  // fullscreen chosen on the title comes back after sharing an invite / switching apps
  installFullscreenKeeper();
  installNoZoom();

  const hash = decodeURIComponent(location.hash || '');
  const room = /^#room=/i.test(hash) ? parseRoomCode(hash) : null;
  const code = room ? null : extractCode(hash);
  if (room) {
    // arrived through a room link (LINE / Discord…)
    history.replaceState(null, '', location.pathname + location.search);
    menuMode();
    show(roomJoinScreen(nav, room));
  } else if (code) {
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
