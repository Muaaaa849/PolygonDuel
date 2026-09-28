// Fullscreen that survives leaving the page. Browsers drop fullscreen whenever the page is
// left (sending an invite in LINE, the share sheet, switching apps) and only allow entering it
// again from a user gesture. So we remember that the player chose fullscreen, tell apart
// "the browser dropped it because we left" from "the player exited it on purpose" (Esc / back
// while the page stays in front), and re-enter on the first tap or key after coming back.
//
// Stale fullscreen (v1.4.1): some Android browsers (Brave, Chrome) bring the address bar back
// while document.fullscreenElement stays set — the page still "is" fullscreen, so a plain
// requestFullscreen() does nothing and the 全画面 button looked dead. When fullscreen is set but
// the page is clearly not covering the screen, we exit and enter again (still inside the same
// gesture's activation window, which exitFullscreen doesn't consume).

const KEY = 'pd.fullscreen';
/** A fullscreen exit this close to leaving / coming back / a blur counts as the browser's doing. */
const GRACE_MS = 1500;

let wanted = read();
let lastAway = 0;
let busy = false;
/** The size check proved wrong on this device (still "not covering" right after a fresh enter): stop cycling on it. */
let coverageUnreliable = false;

function read(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function setWanted(v: boolean): void {
  wanted = v;
  try {
    if (v) sessionStorage.setItem(KEY, '1');
    else sessionStorage.removeItem(KEY);
  } catch {
    /* private mode: remember for this page only */
  }
}

/** The page really covers the screen (not just flagged fullscreen with browser bars on top). */
function covering(): boolean {
  const vw = window.visualViewport?.width ?? window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  // screen.width/height follow the orientation on mobile browsers; allow for cutouts / rounding
  return vw >= screen.width * 0.9 && vh >= screen.height * 0.9;
}

/** Fullscreen is set but the browser's bars are back. */
function stale(): boolean {
  return !!document.fullscreenElement && !coverageUnreliable && !covering();
}

function request(): Promise<void> {
  const el = document.documentElement;
  if (!document.fullscreenEnabled || !el.requestFullscreen) return Promise.resolve();
  return el
    .requestFullscreen()
    .then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.('landscape').catch(() => undefined))
    .catch(() => undefined);
}

/**
 * Get into (real) fullscreen: request it, or — when the browser still flags fullscreen but shows
 * its bars — leave and request again. `force` (the button) re-enters even when the size check
 * can't tell.
 */
function enter(force: boolean): void {
  if (busy || !document.fullscreenEnabled) return;
  const fs = !!document.fullscreenElement;
  if (fs && !force && !stale()) return;
  busy = true;
  const wasStale = fs && !covering();
  const go = fs ? document.exitFullscreen().catch(() => undefined).then(request) : request();
  void go.finally(() => {
    busy = false;
    // entered afresh yet still "not covering": the size check doesn't fit this device
    if (wasStale) setTimeout(() => {
      if (document.fullscreenElement && !covering()) coverageUnreliable = true;
    }, 1000);
  });
}

/** Title's 全画面 button: enter fullscreen (re-enter if it went stale) and keep it across app switches. */
export function enterFullscreen(): void {
  setWanted(true);
  enter(true);
}

export function fullscreenWanted(): boolean {
  return wanted;
}

/** Call before handing the page to another app (share sheet, LINE…): the exit that follows is not the player's. */
export function leavingPage(): void {
  lastAway = performance.now();
}

let installed = false;
export function installFullscreenKeeper(): void {
  if (installed) return;
  installed = true;
  const away = () => (lastAway = performance.now());
  document.addEventListener('visibilitychange', away);
  window.addEventListener('blur', away);
  window.addEventListener('pagehide', away);
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement || !wanted || busy) return;
    // exited while the page stayed in front (Esc, the back gesture) → the player's choice.
    // Decided a moment later: some browsers drop fullscreen just before the page is hidden.
    const t = performance.now();
    setTimeout(() => {
      if (!busy && !document.hidden && !document.fullscreenElement && lastAway < t - GRACE_MS) setWanted(false);
    }, 800);
  });
  // re-enter on the first gesture after coming back, or once the bars came back over a stale
  // fullscreen (only gestures may request fullscreen; touch activation comes with pointerup)
  const restore = () => {
    if (wanted && !document.hidden && (!document.fullscreenElement || stale())) enter(false);
  };
  window.addEventListener('pointerup', restore, true);
  window.addEventListener('keydown', restore, true);
}
