// WebAudio-synthesized sound effects (plan §10): no asset files, no licensing.
// Hits change pitch by shape so the shape can be "heard" as well.
import { settings } from '../app/settings';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let comp: DynamicsCompressorNode | null = null;
let noiseBuf: AudioBuffer | null = null;

/** Must be called from a user gesture (iOS). */
export function unlockAudio(): void {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = settings.volume;
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

export function setVolume(v: number): void {
  if (master) master.gain.value = v;
}

type Wave = OscillatorType;

function tone(freq: number, dur: number, type: Wave = 'sine', gain = 0.3, slideTo?: number, delay = 0): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, freq: number, q = 1, gain = 0.3, type: BiquadFilterType = 'bandpass', slideTo?: number, delay = 0): void {
  if (!ctx || !master || !noiseBuf) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

export const sfx = {
  hit(heavy: boolean, counter: boolean) {
    const base = heavy ? 90 : 150;
    tone(base * 2, 0.12, 'square', 0.12, base);
    noise(heavy ? 0.22 : 0.12, heavy ? 1400 : 2400, 0.8, heavy ? 0.5 : 0.35);
    tone(base, heavy ? 0.3 : 0.16, 'sine', 0.5, 40);
    if (counter) tone(1320, 0.18, 'triangle', 0.15, 1760, 0.02);
  },
  block() {
    tone(1200, 0.07, 'triangle', 0.18, 700);
    noise(0.06, 5000, 2, 0.12, 'highpass');
  },
  crush() {
    noise(0.5, 3000, 0.5, 0.5, 'bandpass', 400);
    tone(220, 0.4, 'sawtooth', 0.15, 55);
    for (let i = 0; i < 5; i++) tone(1800 + Math.random() * 1600, 0.08, 'triangle', 0.08, undefined, 0.03 * i);
  },
  /** Just dodge: a bright glint, then time "winds down" (pitch-falling hum under the slow motion). */
  just() {
    tone(880, 0.35, 'sine', 0.25, 1760);
    tone(1320, 0.4, 'triangle', 0.12, 2640, 0.04);
    noise(0.4, 6000, 4, 0.08, 'bandpass', 12000);
    tone(220, 0.7, 'sawtooth', 0.07, 55, 0.05);
    tone(110, 0.75, 'sine', 0.3, 38, 0.05);
    noise(0.7, 2400, 1.2, 0.1, 'bandpass', 180, 0.05);
  },
  /** Arena-edge impact: heavy thump + a springy metallic "bwoing" that rides the edge's sine wobble. */
  wall(dmg: number) {
    const k = Math.min(1, dmg / 60);
    tone(95, 0.35, 'sine', 0.6, 32);
    noise(0.28, 900, 0.6, 0.55, 'lowpass', 120);
    noise(0.12, 4200, 1.5, 0.25, 'bandpass', 1800);
    // springy wobble: vibrato-like beating of two close tones sliding down
    tone(420 + 120 * k, 0.55, 'triangle', 0.14, 180, 0.02);
    tone(436 + 120 * k, 0.55, 'triangle', 0.12, 176, 0.02);
    for (let i = 0; i < 4; i++) tone(1600 + i * 420, 0.1, 'square', 0.035, 900, 0.02 + i * 0.035);
  },
  /** Illusion ends: an airy reversed swell (decoy dissolving) + a glassy chime (real one appearing). */
  ghostOut() {
    noise(0.3, 700, 1.2, 0.14, 'bandpass', 5200);
    tone(1480, 0.3, 'sine', 0.08, 740, 0.12);
    tone(1976, 0.35, 'triangle', 0.06, 988, 0.15);
    tone(330, 0.25, 'sine', 0.12, 660, 0.12);
  },
  /** JA teleport: a zipped-up swish that snaps into place. */
  blink() {
    noise(0.12, 1200, 1.5, 0.22, 'bandpass', 9000);
    tone(600, 0.1, 'sine', 0.12, 2400);
    tone(2400, 0.08, 'triangle', 0.1, 1200, 0.09);
  },
  riposte() {
    tone(660, 0.05, 'square', 0.15);
    tone(990, 0.3, 'sawtooth', 0.12, 330, 0.03);
    noise(0.25, 1800, 0.8, 0.45);
  },
  /** Attack start: the shape has a voice. circle = short blip, triangle = rising warning. */
  startup(shape: 'circle' | 'triangle' | 'pentagon' | 'hexagon' | 'diamond') {
    if (shape === 'diamond') {
      // diamond (shooting): a short bright "ting", unlike the triangle's rising warning
      tone(1760, 0.07, 'square', 0.05, 2400);
      tone(2640, 0.09, 'sine', 0.06, 3200, 0.02);
    } else if (shape === 'triangle') {
      tone(420, 0.28, 'sawtooth', 0.07, 840);
      tone(425, 0.28, 'square', 0.03, 850);
    } else if (shape === 'pentagon') {
      tone(520, 0.5, 'sine', 0.1, 780);
    } else if (shape === 'hexagon') {
      tone(300, 0.08, 'triangle', 0.08);
    } else {
      tone(700, 0.04, 'triangle', 0.05, 900);
    }
  },
  /** Bullet fired: a short "チュン". Later shots of a volley pitch up a little. */
  shot(n: number) {
    const k = 1 + (n - 1) * 0.08;
    tone(2200 * k, 0.09, 'square', 0.07, 900 * k);
    tone(3300 * k, 0.06, 'sine', 0.06, 1400 * k);
    noise(0.05, 7000, 2, 0.08, 'highpass');
  },
  /** A bullet landed: lighter than a melee hit. */
  shotHit() {
    tone(900, 0.06, 'square', 0.08, 400);
    noise(0.07, 3400, 1, 0.2);
  },
  /** Switch blast: point-blank shotgun boom. */
  blast() {
    noise(0.35, 1800, 0.5, 0.6, 'bandpass', 200);
    tone(140, 0.3, 'sine', 0.5, 40);
    for (let i = 0; i < 6; i++) tone(2000 + Math.random() * 2000, 0.05, 'square', 0.04, 800, 0.01 * i);
  },
  /** Mode switch: a mechanical rack (on) / release (off). */
  mode(on: boolean) {
    noise(0.04, 2600, 3, 0.18, 'bandpass', undefined, 0);
    noise(0.04, on ? 3400 : 1800, 3, 0.18, 'bandpass', undefined, 0.07);
    tone(on ? 880 : 660, 0.12, 'triangle', 0.08, on ? 1320 : 440, 0.07);
  },
  /** Static field placed: a humming charge. */
  field() {
    tone(120, 0.5, 'sawtooth', 0.06, 240);
    noise(0.5, 5000, 3, 0.05, 'bandpass', 9000);
  },
  /** Stepped into the field: an electric zap. */
  shock() {
    for (let i = 0; i < 4; i++) noise(0.05, 4000 + i * 900, 4, 0.22, 'bandpass', 1200, i * 0.035);
    tone(90, 0.25, 'sawtooth', 0.15, 60);
  },
  /** Jammed (out of ammo): the dry "カチッ" of an empty trigger. */
  jam() {
    tone(2600, 0.02, 'square', 0.12);
    noise(0.03, 3800, 6, 0.25, 'bandpass');
    tone(1900, 0.02, 'square', 0.1, undefined, 0.09);
    noise(0.03, 3000, 6, 0.2, 'bandpass', undefined, 0.09);
  },
  /** Dash thrust: a sharp air-tearing zip. */
  dash() {
    noise(0.18, 1500, 1.2, 0.2, 'bandpass', 8000);
    tone(500, 0.14, 'sawtooth', 0.05, 1500);
  },
  /** An attack caught a dash (×1.5): a heavy crack with a bright ring. */
  punish() {
    tone(1760, 0.25, 'triangle', 0.14, 880);
    tone(80, 0.35, 'sine', 0.5, 30);
    noise(0.3, 2200, 0.6, 0.5, 'bandpass', 300);
  },
  whoosh() {
    noise(0.14, 900, 0.7, 0.12, 'bandpass', 2600);
  },
  step() {
    noise(0.12, 600, 0.8, 0.14, 'bandpass', 2400);
  },
  heal() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'sine', 0.12, undefined, i * 0.06));
  },
  ko() {
    tone(160, 1.0, 'sawtooth', 0.2, 30);
    noise(0.9, 1200, 0.5, 0.4, 'lowpass', 100);
  },
  knockdown() {
    tone(120, 0.2, 'sine', 0.4, 50);
    noise(0.15, 400, 1, 0.2, 'lowpass');
  },
  round() {
    tone(440, 0.12, 'square', 0.08);
    tone(660, 0.18, 'square', 0.08, undefined, 0.12);
  },
  fight() {
    tone(330, 0.3, 'sawtooth', 0.12, 660);
    tone(880, 0.35, 'square', 0.08, 1320, 0.05);
    noise(0.3, 3000, 0.5, 0.15);
  },
  tick() {
    tone(1600, 0.03, 'square', 0.05);
  },
  ui() {
    tone(900, 0.05, 'triangle', 0.1, 1300);
  },
  back() {
    tone(700, 0.05, 'triangle', 0.08, 450);
  },
  confirm() {
    tone(660, 0.07, 'triangle', 0.12);
    tone(990, 0.12, 'triangle', 0.12, undefined, 0.06);
  },
  success() {
    [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.18, 'triangle', 0.1, undefined, i * 0.07));
  },
  guardBreakWarn() {
    tone(240, 0.1, 'square', 0.06);
  },
};

// ───────────── haptics (Android only; plan §10) ─────────────
export function vibrate(ms: number): void {
  if (!settings.haptics) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}
