import type { CharacterDef, MoveDef } from '../types';

// レイ（黄）— 射撃・位置取り
// Short reach, lowest HP and damage. S1 switches to shooting mode (ATK = diamond bullets,
// up to 3, each delayable); a bullet's answer is to STEP INTO it (bullet just → blink JA),
// guarding in the open costs nothing but slides you, and at a wall the guard hurts more
// than the hit. S2 places a static field where stepping is punished.
//
// Normals are Blaze's frames with shorter reach and less damage (C1–C8 identical):
//  C1 27+12-1=38 < 15+24=39   C2 24+16-1=39 < 12+28=40   C3 (42+1)-(12+28)=3
//  C4 31+12-1=42 > 15+12+13=40   C5 37+2=39 ≤ 40   C6 26+16-1=41 > 12+14+13=39   C7 39 < 44
//  R6 (1→2→blast): 24+12-1=35 < 12+28=40
const shot = (n: 1 | 2 | 3): MoveDef => ({
  id: `shot${n}`, name: `射撃${n}発目`, kind: 'skill', shape: 'diamond',
  S: 8, A: 0, T: n === 3 ? 34 : 26, reach: 0, lunge: 0,
  dmg: 0, hitstun: 0, blockstun: 0, hitstop: 0,
  projectile: {
    at: 8, speed: 0.5, range: 8, radius: 0.25,
    dmg: 20, hitstun: 7, blockstun: 7, hitPush: 0.2, guardPush: n === 3 ? 2.6 : 2.0, costGain: 0.25,
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
  hp: 850,
  walk: 4.4,
  step: { dist: 2.4, regen: 70 },
  guardMax: 90,
  swing: 'right',
  normals: {
    n1: {
      id: 'n1', name: '1段目', kind: 'normal', shape: 'circle',
      S: 17, A: 3, T: 39, reach: 1.7, lunge: 0.4,
      dmg: 40, hitstun: 26, blockstun: 12, hitstop: 6,
      next: 'n2', chainHit: [20, 29], chainBlock: [33, 39], cancel: [20, 29],
      knockback: 0.25, pushback: 0.4,
    },
    n2: {
      id: 'n2', name: '2段目', kind: 'normal', shape: 'circle',
      S: 14, A: 3, T: 46, reach: 1.7, lunge: 0.4,
      dmg: 36, hitstun: 30, blockstun: 14, hitstop: 6,
      next: 'n3', chainHit: [17, 26], chainBlock: [27, 46], cancel: [17, 26],
      knockback: 0.25, pushback: 0.4,
    },
    n3: {
      id: 'n3', name: '3段目', kind: 'normal', shape: 'circle',
      S: 18, A: 4, T: 55, reach: 1.8, lunge: 0.4,
      dmg: 60, hitstun: 0, blockstun: 16, hitstop: 10,
      knockdown: true, pushback: 0.6,
    },
  },
  skills: [
    {
      id: 'modeShift', name: 'モード切替', kind: 'skill', shape: 'diamond',
      desc: '射撃モードへ（コスト1）。射撃モード中にもう一度押すと通常モードへ（コスト0・10F）。2段目の後に押すと「切替ブラスト」',
      cost: 1, S: 1, A: 0, T: 14, reach: 0, lunge: 0,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 0,
      mode: 1, cancelFrom: ['n2', 'neutral'],
    },
    {
      id: 'staticField', name: 'スタティックフィールド', kind: 'skill', shape: 'pentagon',
      desc: '狙った場所（最大5u先、タップで相手の足元）に3秒間の電場。中でステップすると感電（40ダメージ＋よろけ）',
      cost: 1.5, S: 20, A: 0, T: 30, reach: 0, lunge: 0,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 0,
      field: { at: 20, radius: 2, frames: 180, maxDist: 5, dmg: 40, stun: 30 },
      cancelFrom: ['neutral'],
    },
  ],
  extraMoves: [
    {
      id: 'modeOff', name: '通常モードへ', kind: 'skill', shape: 'square',
      cost: 0, S: 1, A: 0, T: 10, reach: 0, lunge: 0,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 0, mode: 0,
    },
    {
      id: 'blast', name: '切替ブラスト', kind: 'skill', shape: 'diamond',
      desc: '至近距離の散弾。大きく吹き飛ばしてダウン、射撃モードへ',
      cost: 1, S: 13, A: 3, T: 41, reach: 2.0, lunge: 0.2, sweep: [-50, 50],
      dmg: 30, hitstun: 0, blockstun: 16, hitstop: 10,
      knockdown: true, launch: 4.5, pushback: 3.0, wallOnGuard: true, mode: 1,
    },
    shot(1),
    shot(2),
    shot(3),
  ],
  shooter: { walk: 3.5, shots: ['shot1', 'shot2', 'shot3'], off: 'modeOff', blast: 'blast' },
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
    '近づかれたら通常モードへ（10Fの隙に注意）',
  ],
};
