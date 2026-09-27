// Every shape is a 64-sample "angle → radius" function (plan §10-1), so morphing
// between any two shapes is just a per-sample spring.
import { SH } from '../core/compile';

export const N = 64;

type Pt = [number, number];

/** Radius of a star-shaped polygon (around the origin) along angle a. */
function rayRadius(poly: Pt[], a: number): number {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const ex = x2 - x1;
    const ey = y2 - y1;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = (x1 * ey - y1 * ex) / den;
    const s = (x1 * dy - y1 * dx) / den;
    if (t > 0 && s >= -1e-6 && s <= 1 + 1e-6 && t < best) best = t;
  }
  return best === Infinity ? 0 : best;
}

function ngon(n: number, r: number, rot = 0): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (Math.PI * 2 * i) / n;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

function sample(poly: Pt[] | null, r = 0.5): Float32Array {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = poly ? rayRadius(poly, (i / N) * Math.PI * 2) : r;
  return out;
}

/** Radii in units of u, local frame (angle 0 = facing). Index by SH.*. */
export const SHAPE_RADII: Float32Array[] = [];
SHAPE_RADII[SH.square] = sample(ngon(4, 0.62, Math.PI / 4));
SHAPE_RADII[SH.hexagon] = sample(ngon(6, 0.6, 0));
SHAPE_RADII[SH.circle] = sample(null, 0.5);
SHAPE_RADII[SH.triangle] = sample(ngon(3, 0.74, 0));
SHAPE_RADII[SH.arrow] = sample([[0.82, 0], [-0.5, 0.58], [-0.14, 0], [-0.5, -0.58]]);
SHAPE_RADII[SH.pentagon] = sample(ngon(5, 0.62, 0));
SHAPE_RADII[SH.star] = SHAPE_RADII[SH.square];

/** Spring-morphing radius set (4F convergence, ~13% overshoot). */
export class Morph {
  r = new Float32Array(N);
  v = new Float32Array(N);
  constructor(shape: number) {
    this.r.set(SHAPE_RADII[shape]);
  }
  step(target: Float32Array, k = 0.6, d = 0.7): void {
    for (let i = 0; i < N; i++) {
      this.v[i] = this.v[i] * (1 - d) + (target[i] - this.r[i]) * k;
      this.r[i] += this.v[i];
    }
  }
  /** Big first-frame jolt so the new shape is readable on its 2nd frame (plan §3). */
  kick(target: Float32Array): void {
    for (let i = 0; i < N; i++) this.v[i] += (target[i] - this.r[i]) * 0.15;
  }
}

/** Build a flat [x,y,...] point list for Graphics.poly. */
export function toPoints(
  radii: Float32Array,
  cx: number,
  cy: number,
  rot: number,
  scale: number,
  out: number[],
  wobble?: (i: number, ang: number) => number,
): number[] {
  out.length = 0;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = radii[i] * scale * (wobble ? wobble(i, a) : 1);
    out.push(cx + Math.cos(a + rot) * r, cy + Math.sin(a + rot) * r);
  }
  return out;
}
