// Per-device preferences. localStorage may be unavailable (private mode) → defaults.
// Everything can also be exported / imported as a JSON file (settings screen).
import { sanitizeLayout, type ControlsLayout } from '../input/layout';

/** Own key bindings per set (solo / local 1P / local 2P) and action; missing = default. */
export type KeyBindings = Partial<Record<'solo' | 'p1' | 'p2', Partial<Record<string, string[]>>>>;

export interface Settings {
  volume: number;
  haptics: boolean;
  lefty: boolean;
  buttonScale: number;
  quality: 'auto' | 'high' | 'mid' | 'low';
  reduceFlash: boolean;
  dynamicCamera: boolean;
  /** Touch: drag ATK / skill buttons to aim, release to fire. */
  aimMode: boolean;
  /** Guard: 'auto' = stand still (stick released) to guard; 'manual' = hold the GUARD button. */
  guardMode: 'auto' | 'manual';
  showBrief: boolean;
  tutorialDone: boolean;
  lastChar: string;
  cpuLevel: number;
  playerName: string;
  /** Custom touch control layout (null = built-in). */
  layout: ControlsLayout | null;
  /** Keyboard / mouse bindings (null = defaults). */
  keys: KeyBindings | null;
  /** On-screen touch controls: auto = only on touch devices. */
  touchControls: 'auto' | 'show' | 'hide';
  /** PC: attacks and skills go toward the mouse cursor (off: at the opponent). */
  mouseAim: boolean;
}

const DEFAULTS: Settings = {
  volume: 0.7,
  haptics: true,
  lefty: false,
  buttonScale: 1,
  quality: 'auto',
  reduceFlash: false,
  dynamicCamera: true,
  aimMode: true,
  guardMode: 'auto',
  showBrief: true,
  tutorialDone: false,
  lastChar: 'blaze',
  cpuLevel: 1,
  playerName: '',
  layout: null,
  keys: null,
  touchControls: 'auto',
  mouseAim: true,
};

const KEY = 'polygon-duel.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = { ...DEFAULTS, ...JSON.parse(raw) } as Settings;
      // (a layout saved by an older version may miss newer controls: fill them in)
      if (v.layout) v.layout = sanitizeLayout(v.layout);
      return v;
    }
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULTS };
}

export const settings: Settings = load();
const listeners = new Set<() => void>();

export function saveSettings(patch: Partial<Settings> = {}): void {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
  applySettingsToDom();
  listeners.forEach((l) => l());
}

export function onSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const EXPORT_KEYS: (keyof Settings)[] = ['volume', 'haptics', 'lefty', 'buttonScale', 'quality', 'reduceFlash', 'dynamicCamera', 'aimMode', 'guardMode', 'showBrief', 'layout', 'keys', 'touchControls', 'mouseAim'];

/** Settings as a portable JSON file (controls layout included). */
export function exportSettings(): string {
  const data: Record<string, unknown> = {};
  for (const k of EXPORT_KEYS) data[k] = settings[k];
  return JSON.stringify({ app: 'polygon-duel', kind: 'settings', version: 1, settings: data }, null, 2);
}

/** Apply an exported settings file. Throws with a readable message when it isn't one. */
export function importSettings(text: string): void {
  let j: { app?: string; settings?: Record<string, unknown> };
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('JSONとして読めませんでした');
  }
  if (j?.app !== 'polygon-duel' || !j.settings || typeof j.settings !== 'object') throw new Error('POLYGON DUEL の設定ファイルではありません');
  const patch: Partial<Settings> = {};
  for (const k of EXPORT_KEYS) {
    if (!(k in j.settings)) continue;
    const v = j.settings[k];
    if (k === 'layout') {
      (patch as Record<string, unknown>).layout = v === null ? null : sanitizeLayout(v);
      continue;
    }
    if (k === 'keys') {
      patch.keys = sanitizeKeys(v);
      continue;
    }
    if (k === 'touchControls') {
      if (v === 'auto' || v === 'show' || v === 'hide') patch.touchControls = v;
      continue;
    }
    if (k === 'guardMode') {
      if (v === 'auto' || v === 'manual') patch.guardMode = v;
      continue;
    }
    if (typeof v === typeof DEFAULTS[k]) (patch as Record<string, unknown>)[k] = v;
  }
  saveSettings(patch);
}

/** Keep only well-formed bindings (arrays of up to 2 code strings). */
export function sanitizeKeys(v: unknown): KeyBindings | null {
  if (!v || typeof v !== 'object') return null;
  const out: KeyBindings = {};
  for (const set of ['solo', 'p1', 'p2'] as const) {
    const m = (v as Record<string, unknown>)[set];
    if (!m || typeof m !== 'object') continue;
    const o: Partial<Record<string, string[]>> = {};
    for (const [a, codes] of Object.entries(m as Record<string, unknown>)) {
      if (Array.isArray(codes)) o[a] = codes.filter((c): c is string => typeof c === 'string' && c.length < 40).slice(0, 2);
    }
    out[set] = o;
  }
  return out;
}

/** Touch screen (phones, tablets): show the on-screen controls by default. */
export function isTouchDevice(): boolean {
  return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints ?? 0) > 0;
}

export function showTouchControls(): boolean {
  return settings.touchControls === 'show' || (settings.touchControls === 'auto' && isTouchDevice());
}

export function applySettingsToDom(): void {
  document.documentElement.style.setProperty('--btn-scale', String(settings.buttonScale));
}
