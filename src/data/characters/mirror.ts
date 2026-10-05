import type { CharacterDef } from '../types';

// ミラー（橙）— 瞬間移動・分身 (v1.9, user request)
// Low damage and HP, a slightly long reach. Everything is about being somewhere else.
// Normals: Blaze's frames, except that the hit stun is 6F longer (N1 26 → 32, N2 30 → 36) with hit windows to match,
// so a teleport fits between two hits (1 → S1 → 2 → 3, 1 → 2 → S1 → 3). N2's recovery is 6F longer too, which keeps
// C3 (stopping after N2 leaves the defender +3) and C7 (blocked N2 → GC) exactly as for everyone else.
//  S1 ミラーステップ (instant, cost 1.5): 1.5u along the stick (or the facing) on the frame it is pressed — from
//     standing, a step, or ANY moment of an attack (the swing goes on from the new spot, turned to the opponent).
//     As many in a row as the cost allows (10F apart). Out of range N1 → teleport in → it lands; or pass through
//     a cornered opponent and send them into the wall.
//  S2 ミラーイメージ (pentagon, cost 2.5): a clone (20 s). A tap puts it on the far side of the opponent (mirrored
//     through them); dragging aims it (up to 6u). Every normal / GC / JA the real one starts, the clone starts too, turned
//     toward the opponent, for 75% damage (no cost gained; it can't be hit). Hits from both on the same frame both count.
//     With the clone out S2 is the SWAP (instant, cost 1): the two trade places and the current attack's recovery is gone
//     — 1 → 2 → swap → 1 → 2 → 3 (from whichever of the two landed). Not after a guarded attack and not in guard stun.
export const mirror: CharacterDef = {
  id: 'mirror',
  name: 'ミラー',
  nameEn: 'MIRROR',
  color: 0xff7a18,
  altColor: 0xffe08a,
  theme: '瞬間移動・分身',
  blurb: '攻撃中でも瞬間移動。分身が同時に斬りかかり、場所を入れ替えてコンボを繋ぐ。体力・火力は低い。',
  hp: 850,
  walk: 4.8,
  step: { dist: 2.5, regen: 63 },
  guardMax: 90,
  swing: 'right',
  cloneSwap: 'mirrorSwap',
  normals: {
    n1: {
      id: 'n1', name: '1段目', kind: 'normal', shape: 'circle',
      S: 17, A: 3, T: 39, reach: 2.625, lunge: 0.4,
      dmg: 38, hitstun: 32, blockstun: 12, hitstop: 6,
      next: 'n2', chainHit: [20, 35], chainBlock: [33, 39], cancel: [20, 35],
      knockback: 0.25, pushback: 0.4,
    },
    n2: {
      id: 'n2', name: '2段目', kind: 'normal', shape: 'circle',
      S: 14, A: 3, T: 52, reach: 2.625, lunge: 0.4,
      dmg: 34, hitstun: 36, blockstun: 14, hitstop: 6,
      next: 'n3', chainHit: [17, 32], chainBlock: [27, 52], cancel: [17, 32],
      knockback: 0.25, pushback: 0.4,
    },
    n3: {
      id: 'n3', name: '3段目', kind: 'normal', shape: 'circle',
      S: 18, A: 4, T: 55, reach: 2.75, lunge: 0.4,
      dmg: 58, hitstun: 0, blockstun: 16, hitstop: 10,
      knockdown: true, pushback: 0.6,
    },
  },
  skills: [
    {
      id: 'mirrorStep', name: 'ミラーステップ', kind: 'skill', shape: 'arrow',
      desc: '押した瞬間、スティックの方向（離していれば向いている方向）へ1.5u瞬間移動。攻撃中でも使え、技はそのまま新しい位置から相手へ向き直って続く。コストがあれば連続で使える',
      cost: 1.5, S: 1, A: 0, T: 1, reach: 0, lunge: 0,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 0,
      instant: true, teleport: { dist: 1.5 }, lock: 10,
      cancelFrom: ['neutral'],
    },
    {
      id: 'mirrorClone', name: 'ミラーイメージ', kind: 'skill', shape: 'pentagon',
      desc: '分身を作る（20秒）。タップで相手の向こう側、長押しでドラッグした場所に。本体が攻撃すると分身も相手へ向いて同じ攻撃を振る（威力0.75倍・コストは溜まらない・分身は攻撃を受けない）。分身がいる間のS2は「入れ替え」（コスト1）：場所を入れ替え、今の攻撃の硬直も消える。ガードされた攻撃からは使えない',
      cost: 2.5, S: 12, A: 0, T: 26, reach: 0, lunge: 0,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 0,
      clone: { at: 12, frames: 1200, maxDist: 6, mirror: 2.5, dmgPct: 75 },
      cancelFrom: ['neutral', 'step'],
    },
  ],
  extraMoves: [
    {
      id: 'mirrorSwap', name: '入れ替え', kind: 'skill', shape: 'square',
      desc: '分身と場所を入れ替える（0F）。攻撃の空振り・ヒットの硬直を消せる。ガードされた攻撃・ガード硬直からは使えない',
      cost: 1, S: 1, A: 0, T: 1, reach: 0, lunge: 0,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 0,
      instant: true, swap: true,
    },
  ],
  combos: [
    { route: '1→2→3', cost: 0, note: '基本。火力は低い' },
    { route: '1→S1→2→3', cost: 1.5, note: '1段目の後に相手の向こうへ瞬間移動。壁を背負った相手の後ろを取り、逆に壁へ' },
    { route: '1(届かない)→S1→当たる', cost: 1.5, note: '空振りの間合いで振り、発生前に瞬間移動して当てる' },
    { route: '1→2→入れ替え→1→2→3', cost: 1, note: '分身がいる時。どちらの攻撃が当たっていても繋がる' },
    { route: 'JA→2→3', cost: 0, note: 'ジャスト回避から' },
  ],
  tips: [
    '分身は本体と同時に振る＝挟み撃ち。両方当たればダメージも両方入る',
    '相手の攻撃を見てから入れ替えれば、空振りさせて一方的に攻撃できる',
    'ガードされたら入れ替えでは逃げられない。素直にガードかステップ',
  ],
};
