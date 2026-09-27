// Move sheet: a character's skills in detail (opened from the skill chips on the
// character cards). Each skill gets a real-speed animated preview, frame data,
// what it does, and — in the game's shape language — what the opponent should do.
import type { CharacterDef, MoveDef, Shape } from '../../data/types';
import { SYSTEM } from '../../data/system';
import { h, hex, modal, shapeIcon, SHAPE_INFO } from '../ui';
import { sfx } from '../../audio/sfx';

/** Real-speed loop of one skill: shape change, lunge / dash, telegraph, active bar, effect. */
function skillPreview(c: CharacterDef, m: MoveDef): { canvas: HTMLCanvasElement; stop: () => void } {
  const canvas = h('canvas') as HTMLCanvasElement;
  const col = hex(c.color);
  const cycle = 30 + m.T + 36;
  const lungeFrom = m.lungeFrom ?? Math.max(1, m.S - 8);
  let raf = 0;
  let t = 0;
  let last = performance.now();
  const polygon = (ctx: CanvasRenderingContext2D, n: number, r: number, rot = 0) => {
    ctx.beginPath();
    for (let k = 0; k < n; k++) ctx.lineTo(Math.cos(rot + (k * Math.PI * 2) / n) * r, Math.sin(rot + (k * Math.PI * 2) / n) * r);
    ctx.closePath();
  };
  const body = (ctx: CanvasRenderingContext2D, shape: Shape, R: number, f: number) => {
    if (shape === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
    } else if (shape === 'triangle') polygon(ctx, 3, R * 1.25);
    else if (shape === 'hexagon') polygon(ctx, 6, R * 1.12);
    else if (shape === 'pentagon') polygon(ctx, 5, R * 1.15, -Math.PI / 2);
    else {
      ctx.beginPath();
      ctx.rect(-R * 0.85, -R * 0.85, R * 1.7, R * 1.7);
    }
    ctx.fill();
    ctx.strokeStyle = shape === 'triangle' && Math.floor(f / 3) % 2 === 0 ? '#ffe070' : 'rgba(255,255,255,.85)';
    ctx.stroke();
  };
  const draw = (now: number) => {
    raf = requestAnimationFrame(draw);
    t += Math.min(4, (now - last) / (1000 / 60));
    last = now;
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (r.width === 0) return;
    if (canvas.width !== Math.round(r.width * dpr)) {
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const span = Math.max(4.2, 1.4 + m.lunge + m.reach + 0.6);
    const u = Math.min(W / span, H / 2.1);
    const x0 = u * 0.8;
    const cy = H / 2;
    ctx.strokeStyle = 'rgba(111,140,255,.12)';
    ctx.lineWidth = 1;
    for (let k = 0; k * u < W; k++) {
      ctx.beginPath();
      ctx.moveTo(x0 + k * u, 0);
      ctx.lineTo(x0 + k * u, H);
      ctx.stroke();
    }
    const f = Math.floor(t % cycle) - 30; // move frame (1 = press)
    const inMove = f >= 1 && f <= m.T;
    // lunge progress
    let travel = 0;
    if (m.lunge > 0 && f >= lungeFrom) travel = Math.min(1, (f - lungeFrom + 1) / Math.max(1, m.S - lungeFrom)) * m.lunge;
    if (f > m.T || f < 1) travel = f > m.T ? m.lunge : 0;
    const bx = x0 + travel * u;
    const R = u * 0.5;
    ctx.save();
    ctx.translate(bx, cy);
    ctx.fillStyle = col;
    ctx.lineWidth = 2 * dpr;
    ctx.shadowColor = col;
    ctx.shadowBlur = 16 * dpr;
    body(ctx, inMove ? m.shape : 'square', R, f);
    ctx.shadowBlur = 0;
    const edge = R * 1.05;
    const reach = m.reach * u;
    const danger = m.shape === 'triangle';
    if (inMove && m.A > 0 && m.reach > 0) {
      if (f < m.S) {
        const p = f / Math.max(1, m.S - 1);
        const len = edge + (reach - edge) * p;
        ctx.strokeStyle = danger ? '#ffd060' : 'rgba(255,255,255,.85)';
        ctx.lineWidth = (danger ? 4 : 3) * dpr;
        ctx.beginPath();
        ctx.moveTo(edge, 0);
        ctx.lineTo(len, 0);
        ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.moveTo(len + 8 * dpr, 0);
        ctx.lineTo(len - 5 * dpr, -7 * dpr);
        ctx.lineTo(len - 5 * dpr, 7 * dpr);
        ctx.fill();
      } else if (f < m.S + m.A + 3) {
        ctx.lineCap = 'round';
        ctx.strokeStyle = danger ? '#ffd060' : col;
        ctx.lineWidth = 10 * dpr;
        ctx.beginPath();
        ctx.moveTo(edge, 0);
        ctx.lineTo(reach, 0);
        ctx.stroke();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3 * dpr;
        ctx.stroke();
      }
    }
    // counter stance: glowing guard ring while it is live
    if (m.counterStance && inMove && f >= m.counterStance.from && f <= m.counterStance.to) {
      ctx.strokeStyle = 'rgba(200,220,255,.8)';
      ctx.lineWidth = 3 * dpr;
      polygon(ctx, 6, R * 1.55 + Math.sin(f * 0.5) * 2 * dpr);
      ctx.stroke();
    }
    // heal: rising number and ring at the heal frame
    if (m.heal && f >= m.heal.frame && f < m.heal.frame + 36) {
      const k = (f - m.heal.frame) / 36;
      ctx.strokeStyle = `rgba(157,255,200,${1 - k})`;
      ctx.lineWidth = 3 * dpr;
      ctx.beginPath();
      ctx.arc(0, 0, R * (1.2 + k * 1.6), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(157,255,200,${1 - k})`;
      ctx.font = `700 ${14 * dpr}px Chakra Petch, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`+${m.heal.hp}`, 0, -R * 1.4 - k * 20 * dpr);
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(200,210,240,.75)';
    ctx.font = `${10 * dpr}px Chakra Petch, sans-serif`;
    ctx.textAlign = 'left';
    if (inMove) {
      const phase = f < m.S ? '予兆' : f < m.S + m.A ? (m.A > 0 ? '判定' : '') : '硬直';
      ctx.fillText(`${f}F ${phase}`, 8 * dpr, 14 * dpr);
    }
  };
  raf = requestAnimationFrame(draw);
  return { canvas, stop: () => cancelAnimationFrame(raf) };
}

const cancelNames: Record<string, string> = { n1: '1段目', n2: '2段目', n3: '3段目', neutral: '通常時' };

function facts(m: MoveDef): [string, string][] {
  const rows: [string, string][] = [];
  if (m.counterStance) rows.push(['構え', `${m.counterStance.from}〜${m.counterStance.to}F（全体${m.T}F）`]);
  else if (m.heal) rows.push(['発動', `${m.heal.frame}F（全体${m.T}F）`]);
  else rows.push(['フレーム', `発生${m.S}F／持続${m.A}F／全体${m.T}F`]);
  if (m.guardBreak) {
    rows.push(['ガード中の相手', `クラッシュ：スタン${m.guardBreak.crush}F＋${m.guardBreak.dmgGuard}ダメージ → フルコンボへ`]);
    rows.push(['ガードしていない相手', `${m.guardBreak.dmgOpen}ダメージのみ（怯まない）`]);
  } else if (m.counterStance) {
    rows.push(['成立', `円の攻撃が触れると即反撃：${m.counterStance.dmg}ダメージ＋ダウン`]);
    rows.push(['弱点', '三角（ガードブレイク）には崩される']);
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
    rows.push(['出せる場面', from.join('・') + (m.cancelFrom.some((k) => k !== 'neutral') ? '（通常技はヒット／ガード時にキャンセル）' : '')]);
  }
  rows.push(['エイム', m.reach > 0 && m.A > 0 ? `ボタンをドラッグで方向${m.lunge > 0 ? 'と突進距離' : ''}を指定できる` : 'その場で発動（エイム不要）']);
  return rows;
}

function skillBlock(c: CharacterDef, m: MoveDef, slot: number, stops: (() => void)[]): HTMLElement {
  const info = SHAPE_INFO.find((s) => s.shape === m.shape)!;
  const pv = skillPreview(c, m);
  stops.push(pv.stop);
  const cost = h('span', { class: 'ms-cost' });
  for (let i = 0; i < Math.ceil(m.cost ?? 0); i++) cost.append(h('i'));
  const table = h('div', { class: 'ms-facts' });
  for (const [k, v] of facts(m)) table.append(h('span', null, k), h('b', null, v));
  return h('div', { class: 'ms-skill', id: `ms-${m.id}` },
    h('div', { class: 'ms-head' },
      h('span', { class: 'ms-icon', html: shapeIcon(m.shape, hex(c.color)) }),
      h('div', { class: 'ms-title' }, h('small', null, `S${slot + 1}`), h('b', null, m.name)),
      cost,
    ),
    h('div', { class: 'ms-body' },
      h('div', { class: 'ms-preview' }, pv.canvas),
      h('div', { class: 'ms-text' },
        m.desc ? h('p', null, m.desc) : null,
        h('div', { class: 'ms-read', style: `--sc:${info.color}` },
          h('span', { html: shapeIcon(m.shape, info.color) }),
          h('span', null, `相手には「${info.name}」に見える → `, h('b', null, info.act)),
        ),
        table,
      ),
    ),
  );
}

/** Open the move sheet for character `c`, scrolled to skill `focus` (0 / 1). */
export function openMoveSheet(c: CharacterDef, focus = 0): void {
  sfx.ui();
  const stops: (() => void)[] = [];
  const n = c.normals;
  const side = c.swing === 'right' ? '右' : '左';
  const normals = h('div', { class: 'ms-normals' },
    h('div', { class: 'ms-sub' }, `通常攻撃（円・前方70°の横振り：1段目は${side}から → 2段目は逆から → 3段目は一回転）`),
    h('div', { class: 'ms-ntable' },
      h('span'), h('small', null, '発生'), h('small', null, '全体'), h('small', null, '威力'), h('small', null, 'リーチ'),
      ...[n.n1, n.n2, n.n3].flatMap((m) => [h('b', null, m.name), h('span', null, `${m.S}F`), h('span', null, `${m.T}F`), h('span', null, String(m.dmg)), h('span', null, `${m.reach}u`)]),
    ),
  );
  const combos = h('div', { class: 'ms-combos' },
    h('div', { class: 'ms-sub' }, 'コンボ'),
    ...c.combos.map((x) => h('div', { class: 'ms-combo' }, h('b', null, x.route), h('span', null, `${x.cost ? `コスト${x.cost}・` : ''}${x.note}`))),
  );
  const tips = h('ul', { class: 'ms-tips' }, ...c.tips.map((t) => h('li', null, t)));
  const blocks = c.skills.map((m, i) => skillBlock(c, m, i, stops));
  const close = () => {
    stops.forEach((s) => s());
    m.close();
  };
  const m = modal(
    h('div', { class: 'list move-sheet', style: `--c:${hex(c.color)}` },
      h('div', { class: 'ms-top' },
        h('h3', { style: `color:${hex(c.color)}` }, c.name, h('small', null, c.nameEn)),
        h('span', { class: 'ms-theme' }, c.theme),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn small', onclick: () => { sfx.back(); close(); } }, '閉じる'),
      ),
      ...blocks,
      normals,
      combos,
      h('div', { class: 'ms-sub' }, '立ち回り'),
      tips,
    ),
    { wide: true, onBackdrop: close },
  );
  requestAnimationFrame(() => blocks[focus]?.scrollIntoView({ block: 'start' }));
}
