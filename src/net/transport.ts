// WebRTC P2P link (plan §9). Two negotiated DataChannels:
//  - "game": unordered, no retransmits → input packets (never wait for a lost packet)
//  - "ctrl": reliable, ordered → lobby messages, pings, rematch
import { decodeSignal, encodeSignal } from './qr-signaling';

export type PathKind = 'direct' | 'stun' | 'relay' | 'unknown';

export interface LinkInfo {
  path: PathKind;
  localType: string;
  remoteType: string;
  rttMs: number;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
];

export type CtrlMessage = { t: string; [k: string]: unknown };

export class PeerLink {
  pc: RTCPeerConnection;
  game: RTCDataChannel;
  ctrl: RTCDataChannel;
  onGame?: (data: Uint8Array) => void;
  onCtrl?: (msg: CtrlMessage) => void;
  onOpen?: () => void;
  onClose?: (reason: string) => void;
  onStateChange?: (state: string) => void;
  rttMs = 0;
  private opened = 0;
  private closed = false;
  private pingTimer = 0;
  private pingSeq = 0;
  private pings = new Map<number, number>();
  private rttSamples: number[] = [];

  constructor(extraIce: RTCIceServer[] = []) {
    this.pc = new RTCPeerConnection({ iceServers: [...ICE_SERVERS, ...extraIce], bundlePolicy: 'max-bundle' });
    this.game = this.pc.createDataChannel('game', { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
    this.ctrl = this.pc.createDataChannel('ctrl', { negotiated: true, id: 1, ordered: true });
    for (const ch of [this.game, this.ctrl]) {
      ch.binaryType = 'arraybuffer';
      ch.onopen = () => {
        this.opened++;
        if (this.opened === 2) this.handleOpen();
      };
      ch.onclose = () => this.handleClose('channel closed');
    }
    this.game.onmessage = (e) => this.onGame?.(new Uint8Array(e.data as ArrayBuffer));
    this.ctrl.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as CtrlMessage;
        if (msg.t === 'ping') this.sendCtrl({ t: 'pong', id: msg.id });
        else if (msg.t === 'pong') this.handlePong(msg.id as number);
        else this.onCtrl?.(msg);
      } catch {
        /* ignore malformed */
      }
    };
    this.pc.onconnectionstatechange = () => {
      this.onStateChange?.(this.pc.connectionState);
      if (this.pc.connectionState === 'failed') this.handleClose('接続に失敗しました');
      if (this.pc.connectionState === 'closed') this.handleClose('切断されました');
    };
    this.pc.oniceconnectionstatechange = () => {
      if (this.pc.iceConnectionState === 'disconnected') this.onStateChange?.('disconnected');
    };
  }

  /** Host: create the offer code (waits for ICE gathering). */
  async createOffer(build: string): Promise<string> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.waitGathering();
    return encodeSignal(this.pc.localDescription!.sdp, 'offer', build);
  }

  /** Guest: take the host's code, return our answer code. */
  async acceptOffer(text: string, build: string): Promise<{ answer: string; remoteBuild: string }> {
    const sig = decodeSignal(text);
    if (sig.type !== 'offer') throw new Error('これは「部屋を作る」側のコードではありません');
    await this.pc.setRemoteDescription({ type: 'offer', sdp: sig.sdp });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.waitGathering();
    return { answer: encodeSignal(this.pc.localDescription!.sdp, 'answer', build), remoteBuild: sig.build };
  }

  /** Host: apply the guest's answer. */
  async acceptAnswer(text: string): Promise<{ remoteBuild: string }> {
    const sig = decodeSignal(text);
    if (sig.type !== 'answer') throw new Error('これは「部屋に入る」側のコードではありません');
    await this.pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp });
    return { remoteBuild: sig.build };
  }

  /** Candidates must all be in the QR (no trickle), so wait — but not forever (no STUN offline). */
  private waitGathering(timeoutMs = 2500): Promise<void> {
    if (this.pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      };
      const check = () => {
        if (this.pc.iceGatheringState === 'complete') done();
      };
      const timer = setTimeout(done, timeoutMs);
      this.pc.addEventListener('icegatheringstatechange', check);
    });
  }

  private handleOpen(): void {
    this.pingTimer = window.setInterval(() => this.ping(), 500);
    this.ping();
    this.onOpen?.();
  }

  private handleClose(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pingTimer);
    this.onClose?.(reason);
  }

  get isOpen(): boolean {
    return this.game.readyState === 'open' && this.ctrl.readyState === 'open';
  }

  sendGame(data: Uint8Array): void {
    if (this.game.readyState === 'open') {
      try {
        this.game.send(data as Uint8Array<ArrayBuffer>);
      } catch {
        /* buffer full / closing: drop like a lost packet */
      }
    }
  }

  sendCtrl(msg: CtrlMessage): void {
    if (this.ctrl.readyState === 'open') this.ctrl.send(JSON.stringify(msg));
  }

  private ping(): void {
    const id = ++this.pingSeq;
    this.pings.set(id, performance.now());
    if (this.pings.size > 20) this.pings.delete(this.pings.keys().next().value!);
    this.sendCtrl({ t: 'ping', id });
  }

  private handlePong(id: number): void {
    const t0 = this.pings.get(id);
    if (t0 === undefined) return;
    this.pings.delete(id);
    this.rttSamples.push(performance.now() - t0);
    if (this.rttSamples.length > 10) this.rttSamples.shift();
    const sorted = [...this.rttSamples].sort((a, b) => a - b);
    this.rttMs = sorted[Math.floor(sorted.length / 2)];
  }

  /** Classify the selected ICE path: host↔host = direct (LAN / tethering). */
  async info(): Promise<LinkInfo> {
    const res: LinkInfo = { path: 'unknown', localType: '?', remoteType: '?', rttMs: this.rttMs };
    try {
      const stats = await this.pc.getStats();
      let pair: RTCIceCandidatePairStats | undefined;
      stats.forEach((s) => {
        if (s.type === 'transport' && (s as RTCTransportStats).selectedCandidatePairId) {
          pair = stats.get((s as RTCTransportStats).selectedCandidatePairId!) as RTCIceCandidatePairStats;
        }
      });
      if (!pair) {
        stats.forEach((s) => {
          const p = s as RTCIceCandidatePairStats & { selected?: boolean };
          if (s.type === 'candidate-pair' && (p.nominated || p.selected) && p.state === 'succeeded') pair = p;
        });
      }
      if (pair) {
        const l = stats.get(pair.localCandidateId) as { candidateType?: string } | undefined;
        const r = stats.get(pair.remoteCandidateId) as { candidateType?: string } | undefined;
        res.localType = l?.candidateType ?? '?';
        res.remoteType = r?.candidateType ?? '?';
        const types = [res.localType, res.remoteType];
        if (types.includes('relay')) res.path = 'relay';
        else if (types.includes('srflx')) res.path = 'stun';
        else res.path = 'direct';
        if (pair.currentRoundTripTime) res.rttMs = pair.currentRoundTripTime * 1000;
      }
    } catch {
      /* stats unsupported */
    }
    return res;
  }

  close(): void {
    this.handleClose('closed');
    try {
      this.game.close();
      this.ctrl.close();
      this.pc.close();
    } catch {
      /* ignore */
    }
  }
}

/** Ask for camera access (also unlocks real LAN IP candidates instead of mDNS names). */
export async function requestCamera(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch {
    return null;
  }
}
