import type { CharacterDef } from '../types';

// ファントム（紫）— 幻惑・トリック
// Normal reach / walk, low HP and damage, the longest step. The illusion (S1) makes
// the opponent guard, GC or dodge a decoy; the guard break (S2) punishes the guard,
// and the real 1st hit punishes players who start ignoring the decoys.
//
// Frame rules (characterSetting.md §3), checked by tests/frame-rules.test.ts:
//  C1 28+12-1=39 < 16+24=40   C2 24+16-1=39 < 12+28=40   C3 (42+1)-(12+28)=3
//  C4 33+12-1=44 > 16+13+13=42   C5 39+2=41 ≤ 42   C6 26+16-1=41 > 12+14+13=39   C7 39 < 44
export const phantom: CharacterDef = {
  id: 'phantom',
  name: 'ファントム',
  nameEn: 'PHANTOM',
  color: 0xb55cff,
  altColor: 0xff5cd6,
  theme: '幻惑・トリック',
  blurb: '幻影で惑わすトリックスター。体力と火力は低いが、長いステップと幻影で読み合いを支配する。',
  hp: 880,
  walk: 4.6,
  step: { dist: 3.0, regen: 63 },
  guardMax: 90,
  swing: 'left',
  normals: {
    n1: {
      id: 'n1', name: '1段目', kind: 'normal', shape: 'circle',
      S: 18, A: 3, T: 41, reach: 2.625, lunge: 0.4,
      dmg: 42, hitstun: 26, blockstun: 13, hitstop: 6,
      next: 'n2', chainHit: [21, 30], chainBlock: [34, 41], cancel: [21, 30],
      knockback: 0.25, pushback: 0.4,
    },
    n2: {
      id: 'n2', name: '2段目', kind: 'normal', shape: 'circle',
      S: 14, A: 3, T: 47, reach: 2.625, lunge: 0.4,
      dmg: 38, hitstun: 31, blockstun: 14, hitstop: 6,
      next: 'n3', chainHit: [17, 26], chainBlock: [27, 47], cancel: [17, 26],
      knockback: 0.25, pushback: 0.4,
    },
    n3: {
      id: 'n3', name: '3段目', kind: 'normal', shape: 'circle',
      S: 18, A: 4, T: 55, reach: 2.75, lunge: 0.4,
      dmg: 66, hitstun: 0, blockstun: 16, hitstop: 10,
      knockdown: true, pushback: 0.6,
    },
  },
  skills: [
    {
      id: 'ghost', name: 'ゴースト', kind: 'skill', shape: 'circle',
      desc: '幻影を放つ。離れていれば幻影がステップで迫り、近ければ幻影が斬りかかる。その間（約0.5秒）本体は相手に見えず自由に動ける。幻影に攻撃させるとコスト1が戻る',
      cost: 2, S: 1, A: 0, T: 10, reach: 0, lunge: 0,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 0,
      ghost: { approach: 18, stopDist: 1.5, frames: 30 },
      cancelFrom: ['n1', 'neutral'],
    },
    {
      id: 'soulRipper', name: 'ソウルリッパー', kind: 'skill', shape: 'triangle',
      desc: 'ガード崩し。ガード中の相手をスタン',
      cost: 2, S: 29, A: 3, T: 59, reach: 2.5, lunge: 1.0,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 6,
      guardBreak: { crush: 70, dmgGuard: 30, dmgOpen: 25 },
      cancelFrom: ['n1', 'neutral'],
    },
  ],
  combos: [
    { route: '1→2→3', cost: 0, note: '基本。火力は低め' },
    { route: 'S2(クラッシュ)→1→2→3', cost: 2, note: '幻影でガードさせてから崩す' },
    { route: 'S1(幻影)→S2', cost: 4, note: '幻影の斬りかかりにガードした相手へ' },
    { route: 'JA→2→3', cost: 0, note: 'ジャスト回避から' },
  ],
  tips: [
    '幻影（S1）で相手のガード・GC・ステップを誘い、S2で崩すか本体で殴る',
    '幻影を読んで棒立ちする相手には、本物の1段目をそのまま当てる',
    '体力と火力は低い。長いステップで間合いを出入りし、打ち合いを避ける',
  ],
};
