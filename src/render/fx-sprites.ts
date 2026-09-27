// Pre-baked effect sprite sheets (tools/fx/gen_fx.py → public/fx/*.webp).
// Loaded in the background after boot; the game runs fine before they arrive
// (procedural effects in vfx.ts still play), sprites just join in once ready.
import { Assets, Container, Rectangle, Sprite, Texture } from 'pixi.js';

interface SheetMeta {
  file: string;
  size: number;
  count: number;
  cols: number;
  fps: number;
  tint: boolean;
  anchor: [number, number];
}

const sheets = new Map<string, { meta: SheetMeta; frames: Texture[] }>();
let loading: Promise<void> | null = null;

export function loadFx(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const base = new URL('fx/', document.baseURI).href;
      const manifest = (await (await fetch(base + 'fx.json')).json()) as Record<string, SheetMeta>;
      await Promise.all(
        Object.entries(manifest).map(async ([name, meta]) => {
          const tex = (await Assets.load(base + meta.file)) as Texture;
          const frames: Texture[] = [];
          for (let i = 0; i < meta.count; i++) {
            const r = Math.floor(i / meta.cols);
            const c = i % meta.cols;
            frames.push(new Texture({ source: tex.source, frame: new Rectangle(c * meta.size, r * meta.size, meta.size, meta.size) }));
          }
          sheets.set(name, { meta, frames });
        }),
      );
    } catch {
      /* offline / missing: procedural effects only */
    }
  })();
  return loading;
}

export const fxReady = (name: string): boolean => sheets.has(name);

export interface FxOpts {
  x: number;
  y: number;
  /** Rendered size (world px) of the full sprite square. */
  size: number;
  rot?: number;
  tint?: number;
  flipY?: boolean;
  alpha?: number;
  speed?: number;
  loop?: boolean;
  /** 'add' (default) or 'normal' */
  blend?: 'add' | 'normal';
  /** Keep following a moving point every frame. */
  follow?: () => { x: number; y: number; rot?: number } | null;
}

export class FxHandle {
  t = 0;
  dead = false;
  constructor(public sprite: Sprite, public frames: Texture[], public fps: number, public opts: FxOpts) {}
  kill(): void {
    this.dead = true;
  }
}

/** A container of animated sprite effects, advanced by the battle view's clock. */
export class FxLayer {
  root = new Container();
  private live: FxHandle[] = [];
  /** Global size / count multiplier from the quality tier. */
  density = 1;
  /** Animation speed (dev screenshots freeze with 0). */
  timeScale = 1;

  spawn(name: string, o: FxOpts): FxHandle | null {
    const sh = sheets.get(name);
    if (!sh) return null;
    const sp = new Sprite(sh.frames[0]);
    sp.anchor.set(sh.meta.anchor[0], sh.meta.anchor[1]);
    const k = o.size / sh.meta.size;
    sp.scale.set(k, o.flipY ? -k : k);
    sp.rotation = o.rot ?? 0;
    sp.position.set(o.x, o.y);
    sp.alpha = o.alpha ?? 1;
    sp.blendMode = o.blend ?? 'add';
    if (o.tint !== undefined) sp.tint = o.tint;
    this.root.addChild(sp);
    const h = new FxHandle(sp, sh.frames, sh.meta.fps, o);
    this.live.push(h);
    return h;
  }

  update(dtFrames: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const h = this.live[i];
      h.t += dtFrames * this.timeScale * (h.fps / 60) * (h.opts.speed ?? 1);
      let f = Math.floor(h.t);
      if (h.opts.loop) f %= h.frames.length;
      if (h.dead || f >= h.frames.length) {
        h.sprite.destroy();
        this.live.splice(i, 1);
        continue;
      }
      h.sprite.texture = h.frames[f];
      if (h.opts.follow) {
        const p = h.opts.follow();
        if (!p) {
          h.dead = true;
          continue;
        }
        h.sprite.position.set(p.x, p.y);
        if (p.rot !== undefined) h.sprite.rotation = p.rot;
      }
    }
  }

  /** Dev: jump every live effect to frame k. */
  seek(k: number): void {
    for (const h of this.live) h.t = k;
    this.update(0);
  }

  clear(): void {
    for (const h of this.live) h.sprite.destroy();
    this.live.length = 0;
  }
}
