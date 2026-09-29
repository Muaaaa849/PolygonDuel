// Battle screen: fixed 60-tick loop, input sources, events → effects/sound, HUD, pause & result.
import { Sim, CTL_MANUAL_GUARD, CTL_FACE_FOE } from '../../core/sim';
import { CHARACTERS } from '../../data/characters';
import { SYSTEM } from '../../data/system';
import { M_S1, SH, SHAPES, KIND_SKILL } from '../../core/compile';
import {
  type SimEvent, EV_HIT, EV_BLOCK, EV_CRUSH, EV_GUARD_BREAK, EV_GB_OPEN, EV_JUST, EV_RIPOSTE,
  EV_KNOCKDOWN, EV_STEP, EV_HEAL, EV_KO, EV_ROUND, EV_FIGHT, EV_TIMEUP, EV_ROUND_END, EV_MATCH_END, EV_MOVE, EV_WALL, EV_BLINK, EV_GHOST, EV_GHOST_END, EV_POWER, EV_PULL,
  EV_SHOT, EV_MODE, EV_FIELD, EV_SHOCK, EV_JAM, EV_WAKE, EV_UP, EV_DRIVE, EV_CHARGE, EV_INK, EV_TRAIL, HF_COUNTER, HF_KNOCKDOWN, HF_PUNISH, HF_SHOT,
} from '../../core/events';
import { PH_FIGHT, PH_INTRO, ST_FREE, ST_STEP, ST_ATTACK, type FighterState } from '../../core/state';
import { BattleView } from '../../render/battle-view';
import { app, recoverRenderer, setAmbient } from '../../render/pixi-app';
import { TouchControls } from '../../input/touch';
import { KeyboardInput, keysFor, keyLabel } from '../../input/keyboard';
import { IN_ATK, IN_S1, IN_S2, IN_AIM, aimBits, quantizeDir, AIM_DIRS } from '../../core/input';
import { CpuPlayer, CPU_LEVELS, Dummy, DUMMY_MODES, type DummyMode } from '../../ai/cpu';
import { sfx, vibrate } from '../../audio/sfx';
import { bgm } from '../../audio/bgm';
import { RollbackSession } from '../../net/rollback';
import { EventFilter } from '../../net/event-filter';
import type { PeerLink } from '../../net/transport';
import { settings, saveSettings, showTouchControls } from '../settings';
import { h, hex, modal, shapeIcon, toast, ICONS, SHAPE_INFO } from '../ui';
import type { Screen } from '../router';
import { FrameMeter } from './frame-meter';
import { buildHud } from '../hud';
import { FrameClock, TICK_MS } from '../frame-clock';

export type BattleMode = 'cpu' | 'training' | 'tutorial' | 'local' | 'online';
export type ExitAction = 'rematch' | 'select' | 'title';

export interface TutorialHooks {
  el: HTMLElement;
  /** Opponent input each tick. */
  dummy: () => number;
  onEvent: (e: SimEvent) => void;
  onTick: () => void;
  attach: (sim: Sim, api: { banner: (t: string, sub?: string) => void; reset: () => void }) => void;
}

export interface BattleConfig {
  mode: BattleMode;
  chars: [number, number];
  /** Side controlled by this device's touch/keyboard. */
  local: 0 | 1;
  cpuLevel?: number;
  online?: { link: PeerLink; inputDelay: number };
  /** Control settings per side (bits CTL_MANUAL_GUARD / CTL_FACE_FOE). Online: agreed at the start; otherwise from settings. */
  controlModes?: [number, number];
  tutorial?: TutorialHooks;
  onExit: (a: ExitAction) => void;
}

/** PC: the keys in use, as a small legend at the bottom of the battle screen. */
function keyLegend(): HTMLElement {
  const k = keysFor('solo');
  const first = (a: keyof typeof k) => (k[a][0] ? keyLabel(k[a][0]) : '—');
  const all = (a: keyof typeof k) => k[a].map(keyLabel).join('/') || '—';
  const move = `${first('up')}${first('left')}${first('down')}${first('right')}`;
  const items: [string, string][] = [
    ['移動', move], ['攻撃', all('atk')], ['S1', all('s1')], ['S2', all('s2')], ['ステップ', all('step')],
    ['ガード', settings.guardMode === 'manual' ? all('guard') : '止まる'], ['ポーズ', 'Esc'],
  ];
  return h('div', { class: 'key-legend' }, ...items.map(([t, v]) => h('span', null, h('b', null, v), t)));
}

/** This device's control settings as CTL_* bits (also sent to the online opponent). */
export function myControlModes(tutorial = false): number {
  return (settings.guardMode === 'manual' && !tutorial ? CTL_MANUAL_GUARD : 0) | (settings.attackDir === 'foe' ? CTL_FACE_FOE : 0);
}

export function battleScreen(cfg: BattleConfig): Screen {
  const training = cfg.mode === 'training' || cfg.mode === 'tutorial';
  const sim = new Sim(cfg.chars[0], cfg.chars[1], { training });
  if (training) sim.skipIntro();
  // control settings: this device's player(s) use the settings (the tutorial teaches the auto guard);
  // the CPU / dummy keeps auto guard and stick-direction attacks
  const myCtl = myControlModes(cfg.mode === 'tutorial');
  const controlModes: [number, number] = cfg.controlModes ?? (cfg.mode === 'local' ? [myCtl, myCtl] : cfg.local === 0 ? [myCtl, 0] : [0, myCtl]);
  sim.setControlModes(controlModes);
  const defs = [CHARACTERS[cfg.chars[0]], CHARACTERS[cfg.chars[1]]];
  const oppIdx = (1 - cfg.local) as 0 | 1;

  const tags: [string, string] =
    cfg.mode === 'local'
      ? ['1P', '2P']
      : cfg.mode === 'online'
        ? cfg.local === 0 ? ['YOU', 'RIVAL'] : ['RIVAL', 'YOU']
        : cfg.local === 0 ? ['YOU', training ? 'DUMMY' : 'CPU'] : [training ? 'DUMMY' : 'CPU', 'YOU'];
  setAmbient(false);
  const view = new BattleView(sim, { local: cfg.mode === 'local' ? -1 : cfg.local, tags });
  view.mount();

  // ───────── DOM ─────────
  const root = h('div', { class: 'screen battle' });
  const hud = buildHud(sim, view, tags);
  root.append(hud.el);
  const touch = new TouchControls();
  root.append(touch.el);
  // aim (drag-to-aim) only when a fresh attack / aimable skill would start
  touch.aimPolicy = (id) => {
    if (!settings.aimMode || id === 'step') return false;
    const f = sim.s.f[cfg.local];
    if (f.st !== ST_FREE && f.st !== ST_STEP) return false;
    if (id === 'atk' && f.justWin > 0) return false; // just attack auto-targets
    if (id === 'atk' && f.drive) return false; // overdrive: a HELD ATK is the heavy blow, so it must be a plain hold
    const m = sim.char(cfg.local).moves[slotFor(id)];
    return (m.hasHitbox || !!m.proj || !!m.field) && !m.autoAim && !m.radial;
  };
  /** The move a button starts from neutral (shooting mode: ATK = shot, S1 = back to normal). */
  const slotFor = (id: string) => {
    const f = sim.s.f[cfg.local];
    return id === 'atk' ? sim.atkSlot(f) : id === 's1' ? sim.skillSlot(f, M_S1) : sim.s2Slot(f);
  };
  touch.setManualGuard((controlModes[cfg.local] & CTL_MANUAL_GUARD) !== 0);
  const localDef = defs[cfg.local];
  const skillLook = (i: number) => ({ shape: localDef.skills[i].shape, label: `S${i + 1}`, cost: localDef.skills[i].cost });
  /** S1's look for the move it would start now (ブラッド: the guard break while the overdrive burns). */
  const s1Look = () => {
    const d = sim.char(cfg.local).moves[sim.skillSlot(sim.s.f[cfg.local], M_S1)].def!;
    return { shape: d.shape, label: 'S1', cost: d.cost };
  };
  /** S2's look for the move it would start now (ヴォルト: overcharge from neutral, turnback after a dash). */
  const s2Look = () => {
    const d = sim.char(cfg.local).moves[sim.s2Slot(sim.s.f[cfg.local])].def!;
    return { shape: d.shape, label: 'S2', cost: d.cost };
  };
  touch.setButtons({ atk: { shape: 'circle', label: 'ATTACK' }, s1: skillLook(0), s2: s2Look(), step: { shape: 'arrow', label: 'STEP' } });
  // shooters: ATK / S1 change their look with the mode; S2 follows what it would start
  let shownKey = 0;
  const syncModeButtons = () => {
    const f = sim.s.f[cfg.local];
    const key = f.shootMode * 64 + sim.s2Slot(f) + 1 + (f.drive ? 4096 : 0);
    if (key === shownKey || shownKey === 0) {
      shownKey = key;
      return;
    }
    shownKey = key;
    touch.setButtons(f.shootMode
      ? { atk: { shape: 'diamond', label: 'SHOT' }, s1: { shape: 'square', label: '通常へ' }, s2: s2Look(), step: { shape: 'arrow', label: 'STEP' } }
      : { atk: { shape: 'circle', label: 'ATTACK' }, s1: s1Look(), s2: s2Look(), step: { shape: 'arrow', label: 'STEP' } });
  };

  const bannerLayer = h('div');
  root.append(bannerLayer);
  const pauseBtn = h('button', { class: 'pause-btn', 'aria-label': 'ポーズ', html: ICONS.pause, onclick: () => openPause() });
  hud.center.append(pauseBtn);

  let netBadge: HTMLElement | null = null;
  if (cfg.mode === 'online') {
    netBadge = h('div', { class: 'badge netbadge good' });
    hud.center.append(netBadge);
  }

  // ───────── input sources ─────────
  const kb = new KeyboardInput(cfg.mode === 'local' ? 'p1' : 'solo', 0);
  const kb2 = cfg.mode === 'local' ? new KeyboardInput('p2', 1) : null;
  // PC: no on-screen controls; a legend of the keys instead, and (optionally) aim with the mouse
  const touchShown = showTouchControls();
  if (!touchShown) {
    touch.el.style.display = 'none';
    root.append(keyLegend());
  }
  const mouseAim = !touchShown && settings.mouseAim && cfg.mode !== 'local' && cfg.mode !== 'tutorial';
  const mouse = { x: 0, y: 0, seen: false };
  const onMouseMove = (e: MouseEvent) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.seen = true;
  };
  if (mouseAim) window.addEventListener('mousemove', onMouseMove);
  let prevLocal = 0;
  const localInput = () => {
    let w = touch.poll() | kb.poll();
    // mouse aim: a fresh ATK / S1 / S2 press carries the direction to the cursor (full reach).
    // Only on the press frame, so the input stays constant while held (fewer online rollbacks).
    const fresh = w & ~prevLocal & (IN_ATK | IN_S1 | IN_S2);
    prevLocal = w;
    if (mouseAim && mouse.seen && fresh && !(w & IN_AIM)) {
      const p = view.screenOf(cfg.local);
      const r = app.canvas.getBoundingClientRect();
      const dx = mouse.x - r.left - p.x;
      const dy = mouse.y - r.top - p.y;
      if (dx * dx + dy * dy > 16 * 16) w |= aimBits(quantizeDir(dx, dy, AIM_DIRS), 3);
    }
    return w;
  };
  let cpu: CpuPlayer | null = null;
  let dummy: Dummy | null = null;
  if (cfg.mode === 'cpu') cpu = new CpuPlayer(sim, oppIdx, CPU_LEVELS[cfg.cpuLevel ?? 1], Date.now() & 0xffff);
  if (cfg.mode === 'training') dummy = new Dummy(sim, oppIdx, 'hitGuard');
  const delayQueue: number[] = [];
  let simDelay = 0;

  // ───────── training tools ─────────
  let meter: FrameMeter | null = null;
  const advEl = h('div', { class: 'adv', style: 'opacity:0' });
  if (cfg.mode === 'training') {
    meter = new FrameMeter(sim, view);
    root.append(meter.el, advEl, buildTrainingBar());
  }
  if (cfg.tutorial) {
    root.append(cfg.tutorial.el);
    cfg.tutorial.attach(sim, {
      banner: (t, sub) => banner(t, sub, 1100),
      reset: () => resetPositions(),
    });
  }

  // ───────── online session ─────────
  let session: RollbackSession | null = null;
  // re-simulated events are shown once, even when the corrected timeline shifts them a frame
  const shown = new EventFilter();
  if (cfg.online) {
    const link = cfg.online.link;
    session = new RollbackSession(sim, {
      local: cfg.local,
      inputDelay: cfg.online.inputDelay,
      send: (p) => link.sendGame(p),
      onEvents: (evs, resim) => {
        for (const e of evs) if (shown.accept(e, resim)) dispatch(e);
        shown.prune(sim.s.frame);
      },
      onDesync: (f) => toast(`同期ずれを検出しました (F${f})`),
    });
    link.onGame = (d) => session!.receive(d);
    link.onClose = (reason) => {
      if (disposed) return;
      paused = true;
      const m = modal(
        h('div', { class: 'list' },
          h('h3', null, 'DISCONNECTED'),
          h('p', { class: 'prose' }, `${reason}。対戦を終了します。`),
          h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => { m.close(); cfg.onExit('title'); } }, 'タイトルへ')),
        ),
      );
    };
    link.onCtrl = (msg) => {
      if (msg.t === 'leave') link.onClose?.('相手が退出しました');
    };
  }

  // ───────── events ─────────
  const involvesLocal = (who: number) => cfg.mode === 'local' || who === cfg.local;
  let matchOver = false;
  let lastHp = [sim.s.f[0].hp, sim.s.f[1].hp];
  void lastHp;

  function dispatch(e: SimEvent): void {
    view.handle(e);
    meter?.onEvent(e);
    cfg.tutorial?.onEvent(e);
    const s = sim.s;
    switch (e.type) {
      case EV_HIT: {
        const heavy = !!(e.b & HF_KNOCKDOWN);
        if (e.b & HF_PUNISH) sfx.punish();
        if (e.b & HF_SHOT) sfx.shotHit();
        else if (sim.moveOf(s.f[e.who])?.id === 'blast') sfx.blast();
        else sfx.hit(heavy, !!(e.b & HF_COUNTER));
        if (involvesLocal(e.who) || involvesLocal(1 - e.who)) vibrate(heavy ? 25 : 10);
        break;
      }
      case EV_BLOCK:
        if (e.b === 1) sfx.shotHit();
        else if (sim.moveOf(s.f[e.who])?.id === 'blast') sfx.blast();
        sfx.block();
        if (involvesLocal(1 - e.who)) vibrate(20);
        break;
      case EV_CRUSH:
      case EV_GUARD_BREAK:
        sfx.crush();
        vibrate(40);
        break;
      case EV_GB_OPEN:
        sfx.hit(false, false);
        break;
      case EV_JUST:
        sfx.just();
        if (involvesLocal(e.who)) vibrate(15);
        break;
      case EV_WALL:
        sfx.wall(e.a);
        vibrate(35);
        break;
      case EV_BLINK:
        sfx.blink();
        break;
      case EV_SHOT:
        if (sim.char(e.who).shooter) sfx.shot(e.a);
        else sfx.psyShot();
        break;
      case EV_PULL:
        if (e.a !== 2) sfx.grip(e.a === 1);
        if (e.a === 1 && involvesLocal(e.who)) vibrate(25);
        break;
      case EV_MODE:
        sfx.mode(e.a === 1);
        break;
      case EV_FIELD:
        sfx.field();
        break;
      case EV_SHOCK:
        sfx.shock();
        if (involvesLocal(e.who)) vibrate(30);
        break;
      case EV_JAM:
        sfx.jam();
        break;
      case EV_POWER:
        sfx.power(e.a === 1);
        break;
      case EV_GHOST:
        // sounds exactly like what the decoy pretends to do
        if (e.a === 1) sfx.step();
        else sfx.whoosh();
        break;
      case EV_GHOST_END:
        sfx.ghostOut();
        break;
      case EV_RIPOSTE:
        sfx.riposte();
        vibrate(30);
        break;
      case EV_MOVE: {
        const m = sim.moveOf(s.f[e.who]);
        if (m && !m.ghost && !m.proj) {
          const shape = SHAPES[m.shape];
          if (m.dash) sfx.dash();
          else if (m.radial) sfx.psyBurst();
          else if (m.kind !== KIND_SKILL && sim.char(e.who).def.style === 'psychic') sfx.psy();
          else if (shape === 'triangle' || shape === 'pentagon' || shape === 'hexagon' || shape === 'diamond') sfx.startup(shape);
          else sfx.whoosh();
        }
        break;
      }
      case EV_STEP:
        sfx.step();
        break;
      case EV_HEAL:
        sfx.heal();
        break;
      case EV_KNOCKDOWN:
        sfx.knockdown();
        break;
      case EV_WAKE:
        sfx.wake();
        break;
      case EV_CHARGE:
        sfx.charge(e.a >= 60);
        break;
      case EV_INK:
        sfx.ink(e.a);
        break;
      case EV_TRAIL:
        sfx.inkWall(e.a);
        vibrate(35);
        break;
      case EV_DRIVE:
        sfx.drive(e.a);
        if (e.a === 1 && involvesLocal(e.who)) vibrate(30);
        break;
      case EV_UP:
        sfx.ready();
        break;
      case EV_KO:
        sfx.ko();
        banner('K.O.', '', 1400);
        break;
      case EV_ROUND:
        if (!training) {
          const last = s.winsA === SYSTEM.round.winsNeeded - 1 && s.winsB === SYSTEM.round.winsNeeded - 1;
          banner(last ? 'FINAL ROUND' : `ROUND ${e.a}`, '', 1300);
          sfx.round();
          if (e.a === 1 && settings.showBrief) showBrief();
        }
        break;
      case EV_FIGHT:
        banner('DUEL!', '', 700);
        sfx.fight();
        break;
      case EV_TIMEUP:
        banner('TIME UP', '', 1400);
        break;
      case EV_ROUND_END:
        setTimeout(() => {
          if (disposed || matchOver) return;
          const w = e.who;
          const txt = w === 2 ? 'DRAW' : cfg.mode === 'local' ? `${tags[w]} WIN` : w === cfg.local ? 'YOU WIN' : 'YOU LOSE';
          banner(txt, '', 1000);
        }, 1000);
        break;
      case EV_MATCH_END:
        if (matchOver) break; // one result screen, whatever a re-simulation re-emits
        matchOver = true;
        setTimeout(() => !disposed && showResult(e.who), 900);
        break;
    }
  }

  // ───────── banners & brief ─────────
  function banner(main: string, sub = '', ms = 1200): void {
    bannerLayer.innerHTML = '';
    const b = h('div', { class: 'banner' }, h('div', { class: 'main' }, main), sub ? h('div', { class: 'sub' }, sub) : null);
    bannerLayer.append(b);
    setTimeout(() => b.classList.add('out'), ms);
    setTimeout(() => b.remove(), ms + 320);
  }

  function showBrief(): void {
    const pick = ['circle', 'triangle', 'hexagon', 'star'];
    const row = h('div', { class: 'row' });
    for (const id of pick) {
      const info = SHAPE_INFO.find((s) => s.shape === id)!;
      row.append(
        h('div', { class: 'brief-item' },
          h('div', { html: shapeIcon(info.shape, info.color) }),
          h('b', null, info.state),
          h('span', { style: `color:${info.color}` }, `→ ${info.act}`),
        ),
      );
    }
    const el = h('div', { class: 'shape-brief' }, h('h4', null, '形を見て、正しい対処を'), row);
    root.append(el);
    setTimeout(() => el.remove(), 2600);
  }

  // ───────── pause / result ─────────
  let paused = false;
  let pauseModal: { close: () => void } | null = null;

  function openPause(): void {
    if (pauseModal || matchOver) return;
    sfx.ui();
    if (cfg.mode === 'online') {
      const m = modal(
        h('div', { class: 'list' },
          h('h3', null, 'MENU'),
          h('p', { class: 'prose' }, 'オンライン対戦中はポーズできません。'),
          legendMini(),
          h('div', { class: 'actions' },
            h('button', { class: 'btn', onclick: () => { m.close(); pauseModal = null; } }, '戻る'),
            h('button', { class: 'btn', onclick: () => { cfg.online!.link.sendCtrl({ t: 'leave' }); m.close(); cfg.onExit('title'); } }, '退出する'),
          ),
        ),
        { onBackdrop: () => { m.close(); pauseModal = null; } },
      );
      pauseModal = m;
      return;
    }
    paused = true;
    const close = () => {
      m.close();
      pauseModal = null;
      paused = false;
      last = performance.now();
    };
    const m = modal(
      h('div', { class: 'list' },
        h('h3', null, 'PAUSE'),
        legendMini(),
        cfg.mode === 'training' ? h('button', { class: 'btn', onclick: () => { close(); openDummyMenu(); } }, 'ダミー設定') : null,
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary', onclick: close }, '再開'),
          cfg.mode !== 'tutorial' ? h('button', { class: 'btn', onclick: () => { m.close(); cfg.onExit('select'); } }, 'キャラ選択') : null,
          h('button', { class: 'btn', onclick: () => { m.close(); cfg.onExit('title'); } }, 'タイトル'),
        ),
      ),
      { onBackdrop: close },
    );
    pauseModal = m;
  }

  function showResult(winner: number): void {
    const s = sim.s;
    const me = cfg.mode === 'local' ? 0 : cfg.local;
    const won = winner === me;
    const title = winner === 2 ? 'DRAW' : cfg.mode === 'local' ? `${tags[winner]} WIN` : won ? 'YOU WIN' : 'YOU LOSE';
    const color = winner === 2 ? '#fff' : hex(view.colorOf(winner === 2 ? 0 : winner));
    const row = (label: string, a: number | string, b: number | string) =>
      [h('div', null, label), h('div', { class: 'v' }, a), h('div', { class: 'v' }, b)];
    const [f0, f1] = s.f;
    const table = h('div', { class: 'result-table' },
      h('div', { class: 'h' }, ''), h('div', { class: 'h', style: `color:${hex(view.colorOf(0))}` }, tags[0]), h('div', { class: 'h', style: `color:${hex(view.colorOf(1))}` }, tags[1]),
      ...row('与ダメージ', f0.statDmg, f1.statDmg),
      ...row('最大コンボ', f0.statMaxCombo, f1.statMaxCombo),
      ...row('ガード反撃 (GC)', f0.statGc, f1.statGc),
      ...row('ジャスト回避', f0.statJust, f1.statJust),
      ...row('クラッシュ', f0.statCrush, f1.statCrush),
      ...row('ガード', f0.statBlocks, f1.statBlocks),
    );
    const adviceText = advice(s.f[me], s.f[1 - me]);
    const m = modal(
      h('div', { class: 'list' },
        h('div', { class: 'result-head' },
          h('div', { class: 'win', style: `color:${color};text-shadow:0 0 24px ${color}` }, title),
          h('div', { class: 'spacer' }),
          h('div', { class: 'sub', style: 'color:var(--muted);font-size:12px' }, `${s.winsA} - ${s.winsB}`),
        ),
        table,
        adviceText ? h('div', { class: 'tip' }, h('span', { html: ICONS.info }), h('div', { class: 'advice' }, adviceText)) : null,
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary', onclick: () => { m.close(); cfg.onExit('rematch'); } }, cfg.mode === 'online' ? 'もう一度（キャラ選択）' : 'もう一度'),
          cfg.mode !== 'online' ? h('button', { class: 'btn', onclick: () => { m.close(); cfg.onExit('select'); } }, 'キャラ変更') : null,
          h('button', { class: 'btn', onclick: () => { cfg.online?.link.sendCtrl({ t: 'leave' }); m.close(); cfg.onExit('title'); } }, 'タイトル'),
        ),
      ),
      { wide: true },
    );
    if (won || winner === 2) sfx.success();
  }

  // ───────── training ─────────
  function resetPositions(): void {
    const keep = sim.s.f.map((f) => [f.infGuard, f.infCost]);
    sim.startRound(false);
    sim.skipIntro();
    sim.s.f.forEach((f, i) => ([f.infGuard, f.infCost] = keep[i]));
    view.vfx.clear();
    view.fx.clear();
  }

  function buildTrainingBar(): HTMLElement {
    const mk = (label: string, fn: (b: HTMLButtonElement) => void) => {
      const b = h('button', { class: 'btn small' }, label) as HTMLButtonElement;
      b.onclick = () => {
        sfx.ui();
        fn(b);
      };
      return b;
    };
    return h('div', { class: 'train-bar' },
      mk('ダミー', () => openDummyMenu()),
      mk('リセット', () => resetPositions()),
      mk('判定', (b) => {
        view.showHitboxes = !view.showHitboxes;
        b.classList.toggle('primary', view.showHitboxes);
      }),
      mk('メーター', (b) => {
        meter!.toggle();
        b.classList.toggle('primary', meter!.visible);
      }),
      mk('遅延 0F', (b) => {
        simDelay = (simDelay + 1) % 7;
        b.textContent = `遅延 ${simDelay}F`;
      }),
    );
  }

  function openDummyMenu(): void {
    paused = true;
    const list = h('div', { class: 'two-col' });
    for (const d of DUMMY_MODES) {
      const b = h('button', { class: `btn${dummy?.mode === d.id ? ' primary' : ''}`, style: 'flex-direction:column;align-items:flex-start;padding:8px 12px;min-height:56px' },
        h('b', null, d.label), h('small', { style: 'font-weight:400;font-size:10px;opacity:.75' }, d.desc));
      b.onclick = () => {
        dummy = new Dummy(sim, oppIdx, d.id as DummyMode);
        sim.s.f[oppIdx].infGuard = 0;
        sim.s.f[oppIdx].infCost = 0;
        m.close();
        paused = false;
        last = performance.now();
      };
      list.append(b);
    }
    const infCost = h('button', { class: `btn small${sim.s.f[cfg.local].infCost ? ' primary' : ''}` }, 'コスト無限');
    infCost.onclick = () => {
      const f = sim.s.f[cfg.local];
      f.infCost = f.infCost ? 0 : 1;
      infCost.classList.toggle('primary', !!f.infCost);
    };
    const m = modal(
      h('div', { class: 'list' }, h('h3', null, 'DUMMY'), list, h('div', { class: 'actions' }, infCost)),
      { onBackdrop: () => { m.close(); paused = false; last = performance.now(); } },
    );
  }

  // advantage display: frames between the two fighters becoming actionable after an exchange
  let lf = 0;
  const actionable = (f: FighterState) => f.st === ST_FREE || f.st === ST_STEP;
  let exchange = false;
  const freeAt = [-1, -1];
  let advTimer = 0;
  function trackAdvantage(): void {
    const s = sim.s;
    if (!sim.advanced) return;
    lf++;
    const busy = [!actionable(s.f[0]), !actionable(s.f[1])];
    if (busy[0] && busy[1]) {
      exchange = true;
      freeAt[0] = freeAt[1] = -1;
    }
    if (!exchange) return;
    for (let i = 0; i < 2; i++) if (!busy[i] && freeAt[i] < 0) freeAt[i] = lf;
    if (freeAt[0] >= 0 && freeAt[1] >= 0) {
      exchange = false;
      const adv = freeAt[1 - cfg.local] - freeAt[cfg.local];
      advEl.textContent = `${adv > 0 ? '+' : ''}${adv}F`;
      advEl.className = `adv ${adv > 0 ? 'plus' : adv < 0 ? 'minus' : ''}`;
      advEl.style.opacity = '1';
      advTimer = 150;
    }
    if (advTimer > 0 && --advTimer === 0) advEl.style.opacity = '0';
  }

  // ───────── main loop ─────────
  let disposed = false;
  const clock = new FrameClock();
  let last = performance.now();
  let raf = 0;
  let drawnW = 0;
  let drawnH = 0;
  // auto quality: measured over 120 drawn frames, after a settling second
  let perfSkip = 60;
  let perfN = 0;
  let perfAcc = 0;
  let perfLate = 0;
  let rafN = 0;
  let rafAcc = 0;
  let qualityRaised = false;
  let netInfoTimer = 0;
  let netPathPoll = 0;
  let netPath = '—';
  let renderErrorLogged = false;

  let devBot: ((s: Sim) => number) | null = null;
  /** Dev: render clock multiplier (0 freezes effects for screenshots). */
  let devTime = 1;
  /** Dev pause (tools/*-shot.mjs): keeps drawing so scripted steps show up. */
  let devPaused = false;
  function readLocal(): number {
    const w = devBot ? devBot(sim) : localInput();
    if (simDelay === 0) return w;
    delayQueue.push(w);
    return delayQueue.length > simDelay ? delayQueue.shift()! : 0;
  }

  function tick(): void {
    const s = sim.s;
    if (session) {
      session.tick(readLocal());
      KeyboardInput.endTick();
      return;
    }
    let a: number;
    let b: number;
    const mine = readLocal();
    let other = 0;
    if (kb2) other = kb2.poll();
    else if (cpu) other = cpu.input();
    else if (dummy) other = dummy.input();
    else if (cfg.tutorial) other = cfg.tutorial.dummy();
    KeyboardInput.endTick();
    if (cfg.local === 0) [a, b] = [mine, other];
    else [a, b] = [other, mine];
    sim.step(a, b);
    for (const e of sim.events) dispatch(e);
    if (cfg.mode === 'training') trackAdvantage();
    cfg.tutorial?.onTick();
    meter?.record();
    void s;
  }

  function frame(now: number): void {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = now - last;
    last = now;
    // fixed 60Hz ticks from the display's frames; the scene is drawn only on frames where the
    // sim ticked (90/120/144Hz screens) and not at all while paused behind a modal (frame-clock.ts)
    const resized = app.screen.width !== drawnW || app.screen.height !== drawnH;
    const step = clock.frame(dt, paused, paused && !devPaused, resized);
    for (let k = 0; k < step.ticks; k++) tick();
    rafN++;
    rafAcc += Math.min(Math.max(dt, 0), 250);
    if (session && netBadge && (netInfoTimer -= Math.max(dt, 0)) <= 0) updateNetBadge();
    if (!step.draw) return;
    const drawDt = step.drawDt;
    drawnW = app.screen.width;
    drawnH = app.screen.height;
    // render in the same frame as the input/sim update (Pixi's own ticker is stopped in battle).
    // A render error must never stop the game loop (the sim and HUD keep going either way).
    try {
      touch.tickAim();
      const a = touch.aim;
      view.aim = a ? { slot: slotFor(a.id), x: a.x, y: a.y, frac: a.frac, auto: a.auto, cancel: a.cancel, who: cfg.local } : null;
      view.render((drawDt / TICK_MS) * devTime);
      app.render();
    } catch (err) {
      if (!renderErrorLogged) console.error('[render]', err);
      renderErrorLogged = true;
      recoverRenderer(app.renderer); // a half-finished frame must not break every later one
    }
    hud.update();
    updateButtons();
    meter?.draw();
    if (settings.quality === 'auto' && !paused) autoQuality(drawDt);
  }

  /**
   * Auto quality (plan §10), measured on drawn frames. A draw arriving more than 1.5 ticks after
   * the previous one is a dropped frame the player sees as a stutter; the average alone hid
   * periodic drops (1 frame in 4 dropped still averaged < 21ms). 8 late draws in 120 (≈4 per
   * second) steps the quality down; a fast high-refresh device with none steps mid → high once.
   */
  function autoQuality(drawDt: number): void {
    if (perfSkip > 0) {
      perfSkip--;
      rafN = rafAcc = 0;
      return;
    }
    perfN++;
    perfAcc += drawDt;
    if (drawDt > TICK_MS * 1.5) perfLate++;
    if (perfN < 120) return;
    const avg = perfAcc / perfN;
    if ((avg > 21 || perfLate >= 8) && view.quality !== 'low') {
      view.setQuality(view.quality === 'high' ? 'mid' : 'low');
      perfSkip = 30;
    } else if (rafAcc / rafN < 12.5 && perfLate === 0 && view.quality === 'mid' && !qualityRaised) {
      qualityRaised = true;
      view.setQuality('high');
      perfSkip = 30;
    }
    perfN = perfAcc = perfLate = rafN = rafAcc = 0;
  }

  function updateNetBadge(): void {
    netInfoTimer = 1000;
    const link = cfg.online!.link;
    session!.rttFrames = link.rttMs / TICK_MS;
    paintNetBadge();
    // the route (direct / relay) hardly ever changes: getStats() every 5s is plenty
    if (--netPathPoll <= 0) {
      netPathPoll = 5;
      void link.info().then((info) => {
        netPath = info.path === 'direct' ? '直結' : info.path === 'relay' ? '中継' : info.path === 'stun' ? '経由' : '—';
        paintNetBadge();
      });
    }
  }

  function paintNetBadge(): void {
    if (!netBadge || disposed) return;
    const ms = Math.round(cfg.online!.link.rttMs);
    netBadge.className = `badge netbadge ${ms < 40 ? 'good' : ms < 100 ? 'ok' : 'bad'}`;
    netBadge.innerHTML = '';
    netBadge.append(h('span', { class: 'dot' }), `${netPath} ${ms}ms · 遅延${session!.inputDelay}F · 巻戻し${session!.stats.maxRollbackSeen}F`);
  }

  function updateButtons(): void {
    const f = sim.s.f[cfg.local];
    const c = sim.char(cfg.local);
    syncModeButtons();
    const av = (slot: number) => {
      const m = c.moves[slot === M_S1 ? sim.skillSlot(f, M_S1) : slot];
      return sim.canAfford(f, m) ? 'ready' : 'off';
    };
    touch.setAvailability({ s1: av(M_S1), s2: av(sim.s2Slot(f)), step: f.steps > 0 ? 'ok' : 'off' });
    // just-dodge slow motion: the attack button pulses ("press now → blink attack")
    // the music drops to silence for the whole just-dodge slow motion
    bgm.duck(sim.s.slow > 0);
    touch.setPrompt('atk', sim.s.slow > 0 && sim.s.slowWho === cfg.local && f.justWin > 0);
  }

  // events emitted while constructing the sim (ROUND 1)
  const initialEvents = [...sim.events];
  sim.events.length = 0;
  setTimeout(() => initialEvents.forEach((e) => !disposed && dispatch(e)), 60);

  const onVis = () => {
    if (document.hidden && cfg.mode !== 'online' && !matchOver) openPause();
    last = performance.now();
  };
  document.addEventListener('visibilitychange', onVis);
  app.ticker.stop();
  raf = requestAnimationFrame(frame);

  if (import.meta.env.DEV) {
    // dev-only hook for scripted visual checks (tools/shot.mjs)
    (window as unknown as Record<string, unknown>).__battle = {
      sim,
      view,
      session: () => session,
      reset: () => resetPositions(),
      setBot: (fn: ((s: Sim) => number) | null) => (devBot = fn),
      pause: (v: boolean) => (paused = devPaused = v),
      setTime: (k: number) => (devTime = k),
      step: (n: number, inA = 0, inB = 0) => {
        for (let k = 0; k < n; k++) {
          sim.step(inA, inB);
          for (const e of sim.events) dispatch(e);
        }
      },
    };
  }

  return {
    el: root,
    bgm: 'battle',
    onBack: () => {
      openPause();
      return true;
    },
    dispose: () => {
      disposed = true;
      bgm.duck(false);
      window.removeEventListener('mousemove', onMouseMove);
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      touch.dispose();
      view.destroy();
      if (cfg.online) {
        cfg.online.link.onGame = undefined;
      }
      app.ticker.start();
    },
  };
}

function legendMini(): HTMLElement {
  const wrap = h('div', { class: 'legend-grid' });
  for (const s of SHAPE_INFO.slice(0, 4)) {
    wrap.append(h('div', { class: 'legend-card' }, h('div', { html: shapeIcon(s.shape, s.color) }), h('b', null, s.state), h('div', { class: 'act', style: `color:${s.color}` }, s.act)));
  }
  return wrap;
}

/** One actionable hint from the match stats. */
function advice(me: FighterState, op: FighterState): string {
  if (me.statBlocks > 12 && me.statGc === 0) return 'ガードの後に攻撃ボタンを押すと「ガード反撃（GC）」が出ます。ガード硬直中に押しておけば最速で出ます。';
  if (op.statCrush > 0) return '六角（ガード）を三角で崩されました。三角を見たら、止まらずに動く／ステップで避けましょう。';
  if (me.statJust === 0 && op.statMaxCombo >= 3) return '相手の攻撃に合わせてステップすると「ジャスト回避」。直後の攻撃は1.5倍のジャスト攻撃になります。';
  if (me.statMaxCombo < 3) return '1段目が当たったら攻撃ボタンを押し続けて3段目まで。1段目が当たれば最後まで繋がります。';
  if (me.statCrush === 0 && op.statBlocks > 8) return '相手がガードを固めていたら、三角（GB）で崩すとフルコンボが入ります。';
  return 'ナイスファイト！トレーニングモードの「フレームメーター」で有利・不利を確かめてみましょう。';
}

void SH;
void PH_FIGHT;
void PH_INTRO;
void ST_ATTACK;
void saveSettings;
