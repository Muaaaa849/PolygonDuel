// Keyboard + gamepad input (PC testing and local 2P, plan §12 phase 3).
import { IN_ATK, IN_S1, IN_S2, IN_STEP, IN_STICK, IN_GUARD, quantizeDir } from '../core/input';
import { settings } from '../app/settings';

export type KeyAction = 'up' | 'down' | 'left' | 'right' | 'atk' | 's1' | 's2' | 'step' | 'guard';
export const KEY_ACTIONS: KeyAction[] = ['up', 'down', 'left', 'right', 'atk', 's1', 's2', 'step', 'guard'];
export const KEY_ACTION_LABELS: Record<KeyAction, string> = {
  up: '上', down: '下', left: '左', right: '右', atk: '攻撃', s1: 'スキル1', s2: 'スキル2', step: 'ステップ', guard: 'ガード（手動の時）',
};

/** Codes per action: KeyboardEvent.code, or 'Mouse0' / 'Mouse1' / 'Mouse2' for mouse buttons. */
export type KeyMap = Record<KeyAction, string[]>;

/** Key sets: one player (CPU, training, online), and the two sides of local 2P. */
export type KeySet = 'solo' | 'p1' | 'p2';

export const KEYS_SOLO: KeyMap = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  atk: ['KeyJ', 'Mouse0'],
  s1: ['KeyK', 'Mouse2'],
  s2: ['KeyL', 'KeyE'],
  step: ['Space', 'ShiftLeft'],
  guard: ['KeyU', 'KeyQ'],
};

export const KEYS_P1: KeyMap = {
  up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
  atk: ['KeyF'], s1: ['KeyG'], s2: ['KeyH'], step: ['ShiftLeft', 'Space'], guard: ['KeyT'],
};

export const KEYS_P2: KeyMap = {
  up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
  atk: ['Comma', 'Numpad1'], s1: ['Period', 'Numpad2'], s2: ['Slash', 'Numpad3'], step: ['ShiftRight', 'Numpad0'], guard: ['KeyM', 'Numpad4'],
};

export const DEFAULT_KEYS: Record<KeySet, KeyMap> = { solo: KEYS_SOLO, p1: KEYS_P1, p2: KEYS_P2 };

/** The bindings in use for a key set: the player's own (settings) over the defaults. */
export function keysFor(set: KeySet): KeyMap {
  const own = settings.keys?.[set];
  const out = {} as KeyMap;
  for (const a of KEY_ACTIONS) out[a] = (own?.[a] ?? DEFAULT_KEYS[set][a]).slice(0, 2);
  return out;
}

const KEY_NAMES: Record<string, string> = {
  Space: 'Space', ShiftLeft: '左Shift', ShiftRight: '右Shift', ControlLeft: '左Ctrl', ControlRight: '右Ctrl', AltLeft: '左Alt', AltRight: '右Alt',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', Tab: 'Tab', CapsLock: 'Caps',
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`',
  Mouse0: '左クリック', Mouse1: 'ホイールクリック', Mouse2: '右クリック', Mouse3: 'マウス戻る', Mouse4: 'マウス進む',
};

/** Short display name of a binding code. */
export function keyLabel(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `テンキー${code.slice(6)}`;
  return code;
}

const down = new Set<string>();
const pressedSince = new Set<string>();
let installed = false;
/** Pads the page has seen. Browsers only expose a pad after it is used on the page (and fire
 *  gamepadconnected then), so until one shows up there is nothing to poll 60 times a second. */
let pads = 0;

function install(): void {
  if (installed) return;
  installed = true;
  // (a pad used on the title before the first battle is already exposed: count it too)
  pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean).length : 0;
  window.addEventListener('gamepadconnected', () => pads++);
  window.addEventListener('gamepaddisconnected', () => (pads = Math.max(0, pads - 1)));
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (!down.has(e.code)) pressedSince.add(e.code);
    down.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => down.delete(e.code));
  // mouse buttons count as keys ('Mouse0' …) — only on the battle field itself, never on menus,
  // buttons or the on-screen touch controls (when those are shown, the mouse drives them instead)
  const onField = (t: EventTarget | null) =>
    t instanceof Element && !!t.closest('.battle, canvas') && !t.closest('button, input, a, .modal-back, .controls, .hud, .train-bar');
  window.addEventListener('mousedown', (e) => {
    if (!onField(e.target)) return;
    const c = `Mouse${e.button}`;
    if (!down.has(c)) pressedSince.add(c);
    down.add(c);
  });
  window.addEventListener('mouseup', (e) => down.delete(`Mouse${e.button}`));
  window.addEventListener('contextmenu', (e) => {
    if (onField(e.target)) e.preventDefault();
  });
  window.addEventListener('blur', () => down.clear());
}

export class KeyboardInput {
  used = false;
  private map: KeyMap;
  constructor(set: KeySet, private pad: number | null = 0) {
    this.map = keysFor(set);
    install();
  }

  private any(codes: string[]): boolean {
    return codes.some((c) => down.has(c) || pressedSince.has(c));
  }

  poll(): number {
    const m = this.map;
    let x = (this.any(m.right) ? 1 : 0) - (this.any(m.left) ? 1 : 0);
    let y = (this.any(m.down) ? 1 : 0) - (this.any(m.up) ? 1 : 0);
    let w = 0;
    if (this.any(m.atk)) w |= IN_ATK;
    if (this.any(m.s1)) w |= IN_S1;
    if (this.any(m.s2)) w |= IN_S2;
    if (this.any(m.step)) w |= IN_STEP;
    if (this.any(m.guard)) w |= IN_GUARD;
    // gamepad
    if (this.pad !== null && pads > 0 && navigator.getGamepads) {
      const gp = navigator.getGamepads()[this.pad];
      if (gp) {
        const ax = gp.axes[0] ?? 0;
        const ay = gp.axes[1] ?? 0;
        if (Math.hypot(ax, ay) > 0.3) {
          x = ax;
          y = ay;
        }
        const b = (i: number) => !!gp.buttons[i]?.pressed;
        if (b(14)) x = -1;
        if (b(15)) x = 1;
        if (b(12)) y = -1;
        if (b(13)) y = 1;
        if (b(0) || b(7)) w |= IN_ATK;
        if (b(2) || b(4)) w |= IN_S1;
        if (b(3) || b(5)) w |= IN_S2;
        if (b(1)) w |= IN_STEP;
        if (b(6)) w |= IN_GUARD; // LT
      }
    }
    if (x !== 0 || y !== 0) w |= IN_STICK | quantizeDir(x, y);
    if (w) this.used = true;
    return w;
  }

  /** Call once per tick after all keyboards polled. */
  static endTick(): void {
    pressedSince.clear();
  }
}
