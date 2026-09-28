import type { CharacterDef } from '../types';

// ヴォルト（水色）— 速さ・裏回り
// The fastest walk and the only 3-stock step. S1 is a dash thrust that comes ONLY out of a
// step and goes through the opponent (+3 on hit, +2 even when guarded) — but any attack
// touching it wins, with a ×1.5 punish. S2 turns back right after the dash into a guard break.
//
// Normals are Blaze's frames with the shortest reach (C1–C8 identical to Blaze).
// Dash rules (tests/newchars.test.ts): R9 +3 hit / +2 block, no combo; R10 turnback after a
// guarded dash loses to the fastest GC by ≥2F (S30 from the cancel: 13+30-1=42 ≥ 40+2);
// R11 N1 after a guarded dash beats the GC by 1F; R12 turnback ≥ 21F; R13 dash always loses
// to an attack touching it; R14 no dash from neutral.
export const volt: CharacterDef = {
  id: 'volt',
  name: 'ヴォルト',
  nameEn: 'VOLT',
  color: 0x22d3ee,
  altColor: 0x0e7490,
  theme: '速さ・裏回り',
  blurb: '3回のステップと、ステップから出る突進で裏へ抜ける。攻撃を置かれると一番痛い。',
  hp: 900,
  walk: 5.2,
  step: { dist: 2.6, regen: 63, stock: 3 },
  guardMax: 90,
  swing: 'left',
  normals: {
    n1: {
      id: 'n1', name: '1段目', kind: 'normal', shape: 'circle',
      S: 15, A: 3, T: 37, reach: 1.6, lunge: 0.4,
      dmg: 40, hitstun: 26, blockstun: 12, hitstop: 6,
      next: 'n2', chainHit: [18, 27], chainBlock: [31, 37], cancel: [18, 27],
      knockback: 0.25, pushback: 0.4,
    },
    n2: {
      id: 'n2', name: '2段目', kind: 'normal', shape: 'circle',
      S: 14, A: 3, T: 46, reach: 1.6, lunge: 0.4,
      dmg: 36, hitstun: 30, blockstun: 14, hitstop: 6,
      next: 'n3', chainHit: [17, 26], chainBlock: [27, 46], cancel: [17, 26],
      knockback: 0.25, pushback: 0.4,
    },
    n3: {
      id: 'n3', name: '3段目', kind: 'normal', shape: 'circle',
      S: 18, A: 4, T: 55, reach: 1.7, lunge: 0.4,
      dmg: 62, hitstun: 0, blockstun: 16, hitstop: 10,
      knockdown: true, pushback: 0.6,
    },
  },
  skills: [
    {
      id: 'dashThrust', name: 'ダッシュスラスト', kind: 'skill', shape: 'circle',
      desc: 'ステップ中だけ出せる突進。相手を突き抜けて背後へ（ヒット+3F・ガードされても+2F）。出始めと突進中に攻撃が触れると必ず負け、×1.5で食らう',
      cost: 1, S: 6, A: 8, T: 25, reach: 0.8, lunge: 0,
      dmg: 55, hitstun: 18, blockstun: 16, hitstop: 6,
      dash: { dist: 3.2, advHit: 3, advBlock: 2 },
      knockback: 0.6, pushback: 0,
      cancelAny: [14, 21], cancelFrom: ['step', 'neutral'],
    },
    {
      id: 'turnBack', name: 'ターンバック', kind: 'skill', shape: 'triangle',
      desc: 'ダッシュスラストの直後（8F以内）だけ。振り返って背後の相手へガード崩し',
      cost: 1, S: 30, A: 3, T: 58, reach: 2.0, lunge: 0.6, autoAim: true,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 6,
      guardBreak: { crush: 60, dmgGuard: 30, dmgOpen: 20 },
      cancelFrom: ['dashThrust'],
    },
  ],
  combos: [
    { route: '1→2→3', cost: 0, note: '基本（火力は低め）' },
    { route: 'ステップ→S1', cost: 1, note: '55。コンボにはならないが+3F' },
    { route: 'ステップ→S1(ガード)→S2(クラッシュ)→1→2→3', cost: 2, note: '裏に抜けてからの崩し' },
    { route: 'JA→2→3', cost: 0, note: 'ジャスト回避から' },
  ],
  tips: [
    'ステップを見せて、相手が振った瞬間（判定が出る前）に突進で刺す',
    '攻撃を置かれると最悪（×1.5で食らう）。六角（ガード・リポスト構え）には突進せず、突進→ターンバック',
    '突進をガードされた後は +2F。1段目・ターンバック・ガードのじゃんけん',
  ],
};
