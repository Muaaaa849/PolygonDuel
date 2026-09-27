// Fixed-point helpers for the deterministic core (plan §9-5).
// Distances: 1u = 1000 (milli-units). Angles: 1024 units per turn.
// Trig values: Q14 (16384 = 1.0). Every multiply/divide is followed by truncation.
import { SIN_TABLE, ATAN_TABLE } from './trig-table';

export const U = 1000;
export const ANG = 1024;
export const ANG_MASK = ANG - 1;
export const Q = 16384;

/** Convert a data value in u (may be fractional) to milli-units. Deterministic: IEEE mult + round. */
export const u = (v: number): number => Math.round(v * U);

/** Truncating integer division (toward zero). */
export const idiv = (a: number, b: number): number => Math.trunc(a / b);

export const sinA = (a: number): number => SIN_TABLE[a & ANG_MASK];
export const cosA = (a: number): number => SIN_TABLE[(a + 256) & ANG_MASK];

/** Integer atan2 returning 0..1023 (0 = +x, 256 = +y). */
export function atan2A(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  let a: number;
  if (ax >= ay) a = ATAN_TABLE[idiv(ay * 256, ax)];
  else a = 256 - ATAN_TABLE[idiv(ax * 256, ay)];
  // a is angle in first quadrant (0..256)
  if (x >= 0 && y >= 0) return a & ANG_MASK;
  if (x < 0 && y >= 0) return (512 - a) & ANG_MASK;
  if (x < 0 && y < 0) return (512 + a) & ANG_MASK;
  return (ANG - a) & ANG_MASK;
}

/** Floor integer square root, exact for n < 2^53. */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

/** Signed shortest difference b - a in angle units, range -512..511. */
export function angDiff(a: number, b: number): number {
  let d = (b - a) & ANG_MASK;
  if (d >= 512) d -= ANG;
  return d;
}

/** Rotate angle a toward target by at most maxStep units. */
export function turnToward(a: number, target: number, maxStep: number): number {
  const d = angDiff(a, target);
  if (d > maxStep) return (a + maxStep) & ANG_MASK;
  if (d < -maxStep) return (a - maxStep) & ANG_MASK;
  return target & ANG_MASK;
}

/** Offset of length len (milli-u) at angle a. */
export const offX = (a: number, len: number): number => idiv(cosA(a) * len, Q);
export const offY = (a: number, len: number): number => idiv(sinA(a) * len, Q);

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Squared distance from point (px,py) to segment (ax,ay)-(bx,by). Integer math only. */
export function segPointDist2(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let qx = ax;
  let qy = ay;
  if (len2 > 0) {
    let t = (px - ax) * dx + (py - ay) * dy; // scaled by len2
    if (t < 0) t = 0;
    else if (t > len2) t = len2;
    // q = a + d * t / len2 (truncate)
    qx = ax + idiv(dx * t, len2);
    qy = ay + idiv(dy * t, len2);
  }
  const ex = px - qx;
  const ey = py - qy;
  return ex * ex + ey * ey;
}
