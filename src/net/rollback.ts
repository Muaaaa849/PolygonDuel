// Rollback session (plan §9-3, §9-4): predict the remote input, simulate ahead,
// and re-simulate from the first mispredicted frame when real inputs arrive.
// Inputs are sent redundantly (every unacked frame) over an unordered, unreliable channel.
import { Sim } from '../core/sim';
import { SNAPSHOT_SIZE, hashSnapshot, loadState, saveState } from '../core/state';
import type { SimEvent } from '../core/events';

const RING = 256; // input ring (frames)
const SNAPS = 32; // snapshot ring (frames)
const MAX_SEND = 32; // max inputs per packet
export const CHECKSUM_INTERVAL = 30;

export const PKT_INPUT = 1;

export interface RollbackOptions {
  local: 0 | 1;
  inputDelay: number;
  maxRollback?: number;
  send: (pkt: Uint8Array) => void;
  onEvents?: (events: SimEvent[], resim: boolean) => void;
  onDesync?: (frame: number, local: number, remote: number) => void;
}

export interface NetStats {
  frame: number;
  rollbacks: number;
  rollbackFrames: number;
  maxRollbackSeen: number;
  stalls: number;
  syncSkips: number;
  checksumsCompared: number;
  desyncs: number;
  remoteAdvantage: number;
  localAdvantage: number;
}

export class RollbackSession {
  readonly sim: Sim;
  readonly local: 0 | 1;
  inputDelay: number;
  maxRollback: number;
  private sendFn: (pkt: Uint8Array) => void;
  onEvents?: (events: SimEvent[], resim: boolean) => void;
  onDesync?: (frame: number, local: number, remote: number) => void;

  /** Number of frames simulated so far (= index of the next frame to simulate). */
  frame = 0;
  private localIn = new Int32Array(RING);
  /** Highest frame index with a local input queued. */
  private localHead = -1;
  private remoteIn = new Int32Array(RING);
  private remoteHave = new Uint8Array(RING);
  /** Highest contiguous remote frame received. */
  remoteConfirmed = -1;
  /** Remote input actually used when simulating each frame. */
  private usedRemote = new Int32Array(RING);
  /** Earliest frame needing re-simulation, or -1. */
  private rollbackFrom = -1;
  /** Highest local frame the peer has acknowledged. */
  private peerAck = -1;

  private snaps: Int32Array[] = [];
  private snapFrame = new Int32Array(SNAPS).fill(-1);

  // time sync
  private remoteFrameSeen = 0;
  private remoteAdv = 0;
  private lastSyncSkip = 0;
  rttFrames = 0;

  // checksums
  private localSums = new Map<number, number>();
  private sumHistory = new Map<number, number>();
  private pendingSum: { frame: number; hash: number } | null = null;
  private nextSumFrame = CHECKSUM_INTERVAL;

  stats: NetStats = {
    frame: 0, rollbacks: 0, rollbackFrames: 0, maxRollbackSeen: 0, stalls: 0, syncSkips: 0,
    checksumsCompared: 0, desyncs: 0, remoteAdvantage: 0, localAdvantage: 0,
  };

  constructor(sim: Sim, opts: RollbackOptions) {
    this.sim = sim;
    this.local = opts.local;
    this.inputDelay = opts.inputDelay;
    this.maxRollback = opts.maxRollback ?? 8;
    this.sendFn = opts.send;
    this.onEvents = opts.onEvents;
    this.onDesync = opts.onDesync;
    for (let i = 0; i < SNAPS; i++) this.snaps.push(new Int32Array(SNAPSHOT_SIZE));
    // frames before the input delay elapses use neutral input
    for (let f = 0; f < this.inputDelay; f++) this.localIn[f % RING] = 0;
    this.localHead = this.inputDelay - 1;
  }

  /** How many frames we are ahead of the confirmed remote input. */
  get predictionDepth(): number {
    return this.frame - 1 - this.remoteConfirmed;
  }

  /**
   * Advance one tick with the current local input. Returns false if we had to
   * stall (waiting for the peer or slowing down for time sync).
   */
  tick(localInput: number): boolean {
    this.applyRollback();

    // stall if we'd predict too far ahead
    if (this.frame - this.remoteConfirmed > this.maxRollback) {
      this.stats.stalls++;
      this.sendInputs();
      return false;
    }
    // time sync: if we're consistently ahead of the peer, give it a frame
    const localAdv = this.frame - (this.remoteFrameSeen + this.rttFrames / 2);
    this.stats.localAdvantage = localAdv;
    this.stats.remoteAdvantage = this.remoteAdv;
    const ahead = (localAdv - this.remoteAdv) / 2;
    if (ahead >= 1 && this.frame - this.lastSyncSkip > 20) {
      this.lastSyncSkip = this.frame;
      this.stats.syncSkips++;
      this.sendInputs();
      return false;
    }

    // queue local input
    const target = this.frame + this.inputDelay;
    while (this.localHead < target) {
      this.localHead++;
      this.localIn[this.localHead % RING] = localInput;
    }

    this.advance(false);
    this.checkSums();
    this.sendInputs();
    return true;
  }

  private remoteFor(f: number): number {
    if (f <= this.remoteConfirmed) return this.remoteIn[f % RING];
    return this.remoteConfirmed >= 0 ? this.remoteIn[this.remoteConfirmed % RING] : 0;
  }

  private advance(resim: boolean): void {
    const f = this.frame;
    const slot = f % SNAPS;
    saveState(this.sim.s, this.snaps[slot]);
    this.snapFrame[slot] = f;
    const li = this.localIn[f % RING];
    const ri = this.remoteFor(f);
    this.usedRemote[f % RING] = ri;
    if (this.local === 0) this.sim.step(li, ri);
    else this.sim.step(ri, li);
    this.frame++;
    this.stats.frame = this.frame;
    if (this.onEvents && this.sim.events.length) this.onEvents(this.sim.events, resim);
  }

  private applyRollback(): void {
    const from = this.rollbackFrom;
    if (from < 0) return;
    this.rollbackFrom = -1;
    if (from >= this.frame) return;
    const slot = from % SNAPS;
    if (this.snapFrame[slot] !== from) throw new Error(`rollback snapshot missing for frame ${from}`);
    const target = this.frame;
    const depth = target - from;
    this.stats.rollbacks++;
    this.stats.rollbackFrames += depth;
    if (depth > this.stats.maxRollbackSeen) this.stats.maxRollbackSeen = depth;
    loadState(this.sim.s, this.snaps[slot]);
    this.frame = from;
    while (this.frame < target) this.advance(true);
  }

  /** Called with every datagram from the peer. */
  receive(data: Uint8Array): void {
    if (data.length < 1 || data[0] !== PKT_INPUT) return;
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let o = 1;
    const ack = v.getInt32(o, true); o += 4;
    const remoteFrame = v.getInt32(o, true); o += 4;
    const adv = v.getInt8(o); o += 1;
    const first = v.getInt32(o, true); o += 4;
    const count = v.getUint8(o); o += 1;
    if (ack > this.peerAck) this.peerAck = ack;
    if (remoteFrame > this.remoteFrameSeen) {
      this.remoteFrameSeen = remoteFrame;
      this.remoteAdv = adv;
    }
    for (let k = 0; k < count; k++) {
      const f = first + k;
      const w = v.getUint16(o, true); o += 2;
      if (f <= this.remoteConfirmed) continue;
      if (f >= this.frame + RING - SNAPS) continue; // absurdly far ahead; ignore
      const idx = f % RING;
      if (!this.remoteHave[idx] || this.remoteIn[idx] !== w) {
        this.remoteIn[idx] = w;
      }
      this.remoteHave[idx] = 1;
    }
    // advance the contiguous pointer and detect mispredictions
    while (this.remoteHave[(this.remoteConfirmed + 1) % RING] && this.remoteConfirmed + 1 <= this.localHead + RING / 2) {
      const f = this.remoteConfirmed + 1;
      const idx = f % RING;
      this.remoteConfirmed = f;
      // clear the slot that will be reused RING frames later
      this.remoteHave[(f + RING / 2) % RING] = 0;
      if (f < this.frame && this.usedRemote[idx] !== this.remoteIn[idx]) {
        if (this.rollbackFrom < 0 || f < this.rollbackFrom) this.rollbackFrom = f;
      }
    }
    // checksum from the peer
    if (o + 8 <= data.length) {
      const sf = v.getInt32(o, true); o += 4;
      const sh = v.getUint32(o, true); o += 4;
      if (sf > 0) {
        const mine = this.localSums.get(sf);
        if (mine !== undefined) {
          this.stats.checksumsCompared++;
          if (mine !== sh) {
            this.stats.desyncs++;
            this.onDesync?.(sf, mine, sh);
          }
          this.localSums.delete(sf);
        }
      }
    }
  }

  /** Record hashes for frames whose inputs are fully confirmed. */
  private checkSums(): void {
    // A snapshot at frame f is final once all inputs < f are confirmed.
    while (this.nextSumFrame < this.frame && this.nextSumFrame - 1 <= this.remoteConfirmed && this.rollbackFrom < 0) {
      const f = this.nextSumFrame;
      const slot = f % SNAPS;
      if (this.snapFrame[slot] === f) {
        const h = hashSnapshot(this.snaps[slot]);
        this.localSums.set(f, h);
        this.sumHistory.set(f, h);
        if (this.sumHistory.size > 512) this.sumHistory.delete(this.sumHistory.keys().next().value!);
        this.pendingSum = { frame: f, hash: h };
        if (this.localSums.size > 64) {
          const oldest = this.localSums.keys().next().value!;
          this.localSums.delete(oldest);
        }
      }
      this.nextSumFrame += CHECKSUM_INTERVAL;
    }
  }

  private sendInputs(): void {
    const first = Math.max(this.peerAck + 1, this.localHead - MAX_SEND + 1, 0);
    const count = Math.max(0, Math.min(MAX_SEND, this.localHead - first + 1));
    const buf = new Uint8Array(15 + count * 2 + 8);
    const v = new DataView(buf.buffer);
    let o = 0;
    v.setUint8(o, PKT_INPUT); o += 1;
    v.setInt32(o, this.remoteConfirmed, true); o += 4;
    v.setInt32(o, this.frame, true); o += 4;
    const adv = Math.max(-127, Math.min(127, Math.round(this.stats.localAdvantage)));
    v.setInt8(o, adv); o += 1;
    v.setInt32(o, first, true); o += 4;
    v.setUint8(o, count); o += 1;
    for (let k = 0; k < count; k++) {
      v.setUint16(o, this.localIn[(first + k) % RING], true);
      o += 2;
    }
    v.setInt32(o, this.pendingSum?.frame ?? 0, true); o += 4;
    v.setUint32(o, this.pendingSum?.hash ?? 0, true);
    this.sendFn(buf);
  }

  /** Force a packet (e.g. from a keepalive timer while paused). */
  flush(): void {
    this.sendInputs();
  }

  /** Hash of the confirmed state at `frame`, if recorded. */
  sumAt(frame: number): number | undefined {
    return this.sumHistory.get(frame);
  }
}
