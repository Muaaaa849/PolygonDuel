import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, decodeSignal, encodeSignal, parseSdp } from '../src/net/qr-signaling';

const CHROME_OFFER = `v=0
o=- 4611731400430051336 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
a=extmap-allow-mixed
a=msid-semantic: WMS
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=candidate:2999745851 1 udp 2122260223 192.168.1.23 56143 typ host generation 0 network-id 1
a=candidate:1334211216 1 udp 2122194687 10.0.0.4 50122 typ host generation 0 network-id 2
a=candidate:3203328436 1 udp 2122129151 1b5c0e1f-8a3d-4e22-9d53-0a2f6c9f7d1e.local 51001 typ host generation 0
a=candidate:4233069003 1 tcp 1518280447 192.168.1.23 9 typ host tcptype active generation 0 network-id 1
a=candidate:842163049 1 udp 1686052607 203.0.113.9 56143 typ srflx raddr 192.168.1.23 rport 56143 generation 0 network-id 1
a=candidate:11 1 udp 2122063615 2001:db8::1:2 50000 typ host generation 0
a=ice-ufrag:Kx7Q
a=ice-pwd:3YfP9mcx0Lb+Kx1W2eFYk3Qp
a=ice-options:trickle
a=fingerprint:sha-256 7B:8B:F0:65:5F:78:E2:51:3B:AC:6F:F3:3F:46:1B:35:DC:B8:5F:64:1A:24:C2:43:F0:A1:58:D0:A1:2C:19:08
a=setup:actpass
a=mid:0
a=sctp-port:5000
a=max-message-size:262144
`;

describe('QR signaling', () => {
  it('base32 round-trips', () => {
    const b = new Uint8Array([0, 1, 2, 250, 255, 17, 99]);
    expect([...base32Decode(base32Encode(b))]).toEqual([...b]);
  });

  it('compresses an offer to a short alphanumeric code and rebuilds an equivalent SDP', () => {
    const code = encodeSignal(CHROME_OFFER, 'offer', 'a1b2c3d4');
    expect(code).toMatch(/^PD[0-9A-V]+$/);
    expect(code.length).toBeLessThan(260);
    const d = decodeSignal(`https://example.github.io/PolygonDuel/#${code}`);
    expect(d.type).toBe('offer');
    expect(d.build).toBe('a1b2c3d4');
    expect(d.ufrag).toBe('Kx7Q');
    expect(d.pwd).toBe('3YfP9mcx0Lb+Kx1W2eFYk3Qp');
    expect(d.setup).toBe('actpass');
    const re = parseSdp(d.sdp, 'offer', d.build);
    const orig = parseSdp(CHROME_OFFER, 'offer', 'a1b2c3d4');
    expect(re.fingerprint).toEqual(orig.fingerprint);
    const norm = (a: string) => (a.includes(':') ? a.replace('::1:2', ':0:0:0:0:1:2') : a);
    expect(re.candidates).toEqual(orig.candidates.map((c) => ({ ...c, address: norm(c.address) })));
    // tcp candidates are dropped, LAN v4 host first
    expect(orig.candidates[0]).toEqual({ type: 'host', address: '192.168.1.23', port: 56143 });
    expect(orig.candidates.some((c) => c.address.endsWith('.local'))).toBe(true);
    expect(orig.candidates.some((c) => c.type === 'srflx')).toBe(true);
    expect(d.sdp).toContain('a=fingerprint:sha-256 7B:8B:F0');
    expect(d.sdp).toContain('m=application 9 UDP/DTLS/SCTP webrtc-datachannel');
  });

  it('rejects garbage', () => {
    expect(() => decodeSignal('hello')).toThrow();
  });
});
