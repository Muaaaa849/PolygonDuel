// Touch control layout (user-customizable). Positions are stored as fractions of the
// viewport (centers), sizes as a multiplier of each control's base size, so a layout
// carries over between phones of different sizes.

export type CtrlId = 'atk' | 's1' | 's2' | 'step' | 'stick';
export const CTRL_IDS: CtrlId[] = ['stick', 'atk', 's1', 's2', 'step'];

export interface CtrlPlace {
  /** Center x / y as a fraction of the viewport. */
  x: number;
  y: number;
  /** Size multiplier (× the global button scale). */
  s: number;
}
export type ControlsLayout = Record<CtrlId, CtrlPlace>;

/** Base diameters (css px at scale 1) — must match styles.css. */
export const BASE_SIZE: Record<CtrlId, number> = { atk: 88, s1: 58, s2: 58, step: 54, stick: 128 };
export const SIZE_MIN = 0.6;
export const SIZE_MAX = 1.8;

/** The built-in layout (same geometry as the CSS defaults), for a viewport. */
export function defaultLayout(vw: number, vh: number, lefty: boolean, k: number): ControlsLayout {
  const px: Record<CtrlId, [number, number]> = {
    atk: [vw - 6 - 56 * k, vh - 6 - 64 * k],
    s1: [vw - 6 - 147 * k, vh - 6 - 41 * k],
    s2: [vw - 6 - 133 * k, vh - 6 - 119 * k],
    step: [vw - 6 - 57 * k, vh - 6 - 155 * k],
    stick: [110 * k, vh - 100 * k],
  };
  const out = {} as ControlsLayout;
  for (const id of CTRL_IDS) {
    const [x, y] = px[id];
    out[id] = { x: (lefty ? vw - x : x) / vw, y: y / vh, s: 1 };
  }
  return out;
}

/** Pixel center + diameter of a control. */
export function placePx(p: CtrlPlace, id: CtrlId, vw: number, vh: number, k: number): { cx: number; cy: number; size: number } {
  return { cx: p.x * vw, cy: p.y * vh, size: BASE_SIZE[id] * k * p.s };
}

/** Validate an imported layout; returns a clean copy or null. */
export function sanitizeLayout(v: unknown): ControlsLayout | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const out = {} as ControlsLayout;
  for (const id of CTRL_IDS) {
    const p = o[id] as Partial<CtrlPlace> | undefined;
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || typeof p.s !== 'number') return null;
    if (![p.x, p.y, p.s].every(Number.isFinite)) return null;
    out[id] = {
      x: Math.min(1, Math.max(0, p.x)),
      y: Math.min(1, Math.max(0, p.y)),
      s: Math.min(SIZE_MAX, Math.max(SIZE_MIN, p.s)),
    };
  }
  return out;
}
