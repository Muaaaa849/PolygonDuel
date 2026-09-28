// Single Pixi application. Menus show an ambient polygon field; battles mount their own scene.
import { Application, Container, FilterSystem, Graphics, type Renderer, type Ticker } from 'pixi.js';
import { SHAPE_RADII, N } from './shapes';

export let app: Application;

// ── Pixi 8.21 workaround: a resize could leave the battle permanently blank ──
// FilterSystem.push() asks _findFilterResolution() AFTER pushing, so for a nested filter
// (the shockwaves on the field, inside the bloomed world) it reads its own stack slot's
// inputTexture — left over from the previous frame and already returned to the TexturePool.
// Since 8.21 every renderer resize prunes idle screen-sized pool textures (destroys them), so
// that stale texture's source is null → TypeError mid-render → the filter stack index stays
// pushed → every later filtered frame throws: the battle canvas freezes / goes black while the
// sim and sound go on, and the next battle too. Rotating the phone or the browser bar showing
// during a shockwave was enough. A missing texture now falls back to the root resolution
// (what a fresh stack slot gets on its first frame anyway).
type FilterStackInternals = {
  _filterStack: { skip: boolean; inputTexture?: { source?: { _resolution: number } | null } | null }[];
  _filterStackIndex: number;
};
(FilterSystem.prototype as unknown as { _findFilterResolution: (root: number) => number })._findFilterResolution = function (
  this: FilterStackInternals,
  root: number,
): number {
  let i = this._filterStackIndex - 1;
  while (i > 0 && this._filterStack[i].skip) --i;
  const src = i > 0 ? this._filterStack[i].inputTexture?.source : null;
  return src ? src._resolution : root;
};

/** After a render threw midway: unwind the filter stack it left pushed, so the next frame can draw. */
export function recoverRenderer(r: Renderer): void {
  const fs = (r as unknown as { filter?: FilterStackInternals }).filter;
  if (fs) fs._filterStackIndex = 0;
}

/**
 * At most 60 frames per second for a Pixi ticker (menus, the move-sheet demo). The game is
 * 60Hz; a 90/120/144Hz screen would draw 2x+ the frames for nothing but heat and battery.
 * Pixi truncates the frame delta to whole ms before comparing, so maxFPS = 60 (16.67ms)
 * drops a 120Hz screen to 40fps; a 16ms minimum (62.5) gives a steady 60 there and still
 * draws every frame at 60Hz. Skipped frames' time is carried into the next deltaMS.
 */
export function cap60(ticker: Ticker): void {
  ticker.maxFPS = 62.5;
}

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
  cap60(app.ticker);
  // If the GPU drops the WebGL context (memory pressure on phones) the canvas goes blank
  // while the game keeps running. Pixi restores it; meanwhile say what is happening.
  const note = document.createElement('div');
  note.className = 'gl-lost';
  note.textContent = '描画を復旧しています…';
  app.canvas.addEventListener('webglcontextlost', () => document.body.append(note));
  app.canvas.addEventListener('webglcontextrestored', () => note.remove());
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
