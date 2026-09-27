// Link rooms (play with someone far away): the free public PeerJS signaling server
// (0.peerjs.com) is used ONLY to swap the WebRTC offer / answer / ICE candidates.
// The match itself stays peer-to-peer on our own DataChannels (transport.ts).
//
// The server relays only PeerJS-shaped messages, so ours ride inside a CANDIDATE
// envelope as a JSON string: { candidate: { candidate: "<our json>" }, type, connectionId }.
// A message to an id nobody holds comes back as EXPIRE → "room not found".

const DEFAULT_SERVER = 'wss://0.peerjs.com:443/peerjs?key=peerjs';
/** Dev only: point at a local PeerJS server (`localStorage['pd.relay'] = 'ws://localhost:9000/peerjs?key=peerjs'`). */
function serverUrl(): string {
  if (import.meta.env.DEV) {
    try {
      return localStorage.getItem('pd.relay') || DEFAULT_SERVER;
    } catch {
      /* storage unavailable */
    }
  }
  return DEFAULT_SERVER;
}
const HEARTBEAT_MS = 5000;
const ROOM_ID_PREFIX = 'polygonduel-';
/** Room codes: no I / O / 0 / 1 so they can be read aloud or typed. */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LEN = 6;

/** PeerJS's public TURN (best effort) so strict mobile NATs can still connect. */
export const RELAY_ICE: RTCIceServer[] = [
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

export type RoomMsg = { t: string; [k: string]: unknown };

export function newRoomCode(): string {
  const r = new Uint32Array(ROOM_CODE_LEN);
  crypto.getRandomValues(r);
  return Array.from(r, (v) => CODE_CHARS[v % CODE_CHARS.length]).join('');
}

/** Find a room code in user input: a bare code, a link (#room=…), or a pasted invite message. */
export function parseRoomCode(text: string): string | null {
  const valid = (c: string) => c.length === ROOM_CODE_LEN && [...c].every((ch) => CODE_CHARS.includes(ch));
  const m = /room=([A-Za-z0-9]{6})(?![A-Za-z0-9])/i.exec(text);
  if (m && valid(m[1].toUpperCase())) return m[1].toUpperCase();
  for (const t of text.split(/[^A-Za-z0-9]+/)) if (valid(t.toUpperCase())) return t.toUpperCase();
  return null;
}

export const roomPeerId = (code: string): string => ROOM_ID_PREFIX + code;
export const roomLink = (code: string): string => `${location.origin}${location.pathname}#room=${code}`;

const randomToken = () => Math.random().toString(36).slice(2, 12);

export class Relay {
  onMessage?: (from: string, m: RoomMsg) => void;
  /** A message could not be delivered: `peer` is not connected. */
  onExpire?: (peer: string) => void;
  /** The server connection dropped (after having been open). */
  onDrop?: () => void;
  private ws: WebSocket | null = null;
  private hb = 0;
  private closed = false;

  constructor(readonly id: string) {}

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Connect and claim `id`. Rejects with 'id-taken' / 'timeout' / 'unreachable'. */
  connect(timeoutMs = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (why: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(new Error(why));
      };
      let ws: WebSocket;
      try {
        ws = new WebSocket(`${serverUrl()}&id=${encodeURIComponent(this.id)}&token=${randomToken()}&version=1.5.4`);
      } catch {
        reject(new Error('unreachable'));
        return;
      }
      const timer = setTimeout(() => fail('timeout'), timeoutMs);
      ws.onmessage = (e) => {
        let m: { type?: string; src?: string; payload?: { candidate?: { candidate?: string }; msg?: string } };
        try {
          m = JSON.parse(e.data as string);
        } catch {
          return;
        }
        if (!settled) {
          if (m.type === 'OPEN') {
            settled = true;
            clearTimeout(timer);
            this.ws = ws;
            this.hb = window.setInterval(() => this.raw({ type: 'HEARTBEAT' }), HEARTBEAT_MS);
            resolve();
          } else if (m.type === 'ID-TAKEN') fail('id-taken');
          else if (m.type === 'ERROR') fail(m.payload?.msg ?? 'error');
          return;
        }
        if (m.type === 'EXPIRE' && m.src) this.onExpire?.(m.src);
        else if (m.type === 'CANDIDATE' && m.src && typeof m.payload?.candidate?.candidate === 'string') {
          try {
            const msg = JSON.parse(m.payload.candidate.candidate) as RoomMsg;
            if (msg && typeof msg.t === 'string') this.onMessage?.(m.src, msg);
          } catch {
            /* not ours */
          }
        }
      };
      ws.onerror = () => fail('unreachable');
      ws.onclose = () => {
        if (!settled) return fail('unreachable');
        if (this.ws !== ws) return;
        clearInterval(this.hb);
        this.ws = null;
        if (!this.closed) this.onDrop?.();
      };
    });
  }

  send(dst: string, msg: RoomMsg): boolean {
    return this.raw({
      type: 'CANDIDATE',
      dst,
      payload: { candidate: { candidate: JSON.stringify(msg), sdpMid: '0', sdpMLineIndex: 0 }, type: 'data', connectionId: 'dc_polygonduel' },
    });
  }

  private raw(o: object): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(o));
    return true;
  }

  close(): void {
    this.closed = true;
    clearInterval(this.hb);
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}
