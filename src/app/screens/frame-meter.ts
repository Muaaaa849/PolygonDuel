// Training frame meter (plan §13): both fighters' startup / active / recovery /
// stun per frame as color bands — the same colors as the plan's timing charts.
import type { Sim } from '../../core/sim';
import type { BattleView } from '../../render/battle-view';
import type { SimEvent } from '../../core/events';
import {
  ST_FREE, ST_ATTACK, ST_BLOCKSTUN, ST_HITSTUN, ST_STEP, ST_DOWN, ST_WAKE, ST_STUN, type FighterState,
} from '../../core/state';
import { h } from '../ui';

const LEN = 100;
const COLORS: Record<string, string> = {
  free: '#1b2338',
  guard: '#2f5fb8',
  startup: '#3fcf8e',
  active: '#ff4d5e',
  recovery: '#4a7dff',
  hitstun: '#ffc048',
  blockstun: '#c9a4ff',
  step: '#58e0f0',
  down: '#6b7390',
  stun: '#ffe070',
};

export class FrameMeter {
  el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private rows: string[][] = [[], []];
  visible = true;

  constructor(private sim: Sim, _view: BattleView) {
    this.canvas = h('canvas', { width: String(LEN * 6), height: '40' }) as HTMLCanvasElement;
    const legend = h('div', { style: 'display:flex;gap:8px;font-size:9px;color:var(--muted);justify-content:center;margin-top:3px' },
      ...['startup', 'active', 'recovery', 'hitstun', 'blockstun', 'guard', 'step'].map((k) =>
        h('span', null, h('i', { style: `display:inline-block;width:8px;height:8px;background:${COLORS[k]};margin-right:3px;border-radius:2px` }),
          ({ startup: '予兆', active: '判定', recovery: '硬直', hitstun: '被弾', blockstun: 'ガード硬直', guard: 'ガード', step: 'ステップ' } as Record<string, string>)[k])),
    );
    this.el = h('div', {
      style: 'position:absolute;left:50%;bottom:calc(8px + var(--safe-b));transform:translateX(-50%);pointer-events:none;background:rgba(5,8,15,.7);padding:5px 6px;border-radius:8px;border:1px solid var(--line);z-index:1',
    }, this.canvas, legend);
    this.canvas.style.width = 'min(52vw, 520px)';
    this.canvas.style.height = '30px';
    this.canvas.style.display = 'block';
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? '' : 'none';
  }

  onEvent(_e: SimEvent): void {}

  private cat(f: FighterState): string {
    switch (f.st) {
      case ST_FREE:
        return f.guardF >= 1 ? 'guard' : 'free';
      case ST_ATTACK: {
        const m = this.sim.moveOf(f)!;
        if (!m.hasHitbox) return f.sf < (m.cs?.from ?? m.S) ? 'startup' : 'recovery';
        return f.sf < m.S ? 'startup' : f.sf < m.S + m.A ? 'active' : 'recovery';
      }
      case ST_BLOCKSTUN:
        return 'blockstun';
      case ST_HITSTUN:
        return 'hitstun';
      case ST_STEP:
        return 'step';
      case ST_DOWN:
      case ST_WAKE:
        return 'down';
      case ST_STUN:
        return 'stun';
      default:
        return 'free';
    }
  }

  /** Call once per sim tick (skips hitstop frames, like the plan's charts). */
  record(): void {
    const s = this.sim.s;
    if (!this.sim.advanced) return;
    for (let i = 0; i < 2; i++) {
      this.rows[i].push(this.cat(s.f[i]));
      if (this.rows[i].length > LEN) this.rows[i].shift();
    }
  }

  draw(): void {
    if (!this.visible) return;
    const ctx = this.canvas.getContext('2d')!;
    const W = 6;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (let i = 0; i < 2; i++) {
      const row = this.rows[i];
      for (let k = 0; k < row.length; k++) {
        ctx.fillStyle = COLORS[row[k]];
        ctx.fillRect(k * W, i * 20 + 2, W - 1, 16);
      }
    }
  }
}
