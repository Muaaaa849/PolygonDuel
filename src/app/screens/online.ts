// Online lobby (plan §9-1, §13): host shows QR-A → guest scans, shows QR-B → host scans.
// No server: the QR *is* the signaling. After connecting, the link stays up for rematches.
import { PeerLink, requestCamera } from '../../net/transport';
import { extractCode } from '../../net/qr-signaling';
import { CHARACTERS } from '../../data/characters';
import { settings, saveSettings } from '../settings';
import { backButton, h, hex, ICONS, shapeIcon, toast } from '../ui';
import { renderQr, QrScanner } from '../qr-view';
import { show, type Screen } from '../router';
import { setAmbient } from '../../render/pixi-app';
import { sfx, unlockAudio } from '../../audio/sfx';
import { charCards } from './select';
import { battleScreen } from './battle';

export interface OnlineNav {
  title: () => void;
}

const joinUrlPrefix = () => `${location.origin}${location.pathname}#`;

function stepsBar(active: number, labels: string[]): HTMLElement {
  const el = h('div', { class: 'steps' });
  labels.forEach((l, i) => {
    if (i) el.append(h('span', { class: 'sep' }));
    el.append(h('span', { class: `s${i === active ? ' on' : ''}${i < active ? ' done' : ''}` }, h('i', null, i < active ? '✓' : String(i + 1)), l));
  });
  return el;
}

const tethering = () =>
  h('div', { class: 'tip' }, h('span', { html: ICONS.wifi }),
    h('div', null, h('b', null, '近くにいるならテザリングか同じWi-Fiがおすすめ'), h('br'), '端末どうしが直結になり、遅延はほぼゼロ。インターネットは使いません。'));

export function onlineHome(nav: OnlineNav): Screen {
  const choice = (icon: string, title: string, desc: string, fn: () => void) => {
    const b = h('button', { class: 'choice' }, h('div', { class: 'big-ico', html: icon }), h('b', null, title), h('p', null, desc));
    b.onclick = () => {
      unlockAudio();
      sfx.confirm();
      fn();
    };
    return b;
  };
  const el = h('div', { class: 'screen' },
    h('div', { class: 'topbar' }, backButton(() => { sfx.back(); nav.title(); }), h('h2', null, 'ONLINE'), h('span', { class: 'sub' }, '2台で対戦')),
    h('div', { class: 'online-body' },
      choice(shapeIcon('hexagon', '#5aa0ff'), '部屋を作る', 'QRコードを表示します。相手に読み取ってもらったら、相手のQRを読み取ります。', () => show(hostScreen(nav))),
      choice(shapeIcon('arrow', '#58f0a0'), '部屋に入る', '相手のQRをカメラで読み取ります。読み取ると自分のQRが表示されるので、相手に読み取ってもらいます。', () => show(joinScreen(nav))),
    ),
    h('div', { style: 'margin-top:10px' }, tethering()),
  );
  return { el, onBack: () => (nav.title(), true) };
}

function versionMismatch(remote: string): boolean {
  if (remote === __BUILD_HASH__) return false;
  toast('相手とバージョンが違います。両方のページを再読み込みしてください。', 5000);
  return true;
}

function manualEntry(onCode: (code: string) => void): HTMLElement {
  const input = h('input', { placeholder: 'コードを貼り付け', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' }) as HTMLInputElement;
  const go = h('button', { class: 'btn small' }, '接続');
  go.onclick = () => {
    const c = extractCode(input.value);
    if (c) onCode(c);
    else toast('コードが正しくありません');
  };
  return h('div', { class: 'code-row' }, input, go);
}

function copyButton(text: string, label = 'コードをコピー'): HTMLElement {
  const b = h('button', { class: 'btn small' }, h('span', { html: ICONS.copy, style: 'width:14px;height:14px;display:inline-flex' }), label);
  b.onclick = async () => {
    try {
      if (navigator.share && /^https?:/.test(text)) await navigator.share({ title: 'POLYGON DUEL', url: text });
      else await navigator.clipboard.writeText(text);
      toast('コピーしました');
    } catch {
      /* cancelled */
    }
  };
  return b;
}

/** Camera permission block with a one-line reason (plan §13 step 4). */
async function withCamera(pane: HTMLElement, reason: string): Promise<MediaStream | null> {
  pane.innerHTML = '';
  pane.append(h('div', { class: 'spinner' }), h('p', null, reason));
  const stream = await requestCamera();
  return stream;
}

export function hostScreen(nav: OnlineNav): Screen {
  const link = new PeerLink();
  let scanner: QrScanner | null = null;
  let disposed = false;
  let connected = false;
  const left = h('div', { class: 'pane' });
  const right = h('div', { class: 'pane' });
  const steps = h('div');
  const setStep = (i: number) => {
    steps.innerHTML = '';
    steps.append(stepsBar(i, ['QRを見せる', '相手のQRを読む', '接続']));
  };
  setStep(0);
  const el = h('div', { class: 'screen' },
    h('div', { class: 'topbar' }, backButton(() => { sfx.back(); cleanup(); show(onlineHome(nav)); }), h('h2', null, 'HOST'), h('span', { class: 'spacer' }), steps),
    h('div', { class: 'online-body' }, left, right),
  );

  function cleanup(): void {
    scanner?.stop();
    if (!connected) link.close();
  }

  async function start(): Promise<void> {
    const stream = await withCamera(left, 'カメラで相手のQRを読みます。許可すると同じWi-Fi・テザリングで直結できます。');
    if (disposed) return;
    left.innerHTML = '';
    left.append(h('div', { class: 'spinner' }), h('p', null, '接続情報を準備中…'));
    let code: string;
    try {
      code = await link.createOffer(__BUILD_HASH__);
    } catch (e) {
      left.innerHTML = '';
      left.append(h('p', { class: 'error' }, `準備に失敗しました: ${(e as Error).message}`));
      return;
    }
    if (disposed) return;
    const url = joinUrlPrefix() + code;
    left.innerHTML = '';
    left.append(
      h('h3', null, '① 相手にこのQRを読み取ってもらう'),
      h('div', { class: 'qr-box', 'data-code': code }, renderQr(code, joinUrlPrefix())),
      h('div', { style: 'display:flex;gap:8px' }, copyButton(url, 'リンクを共有')),
    );
    right.innerHTML = '';
    const onCode = async (text: string): Promise<boolean> => {
      const c = extractCode(text);
      if (!c) return false;
      try {
        const { remoteBuild } = await link.acceptAnswer(c);
        if (versionMismatch(remoteBuild)) return false;
        sfx.confirm();
        setStep(2);
        scanner?.setStatus('接続中…');
        right.innerHTML = '';
        right.append(h('div', { class: 'spinner' }), h('p', null, '接続中…'));
        return true;
      } catch (e) {
        const msg = (e as Error).message;
        if (/部屋を作る/.test(msg)) return false; // scanned our own / another host code
        scanner?.setStatus(msg);
        return false;
      }
    };
    right.append(h('h3', null, '② 相手の画面に出たQRを読み取る'));
    if (stream) {
      scanner = new QrScanner(stream, onCode);
      right.append(scanner.el);
    } else {
      right.append(h('p', null, 'カメラが使えません。相手のコードを貼り付けてください。'));
    }
    right.append(manualEntry((c) => void onCode(c)));
    setStep(1);
  }

  link.onOpen = () => {
    connected = true;
    scanner?.stop();
    sfx.success();
    show(onlineSelect(nav, link, true));
  };
  link.onClose = (r) => {
    if (!disposed && !connected) toast(r);
  };
  void start();
  return {
    el,
    dispose: () => {
      disposed = true;
      scanner?.stop();
    },
    onBack: () => {
      cleanup();
      show(onlineHome(nav));
      return true;
    },
  };
}

export function joinScreen(nav: OnlineNav, presetCode?: string): Screen {
  const link = new PeerLink();
  let scanner: QrScanner | null = null;
  let disposed = false;
  let connected = false;
  let handled = false;
  const left = h('div', { class: 'pane' });
  const right = h('div', { class: 'pane' });
  const steps = h('div');
  const setStep = (i: number) => {
    steps.innerHTML = '';
    steps.append(stepsBar(i, ['相手のQRを読む', 'QRを見せる', '接続']));
  };
  setStep(0);
  const el = h('div', { class: 'screen' },
    h('div', { class: 'topbar' }, backButton(() => { sfx.back(); cleanup(); show(onlineHome(nav)); }), h('h2', null, 'JOIN'), h('span', { class: 'spacer' }), steps),
    h('div', { class: 'online-body' }, left, right),
  );

  function cleanup(): void {
    scanner?.stop();
    if (!connected) link.close();
  }

  const onCode = async (text: string): Promise<boolean> => {
    if (handled) return true;
    const c = extractCode(text);
    if (!c) return false;
    try {
      handled = true;
      scanner?.setStatus('読み取りました');
      const { answer, remoteBuild } = await link.acceptOffer(c, __BUILD_HASH__);
      if (versionMismatch(remoteBuild)) {
        handled = false;
        return false;
      }
      sfx.confirm();
      scanner?.stop();
      setStep(1);
      left.innerHTML = '';
      left.append(h('h3', null, '② このQRを相手に読み取ってもらう'), h('div', { class: 'qr-box', 'data-code': answer }, renderQr(answer)), copyButton(answer));
      right.innerHTML = '';
      right.append(h('div', { class: 'spinner' }), h('p', null, '相手が読み取るのを待っています…'), tethering());
      return true;
    } catch (e) {
      handled = false;
      scanner?.setStatus((e as Error).message);
      return false;
    }
  };

  async function start(): Promise<void> {
    if (presetCode) {
      // arrived through the host's QR as a URL (native camera app)
      left.append(h('div', { class: 'spinner' }), h('p', null, '接続情報を作成中…'));
      right.append(tethering());
      await onCode(presetCode);
      return;
    }
    const stream = await withCamera(left, 'カメラで相手のQRを読みます。許可すると同じWi-Fi・テザリングで直結できます。');
    if (disposed) return;
    left.innerHTML = '';
    left.append(h('h3', null, '① 相手の画面のQRを読み取る'));
    if (stream) {
      scanner = new QrScanner(stream, onCode);
      left.append(scanner.el);
    } else left.append(h('p', null, 'カメラが使えません。相手のコードを貼り付けてください。'));
    left.append(manualEntry((c) => void onCode(c)));
    right.innerHTML = '';
    right.append(h('div', { html: shapeIcon('hexagon', '#5aa0ff'), style: 'width:48px;height:48px' }), h('p', null, '相手が「部屋を作る」で表示したQRを読み取ってください。'), tethering());
  }

  link.onOpen = () => {
    connected = true;
    sfx.success();
    show(onlineSelect(nav, link, false));
  };
  link.onClose = (r) => {
    if (!disposed && !connected) toast(r);
  };
  void start();
  return {
    el,
    dispose: () => {
      disposed = true;
      scanner?.stop();
    },
    onBack: () => {
      cleanup();
      show(onlineHome(nav));
      return true;
    },
  };
}

/** After connecting: both pick characters; the host starts the match. The link persists. */
export function onlineSelect(nav: OnlineNav, link: PeerLink, isHost: boolean, prev?: { mine: number }): Screen {
  const initial = prev?.mine ?? Math.max(0, CHARACTERS.findIndex((c) => c.id === settings.lastChar));
  let mine = initial;
  let theirs = -1;
  let myReady = false;
  let theirReady = false;
  let started = false;
  const status = h('div', { class: 'hint' });
  const readyBtn = h('button', { class: 'btn primary' }, '準備OK');
  const badge = h('span', { class: 'badge good' }, h('span', { class: 'dot' }), '接続中');
  const cards = charCards((i) => {
    mine = i;
    cards.you(i);
    if (myReady) setReady(false);
    link.sendCtrl({ t: 'pick', c: i });
  }, initial);

  const refresh = () => {
    cards.mark(theirs, theirs >= 0 ? (theirReady ? 'RIVAL ✓' : 'RIVAL') : null);
    readyBtn.textContent = myReady ? '取り消す' : '準備OK';
    readyBtn.className = `btn ${myReady ? '' : 'primary'}`;
    status.textContent = myReady && !theirReady ? '相手の準備を待っています…' : !myReady && theirReady ? '相手は準備OK！' : theirs < 0 ? '相手がキャラを選んでいます…' : '';
  };
  const setReady = (v: boolean) => {
    myReady = v;
    link.sendCtrl({ t: 'ready', v, c: mine });
    refresh();
    maybeStart();
  };
  readyBtn.onclick = () => {
    sfx.confirm();
    setReady(!myReady);
  };

  const inputDelay = () => {
    const oneWay = link.rttMs / 2;
    return Math.max(1, Math.min(3, Math.ceil(oneWay / (1000 / 60))));
  };

  function maybeStart(): void {
    if (!isHost || !myReady || !theirReady || started || theirs < 0) return;
    const delay = inputDelay();
    link.sendCtrl({ t: 'start', chars: [mine, theirs], delay });
    begin([mine, theirs], delay);
  }

  function begin(chars: [number, number], delay: number): void {
    if (started) return;
    started = true;
    saveSettings({ lastChar: CHARACTERS[mine].id });
    const local: 0 | 1 = isHost ? 0 : 1;
    show(
      battleScreen({
        mode: 'online',
        chars,
        local,
        online: { link, inputDelay: delay },
        onExit: (a) => {
          if (a === 'title') {
            link.close();
            nav.title();
          } else {
            setAmbient(true);
            show(onlineSelect(nav, link, isHost, { mine }));
          }
        },
      }),
    );
  }

  link.onCtrl = (m) => {
    switch (m.t) {
      case 'pick':
        theirs = m.c as number;
        theirReady = false;
        break;
      case 'ready':
        theirs = m.c as number;
        theirReady = !!m.v;
        if (theirReady) sfx.ui();
        break;
      case 'start': {
        const chars = m.chars as [number, number];
        begin(chars, m.delay as number);
        return;
      }
      case 'hello':
        theirs = (m.c as number) ?? theirs;
        break;
      case 'leave':
        toast('相手が退出しました');
        link.close();
        nav.title();
        return;
    }
    refresh();
    maybeStart();
  };
  link.onClose = (r) => {
    if (started) return;
    toast(`切断されました: ${r}`);
    nav.title();
  };
  link.sendCtrl({ t: 'hello', c: mine, build: __BUILD_HASH__ });
  link.sendCtrl({ t: 'pick', c: mine });

  const rtt = h('span', { style: 'font-size:11px;color:var(--muted)' });
  const rttTimer = window.setInterval(async () => {
    const info = await link.info();
    const label = info.path === 'direct' ? '直結' : info.path === 'relay' ? '中継' : info.path === 'stun' ? 'ネット経由' : '確認中';
    const ms = Math.round(link.rttMs);
    badge.className = `badge ${ms < 40 ? 'good' : ms < 100 ? 'ok' : 'bad'}`;
    badge.innerHTML = '';
    badge.append(h('span', { class: 'dot' }), `${label}・${ms}ms`);
    rtt.textContent = ms >= 100 ? '遅延が大きめです。テザリングか同じWi-Fiにすると快適です' : '';
  }, 800);

  const el = h('div', { class: 'screen' },
    h('div', { class: 'topbar' },
      backButton(() => { sfx.back(); link.sendCtrl({ t: 'leave' }); link.close(); nav.title(); }),
      h('h2', null, 'ONLINE'), h('span', { class: 'sub' }, isHost ? 'あなた = 1P（左）' : 'あなた = 2P（右）'), h('span', { class: 'spacer' }), rtt, badge),
    cards.el,
    h('div', { class: 'select-footer' }, status, readyBtn),
  );
  refresh();
  cards.you(mine);
  void hex;
  return {
    el,
    dispose: () => {
      cards.stop();
      clearInterval(rttTimer);
    },
    onBack: () => true,
  };
}
