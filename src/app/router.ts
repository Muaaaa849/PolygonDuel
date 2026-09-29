// Screen stack with enter/leave transitions.
import { bgm, type Track } from '../audio/bgm';

export interface Screen {
  el: HTMLElement;
  /** Called when the screen is removed. */
  dispose?: () => void;
  /** Hardware back / Escape. Return true if handled. */
  onBack?: () => boolean;
  /** Music for this screen (default: menu). */
  bgm?: Track;
}

let current: Screen | null = null;

export function show(next: Screen): void {
  const ui = document.getElementById('ui')!;
  const prev = current;
  current = next;
  bgm.play(next.bgm ?? 'menu');
  if (prev) {
    prev.dispose?.();
    prev.el.classList.add('leaving');
    setTimeout(() => prev.el.remove(), 180);
  }
  // any open modal belongs to the previous screen
  ui.querySelectorAll('.modal-back').forEach((m) => m.remove());
  ui.append(next.el);
}

export function currentScreen(): Screen | null {
  return current;
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') current?.onBack?.();
});
