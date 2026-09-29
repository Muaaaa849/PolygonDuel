// "How to play" and "Settings" screens.
import { CHARACTERS } from '../../data/characters';
import { SYSTEM } from '../../data/system';
import { backButton, h, hex, shapeIcon, SHAPE_INFO } from '../ui';
import { settings, saveSettings } from '../settings';
import { sfx, setVolume } from '../../audio/sfx';
import { show, type Screen } from '../router';
import { layoutEditorScreen, exportSettingsFile, openImport } from './layout-editor';
import { keybindScreen } from './keybind-editor';
import { keyLabel, keysFor } from '../../input/keyboard';

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
        <b>右手</b>：攻撃（1→2→3段。前方70°の横振りで、1段目はキャラごとに右／左から、2段目は逆から、3段目は一回転）／S1・S2（スキル、コスト消費）／STEP（倒した方向へ。中央なら後ろへ）。<br>
        <b>エイム</b>：攻撃・スキルボタンを<b>押したままドラッグ</b>すると、狙う方向と踏み込む距離を指定できます（範囲が光ります）。離すと発動、中央に戻して離すとキャンセル。タップなら相手を自動で狙います。下がりながら前を斬る・動く相手の先を狙う、ができます。<br>
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
        ・<b>攻撃中の移動</b>：通常攻撃（1〜3段目・ガード反撃・ジャスト攻撃）の最中も、スティックを倒せば通常の30%の速さで動けます（スキルは動けません）。<br>
        ・<b>ダウン・起き上がり</b>：倒れている間と起き上がりは無敵。周りの輪の弧が「両者が動けるようになるまで」の残り時間（目盛り1つ＝0.25秒、最後の琥珀色＝起き上がり）（ダウン追撃技だけ、倒れてから${SYSTEM.down.otgWindow}F以内に1回当たる）。その間はお互いに攻撃・スキル・ステップが出せず、起き上がった瞬間に両者同時に動けます（有利不利なし）。起き上がりはスティック方向へ転がれます。<br>
        ・ラウンド${SYSTEM.round.seconds}秒・${SYSTEM.round.winsNeeded}本先取。時間切れは体力割合の多い方の勝ち。` }),
      h('div', { class: 'section-title' }, 'キャラクター'),
      chars,
      h('div', { class: 'section-title' }, 'キーボード'),
      h('div', { class: 'kbd-table', html: kbdRows() }),
      h('div', { class: 'prose', html: 'キーとマウスのボタンは <b>設定 → キー設定</b> で自由に変更できます。PCでは画面のボタンが消え、<b>攻撃・スキルはマウスカーソルの方向へ</b>出ます（設定の「マウスで狙う」をオフにすると相手へ自動で向きます）。' }),
      h('div', { class: 'section-title' }, 'オンライン対戦'),
      h('div', { class: 'prose', html: `
        <b>遠くの人と（リンク）</b>：「リンクで部屋を作る」→ 表示されたリンクをLINEやDiscordで送る → 相手がリンクを開けば接続。ルームコード（6文字）を入力しても参加できます。部屋を作った人はその画面を開いたままにしてください。
        接続情報の受け渡しにだけ公開のシグナリングサーバー（PeerJS）を使い、対戦そのものは端末どうしの直接通信です。<br>
        <b>近くの人と（QR）</b>：「QRで部屋を作る」でQRを表示 → もう片方が「QRで部屋に入る」で読み取り → 表示されたQRを最初の人が読み取れば接続完了。
        <b>テザリング／同じWi-Fi</b>だと直結になり、遅延はほぼゼロ。サーバーには何も送りません。` }),
    ),
  );
  return { el, onBack: () => (onBack(), true) };
}

/** The current (solo) key bindings as the help table rows. */
function kbdRows(): string {
  const k = keysFor('solo');
  const kb = (codes: string[]) => codes.map((c) => `<kbd>${keyLabel(c)}</kbd>`).join('/') || '—';
  const move = [...k.up.slice(0, 1), ...k.left.slice(0, 1), ...k.down.slice(0, 1), ...k.right.slice(0, 1)];
  return `
        <span>${kb(move)}</span><span>移動（自動ガードの時は、離すとガード）</span>
        <span>${kb(k.atk)}</span><span>攻撃</span>
        <span>${kb(k.s1)} ${kb(k.s2)}</span><span>S1 / S2</span>
        <span>${kb(k.step)}</span><span>ステップ</span>
        <span>${kb(k.guard)}</span><span>ガード（設定で「手動」の時）</span>
        <span><kbd>Esc</kbd></span><span>ポーズ</span>`;
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
  const guardSeg = h('div', { class: 'segmented' });
  const drawG = () => {
    guardSeg.innerHTML = '';
    for (const [g, label] of [['auto', '自動'], ['manual', '手動（ボタン）']] as const) {
      const b = h('button', { class: settings.guardMode === g ? 'on' : '' }, label);
      b.onclick = () => {
        sfx.ui();
        saveSettings({ guardMode: g });
        drawG();
      };
      guardSeg.append(b);
    }
  };
  drawG();
  const dirSeg = h('div', { class: 'segmented' });
  const drawD = () => {
    dirSeg.innerHTML = '';
    for (const [v, label] of [['foe', '相手へ'], ['stick', '移動方向へ']] as const) {
      const b = h('button', { class: settings.attackDir === v ? 'on' : '' }, label);
      b.onclick = () => {
        sfx.ui();
        saveSettings({ attackDir: v });
        drawD();
      };
      dirSeg.append(b);
    }
  };
  drawD();
  const touchSeg = h('div', { class: 'segmented' });
  const drawT = () => {
    touchSeg.innerHTML = '';
    for (const [v, label] of [['auto', '自動'], ['show', '表示'], ['hide', '隠す']] as const) {
      const b = h('button', { class: settings.touchControls === v ? 'on' : '' }, label);
      b.onclick = () => {
        sfx.ui();
        saveSettings({ touchControls: v });
        drawT();
      };
      touchSeg.append(b);
    }
  };
  drawT();
  const el = h('div', { class: 'screen' },
    h('div', { class: 'topbar' }, backButton(onBack), h('h2', null, 'SETTINGS'), h('span', { class: 'sub' }, '設定')),
    h('div', { class: 'scroll' },
      h('div', { class: 'list', style: 'max-width:640px;margin:8px auto 0' },
        range('音量', '効果音はすべてその場で合成しています', 0, 1, 0.05, () => settings.volume, (v) => { saveSettings({ volume: v }); setVolume(v); }),
        toggle('haptics', '振動', 'Androidのみ。ヒット/ガード/クラッシュで振動'),
        range('ボタンの大きさ', 'スティックとボタンの大きさ', 0.8, 1.3, 0.05, () => settings.buttonScale, (v) => saveSettings({ buttonScale: v })),
        toggle('lefty', '左右入れ替え', 'スティックを右手、ボタンを左手に（ボタン配置を編集していない時）'),
        h('div', { class: 'row-set' },
          h('div', { class: 't' }, h('b', null, 'ボタン配置'), h('small', null, settings.layout ? 'カスタム配置を使用中' : '好きな位置・大きさにドラッグで変更できます')),
          h('button', { class: 'btn small primary', onclick: () => { sfx.ui(); show(layoutEditorScreen(() => show(settingsScreen(onBack)))); } }, '編集'),
        ),
        h('div', { class: 'row-set' },
          h('div', { class: 't' }, h('b', null, '設定ファイル'), h('small', null, '設定はこのブラウザに自動保存されます。別のブラウザ・端末へは書き出し→読み込みで移せます')),
          h('div', { style: 'display:flex;gap:6px' },
            h('button', { class: 'btn small', onclick: () => exportSettingsFile() }, '書き出し'),
            h('button', { class: 'btn small', onclick: () => openImport(() => show(settingsScreen(onBack))) }, '読み込み'),
          ),
        ),
        h('div', { class: 'row-set' }, h('div', { class: 't' }, h('b', null, 'ガード'), h('small', null, '自動：立ち止まる（スティックを離す）とガード。手動：GUARDボタンを押している間だけガード（止まっていてもガードしない）')), guardSeg),
        h('div', { class: 'row-set' }, h('div', { class: 't' }, h('b', null, '攻撃の向き'), h('small', null, '移動しながら攻撃・スキルを押した時（エイムしていない時）。相手へ：移動中でも相手の方へ振る。移動方向へ：動いている方向へ振る')), dirSeg),
        h('div', { class: 'row-set' }, h('div', { class: 't' }, h('b', null, '画面のボタン'), h('small', null, '自動：タッチ画面の時だけ表示（PCではキーボードとマウスで操作）')), touchSeg),
        h('div', { class: 'row-set' },
          h('div', { class: 't' }, h('b', null, 'キー設定'), h('small', null, 'キーボードとマウスのボタンを自由に割り当て（ひとり用・ローカル対戦の1P／2P）')),
          h('button', { class: 'btn small primary', onclick: () => { sfx.ui(); show(keybindScreen(() => show(settingsScreen(onBack)))); } }, '編集'),
        ),
        toggle('mouseAim', 'マウスで狙う', 'PC（画面のボタンを出していない時）：攻撃・スキルはマウスカーソルの方向へ。オフ：「攻撃の向き」の設定に従う'),
        toggle('aimMode', 'ドラッグでエイム', '攻撃・スキルボタンを押したままドラッグで方向と距離を指定、離して発動。オフ：押した瞬間に発動'),
        toggle('dynamicCamera', 'ダイナミックカメラ', '近づくと寄って、形を大きく見せる'),
        toggle('reduceFlash', 'フラッシュを抑える', '画面の点滅・色収差を弱める（光過敏の方向け）'),
        toggle('showBrief', '開始前の形の確認', '1ラウンド目の前に形と対処を表示'),
        h('div', { class: 'row-set' }, h('div', { class: 't' }, h('b', null, '画質'), h('small', null, '自動：描画時間を測って段階を下げます（判定は常に60tick）')), qual),
      ),
    ),
  );
  return { el, onBack: () => (onBack(), true) };
}
