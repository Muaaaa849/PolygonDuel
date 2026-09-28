// GPU warm-up (CLAUDE.md §12): compile every filter program and upload every effect sheet
// while the player is still in the menus. Pixi does both lazily, on first use — and in a
// fight "first use" is the first shockwave, just dodge or KO, i.e. the most dramatic frame.
// Measured in headless Chromium: first ShockwaveFilter frame 545ms, RGBSplit 228ms,
// ColorMatrix 199ms, first KO sheet upload 748ms; every later use < 4ms. A phone's GPU is
// faster than that software renderer, but still hitches for tens of ms, and online the
// peer stalls along with it. One job per frame, run just after that frame is drawn, so the
// menus stay smooth. A job that throws only means that thing warms up lazily later.
import { ColorMatrixFilter, Container, Graphics, RenderTexture, type Filter, type Renderer, type TextureSource } from 'pixi.js';
import { AdvancedBloomFilter, RGBSplitFilter, ShockwaveFilter } from 'pixi-filters';

type Job = () => void;
const queue: Job[] = [];
let scheduled = false;

function schedule(): void {
  if (scheduled || !queue.length) return;
  scheduled = true;
  // after the next frame has been rendered, so a menu frame is never delayed by a job
  requestAnimationFrame(() =>
    setTimeout(() => {
      scheduled = false;
      const job = queue.shift();
      try {
        job?.();
      } catch {
        /* lazy first use instead */
      }
      schedule();
    }, 0),
  );
}

/** Draw a tiny scene through `filters` once, off screen: compiles their GL programs. */
function drawThrough(r: Renderer, filters: Filter[]): void {
  const c = new Container();
  c.addChild(new Graphics().rect(0, 0, 48, 48).fill({ color: 0x6ff3ff, alpha: 0.8 }).circle(24, 24, 12).stroke({ width: 3, color: 0xffffff }));
  c.filters = filters;
  const rt = RenderTexture.create({ width: 64, height: 64 });
  r.render({ container: c, target: rt, clear: true });
  c.destroy({ children: true });
  rt.destroy(true);
  for (const f of filters) f.destroy(); // programs stay cached; later instances reuse them
}

/** Compile the battle filters (bloom, shockwave, chroma split, monochrome) ahead of time. */
export function warmShaders(r: Renderer): void {
  queue.push(
    () => {
      // same setup as BattleView.setQuality (MSAA filter target included)
      const bloom = new AdvancedBloomFilter({ threshold: 0.32, bloomScale: 0.8, brightness: 1, blur: 5, quality: 3 });
      bloom.antialias = 'on';
      drawThrough(r, [bloom]);
    },
    () => drawThrough(r, [new ShockwaveFilter({ center: { x: 24, y: 24 }, amplitude: 18, wavelength: 90, speed: 700, brightness: 1.15, radius: 380 })]),
    () => drawThrough(r, [new RGBSplitFilter({ red: [-2, 0], green: [0, 1], blue: [2, 0] })]),
    () => {
      const mono = new ColorMatrixFilter();
      mono.desaturate();
      drawThrough(r, [mono]);
    },
  );
  schedule();
}

/** Upload effect sheets to the GPU (one per frame). */
export function warmTextures(r: Renderer, sources: TextureSource[]): void {
  const tex = (r as unknown as { texture?: { initSource?: (s: TextureSource) => void } }).texture;
  if (!tex?.initSource) return;
  for (const s of sources) queue.push(() => tex.initSource!(s));
  schedule();
}
