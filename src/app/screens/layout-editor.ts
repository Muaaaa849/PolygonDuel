// Touch layout editor (settings → ボタン配置): drag the stick and buttons anywhere,
// resize the selected one, then save. Saved in localStorage with the other settings;
// export / import as a JSON file to carry it to another browser or device.
import { CTRL_IDS, SIZE_MAX, SIZE_MIN, defaultLayout, placePx, type ControlsLayout, type CtrlId } from '../../input/layout';
import { exportSettings, importSettings, saveSettings, settings } from '../settings';
import { h, modal, shapeIcon, toast } from '../ui';
import { sfx } from '../../audio/sfx';
import type { Screen } from '../router';

const LOOK: Record<CtrlId, { label: string; shape: 'circle' | 'hexagon' | 'triangle' | 'arrow' }> = {
  stick: { label: 'スティック', shape: 'hexagon' },
  atk: { label: 'ATTACK', shape: 'circle' },
  s1: { label: 'S1', shape: 'circle' },
  s2: { label: 'S2', shape: 'triangle' },
  step: { label: 'STEP', shape: 'arrow' },
};

export function downloadText(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** File picker + paste box for a settings JSON; calls `done` after a successful import. */
export function openImport(done: () => void): void {
  const file = h('input', { type: 'file', accept: '.json,.txt,application/json,text/plain', style: 'display:none' }) as HTMLInputElement;
  const area = h('textarea', { placeholder: '設定ファイルの中身を貼り付け', rows: '5', spellcheck: 'false' }) as HTMLTextAreaElement;
  const apply = (text: string) => {
    try {
      importSettings(text);
      sfx.success();
      toast('設定を読み込みました');
      m.close();
      done();
    } catch (e) {
      toast((e as Error).message, 3500);
    }
  };
  file.onchange = async () => {
    const f = file.files?.[0];
    if (f) apply(await f.text());
  };
  const m = modal(
    h('div', { class: 'list' },
      h('h3', null, 'IMPORT'),
      h('p', { class: 'prose' }, '書き出した設定ファイル（.json / .txt）を選ぶか、中身を貼り付けてください。'),
      file,
      h('button', { class: 'btn primary', onclick: () => file.click() }, 'ファイルを選ぶ'),
      area,
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => apply(area.value) }, '貼り付けた内容で読み込む'),
        h('button', { class: 'btn', onclick: () => m.close() }, '閉じる'),
      ),
    ),
    { onBackdrop: () => m.close() },
  );
}

export function exportSettingsFile(): void {
  const text = exportSettings();
  downloadText('polygon-duel-settings.json', text);
  navigator.clipboard?.writeText(text).catch(() => undefined);
  toast('設定ファイルを書き出しました（クリップボードにもコピー）');
}

export function layoutEditorScreen(onBack: () => void): Screen {
  const vw = () => window.innerWidth;
  const vh = () => window.innerHeight;
  const k = settings.buttonScale;
  let layout: ControlsLayout = structuredClone(settings.layout ?? defaultLayout(vw(), vh(), settings.lefty, k));
  let isDefault = !settings.layout;
  let sel: CtrlId = 'atk';
  const stage = h('div', { class: 'le-stage' });
  const items = {} as Record<CtrlId, HTMLElement>;
  for (const id of CTRL_IDS) {
    const el = h('div', { class: `le-item le-${id}` },
      h('span', { class: 'ic', html: shapeIcon(LOOK[id].shape, 'rgba(255,255,255,.16)') }),
      h('span', { class: 'lbl' }, LOOK[id].label),
    );
    items[id] = el;
    stage.append(el);
    let drag: { dx: number; dy: number; pid: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      select(id);
      const p = placePx(layout[id], id, vw(), vh(), k);
      drag = { dx: e.clientX - p.cx, dy: e.clientY - p.cy, pid: e.pointerId };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pid) return;
      const { size } = placePx(layout[id], id, vw(), vh(), k);
      const r = size / 2;
      const cx = Math.max(r, Math.min(vw() - r, e.clientX - drag.dx));
      const cy = Math.max(r, Math.min(vh() - r, e.clientY - drag.dy));
      layout[id] = { ...layout[id], x: cx / vw(), y: cy / vh() };
      isDefault = false;
      place(id);
    });
    const end = () => (drag = null);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  const size = h('input', { type: 'range', min: String(SIZE_MIN), max: String(SIZE_MAX), step: '0.05' }) as HTMLInputElement;
  const selName = h('b');
  const sizeVal = h('span', { class: 'le-val' });
  size.oninput = () => {
    layout[sel] = { ...layout[sel], s: parseFloat(size.value) };
    isDefault = false;
    place(sel);
  };

  function place(id: CtrlId): void {
    const { cx, cy, size: d } = placePx(layout[id], id, vw(), vh(), k);
    const st = items[id].style;
    st.left = `${cx - d / 2}px`;
    st.top = `${cy - d / 2}px`;
    st.width = st.height = `${d}px`;
    if (id === sel) sizeVal.textContent = `${Math.round(layout[id].s * 100)}%`;
  }
  function select(id: CtrlId): void {
    sel = id;
    for (const i of CTRL_IDS) items[i].classList.toggle('sel', i === id);
    selName.textContent = LOOK[id].label;
    size.value = String(layout[id].s);
    sizeVal.textContent = `${Math.round(layout[id].s * 100)}%`;
  }
  const placeAll = () => CTRL_IDS.forEach(place);

  const save = () => {
    saveSettings({ layout: isDefault ? null : layout });
    sfx.confirm();
    toast('ボタン配置を保存しました');
    onBack();
  };
  const reset = () => {
    layout = defaultLayout(vw(), vh(), settings.lefty, k);
    isDefault = true;
    placeAll();
    select(sel);
    sfx.ui();
  };

  const bar = h('div', { class: 'le-bar' },
    h('div', { class: 'le-sel' }, selName, h('span', { class: 'le-size' }, '大きさ', size, sizeVal)),
    h('div', { class: 'le-actions' },
      h('button', { class: 'btn small', onclick: reset }, '初期配置'),
      h('button', { class: 'btn small', onclick: () => { saveSettings({ layout: isDefault ? null : layout }); exportSettingsFile(); } }, '書き出し'),
      h('button', { class: 'btn small', onclick: () => openImport(() => { layout = structuredClone(settings.layout ?? defaultLayout(vw(), vh(), settings.lefty, k)); isDefault = !settings.layout; placeAll(); select(sel); }) }, '読み込み'),
      h('button', { class: 'btn small', onclick: () => { sfx.back(); onBack(); } }, 'やめる'),
      h('button', { class: 'btn small primary', onclick: save }, '保存'),
    ),
  );
  const hint = h('div', { class: 'le-hint' }, 'ドラッグで移動・上のスライダーで大きさ。スティックは置いた側の画面半分どこでも使えます。');
  const el = h('div', { class: 'screen layout-edit' }, stage, hint, bar);
  const onResize = () => placeAll();
  window.addEventListener('resize', onResize);
  requestAnimationFrame(() => {
    placeAll();
    select(sel);
  });
  return {
    el,
    dispose: () => window.removeEventListener('resize', onResize),
    onBack: () => (onBack(), true),
  };
}
