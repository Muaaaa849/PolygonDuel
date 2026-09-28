// Move sheet: a character's skills in detail (opened from the skill chips on the
// character cards). A live demo (the real sim + battle renderer, see move-demo.ts)
// plays the selected move; below it: frame data, what it does, and — in the game's
// shape language — what the opponent should do.
import type { CharacterDef, MoveDef } from '../../data/types';
import { MoveDemo, type DemoKind } from './move-demo';
import { SYSTEM } from '../../data/system';
import { h, hex, modal, shapeIcon, SHAPE_INFO } from '../ui';
import { sfx } from '../../audio/sfx';
import { app } from '../../render/pixi-app';

const cancelNames: Record<string, string> = { n1: '1段目', n2: '2段目', n3: '3段目', neutral: '通常時', step: 'ステップ中（3F目〜）', dashThrust: 'ダッシュスラストの直後' };

function facts(m: MoveDef, c?: CharacterDef): [string, string][] {
  const rows: [string, string][] = [];
  if (m.mode === 1 && c?.shooter) {
    // レイ S1: the shooting mode (the bullets and the blast are extra moves)
    const ex = (id: string) => c.extraMoves!.find((x) => x.id === id)!;
    const s1 = ex(c.shooter.shots[0]);
    const s3 = ex(c.shooter.shots[2]);
    const p = s1.projectile!;
    const off = ex(c.shooter.off);
    const bl = ex(c.shooter.blast);
    rows.push(['切替', `射撃モードへ：コスト${m.cost}・全体${m.T}F／通常へ戻す：コスト${off.cost ?? 0}・全体${off.T}F（被弾しても維持、ラウンドごとに解除）`]);
    rows.push(['射撃（ATK）', `菱形の弾を最大3発。発射${p.at}F・全体${s1.T}F（3発目${s3.T}F）。次の発射は各発の${s1.chainAny![0]}〜${s1.chainAny![1]}F（遅らせられる）`]);
    rows.push(['弾', `速さ${p.speed}u/F・射程${p.range}u。ヒット${p.dmg}（硬直${p.hitstun}F・補正なし）／ガード0（${p.guardPush}u飛ばす、壁に触れると30）`]);
    rows.push(['弱点', 'ステップの移動中に弾へ飛び込まれると弾ジャスト：射手は弾切れ硬直、反撃（JA）が確定']);
    rows.push(['射撃中', `歩きが遅くなる（${c.shooter.walk}u/s）。1〜3段目は出ない（GC・JAは近接のまま）`]);
    rows.push(['切替ブラスト', `2段目のヒット／ガード後にS1：発生${bl.S}F・${bl.dmg}ダメージ＋ダウン（${bl.launch}u吹き飛ばす）、ガードでも${bl.pushback}u（壁で30）。射撃モードへ（コスト${bl.cost}）`]);
    return rows;
  }
  if (m.field) {
    const F = m.field;
    rows.push(['フレーム', `${F.at}F目に設置（全体${m.T}F）`]);
    rows.push(['場所', `エイムした地点（最大${F.maxDist}u）／タップなら相手の足元`]);
    rows.push(['効果', `半径${F.radius}u・${Math.round(F.frames / 60)}秒。中でステップすると感電：${F.dmg}ダメージ＋よろけ${F.stun}F（ステップ中断）`]);
    rows.push(['安全', '歩く・ガード・攻撃は平気。置けるのは1つまで（新しく置くと古いのは消える）']);
    rows.push(['使い方', '弾の正解（ステップ）を封じる。輪の中の相手は、中央ならガード、壁際なら食らうしかない']);
    return rows;
  }
  if (m.dash) {
    rows.push(['フレーム', `発生${m.S}F／持続${m.A}F（この間に${m.dash.dist}u前進）／全体${m.T}F`]);
    rows.push(['出せる場面', 'ステップ中だけ（3F目から）。通常時は出ない']);
    rows.push(['すり抜け', '持続中は相手をすり抜けて背後へ抜ける']);
    rows.push(['威力', `${m.dmg}。ヒットで+${m.dash.advHit}F（コンボにはならない）、ガードされても+${m.dash.advBlock}F`]);
    rows.push(['弱点', '出始めと突進中に相手の攻撃（弾・三角も）が触れると必ず負け、×1.5で食らう']);
    rows.push(['エイム', 'ボタンをドラッグで方向を指定できる']);
    return rows;
  }
  if (m.ghost) {
    rows.push(['フレーム', `本体の硬直${m.T}F（その後は自由に動ける）`]);
    rows.push(['離れて使う', '幻影がステップで迫り、斬りかかる直前に消える（約0.5秒）']);
    rows.push(['近くで使う', '幻影が1段目を振り、刃が相手をすり抜けた所で消える（約0.4秒）']);
    rows.push(['本体', '幻影の間は相手から見えない（コスト表示もごまかす）。攻撃・ステップ・被弾で姿を現す']);
    rows.push(['消える', '時間切れ／相手の攻撃が幻影に触れる／本体が動く']);
    rows.push(['使い方', '幻影にガードさせてS2で崩す。幻影を無視する相手には本物の1段目']);
    return rows;
  }
  if (m.counterStance) rows.push(['構え', `${m.counterStance.from}〜${m.counterStance.to}F（全体${m.T}F）`]);
  else if (m.heal) rows.push(['発動', `${m.heal.frame}F（全体${m.T}F）`]);
  else rows.push(['フレーム', `発生${m.S}F／持続${m.A}F／全体${m.T}F`]);
  if (m.guardBreak) {
    rows.push(['ガード中の相手', `クラッシュ：スタン${m.guardBreak.crush}F＋${m.guardBreak.dmgGuard}ダメージ → フルコンボへ`]);
    rows.push(['ガードしていない相手', `${m.guardBreak.dmgOpen}ダメージのみ（怯まない）`]);
  } else if (m.counterStance) {
    const cs = m.counterStance;
    rows.push(['成立', `円の攻撃が触れると即反撃：${cs.dmg}ダメージ＋よろけ（${cs.stagger}F）。相手を${cs.pull}uまで引き寄せる`]);
    rows.push(['追撃', `反撃の${cs.chain[0]}〜${cs.chain[1]}Fに攻撃で 2段目→3段目（ガード→GCより痛い）`]);
    rows.push(['コスト', `成立するとコスト${cs.refund}が戻る（外すと支払ったまま）`]);
    rows.push(['弱点', '三角（ガードブレイク）には崩される。何も来なければ隙だらけ']);
  } else if (m.heal) {
    rows.push(['効果', `HP+${m.heal.hp}、${Math.round(m.heal.buffFrames / 60)}秒間 移動+${m.heal.walkPct}%・ステップ回復×${m.heal.stepRegenMul}`]);
    if (m.usesPerRound) rows.push(['回数', `1ラウンド${m.usesPerRound}回まで`]);
  } else if (m.dmg > 0) {
    rows.push(['威力', `${m.dmg}（ヒット硬直${m.hitstun}F／ガード硬直${m.blockstun}F）`]);
  }
  if (m.reach > 0) rows.push(['距離', `リーチ${m.reach}u${m.lunge > 0 ? `＋${m.lunge >= 1 ? '突進' : '踏み込み'}${m.lunge}u` : ''}`]);
  if (m.chainReset) rows.push(['チェーン初期化', `ヒット後${m.chainReset[0]}〜${m.chainReset[1]}Fに攻撃で1段目から（1コンボ1回）`]);
  if (m.otg) rows.push(['ダウン追撃', `倒れた相手に当たる（ダウンから${SYSTEM.down.otgWindow}F以内・1コンボ1回）`]);
  if (m.cancelFrom?.length) {
    const from = m.cancelFrom.map((k) => cancelNames[k] ?? k);
    const normal = m.cancelFrom.some((k) => k === 'n1' || k === 'n2' || k === 'n3');
    rows.push(['出せる場面', from.join('・') + (normal ? '（通常技はヒット／ガード時にキャンセル）' : m.cancelFrom.includes('dashThrust') ? '（持続が終わってから8F以内。ヒット・ガード・空振りどれでも）' : '')]);
  }
  rows.push(['エイム', m.reach > 0 && m.A > 0 ? `ボタンをドラッグで方向${m.lunge > 0 ? 'と突進距離' : ''}を指定できる` : 'その場で発動（エイム不要）']);
  return rows;
}

/** Total frames of a whiffed normal (only part of the recovery is played; see core/compile.ts). */
const whiffT = (m: MoveDef): number => m.S + m.A - 1 + Math.ceil((m.T - (m.S + m.A - 1)) * SYSTEM.whiffRecovery);

function skillBlock(c: CharacterDef, m: MoveDef, slot: number): HTMLElement {
  const info = SHAPE_INFO.find((x) => x.shape === m.shape)!;
  const cost = h('span', { class: 'ms-cost' });
  for (let i = 0; i < Math.ceil(m.cost ?? 0); i++) cost.append(h('i'));
  const table = h('div', { class: 'ms-facts' });
  for (const [k, v] of facts(m, c)) table.append(h('span', null, k), h('b', null, v));
  return h('div', { class: 'ms-skill' },
    h('div', { class: 'ms-head' },
      h('span', { class: 'ms-icon', html: shapeIcon(m.shape, hex(c.color)) }),
      h('div', { class: 'ms-title' }, h('small', null, `S${slot + 1}`), h('b', null, m.name)),
      cost,
    ),
    h('div', { class: 'ms-text' },
      m.desc ? h('p', null, m.desc) : null,
      h('div', { class: 'ms-read', style: `--sc:${info.color}` },
        h('span', { html: shapeIcon(m.shape, info.color) }),
        h('span', null, `相手には「${info.name}」に見える → `, h('b', null, info.act)),
      ),
      table,
    ),
  );
}

function normalsBlock(c: CharacterDef): HTMLElement {
  const n = c.normals;
  const side = c.swing === 'right' ? '右' : '左';
  return h('div', { class: 'ms-skill' },
    h('div', { class: 'ms-head' },
      h('span', { class: 'ms-icon', html: shapeIcon('circle', hex(c.color)) }),
      h('div', { class: 'ms-title' }, h('small', null, 'ATK'), h('b', null, '通常攻撃 1→2→3')),
    ),
    h('div', { class: 'ms-text' },
      h('p', null, `円・前方70°の横振り。1段目は${side}から → 2段目は逆から → 3段目は一回転してダウン。1段目が当たれば3段目まで確定。空振りは硬直が短い（置いておける）。ステップ中に押すと、ステップの勢いのまま出る。`),
      h('div', { class: 'ms-ntable' },
        h('span'), h('small', null, '発生'), h('small', null, '全体'), h('small', null, '空振り'), h('small', null, '威力'), h('small', null, 'リーチ'),
        ...[n.n1, n.n2, n.n3].flatMap((m) => [h('b', null, m.name), h('span', null, `${m.S}F`), h('span', null, `${m.T}F`), h('span', null, `${whiffT(m)}F`), h('span', null, String(m.dmg)), h('span', null, `${m.reach}u`)]),
      ),
    ),
  );
}

let sheetOpen = false;
/** A move sheet covers the screen (menu animations underneath can rest). */
export const moveSheetOpen = (): boolean => sheetOpen;

/** Open the move sheet for character `c`, showing skill `focus` (0 / 1). */
export function openMoveSheet(c: CharacterDef, focus = 0): void {
  sfx.ui();
  sheetOpen = true;
  const kinds: DemoKind[] = ['s1', 's2', 'normals'];
  const blocks = [skillBlock(c, c.skills[0], 0), skillBlock(c, c.skills[1], 1), normalsBlock(c)];
  const detail = h('div');
  const tabs = h('div', { class: 'segmented ms-tabs' });
  const stageEl = h('div', { class: 'ms-stage' });
  const demo = new MoveDemo(c, stageEl);
  let cur = focus;
  const labels = [`S1 ${c.skills[0].name}`, `S2 ${c.skills[1].name}`, '通常攻撃'];
  const select = (i: number) => {
    cur = i;
    tabs.innerHTML = '';
    labels.forEach((l, k) => {
      const b = h('button', { class: k === cur ? 'on' : '' }, l);
      b.onclick = () => {
        sfx.ui();
        select(k);
      };
      tabs.append(b);
    });
    detail.innerHTML = '';
    detail.append(blocks[i]);
    demo.play(kinds[i]);
  };
  const combos = h('div', { class: 'ms-combos' },
    h('div', { class: 'ms-sub' }, 'コンボ'),
    ...c.combos.map((x) => h('div', { class: 'ms-combo' }, h('b', null, x.route), h('span', null, `${x.cost ? `コスト${x.cost}・` : ''}${x.note}`))),
  );
  const tips = h('ul', { class: 'ms-tips' }, ...c.tips.map((t) => h('li', null, t)));
  // the menu canvas sits under the sheet's blurred backdrop while the demo draws its own:
  // freeze it (one WebGL canvas animating at a time, and the blur is not redone every frame)
  const menuTicking = app.ticker.started;
  if (menuTicking) app.ticker.stop();
  const close = () => {
    demo.destroy();
    m.close();
    sheetOpen = false;
    if (menuTicking) app.ticker.start();
  };
  const m = modal(
    h('div', { class: 'list move-sheet', style: `--c:${hex(c.color)}` },
      h('div', { class: 'ms-top' },
        h('h3', { style: `color:${hex(c.color)}` }, c.name, h('small', null, c.nameEn)),
        h('span', { class: 'ms-theme' }, c.theme),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn small', onclick: () => { sfx.back(); close(); } }, '閉じる'),
      ),
      tabs,
      h('div', { class: 'ms-live' }, stageEl, detail),
      combos,
      h('div', { class: 'ms-sub' }, '立ち回り'),
      tips,
    ),
    { wide: true, onBackdrop: close },
  );
  select(focus);
  // the stage has its size only once the modal is in the DOM
  requestAnimationFrame(() => void demo.start(kinds[cur]));
}
