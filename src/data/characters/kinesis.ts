import type { CharacterDef } from '../types';

// キネシス（ピンク）— 念動力・引き寄せ (v1.3, user request)
// Hits hard at the shortest range, and brings the fight to that range with telekinesis.
// Normals: Blaze's frames (so C1–C8 hold as for Blaze) with the shortest reach and high damage,
// drawn as telekinesis (the hit area ripples; no blade). N3 knocks down where the target
// stands (no launch) — S2 then throws the downed body away.
//  S1 サイコプル (pentagon = "hit me"): a slow psychic grip. It drags the target in front of
//     her for a full normal combo (once per combo: 1→2→S1→1→2→3→S2 works, 1→2→S1 loops don't);
//     a target caught in a normal-attack motion (startup included) drags HER in instead, and
//     combos her. Guarded (v1.5): still dragged in, but no damage, no gauge refill, no combo —
//     both simply end up point blank. Stepping into it is no bullet-just (it is not a diamond).
//  S2 サイコバースト (circle): a burst all around. Guard nullifies it; otherwise knockdown and a
//     7u launch (off center → into the wall), also on a downed target (OTG): S1→1→2→3→S2.
// Combo timing (tests/newchars.test.ts): N2 hit (14) + cancel [17,26] + shot at 8 → pulled
// while N2's 30F hit stun still runs; pull stun 40 ≥ S1 recovery + N1 startup from the
// earliest hit; N3 down at 18 + cancel [22,30] + burst S10 → hits ≤ 21F into the down (OTG 30).
export const kinesis: CharacterDef = {
  id: 'kinesis',
  name: 'キネシス',
  nameEn: 'KINESIS',
  color: 0xff5fc8,
  altColor: 0xff9a2e,
  theme: '念動力・引き寄せ',
  blurb: '念力で引き寄せ、至近距離で重い一撃。3段目は相手をその場に倒し、念力の爆発で壁まで吹き飛ばす。',
  hp: 900,
  walk: 4.7,
  step: { dist: 2.5, regen: 63 },
  guardMax: 90,
  swing: 'right',
  style: 'psychic',
  normals: {
    n1: {
      id: 'n1', name: '1段目', kind: 'normal', shape: 'circle',
      S: 17, A: 3, T: 39, reach: 1.75, lunge: 0.4,
      dmg: 52, hitstun: 26, blockstun: 12, hitstop: 7,
      next: 'n2', chainHit: [20, 29], chainBlock: [33, 39], cancel: [20, 29],
      knockback: 0.2, pushback: 0.4,
    },
    n2: {
      id: 'n2', name: '2段目', kind: 'normal', shape: 'circle',
      S: 14, A: 3, T: 46, reach: 1.75, lunge: 0.4,
      dmg: 46, hitstun: 30, blockstun: 14, hitstop: 7,
      next: 'n3', chainHit: [17, 26], chainBlock: [27, 46], cancel: [17, 26],
      knockback: 0.2, pushback: 0.4,
    },
    n3: {
      id: 'n3', name: '3段目', kind: 'normal', shape: 'circle',
      S: 18, A: 4, T: 55, reach: 1.875, lunge: 0.4,
      dmg: 80, hitstun: 0, blockstun: 16, hitstop: 11,
      // pressed to the floor where it stands; S2 on [22, 30] throws it away
      knockdown: true, pinDown: true, cancel: [22, 30], pushback: 0.6,
    },
  },
  skills: [
    {
      id: 'psychoPull', name: 'サイコプル', kind: 'skill', shape: 'pentagon',
      desc: '念力を飛ばし、当たった相手を目の前まで引き寄せる（通常攻撃が繋がる。1コンボ1回）。相手が通常攻撃の動作中だと、逆に自分が引き寄せられる。ガードされても引き寄せるが、ダメージもコンボも無し（至近距離になるだけ）',
      cost: 2, S: 8, A: 0, T: 26, reach: 0, lunge: 0,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 0,
      projectile: {
        at: 8, speed: 0.5, range: 7.5, radius: 0.3,
        dmg: 20, hitstun: 8, blockstun: 10, hitPush: 0.2, guardPush: 0.4, costGain: 0,
        pull: { to: 1.2, stun: 40, reverseStun: 46 },
      },
      cancelFrom: ['n2', 'neutral'],
    },
    {
      id: 'psychoBurst', name: 'サイコバースト', kind: 'skill', shape: 'circle',
      desc: '周囲に念力の爆発。当たった相手をダウンさせて大きく吹き飛ばす（中央から外れていれば壁まで）。倒れた相手にも当たる。ガードされると効かない',
      cost: 2, S: 10, A: 4, T: 48, reach: 2.0, lunge: 0, radial: true,
      dmg: 50, hitstun: 0, blockstun: 14, hitstop: 10,
      knockdown: true, launch: 7, otg: true, pushback: 0.5,
      cancelFrom: ['n3', 'neutral'],
    },
  ],
  combos: [
    { route: '1→2→3', cost: 0, note: '基本から高火力。3段目はその場でダウン' },
    { route: '1→2→3→S2', cost: 2, note: '倒れた相手を吹き飛ばす。壁が近ければ壁ダメージ' },
    { route: 'S1(引き寄せ)→1→2→3→S2', cost: 4, note: '遠くから引き寄せてフルコンボ' },
    { route: '1→2→S1→1→2→3→S2', cost: 4, note: '引き寄せでコンボを伸ばす（1コンボ1回）' },
    { route: 'JA→2→3', cost: 0, note: 'ジャスト回避から' },
  ],
  tips: [
    'リーチは最短。S1の引き寄せで自分の間合いに入れる',
    '相手が攻撃を振っている時にS1を撃つと、逆に引き寄せられてコンボを食らう。構えていない時・ガードを解いた時に',
    '3段目で倒したらすぐS2。壁の近くなら壁に叩きつけて追加ダメージ',
  ],
};
