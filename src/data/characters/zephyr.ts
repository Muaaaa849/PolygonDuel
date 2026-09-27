import type { CharacterDef } from '../types';

// ゼファー（緑）— 機動・持久 (plan §7-2)
export const zephyr: CharacterDef = {
  id: 'zephyr',
  name: 'ゼファー',
  nameEn: 'ZEPHYR',
  color: 0x3cf08a,
  altColor: 0x3cd8f0,
  theme: '機動・持久',
  blurb: '最長リーチと最速のステップ回復。触らせずに削る。GBを持たない。',
  hp: 1000,
  walk: 4.7,
  step: { dist: 2.8, regen: 40 },
  guardMax: 240,
  swing: 'left',
  normals: {
    n1: {
      id: 'n1', name: '1段目', kind: 'normal', shape: 'circle',
      S: 22, A: 3, T: 46, reach: 2.4, lunge: 0.4,
      dmg: 42, hitstun: 30, blockstun: 14, hitstop: 6,
      next: 'n2', chainHit: [25, 35], chainBlock: [36, 46], cancel: [25, 35],
      knockback: 0.25, pushback: 0.4,
    },
    n2: {
      id: 'n2', name: '2段目', kind: 'normal', shape: 'circle',
      S: 17, A: 3, T: 54, reach: 2.4, lunge: 0.4,
      dmg: 40, hitstun: 35, blockstun: 14, hitstop: 6,
      next: 'n3', chainHit: [20, 30], chainBlock: [31, 54], cancel: [20, 30],
      knockback: 0.25, pushback: 0.4,
    },
    n3: {
      id: 'n3', name: '3段目', kind: 'normal', shape: 'circle',
      S: 22, A: 4, T: 60, reach: 2.5, lunge: 0.4,
      dmg: 65, hitstun: 0, blockstun: 16, hitstop: 10,
      knockdown: true, cancel: [28, 40], pushback: 0.6,
    },
  },
  skills: [
    {
      id: 'galePierce', name: 'ゲイルピアス', kind: 'skill', shape: 'circle',
      desc: 'リーチ3.8uの突き。ダウン追撃可',
      cost: 1, S: 20, A: 3, T: 46, reach: 3.8, lunge: 0.3,
      dmg: 60, hitstun: 24, blockstun: 12, hitstop: 8,
      otg: true, cancelFrom: ['n2', 'n3', 'neutral'],
      knockback: 0.4, pushback: 0.5,
    },
    {
      id: 'breeze', name: 'ブリーズ', kind: 'skill', shape: 'pentagon',
      desc: 'HP+120・5秒間 移動+15%／ステップ回復2倍（1R2回）',
      cost: 3, S: 36, A: 0, T: 60, reach: 0, lunge: 0,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 0,
      heal: { frame: 36, hp: 120, buffFrames: 300, walkPct: 15, stepRegenMul: 2 },
      usesPerRound: 2, cancelFrom: ['neutral'],
    },
  ],
  combos: [
    { route: '1→2→3', cost: 0, note: '基本' },
    { route: '1→2→3→S1', cost: 1, note: 'ダウン追撃' },
    { route: '1→2→S1', cost: 1, note: 'ダウンさせずに位置を取る' },
    { route: 'JA→2→3→S1', cost: 1, note: 'ジャスト回避から' },
  ],
  tips: [
    '3.5u前後をキープし、相手の前ステップに長槍を置く',
    '回復は相手を大きく吹き飛ばした後に',
    'GB無し。ガードは「ゲージ切れを待つ」で崩す',
  ],
};
