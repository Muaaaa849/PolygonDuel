// Keyboard + gamepad input (PC testing and local 2P, plan §12 phase 3).
import { IN_ATK, IN_S1, IN_S2, IN_STEP, IN_STICK, IN_GUARD, quantizeDir } from '../core/input';

export interface KeyMap {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  atk: string[];
  s1: string[];
  s2: string[];
  step: string[];
  /** Manual guard (used only when the guard setting is 'manual'). */
  guard: string[];
}

export const KEYS_SOLO: KeyMap = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  atk: ['KeyJ', 'KeyZ'],
  s1: ['KeyK', 'KeyX'],
  s2: ['KeyL', 'KeyC'],
  step: ['Space', 'Semicolon', 'ShiftLeft'],
  guard: ['KeyU', 'KeyV'],
};

export const KEYS_P1: KeyMap = {
  up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
  atk: ['KeyF'], s1: ['KeyG'], s2: ['KeyH'], step: ['ShiftLeft', 'Space'], guard: ['KeyT'],
};

export const KEYS_P2: KeyMap = {
  up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
  atk: ['Comma', 'Numpad1'], s1: ['Period', 'Numpad2'], s2: ['Slash', 'Numpad3'], step: ['ShiftRight', 'Numpad0'], guard: ['KeyM', 'Numpad4'],
};

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
  window.addEventListener('blur', () => down.clear());
}

export class KeyboardInput {
  used = false;
  constructor(private map: KeyMap, private pad: number | null = 0) {
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
