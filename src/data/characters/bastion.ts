import type { CharacterDef } from '../types';

// バスティオン（青）— 鉄壁カウンター (plan §7-3)
export const bastion: CharacterDef = {
  id: 'bastion',
  name: 'バスティオン',
  nameEn: 'BASTION',
  color: 0x4a8dff,
  altColor: 0xa77bff,
  theme: '鉄壁・カウンター',
  blurb: '遅いが重い。一番長いガードと当て身で“触ったら痛い”を作る。',
  hp: 1150,
  walk: 4.0,
  step: { dist: 2.2, regen: 84 },
  guardMax: 105,
  swing: 'right',
  normals: {
    n1: {
      id: 'n1', name: '1段目', kind: 'normal', shape: 'circle',
      S: 21, A: 4, T: 47, reach: 2.75, lunge: 0.3,
      dmg: 55, hitstun: 29, blockstun: 16, hitstop: 6,
      next: 'n2', chainHit: [25, 34], chainBlock: [37, 47], cancel: [25, 34],
      knockback: 0.25, pushback: 0.4,
    },
    n2: {
      id: 'n2', name: '2段目', kind: 'normal', shape: 'circle',
      S: 16, A: 4, T: 53, reach: 2.75, lunge: 0.3,
      dmg: 50, hitstun: 35, blockstun: 16, hitstop: 6,
      next: 'n3', chainHit: [20, 29], chainBlock: [30, 53], cancel: [20, 29],
      knockback: 0.25, pushback: 0.4,
    },
    n3: {
      id: 'n3', name: '3段目', kind: 'normal', shape: 'circle',
      S: 22, A: 5, T: 62, reach: 2.875, lunge: 0.4,
      dmg: 90, hitstun: 0, blockstun: 18, hitstop: 10,
      knockdown: true, pushback: 0.6,
    },
  },
  skills: [
    {
      id: 'riposte', name: 'リポスト', kind: 'skill', shape: 'hexagon',
      desc: '当て身。円を受けると即反撃で相手をよろけさせ、引き寄せて2段目→3段目へ繋がる。成立するとコストが戻る。三角には負ける',
      cost: 1, S: 3, A: 22, T: 42, reach: 0, lunge: 0,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 14,
      counterStance: { from: 3, to: 24, dmg: 70, strikeT: 22, stagger: 30, chain: [6, 14], pull: 1.4, refund: 1 },
      cancelFrom: ['n1', 'n2', 'neutral'],
    },
    {
      id: 'shieldBash', name: 'シールドバッシュ', kind: 'skill', shape: 'triangle',
      desc: '2.2u突進のガード崩し',
      cost: 2, S: 23, A: 4, T: 55, reach: 2.5, lunge: 2.2, lungeFrom: 8,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 6,
      guardBreak: { crush: 80, dmgGuard: 40, dmgOpen: 30 },
      cancelFrom: ['neutral'],
    },
  ],
  combos: [
    { route: '1→2→3', cost: 0, note: '1回の読み勝ちが重い' },
    { route: 'S2(クラッシュ)→1→2→3', cost: 2, note: '遠くでガードを固めた相手に' },
    { route: 'S1(リポスト成立)→2→3', cost: 1, note: '210＋ダウン。成立でコストが戻る（ガード→GCより痛い）' },
    { route: 'JA→2→3', cost: 0, note: '全キャラ最大の一撃' },
  ],
  tips: [
    'リポストはガードと同じ六角。相手には区別できない',
    '1段目をガードされた後、GCを読んで当て身キャンセルが強力',
    '足が遅い。ゼファーに距離を取られると苦しい',
  ],
};
