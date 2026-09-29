// Background music: streamed <audio> elements routed through the shared AudioContext.
// Each track loops by cross-fading its own tail into its head (two elements taking turns),
// switching tracks cross-fades too, and `duck()` fades everything to silence (just-dodge slow-mo).
import { settings } from '../app/settings';
import { audioCtx, onAudioUnlock } from './sfx';

export type Track = 'menu' | 'battle';

const FILES: Record<Track, string> = { menu: 'audio/menu.mp3', battle: 'audio/battle.mp3' };
/** Per-track level trim (the two tracks are mastered differently). */
const TRIM: Record<Track, number> = { menu: 0.8, battle: 0.7 };
const LOOP_FADE = 4; // s: tail → head cross-fade at the loop point
const SWITCH_FADE = 1.2; // s: track change
const IN_CURVE = Float32Array.from({ length: 33 }, (_, i) => Math.sin((i / 32) * Math.PI / 2));
const OUT_CURVE = Float32Array.from({ length: 33 }, (_, i) => Math.cos((i / 32) * Math.PI / 2));

interface Voice {
  el: HTMLAudioElement;
  gain: GainNode;
}

interface Player {
  track: Track;
  bus: GainNode;
  voices: [Voice, Voice];
  active: 0 | 1;
  fading: boolean;
}

let vol: GainNode | null = null;
let duckG: GainNode | null = null;
const players: Partial<Record<Track, Player>> = {};
let want: Track | null = null;
let playing: Track | null = null;
let ducked = false;
let timer = 0;

function graph(): boolean {
  const ctx = audioCtx();
  if (!ctx) return false;
  if (!vol) {
    vol = ctx.createGain();
    vol.gain.value = settings.bgmVolume;
    duckG = ctx.createGain();
    duckG.gain.value = ducked ? 0 : 1;
    duckG.connect(vol).connect(ctx.destination);
  }
  return true;
}

function player(track: Track): Player {
  let p = players[track];
  if (p) return p;
  const ctx = audioCtx()!;
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(duckG!);
  const url = new URL(FILES[track], document.baseURI).href;
  const mk = (): Voice => {
    const el = new Audio(url);
    el.preload = 'auto';
    el.loop = false;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    ctx.createMediaElementSource(el).connect(gain).connect(bus);
    return { el, gain };
  };
  p = { track, bus, voices: [mk(), mk()], active: 0, fading: false };
  players[track] = p;
  return p;
}

function ramp(g: AudioParam, curve: Float32Array, t: number, dur: number): void {
  g.cancelScheduledValues(t);
  g.setValueCurveAtTime(curve, t, dur);
}

function start(track: Track): void {
  const ctx = audioCtx()!;
  const p = player(track);
  const v = p.voices[p.active];
  v.el.currentTime = 0;
  void v.el.play().catch(() => undefined); // blocked → retried on the next gesture
  const t = ctx.currentTime;
  p.bus.gain.cancelScheduledValues(t);
  p.bus.gain.setValueAtTime(p.bus.gain.value, t);
  p.bus.gain.linearRampToValueAtTime(TRIM[track], t + SWITCH_FADE);
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setValueAtTime(1, t);
  p.fading = false;
  playing = track;
}

function stop(track: Track): void {
  const ctx = audioCtx();
  const p = players[track];
  if (!ctx || !p) return;
  const t = ctx.currentTime;
  p.bus.gain.cancelScheduledValues(t);
  p.bus.gain.setValueAtTime(p.bus.gain.value, t);
  p.bus.gain.linearRampToValueAtTime(0, t + SWITCH_FADE);
  setTimeout(() => {
    if (playing === track) return; // came back meanwhile
    for (const v of p.voices) v.el.pause();
  }, SWITCH_FADE * 1000 + 100);
}

/** Loop cross-fade: shortly before the end, the other element takes over from 0. */
function tick(): void {
  const ctx = audioCtx();
  if (!ctx || !playing || document.hidden) return;
  const p = players[playing];
  if (!p) return;
  const cur = p.voices[p.active];
  const dur = cur.el.duration;
  if (!isFinite(dur) || dur < LOOP_FADE * 3 || p.fading) return;
  if (cur.el.currentTime < dur - LOOP_FADE) return;
  const next = p.voices[(p.active ^ 1) as 0 | 1];
  p.fading = true;
  next.el.currentTime = 0;
  void next.el.play().catch(() => undefined);
  const t = ctx.currentTime;
  ramp(next.gain.gain, IN_CURVE, t, LOOP_FADE);
  ramp(cur.gain.gain, OUT_CURVE, t, LOOP_FADE);
  const from = cur;
  setTimeout(() => {
    from.el.pause();
    p.active = (p.active ^ 1) as 0 | 1;
    p.fading = false;
  }, LOOP_FADE * 1000 + 100);
}

function apply(): void {
  if (!want || !graph()) return;
  if (!timer) timer = window.setInterval(tick, 200);
  if (playing === want) {
    const p = players[want];
    // an autoplay-blocked element: retry
    if (p) {
      const v = p.voices[p.active];
      if (v.el.paused && !p.fading) void v.el.play().catch(() => undefined);
    }
    return;
  }
  if (playing) stop(playing);
  start(want);
}

export function setBgmVolume(v: number): void {
  if (vol) vol.gain.value = v;
}

export const bgm = {
  /** Switch the music (no-op if already playing). Starts once audio is unlocked by a gesture. */
  play(track: Track): void {
    want = track;
    apply();
  },
  /** Fade to silence (true) / back (false) — used for the just-dodge slow-motion. */
  duck(on: boolean): void {
    if (on === ducked) return;
    ducked = on;
    const ctx = audioCtx();
    if (!ctx || !duckG) return;
    const t = ctx.currentTime;
    duckG.gain.cancelScheduledValues(t);
    duckG.gain.setValueAtTime(duckG.gain.value, t);
    duckG.gain.setTargetAtTime(on ? 0 : 1, t, on ? 0.07 : 0.4);
  },
};

onAudioUnlock(apply);
document.addEventListener('visibilitychange', () => {
  if (!playing) return;
  const p = players[playing];
  if (!p) return;
  for (const v of p.voices) {
    if (document.hidden) v.el.pause();
  }
  if (!document.hidden) apply();
});

if (import.meta.env.DEV) (window as unknown as { __bgm: unknown }).__bgm = { players, state: () => ({ want, playing, ducked }) };
