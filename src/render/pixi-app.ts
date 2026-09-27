// Single Pixi application. Menus show an ambient polygon field; battles mount their own scene.
import { Application, Container, Graphics } from 'pixi.js';
import { SHAPE_RADII, N } from './shapes';

export let app: Application;

export async function initPixi(): Promise<Application> {
  app = new Application();
  await app.init({
    resizeTo: window,
    backgroundAlpha: 0,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    preference: 'webgl',
    powerPreference: 'high-performance',
  });
  document.getElementById('stage')!.append(app.canvas);
  return app;
}

/** Drifting outlined polygons for menus — the shape vocabulary as ambience. */
export class Ambient {
  root = new Container();
  private g = new Graphics();
  private items: { x: number; y: number; vx: number; vy: number; rot: number; vr: number; s: number; shape: number; hue: number; ph: number }[] = [];
  private t = 0;
  private tick = (tk: { deltaTime: number }) => this.update(tk.deltaTime);

  constructor() {
    this.root.addChild(this.g);
    const colors = [0xff5a3c, 0x3cf08a, 0x4a8dff, 0x6ff3ff, 0xb58cff];
    for (let i = 0; i < 16; i++) {
      this.items.push({
        x: Math.random(),
        y: Math.random(),
        vx: (Math.random() - 0.5) * 0.0004,
        vy: (Math.random() - 0.5) * 0.0004,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 0.004,
        s: 18 + Math.random() * 60,
        shape: [0, 1, 2, 3, 4, 5][i % 6],
        hue: colors[i % colors.length],
        ph: Math.random() * 6,
      });
    }
  }

  mount(): void {
    app.stage.addChildAt(this.root, 0);
    app.ticker.add(this.tick);
  }

  unmount(): void {
    this.root.removeFromParent();
    app.ticker.remove(this.tick);
  }

  private update(dt: number): void {
    this.t += dt;
    const w = app.screen.width;
    const hgt = app.screen.height;
    const g = this.g;
    g.clear();
    // faint grid
    const step = 48;
    for (let x = (this.t * 0.15) % step; x < w; x += step) g.moveTo(x, 0).lineTo(x, hgt);
    for (let y = (this.t * 0.1) % step; y < hgt; y += step) g.moveTo(0, y).lineTo(w, y);
    g.stroke({ width: 1, color: 0x6f8cff, alpha: 0.05 });
    for (const it of this.items) {
      it.x = (it.x + it.vx * dt + 1) % 1;
      it.y = (it.y + it.vy * dt + 1) % 1;
      it.rot += it.vr * dt;
      const radii = SHAPE_RADII[it.shape];
      const pts: number[] = [];
      const cx = it.x * w;
      const cy = it.y * hgt;
      for (let i = 0; i < N; i += 2) {
        const a = (i / N) * Math.PI * 2;
        pts.push(cx + Math.cos(a + it.rot) * radii[i] * it.s, cy + Math.sin(a + it.rot) * radii[i] * it.s);
      }
      const pulse = 0.08 + 0.05 * Math.sin(this.t * 0.02 + it.ph);
      g.poly(pts).stroke({ width: 1.5, color: it.hue, alpha: pulse * 2 }).fill({ color: it.hue, alpha: pulse * 0.4 });
    }
  }
}

let ambient: Ambient | null = null;
let ambientOn = false;
/** Menus show the ambient field; battles hide it. */
export function setAmbient(on: boolean): void {
  if (!ambient) ambient = new Ambient();
  if (on === ambientOn) return;
  ambientOn = on;
  if (on) ambient.mount();
  else ambient.unmount();
}
