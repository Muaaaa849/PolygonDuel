import type { CharacterDef } from '../types';

// ブレイズ（赤）— 速攻ラッシュ (plan §7-1)
export const blaze: CharacterDef = {
  id: 'blaze',
  name: 'ブレイズ',
  nameEn: 'BLAZE',
  color: 0xff5a3c,
  altColor: 0xff3ca0,
  theme: '速攻ラッシュ',
  blurb: '最速の円で触り、チェーン初期化でコンボを伸ばす。体力は最低。',
  hp: 900,
  walk: 5.0,
  step: { dist: 2.4, regen: 70 },
  guardMax: 90,
  swing: 'right',
  normals: {
    n1: {
      id: 'n1', name: '1段目', kind: 'normal', shape: 'circle',
      S: 17, A: 3, T: 39, reach: 1.9, lunge: 0.5,
      dmg: 45, hitstun: 26, blockstun: 12, hitstop: 6,
      next: 'n2', chainHit: [20, 29], chainBlock: [33, 39], cancel: [20, 29],
      knockback: 0.25, pushback: 0.4,
    },
    n2: {
      id: 'n2', name: '2段目', kind: 'normal', shape: 'circle',
      S: 14, A: 3, T: 46, reach: 1.9, lunge: 0.4,
      dmg: 40, hitstun: 30, blockstun: 14, hitstop: 6,
      next: 'n3', chainHit: [17, 26], chainBlock: [27, 46], cancel: [17, 26],
      knockback: 0.25, pushback: 0.4,
    },
    n3: {
      id: 'n3', name: '3段目', kind: 'normal', shape: 'circle',
      S: 18, A: 4, T: 55, reach: 2.0, lunge: 0.5,
      dmg: 70, hitstun: 0, blockstun: 16, hitstop: 10,
      knockdown: true, pushback: 0.6,
    },
  },
  skills: [
    {
      id: 'flareRush', name: 'フレアラッシュ', kind: 'skill', shape: 'circle',
      desc: '3u突進。ヒットでチェーン初期化（1段目へ）',
      cost: 1, S: 14, A: 4, T: 41, reach: 1.7, lunge: 3.0, lungeFrom: 3,
      dmg: 60, hitstun: 34, blockstun: 12, hitstop: 8,
      chainReset: [22, 28], cancelFrom: ['n1', 'n2', 'neutral'],
      knockback: 0.25, pushback: 0.5,
    },
    {
      id: 'breakFang', name: 'ブレイクファング', kind: 'skill', shape: 'triangle',
      desc: 'ガード崩し。ガード中の相手をスタン',
      cost: 2, S: 23, A: 3, T: 53, reach: 2.0, lunge: 1.0,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 6,
      guardBreak: { crush: 70, dmgGuard: 30, dmgOpen: 25 },
      cancelFrom: ['n1', 'neutral'],
    },
  ],
  combos: [
    { route: '1→2→3', cost: 0, note: '基本。コスト+1.5' },
    { route: '1→2→S1→1→2→3', cost: 1, note: 'チェーン初期化で伸ばす' },
    { route: 'S2(クラッシュ)→1→2→3', cost: 2, note: 'ガード固めへの回答' },
    { route: 'JA→2→3', cost: 0, note: 'ジャスト回避から' },
  ],
  tips: [
    '2.5u付近から前ステップ→そのまま1段目（ステップの勢いが乗る）で“見えない円”を押し付ける',
    '1段目をガードされたら「止める／S1／S2」の三択',
    'リーチ最短。ゼファーの長槍には近づく途中を狙われる',
  ],
};
