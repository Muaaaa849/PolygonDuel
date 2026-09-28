// Procedural effects (plan §10): everything is math, drawn into one additive
// Graphics each frame. Effects never feed back into the simulation.
import { Container, Graphics, Text } from 'pixi.js';

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; color: number; w: number; len: number }
interface Ring { x: number; y: number; r0: number; r1: number; life: number; max: number; color: number; w: number }
interface Shard { x: number; y: number; vx: number; vy: number; rot: number; vr: number; size: number; life: number; max: number; color: number }
interface Dot { x: number; y: number; vx: number; vy: number; life: number; max: number; color: number; size: number; drag: number }
interface Label { t: Text; x: number; y: number; vy: number; life: number; max: number; pop: number }

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Vfx {
  root = new Container();
  private g = new Graphics();
  private labels = new Container();
  private sparks: Spark[] = [];
  private rings: Ring[] = [];
  private shards: Shard[] = [];
  private dots: Dot[] = [];
  private texts: Label[] = [];
  private pool: Text[] = [];
  private drawn = false;
  /** 0..1 intensity multiplier (quality tier). */
  density = 1;

  constructor() {
    this.g.blendMode = 'add';
    this.root.addChild(this.g, this.labels);
  }

  spark(x: number, y: number, color: number, n = 8, speed = 22, len = 26, w = 5, spread = Math.PI * 2, dir = 0): void {
    n = Math.max(2, Math.round(n * this.density));
    for (let i = 0; i < n; i++) {
      const a = dir + (spread >= Math.PI * 2 ? (i / n) * Math.PI * 2 + rand(-0.2, 0.2) : rand(-spread / 2, spread / 2));
      const s = speed * rand(0.6, 1.2);
      this.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: rand(9, 15), color, w, len: len * rand(0.7, 1.2) });
    }
  }

  ring(x: number, y: number, color: number, r0: number, r1: number, max = 16, w = 6): void {
    this.rings.push({ x, y, r0, r1, life: 0, max, color, w });
  }

  shatter(x: number, y: number, color: number, n = 6, speed = 14, size = 26): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.3, 0.3);
      const s = speed * rand(0.7, 1.3);
      this.shards.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, rot: a, vr: rand(-0.4, 0.4), size: size * rand(0.7, 1.2), life: 0, max: 30, color });
    }
  }

  glitter(x: number, y: number, color: number, n = 12, speed = 6, max = 26, size = 4, drag = 0.9): void {
    n = Math.max(1, Math.round(n * this.density));
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const s = speed * rand(0.2, 1);
      this.dots.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: max * rand(0.6, 1.2), color, size: size * rand(0.6, 1.3), drag });
    }
  }

  rise(x: number, y: number, color: number, n = 14): void {
    for (let i = 0; i < n; i++) {
      this.dots.push({ x: x + rand(-40, 40), y: y + rand(-20, 30), vx: rand(-0.5, 0.5), vy: rand(-3.5, -1.5), life: 0, max: rand(30, 50), color, size: rand(3, 6), drag: 0.99 });
    }
  }

  text(str: string, x: number, y: number, color: number, size = 34, max = 44, vy = -1.1): void {
    const t = this.pool.pop() ?? new Text({ text: '', style: { fontFamily: 'Chakra Petch, sans-serif', fontWeight: '700', align: 'center' } });
    t.text = str;
    t.style.fontSize = size;
    t.style.fill = color;
    t.style.stroke = { color: 0x05070d, width: 6, join: 'round' };
    t.style.letterSpacing = 2;
    t.anchor.set(0.5);
    t.resolution = 3;
    t.alpha = 1;
    this.labels.addChild(t);
    this.texts.push({ t, x, y, vy, life: 0, max, pop: 1 });
  }

  update(dt: number): void {
    const g = this.g;
    // nothing alive and nothing drawn last frame: leave the (empty) geometry alone
    const busy = this.sparks.length + this.rings.length + this.shards.length + this.dots.length > 0;
    if (busy || this.drawn) g.clear();
    this.drawn = busy;
    // sparks: streaks along velocity
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.life += dt;
      if (p.life >= p.max) {
        this.sparks.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.86, dt);
      p.vy *= Math.pow(0.86, dt);
      const k = 1 - p.life / p.max;
      const sp = Math.hypot(p.vx, p.vy) || 1;
      const l = p.len * k;
      g.moveTo(p.x, p.y).lineTo(p.x - (p.vx / sp) * l, p.y - (p.vy / sp) * l).stroke({ width: p.w * k + 1, color: p.color, alpha: k, cap: 'round' });
      g.moveTo(p.x, p.y).lineTo(p.x - (p.vx / sp) * l * 0.5, p.y - (p.vy / sp) * l * 0.5).stroke({ width: (p.w * k) / 2 + 0.5, color: 0xffffff, alpha: k, cap: 'round' });
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life += dt;
      if (r.life >= r.max) {
        this.rings.splice(i, 1);
        continue;
      }
      const t = r.life / r.max;
      const e = 1 - Math.pow(1 - t, 3);
      g.circle(r.x, r.y, r.r0 + (r.r1 - r.r0) * e).stroke({ width: r.w * (1 - t) + 0.5, color: r.color, alpha: 1 - t });
    }
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.life += dt;
      if (s.life >= s.max) {
        this.shards.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= Math.pow(0.9, dt);
      s.vy *= Math.pow(0.9, dt);
      s.rot += s.vr * dt;
      const k = 1 - s.life / s.max;
      const pts: number[] = [];
      for (let j = 0; j < 3; j++) {
        const a = s.rot + (j * Math.PI * 2) / 3;
        const rr = j === 0 ? s.size : s.size * 0.55;
        pts.push(s.x + Math.cos(a) * rr, s.y + Math.sin(a) * rr);
      }
      g.poly(pts).fill({ color: s.color, alpha: 0.8 * k }).stroke({ width: 2, color: 0xffffff, alpha: k });
    }
    for (let i = this.dots.length - 1; i >= 0; i--) {
      const d = this.dots[i];
      d.life += dt;
      if (d.life >= d.max) {
        this.dots.splice(i, 1);
        continue;
      }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vx *= Math.pow(d.drag, dt);
      d.vy *= Math.pow(d.drag, dt);
      const k = 1 - d.life / d.max;
      const tw = 0.6 + 0.4 * Math.sin(d.life * 1.3 + d.x);
      g.circle(d.x, d.y, d.size * k).fill({ color: d.color, alpha: k * tw });
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const l = this.texts[i];
      l.life += dt;
      if (l.life >= l.max) {
        l.t.removeFromParent();
        this.pool.push(l.t);
        this.texts.splice(i, 1);
        continue;
      }
      l.y += l.vy * dt;
      const t = l.life / l.max;
      const pop = t < 0.12 ? 1.5 - (t / 0.12) * 0.5 : 1;
      l.t.position.set(l.x, l.y);
      l.t.scale.set(pop);
      l.t.alpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
    }
  }

  clear(): void {
    this.sparks.length = this.rings.length = this.shards.length = this.dots.length = 0;
    for (const l of this.texts) {
      l.t.removeFromParent();
      this.pool.push(l.t);
    }
    this.texts.length = 0;
    this.g.clear();
  }
}
