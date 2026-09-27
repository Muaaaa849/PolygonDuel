import type { CharacterDef } from '../types';

// バスティオン（青）— 鉄壁カウンター (plan §7-3)
export const bastion: CharacterDef = {
  id: 'bastion',
  name: 'バスティオン',
  nameEn: 'BASTION',
  color: 0x4a8dff,
  altColor: 0xa77bff,
  theme: '鉄壁・カウンター',
  blurb: '遅いが重い。5秒ガードと当て身で“触ったら痛い”を作る。',
  hp: 1150,
  walk: 4.4,
  step: { dist: 2.2, regen: 60 },
  guardMax: 300,
  swing: 'right',
  normals: {
    n1: {
      id: 'n1', name: '1段目', kind: 'normal', shape: 'circle',
      S: 24, A: 4, T: 50, reach: 2.2, lunge: 0.3,
      dmg: 55, hitstun: 32, blockstun: 16, hitstop: 6,
      next: 'n2', chainHit: [28, 37], chainBlock: [38, 50], cancel: [28, 37],
      knockback: 0.25, pushback: 0.4,
    },
    n2: {
      id: 'n2', name: '2段目', kind: 'normal', shape: 'circle',
      S: 19, A: 4, T: 59, reach: 2.2, lunge: 0.3,
      dmg: 50, hitstun: 38, blockstun: 16, hitstop: 6,
      next: 'n3', chainHit: [23, 32], chainBlock: [33, 59], cancel: [23, 32],
      knockback: 0.25, pushback: 0.4,
    },
    n3: {
      id: 'n3', name: '3段目', kind: 'normal', shape: 'circle',
      S: 25, A: 5, T: 66, reach: 2.3, lunge: 0.4,
      dmg: 90, hitstun: 0, blockstun: 18, hitstop: 10,
      knockdown: true, pushback: 0.6,
    },
  },
  skills: [
    {
      id: 'riposte', name: 'リポスト', kind: 'skill', shape: 'hexagon',
      desc: '当て身。円を受けると即反撃＋ダウン。三角には負ける',
      cost: 1, S: 3, A: 22, T: 42, reach: 0, lunge: 0,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 14,
      counterStance: { from: 3, to: 24, dmg: 110, strikeT: 22 },
      cancelFrom: ['n1', 'n2', 'neutral'],
    },
    {
      id: 'shieldBash', name: 'シールドバッシュ', kind: 'skill', shape: 'triangle',
      desc: '2.2u突進のガード崩し',
      cost: 2, S: 30, A: 4, T: 62, reach: 2.0, lunge: 2.2, lungeFrom: 8,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 6,
      guardBreak: { crush: 80, dmgGuard: 40, dmgOpen: 30 },
      cancelFrom: ['neutral'],
    },
  ],
  combos: [
    { route: '1→2→3', cost: 0, note: '1回の読み勝ちが重い' },
    { route: 'S2(クラッシュ)→1→2→3', cost: 2, note: '遠くでガードを固めた相手に' },
    { route: 'S1(リポスト成立)', cost: 1, note: '110＋ダウン → 起き攻めへ' },
    { route: 'JA→2→3', cost: 0, note: '全キャラ最大の一撃' },
  ],
  tips: [
    'リポストはガードと同じ六角。相手には区別できない',
    '1段目をガードされた後、GCを読んで当て身キャンセルが強力',
    '足が遅い。ゼファーに距離を取られると苦しい',
  ],
};
