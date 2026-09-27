// Touch controls (plan §4): left = floating virtual stick (release = guard),
// right = 4 buttons whose icons are the SHAPE the move will show.
// Presses are latched until the next tick reads them so a tap never gets lost.
//
// Aiming (Brawl Stars style): when a fresh attack / aimed skill is possible, ATK / S1 / S2
// become little sticks — drag to aim (direction + how far to lunge), release to fire;
// a plain tap fires on release with auto-aim; dragging back to the center cancels.
// Everywhere else (chains, GC in blockstun, cancels) buttons fire the moment they're pressed.
import { h, shapeIcon } from '../app/ui';
import { settings } from '../app/settings';
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
  /** Dragged back to the center: releasing will not fire. */
  cancel: boolean;
}

/** Drag (css px, × button scale) before a press turns into aiming; also the cancel zone. */
const AIM_DEAD = 18;
/** Drag distance for the full reach level. */
const AIM_RANGE = 78;
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
  /** Current aim (null when not aiming). Read by the battle view to draw the range. */
  aim: AimState | null = null;
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
    this.aimPad = h('div', { class: 'aim-pad' }, this.aimKnob);
    this.el = h('div', { class: `controls${settings.lefty ? ' lefty' : ''}` }, this.zone, this.stickEl, this.stickHint, this.btnWrap, this.aimPad);

    this.el.addEventListener('pointerdown', this.onDown, { passive: false });
    this.el.addEventListener('pointermove', this.onMove, { passive: false });
    this.el.addEventListener('pointerup', this.onUp);
    this.el.addEventListener('pointercancel', this.onUp);
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    requestAnimationFrame(() => this.resetStick());
    window.addEventListener('resize', this.resetStick);
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

  /** Reflect availability (cost / step stock) on the buttons. */
  setAvailability(av: Partial<Record<BtnId, 'ready' | 'ok' | 'off'>>): void {
    for (const id of Object.keys(av) as BtnId[]) {
      const b = this.btns[id];
      const v = av[id];
      b.classList.toggle('unavailable', v === 'off');
      b.classList.toggle('ready', v === 'ready');
    }
  }

  private isStickSide(x: number): boolean {
    const w = window.innerWidth;
    return settings.lefty ? x > w * 0.52 : x < w * 0.48;
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
    this.aim = { id, x: 0, y: 0, frac: 0, cancel: false };
    this.aiming = false;
    this.btns[id].classList.add('down');
    const r = this.btns[id].getBoundingClientRect();
    const k = settings.buttonScale;
    this.aimPad.style.left = `${r.left + r.width / 2}px`;
    this.aimPad.style.top = `${r.top + r.height / 2}px`;
    this.aimPad.style.width = this.aimPad.style.height = `${AIM_RANGE * 2 * k}px`;
    this.aimKnob.style.transform = 'translate(-50%, -50%)';
    this.aimPad.className = 'aim-pad';
  }

  /** Aim becomes live once the thumb leaves the dead zone. */
  private aiming = false;

  private moveAim(x: number, y: number): void {
    if (!this.aim) return;
    const k = settings.buttonScale;
    const dx = x - this.aimStart.x;
    const dy = y - this.aimStart.y;
    const len = Math.hypot(dx, dy);
    if (!this.aiming && len < AIM_DEAD * k) return;
    this.aiming = true;
    const cancel = len < AIM_DEAD * k;
    const frac = Math.max(0, Math.min(1, (len - AIM_DEAD * k) / ((AIM_RANGE - AIM_DEAD) * k)));
    this.aim = { id: this.aim.id, x: len > 0 ? dx / len : 1, y: len > 0 ? dy / len : 0, frac, cancel };
    const shown = Math.min(len, AIM_RANGE * k);
    this.aimKnob.style.transform = `translate(calc(-50% + ${(dx / (len || 1)) * shown}px), calc(-50% + ${(dy / (len || 1)) * shown}px))`;
    this.aimPad.className = `aim-pad on${cancel ? ' cancel' : ''}`;
  }

  private endAim(fire: boolean): void {
    const a = this.aim;
    this.aimPtr = -1;
    this.aim = null;
    this.aimPad.className = 'aim-pad';
    if (!a) return;
    this.btns[a.id].classList.remove('down');
    if (!fire || (this.aiming && a.cancel)) return;
    this.latched |= BTN_BITS[a.id];
    // a plain tap (never left the dead zone) fires unaimed → auto-target as before
    if (this.aiming) this.latchedAim = aimBits(quantizeDir(a.x, a.y, AIM_DIRS), Math.round(a.frac * (AIM_LEVELS - 1)));
    this.aiming = false;
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
    return 54 * settings.buttonScale;
  }

  private placeStick(x: number, y: number): void {
    this.stickEl.style.left = `${x}px`;
    this.stickEl.style.top = `${y}px`;
  }

  private resetStick = (): void => {
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    const s = settings.buttonScale;
    this.homePos = { x: settings.lefty ? w - 110 * s : 110 * s, y: hgt - 100 * s };
    if (this.stickPointer >= 0) return;
    this.placeStick(this.homePos.x, this.homePos.y);
    this.stickEl.style.opacity = '0.55';
    this.stickHint.style.left = `${this.homePos.x}px`;
    this.stickHint.style.top = `${this.homePos.y + 70 * s}px`;
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
