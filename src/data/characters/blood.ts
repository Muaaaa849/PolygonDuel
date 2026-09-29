import type { CharacterDef } from '../types';

// ブラッド（深紅）— 自傷・過負荷 (v1.7, user request)
// Weak on its own, terrifying while the overdrive burns, and weaker still once it burns out.
// Normals: Blaze's frames (so C1–C8 hold as for Blaze) with short reach and low damage.
//  S1 血の代償 (pentagon = "hit me", it stands there): HOLD the button to turn life into cost —
//     80 HP for +1.5 cost the moment it is pressed, then 20 HP for +0.25 every 1/3 s while held.
//     Only walking (−30%) is possible meanwhile; it ends on release / full cost / when hit, and
//     3 s of cooldown follow. It is at its safest while the opponent is on the floor (v1.6).
//  S2 オーバードライブ (pentagon): the cost gauge becomes the fuel — 1 quarter per 1.25 s (cost 4 =
//     20 s), no cost can be gained meanwhile. Damage +60%, walk +40%, reach +30%, the guard gauge
//     lasts 3 s, and ATK held after a 1st normal (10F) turns into a guard break (startup 30F from
//     the press). When the fuel runs out: 10 s of exhaustion (damage −20%, no new overdrive) and 3 s
//     in which only steps move it.
// The buffs are computed from state (Sim.powerOf / reachOf / walkSpeed): the move data stay plain.
export const blood: CharacterDef = {
  id: 'blood',
  name: 'ブラッド',
  nameEn: 'BLOOD',
  color: 0xe0143c,
  altColor: 0xff9db0,
  theme: '自傷・過負荷',
  blurb: '体力を削ってコストに変え、オーバードライブで超強化。通常時は弱く、切れた後はもっと弱い。',
  hp: 1000,
  walk: 4.6,
  step: { dist: 2.4, regen: 70 },
  guardMax: 90,
  swing: 'right',
  normals: {
    n1: {
      id: 'n1', name: '1段目', kind: 'normal', shape: 'circle',
      S: 17, A: 3, T: 39, reach: 2.0, lunge: 0.4,
      dmg: 34, hitstun: 26, blockstun: 12, hitstop: 6,
      next: 'n2', chainHit: [20, 29], chainBlock: [33, 39], cancel: [20, 29],
      knockback: 0.25, pushback: 0.4,
    },
    n2: {
      id: 'n2', name: '2段目', kind: 'normal', shape: 'circle',
      S: 14, A: 3, T: 46, reach: 2.0, lunge: 0.4,
      dmg: 30, hitstun: 30, blockstun: 14, hitstop: 6,
      next: 'n3', chainHit: [17, 26], chainBlock: [27, 46], cancel: [17, 26],
      knockback: 0.25, pushback: 0.4,
    },
    n3: {
      id: 'n3', name: '3段目', kind: 'normal', shape: 'circle',
      S: 18, A: 4, T: 55, reach: 2.125, lunge: 0.4,
      dmg: 54, hitstun: 0, blockstun: 16, hitstop: 10,
      knockdown: true, pushback: 0.6,
    },
  },
  skills: [
    {
      id: 'bloodCharge', name: '血の代償', kind: 'skill', shape: 'pentagon',
      desc: '体力を削ってコストに変える。押した瞬間にコスト+1.5、押し続けるとじわじわ増える。押している間は移動（−30%）以外できない。離す・コスト満タン・被弾で終わり、3秒のクールタイム。オーバードライブ中は使えない',
      cost: 0, S: 1, A: 0, T: 600, reach: 0, lunge: 0,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 0,
      channel: { hp: 80, gain: 6, every: 20, tickHp: 20, tickGain: 1, cooldown: 180, walkPct: 70, minHold: 8 },
      cancelFrom: ['neutral'],
    },
    {
      id: 'overdrive', name: 'オーバードライブ', kind: 'skill', shape: 'pentagon',
      desc: 'コストを燃料に超強化（攻撃+60%・移動+40%・リーチ+30%・ガード3秒）。コストが徐々に減り、4なら20秒。解除不能・その間コストは増えない。通常攻撃の長押しでガード崩し（発生30F）。燃え尽きると10秒間弱体化し、3秒は歩けずステップだけ',
      cost: 0, S: 22, A: 0, T: 34, reach: 0, lunge: 0,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 0,
      driveOn: 22, cancelFrom: ['neutral'],
    },
  ],
  extraMoves: [
    {
      id: 'driveBreak', name: 'クラッシュブロウ', kind: 'skill', shape: 'triangle',
      desc: 'オーバードライブ中、通常攻撃の長押しで出るガード崩し。押してから30Fで発生',
      cost: 0, S: 30, A: 3, T: 60, reach: 2.0, lunge: 0.8,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 6,
      guardBreak: { crush: 70, dmgGuard: 30, dmgOpen: 25 },
    },
  ],
  drive: {
    drainFrames: 75, minCost: 1, power: 60, walk: 40, reach: 30,
    hold: { at: 10, move: 'driveBreak' },
    exhaust: { frames: 600, noWalk: 180, power: -20 },
  },
  combos: [
    { route: '1→2→3', cost: 0, note: '基本。弱いので無理に振らない' },
    { route: 'S1(長押し)→S2', cost: 0, note: '体力を払ってコストを溜め、オーバードライブへ' },
    { route: 'S2中: 1→2→3', cost: 0, note: '+60%・リーチ+30%。3段目でダウンさせたら仕切り直し' },
    { route: 'S2中: ATK長押し', cost: 0, note: '30Fのガード崩し。ガード固めへの回答（見られると避けられる）' },
    { route: 'JA→2→3', cost: 0, note: 'ジャスト回避から' },
  ],
  tips: [
    '倒した直後（相手は75F動けない）は最高の充填タイム。S1を押しっぱなしで溜める',
    'オーバードライブ中はコストが増えない＝時間との勝負。4溜めて20秒、燃え尽きると10秒は最弱',
    '燃え尽きた直後の3秒は歩けない。ステップと残りのガードで耐える',
  ],
};
