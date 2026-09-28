import type { CharacterDef } from '../types';

// ヴォルト（水色）— 速さ・裏回り
// The fastest walk and the only 3-stock step. S1 is a dash thrust (on its own, or out of a
// step) that goes through the opponent (+3 on hit, +2 even when guarded) — but any attack
// touching it wins, with a ×1.5 punish. S2 turns back right after the dash into a guard break.
//
// Normals are Blaze's frames with the shortest reach, and N1 two frames quicker than Blaze's
// (the whole N1 shifted, so C1–C8 hold exactly as for Blaze). N1 has to stay at 15F: R11
// (N1 after a guarded +2 dash beats the fastest GC) needs N1.S − 1 < 2 + GC.S − 1.
// Dash rules (tests/newchars.test.ts): R9 +3 hit / +2 block, no normal-move combo; R10 turnback
// after a guarded dash still loses to the fastest GC (v1.0: every GB 4F faster → the turnback
// reaches the GC during its startup, where a GB only chips, and the GC lands); R12 turnback ≥ 21F;
// R13 dash always loses to an attack touching it; R14 (v0.9) the dash also comes out on its own.
// v1.0 (user request): a dash that hits chains into the next dash (mash S1) — a skill-only
// combo, 4 cost = 4 hits; dash damage ×0.8.
// v1.2 (user request): S2 right after a dash is still the turnback (GB); S2 from neutral is a new
// power-up, オーバーチャージ (cost 2): attack +25% until Volt next takes damage.
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
      S: 15, A: 3, T: 37, reach: 2, lunge: 0.4,
      dmg: 40, hitstun: 26, blockstun: 12, hitstop: 6,
      next: 'n2', chainHit: [18, 27], chainBlock: [31, 37], cancel: [18, 27],
      knockback: 0.25, pushback: 0.4,
    },
    n2: {
      id: 'n2', name: '2段目', kind: 'normal', shape: 'circle',
      S: 14, A: 3, T: 46, reach: 2, lunge: 0.4,
      dmg: 36, hitstun: 30, blockstun: 14, hitstop: 6,
      next: 'n3', chainHit: [17, 26], chainBlock: [27, 46], cancel: [17, 26],
      knockback: 0.25, pushback: 0.4,
    },
    n3: {
      id: 'n3', name: '3段目', kind: 'normal', shape: 'circle',
      S: 18, A: 4, T: 55, reach: 2.125, lunge: 0.4,
      dmg: 62, hitstun: 0, blockstun: 16, hitstop: 10,
      knockdown: true, pushback: 0.6,
    },
  },
  skills: [
    {
      id: 'dashThrust', name: 'ダッシュスラスト', kind: 'skill', shape: 'circle',
      desc: '突進（単体でも、ステップ中からでも）。相手を突き抜けて背後へ（ヒット+3F・ガードされても+2F）。当たったら連打で次の突進が繋がる（コストの続く限り）。出始めと突進中に攻撃が触れると必ず負け、×1.5で食らう',
      cost: 1, S: 6, A: 8, T: 25, reach: 1, lunge: 0,
      dmg: 44, hitstun: 18, blockstun: 16, hitstop: 6,
      dash: { dist: 3.2, advHit: 3, advBlock: 2 },
      knockback: 0.6, pushback: 0,
      // hit → S1 again on frames 14–21: the next dash turns back and is guaranteed (a skill-only combo)
      cancelAny: [14, 21], cancelFrom: ['step', 'neutral', 'dashThrust'], cancelHitOnly: true,
    },
    {
      id: 'turnBack', name: 'ターンバック', kind: 'skill', shape: 'triangle',
      desc: 'ダッシュスラストの直後（8F以内）に押すと、振り返って背後の相手へガード崩し。何もしていない時に押すと「オーバーチャージ」',
      cost: 1, S: 26, A: 3, T: 54, reach: 2.5, lunge: 0.6, autoAim: true,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 6,
      guardBreak: { crush: 60, dmgGuard: 30, dmgOpen: 20 },
      cancelFrom: ['dashThrust'],
    },
  ],
  // S2 from neutral (not right after a dash): charge up. Pentagon = "hit me now" — the long,
  // harmless startup is the price; once charged, every attack does +25% until Volt takes damage.
  extraMoves: [
    {
      id: 'overcharge', name: 'オーバーチャージ', kind: 'skill', shape: 'pentagon',
      desc: '何もしていない時のS2。24F目に帯電し、次にダメージを受けるまで攻撃力+25%（重ねがけ不可）。溜め中は無防備',
      cost: 2, S: 24, A: 0, T: 40, reach: 0, lunge: 0,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 0,
      powerUp: { frame: 24, pct: 25 },
      cancelFrom: ['neutral'],
    },
  ],
  s2Neutral: 'overcharge',
  combos: [
    { route: '1→2→3', cost: 0, note: '基本（火力は低め）' },
    { route: 'S1→S1→S1→S1', cost: 4, note: '突進が当たったらS1連打。コストの数だけ繋がる（4回で167）。通常技には繋がらない' },
    { route: 'S1（ヒット）', cost: 1, note: '44。+3F' },
    { route: 'ステップ→S1(ガード)→S2(クラッシュ)→1→2→3', cost: 2, note: '裏に抜けてからの崩し' },
    { route: 'JA→2→3', cost: 0, note: 'ジャスト回避から' },
    { route: 'S2(オーバーチャージ)→…', cost: 2, note: '以降の攻撃すべて+25%（被弾で解除）。突進×4なら55+55+55+43' },
  ],
  tips: [
    '相手が振った瞬間（判定が出る前）に突進で刺す。ステップは3回あるので、突進とは別に動き回れる',
    '攻撃を置かれると最悪（×1.5で食らう）。六角（ガード・リポスト構え）には突進せず、突進→ターンバック',
    '突進をガードされた後は +2F。1段目・ターンバック・ガードのじゃんけん',
    '離れている時にS2でオーバーチャージ。溜め（五角）を見られたら殴られるので、距離を取ってから',
  ],
};
