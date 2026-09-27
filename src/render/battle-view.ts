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
import { FxLayer, type FxHandle } from './fx-sprites';
import { app } from './pixi-app';
import { settings } from '../app/settings';

const PX = 100; // world pixels per u
const FW = SYSTEM.field.w * PX;
const FHt = SYSTEM.field.h * PX;
const VW = SYSTEM.view.w * PX;
const VH = SYSTEM.view.h * PX;
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
  // move-instance tracking for state-driven sprite effects
  lastMove = -1;
  lastSf = 0;
  instance = 0;
  slashFor = -1;
  skillFxFor = -1;
  lastPuff = 0;
  loops: Partial<Record<'danger' | 'stun' | 'breeze' | 'stance' | 'ja', FxHandle | null>> = {};
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
  fx = new FxLayer();
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
  /** Touch aim in progress (drawn as a highlighted range from the fighter). */
  aim: { who: number; slot: number; x: number; y: number; frac: number; cancel: boolean } | null = null;
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
    this.fx.root.sortableChildren = false;
    this.world.addChild(this.field, this.glow, this.bodies, this.fx.root, this.overlay, this.vfx.root, this.labels);
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
        const ang = Math.atan2(toPx(s.f[1 - e.who].y) - toPx(s.f[e.who].y), toPx(s.f[1 - e.who].x) - toPx(s.f[e.who].x));
        this.fx.spawn(heavy ? 'hit_heavy_t' : 'hit_t', { x, y, size: (heavy ? 3.2 : 2.2) * PX, tint: col, rot: ang, alpha: 0.8 });
        if (e.b & HF_COUNTER) this.fx.spawn('hit_heavy_t', { x, y, size: 2.6 * PX, tint: 0xffd060, rot: ang + 0.4 });
        if (heavy) {
          // 3rd hit: a ripple bursts out from the ATTACKER, plus dust where the defender lands
          const ax = toPx(s.f[e.who].x);
          const ay = toPx(s.f[e.who].y);
          this.fx.spawn('ripple_t', { x: ax, y: ay, size: 6 * PX, tint: col });
          this.fx.spawn('ripple_t', { x: ax, y: ay, size: 3.6 * PX, tint: 0xffffff, alpha: 0.7, speed: 1.3 });
          this.vfx.ring(ax, ay, col, 40, 330, 26, 12);
          this.wave(ax, ay, 1.3);
          this.flashScreen(col, 0.18);
        }
        if (this.moveIs(e.who, 'flareRush')) this.fx.spawn('flare', { x, y, size: 3.4 * PX });
        if (this.moveIs(e.who, 'galePierce')) this.fx.spawn('hit_heavy_t', { x, y, size: 2.4 * PX, tint: 0x9dffc8, alpha: 0.6, rot: ang });
        this.addShake(heavy ? 16 : 6);
        if (heavy) this.wave(x, y, 0.8);
        break;
      }
      case EV_BLOCK: {
        def.wobbleT = 0;
        def.wobbleAng = Math.atan2(toPx(s.f[e.who].y) - toPx(s.f[1 - e.who].y), toPx(s.f[e.who].x) - toPx(s.f[1 - e.who].x));
        this.vfx.spark(x, y, 0x9cc8ff, 6, 16, 18, 4, Math.PI * 0.9, def.wobbleAng);
        this.vfx.ring(x, y, 0x9cc8ff, 8, 40, 9, 4);
        {
          const df = s.f[1 - e.who];
          // honeycomb shield flash, impact side facing the attacker
          this.fx.spawn('guard_t', { x: toPx(df.x), y: toPx(df.y), size: 2.7 * PX, rot: def.wobbleAng, tint: mix(def.color, 0x9cc8ff, 0.55), speed: 0.6 });
        }
        this.addShake(3);
        break;
      }
      case EV_CRUSH:
      case EV_GUARD_BREAK: {
        const who = e.type === EV_CRUSH ? 1 - e.who : e.who;
        const f = s.f[who];
        const fx = toPx(f.x);
        const fy = toPx(f.y);
        this.vfx.shatter(fx, fy, this.fighters[who].color, 6, 18, 30);
        this.fx.spawn('crush', { x: fx, y: fy, size: 3.4 * PX, alpha: 0.75 });
        if (e.type === EV_CRUSH && this.moveIs(e.who, 'breakFang')) this.fx.spawn('fang', { x: fx, y: fy, size: 2.6 * PX, rot: s.f[e.who].facing * ANG_TO_RAD, speed: 1.6 });
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
        this.fx.spawn('hit_t', { x, y, size: 1.8 * PX, tint: 0xffd060 });
        def.flash = 2;
        break;
      case EV_JUST: {
        this.vfx.ring(x, y, 0x6ff3ff, 20, 260, 24, 8);
        this.vfx.ring(x, y, 0xffffff, 10, 160, 18, 4);
        this.vfx.glitter(x, y, 0x6ff3ff, 30, 12, 40, 5);
        this.vfx.text('JUST!', x, y - 100, 0x6ff3ff, 46, 60, -0.5);
        this.fx.spawn('just', { x, y, size: 4.2 * PX });
        this.chroma = 1;
        this.wave(x, y, 1.4);
        this.flashScreen(0x6ff3ff, 0.2);
        break;
      }
      case EV_RIPOSTE: {
        const f = s.f[e.who];
        this.vfx.spark(x, y, 0xffffff, 18, 34, 46, 7);
        this.vfx.ring(toPx(f.x), toPx(f.y), this.fighters[e.who].color, 30, 200, 20, 10);
        this.fx.spawn('riposte', { x: toPx(f.x), y: toPx(f.y), size: 3.6 * PX, rot: Math.atan2(y - toPx(f.y), x - toPx(f.x)) });
        this.fx.spawn('hit_heavy_t', { x, y, size: 3 * PX, tint: this.fighters[e.who].color });
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
        this.fx.spawn('dust', { x: toPx(f.x), y: toPx(f.y), size: 2.6 * PX, blend: 'normal', alpha: 0.8 });
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
        this.fx.spawn('ripple_t', { x: toPx(f.x), y: toPx(f.y), size: 3.4 * PX, tint: 0x9dffc8 });
        break;
      }
      case EV_KO: {
        const f = s.f[e.who];
        const fv = this.fighters[e.who];
        this.vfx.shatter(toPx(f.x), toPx(f.y), fv.color, 10, 22, 34);
        this.fx.spawn('ko', { x: toPx(f.x), y: toPx(f.y), size: 6 * PX, alpha: 0.85 });
        this.fx.spawn('ripple_t', { x: toPx(f.x), y: toPx(f.y), size: 8 * PX, tint: fv.color });
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

  private moveIs(i: number, id: string): boolean {
    return this.sim.moveOf(this.sim.s.f[i])?.id === id;
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
    for (let i = 0; i < 2; i++) this.stateFx(i, newFrame && !frozen);
    this.drawAim();

    this.vfx.update(dtFrames);
    this.fx.update(dtFrames);

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

  /** Sprite effects driven by state: swing smears, skill signatures, loops. */
  private stateFx(i: number, advanced: boolean): void {
    const s = this.sim.s;
    const f = s.f[i];
    const fv = this.fighters[i];
    const m = f.st === ST_ATTACK ? this.sim.moveOf(f) : null;
    if (f.st === ST_ATTACK && (f.move !== fv.lastMove || f.sf < fv.lastSf)) fv.instance++;
    fv.lastMove = f.st === ST_ATTACK ? f.move : -1;
    fv.lastSf = f.sf;
    const pos = () => {
      const ff = this.sim.s.f[i];
      return { x: toPx(ff.x), y: toPx(ff.y) };
    };
    const x = toPx(f.x);
    const y = toPx(f.y);
    const face = f.facing * ANG_TO_RAD;
    const cos = Math.cos(face);
    const sin = Math.sin(face);

    if (m) {
      const reach = (m.reach / 1000) * PX;
      // swing smear, spawned on the first active frame
      if (m.isSweep && f.sf >= m.S && f.sf < m.S + m.A && fv.slashFor !== fv.instance) {
        fv.slashFor = fv.instance;
        const spin = Math.abs(m.sweepTo - m.sweepFrom) >= 1024;
        const name = spin ? 'spin' : 'slash';
        const o = { x, y, size: reach * 2.08, rot: face, flipY: m.sweepFrom < 0, follow: pos };
        this.fx.spawn(`${name}_t`, { ...o, tint: fv.color, alpha: 0.7 });
        this.fx.spawn(`${name}_core`, { ...o, alpha: 0.45 });
      }
      const once = (atFrame: boolean, fn: () => void) => {
        if (atFrame && fv.skillFxFor !== fv.instance) {
          fv.skillFxFor = fv.instance;
          fn();
        }
      };
      switch (m.id) {
        case 'flareRush':
          if (advanced && f.sf >= 3 && f.sf < m.S + m.A && this.t - fv.lastPuff >= 2) {
            fv.lastPuff = this.t;
            this.fx.spawn('flare', { x: x - cos * 40, y: y - sin * 40, size: 2.6 * PX, rot: Math.random() * 6.28, speed: 1.2 });
          }
          break;
        case 'breakFang':
          once(f.sf >= m.S - 6, () => this.fx.spawn('fang', { x: x + cos * reach * 0.75, y: y + sin * reach * 0.75, size: 2.4 * PX, rot: face, speed: 1.1 }));
          break;
        case 'galePierce':
          once(f.sf >= m.S, () => this.fx.spawn('gale', { x, y, size: reach * 1.05, rot: face, follow: () => ({ ...pos(), rot: this.sim.s.f[i].facing * ANG_TO_RAD }) }));
          break;
        case 'shieldBash':
          once(f.sf >= m.S, () => this.fx.spawn('bash', { x: x + cos * 60, y: y + sin * 60, size: 3.2 * PX, rot: face }));
          break;
      }
    }
    // loops
    const loop = (key: 'danger' | 'stun' | 'breeze' | 'stance' | 'ja', on: boolean, spawn: () => FxHandle | null) => {
      const h = fv.loops[key];
      if (on && (!h || h.dead)) fv.loops[key] = spawn();
      else if (!on && h) {
        h.kill();
        fv.loops[key] = null;
      }
    };
    const dangerOn = !!m && !!m.gb && f.sf < m.S;
    loop('danger', dangerOn, () => this.fx.spawn('danger', { x, y, size: 2.6 * PX, rot: face, loop: true, follow: () => ({ ...pos(), rot: this.sim.s.f[i].facing * ANG_TO_RAD }) }));
    loop('stun', f.st === ST_STUN, () => this.fx.spawn('stun', { x, y, size: 2 * PX, loop: true, alpha: 0.85, follow: pos }));
    const casting = !!m && !!m.heal && f.sf < m.heal.frame;
    loop('breeze', casting || f.buff > 0, () => this.fx.spawn('breeze', { x, y, size: 2.9 * PX, loop: true, alpha: casting ? 1 : 0.55, follow: pos }));
    const stance = !!m && !!m.cs && f.sf >= m.cs.from && f.sf <= m.cs.to;
    // just-attack ready: attack now for a 1.5x JA
    loop('ja', f.justWin > 0, () => this.fx.spawn('charge_t', { x, y, size: 2.4 * PX, loop: true, tint: 0x6ff3ff, follow: pos }));
    loop('stance', stance, () => this.fx.spawn('guard_t', { x, y, size: 2.3 * PX, loop: true, alpha: 0.55, speed: 0.7, tint: 0xc8dcff, follow: pos }));
  }

  /**
   * Camera. Zoom 1 frames an SYSTEM.view-sized window (11u×6.2u) so pieces stay big;
   * the arena is larger, so the camera follows the fighters' midpoint, zooms in up to
   * 1.4× when they are close and out (down to the whole arena) when they are far,
   * and hard-guarantees both fighters stay on screen.
   */
  private updateCamera(dt: number): void {
    const s = this.sim.s;
    const sw = app.screen.width;
    const sh = app.screen.height;
    const top = this.topInset;
    const vh = Math.max(1, sh - top);
    const margin = 0.35 * PX;
    const fit = Math.min(sw / (VW + margin * 2), (vh - 8) / (VH + margin * 2));
    const minZoom = Math.min(1, Math.min(sw / (FW + margin * 2), vh / (FHt + margin * 2)) / fit);
    // (phones in landscape are wider than the 11:6.2 frame, so zoom 1 may already show the whole width)
    const [a, b] = s.f;
    const ax = toPx(a.x), ay = toPx(a.y), bx = toPx(b.x), by = toPx(b.y);
    const dx = Math.abs(ax - bx);
    const dy = Math.abs(ay - by);
    // largest zoom that still shows both fighters with some room (pad = u around each)
    const maxZoomFor = (pad: number) => Math.min(sw / ((dx + pad * 2 * PX) * fit), vh / ((dy + pad * 2 * PX) * fit));
    let zoom = 1;
    if (settings.dynamicCamera) {
      const dist = Math.hypot(ax - bx, ay - by) / PX;
      zoom = 1 + Math.max(0, Math.min(1, (6 - dist) / 4)) * 0.4;
    }
    zoom = Math.max(minZoom, Math.min(zoom, maxZoomFor(1.6)));
    if (!Number.isFinite(this.cam.zoom) || !Number.isFinite(this.cam.x) || !Number.isFinite(this.cam.y)) {
      this.cam = { x: (ax + bx) / 2, y: (ay + by) / 2, zoom };
    }
    // zoom out quickly (never lose a fighter), in gently
    const kz = 1 - Math.pow(zoom < this.cam.zoom ? 0.8 : 0.93, dt);
    this.cam.zoom += (zoom - this.cam.zoom) * kz;
    this.cam.zoom = Math.max(minZoom, Math.min(this.cam.zoom, Math.max(minZoom, maxZoomFor(0.9))));
    const scale = fit * this.cam.zoom;
    const halfW = sw / 2 / scale;
    const halfH = vh / 2 / scale;
    const k = 1 - Math.pow(0.86, dt);
    this.cam.x += ((ax + bx) / 2 - this.cam.x) * k;
    this.cam.y += ((ay + by) / 2 - this.cam.y) * k;
    // both fighters inside the view (0.9u padding), then the view inside the arena (+margin)
    const pad = 0.9 * PX;
    const keep = (c: number, lo: number, hi: number, half: number) => {
      const min = hi + pad - half;
      const max = lo - pad + half;
      return min <= max ? Math.max(min, Math.min(max, c)) : (lo + hi) / 2;
    };
    this.cam.x = keep(this.cam.x, Math.min(ax, bx), Math.max(ax, bx), halfW);
    this.cam.y = keep(this.cam.y, Math.min(ay, by), Math.max(ay, by), halfH);
    // the view may reach past the walls by `edge` so a cornered fighter (and the pips under it) stays visible
    const edge = 1.1 * PX;
    const clampC = (c: number, half: number, size: number) =>
      half * 2 >= size + edge * 2 ? size / 2 : Math.max(half - edge, Math.min(size + edge - half, c));
    this.cam.x = clampC(this.cam.x, halfW, FW);
    this.cam.y = clampC(this.cam.y, halfH, FHt);
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
    this.world.position.set(sw / 2 - this.cam.x * scale + this.shakeX, top + vh / 2 - this.cam.y * scale + this.shakeY);
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
      const danger = m.shape === SH.triangle;
      const col = danger ? 0xffd060 : 0xffffff;
      if (m.isSweep) {
        const from = a + m.sweepFrom * ANG_TO_RAD;
        const to = a + m.sweepTo * ANG_TO_RAD;
        const spin = Math.abs(m.sweepTo - m.sweepFrom) >= 1024;
        if (f.sf < m.S) {
          // telegraph: the fan it will cover fades in; the blade winds up on the starting side
          const p = Math.min(1, f.sf / (m.S - 1));
          const pts: number[] = [x, y];
          const steps = spin ? 48 : 16;
          for (let k = 0; k <= steps; k++) {
            const t = spin ? (k / steps) * Math.PI * 2 : from + ((to - from) * k) / steps;
            pts.push(x + Math.cos(t) * reach, y + Math.sin(t) * reach);
          }
          glow.poly(pts).fill({ color: fv.color, alpha: 0.05 + 0.13 * p });
          g.poly(pts.slice(2)).stroke({ width: 2.5, color: fv.color, alpha: 0.25 + 0.5 * p });
          const wind = from + (spin ? 0 : (from - to) * 0.15 * p);
          const len = edge + (reach - edge) * p;
          const wc = Math.cos(wind);
          const ws = Math.sin(wind);
          g.moveTo(x + wc * edge, y + ws * edge).lineTo(x + wc * len, y + ws * len).stroke({ width: 5, color: col, alpha: 0.5 + 0.45 * p, cap: 'round' });
        } else if (f.sf < m.S + m.A) {
          const cur = a + this.sim.swingAngle(m, f.sf) * ANG_TO_RAD;
          this.blade(g, glow, x, y, cur, edge, reach, fv.color, danger);
        }
        return;
      }
      if (f.sf < m.S) {
        // thrust telegraph: arrow grows from the body toward the reach as startup elapses
        const p = Math.min(1, f.sf / (m.S - 1));
        const len = edge + (reach - edge) * p;
        const w = danger ? 6 : 4;
        g.moveTo(x + cos * edge, y + sin * edge).lineTo(x + cos * len, y + sin * len).stroke({ width: w, color: col, alpha: 0.55 + 0.4 * p, cap: 'round' });
        this.arrowHead(g, x + cos * len, y + sin * len, a, 18, col, 0.9);
        g.moveTo(x + cos * len, y + sin * len).lineTo(x + cos * reach, y + sin * reach).stroke({ width: 2, color: col, alpha: 0.25 });
      } else if (f.sf < m.S + m.A) {
        this.blade(g, glow, x, y, a, edge, reach, fv.color, danger);
      } else {
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

  /**
   * Aim preview: the exact area the aimed move will cover — lunge / dash path, then the
   * swing fan (or thrust bar) from where the lunge ends. The opponent lights up when
   * they stand inside it right now.
   */
  private drawAim(): void {
    const a = this.aim;
    if (!a) return;
    const f = this.sim.s.f[a.who];
    const o = this.sim.s.f[1 - a.who];
    if (f.st === ST_KO || f.st === ST_ATTACK) return;
    const m = this.sim.char(a.who).moves[a.slot];
    if (!m) return;
    // show what the sim will get: 64 directions, 4 reach levels
    const q = (Math.round((Math.atan2(a.y, a.x) / (Math.PI * 2)) * 64) / 64) * Math.PI * 2;
    const pct = 40 + Math.round(a.frac * 3) * 20;
    const c = Math.cos(q);
    const sn = Math.sin(q);
    const x = toPx(f.x);
    const y = toPx(f.y);
    const lunge = (toPx(m.lunge) * pct) / 100;
    const reach = toPx(m.reach);
    const ex = x + c * lunge;
    const ey = y + sn * lunge;
    const col = a.cancel ? 0x8b97b9 : this.fighters[a.who].color;
    const pulse = 0.8 + 0.2 * Math.sin(this.t * 0.3);
    const gl = this.glow;
    const ov = this.overlay;
    const hurt = 0.5 * PX;
    let inside = false;
    // lunge / dash path
    if (lunge > 4) {
      const dashes = Math.max(2, Math.round(lunge / 22));
      for (let k = 0; k < dashes; k++) {
        const t0 = k / dashes;
        const t1 = t0 + 0.55 / dashes;
        ov.moveTo(x + c * lunge * t0, y + sn * lunge * t0).lineTo(x + c * lunge * t1, y + sn * lunge * t1);
      }
      ov.stroke({ width: 4, color: col, alpha: 0.7 * pulse, cap: 'round' });
      ov.circle(ex, ey, 0.5 * PX).stroke({ width: 2, color: col, alpha: 0.45 });
    }
    const ox = toPx(o.x);
    const oy = toPx(o.y);
    if (m.isSweep) {
      const spin = Math.abs(m.sweepTo - m.sweepFrom) >= 1024;
      const lo = q + Math.min(m.sweepFrom, m.sweepTo) * ANG_TO_RAD;
      const hi = q + Math.max(m.sweepFrom, m.sweepTo) * ANG_TO_RAD;
      const pts: number[] = [ex, ey];
      const steps = spin ? 48 : 18;
      for (let k = 0; k <= steps; k++) {
        const t = spin ? (k / steps) * Math.PI * 2 : lo + ((hi - lo) * k) / steps;
        pts.push(ex + Math.cos(t) * reach, ey + Math.sin(t) * reach);
      }
      gl.poly(pts).fill({ color: col, alpha: 0.2 * pulse });
      ov.poly(pts).stroke({ width: 3, color: col, alpha: 0.85, join: 'round' });
      const d = Math.hypot(ox - ex, oy - ey);
      if (d <= reach + hurt) {
        if (spin || d <= hurt) inside = true;
        else {
          const rel = Math.atan2(oy - ey, ox - ex) - q;
          const r = Math.atan2(Math.sin(rel), Math.cos(rel));
          const half = Math.asin(Math.min(1, hurt / d));
          inside = r >= (lo - q) - half && r <= (hi - q) + half;
        }
      }
    } else {
      const w = 0.32 * PX;
      const tx = ex + c * reach;
      const ty = ey + sn * reach;
      const px = -sn * w;
      const py = c * w;
      const bar = [ex + px, ey + py, tx + px, ty + py, tx - px, ty - py, ex - px, ey - py];
      gl.poly(bar).fill({ color: col, alpha: 0.28 * pulse });
      ov.poly(bar).stroke({ width: 3, color: col, alpha: 0.85, join: 'round' });
      this.arrowHead(ov, tx + c * 10, ty + sn * 10, q, 18, col, 0.9);
      // distance from the opponent to the thrust segment (body → tip, lunge included)
      const vx = tx - x;
      const vy = ty - y;
      const t = Math.max(0, Math.min(1, ((ox - x) * vx + (oy - y) * vy) / (vx * vx + vy * vy || 1)));
      inside = Math.hypot(ox - (x + vx * t), oy - (y + vy * t)) <= hurt;
    }
    if (inside && !a.cancel && o.st !== ST_KO) {
      const r = 0.72 * PX + Math.sin(this.t * 0.4) * 4;
      ov.circle(ox, oy, r).stroke({ width: 4, color: 0xffffff, alpha: 0.9 });
      gl.circle(ox, oy, r).stroke({ width: 14, color: col, alpha: 0.35 });
    }
  }

  /** The active hitbox bar (white core + colored body + glow). */
  private blade(g: Graphics, glow: Graphics, x: number, y: number, ang: number, edge: number, reach: number, color: number, danger: boolean): void {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const x0 = x + c * edge;
    const y0 = y + s * edge;
    const x1 = x + c * reach;
    const y1 = y + s * reach;
    glow.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 34, color, alpha: 0.5, cap: 'round' });
    g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 16, color: danger ? 0xffd060 : color, alpha: 1, cap: 'round' });
    g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 6, color: 0xffffff, alpha: 1, cap: 'round' });
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
