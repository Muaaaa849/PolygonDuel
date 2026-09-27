// Battle scene: field, fighters (shape morph, arrow → bar, guard wobble), effects, camera.
import { Container, Graphics, Text } from 'pixi.js';
import { AdvancedBloomFilter, RGBSplitFilter, ShockwaveFilter } from 'pixi-filters';
import type { Sim } from '../core/sim';
import { SH, M_STRIKE, COST_UNIT } from '../core/compile';
import { SYSTEM } from '../data/system';
import {
  ST_FREE, ST_ATTACK, ST_BLOCKSTUN, ST_HITSTUN, ST_STEP, ST_DOWN, ST_WAKE, ST_STUN, ST_KO, PH_INTRO,
  type FighterState,
} from '../core/state';
import {
  type SimEvent, EV_HIT, EV_BLOCK, EV_CRUSH, EV_GUARD_BREAK, EV_GB_OPEN, EV_JUST, EV_RIPOSTE, EV_KNOCKDOWN,
  EV_STEP, EV_HEAL, EV_KO, EV_MOVE, HF_COUNTER, HF_JA, HF_OTG,
} from '../core/events';
import { Morph, SHAPE_RADII, toPoints } from './shapes';
import { Vfx } from './vfx';
import { app } from './pixi-app';
import { settings } from '../app/settings';

const PX = 100; // world pixels per u
const FW = SYSTEM.field.w * PX;
const FHt = SYSTEM.field.h * PX;
const toPx = (milli: number) => (milli / 1000) * PX;
const ANG_TO_RAD = (Math.PI * 2) / 1024;

export interface ViewOptions {
  /** Which player is "you" (-1: none, e.g. local 2P). */
  local: 0 | 1 | -1;
  tags: [string, string];
  showHitboxes?: boolean;
}

export type Quality = 'high' | 'mid' | 'low';

function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

class FighterView {
  morph: Morph;
  shape: number = SH.square;
  lastShape: number = SH.square;
  flash = 0;
  wobbleT = 999;
  wobbleAng = 0;
  shakeT = 0;
  ghosts: { x: number; y: number; rot: number; radii: Float32Array; life: number }[] = [];
  trail: { x: number; y: number; ex: number; ey: number; life: number }[] = [];
  pts: number[] = [];
  label: Text;
  scaleNow = 1;

  constructor(public idx: number, public color: number, tag: string) {
    this.morph = new Morph(SH.square);
    this.label = new Text({
      text: tag,
      style: { fontFamily: 'Chakra Petch, sans-serif', fontWeight: '700', fontSize: 22, fill: color, letterSpacing: 2, stroke: { color: 0x05070d, width: 5 } },
    });
    this.label.anchor.set(0.5, 1);
    this.label.resolution = 3;
  }
}

export class BattleView {
  root = new Container();
  private world = new Container();
  private field = new Container();
  private fieldG = new Graphics();
  private fieldFx = new Graphics();
  private bodies = new Graphics();
  private glow = new Graphics();
  private overlay = new Graphics();
  private labels = new Container();
  vfx = new Vfx();
  private fighters: FighterView[];
  private cam = { x: FW / 2, y: FHt / 2, zoom: 1 };
  private shake = 0;
  private shakeX = 0;
  private shakeY = 0;
  private screenFlash = 0;
  private screenFlashColor = 0xffffff;
  private chroma = 0;
  private bloom: AdvancedBloomFilter | null = null;
  private rgb: RGBSplitFilter;
  private waves: ShockwaveFilter[] = [];
  private flashG = new Graphics();
  quality: Quality = 'high';
  showHitboxes: boolean;
  /** Top inset reserved for the DOM HUD (css px). */
  topInset = 58;
  private t = 0;
  private lastFrame = -1;

  constructor(private sim: Sim, private opts: ViewOptions) {
    this.showHitboxes = !!opts.showHitboxes;
    const cA = sim.char(0).def;
    const cB = sim.char(1).def;
    const colA = cA.color;
    const colB = cA.id === cB.id ? cB.altColor : cB.color;
    this.fighters = [new FighterView(0, colA, opts.tags[0]), new FighterView(1, colB, opts.tags[1])];
    this.glow.blendMode = 'add';
    this.fieldFx.blendMode = 'add';
    this.field.addChild(this.fieldG, this.fieldFx);
    this.world.addChild(this.field, this.glow, this.bodies, this.overlay, this.vfx.root, this.labels);
    for (const f of this.fighters) this.labels.addChild(f.label);
    this.root.addChild(this.world, this.flashG);
    this.rgb = new RGBSplitFilter({ red: [0, 0], green: [0, 0], blue: [0, 0] });
    this.rgb.resolution = app.renderer.resolution;
    this.drawField();
    // auto: start at mid on touch devices (phones), high elsewhere; adjusted by measured frame time
    const touch = matchMedia('(pointer: coarse)').matches;
    this.setQuality(settings.quality === 'auto' ? (touch ? 'mid' : 'high') : settings.quality);
  }

  colorOf(i: number): number {
    return this.fighters[i].color;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.vfx.density = q === 'high' ? 1 : q === 'mid' ? 0.7 : 0.45;
    if (q === 'low') this.bloom = null;
    else {
      this.bloom = new AdvancedBloomFilter({
        threshold: 0.32,
        bloomScale: q === 'high' ? 1.0 : 0.8,
        brightness: 1,
        blur: q === 'high' ? 7 : 5,
        quality: q === 'high' ? 5 : 3,
      });
      // render filters at device resolution on high so edges stay crisp
      this.bloom.resolution = q === 'high' ? app.renderer.resolution : 1;
      this.bloom.antialias = 'on';
    }
    this.applyFilters();
  }

  private applyFilters(): void {
    const f = [];
    if (this.bloom) f.push(this.bloom);
    if (this.chroma > 0.05 && !settings.reduceFlash) f.push(this.rgb);
    this.world.filters = f.length ? f : null;
    this.field.filters = this.waves.length ? this.waves : null;
  }

  mount(): void {
    app.stage.addChild(this.root);
  }

  destroy(): void {
    this.root.removeFromParent();
    this.root.destroy({ children: true });
  }

  private drawField(): void {
    const g = this.fieldG;
    g.clear();
    g.rect(-400, -400, FW + 800, FHt + 800).fill({ color: 0x05070d, alpha: 0.35 });
    g.rect(0, 0, FW, FHt).fill({ color: 0x0b1224, alpha: 0.85 });
    for (let x = 0; x <= SYSTEM.field.w; x++) {
      g.moveTo(x * PX, 0).lineTo(x * PX, FHt);
    }
    for (let y = 0; y <= SYSTEM.field.h; y++) {
      g.moveTo(0, y * PX).lineTo(FW, y * PX);
    }
    g.stroke({ width: 1.5, color: 0x6f8cff, alpha: 0.09 });
    g.moveTo(FW / 2, 0).lineTo(FW / 2, FHt).stroke({ width: 2, color: 0x6f8cff, alpha: 0.14 });
    g.circle(FW / 2, FHt / 2, 1.5 * PX).stroke({ width: 2, color: 0x6f8cff, alpha: 0.12 });
    // neon border
    g.rect(0, 0, FW, FHt).stroke({ width: 10, color: 0x6ff3ff, alpha: 0.08 });
    g.rect(0, 0, FW, FHt).stroke({ width: 3, color: 0x6ff3ff, alpha: 0.55 });
    // corner brackets
    const c = 60;
    for (const [x, y, sx, sy] of [[0, 0, 1, 1], [FW, 0, -1, 1], [0, FHt, 1, -1], [FW, FHt, -1, -1]]) {
      g.moveTo(x + sx * c, y).lineTo(x, y).lineTo(x, y + sy * c).stroke({ width: 6, color: 0xb9f8ff, alpha: 0.9 });
    }
  }

  // ───────────── events → effects ─────────────

  handle(e: SimEvent): void {
    const x = toPx(e.x);
    const y = toPx(e.y);
    const s = this.sim.s;
    const att = this.fighters[e.who];
    const def = this.fighters[1 - e.who];
    const col = att?.color ?? 0xffffff;
    switch (e.type) {
      case EV_HIT: {
        const heavy = this.sim.moveOf(s.f[e.who])?.knockdown ?? false;
        def.flash = 3;
        this.vfx.spark(x, y, col, heavy ? 14 : 9, heavy ? 30 : 22, heavy ? 40 : 28, heavy ? 7 : 5);
        this.vfx.ring(x, y, 0xffffff, 10, heavy ? 120 : 70, heavy ? 16 : 11, heavy ? 8 : 5);
        this.vfx.text(String(e.a), x + (Math.random() - 0.5) * 30, y - 40, 0xffffff, heavy ? 38 : 30);
        const combo = (e.b >> 8) + 1;
        if (e.b & HF_COUNTER) this.vfx.text('COUNTER', x, y - 90, 0xffd060, 30, 50, -0.7);
        else if (e.b & HF_JA && combo === 1) this.vfx.text('JUST ATTACK', x, y - 90, 0x6ff3ff, 28, 50, -0.7);
        else if (e.b & HF_OTG) this.vfx.text('DOWN ATTACK', x, y - 90, col, 24, 44, -0.7);
        if (combo >= 2) this.vfx.text(`${combo} HIT`, toPx(s.f[1 - e.who].x), toPx(s.f[1 - e.who].y) - 120, col, 26, 40, -0.4);
        this.addShake(heavy ? 12 : 5);
        if (heavy) this.wave(x, y, 0.8);
        break;
      }
      case EV_BLOCK: {
        def.wobbleT = 0;
        def.wobbleAng = Math.atan2(toPx(s.f[e.who].y) - toPx(s.f[1 - e.who].y), toPx(s.f[e.who].x) - toPx(s.f[1 - e.who].x));
        this.vfx.spark(x, y, 0x9cc8ff, 6, 16, 18, 4, Math.PI * 0.9, def.wobbleAng);
        this.vfx.ring(x, y, 0x9cc8ff, 8, 40, 9, 4);
        this.addShake(2);
        break;
      }
      case EV_CRUSH:
      case EV_GUARD_BREAK: {
        const who = e.type === EV_CRUSH ? 1 - e.who : e.who;
        const f = s.f[who];
        const fx = toPx(f.x);
        const fy = toPx(f.y);
        this.vfx.shatter(fx, fy, this.fighters[who].color, 6, 18, 30);
        this.vfx.ring(fx, fy, 0xffd060, 20, 180, 20, 10);
        this.vfx.spark(fx, fy, 0xffd060, 16, 30, 40, 6);
        this.vfx.text(e.type === EV_CRUSH ? 'CRUSH!' : 'GUARD BREAK', fx, fy - 100, 0xffd060, 40, 56, -0.6);
        this.flashScreen(0xffd060, 0.35);
        this.addShake(14);
        this.wave(fx, fy, 1.2);
        this.fighters[who].flash = 4;
        break;
      }
      case EV_GB_OPEN:
        this.vfx.spark(x, y, 0xffd060, 6, 16, 20, 4);
        this.vfx.text(String(e.a), x, y - 40, 0xffd060, 26);
        def.flash = 2;
        break;
      case EV_JUST: {
        this.vfx.ring(x, y, 0x6ff3ff, 20, 260, 24, 8);
        this.vfx.ring(x, y, 0xffffff, 10, 160, 18, 4);
        this.vfx.glitter(x, y, 0x6ff3ff, 30, 12, 40, 5);
        this.vfx.text('JUST!', x, y - 100, 0x6ff3ff, 46, 60, -0.5);
        this.chroma = 1;
        this.wave(x, y, 1.4);
        this.flashScreen(0x6ff3ff, 0.2);
        break;
      }
      case EV_RIPOSTE: {
        const f = s.f[e.who];
        this.vfx.spark(x, y, 0xffffff, 18, 34, 46, 7);
        this.vfx.ring(toPx(f.x), toPx(f.y), this.fighters[e.who].color, 30, 200, 20, 10);
        this.vfx.text('REVERSAL', x, y - 100, this.fighters[e.who].color, 38, 56, -0.6);
        this.vfx.text(String(e.a), x, y - 40, 0xffffff, 36);
        this.flashScreen(0xffffff, 0.35);
        this.addShake(12);
        this.wave(x, y, 1);
        break;
      }
      case EV_KNOCKDOWN: {
        const f = s.f[e.who];
        this.vfx.ring(toPx(f.x), toPx(f.y), 0x9aa6c8, 20, 90, 18, 4);
        break;
      }
      case EV_STEP: {
        const f = s.f[e.who];
        this.vfx.glitter(toPx(f.x), toPx(f.y), this.fighters[e.who].color, 6, 3, 18, 3);
        break;
      }
      case EV_HEAL: {
        const f = s.f[e.who];
        this.vfx.rise(toPx(f.x), toPx(f.y), 0x9dffc8, 22);
        this.vfx.ring(toPx(f.x), toPx(f.y), 0x9dffc8, 30, 110, 24, 5);
        this.vfx.text(`+${e.a}`, toPx(f.x), toPx(f.y) - 70, 0x9dffc8, 32);
        break;
      }
      case EV_KO: {
        const f = s.f[e.who];
        const fv = this.fighters[e.who];
        this.vfx.shatter(toPx(f.x), toPx(f.y), fv.color, 10, 22, 34);
        this.vfx.ring(toPx(f.x), toPx(f.y), 0xffffff, 20, 360, 34, 12);
        this.flashScreen(0xffffff, 0.6);
        this.addShake(20);
        this.wave(toPx(f.x), toPx(f.y), 2);
        break;
      }
      case EV_MOVE: {
        const f = s.f[e.who];
        const m = this.sim.moveOf(f);
        if (m && e.a !== M_STRIKE && m.kind === 1) this.vfx.text('GC', toPx(f.x), toPx(f.y) - 80, 0x9cc8ff, 26, 34, -0.8);
        this.fighters[e.who].morph.kick(SHAPE_RADII[this.shapeOf(f)]);
        break;
      }
    }
  }

  private addShake(px: number): void {
    this.shake = Math.max(this.shake, px);
  }

  private flashScreen(color: number, a: number): void {
    if (settings.reduceFlash) a *= 0.25;
    this.screenFlash = Math.max(this.screenFlash, a);
    this.screenFlashColor = color;
  }

  private wave(x: number, y: number, power: number): void {
    if (this.quality === 'low' || this.waves.length >= 3) return;
    const w = new ShockwaveFilter({ center: { x: 0, y: 0 }, amplitude: 18 * power, wavelength: 90, speed: 700, brightness: 1.15, radius: 380 * power });
    (w as unknown as { _wx: number; _wy: number })._wx = x;
    (w as unknown as { _wx: number; _wy: number })._wy = y;
    this.waves.push(w);
    this.applyFilters();
  }

  // ───────────── per-frame render ─────────────

  shapeOf(f: FighterState): number {
    switch (f.st) {
      case ST_FREE:
        return f.guardF >= 1 ? SH.hexagon : SH.square;
      case ST_ATTACK: {
        const m = this.sim.moveOf(f);
        return m ? m.shape : SH.square;
      }
      case ST_BLOCKSTUN:
        return SH.hexagon;
      case ST_STEP:
        return SH.arrow;
      case ST_STUN:
        return SH.star;
      default:
        return SH.square;
    }
  }

  render(dtFrames: number): void {
    this.t += dtFrames;
    const s = this.sim.s;
    const newFrame = s.frame !== this.lastFrame;
    this.lastFrame = s.frame;
    const frozen = s.hitstop > 0 || s.freeze > 0;

    this.updateCamera(dtFrames);

    const glow = this.glow;
    const g = this.bodies;
    const ov = this.overlay;
    glow.clear();
    g.clear();
    ov.clear();
    this.fieldFx.clear();

    // hitbox trails & ghosts first (under bodies)
    for (let i = 0; i < 2; i++) this.drawTrail(i, dtFrames, newFrame && !frozen);
    for (let i = 0; i < 2; i++) this.drawFighter(i, dtFrames, frozen);

    this.vfx.update(dtFrames);

    // shockwaves
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.time += dtFrames / 60;
      const p = this.field.toGlobal({ x: (w as unknown as { _wx: number })._wx, y: (w as unknown as { _wy: number })._wy });
      w.centerX = p.x;
      w.centerY = p.y;
      if (w.time > 0.7) {
        this.waves.splice(i, 1);
        this.applyFilters();
      }
    }
    // chroma (just dodge) decays 6px → 0 over ~20F
    if (this.chroma > 0) {
      this.chroma = Math.max(0, this.chroma - dtFrames / 22);
      const px = 6 * this.chroma;
      this.rgb.red = { x: -px, y: 0 };
      this.rgb.green = { x: 0, y: px * 0.5 };
      this.rgb.blue = { x: px, y: 0 };
      if (this.chroma <= 0.05) this.applyFilters();
      else if (!this.world.filters?.includes(this.rgb)) this.applyFilters();
    }
    // screen flash
    const fg = this.flashG;
    fg.clear();
    if (this.screenFlash > 0.01) {
      fg.rect(0, 0, app.screen.width, app.screen.height).fill({ color: this.screenFlashColor, alpha: this.screenFlash });
      this.screenFlash *= Math.pow(0.82, dtFrames);
    }
    if (s.freeze > 0 && !settings.reduceFlash) {
      // just-dodge freeze: desaturate-ish dim + vignette
      fg.rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0x0a1a2a, alpha: 0.25 });
    }
    if (s.phase === PH_INTRO) {
      fg.rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0x000000, alpha: 0.15 });
    }
  }

  private updateCamera(dt: number): void {
    const s = this.sim.s;
    const sw = app.screen.width;
    const sh = app.screen.height;
    const top = this.topInset;
    const margin = 0.35 * PX;
    const fit = Math.min(sw / (FW + margin * 2), (sh - top - 8) / (FHt + margin * 2));
    const [a, b] = s.f;
    const ax = toPx(a.x), ay = toPx(a.y), bx = toPx(b.x), by = toPx(b.y);
    let zoom = 1;
    let cx = FW / 2;
    let cy = FHt / 2;
    if (settings.dynamicCamera) {
      const dist = Math.hypot(ax - bx, ay - by) / PX;
      zoom = 1 + Math.max(0, Math.min(1, (7 - dist) / 5)) * 0.28;
      // keep both fighters (+margin) in view
      const needW = (Math.abs(ax - bx) + 3.2 * PX) * fit;
      const needH = (Math.abs(ay - by) + 3.0 * PX) * fit;
      zoom = Math.min(zoom, Math.max(1, (sw / needW) * 1), Math.max(1, ((sh - top) / needH) * 1));
      cx = (ax + bx) / 2;
      cy = (ay + by) / 2;
    }
    const k = 1 - Math.pow(0.9, dt);
    this.cam.zoom += (zoom - this.cam.zoom) * k;
    const scale = fit * this.cam.zoom;
    // clamp center so the view never leaves the field (+margin)
    const halfW = sw / 2 / scale;
    const halfH = (sh - top) / 2 / scale;
    const clampC = (c: number, half: number, size: number) =>
      half * 2 >= size + margin * 2 ? size / 2 : Math.max(half - margin, Math.min(size + margin - half, c));
    cx = clampC(cx, halfW, FW);
    cy = clampC(cy, halfH, FHt);
    this.cam.x += (cx - this.cam.x) * k;
    this.cam.y += (cy - this.cam.y) * k;
    // shake
    if (this.shake > 0.3) {
      this.shakeX = (Math.random() - 0.5) * this.shake * 2;
      this.shakeY = (Math.random() - 0.5) * this.shake * 2;
      this.shake *= Math.pow(0.8, dt);
    } else {
      this.shakeX = this.shakeY = 0;
      this.shake = 0;
    }
    this.world.scale.set(scale);
    this.world.position.set(sw / 2 - this.cam.x * scale + this.shakeX, top + (sh - top) / 2 - this.cam.y * scale + this.shakeY);
  }

  private drawTrail(i: number, dt: number, record: boolean): void {
    const fv = this.fighters[i];
    const f = this.sim.s.f[i];
    const tip = this.sim.hitboxOf(f);
    if (tip && record) {
      const ex = toPx(f.x) + Math.cos(f.facing * ANG_TO_RAD) * 0.5 * PX;
      const ey = toPx(f.y) + Math.sin(f.facing * ANG_TO_RAD) * 0.5 * PX;
      fv.trail.push({ x: toPx(tip.x), y: toPx(tip.y), ex, ey, life: 10 });
      if (Math.random() < 0.8 * this.vfx.density) this.vfx.glitter(toPx(tip.x), toPx(tip.y), fv.color, 2, 3, 16, 3);
    }
    for (let k = fv.trail.length - 1; k >= 0; k--) {
      fv.trail[k].life -= dt;
      if (fv.trail[k].life <= 0) fv.trail.splice(k, 1);
    }
    // additive band between consecutive tip positions
    const tr = fv.trail;
    for (let k = 1; k < tr.length; k++) {
      const a = tr[k - 1];
      const b = tr[k];
      const al = (b.life / 10) * 0.45;
      this.glow.poly([a.ex, a.ey, a.x, a.y, b.x, b.y, b.ex, b.ey]).fill({ color: fv.color, alpha: al * 0.5 });
      this.glow.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 6, color: 0xffffff, alpha: al });
    }
  }

  private drawFighter(i: number, dt: number, frozen: boolean): void {
    const s = this.sim.s;
    const f = s.f[i];
    const fv = this.fighters[i];
    const g = this.bodies;
    const glow = this.glow;
    const x = toPx(f.x);
    const y = toPx(f.y);
    const shape = this.shapeOf(f);
    fv.shape = shape;
    if (shape !== fv.lastShape) {
      fv.morph.kick(SHAPE_RADII[shape]);
      fv.lastShape = shape;
    }
    fv.morph.step(SHAPE_RADII[shape]);
    const char = this.sim.char(i);

    let rot = f.facing * ANG_TO_RAD;
    if (f.st === ST_STEP) rot = f.moveDir * ANG_TO_RAD;

    // guard: hexagon shrinks with the gauge (100% → 45%)
    let scale = 1;
    if (shape === SH.hexagon && (f.st !== ST_ATTACK)) {
      const ratio = Math.max(0, f.guardQ / char.guardMaxQ);
      scale = SYSTEM.guard.minScale + (1 - SYSTEM.guard.minScale) * ratio;
    }
    if (f.st === ST_DOWN) scale = 0.8;
    fv.scaleNow += (scale - fv.scaleNow) * (1 - Math.pow(0.7, dt));

    // wobble on block: r(θ,t) = r0(θ)(1 + A e^(−t/τ) sin(ωt) cos(k(θ−θhit)))
    fv.wobbleT += frozen ? dt * 0.5 : dt;
    const wt = fv.wobbleT;
    const wob =
      wt < 30
        ? (_i: number, a: number) => 1 + 0.12 * Math.exp(-wt / 8) * Math.sin(((Math.PI * 2) / 5) * wt) * Math.cos(3 * (a + rot - fv.wobbleAng))
        : undefined;

    // hit shake during hitstop
    let ox = 0;
    let oy = 0;
    if ((f.st === ST_HITSTUN || f.st === ST_STUN || f.st === ST_BLOCKSTUN) && s.hitstop > 0) {
      ox = (Math.random() - 0.5) * 10;
      oy = (Math.random() - 0.5) * 10;
    }

    let alpha = 1;
    if (f.st === ST_DOWN) alpha = 0.55;
    if (f.st === ST_WAKE) alpha = Math.floor(this.t / 3) % 2 ? 0.35 : 0.85;
    if (f.st === ST_KO) alpha = 0;

    // ghosts (step afterimages)
    if (f.st === ST_STEP && f.sf <= SYSTEM.step.moveFrames && !frozen) {
      if (Math.floor(this.t) % 2 === 0) fv.ghosts.push({ x, y, rot, radii: Float32Array.from(fv.morph.r), life: 12 });
    }
    const maxGhosts = this.quality === 'low' ? 2 : 4;
    while (fv.ghosts.length > maxGhosts) fv.ghosts.shift();
    for (let k = fv.ghosts.length - 1; k >= 0; k--) {
      const gh = fv.ghosts[k];
      gh.life -= dt;
      if (gh.life <= 0) {
        fv.ghosts.splice(k, 1);
        continue;
      }
      const pts = toPoints(gh.radii, gh.x, gh.y, gh.rot, PX, []);
      glow.poly(pts).fill({ color: fv.color, alpha: (gh.life / 12) * 0.25 });
    }

    if (alpha > 0) {
      const pts = toPoints(fv.morph.r, x + ox, y + oy, rot, PX * fv.scaleNow, fv.pts, wob);
      const flash = fv.flash > 0;
      if (fv.flash > 0) fv.flash -= dt;
      const bodyColor = flash ? 0xffffff : fv.color;
      // outer glow
      glow.poly(pts).fill({ color: fv.color, alpha: 0.18 * alpha });
      // guard low warning / triangle flashing edge
      let stroke = mix(fv.color, 0xffffff, 0.65);
      let strokeW = 5;
      if (shape === SH.triangle && Math.floor(f.sf / 3) % 2 === 0) {
        stroke = 0xffe070;
        strokeW = 9;
      }
      const lowGuard = shape === SH.hexagon && f.guardQ / char.guardMaxQ < 0.3 && f.st !== ST_ATTACK;
      if (lowGuard && Math.floor(this.t / 5) % 2 === 0) stroke = 0xff5a6e;
      g.poly(pts).fill({ color: bodyColor, alpha: 0.92 * alpha }).stroke({ width: strokeW, color: stroke, alpha, join: 'round' });
      // inner highlight
      const inner = toPoints(fv.morph.r, x + ox, y + oy, rot, PX * fv.scaleNow * 0.55, [], wob);
      g.poly(inner).fill({ color: 0xffffff, alpha: 0.12 * alpha });
      if (shape === SH.pentagon && f.st === ST_ATTACK) {
        glow.circle(x, y, 70 + Math.sin(this.t * 0.4) * 10).fill({ color: 0x9dffc8, alpha: 0.15 });
      }
    }

    // stun: little triangles orbiting overhead
    if (f.st === ST_STUN) {
      for (let k = 0; k < 3; k++) {
        const a = this.t * 0.12 + (k * Math.PI * 2) / 3;
        const sx = x + Math.cos(a) * 46;
        const sy = y - 78 + Math.sin(a) * 14;
        const tp: number[] = [];
        for (let j = 0; j < 3; j++) {
          const b = -Math.PI / 2 + (j * Math.PI * 2) / 3 + this.t * 0.2;
          tp.push(sx + Math.cos(b) * 11, sy + Math.sin(b) * 11);
        }
        glow.poly(tp).fill({ color: 0xffd060, alpha: 0.95 });
      }
    }

    this.drawDirection(i, x, y);
    this.drawPips(i, x, y);

    // tag label above
    fv.label.position.set(x, y - 0.95 * PX);
    fv.label.alpha = f.st === ST_KO ? 0 : this.opts.local === -1 || this.opts.local === i ? 1 : 0.75;

    if (this.showHitboxes) {
      this.overlay.circle(x, y, 0.5 * PX).stroke({ width: 2, color: 0x58f0a0, alpha: 0.8 });
      const tip = this.sim.hitboxOf(f);
      if (tip) this.overlay.moveTo(x, y).lineTo(toPx(tip.x), toPx(tip.y)).stroke({ width: 4, color: 0xff3050, alpha: 0.9 });
    }
  }

  /** Facing arrow; during startup it grows toward the reach, while active it is a bar. */
  private drawDirection(i: number, x: number, y: number): void {
    const f = this.sim.s.f[i];
    const fv = this.fighters[i];
    if (f.st === ST_KO || f.st === ST_DOWN || f.st === ST_WAKE) return;
    const a = f.facing * ANG_TO_RAD;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const g = this.bodies;
    const glow = this.glow;
    const m = f.st === ST_ATTACK ? this.sim.moveOf(f) : null;
    if (m && m.hasHitbox) {
      const edge = 0.52 * PX;
      const reach = (m.reach / 1000) * PX;
      if (f.sf < m.S) {
        // telegraph: arrow grows from the body toward the reach as startup elapses
        const p = Math.min(1, f.sf / (m.S - 1));
        const len = edge + (reach - edge) * p;
        const w = m.shape === SH.triangle ? 5 : 3.5;
        const col = m.shape === SH.triangle ? 0xffd060 : 0xffffff;
        g.moveTo(x + cos * edge, y + sin * edge).lineTo(x + cos * len, y + sin * len).stroke({ width: w, color: col, alpha: 0.55 + 0.4 * p, cap: 'round' });
        this.arrowHead(g, x + cos * len, y + sin * len, a, 16, col, 0.9);
        // faint full-reach guide
        g.moveTo(x + cos * len, y + sin * len).lineTo(x + cos * reach, y + sin * reach).stroke({ width: 1.5, color: col, alpha: 0.18 });
      } else if (f.sf < m.S + m.A) {
        // active: solid bar
        glow.moveTo(x + cos * edge, y + sin * edge).lineTo(x + cos * reach, y + sin * reach).stroke({ width: 26, color: fv.color, alpha: 0.5, cap: 'round' });
        g.moveTo(x + cos * edge, y + sin * edge).lineTo(x + cos * reach, y + sin * reach).stroke({ width: 13, color: m.shape === SH.triangle ? 0xffd060 : fv.color, alpha: 1, cap: 'round' });
        g.moveTo(x + cos * edge, y + sin * edge).lineTo(x + cos * reach, y + sin * reach).stroke({ width: 5, color: 0xffffff, alpha: 1, cap: 'round' });
      } else {
        // recovery: bar retracts & fades
        const k = Math.max(0, 1 - (f.sf - m.S - m.A) / 10);
        if (k > 0) {
          const len = edge + (reach - edge) * k;
          g.moveTo(x + cos * edge, y + sin * edge).lineTo(x + cos * len, y + sin * len).stroke({ width: 8 * k + 1, color: fv.color, alpha: 0.6 * k, cap: 'round' });
        }
      }
      return;
    }
    if (f.st === ST_STEP) return; // the arrow shape itself points the way
    // idle facing chevron
    const d = 0.82 * PX;
    this.arrowHead(g, x + cos * d, y + sin * d, a, 13, mix(fv.color, 0xffffff, 0.5), 0.85);
  }

  private arrowHead(g: Graphics, x: number, y: number, a: number, size: number, color: number, alpha: number): void {
    const c = Math.cos(a);
    const s = Math.sin(a);
    g.poly([x + c * size, y + s * size, x - c * size * 0.6 - s * size * 0.7, y - s * size * 0.6 + c * size * 0.7, x - c * size * 0.6 + s * size * 0.7, y - s * size * 0.6 - c * size * 0.7]).fill({ color, alpha });
  }

  /** In-world resources: cost diamonds + step chevrons under each fighter (read your opponent without looking away). */
  private drawPips(i: number, x: number, y: number): void {
    const f = this.sim.s.f[i];
    if (f.st === ST_KO) return;
    const g = this.overlay;
    const by = y + 0.86 * PX;
    const n = SYSTEM.cost.max;
    const w = 20;
    const start = x - ((n - 1) * w) / 2 - 14;
    for (let k = 0; k < n; k++) {
      const cx = start + k * w;
      const fill = Math.max(0, Math.min(1, f.cost / COST_UNIT - k));
      const r = 7;
      g.poly([cx, by - r, cx + r, by, cx, by + r, cx - r, by]).stroke({ width: 2, color: 0xffc048, alpha: 0.55 });
      if (fill > 0) {
        const rr = r * (fill >= 1 ? 1 : 0.55);
        g.poly([cx, by - rr, cx + rr, by, cx, by + rr, cx - rr, by]).fill({ color: 0xffc048, alpha: fill >= 1 ? 1 : 0.7 });
      }
    }
    // steps
    const sx = start + n * w + 4;
    for (let k = 0; k < SYSTEM.step.maxStock; k++) {
      const cx = sx + k * 12;
      const on = k < f.steps;
      g.poly([cx - 4, by - 7, cx + 4, by, cx - 4, by + 7, cx, by]).fill({ color: on ? 0x58f0a0 : 0x56607e, alpha: on ? 0.95 : 0.4 });
    }
  }
}
