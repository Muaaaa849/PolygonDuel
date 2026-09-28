// Key binding editor (settings → キー設定): every action gets two slots (keyboard key or mouse
// button). Click a slot, then press a key / click a mouse button. Esc cancels, Backspace / Delete
// clears. A code already used by another action of the same set moves here (no double bindings).
// Saved in settings.keys at once; exported / imported with the settings file.
import { KEY_ACTIONS, KEY_ACTION_LABELS, keyLabel, keysFor, type KeyAction, type KeySet } from '../../input/keyboard';
import { settings, saveSettings } from '../settings';
import { backButton, h, toast } from '../ui';
import { sfx } from '../../audio/sfx';
import type { Screen } from '../router';

const SETS: [KeySet, string][] = [
  ['solo', 'ひとりで遊ぶ（CPU・トレモ・オンライン）'],
  ['p1', 'ローカル対戦 1P'],
  ['p2', 'ローカル対戦 2P'],
];

export function keybindScreen(onBack: () => void): Screen {
  let set: KeySet = 'solo';
  let capture: { action: KeyAction; slot: number } | null = null;
  const tabs = h('div', { class: 'segmented' });
  const table = h('div', { class: 'keybind-table' });
  const hint = h('div', { class: 'hint' }, 'クリックしてからキーを押す（マウスのボタンも可）。Esc：やめる　Backspace：消す');

  const save = (map: Record<KeyAction, string[]>) => {
    const keys = { ...(settings.keys ?? {}) };
    keys[set] = map;
    saveSettings({ keys });
  };

  const drawTabs = () => {
    tabs.innerHTML = '';
    for (const [id, label] of SETS) {
      const b = h('button', { class: id === set ? 'on' : '' }, label);
      b.onclick = () => {
        sfx.ui();
        set = id;
        stopCapture();
        drawTabs();
        draw();
      };
      tabs.append(b);
    }
  };

  const draw = () => {
    table.innerHTML = '';
    const map = keysFor(set);
    for (const a of KEY_ACTIONS) {
      const slots = [0, 1].map((k) => {
        const code = map[a][k];
        const active = capture?.action === a && capture.slot === k;
        const b = h('button', { class: `btn small keyslot${active ? ' capturing' : ''}${code ? '' : ' empty'}` }, active ? 'キーを押す…' : code ? keyLabel(code) : '—');
        b.onclick = (e) => {
          e.stopPropagation();
          sfx.ui();
          capture = { action: a, slot: k };
          draw();
          // listen from the next event on (this click's own mousedown is already over)
          setTimeout(startCapture, 0);
        };
        return b;
      });
      table.append(h('span', { class: 'kb-action' }, KEY_ACTION_LABELS[a]), ...slots);
    }
  };

  const assign = (code: string | null) => {
    if (!capture) return;
    const map = keysFor(set);
    const { action, slot } = capture;
    if (code) {
      // the same code elsewhere in this set moves here
      for (const a of KEY_ACTIONS) {
        if (a === action) continue;
        const i = map[a].indexOf(code);
        if (i >= 0) {
          map[a].splice(i, 1);
          toast(`「${KEY_ACTION_LABELS[a]}」から外しました`, 1400);
        }
      }
      const cur = map[action].slice();
      const dup = cur.indexOf(code);
      if (dup >= 0 && dup !== slot) cur.splice(dup, 1);
      cur[slot] = code;
      map[action] = cur.filter(Boolean).slice(0, 2);
    } else {
      map[action] = map[action].filter((_, i) => i !== slot);
    }
    save(map);
    stopCapture();
    draw();
  };

  const onKey = (e: KeyboardEvent) => {
    if (!capture) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      stopCapture();
      draw();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') return assign(null);
    assign(e.code);
  };
  const onMouse = (e: MouseEvent) => {
    if (!capture) return;
    e.preventDefault();
    e.stopPropagation();
    assign(`Mouse${e.button}`);
  };
  const noMenu = (e: Event) => capture && e.preventDefault();
  function startCapture(): void {
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('contextmenu', noMenu, true);
  }
  function stopCapture(): void {
    capture = null;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('mousedown', onMouse, true);
    window.removeEventListener('contextmenu', noMenu, true);
  }

  const reset = h('button', { class: 'btn small' }, 'この組を初期設定に戻す');
  reset.onclick = () => {
    sfx.ui();
    stopCapture();
    const keys = { ...(settings.keys ?? {}) };
    delete keys[set];
    saveSettings({ keys });
    draw();
  };

  drawTabs();
  draw();
  const el = h('div', { class: 'screen' },
    h('div', { class: 'topbar' }, backButton(() => { stopCapture(); onBack(); }), h('h2', null, 'KEYS'), h('span', { class: 'sub' }, 'キー設定')),
    h('div', { class: 'scroll' },
      h('div', { class: 'list', style: 'max-width:640px;margin:8px auto 0' },
        tabs,
        hint,
        table,
        h('div', { style: 'display:flex;gap:8px;justify-content:flex-end' }, reset),
        h('div', { class: 'hint' }, 'ポーズは常に Esc。パッドは 左スティック／十字キー・A／RT＝攻撃・X／LB＝S1・Y／RB＝S2・B＝ステップ・LT＝ガード。'),
      ),
    ),
  );
  return {
    el,
    dispose: () => stopCapture(),
    onBack: () => {
      if (capture) {
        stopCapture();
        draw();
        return true;
      }
      onBack();
      return true;
    },
  };
}
