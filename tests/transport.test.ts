import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PeerLink, MAX_GAME_BUFFERED_BYTES } from '../src/net/transport';
import { RollbackSession } from '../src/net/rollback';
import { Sim } from '../src/core/sim';
import { IN_ATK } from '../src/core/input';

class Channel {
  readyState = 'open';
  bufferedAmount = 0;
  binaryType = '';
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (e: { data: ArrayBuffer | string }) => void;
  sent: (Uint8Array | string)[] = [];
  send(data: Uint8Array | string) { this.sent.push(typeof data === 'string' ? data : data.slice()); }
  close() { this.readyState = 'closed'; }
}
class Connection {
  channels: Channel[] = [];
  createDataChannel() { const ch = new Channel(); this.channels.push(ch); return ch; }
  close() {}
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('RTCPeerConnection', Connection);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const gameOf = (link: PeerLink) => link.game as unknown as Channel;
const ctrlOf = (link: PeerLink) => link.ctrl as unknown as Channel;
function open(link: PeerLink) { gameOf(link).onopen?.(); ctrlOf(link).onopen?.(); }

describe('game transport', () => {
  it('measures RTT on the game channel without reliable control-channel head-of-line delay', () => {
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const a = new PeerLink(), b = new PeerLink();
    const input = vi.fn(); a.onGame = input;
    open(a);
    const ping = gameOf(a).sent[0] as Uint8Array;
    expect(ping.byteLength).toBe(5);
    expect(ctrlOf(a).sent).toHaveLength(0);
    now = 125;
    gameOf(b).onmessage?.({ data: ping.buffer as ArrayBuffer });
    now = 150;
    const pong = gameOf(b).sent[0] as Uint8Array;
    gameOf(a).onmessage?.({ data: pong.buffer as ArrayBuffer });
    expect(a.rttMs).toBe(50);
    expect(input).not.toHaveBeenCalled();
    // A duplicated reply must not distort the sample.
    now = 1000;
    gameOf(a).onmessage?.({ data: pong.buffer as ArrayBuffer });
    expect(a.rttMs).toBe(50);
    a.close(); b.close();
  });

  it('forwards input datagrams unchanged and does not wait for a missing ping', () => {
    const link = new PeerLink();
    open(link); // intentionally lose this ping
    const got = vi.fn(); link.onGame = got;
    const pkt = new Uint8Array([1, 0, 0, 0, 0, 0]);
    gameOf(link).onmessage?.({ data: pkt.buffer });
    expect(got).toHaveBeenCalledWith(pkt);
    link.close();
  });

  it('bounds queued stale inputs and resumes with the latest redundant packet', () => {
    const link = new PeerLink();
    const ch = gameOf(link);
    const old = new Uint8Array(151); old[0] = 1;
    ch.bufferedAmount = MAX_GAME_BUFFERED_BYTES - old.byteLength + 1;
    expect(link.sendGame(old)).toBe(false);
    expect(ch.sent).toHaveLength(0);
    expect(link.congestionDrops).toBe(1);
    ch.bufferedAmount = 0;
    const latest = old.slice(); latest[1] = 42;
    expect(link.sendGame(latest)).toBe(true);
    expect(ch.sent).toEqual([latest]);
    link.close();
  });

  it('handles a closed or full channel without throwing or claiming a send', () => {
    const link = new PeerLink();
    const ch = gameOf(link);
    vi.spyOn(ch, 'send').mockImplementation(() => { throw new Error('full'); });
    expect(link.sendGame(new Uint8Array([1]))).toBe(false);
    ch.readyState = 'closed';
    expect(link.sendGame(new Uint8Array([1]))).toBe(false);
    link.close();
  });

  it('recovers from a 500ms send-queue blockage without a persistent stale-packet backlog', () => {
    const run = (bounded: boolean) => {
      const links = [new PeerLink(), new PeerLink()];
      const queues: Uint8Array[][] = [[], []];
      const peaks = [0, 0];
      for (let i = 0; i < 2; i++) {
        const ch = gameOf(links[i]);
        ch.send = data => {
          const p = (data as Uint8Array).slice();
          queues[i].push(p);
          ch.bufferedAmount += p.byteLength;
          peaks[i] = Math.max(peaks[i], ch.bufferedAmount);
        };
      }
      const sessions = links.map((link, local) => new RollbackSession(new Sim(0, 1), {
        local: local as 0 | 1, inputDelay: 2,
        send: p => { if (bounded) link.sendGame(p); else gameOf(link).send(p); },
      }));
      let atRecovery = 0;
      for (let t = 0; t < 600; t++) {
        // Browser queue stops draining for 30 ticks, then resumes at one packet/tick.
        if (t < 100 || t >= 130) for (let i = 0; i < 2; i++) {
          const p = queues[i].shift();
          if (p) { gameOf(links[i]).bufferedAmount -= p.length; sessions[1 - i].receive(p); }
        }
        for (const s of sessions) s.tick(() => s.frame % 31 === 0 ? IN_ATK : 0);
        if (t === 499) atRecovery = sessions[0].frame;
      }
      expect(sessions[0].stats.desyncs + sessions[1].stats.desyncs).toBe(0);
      expect(sessions[0].stats.checksumsCompared + sessions[1].stats.checksumsCompared).toBeGreaterThan(0);
      const result = { peak: Math.max(...peaks), progress: sessions[0].frame - atRecovery };
      for (const link of links) link.close();
      return result;
    };
    const before = run(false), after = run(true);
    expect(after.peak).toBeLessThanOrEqual(MAX_GAME_BUFFERED_BYTES);
    expect(before.peak).toBeGreaterThan(MAX_GAME_BUFFERED_BYTES);
    expect(after.progress).toBeGreaterThan(before.progress);
    expect(after.progress).toBeGreaterThanOrEqual(90); // recovered near 60Hz, not stuck replaying old sends
  });
});
