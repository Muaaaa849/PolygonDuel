import type { CharacterDef, MoveDef } from '../types';

// レイ（黄）— 射撃・位置取り
// Short reach, lowest HP and damage. S1 switches to shooting mode (ATK = diamond bullets,
// up to 3, each delayable); a bullet's answer is to STEP INTO it (bullet just → blink JA),
// guarding in the open costs nothing but slides you, and at a wall the guard hurts more
// than the hit. S2 places a static field where stepping is punished.
//
// Normals are Blaze's frames with shorter reach and less damage (C1–C8 identical to Blaze).
//  R6 (1→2→blast): N2 cancel end 26 + blast S13 - 1 = 38 < N2 S14 + hitstun 30 = 44
// v0.9 buffs (theme: distance & position): faster / longer / harder bullets, quicker mode
// switch, faster walk while shooting, faster step regen, a cheaper and larger field, a
// stronger blast. Up close it stays the weakest (shortest reach, lowest melee damage).
const shot = (n: 1 | 2 | 3): MoveDef => ({
  id: `shot${n}`, name: `射撃${n}発目`, kind: 'skill', shape: 'diamond',
  S: 8, A: 0, T: n === 3 ? 34 : 26, reach: 0, lunge: 0,
  dmg: 0, hitstun: 0, blockstun: 0, hitstop: 0,
  projectile: {
    at: 8, speed: 0.6, range: 9, radius: 0.25,
    dmg: 24, hitstun: 8, blockstun: 8, hitPush: 0.3, guardPush: n === 3 ? 2.8 : 2.2, costGain: 0.25,
    guardDrain: 0.2,
  },
  ...(n < 3 ? { next: `shot${n + 1}`, chainAny: [12, 22] as const } : {}),
});

export const ray: CharacterDef = {
  id: 'ray',
  name: 'レイ',
  nameEn: 'RAY',
  color: 0xf5c518,
  altColor: 0xb8860b,
  theme: '射撃・位置取り',
  blurb: '菱形の弾で壁際へ追い詰める射手。近づかれると脆い。弾はステップで飛び込まれると反撃確定。',
  hp: 880,
  walk: 4.4,
  step: { dist: 2.4, regen: 56 },
  guardMax: 90,
  swing: 'right',
  normals: {
    n1: {
      id: 'n1', name: '1段目', kind: 'normal', shape: 'circle',
      S: 17, A: 3, T: 39, reach: 2.25, lunge: 0.5,
      dmg: 42, hitstun: 26, blockstun: 12, hitstop: 6,
      next: 'n2', chainHit: [20, 29], chainBlock: [33, 39], cancel: [20, 29],
      knockback: 0.25, pushback: 0.4,
    },
    n2: {
      id: 'n2', name: '2段目', kind: 'normal', shape: 'circle',
      S: 14, A: 3, T: 46, reach: 2.25, lunge: 0.4,
      dmg: 38, hitstun: 30, blockstun: 14, hitstop: 6,
      next: 'n3', chainHit: [17, 26], chainBlock: [27, 46], cancel: [17, 26],
      knockback: 0.25, pushback: 0.4,
    },
    n3: {
      id: 'n3', name: '3段目', kind: 'normal', shape: 'circle',
      S: 18, A: 4, T: 55, reach: 2.375, lunge: 0.4,
      dmg: 62, hitstun: 0, blockstun: 16, hitstop: 10,
      knockdown: true, pushback: 0.6,
    },
  },
  skills: [
    {
      id: 'modeShift', name: 'モード切替', kind: 'skill', shape: 'diamond',
      desc: '射撃モードへ（コスト1）。押した瞬間に切り替わり、攻撃中・ステップ中・ガード中でも使える。射撃モード中にもう一度押すと通常モードへ（コスト0）。2段目の後に押すと「切替ブラスト」',
      cost: 1, S: 1, A: 0, T: 1, reach: 0, lunge: 0,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 0,
      mode: 1, instant: true, cancelFrom: ['n2', 'neutral'],
    },
    {
      id: 'staticField', name: 'スタティックフィールド', kind: 'skill', shape: 'pentagon',
      desc: '狙った場所（最大6u先、タップで相手の足元）に3.5秒間の電場。中でステップすると感電（45ダメージ＋よろけ）',
      cost: 2, S: 18, A: 0, T: 28, reach: 0, lunge: 0,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 0,
      field: { at: 18, radius: 2.4, frames: 210, maxDist: 6, dmg: 45, stun: 30 },
      cancelFrom: ['neutral'],
    },
  ],
  extraMoves: [
    {
      id: 'modeOff', name: '通常モードへ', kind: 'skill', shape: 'square',
      cost: 0, S: 1, A: 0, T: 1, reach: 0, lunge: 0,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 0, mode: 0, instant: true,
    },
    {
      id: 'blast', name: '切替ブラスト', kind: 'skill', shape: 'diamond',
      desc: '至近距離の散弾。大きく吹き飛ばしてダウン、射撃モードへ',
      cost: 1, S: 13, A: 3, T: 41, reach: 2.5, lunge: 0.2, sweep: [-50, 50],
      dmg: 36, hitstun: 0, blockstun: 16, hitstop: 10,
      knockdown: true, launch: 5.0, pushback: 3.4, wallOnGuard: true, mode: 1,
    },
    shot(1),
    shot(2),
    shot(3),
  ],
  shooter: { walk: 4.2, shots: ['shot1', 'shot2', 'shot3'], off: 'modeOff', blast: 'blast' },
  combos: [
    { route: '1→2→3', cost: 0, note: '基本（火力は最低級）' },
    { route: '1→2→S1(ブラスト)', cost: 1, note: '吹き飛ばして射撃モードへ。壁際なら壁ダメージ' },
    { route: '射撃×3（壁際）', cost: 0, note: 'ガードされても壁で30ずつ' },
    { route: 'JA→2→3', cost: 0, note: 'ジャスト回避から' },
  ],
  tips: [
    '1発目は奇襲。当たったら一度止まる（撃ち続けるとステップで飛び込まれる）',
    '連射は受付の中で遅らせて撃てる。相手のステップのタイミングをずらす',
    'スタティックフィールドの中の相手はステップできない。壁際に追い込んで撃つ',
    '近づかれたら通常モードへ（10Fの隙に注意）。ステップの回復が速いので、下がって距離を取り直せる',
  ],
};
