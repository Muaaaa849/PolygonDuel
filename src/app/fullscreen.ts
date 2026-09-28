// Fullscreen that survives leaving the page. Browsers drop fullscreen whenever the page is
// left (sending an invite in LINE, the share sheet, switching apps) and only allow entering it
// again from a user gesture. So we remember that the player chose fullscreen, tell apart
// "the browser dropped it because we left" from "the player exited it on purpose" (Esc / back
// while the page stays in front), and re-enter on the first tap or key after coming back.

const KEY = 'pd.fullscreen';
/** A fullscreen exit this close to leaving / coming back / a blur counts as the browser's doing. */
const GRACE_MS = 1500;

let wanted = read();
let lastAway = 0;

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

function request(): void {
  if (document.fullscreenElement || !document.fullscreenEnabled) return;
  void document.documentElement
    .requestFullscreen?.()
    .then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.('landscape').catch(() => undefined))
    .catch(() => undefined);
}

/** Title's 全画面 button: enter fullscreen and keep it across app switches. */
export function enterFullscreen(): void {
  setWanted(true);
  request();
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
    if (document.fullscreenElement || !wanted) return;
    // exited while the page stayed in front (Esc, the back gesture) → the player's choice.
    // Decided a moment later: some browsers drop fullscreen just before the page is hidden.
    const t = performance.now();
    setTimeout(() => {
      if (!document.hidden && !document.fullscreenElement && lastAway < t - GRACE_MS) setWanted(false);
    }, 800);
  });
  // re-enter on the first gesture after coming back (only gestures may request fullscreen;
  // touch activation comes with pointerup, not pointerdown)
  const restore = () => {
    if (wanted && !document.hidden && !document.fullscreenElement) request();
  };
  window.addEventListener('pointerup', restore, true);
  window.addEventListener('keydown', restore, true);
}
