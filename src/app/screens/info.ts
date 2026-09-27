// "How to play" and "Settings" screens.
import { CHARACTERS } from '../../data/characters';
import { SYSTEM } from '../../data/system';
import { backButton, h, hex, shapeIcon, SHAPE_INFO } from '../ui';
import { settings, saveSettings } from '../settings';
import { sfx, setVolume } from '../../audio/sfx';
import type { Screen } from '../router';

export function howtoScreen(onBack: () => void): Screen {
  const legend = h('div', { class: 'legend-grid' });
  for (const s of SHAPE_INFO) {
    legend.append(
      h('div', { class: 'legend-card' },
        h('div', { html: shapeIcon(s.shape, s.color) }),
        h('b', null, s.name),
        h('small', null, s.state),
        h('div', { class: 'act', style: `color:${s.color}` }, `→ ${s.act}`),
      ),
    );
  }
  const chars = h('div', { class: 'list' });
  for (const c of CHARACTERS) {
    chars.append(
      h('div', { class: 'row-set', style: `border-color:${hex(c.color)}55` },
        h('div', { class: 't' },
          h('b', { style: `color:${hex(c.color)}` }, `${c.name}  `, h('small', { style: 'font-family:var(--display);letter-spacing:.14em' }, c.nameEn)),
          h('small', null, `${c.theme}｜体力${c.hp}｜1段目 発生${c.normals.n1.S}F｜S1 ${c.skills[0].name}（${c.skills[0].desc}）｜S2 ${c.skills[1].name}（${c.skills[1].desc}）`),
          h('small', null, 'コンボ: ' + c.combos.map((x) => `${x.route}`).join(' ／ ')),
        ),
      ),
    );
  }
  const el = h('div', { class: 'screen' },
    h('div', { class: 'topbar' }, backButton(onBack), h('h2', null, 'HOW TO PLAY'), h('span', { class: 'sub' }, '遊び方')),
    h('div', { class: 'scroll' },
      h('div', { class: 'section-title' }, '形 ＝ 相手がとるべき対処'),
      legend,
      h('div', { class: 'section-title' }, '操作'),
      h('div', { class: 'prose', html: `
        <b>左手</b>：スティックで移動。<b>指を離す（中央）とガード</b>（六角）。ガード中は自動で相手を向きます。<br>
        <b>右手</b>：攻撃（1→2→3段）／S1・S2（スキル、コスト消費）／STEP（倒した方向へ。中央なら後ろへ）。<br>
        ボタンのアイコンは、その技を出したとき自分が変わる<b>形</b>です。` }),
      h('div', { class: 'section-title' }, '基本のじゃんけん'),
      h('div', { class: 'prose', html: `
        <b>六角（ガード）は 円（攻撃）に勝つ</b> — ガード硬直中に攻撃を押すと<b>ガード反撃（GC）</b>。基本はガード側有利。<br>
        <b>三角（GB）は 六角に勝つ</b> — ガード中の相手をスタン（星）させてフルコンボ。<br>
        <b>円とステップは 三角に勝つ</b> — GBは発生が遅く、ガードしていない相手には小ダメージだけ。<br>
        1段目が当たれば3段目まで確定。ガードされたら<b>止める</b>のが安全（2段目を入れ込むとGCが刺さる）。` }),
      h('div', { class: 'section-title' }, 'システム'),
      h('div', { class: 'prose', html: `
        ・<b>ガードゲージ</b>：ガード中だけ減る（${SYSTEM.guard.farDist}u以上離れていれば1/4）。0で自壊してスタン。六角の大きさがゲージです。<br>
        ・<b>コスト</b>：開始${SYSTEM.cost.start}・最大${SYSTEM.cost.max}。通常攻撃がヒット/ガードされると+0.5（1コンボ最大+1.5）、攻撃を受けた側も+0.25（最大+0.75）。キャラの足元の◆で相手のコストも読めます。<br>
        ・<b>ジャスト回避</b>：ステップの出始め（${SYSTEM.step.justFrames}F）に攻撃が触れると成立。直後の攻撃は1.5倍の<b>ジャスト攻撃</b>。<br>
        ・<b>カウンター</b>：相手の技の発生前に当てると威力+20%。<br>
        ・<b>起き上がり</b>：無敵中にスティック方向へ転がれます。<br>
        ・ラウンド${SYSTEM.round.seconds}秒・${SYSTEM.round.winsNeeded}本先取。時間切れは体力割合の多い方の勝ち。` }),
      h('div', { class: 'section-title' }, 'キャラクター'),
      chars,
      h('div', { class: 'section-title' }, 'キーボード'),
      h('div', { class: 'kbd-table', html: `
        <span><kbd>WASD</kbd>/<kbd>矢印</kbd></span><span>移動（離すとガード）</span>
        <span><kbd>J</kbd>/<kbd>Z</kbd></span><span>攻撃</span>
        <span><kbd>K</kbd>/<kbd>X</kbd> <kbd>L</kbd>/<kbd>C</kbd></span><span>S1 / S2</span>
        <span><kbd>Space</kbd></span><span>ステップ</span>
        <span><kbd>Esc</kbd></span><span>ポーズ</span>` }),
      h('div', { class: 'section-title' }, '2台で対戦するには'),
      h('div', { class: 'prose', html: `
        片方が「部屋を作る」でQRを表示 → もう片方が「部屋に入る」で読み取り → 表示されたQRを最初の人が読み取れば接続完了。<br>
        <b>テザリング／同じWi-Fi</b>だと直結になり、遅延はほぼゼロ。サーバーには何も送りません。` }),
    ),
  );
  return { el, onBack: () => (onBack(), true) };
}

export function settingsScreen(onBack: () => void): Screen {
  const toggle = (key: keyof typeof settings, title: string, sub: string) => {
    const t = h('button', { class: `toggle${settings[key] ? ' on' : ''}`, 'aria-label': title });
    t.onclick = () => {
      sfx.ui();
      saveSettings({ [key]: !settings[key] } as Partial<typeof settings>);
      t.classList.toggle('on', !!settings[key]);
    };
    return h('div', { class: 'row-set' }, h('div', { class: 't' }, h('b', null, title), h('small', null, sub)), t);
  };
  const range = (title: string, sub: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) => {
    const r = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()) }) as HTMLInputElement;
    r.oninput = () => set(parseFloat(r.value));
    r.onchange = () => sfx.ui();
    return h('div', { class: 'row-set' }, h('div', { class: 't' }, h('b', null, title), h('small', null, sub)), r);
  };
  const qual = h('div', { class: 'segmented' });
  const qualities: [typeof settings.quality, string][] = [['auto', '自動'], ['high', '高'], ['mid', '中'], ['low', '低']];
  const drawQ = () => {
    qual.innerHTML = '';
    for (const [q, label] of qualities) {
      const b = h('button', { class: settings.quality === q ? 'on' : '' }, label);
      b.onclick = () => {
        sfx.ui();
        saveSettings({ quality: q });
        drawQ();
      };
      qual.append(b);
    }
  };
  drawQ();
  const el = h('div', { class: 'screen' },
    h('div', { class: 'topbar' }, backButton(onBack), h('h2', null, 'SETTINGS'), h('span', { class: 'sub' }, '設定')),
    h('div', { class: 'scroll' },
      h('div', { class: 'list', style: 'max-width:640px;margin:8px auto 0' },
        range('音量', '効果音はすべてその場で合成しています', 0, 1, 0.05, () => settings.volume, (v) => { saveSettings({ volume: v }); setVolume(v); }),
        toggle('haptics', '振動', 'Androidのみ。ヒット/ガード/クラッシュで振動'),
        range('ボタンの大きさ', 'スティックとボタンの大きさ', 0.8, 1.3, 0.05, () => settings.buttonScale, (v) => saveSettings({ buttonScale: v })),
        toggle('lefty', '左右入れ替え', 'スティックを右手、ボタンを左手に'),
        toggle('dynamicCamera', 'ダイナミックカメラ', '近づくと寄って、形を大きく見せる'),
        toggle('reduceFlash', 'フラッシュを抑える', '画面の点滅・色収差を弱める（光過敏の方向け）'),
        toggle('showBrief', '開始前の形の確認', '1ラウンド目の前に形と対処を表示'),
        h('div', { class: 'row-set' }, h('div', { class: 't' }, h('b', null, '画質'), h('small', null, '自動：描画時間を測って段階を下げます（判定は常に60tick）')), qual),
      ),
    ),
  );
  return { el, onBack: () => (onBack(), true) };
}
