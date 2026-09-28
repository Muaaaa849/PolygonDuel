// Online lobby (plan §9-1, §13). Two ways to connect:
//  - Link room (far away): host opens a room and sends its link over LINE / Discord;
//    opening the link joins. A public signaling server only swaps connection info.
//  - QR (nearby): host shows QR-A → guest scans, shows QR-B → host scans. No server at all.
// After connecting, the P2P link stays up for rematches.
import { PeerLink, requestCamera } from '../../net/transport';
import { Relay, RELAY_ICE, newRoomCode, parseRoomCode, roomLink, roomPeerId, ROOM_CODE_LEN, type RoomMsg } from '../../net/relay';
import { extractCode } from '../../net/qr-signaling';
import { CHARACTERS } from '../../data/characters';
import { settings, saveSettings } from '../settings';
import { backButton, h, hex, ICONS, shapeIcon, toast } from '../ui';
import { renderQr, QrScanner } from '../qr-view';
import { show, type Screen } from '../router';
import { setAmbient } from '../../render/pixi-app';
import { sfx, unlockAudio } from '../../audio/sfx';
import { charCards } from './select';
import { battleScreen, myControlModes } from './battle';

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
  const choice = (icon: string, title: string, desc: string, fn: () => void, cls = '') => {
    const b = h('button', { class: `choice${cls}` }, h('div', { class: 'big-ico', html: icon }), h('b', null, title), h('p', null, desc));
    b.onclick = () => {
      unlockAudio();
      sfx.confirm();
      fn();
    };
    return b;
  };
  const codeIn = h('input', { placeholder: 'ルームコード', maxlength: String(ROOM_CODE_LEN + 20), autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' }) as HTMLInputElement;
  const joinBtn = h('button', { class: 'btn small' }, '参加');
  const joinCode = () => {
    const c = parseRoomCode(codeIn.value);
    if (!c) return toast('ルームコード（6文字）を入力してください');
    unlockAudio();
    sfx.confirm();
    show(roomJoinScreen(nav, c));
  };
  joinBtn.onclick = joinCode;
  // (block body: an on* handler that returns false cancels the key — no typing at all)
  codeIn.onkeydown = (e) => {
    if (e.key === 'Enter') joinCode();
  };
  const el = h('div', { class: 'screen' },
    h('div', { class: 'topbar' }, backButton(() => { sfx.back(); nav.title(); }), h('h2', null, 'ONLINE'), h('span', { class: 'sub' }, '2台で対戦')),
    h('div', { class: 'online-body' },
      choice(ICONS.link, 'リンクで部屋を作る', 'LINE・Discordなどでリンクを送るだけ。遠くの人とも対戦できます。相手はリンクを開けば参加。', () => show(roomHostScreen(nav)), ' primary-choice'),
      h('div', { class: 'choice-col' },
        choice(shapeIcon('hexagon', '#5aa0ff'), 'QRで部屋を作る', '近くの人と。QRを見せ合って直結（サーバー不要）。', () => show(hostScreen(nav)), ' small'),
        choice(shapeIcon('arrow', '#58f0a0'), 'QRで部屋に入る', '相手のQRをカメラで読み取ります。', () => show(joinScreen(nav)), ' small'),
      ),
    ),
    h('div', { class: 'online-foot' },
      h('div', { class: 'code-row' }, h('span', { class: 'lbl' }, 'コードで参加'), codeIn, joinBtn),
      tethering(),
    ),
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

/** Share / copy buttons for a room link. */
function shareButtons(code: string): HTMLElement {
  const url = roomLink(code);
  const text = `POLYGON DUELで対戦しよう！ ルームコード ${code}`;
  const row = h('div', { class: 'share-row' });
  const canShare = typeof navigator.share === 'function';
  if (canShare) {
    const share = h('button', { class: 'btn primary' }, h('span', { html: ICONS.link, class: 'bi' }), '共有（LINE・Discord…）');
    share.onclick = async () => {
      try {
        await navigator.share({ title: 'POLYGON DUEL', text, url });
      } catch {
        /* cancelled */
      }
    };
    row.append(share);
  }
  const copy = h('button', { class: `btn${canShare ? '' : ' primary'}` }, h('span', { html: ICONS.copy, class: 'bi' }), 'リンクをコピー');
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      toast('コピーしました。LINEやDiscordに貼り付けて送ってください');
    } catch {
      toast(url, 6000);
    }
  };
  row.append(copy);
  return row;
}

const relayError = (why: string) =>
  why === 'id-taken' ? 'このルームは使用中です' : '接続サーバーに繋がりません。通信環境を確認するか、近くの人とはQRで対戦できます。';

/** Link room — host: claim a room code on the relay, share the link, wait for the guest. */
export function roomHostScreen(nav: OnlineNav): Screen {
  let code = newRoomCode();
  let relay: Relay | null = null;
  let link: PeerLink | null = null;
  let guest: string | null = null;
  let guestAt = 0;
  let offer: string | null = null;
  let localCands: (RTCIceCandidateInit | null)[] = [];
  let disposed = false;
  let connected = false;
  let reconnectTimer = 0;
  const left = h('div', { class: 'pane' });
  const right = h('div', { class: 'pane' });
  const steps = h('div');
  const setStep = (i: number) => {
    steps.innerHTML = '';
    steps.append(stepsBar(i, ['リンクを送る', '相手の参加', '接続']));
  };
  setStep(0);
  const el = h('div', { class: 'screen' },
    h('div', { class: 'topbar' }, backButton(() => { sfx.back(); cleanup(); show(onlineHome(nav)); }), h('h2', null, 'ROOM'), h('span', { class: 'spacer' }), steps),
    h('div', { class: 'online-body' }, left, right),
  );

  const waiting = () => {
    setStep(1);
    right.innerHTML = '';
    right.append(
      h('div', { class: 'spinner' }),
      h('p', null, h('b', null, '相手の参加を待っています'), h('br'), '相手がリンクを開くか、ルームコードを入力すると自動でつながります。'),
      h('div', { class: 'tip' }, h('span', { html: ICONS.info }), h('div', null, 'このページは開いたままに。LINEなどに切り替えて送っても大丈夫です（戻ると自動で再接続）。')),
    );
  };

  function resetLink(): void {
    link?.close();
    guest = null;
    offer = null;
    localCands = [];
    const l = new PeerLink(RELAY_ICE);
    link = l;
    l.onLocalCandidate = (c) => {
      localCands.push(c);
      if (guest && offer) relay?.send(guest, { t: 'ice', c });
    };
    l.onOpen = () => {
      if (disposed || link !== l) return;
      connected = true;
      relay?.close();
      sfx.success();
      show(onlineSelect(nav, l, true));
    };
    l.onClose = (r) => {
      if (disposed || connected || link !== l) return;
      toast(`${r}。相手にもう一度リンクを開いてもらってください`, 4000);
      resetLink();
      waiting();
    };
  }

  async function onMsg(from: string, m: RoomMsg): Promise<void> {
    if (disposed || connected || !relay) return;
    if (m.t === 'join') {
      if (m.build !== __BUILD_HASH__) {
        relay.send(from, { t: 'reject', why: 'version' });
        toast('相手とバージョンが違います。両方のページを再読み込みしてください。', 5000);
        return;
      }
      if (guest && guest !== from) {
        if (performance.now() - guestAt < 15000) {
          relay.send(from, { t: 'reject', why: 'full' });
          return;
        }
        resetLink(); // the previous guest never finished connecting
      }
      if (guest === from && offer) {
        // the guest retried before our offer arrived: resend everything
        relay.send(from, { t: 'offer', sdp: offer });
        for (const c of localCands) relay.send(from, { t: 'ice', c });
        return;
      }
      guest = from;
      guestAt = performance.now();
      const l = link!;
      const sdp = await l.offerSdp();
      if (link !== l || guest !== from) return;
      offer = sdp;
      relay.send(from, { t: 'offer', sdp });
      for (const c of localCands) relay.send(from, { t: 'ice', c });
      sfx.confirm();
      setStep(2);
      right.innerHTML = '';
      right.append(h('div', { class: 'spinner' }), h('p', null, h('b', null, '相手が見つかりました'), h('br'), '接続しています…'));
    } else if (from === guest) {
      if (m.t === 'answer') await link?.setAnswerSdp(m.sdp as string).catch(() => undefined);
      else if (m.t === 'ice') await link?.addRemoteCandidate(m.c as RTCIceCandidateInit | null);
      else if (m.t === 'bye') {
        resetLink();
        waiting();
      }
    }
  }

  async function openRelay(first: boolean): Promise<void> {
    clearTimeout(reconnectTimer);
    if (disposed || connected) return;
    const r = new Relay(roomPeerId(code));
    r.onMessage = (from, m) => void onMsg(from, m);
    r.onDrop = () => scheduleReconnect();
    try {
      await r.connect();
    } catch (e) {
      const why = (e as Error).message;
      if (first && why === 'id-taken') {
        code = newRoomCode();
        return openRelay(true);
      }
      if (first) {
        left.innerHTML = '';
        left.append(h('p', { class: 'error' }, relayError(why)), h('button', { class: 'btn', onclick: () => { left.innerHTML = ''; left.append(h('div', { class: 'spinner' })); void openRelay(true); } }, 'もう一度'));
        right.innerHTML = '';
        right.append(
          h('p', null, '近くの人とは、サーバーを使わないQR接続で対戦できます。'),
          h('button', { class: 'btn primary', onclick: () => { cleanup(); show(hostScreen(nav)); } }, 'QRで部屋を作る'),
        );
        return;
      }
      scheduleReconnect();
      return;
    }
    if (disposed || connected) return r.close();
    relay = r;
    if (first) showRoom();
  }

  function scheduleReconnect(): void {
    relay = null;
    if (disposed || connected) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(() => void openRelay(false), 2000);
  }

  function showRoom(): void {
    left.innerHTML = '';
    left.append(
      h('h3', null, '① このリンクを相手に送る'),
      h('div', { class: 'room-code' }, ...[...code].map((ch) => h('span', null, ch))),
      h('div', { class: 'room-url' }, roomLink(code)),
      shareButtons(code),
      h('p', { class: 'small-note' }, '相手はリンクを開くだけ。アプリ内ブラウザで繋がらない時は、SafariやChromeで開いてもらってください。'),
    );
    waiting();
  }

  function cleanup(): void {
    disposed = true;
    clearTimeout(reconnectTimer);
    if (guest && !connected) relay?.send(guest, { t: 'bye' });
    relay?.close();
    if (!connected) link?.close();
  }

  const onVis = () => {
    if (!document.hidden && !relay?.isOpen && !disposed && !connected) void openRelay(false);
  };
  document.addEventListener('visibilitychange', onVis);
  left.append(h('div', { class: 'spinner' }), h('p', null, '部屋を作っています…'));
  resetLink();
  void openRelay(true);
  return {
    el,
    dispose: () => {
      document.removeEventListener('visibilitychange', onVis);
      if (!disposed) cleanup();
    },
    onBack: () => {
      cleanup();
      show(onlineHome(nav));
      return true;
    },
  };
}

/** Link room — guest: find the host through the relay and connect. */
export function roomJoinScreen(nav: OnlineNav, code: string): Screen {
  const hostId = roomPeerId(code);
  let relay: Relay | null = null;
  let link: PeerLink | null = null;
  let disposed = false;
  let connected = false;
  let gotOffer = false;
  let answered = false;
  let localCands: (RTCIceCandidateInit | null)[] = [];
  let joinTimer = 0;
  let failTimer = 0;
  let tries = 0;
  const left = h('div', { class: 'pane' });
  const right = h('div', { class: 'pane' });
  const steps = h('div');
  const setStep = (i: number) => {
    steps.innerHTML = '';
    steps.append(stepsBar(i, ['ルームを探す', '接続', '対戦']));
  };
  setStep(0);
  const el = h('div', { class: 'screen' },
    h('div', { class: 'topbar' }, backButton(() => { sfx.back(); cleanup(); show(onlineHome(nav)); }), h('h2', null, 'JOIN'), h('span', { class: 'sub' }, `ルーム ${code}`), h('span', { class: 'spacer' }), steps),
    h('div', { class: 'online-body' }, left, right),
  );
  right.append(
    h('div', { class: 'room-code small' }, ...[...code].map((ch) => h('span', null, ch))),
    h('p', null, '相手（部屋を作った人）がページを開いたままにしている必要があります。'),
    h('p', { class: 'small-note' }, 'LINE・Discordのアプリ内ブラウザで繋がらない時は、SafariやChromeで開き直してください。'),
  );
  const status = (title: string, sub = '', spin = true) => {
    left.innerHTML = '';
    if (spin) left.append(h('div', { class: 'spinner' }));
    left.append(h('p', null, h('b', null, title), sub ? h('br') : null, sub));
  };
  const fail = (title: string, sub: string) => {
    clearInterval(joinTimer);
    clearTimeout(failTimer);
    left.innerHTML = '';
    left.append(
      h('p', { class: 'error' }, title),
      h('p', null, sub),
      h('div', { class: 'share-row' },
        h('button', { class: 'btn primary', onclick: () => { cleanup(); show(roomJoinScreen(nav, code)); } }, 'もう一度'),
        h('button', { class: 'btn', onclick: () => { cleanup(); show(onlineHome(nav)); } }, '戻る'),
      ),
    );
  };

  function cleanup(): void {
    disposed = true;
    clearInterval(joinTimer);
    clearTimeout(failTimer);
    if (!connected) {
      relay?.send(hostId, { t: 'bye' });
      link?.close();
    }
    relay?.close();
  }

  async function start(): Promise<void> {
    status('ルームを探しています…');
    const r = new Relay(`pdg-${Math.random().toString(36).slice(2, 12)}`);
    try {
      await r.connect();
    } catch (e) {
      if (!disposed) fail('接続できませんでした', relayError((e as Error).message));
      return;
    }
    if (disposed) return r.close();
    relay = r;
    const l = new PeerLink(RELAY_ICE);
    link = l;
    l.onLocalCandidate = (c) => {
      localCands.push(c);
      if (answered) r.send(hostId, { t: 'ice', c });
    };
    l.onOpen = () => {
      if (disposed) return;
      connected = true;
      clearTimeout(failTimer);
      r.close();
      sfx.success();
      show(onlineSelect(nav, l, false));
    };
    l.onClose = (why) => {
      if (!disposed && !connected) fail('接続が切れました', `${why}。もう一度お試しください。`);
    };
    r.onMessage = async (from, m) => {
      if (from !== hostId || disposed || connected) return;
      if (m.t === 'reject') {
        if (m.why === 'version') fail('バージョンが違います', '両方のページを再読み込みしてから、もう一度リンクを開いてください。');
        else fail('満員です', 'この部屋は別の人と接続中です。');
      } else if (m.t === 'offer' && !gotOffer) {
        gotOffer = true;
        clearInterval(joinTimer);
        setStep(1);
        status('接続しています…', '相手の端末とつないでいます');
        const ans = await l.answerSdp(m.sdp as string).catch(() => null);
        if (!ans || disposed) return;
        r.send(hostId, { t: 'answer', sdp: ans });
        answered = true;
        for (const c of localCands) r.send(hostId, { t: 'ice', c });
        failTimer = window.setTimeout(() => {
          if (!connected) fail('接続できませんでした', 'ネットワークの制限でつながらない場合があります。Wi-Fiとモバイル回線を切り替えるか、近くならQRで対戦してください。');
        }, 25000);
      } else if (m.t === 'ice') await l.addRemoteCandidate(m.c as RTCIceCandidateInit | null);
    };
    let expired = 0;
    r.onExpire = (peer) => {
      if (peer === hostId && !gotOffer) expired++;
    };
    r.onDrop = () => {
      if (!disposed && !connected && !gotOffer) fail('接続サーバーから切断されました', 'もう一度お試しください。');
    };
    // keep knocking: the host's page may be reconnecting after being in the background
    const knock = () => {
      if (gotOffer || disposed) return;
      tries++;
      r.send(hostId, { t: 'join', build: __BUILD_HASH__ });
      if (tries === 3 && expired) status('ルームを探しています…', '相手のページが閉じている／コードが違う可能性があります');
      if (tries > 9) fail('ルームが見つかりません', 'コードが正しいか、相手が「部屋を作る」の画面を開いたままか確認してください。');
    };
    knock();
    joinTimer = window.setInterval(knock, 2500);
  }
  void start();
  return {
    el,
    dispose: () => {
      if (!disposed) cleanup();
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
  let theirCtl = 0;
  let started = false;
  const myCtl = () => myControlModes();
  const ctlBits = (v: unknown) => (typeof v === 'number' ? v & 3 : 0);
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
    link.sendCtrl({ t: 'ready', v, c: mine, g: myCtl() });
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
    // each player's control settings (guard / attack direction; host = 1P) go into both simulations
    const guard: [number, number] = [myCtl(), theirCtl];
    link.sendCtrl({ t: 'start', chars: [mine, theirs], delay, guard });
    begin([mine, theirs], delay, guard);
  }

  function begin(chars: [number, number], delay: number, guard: [number, number]): void {
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
        controlModes: guard,
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
        theirCtl = ctlBits(m.g);
        if (theirReady) sfx.ui();
        break;
      case 'start': {
        const chars = m.chars as [number, number];
        const g = Array.isArray(m.guard) ? (m.guard as number[]) : [0, 0];
        begin(chars, m.delay as number, [ctlBits(g[0]), ctlBits(g[1])]);
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
