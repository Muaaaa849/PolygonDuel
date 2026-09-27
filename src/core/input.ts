// Quantized input word (plan §9-5): 32 directions + stick flag + 4 buttons = 10 bits.
// Direction 0 = +x (right), 8 = +y (down, screen space), 16 = left, 24 = up.
export const IN_DIR_MASK = 31;
export const IN_STICK = 1 << 5;
export const IN_ATK = 1 << 6;
export const IN_S1 = 1 << 7;
export const IN_S2 = 1 << 8;
export const IN_STEP = 1 << 9;
export const IN_BUTTONS = IN_ATK | IN_S1 | IN_S2 | IN_STEP;

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

/** Quantize a stick vector (screen space, y down) to one of 32 directions. */
export function quantizeDir(x: number, y: number): number {
  const a = Math.atan2(y, x); // client-side only; the sim never sees floats
  let d = Math.round((a / (Math.PI * 2)) * 32);
  d = ((d % 32) + 32) % 32;
  return d;
}
