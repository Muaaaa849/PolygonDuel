// QR signaling (plan §9-1): a DataChannel-only SDP needs just ICE ufrag/pwd,
// the DTLS fingerprint, the role and a few candidates. We pack those into
// ~80–120 bytes, encode as base32 (QR "alphanumeric" mode) and rebuild a full
// SDP on the other side. No signaling server involved.

const ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUV';
export const CODE_PREFIX = 'PD';
const VERSION = 1;

export interface CompactCandidate {
  type: 'host' | 'srflx' | 'relay' | 'prflx';
  /** IPv4 dotted, IPv6, or `<uuid>.local` */
  address: string;
  port: number;
}

export interface CompactSdp {
  type: 'offer' | 'answer';
  setup: 'actpass' | 'active' | 'passive';
  ufrag: string;
  pwd: string;
  /** 32 bytes of sha-256 fingerprint */
  fingerprint: Uint8Array;
  candidates: CompactCandidate[];
  /** 8 hex chars */
  build: string;
}

// ───────────── base32 ─────────────

export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let buf = 0;
  let bits = 0;
  for (const b of bytes) {
    buf = (buf << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHA[(buf >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buf &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHA[(buf << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array {
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of s.toUpperCase()) {
    const v = ALPHA.indexOf(ch);
    if (v < 0) throw new Error(`invalid code character: ${ch}`);
    buf = (buf << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((buf >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
    buf &= (1 << bits) - 1;
  }
  return new Uint8Array(out);
}

// ───────────── SDP parse / build ─────────────

export function parseSdp(sdp: string, type: 'offer' | 'answer', build: string): CompactSdp {
  const lines = sdp.split(/\r?\n/);
  const get = (prefix: string) => lines.find((l) => l.startsWith(prefix))?.slice(prefix.length).trim();
  const ufrag = get('a=ice-ufrag:');
  const pwd = get('a=ice-pwd:');
  const fp = get('a=fingerprint:');
  const setup = (get('a=setup:') ?? (type === 'offer' ? 'actpass' : 'active')) as CompactSdp['setup'];
  if (!ufrag || !pwd || !fp) throw new Error('SDP is missing ICE credentials or fingerprint');
  const [algo, hex] = fp.split(' ');
  if (algo.toLowerCase() !== 'sha-256') throw new Error(`unsupported fingerprint ${algo}`);
  const fingerprint = new Uint8Array(hex.split(':').map((h) => parseInt(h, 16)));
  const candidates: CompactCandidate[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    if (!l.startsWith('a=candidate:')) continue;
    const parts = l.slice('a=candidate:'.length).split(' ');
    // foundation component protocol priority address port typ type ...
    const [, component, protocol, , address, port, , ctype] = parts;
    if (component !== '1' || protocol.toLowerCase() !== 'udp') continue;
    const key = `${address}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ type: ctype as CompactCandidate['type'], address, port: parseInt(port, 10) });
  }
  return { type, setup, ufrag, pwd, fingerprint, candidates: pickCandidates(candidates), build };
}

/** Keep the most useful candidates (LAN first) so the QR stays small. */
function pickCandidates(c: CompactCandidate[]): CompactCandidate[] {
  const score = (x: CompactCandidate) => {
    const v4 = /^\d+\.\d+\.\d+\.\d+$/.test(x.address);
    const mdns = x.address.endsWith('.local');
    if (x.type === 'host' && v4) return 0;
    if (x.type === 'host' && mdns) return 1;
    if (x.type === 'srflx') return 2;
    if (x.type === 'host') return 3; // IPv6 host
    if (x.type === 'relay') return 4;
    return 5;
  };
  const sorted = [...c].sort((a, b) => score(a) - score(b));
  // at most 3 host v4, 1 mdns, 2 srflx, 1 v6, 1 relay; total ≤ 6
  const limits = [3, 1, 2, 1, 1, 1];
  const used = [0, 0, 0, 0, 0, 0];
  const out: CompactCandidate[] = [];
  for (const x of sorted) {
    const s = score(x);
    if (used[s] >= limits[s] || out.length >= 6) continue;
    used[s]++;
    out.push(x);
  }
  return out;
}

const TYPE_PREF = { host: 126, prflx: 110, srflx: 100, relay: 0 } as const;

export function buildSdp(c: CompactSdp): string {
  const lines = [
    'v=0',
    `o=- ${1000000 + ((c.ufrag.charCodeAt(0) * 7919) % 900000)} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
  ];
  c.candidates.forEach((cand, i) => {
    const prio = ((TYPE_PREF[cand.type] << 24) + ((65535 - i) << 8) + 255) >>> 0;
    let line = `a=candidate:${i + 1} 1 udp ${prio} ${cand.address} ${cand.port} typ ${cand.type}`;
    if (cand.type !== 'host') line += ' raddr 0.0.0.0 rport 0';
    lines.push(line);
  });
  lines.push(
    `a=ice-ufrag:${c.ufrag}`,
    `a=ice-pwd:${c.pwd}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${[...c.fingerprint].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':')}`,
    `a=setup:${c.setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    'a=end-of-candidates',
  );
  return lines.join('\r\n') + '\r\n';
}

// ───────────── binary packing ─────────────

const CT = ['host', 'srflx', 'relay', 'prflx'] as const;
const SETUPS = ['actpass', 'active', 'passive'] as const;

function ipv6ToBytes(a: string): Uint8Array | null {
  const [head, tail] = a.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  if (tail === undefined && h.length !== 8) return null;
  const groups = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  if (groups.length !== 8) return null;
  const out = new Uint8Array(16);
  groups.forEach((g, i) => {
    const v = parseInt(g || '0', 16);
    out[i * 2] = v >> 8;
    out[i * 2 + 1] = v & 0xff;
  });
  return out;
}

function bytesToIpv6(b: Uint8Array): string {
  const g: string[] = [];
  for (let i = 0; i < 16; i += 2) g.push(((b[i] << 8) | b[i + 1]).toString(16));
  return g.join(':');
}

export function packSdp(c: CompactSdp): Uint8Array {
  const out: number[] = [];
  const typeBit = c.type === 'answer' ? 1 : 0;
  out.push((VERSION << 4) | (typeBit << 2) | SETUPS.indexOf(c.setup));
  for (let i = 0; i < 4; i++) out.push(parseInt(c.build.slice(i * 2, i * 2 + 2), 16) || 0);
  const str = (s: string) => {
    out.push(s.length);
    for (const ch of s) out.push(ch.charCodeAt(0) & 0x7f);
  };
  str(c.ufrag);
  str(c.pwd);
  out.push(...c.fingerprint);
  const cands: number[][] = [];
  for (const cand of c.candidates) {
    const t = CT.indexOf(cand.type);
    if (t < 0) continue;
    let kind: number;
    let addr: number[];
    if (/^\d+\.\d+\.\d+\.\d+$/.test(cand.address)) {
      kind = 0;
      addr = cand.address.split('.').map((x) => parseInt(x, 10));
    } else if (cand.address.endsWith('.local')) {
      const hex = cand.address.slice(0, -6).replace(/-/g, '');
      if (!/^[0-9a-f]{32}$/i.test(hex)) continue;
      kind = 2;
      addr = hex.match(/../g)!.map((h) => parseInt(h, 16));
    } else {
      const b = ipv6ToBytes(cand.address);
      if (!b) continue;
      kind = 1;
      addr = [...b];
    }
    cands.push([t | (kind << 2), ...addr, cand.port >> 8, cand.port & 0xff]);
  }
  out.push(cands.length);
  for (const c2 of cands) out.push(...c2);
  return new Uint8Array(out);
}

export function unpackSdp(b: Uint8Array): CompactSdp {
  let o = 0;
  const need = (n: number) => {
    if (o + n > b.length) throw new Error('code is truncated');
  };
  need(5);
  const head = b[o++];
  if (head >> 4 !== VERSION) throw new Error('unsupported code version');
  const type = (head >> 2) & 1 ? 'answer' : 'offer';
  const setup = SETUPS[head & 3] ?? 'actpass';
  let build = '';
  for (let i = 0; i < 4; i++) build += b[o++].toString(16).padStart(2, '0');
  const str = () => {
    need(1);
    const n = b[o++];
    need(n);
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(b[o++]);
    return s;
  };
  const ufrag = str();
  const pwd = str();
  need(32);
  const fingerprint = b.slice(o, o + 32);
  o += 32;
  need(1);
  const n = b[o++];
  const candidates: CompactCandidate[] = [];
  for (let i = 0; i < n; i++) {
    need(1);
    const f = b[o++];
    const t = CT[f & 3];
    const kind = (f >> 2) & 3;
    let address: string;
    if (kind === 0) {
      need(4);
      address = [...b.slice(o, o + 4)].join('.');
      o += 4;
    } else if (kind === 1) {
      need(16);
      address = bytesToIpv6(b.slice(o, o + 16));
      o += 16;
    } else {
      need(16);
      const hex = [...b.slice(o, o + 16)].map((x) => x.toString(16).padStart(2, '0')).join('');
      address = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}.local`;
      o += 16;
    }
    need(2);
    const port = (b[o] << 8) | b[o + 1];
    o += 2;
    candidates.push({ type: t, address, port });
  }
  return { type, setup, ufrag, pwd, fingerprint, candidates, build };
}

/** SDP → short alphanumeric code (fits QR alphanumeric mode). */
export function encodeSignal(sdp: string, type: 'offer' | 'answer', build: string): string {
  return CODE_PREFIX + base32Encode(packSdp(parseSdp(sdp, type, build)));
}

/** Code (raw or inside a URL / pasted text) → parsed signal. */
export function decodeSignal(text: string): CompactSdp & { sdp: string } {
  const code = extractCode(text);
  if (!code) throw new Error('接続コードが見つかりません');
  const c = unpackSdp(base32Decode(code.slice(CODE_PREFIX.length)));
  return { ...c, sdp: buildSdp(c) };
}

export function extractCode(text: string): string | null {
  const m = text.toUpperCase().match(/PD[0-9A-V]{60,}/);
  return m ? m[0] : null;
}
