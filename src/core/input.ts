// Quantized input word (plan §9-5): 32 directions + stick flag + 4 buttons = 10 bits,
// plus an optional AIM (bits 10-20) sent on the frame an aimed button fires:
// 256 aim directions (≈1.4°, effectively free aim) and a 4-level reach (how far the move lunges / dashes).
// Direction 0 = +x (right), 8 = +y (down, screen space), 16 = left, 24 = up.
export const IN_DIR_MASK = 31;
export const IN_STICK = 1 << 5;
export const IN_ATK = 1 << 6;
export const IN_S1 = 1 << 7;
export const IN_S2 = 1 << 8;
export const IN_STEP = 1 << 9;
export const IN_BUTTONS = IN_ATK | IN_S1 | IN_S2 | IN_STEP;
export const IN_AIM = 1 << 10;
const AIM_DIR_SHIFT = 11; // 8 bits: 256 directions
const AIM_LVL_SHIFT = 19; // 2 bits: reach level 0..3
export const AIM_DIRS = 256;
export const AIM_LEVELS = 4;

/** Encode an aim (dir 0..255, level 0..3) into input bits. */
export const aimBits = (dir: number, level: number): number =>
  IN_AIM | ((dir & 255) << AIM_DIR_SHIFT) | ((level & 3) << AIM_LVL_SHIFT);
/** Aim angle in sim units (1024 / turn), or -1 when the word carries no aim. */
export const aimAngle = (w: number): number => (w & IN_AIM ? ((w >> AIM_DIR_SHIFT) & 255) * (1024 / AIM_DIRS) : -1);
export const aimLevel = (w: number): number => (w >> AIM_LVL_SHIFT) & 3;
/** Lunge / dash distance (%) for a reach level: 40, 60, 80, 100. */
export const aimLungePct = (level: number): number => 40 + level * 20;

export const dirOf = (w: number): number => w & IN_DIR_MASK;
/** Input direction → sim angle units (1024 / turn). */
export const dirAngle = (w: number): number => (w & IN_DIR_MASK) * 32;

export function makeInput(dir: number | null, atk = false, s1 = false, s2 = false, step = false): number {
  let w = 0;
  if (dir !== null) w |= IN_STICK | (dir & IN_DIR_MASK);
  if (atk) w |= IN_ATK;
  if (s1) w |= IN_S1;
  if (s2) w |= IN_S2;
  if (step) w |= IN_STEP;
  return w;
}

/** Quantize a stick vector (screen space, y down) to one of `n` directions (32 for the stick). */
export function quantizeDir(x: number, y: number, n = 32): number {
  const a = Math.atan2(y, x); // client-side only; the sim never sees floats
  let d = Math.round((a / (Math.PI * 2)) * n);
  d = ((d % n) + n) % n;
  return d;
}
