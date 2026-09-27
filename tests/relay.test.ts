// Link-room codes: readable alphabet, tolerant parsing of links / pasted text.
import { describe, expect, it } from 'vitest';
import { newRoomCode, parseRoomCode, roomPeerId, ROOM_CODE_LEN } from '../src/net/relay';

describe('room codes', () => {
  it('are 6 readable characters (no I, O, 0, 1)', () => {
    for (let i = 0; i < 200; i++) {
      const c = newRoomCode();
      expect(c).toHaveLength(ROOM_CODE_LEN);
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    }
  });

  it('parse from a code, a link, or pasted invite text', () => {
    expect(parseRoomCode('4h7tqu')).toBe('4H7TQU');
    expect(parseRoomCode('https://example.com/PolygonDuel/#room=4H7TQU')).toBe('4H7TQU');
    expect(parseRoomCode('#room=AB23CD')).toBe('AB23CD');
    expect(parseRoomCode('  ab23cd  ')).toBe('AB23CD');
    expect(parseRoomCode('POLYGON DUELで対戦しよう！ ルームコード XY34ZK\nhttps://a.b/#room=XY34ZK')).toBe('XY34ZK');
    expect(parseRoomCode('AB1OCD')).toBeNull(); // 1 / O are never issued
    expect(parseRoomCode('abc')).toBeNull();
  });

  it('map to a relay id', () => {
    expect(roomPeerId('AB23CD')).toBe('polygonduel-AB23CD');
  });
});
