// Battle scene: field, fighters (shape morph, arrow → bar, guard wobble), effects, camera.
import { Application, ColorMatrixFilter, Container, Graphics, Text } from 'pixi.js';
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
  EV_STEP, EV_HEAL, EV_KO, EV_MOVE, EV_WALL, EV_BLINK, EV_GHOST, EV_GHOST_END, HF_COUNTER, HF_JA, HF_OTG,
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
  /** Pixi application to draw into (default: the main one). The move-sheet demo uses its own. */
  host?: Application;
  /** Extra camera zoom (small canvases like the move-sheet demo). */
  zoom?: number;
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
  /** Arena edge, redrawn every frame so wall impacts can ripple along it. */
  private borderG = new Graphics();
  private borderAtRest = false;
  private wallWaves: { p0: number; t: number; amp: number; color: number }[] = [];
  private streaks: { x0: number; y0: number; x1: number; y1: number; life: number; color: number }[] = [];
  /** Just-dodge slow motion: monochrome world, impact frames. */
  private mono = new ColorMatrixFilter();
  private monoAmt = 0;
  private impactFrames = 0;
  private bodies = new Graphics();
  private glow = new Graphics();
  private overlay = new Graphics();
  private labels = new Container();
  vfx = new Vfx();
  fx = new FxLayer();
  /** 0/1 = the fighters, 2/3 = their illusion decoys (Phantom's S1). */
  private fighters: FighterView[];
  /** Decoys are drawn into their own layers so their opacity can depend on who is watching. */
  private ghostLayer = new Container();
  private ghostGlow = new Graphics();
  private ghostBodies = new Graphics();
  private ghostOverlay = new Graphics();
  private ghostDrawn = false;
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
  private flashDrawn = false;
  quality: Quality = 'high';
  showHitboxes: boolean;
  /** Top inset reserved for the DOM HUD (css px). */
  topInset = 58;
  /** Touch aim in progress (drawn as a highlighted range from the fighter). */
  aim: { who: number; slot: number; x: number; y: number; frac: number; auto: boolean; cancel: boolean } | null = null;
  private t = 0;
  private lastFrame = -1;

  private host: Application;

  constructor(private sim: Sim, private opts: ViewOptions) {
    this.host = opts.host ?? app;
    this.showHitboxes = !!opts.showHitboxes;
    const cA = sim.char(0).def;
    const cB = sim.char(1).def;
    const colA = cA.color;
    const colB = cA.id === cB.id ? cB.altColor : cB.color;
    this.fighters = [
      new FighterView(0, colA, opts.tags[0]), new FighterView(1, colB, opts.tags[1]),
      new FighterView(0, colA, opts.tags[0]), new FighterView(1, colB, opts.tags[1]),
    ];
    this.ghostGlow.blendMode = 'add';
    this.ghostLayer.addChild(this.ghostGlow, this.ghostBodies, this.ghostOverlay);
    this.glow.blendMode = 'add';
    this.field.addChild(this.fieldG, this.borderG);
    this.mono.desaturate();
    this.fx.root.sortableChildren = false;
    this.world.addChild(this.field, this.glow, this.bodies, this.ghostLayer, this.fx.root, this.overlay, this.vfx.root, this.labels);
    for (const f of this.fighters) this.labels.addChild(f.label);
    this.root.addChild(this.world, this.flashG);
    this.rgb = new RGBSplitFilter({ red: [0, 0], green: [0, 0], blue: [0, 0] });
    this.rgb.resolution = this.host.renderer.resolution;
    this.drawField();
    // auto: start at mid on touch devices (phones), high elsewhere; adjusted by measured frame time
    const touch = matchMedia('(pointer: coarse)').matches;
    this.setQuality(settings.quality === 'auto' ? (touch ? 'mid' : 'high') : settings.quality);
  }

  /** Fighter i (0/1), or the decoy of fighter i-2 (2/3; null when there is none). */
  private fOf(i: number): FighterState | null {
    return i < 2 ? this.sim.s.f[i] : this.sim.decoyOf(i - 2);
  }

  private fvOf(i: number): FighterView {
    return this.fighters[i];
  }

  /** Does the viewer own fighter i (sees through its illusion)? Local 2P sees everything. */
  private owns(i: number): boolean {
    return this.opts.local === -1 || this.opts.local === i;
  }

  /** The real fighter is invisible to the opponent while its illusion is out. */
  hidden(i: number): boolean {
    return this.sim.s.f[i].ghostT > 0 && !this.owns(i);
  }

  /** Cost as this viewer should see it (the opponent can't tell the illusion was paid for). */
  shownCost(i: number): number {
    const f = this.sim.s.f[i];
    if (f.ghostT <= 0 || this.owns(i)) return f.cost;
    const g = this.sim.char(i).moves.find((m) => m.ghost);
    return Math.min(SYSTEM.cost.max * COST_UNIT, f.cost + (g?.cost ?? 0));
  }

  colorOf(i: number): number {
    return this.fighters[i].color;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.vfx.density = q === 'high' ? 1 : q === 'mid' ? 0.7 : 0.45;
    const old = this.bloom;
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
      this.bloom.resolution = q === 'high' ? this.host.renderer.resolution : 1;
      this.bloom.antialias = 'on';
    }
    this.applyFilters();
    old?.destroy();
  }

  private applyFilters(): void {
    const f = [];
    if (this.bloom) f.push(this.bloom);
    if (this.chroma > 0.05 && !settings.reduceFlash) f.push(this.rgb);
    if (this.monoAmt > 0.01) f.push(this.mono);
    this.world.filters = f.length ? f : null;
    this.field.filters = this.waves.length ? this.waves : null;
  }

  mount(): void {
    this.host.stage.addChild(this.root);
  }

  destroy(): void {
    this.root.removeFromParent();
    this.fx.destroy();
    this.root.destroy({ children: true });
    // filters are not children: free them too (a view is made per battle / per move demo)
    for (const f of [this.bloom, this.rgb, this.mono, ...this.waves]) f?.destroy();
    this.waves.length = 0;
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
    // (the neon border itself is drawn per frame in drawBorder)
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
        // Soul Ripper crushes with its own violet claws instead of the generic yellow shatter
        const ripper = e.type === EV_CRUSH && this.moveIs(e.who, 'soulRipper');
        const accent = ripper ? 0xd9a8ff : 0xffd060;
        if (ripper) {
          this.fx.spawn('reaper', { x: fx, y: fy, size: 4.2 * PX, rot: s.f[e.who].facing * ANG_TO_RAD, speed: 0.9, alpha: 0.9 });
          this.fx.spawn('ghost_fade', { x: fx, y: fy, size: 2.4 * PX, alpha: 0.45 });
        } else this.fx.spawn('crush', { x: fx, y: fy, size: 3.4 * PX, alpha: 0.75 });
        if (e.type === EV_CRUSH && this.moveIs(e.who, 'breakFang')) this.fx.spawn('fang', { x: fx, y: fy, size: 2.6 * PX, rot: s.f[e.who].facing * ANG_TO_RAD, speed: 1.6 });
        this.vfx.ring(fx, fy, accent, 20, 180, 20, 10);
        this.vfx.spark(fx, fy, accent, 16, 30, 40, 6);
        this.vfx.text(e.type === EV_CRUSH ? 'CRUSH!' : 'GUARD BREAK', fx, fy - 100, accent, 40, 56, -0.6);
        this.flashScreen(accent, ripper ? 0.22 : 0.35);
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
        // time nearly stops: impact frame + heavy chromatic split, a big ripple from the
        // dodger, then the world goes monochrome in slow motion until ATK (→ blink JA)
        const f = s.f[e.who];
        const fx0 = toPx(f.x);
        const fy0 = toPx(f.y);
        this.vfx.ring(fx0, fy0, 0x6ff3ff, 20, 420, 40, 10);
        this.vfx.ring(fx0, fy0, 0xffffff, 10, 240, 30, 5);
        this.vfx.glitter(fx0, fy0, 0x6ff3ff, 40, 14, 60, 5);
        this.vfx.text('JUST!', fx0, fy0 - 110, 0x6ff3ff, 54, 70, -0.4);
        this.vfx.text('ATTACK ▶', fx0, fy0 + 120, 0xffffff, 26, 70, -0.2);
        this.fx.spawn('just', { x: fx0, y: fy0, size: 5.2 * PX });
        this.fx.spawn('ripple_t', { x: fx0, y: fy0, size: 9 * PX, tint: 0x6ff3ff, alpha: 0.8, speed: 0.6 });
        this.impactFrames = settings.reduceFlash ? 0 : 3;
        this.chroma = settings.reduceFlash ? 0.5 : 2.4;
        this.addShake(10);
        this.bigWave(fx0, fy0);
        break;
      }
      case EV_WALL: {
        // knocked into the arena edge: the edge ripples out from the impact point
        const vc = this.fighters[e.who].color;
        const ac = this.fighters[1 - e.who].color;
        const rot = [0, Math.PI, Math.PI / 2, -Math.PI / 2][e.b] ?? 0;
        this.wallWaves.push({ p0: this.perimeterAt(x, y), t: 0, amp: 16 + Math.min(22, e.a * 0.35), color: ac });
        if (this.wallWaves.length > 4) this.wallWaves.shift();
        this.fx.spawn('wall_t', { x, y, size: 3.8 * PX, rot, tint: ac, alpha: 0.9 });
        this.fx.spawn('hit_heavy_t', { x, y, size: 2.4 * PX, rot, tint: 0xffffff, alpha: 0.6 });
        this.vfx.spark(x, y, ac, 16, 34, 44, 6, Math.PI * 0.9, rot);
        this.vfx.spark(x, y, 0xffffff, 8, 26, 30, 4, Math.PI * 0.7, rot);
        this.vfx.text(`WALL +${e.a}`, x + Math.cos(rot) * 110, y + Math.sin(rot) * 110 - 60, ac, 32, 50, -0.6);
        this.fighters[e.who].flash = 4;
        void vc;
        this.addShake(20);
        this.wave(x, y, 1.3);
        this.flashScreen(ac, 0.22);
        break;
      }
      case EV_GHOST: {
        // illusion out: the opponent sees nothing special (the decoy simply acts as the
        // fighter); the owner gets a faint violet puff where the real one turns invisible
        const f = s.f[e.who];
        if (this.owns(e.who)) this.fx.spawn('ghost_appear', { x: toPx(f.x), y: toPx(f.y), size: 1.8 * PX, alpha: 0.5, speed: 1.6 });
        break;
      }
      case EV_GHOST_END: {
        // the decoy dissolves into wisps; the real one materializes where it actually is
        const f = s.f[e.who];
        const rx = toPx(f.x);
        const ry = toPx(f.y);
        this.fx.spawn('ghost_fade', { x, y, size: 2.9 * PX });
        this.vfx.glitter(x, y, 0xc89bff, 14, 10, 34, 4);
        this.fx.spawn('ghost_appear', { x: rx, y: ry, size: 2.6 * PX });
        this.vfx.ring(rx, ry, 0xc89bff, 60, 10, 16, 5);
        if (e.a === 2) this.vfx.text('幻影', x, y - 90, 0xd9a8ff, 26, 40, -0.6);
        if (!this.owns(e.who)) this.chroma = Math.max(this.chroma, 0.45);
        this.fvOf(e.who).flash = 3;
        break;
      }
      case EV_BLINK: {
        // JA teleport: afterimage + light streak from where we were, flash where we land
        const fv = this.fighters[e.who];
        const ox = toPx(e.a);
        const oy = toPx(e.b);
        fv.ghosts.push({ x: ox, y: oy, rot: fv.morph.r ? s.f[e.who].facing * ANG_TO_RAD : 0, radii: Float32Array.from(fv.morph.r), life: 18 });
        this.streaks.push({ x0: ox, y0: oy, x1: x, y1: y, life: 14, color: fv.color });
        this.fx.spawn('blink_t', { x: ox, y: oy, size: 2.4 * PX, tint: 0xffffff, alpha: 0.7, speed: 1.3 });
        this.fx.spawn('blink_t', { x, y, size: 3.2 * PX, tint: fv.color });
        for (let k = 1; k < 6; k++) this.vfx.glitter(ox + ((x - ox) * k) / 6, oy + ((y - oy) * k) / 6, 0x6ff3ff, 3, 4, 18, 3);
        this.chroma = Math.max(this.chroma, 0.8);
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

  /** The just-dodge ripple: slower, wider, stronger than a hit's shockwave. */
  private bigWave(x: number, y: number): void {
    if (this.quality === 'low') return;
    if (this.waves.length >= 3) this.waves.shift();
    const w = new ShockwaveFilter({ center: { x: 0, y: 0 }, amplitude: 34, wavelength: 170, speed: 520, brightness: 1.25, radius: 1100 });
    (w as unknown as { _wx: number; _wy: number })._wx = x;
    (w as unknown as { _wx: number; _wy: number })._wy = y;
    this.waves.push(w);
    this.applyFilters();
  }

  /** Perimeter coordinate (px, clockwise from the top-left corner) of a point on the arena edge. */
  private perimeterAt(x: number, y: number): number {
    const dl = x;
    const dr = FW - x;
    const dt = y;
    const db = FHt - y;
    const m = Math.min(dl, dr, dt, db);
    if (m === dt) return Math.max(0, Math.min(FW, x));
    if (m === dr) return FW + Math.max(0, Math.min(FHt, y));
    if (m === db) return FW + FHt + (FW - Math.max(0, Math.min(FW, x)));
    return 2 * FW + FHt + (FHt - Math.max(0, Math.min(FHt, y)));
  }

  /** Neon arena edge; wall impacts send a damped sine wave running along it. */
  private drawBorder(dt: number): void {
    const g = this.borderG;
    const P = 2 * (FW + FHt);
    for (let i = this.wallWaves.length - 1; i >= 0; i--) {
      this.wallWaves[i].t += dt;
      if (this.wallWaves[i].t > 70) this.wallWaves.splice(i, 1);
    }
    if (!this.wallWaves.length) {
      // at rest the edge is static: keep the built geometry instead of rebuilding it every frame
      if (this.borderAtRest) return;
      this.borderAtRest = true;
      g.clear();
      g.rect(0, 0, FW, FHt).stroke({ width: 10, color: 0x6ff3ff, alpha: 0.08 });
      g.rect(0, 0, FW, FHt).stroke({ width: 3, color: 0x6ff3ff, alpha: 0.55 });
      return;
    }
    this.borderAtRest = false;
    g.clear();
    const step = 10;
    const pts: number[] = [];
    let energy = 0;
    for (let p = 0; p < P; p += step) {
      // base point + outward normal
      let bx: number, by: number, nx: number, ny: number;
      if (p < FW) [bx, by, nx, ny] = [p, 0, 0, -1];
      else if (p < FW + FHt) [bx, by, nx, ny] = [FW, p - FW, 1, 0];
      else if (p < 2 * FW + FHt) [bx, by, nx, ny] = [FW - (p - FW - FHt), FHt, 0, 1];
      else [bx, by, nx, ny] = [0, FHt - (p - 2 * FW - FHt), -1, 0];
      let off = 0;
      for (const w of this.wallWaves) {
        let d = Math.abs(p - w.p0);
        d = Math.min(d, P - d);
        // wave travelling outward from the impact, damped in time and distance
        off += w.amp * Math.exp(-w.t / 20) * Math.cos((d / 110) * Math.PI - w.t * 0.38) * Math.exp(-d / 420);
      }
      energy = Math.max(energy, Math.abs(off));
      pts.push(bx + nx * off, by + ny * off);
    }
    const hot = Math.min(1, energy / 30);
    const col = this.wallWaves[this.wallWaves.length - 1].color;
    g.poly(pts, true).stroke({ width: 14, color: col, alpha: 0.08 + 0.2 * hot, join: 'round' });
    g.poly(pts, true).stroke({ width: 3 + 2 * hot, color: mix(0x6ff3ff, 0xffffff, hot * 0.6), alpha: 0.55 + 0.4 * hot, join: 'round' });
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
    const slowing = s.slow > 0;
    const frozen = s.hitstop > 0 || s.freeze > 0 || (slowing && !this.sim.advanced);
    // slow motion: effects run at a fraction of real time
    const fxDt = slowing ? dtFrames * 0.3 : dtFrames;

    this.updateCamera(dtFrames);
    this.drawBorder(dtFrames);

    const glow = this.glow;
    const g = this.bodies;
    const ov = this.overlay;
    glow.clear();
    g.clear();
    ov.clear();
    // decoy layers: only touched while an illusion is (or just was) out
    if (this.ghostDrawn) {
      this.ghostGlow.clear();
      this.ghostBodies.clear();
      this.ghostOverlay.clear();
      this.ghostDrawn = false;
    }

    // hitbox trails & ghosts first (under bodies)
    for (let i = 0; i < 2; i++) {
      const hide = this.hidden(i);
      this.fvOf(i).label.visible = !hide;
      if (!hide) this.drawTrail(i, dtFrames, newFrame && !frozen);
    }
    for (let i = 0; i < 2; i++) if (!this.hidden(i)) this.drawFighter(i, dtFrames, frozen);
    for (let i = 0; i < 2; i++) if (!this.hidden(i)) this.stateFx(i, newFrame && !frozen);
    // illusion decoys: to the opponent they ARE the fighter; the owner sees a translucent ghost
    for (let i = 0; i < 2; i++) {
      const fv = this.fvOf(2 + i);
      const d = this.sim.decoyOf(i);
      fv.label.visible = !!d && !this.owns(i);
      if (!d) {
        fv.trail.length = 0;
        fv.ghosts.length = 0;
        continue;
      }
      if (fv.label.parent !== this.labels) this.labels.addChild(fv.label);
      this.ghostDrawn = true;
      this.ghostLayer.alpha = this.owns(i) ? 0.42 + 0.08 * Math.sin(this.t * 0.5) : 1;
      const [g0, b0, o0] = [this.glow, this.bodies, this.overlay];
      [this.glow, this.bodies, this.overlay] = [this.ghostGlow, this.ghostBodies, this.ghostOverlay];
      this.drawTrail(2 + i, dtFrames, newFrame && !frozen);
      this.drawFighter(2 + i, dtFrames, frozen);
      [this.glow, this.bodies, this.overlay] = [g0, b0, o0];
      this.stateFx(2 + i, newFrame && !frozen);
      if (this.owns(i) && this.opts.local !== -1) {
        // owner: mark the real (invisible to the opponent) piece
        const f = this.sim.s.f[i];
        const r = 0.72 * PX + Math.sin(this.t * 0.3) * 4;
        for (let k = 0; k < 12; k += 2) {
          const a0 = (k / 12) * Math.PI * 2 + this.t * 0.03;
          const fx0 = toPx(f.x);
          const fy0 = toPx(f.y);
          ov.moveTo(fx0 + Math.cos(a0) * r, fy0 + Math.sin(a0) * r).arc(fx0, fy0, r, a0, a0 + Math.PI / 6).stroke({ width: 3, color: 0xd9a8ff, alpha: 0.8 });
        }
      }
    }
    this.drawAim();

    this.vfx.update(fxDt);
    this.fx.update(fxDt);
    // blink streaks
    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const st = this.streaks[i];
      st.life -= fxDt;
      if (st.life <= 0) {
        this.streaks.splice(i, 1);
        continue;
      }
      const k = st.life / 14;
      glow.moveTo(st.x0, st.y0).lineTo(st.x1, st.y1).stroke({ width: 40 * k, color: st.color, alpha: 0.35 * k, cap: 'round' });
      glow.moveTo(st.x0, st.y0).lineTo(st.x1, st.y1).stroke({ width: 8 * k, color: 0xffffff, alpha: 0.9 * k, cap: 'round' });
    }
    // monochrome while time is slowed
    const monoTarget = slowing && !settings.reduceFlash ? 1 : slowing ? 0.6 : 0;
    const prevMono = this.monoAmt;
    this.monoAmt += (monoTarget - this.monoAmt) * (1 - Math.pow(monoTarget > this.monoAmt ? 0.45 : 0.8, dtFrames));
    if (this.monoAmt < 0.01) this.monoAmt = 0;
    this.mono.alpha = this.monoAmt;
    if ((prevMono > 0.01) !== (this.monoAmt > 0.01)) this.applyFilters();

    // shockwaves
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.time += fxDt / 60;
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
      this.chroma = Math.max(0, this.chroma - (slowing ? fxDt / 30 : dtFrames / 22));
      const px = 6 * this.chroma;
      this.rgb.red = { x: -px, y: 0 };
      this.rgb.green = { x: 0, y: px * 0.5 };
      this.rgb.blue = { x: px, y: 0 };
      if (this.chroma <= 0.05) this.applyFilters();
      else if (!this.world.filters?.includes(this.rgb)) this.applyFilters();
    }
    // screen flash (the layer is only rebuilt while something is on it)
    const fg = this.flashG;
    if (this.flashDrawn) {
      fg.clear();
      this.flashDrawn = false;
    }
    if (this.screenFlash > 0.01 || this.impactFrames > 0 || slowing || s.phase === PH_INTRO) this.flashDrawn = true;
    if (this.screenFlash > 0.01) {
      fg.rect(0, 0, this.host.screen.width, this.host.screen.height).fill({ color: this.screenFlashColor, alpha: this.screenFlash });
      this.screenFlash *= Math.pow(0.82, dtFrames);
    }
    if (this.impactFrames > 0) {
      // impact frames: a white flash, then a dark frame
      fg.rect(0, 0, this.host.screen.width, this.host.screen.height).fill({ color: this.impactFrames > 1 ? 0xffffff : 0x000000, alpha: this.impactFrames > 1 ? 0.55 : 0.45 });
      if (newFrame) this.impactFrames--;
    } else if (slowing) {
      // slow motion: dim edges (cheap vignette)
      const W = this.host.screen.width;
      const H = this.host.screen.height;
      for (let k = 0; k < 4; k++) {
        const m = (k + 1) * Math.min(W, H) * 0.06;
        fg.rect(0, 0, W, m).rect(0, H - m, W, m).rect(0, m, m, H - 2 * m).rect(W - m, m, m, H - 2 * m).fill({ color: 0x000000, alpha: 0.1 * this.monoAmt });
      }
    }
    if (s.phase === PH_INTRO) {
      fg.rect(0, 0, this.host.screen.width, this.host.screen.height).fill({ color: 0x000000, alpha: 0.15 });
    }
  }

  /** Sprite effects driven by state: swing smears, skill signatures, loops. */
  private stateFx(i: number, advanced: boolean): void {
    const f = this.fOf(i)!;
    const fv = this.fvOf(i);
    const m = f.st === ST_ATTACK ? this.sim.moveOf(f) : null;
    if (f.st === ST_ATTACK && (f.move !== fv.lastMove || f.sf < fv.lastSf)) fv.instance++;
    fv.lastMove = f.st === ST_ATTACK ? f.move : -1;
    fv.lastSf = f.sf;
    const pos = () => {
      const ff = this.fOf(i);
      return ff ? { x: toPx(ff.x), y: toPx(ff.y) } : null;
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
          once(f.sf >= m.S, () => this.fx.spawn('gale', { x, y, size: reach * 1.05, rot: face, follow: () => { const p = pos(); return p && { ...p, rot: (this.fOf(i)?.facing ?? 0) * ANG_TO_RAD }; } }));
          break;
        case 'soulRipper':
          // claws tear through the whole reach on the active frames
          once(f.sf >= m.S - 2, () => this.fx.spawn('reaper', { x: x + cos * reach * 0.6, y: y + sin * reach * 0.6, size: 3.4 * PX, rot: face, speed: 1.0 }));
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
    // guard-break warning aura (Phantom's is violet: the claws are coming)
    const dangerSheet = m?.id === 'soulRipper' ? 'danger_p' : 'danger';
    loop('danger', dangerOn, () => this.fx.spawn(dangerSheet, { x, y, size: 2.6 * PX, rot: face, loop: true, follow: () => { const p = pos(); return p && { ...p, rot: (this.fOf(i)?.facing ?? 0) * ANG_TO_RAD }; } }));
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
    const sw = this.host.screen.width;
    const sh = this.host.screen.height;
    const top = this.topInset;
    const vh = Math.max(1, sh - top);
    const margin = 0.35 * PX;
    const fit = Math.min(sw / (VW + margin * 2), (vh - 8) / (VH + margin * 2)) * (this.opts.zoom ?? 1);
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
    const fv = this.fvOf(i);
    const f = this.fOf(i)!;
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
    const f = this.fOf(i)!;
    const fv = this.fvOf(i);
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
    const char = this.sim.char(i & 1);

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
        // guard-break warning: the outline flashes (Phantom's Soul Ripper in violet-white)
        stroke = f.st === ST_ATTACK && this.sim.moveOf(f)?.id === 'soulRipper' ? 0xf0d4ff : 0xffe070;
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
    fv.label.alpha = f.st === ST_KO ? 0 : this.opts.local === -1 || this.opts.local === (i & 1) ? 1 : 0.75;

    if (this.showHitboxes) {
      this.overlay.circle(x, y, 0.5 * PX).stroke({ width: 2, color: 0x58f0a0, alpha: 0.8 });
      const tip = this.sim.hitboxOf(f);
      if (tip) this.overlay.moveTo(x, y).lineTo(toPx(tip.x), toPx(tip.y)).stroke({ width: 4, color: 0xff3050, alpha: 0.9 });
    }
  }

  /** Facing arrow; during startup it grows toward the reach, while active it is a bar. */
  private drawDirection(i: number, x: number, y: number): void {
    const f = this.fOf(i)!;
    const fv = this.fvOf(i);
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
    // show what the sim will get: auto = straight at the opponent with the full lunge;
    // free aim = the exact direction (256 steps) and reach level. No snapping either way.
    const q = a.auto
      ? Math.atan2(o.y - f.y, o.x - f.x)
      : (Math.round((Math.atan2(a.y, a.x) / (Math.PI * 2)) * 256) / 256) * Math.PI * 2;
    const pct = a.auto ? 100 : 40 + Math.round(a.frac * 3) * 20;
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
    const f = this.fOf(i)!;
    if (f.st === ST_KO) return;
    // the decoy shows the cost the real one had before paying for the illusion
    const cost = this.shownCost(i & 1);
    const g = this.overlay;
    const by = y + 0.86 * PX;
    const n = SYSTEM.cost.max;
    const w = 20;
    const start = x - ((n - 1) * w) / 2 - 14;
    for (let k = 0; k < n; k++) {
      const cx = start + k * w;
      const fill = Math.max(0, Math.min(1, cost / COST_UNIT - k));
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
