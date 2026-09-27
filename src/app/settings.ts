// Per-device preferences. localStorage may be unavailable (private mode) → defaults.
// Everything can also be exported / imported as a JSON file (settings screen).
import { sanitizeLayout, type ControlsLayout } from '../input/layout';

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
  showBrief: boolean;
  tutorialDone: boolean;
  lastChar: string;
  cpuLevel: number;
  playerName: string;
  /** Custom touch control layout (null = built-in). */
  layout: ControlsLayout | null;
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
  showBrief: true,
  tutorialDone: false,
  lastChar: 'blaze',
  cpuLevel: 1,
  playerName: '',
  layout: null,
};

const KEY = 'polygon-duel.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
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

const EXPORT_KEYS: (keyof Settings)[] = ['volume', 'haptics', 'lefty', 'buttonScale', 'quality', 'reduceFlash', 'dynamicCamera', 'aimMode', 'showBrief', 'layout'];

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
    if (typeof v === typeof DEFAULTS[k]) (patch as Record<string, unknown>)[k] = v;
  }
  saveSettings(patch);
}

export function applySettingsToDom(): void {
  document.documentElement.style.setProperty('--btn-scale', String(settings.buttonScale));
}
