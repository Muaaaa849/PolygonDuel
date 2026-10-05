import type { CharacterDef } from '../types';

// スケッチ（白）— お絵かき・壁づくり (v1.7, user request)
// The arena has walls for a knockback to slam into (30–60). Sketch draws more of them.
// Normals: Blaze's frames (so C1–C8 hold as for Blaze), modest damage and reach.
//  v1.9: S1 is tap / hold — a TAP draws a square of ink around the opponent (cost 1.5), a HOLD the trail below (cost 1).
//     Ink lasts 10 s; the normals leave ink at the blade's tip too (safe for the opponent until that exchange is over);
//     standing inside a closed loop of her ink heals her slowly. Knockbacks: normals 0.35u, N3 1.9u, S2 2.2u.
//  S1 インクトレイル (pentagon, cost 1): for 5 s the path Sketch walks / steps / lunges along leaves ink that lasts 8 s.
//     Both pieces walk straight through it — it is only there for a body being KNOCKED BACK (hit stun / down / stun):
//     the opponent that slides across it hits it like a wall, for MORE than the wall (45 + up to 45 instead of
//     30 + 30, same 2-per-combo limit), and that piece of ink is gone.
//  S2 フリック (circle, cost 2): a light knockback attack (1.9u, a touch more than N3's 1.6u launch) that sends the
//     target where the STICK points when it lands — not where the piece faces. 1→2→S2 is the finisher for when
//     the 3rd normal (which throws straight away from her) can't reach a wall: hold the stick toward the ink / wall.
//     Guarded, it is an ordinary circle (blocked, pushed straight back).
// Cancel timing: S2 (S16) out of N2 [17,26]: the last cancel frame hits on N2 frame 41 < 14 + 30 (N2's hit stun).
export const sketch: CharacterDef = {
  id: 'sketch',
  name: 'スケッチ',
  nameEn: 'SKETCH',
  color: 0xf0f4ff,
  altColor: 0x8b9bb5,
  theme: 'お絵かき・壁',
  blurb: '動いた跡がインクの壁になる。ふっ飛ばした相手が壁に触れると、壁より痛い。S2は入力した方向へ吹き飛ばす。',
  hp: 900,
  walk: 4.8,
  step: { dist: 2.6, regen: 63 },
  guardMax: 90,
  swing: 'left',
  inkSwing: true,
  inkHeal: { every: 10, hp: 1, ray: 6 },
  normals: {
    n1: {
      id: 'n1', name: '1段目', kind: 'normal', shape: 'circle',
      S: 17, A: 3, T: 39, reach: 2.25, lunge: 0.4,
      dmg: 40, hitstun: 26, blockstun: 12, hitstop: 6,
      next: 'n2', chainHit: [20, 29], chainBlock: [33, 39], cancel: [20, 29],
      knockback: 0.35, pushback: 0.4,
    },
    n2: {
      id: 'n2', name: '2段目', kind: 'normal', shape: 'circle',
      S: 14, A: 3, T: 46, reach: 2.25, lunge: 0.4,
      dmg: 36, hitstun: 30, blockstun: 14, hitstop: 6,
      next: 'n3', chainHit: [17, 26], chainBlock: [27, 46], cancel: [17, 26],
      knockback: 0.35, pushback: 0.4,
    },
    n3: {
      id: 'n3', name: '3段目', kind: 'normal', shape: 'circle',
      S: 18, A: 4, T: 55, reach: 2.375, lunge: 0.4,
      dmg: 64, hitstun: 0, blockstun: 16, hitstop: 10,
      knockdown: true, launch: 1.9, pushback: 0.6, // (v1.9: thrown 1.9u instead of the usual 1.6u)
    },
  },
  skills: [
    {
      id: 'inkTrail', name: 'インク', kind: 'skill', shape: 'pentagon',
      desc: 'タップ：相手の周りを四角いインクで囲む（コスト1.5）。長押し：5秒間、動いた跡がインクになる（コスト1）。インクは10秒残り、通り抜けはできるが、ノックバックで吹き飛ばされた相手が触れると、壁に当たったように追加ダメージ（壁より痛い）。インクは当たると消える。閉じたインクの中にいると体力がじわじわ回復',
      cost: 1, S: 3, A: 0, T: 16, reach: 0, lunge: 0,
      dmg: 0, hitstun: 0, blockstun: 0, hitstop: 0,
      ink: { at: 0, draw: 300, life: 600, gap: 0.8, dmg: 45, bonus: 45 },
      inkBox: { hold: 10, half: 1.5, cost: 1.5 },
      cancelFrom: ['neutral'],
    },
    {
      id: 'flick', name: 'フリック', kind: 'skill', shape: 'circle',
      desc: 'ノックバック攻撃（2.2u）。当たった瞬間に「移動スティックを倒している方向」へ吹き飛ばす（コマの向きは関係ない）。通常攻撃の2段目から繋がる。壁やインクへ叩きつける締め',
      cost: 2, S: 16, A: 4, T: 45, reach: 2.8, lunge: 0.4,
      sweep: [-75, 75], // a wide fan (±75°) — far more forgiving than the old thin thrust
      dmg: 40, hitstun: 26, blockstun: 14, hitstop: 8,
      knockback: 2.2, pushback: 0.5, dirKnock: true, // (v1.9: 1.9 → 2.2u)
      cancelFrom: ['n2', 'neutral'],
    },
  ],
  combos: [
    { route: '1→2→3', cost: 0, note: '基本。3段目は相手を真っ直ぐ後ろへ1.9u倒す' },
    { route: '1→2→S2', cost: 2, note: '当たる瞬間にスティックを壁・インクへ向けて吹き飛ばす' },
    { route: 'S1(タップ)→1→2→3', cost: 1.5, note: '四角で囲んでから。3段目で囲いに叩きつける' },
    { route: 'S1(長押し)→(動く)→1→2→S2', cost: 3, note: '壁を描いてから、その方向へ吹き飛ばす' },
    { route: 'JA→2→S2', cost: 2, note: 'ジャスト回避から' },
  ],
  tips: [
    '通常攻撃を振ると刃の先にもインクが残る（そのコンボ中は相手に当たらない）。空振りでも「壁を置ける」',
    '閉じたインク（四角・一回転の3段目の円など）の中にいると体力が少しずつ回復する',
    '相手の後ろにインクを引いておく。3段目・S2で吹き飛ばした先にインクがあれば壁ダメージ（コンボ中2回まで）',
    'S2は押している間ではなく「当たる瞬間」のスティック方向へ飛ぶ。当たるまで方向を保つ',
    'インクは通り抜けできるので、敵にも自分にも邪魔にならない。逃げ道を塞ぐのではなく「落とし穴」',
  ],
};
