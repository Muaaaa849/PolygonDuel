// Seeded PRNG (xorshift32). Math.random can't be synchronized between devices (plan §9-5).
export class Rng {
  private x: number;
  constructor(seed: number) {
    this.x = seed | 0 || 0x9e3779b9;
  }
  next(): number {
    let x = this.x;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.x = x | 0;
    return (x >>> 0) / 4294967296;
  }
  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}
