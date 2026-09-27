// Live move demo for the move sheet: the real simulation + the real battle renderer
// (shapes, swings, baked sprite effects, shockwaves) in a small canvas of its own,
// driven by a script per move, looping. So the preview is exactly what you see in a match.
import { Application } from 'pixi.js';
import { Sim, getChar } from '../../core/sim';
import { u } from '../../core/fixed';
import { IN_ATK, IN_S1, IN_S2, IN_STICK } from '../../core/input';
import { ST_FREE } from '../../core/state';
import { SYSTEM } from '../../data/system';
import { CHARACTERS, charIndex } from '../../data/characters';
import type { CharacterDef, MoveDef } from '../../data/types';
import { BattleView } from '../../render/battle-view';

export type DemoKind = 's1' | 's2' | 'normals';

const LOOP = 170; // frames per loop
const shuffle = (t: number) => IN_STICK | (t % 24 < 12 ? 8 : 24); // moves in place, never guards

interface Script {
  /** Distance between the two fighters at the start (u). */
  dist: number;
  /** Inputs for (attacker, dummy) on frame t. */
  input: (t: number, sim: Sim) => [number, number];
  setup?: (sim: Sim) => void;
}

function scriptFor(c: CharacterDef, kind: DemoKind): Script {
  if (kind === 'normals') {
    return { dist: 1.7, input: (t) => [t >= 20 && t % 5 === 0 && t < 110 ? IN_ATK : 0, shuffle(t)] };
  }
  const slot = kind === 's1' ? 0 : 1;
  const m: MoveDef = c.skills[slot];
  const btn = kind === 's1' ? IN_S1 : IN_S2;
  const press = (t: number) => (t === 20 ? btn | IN_STICK : 0); // stick 0 = toward the dummy (right)
  if (m.counterStance) {
    // the dummy swings into the stance → reversal
    return { dist: 1.9, input: (t) => [t === 22 ? btn : 0, t === 12 ? IN_ATK : 0] };
  }
  if (m.guardBreak) {
    // the dummy is guarding → crush, then a follow-up combo
    return {
      dist: Math.max(1.6, m.reach + m.lunge * 0.7),
      input: (t, sim) => [press(t) || (t > 60 && t % 5 === 0 && sim.s.f[1].st !== ST_FREE ? IN_ATK : 0), 0],
    };
  }
  if (m.heal) {
    return {
      dist: 4,
      setup: (sim) => (sim.s.f[0].hp = Math.round(getChar(sim.s.f[0].char).hp * 0.6)),
      input: (t) => [press(t), 0],
    };
  }
  // circle skills: hit a dummy that isn't guarding (+ chain reset follow-up if the move has one)
  return {
    dist: Math.max(1.6, m.reach + m.lunge * 0.8 - 0.3),
    input: (t, sim) => [press(t) || (m.chainReset && t > 30 && t % 5 === 0 && sim.s.f[0].moveHit ? IN_ATK : 0), shuffle(t)],
  };
}

export class MoveDemo {
  private app = new Application();
  private sim: Sim | null = null;
  private view: BattleView | null = null;
  private t = 0;
  private acc = 0;
  private ready = false;
  private kind: DemoKind = 's1';
  private disposed = false;

  constructor(private c: CharacterDef, private host: HTMLElement) {}

  async start(kind: DemoKind): Promise<void> {
    this.kind = kind;
    const r = this.host.getBoundingClientRect();
    await this.app.init({
      width: Math.max(200, r.width),
      height: Math.max(120, r.height),
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: 'webgl',
    });
    if (this.disposed) {
      this.app.destroy(true, { children: true, texture: false, textureSource: false });
      return;
    }
    this.host.append(this.app.canvas);
    this.ready = true;
    this.reset();
    this.app.ticker.add((tk) => this.tick(tk.deltaMS));
  }

  play(kind: DemoKind): void {
    this.kind = kind;
    if (this.ready) this.reset();
  }

  private reset(): void {
    this.view?.destroy();
    const me = charIndex(this.c.id);
    // a different-looking dummy (another character, or the alt color in a mirror)
    const dummy = charIndex(CHARACTERS[(me + 1) % CHARACTERS.length].id);
    const sim = new Sim(me, dummy, { training: true });
    sim.skipIntro();
    const sc = scriptFor(this.c, this.kind);
    const s = sim.s;
    s.noTimer = 1;
    s.f[0].x = u(SYSTEM.field.w / 2) - Math.round((sc.dist * 1000) / 2);
    s.f[1].x = s.f[0].x + Math.round(sc.dist * 1000);
    s.f[0].y = s.f[1].y = u(SYSTEM.field.h / 2);
    s.f[0].facing = 0;
    s.f[1].facing = 512;
    s.f[0].infCost = 1;
    s.f[1].infGuard = 1;
    sc.setup?.(sim);
    sim.events.length = 0;
    const view = new BattleView(sim, { local: -1, tags: [this.c.name, 'DUMMY'], host: this.app, zoom: 1.7 });
    view.topInset = 0;
    view.setQuality('mid');
    view.mount();
    this.sim = sim;
    this.view = view;
    this.t = 0;
    this.script = sc;
  }

  private script: Script | null = null;

  private tick(ms: number): void {
    if (!this.sim || !this.view || !this.script) return;
    this.acc += Math.min(ms, 100);
    while (this.acc >= 1000 / 60) {
      this.acc -= 1000 / 60;
      const [a, b] = this.script.input(this.t, this.sim);
      this.sim.step(a, b);
      for (const e of this.sim.events) this.view.handle(e);
      this.t++;
      if (this.t >= LOOP) return this.reset();
    }
    this.view.render(ms / (1000 / 60));
  }

  destroy(): void {
    this.disposed = true;
    if (!this.ready) return;
    this.view?.destroy();
    this.app.destroy(true, { children: true, texture: false, textureSource: false });
  }
}
