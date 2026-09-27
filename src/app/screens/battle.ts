// Battle screen: fixed 60-tick loop, input sources, events → effects/sound, HUD, pause & result.
import { Sim } from '../../core/sim';
import { CHARACTERS } from '../../data/characters';
import { SYSTEM } from '../../data/system';
import { M_S1, M_S2, SH, SHAPES } from '../../core/compile';
import {
  type SimEvent, eventKey, EV_HIT, EV_BLOCK, EV_CRUSH, EV_GUARD_BREAK, EV_GB_OPEN, EV_JUST, EV_RIPOSTE,
  EV_KNOCKDOWN, EV_STEP, EV_HEAL, EV_KO, EV_ROUND, EV_FIGHT, EV_TIMEUP, EV_ROUND_END, EV_MATCH_END, EV_MOVE,
  HF_COUNTER, HF_KNOCKDOWN,
} from '../../core/events';
import { PH_FIGHT, PH_INTRO, ST_FREE, ST_STEP, ST_ATTACK, type FighterState } from '../../core/state';
import { BattleView } from '../../render/battle-view';
import { app, setAmbient } from '../../render/pixi-app';
import { TouchControls } from '../../input/touch';
import { KeyboardInput, KEYS_P1, KEYS_P2, KEYS_SOLO } from '../../input/keyboard';
import { CpuPlayer, CPU_LEVELS, Dummy, DUMMY_MODES, type DummyMode } from '../../ai/cpu';
import { sfx, vibrate } from '../../audio/sfx';
import { RollbackSession } from '../../net/rollback';
import type { PeerLink } from '../../net/transport';
import { settings, saveSettings } from '../settings';
import { h, hex, modal, shapeIcon, toast, ICONS, SHAPE_INFO } from '../ui';
import type { Screen } from '../router';
import { FrameMeter } from './frame-meter';
import { buildHud } from '../hud';

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
  tutorial?: TutorialHooks;
  onExit: (a: ExitAction) => void;
}

const TICK_MS = 1000 / 60;

export function battleScreen(cfg: BattleConfig): Screen {
  const training = cfg.mode === 'training' || cfg.mode === 'tutorial';
  const sim = new Sim(cfg.chars[0], cfg.chars[1], { training });
  if (training) sim.skipIntro();
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
  const localDef = defs[cfg.local];
  const skillLook = (i: number) => ({ shape: localDef.skills[i].shape, label: `S${i + 1}`, cost: localDef.skills[i].cost });
  touch.setButtons({ atk: { shape: 'circle', label: 'ATTACK' }, s1: skillLook(0), s2: skillLook(1), step: { shape: 'arrow', label: 'STEP' } });

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
  const kb = new KeyboardInput(cfg.mode === 'local' ? KEYS_P1 : KEYS_SOLO, 0);
  const kb2 = cfg.mode === 'local' ? new KeyboardInput(KEYS_P2, 1) : null;
  const localInput = () => touch.poll() | kb.poll();
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
  const seen = new Map<string, number>();
  if (cfg.online) {
    const link = cfg.online.link;
    session = new RollbackSession(sim, {
      local: cfg.local,
      inputDelay: cfg.online.inputDelay,
      send: (p) => link.sendGame(p),
      onEvents: (evs) => {
        for (const e of evs) {
          const k = eventKey(e);
          if (seen.has(k)) continue;
          seen.set(k, e.frame);
          dispatch(e);
        }
        if (seen.size > 600) for (const [k, f] of seen) if (f < sim.s.frame - 120) seen.delete(k);
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
        sfx.hit(heavy, !!(e.b & HF_COUNTER));
        if (involvesLocal(e.who) || involvesLocal(1 - e.who)) vibrate(heavy ? 25 : 10);
        break;
      }
      case EV_BLOCK:
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
      case EV_RIPOSTE:
        sfx.riposte();
        vibrate(30);
        break;
      case EV_MOVE: {
        const m = sim.moveOf(s.f[e.who]);
        if (m) {
          const shape = SHAPES[m.shape];
          if (shape === 'triangle' || shape === 'pentagon' || shape === 'hexagon') sfx.startup(shape);
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
    if (s.hitstop > 0 || s.freeze > 0) return;
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
  let acc = 0;
  let last = performance.now();
  let raf = 0;
  let perfAcc = 0;
  let qualityRaised = false;
  let perfN = 0;
  let netInfoTimer = 0;

  let devBot: ((s: Sim) => number) | null = null;
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
    let dt = now - last;
    last = now;
    if (dt > 250) dt = 250;
    if (!paused) {
      acc += dt;
      let n = 0;
      while (acc >= TICK_MS && n < 8) {
        tick();
        acc -= TICK_MS;
        n++;
      }
      if (n === 8) acc = 0;
    }
    view.render(dt / TICK_MS);
    // render in the same frame as the input/sim update (Pixi's own ticker is stopped in battle)
    app.render();
    hud.update();
    updateButtons();
    meter?.draw();
    // auto quality (plan §10: measured frame time)
    if (settings.quality === 'auto') {
      perfAcc += dt;
      perfN++;
      if (perfN >= 120) {
        const avg = perfAcc / perfN;
        if (avg > 21 && view.quality !== 'low') view.setQuality(view.quality === 'high' ? 'mid' : 'low');
        else if (avg < 12.5 && view.quality === 'mid' && !qualityRaised) {
          qualityRaised = true;
          view.setQuality('high');
        }
        perfAcc = perfN = 0;
      }
    }
    if (session && netBadge && (netInfoTimer -= dt) <= 0) {
      netInfoTimer = 1000;
      const link = cfg.online!.link;
      session.rttFrames = link.rttMs / TICK_MS;
      void link.info().then((info) => {
        if (!netBadge) return;
        const ms = Math.round(link.rttMs);
        const label = info.path === 'direct' ? '直結' : info.path === 'relay' ? '中継' : info.path === 'stun' ? '経由' : '—';
        netBadge.className = `badge netbadge ${ms < 40 ? 'good' : ms < 100 ? 'ok' : 'bad'}`;
        netBadge.innerHTML = '';
        netBadge.append(h('span', { class: 'dot' }), `${label} ${ms}ms · 遅延${session!.inputDelay}F · 巻戻し${session!.stats.maxRollbackSeen}F`);
      });
    }
  }

  function updateButtons(): void {
    const f = sim.s.f[cfg.local];
    const c = sim.char(cfg.local);
    const av = (slot: number) => {
      const m = c.moves[slot];
      const ok = (f.infCost || f.cost >= m.cost) && (m.usesPerRound === 0 || f.healUses < m.usesPerRound);
      return ok ? 'ready' : 'off';
    };
    touch.setAvailability({ s1: av(M_S1), s2: av(M_S2), step: f.steps > 0 ? 'ok' : 'off' });
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
      setBot: (fn: ((s: Sim) => number) | null) => (devBot = fn),
      pause: (v: boolean) => (paused = v),
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
    onBack: () => {
      openPause();
      return true;
    },
    dispose: () => {
      disposed = true;
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
