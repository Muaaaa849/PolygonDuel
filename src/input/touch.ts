// Touch controls (plan §4): left = floating virtual stick (release = guard),
// right = 4 buttons whose icons are the SHAPE the move will show.
// Presses are latched until the next tick reads them so a tap never gets lost.
//
// Aiming (Brawl Stars style): when a fresh attack / aimed skill is possible, ATK / S1 / S2
// become little sticks with two rings. Inside the inner ring (tap or hold) the move
// auto-targets the opponent; drag past it to aim freely (direction + how far to lunge),
// release to fire; drag far outside the outer ring to cancel.
// Everywhere else (chains, GC in blockstun, cancels) buttons fire the moment they're pressed.
import { h, shapeIcon } from '../app/ui';
import { settings } from '../app/settings';
import { placePx } from './layout';
import { AIM_DIRS, AIM_LEVELS, IN_ATK, IN_S1, IN_S2, IN_STEP, IN_STICK, aimBits, quantizeDir } from '../core/input';
import type { Shape } from '../data/types';

const DEADZONE = 0.18;
/** Frames the last direction is held when the thumb crosses the center (plan §4 hysteresis). */
const HYSTERESIS_TICKS = 2;

export type BtnId = 'atk' | 's1' | 's2' | 'step';

/** Live aim while a button is being dragged (screen-space unit vector, 0..1 reach). */
export interface AimState {
  id: BtnId;
  x: number;
  y: number;
  /** 0..1 drag distance → reach level. */
  frac: number;
  /** Inside the inner ring: auto-target the opponent (x / y / frac unused). */
  auto: boolean;
  /** Dragged far away: releasing will not fire. */
  cancel: boolean;
}

/** Inner ring radius (css px × button scale): inside = auto-target. */
const AIM_INNER = 34;
/** Drag distance for the full reach level (outer ring). */
const AIM_RANGE = 92;
/** Beyond this the aim is cancelled. */
const AIM_CANCEL = 170;
/** A hold inside the inner ring shows the auto-target preview after this long (ms), so taps don't flash. */
const AUTO_PREVIEW_MS = 140;
const BTN_BITS: Record<BtnId, number> = { atk: IN_ATK, s1: IN_S1, s2: IN_S2, step: IN_STEP };

export interface ButtonLook {
  shape: Shape;
  label: string;
  cost?: number;
}

export class TouchControls {
  el: HTMLElement;
  private stickEl: HTMLElement;
  private knob: HTMLElement;
  private knobIcon: HTMLElement;
  private stickHint: HTMLElement;
  private zone: HTMLElement;
  private btnWrap: HTMLElement;
  private btns: Record<BtnId, HTMLElement>;
  private held: Record<BtnId, Set<number>> = { atk: new Set(), s1: new Set(), s2: new Set(), step: new Set() };
  private latched = 0;
  private stickPointer = -1;
  private origin = { x: 0, y: 0 };
  private vec = { x: 0, y: 0 };
  private lastDir = -1;
  private centerTicks = 0;
  private pointerBtn = new Map<number, BtnId>();
  private homePos = { x: 0, y: 0 };
  private latchedAim = 0;
  /** Pointer currently aiming with a button (fires on release). */
  private aimPtr = -1;
  private aimStart = { x: 0, y: 0 };
  private aimPad: HTMLElement;
  private aimKnob: HTMLElement;
  private aimInner: HTMLElement;
  private aimT0 = 0;
  /** Should a press of this button aim (fire on release)? Decided at touch-down. */
  aimPolicy: (id: BtnId) => boolean = () => false;
  /** Anything touched at all (used to hide keyboard hints). */
  used = false;

  constructor() {
    this.knobIcon = h('div', { html: shapeIcon('hexagon', 'rgba(90,160,255,.9)') });
    this.knob = h('div', { class: 'knob' }, this.knobIcon);
    this.stickEl = h('div', { class: 'stick guarding' }, this.knob);
    this.stickHint = h('div', { class: 'stick-hint' }, '離す＝ガード');
    this.zone = h('div', { class: 'stick-zone' });
    const mk = (id: BtnId) => h('button', { class: `cbtn ${id}`, 'aria-label': id });
    this.btns = { atk: mk('atk'), s1: mk('s1'), s2: mk('s2'), step: mk('step') };
    this.btnWrap = h('div', { class: 'buttons' }, this.btns.s2, this.btns.step, this.btns.s1, this.btns.atk);
    this.aimKnob = h('div', { class: 'aim-knob' });
    this.aimInner = h('div', { class: 'aim-inner' }, h('span', null, 'AUTO'));
    this.aimPad = h('div', { class: 'aim-pad' }, this.aimInner, this.aimKnob);
    this.el = h('div', { class: `controls${settings.lefty ? ' lefty' : ''}` }, this.zone, this.stickEl, this.stickHint, this.btnWrap, this.aimPad);

    this.el.addEventListener('pointerdown', this.onDown, { passive: false });
    this.el.addEventListener('pointermove', this.onMove, { passive: false });
    this.el.addEventListener('pointerup', this.onUp);
    this.el.addEventListener('pointercancel', this.onUp);
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    requestAnimationFrame(() => this.resetStick());
    window.addEventListener('resize', this.resetStick);
    this.applyLayout();
  }

  setButtons(look: Record<BtnId, ButtonLook>): void {
    for (const id of Object.keys(look) as BtnId[]) {
      const l = look[id];
      const b = this.btns[id];
      b.innerHTML = '';
      b.append(h('span', { html: shapeIcon(l.shape, id === 'atk' ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.12)') }));
      b.append(h('span', { class: 'lbl' }, l.label));
      if (l.cost) {
        const c = h('span', { class: 'cost' });
        for (let i = 0; i < Math.ceil(l.cost); i++) c.append(h('i'));
        b.append(c);
      }
    }
  }

  /** Pulse a button to say "press now". */
  setPrompt(id: BtnId, on: boolean): void {
    this.btns[id].classList.toggle('prompt', on);
  }

  /** Reflect availability (cost / step stock) on the buttons. */
  setAvailability(av: Partial<Record<BtnId, 'ready' | 'ok' | 'off'>>): void {
    for (const id of Object.keys(av) as BtnId[]) {
      const b = this.btns[id];
      const v = av[id];
      b.classList.toggle('unavailable', v === 'off');
      b.classList.toggle('ready', v === 'ready');
    }
  }

  /** Custom layout (settings → ボタン配置): place every control where the player put it. */
  private applyLayout(): void {
    const L = settings.layout;
    this.el.classList.toggle('custom', !!L);
    for (const id of Object.keys(this.btns) as BtnId[]) {
      const st = this.btns[id].style;
      if (!L) {
        st.left = st.top = st.width = st.height = '';
        continue;
      }
      const { cx, cy, size } = placePx(L[id], id, window.innerWidth, window.innerHeight, settings.buttonScale);
      st.left = `${cx - size / 2}px`;
      st.top = `${cy - size / 2}px`;
      st.width = st.height = `${size}px`;
    }
    this.stickEl.style.setProperty('--stick-s', String(L?.stick.s ?? 1));
  }

  private isStickSide(x: number): boolean {
    const w = window.innerWidth;
    const L = settings.layout;
    // with a custom layout the stick owns the half of the screen its home is on
    const left = L ? L.stick.x < 0.5 : !settings.lefty;
    return left ? x < w * 0.48 : x > w * 0.52;
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.used = true;
    const x = e.clientX;
    const y = e.clientY;
    if (this.isStickSide(x) && this.stickPointer < 0 && y > window.innerHeight * 0.16) {
      this.stickPointer = e.pointerId;
      this.origin = { x, y };
      this.vec = { x: 0, y: 0 };
      this.placeStick(x, y);
      this.stickEl.style.opacity = '1';
      this.stickHint.style.opacity = '0';
    } else {
      const id = this.nearestButton(x, y);
      if (id && id !== 'step' && this.aimPtr < 0 && this.aimPolicy(id)) this.beginAim(e.pointerId, id, x, y);
      else if (id) this.pressBtn(e.pointerId, id);
    }
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId === this.stickPointer) {
      e.preventDefault();
      const r = this.radius();
      let dx = e.clientX - this.origin.x;
      let dy = e.clientY - this.origin.y;
      const len = Math.hypot(dx, dy);
      // drag the base along when the thumb overshoots (floating stick)
      if (len > r * 1.35) {
        const k = (len - r * 1.35) / len;
        this.origin.x += dx * k;
        this.origin.y += dy * k;
        this.placeStick(this.origin.x, this.origin.y);
        dx = e.clientX - this.origin.x;
        dy = e.clientY - this.origin.y;
      }
      this.vec = { x: dx / r, y: dy / r };
      this.updateKnob();
    } else if (e.pointerId === this.aimPtr) {
      e.preventDefault();
      this.moveAim(e.clientX, e.clientY);
    } else if (this.pointerBtn.has(e.pointerId)) {
      // slide between buttons
      const id = this.nearestButton(e.clientX, e.clientY, 1.0);
      const cur = this.pointerBtn.get(e.pointerId)!;
      if (id && id !== cur) {
        this.releaseBtn(e.pointerId);
        this.pressBtn(e.pointerId, id);
      }
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId === this.aimPtr) this.endAim(e.type !== 'pointercancel');
    if (e.pointerId === this.stickPointer) {
      this.stickPointer = -1;
      this.vec = { x: 0, y: 0 };
      this.lastDir = -1;
      this.resetStick();
    }
    this.releaseBtn(e.pointerId);
  };

  private pressBtn(pid: number, id: BtnId): void {
    this.pointerBtn.set(pid, id);
    this.held[id].add(pid);
    this.latched |= BTN_BITS[id];
    this.btns[id].classList.add('down');
  }

  private beginAim(pid: number, id: BtnId, x: number, y: number): void {
    this.aimPtr = pid;
    this.aimStart = { x, y };
    this.aimT0 = performance.now();
    this.aimState = { id, x: 0, y: 0, frac: 1, auto: true, cancel: false };
    this.btns[id].classList.add('down');
    const r = this.btns[id].getBoundingClientRect();
    const k = settings.buttonScale;
    this.aimPad.style.left = `${r.left + r.width / 2}px`;
    this.aimPad.style.top = `${r.top + r.height / 2}px`;
    this.aimPad.style.width = this.aimPad.style.height = `${AIM_RANGE * 2 * k}px`;
    this.aimInner.style.width = this.aimInner.style.height = `${AIM_INNER * 2 * k}px`;
    this.aimKnob.style.transform = 'translate(-50%, -50%)';
    this.aimPad.className = 'aim-pad';
  }

  /** Raw aim state (always set while aiming); `aim` hides the auto preview during a quick tap. */
  private aimState: AimState | null = null;

  get aim(): AimState | null {
    const a = this.aimState;
    if (!a) return null;
    if (a.auto && performance.now() - this.aimT0 < AUTO_PREVIEW_MS) return null;
    return a;
  }

  private moveAim(x: number, y: number): void {
    if (!this.aimState) return;
    const k = settings.buttonScale;
    const dx = x - this.aimStart.x;
    const dy = y - this.aimStart.y;
    const len = Math.hypot(dx, dy);
    const auto = len < AIM_INNER * k;
    const cancel = len > AIM_CANCEL * k;
    const frac = Math.max(0, Math.min(1, (len - AIM_INNER * k) / ((AIM_RANGE - AIM_INNER) * k)));
    // free aim is exactly where the thumb points (no snapping; the sim gets 256 directions)
    this.aimState = { id: this.aimState.id, x: len > 0 ? dx / len : 1, y: len > 0 ? dy / len : 0, frac: auto ? 1 : frac, auto, cancel };
    const shown = Math.min(len, AIM_RANGE * k);
    this.aimKnob.style.transform = `translate(calc(-50% + ${(dx / (len || 1)) * shown}px), calc(-50% + ${(dy / (len || 1)) * shown}px))`;
    this.aimPad.className = `aim-pad on${auto ? ' auto' : ''}${cancel ? ' cancel' : ''}`;
  }

  private endAim(fire: boolean): void {
    const a = this.aimState;
    this.aimPtr = -1;
    this.aimState = null;
    this.aimPad.className = 'aim-pad';
    if (!a) return;
    this.btns[a.id].classList.remove('down');
    if (!fire || a.cancel) return;
    this.latched |= BTN_BITS[a.id];
    // inside the inner ring: unaimed press → the sim auto-targets the opponent
    if (!a.auto) this.latchedAim = aimBits(quantizeDir(a.x, a.y, AIM_DIRS), Math.round(a.frac * (AIM_LEVELS - 1)));
  }

  /** Show the two rings once a hold lasts (called every frame by the battle loop). */
  tickAim(): void {
    if (this.aimState?.auto && !this.aimPad.classList.contains('on') && performance.now() - this.aimT0 >= AUTO_PREVIEW_MS) {
      this.aimPad.className = 'aim-pad on auto';
    }
  }

  private releaseBtn(pid: number): void {
    const id = this.pointerBtn.get(pid);
    if (!id) return;
    this.pointerBtn.delete(pid);
    this.held[id].delete(pid);
    if (this.held[id].size === 0) this.btns[id].classList.remove('down');
  }

  private nearestButton(x: number, y: number, slack = 1.7): BtnId | null {
    let best: BtnId | null = null;
    let bestD = Infinity;
    for (const id of Object.keys(this.btns) as BtnId[]) {
      const r = this.btns[id].getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.hypot(x - cx, y - cy) / (r.width / 2);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return bestD <= slack ? best : null;
  }

  private radius(): number {
    return 54 * settings.buttonScale * (settings.layout?.stick.s ?? 1);
  }

  private placeStick(x: number, y: number): void {
    this.stickEl.style.left = `${x}px`;
    this.stickEl.style.top = `${y}px`;
  }

  private resetStick = (): void => {
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    const s = settings.buttonScale;
    const L = settings.layout;
    if (L) {
      const p = placePx(L.stick, 'stick', w, hgt, s);
      this.homePos = { x: p.cx, y: p.cy };
    } else this.homePos = { x: settings.lefty ? w - 110 * s : 110 * s, y: hgt - 100 * s };
    this.applyLayout();
    if (this.stickPointer >= 0) return;
    this.placeStick(this.homePos.x, this.homePos.y);
    this.stickEl.style.opacity = '0.55';
    this.stickHint.style.left = `${this.homePos.x}px`;
    this.stickHint.style.top = `${this.homePos.y + 70 * s * (L?.stick.s ?? 1)}px`;
    this.stickHint.style.opacity = this.used ? '0' : '1';
    this.vec = { x: 0, y: 0 };
    this.updateKnob();
  };

  private updateKnob(): void {
    const len = Math.hypot(this.vec.x, this.vec.y);
    const k = len > 1 ? 1 / len : 1;
    const r = this.radius();
    this.knob.style.transform = `translate(${this.vec.x * k * r * 0.7}px, ${this.vec.y * k * r * 0.7}px)`;
    const neutral = len < DEADZONE;
    this.stickEl.classList.toggle('guarding', neutral);
    this.knobIcon.style.opacity = neutral ? '1' : '0';
  }

  /** Read the input word for this tick (clears latched presses). */
  poll(): number {
    let w = 0;
    const len = Math.hypot(this.vec.x, this.vec.y);
    if (this.stickPointer >= 0 && len >= DEADZONE) {
      this.lastDir = quantizeDir(this.vec.x, this.vec.y);
      this.centerTicks = 0;
      w |= IN_STICK | this.lastDir;
    } else if (this.stickPointer >= 0 && this.lastDir >= 0 && this.centerTicks < HYSTERESIS_TICKS) {
      // thumb passing through the center while still touching: keep direction briefly
      this.centerTicks++;
      w |= IN_STICK | this.lastDir;
    }
    for (const id of Object.keys(this.held) as BtnId[]) if (this.held[id].size > 0) w |= BTN_BITS[id];
    w |= this.latched | this.latchedAim;
    this.latched = 0;
    this.latchedAim = 0;
    return w;
  }

  dispose(): void {
    window.removeEventListener('resize', this.resetStick);
    this.el.remove();
  }
}
