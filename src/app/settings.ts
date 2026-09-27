// Per-device preferences. localStorage may be unavailable (private mode) → defaults.
export interface Settings {
  volume: number;
  haptics: boolean;
  lefty: boolean;
  buttonScale: number;
  quality: 'auto' | 'high' | 'mid' | 'low';
  reduceFlash: boolean;
  dynamicCamera: boolean;
  showBrief: boolean;
  tutorialDone: boolean;
  lastChar: string;
  cpuLevel: number;
  playerName: string;
}

const DEFAULTS: Settings = {
  volume: 0.7,
  haptics: true,
  lefty: false,
  buttonScale: 1,
  quality: 'auto',
  reduceFlash: false,
  dynamicCamera: true,
  showBrief: true,
  tutorialDone: false,
  lastChar: 'blaze',
  cpuLevel: 1,
  playerName: '',
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

export function applySettingsToDom(): void {
  document.documentElement.style.setProperty('--btn-scale', String(settings.buttonScale));
}
