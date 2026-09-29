// Live move demo for the move sheet: the real simulation + the real battle renderer
// (shapes, swings, baked sprite effects, shockwaves) in a small canvas of its own,
// driven by a script per move, looping. So the preview is exactly what you see in a match.
import { Application } from 'pixi.js';
import { Sim, getChar } from '../../core/sim';
import { u } from '../../core/fixed';
import { IN_ATK, IN_S1, IN_S2, IN_STEP, IN_STICK } from '../../core/input';
import { ST_FREE } from '../../core/state';
import { M_N2, M_N3, M_S1, M_STRIKE } from '../../core/compile';
import { SYSTEM } from '../../data/system';
import { CHARACTERS, charIndex } from '../../data/characters';
import type { CharacterDef, MoveDef } from '../../data/types';
import { BattleView } from '../../render/battle-view';
import { cap60 } from '../../render/pixi-app';

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
  if (m.channel) {
    // ブラッド S1: hold the button — life turns into cost (the gauge fills), then let go
    return {
      dist: 4.5,
      setup: (sim) => {
        sim.s.f[0].infCost = 0;
        sim.s.f[0].cost = 0;
      },
      input: (t) => [t >= 16 && t < 96 ? IN_S1 : 0, shuffle(t)],
    };
  }
  if (m.driveOn) {
    // ブラッド S2: ignite the overdrive, then a buffed 1→2→3 on the dummy, then a HELD ATK (the 30F guard break) into its guard
    return {
      dist: 2.6,
      setup: (sim) => {
        sim.s.f[0].infCost = 0;
        sim.s.f[0].cost = 16;
      },
      input: (t, sim) => {
        const op = sim.s.f[1];
        if (t === 6) return [IN_S2, 0];
        if (t >= 44 && t < 92) return [t % 4 === 0 ? IN_ATK : 0, op.statHitsTaken > 0 && op.st !== ST_FREE ? 0 : shuffle(t)];
        if (t >= 100 && t < 150) return [IN_ATK, 0];
        return [0, 0];
      },
    };
  }
  if (m.mode === 1) {
    // shooting mode: three bullets into a guard at the wall (each one slams it), then back to melee
    return {
      dist: 4.4,
      setup: (sim) => {
        const d = u(SYSTEM.field.w) - u(1.2) - sim.s.f[1].x;
        sim.s.f[0].x += d;
        sim.s.f[1].x += d;
      },
      input: (t) => [t === 16 ? btn : t === 34 || t === 48 || t === 62 ? IN_ATK : t === 120 ? btn : 0, 0],
    };
  }
  if (m.projectile?.pull) {
    // pull the wandering dummy in from afar → 1 → 2 → 3 (pinned down) → burst
    return {
      dist: 5,
      setup: (sim) => (sim.s.f[0].cost = 16),
      input: (t, sim) => {
        const me = sim.s.f[0];
        const op = sim.s.f[1];
        if (t === 16) return [btn | IN_STICK, shuffle(t)];
        const dummy = op.statHitsTaken > 0 ? 0 : shuffle(t);
        if (me.move === M_N3 && me.moveHit) return [t % 2 ? IN_S2 : 0, dummy];
        if (t > 30 && t % 3 === 0 && op.st !== ST_FREE) return [IN_ATK, dummy];
        return [0, dummy];
      },
    };
  }
  if (m.radial) {
    // 1 → 2 → 3 pins the dummy down → the burst throws it away (OTG)
    return {
      dist: 1.5,
      setup: (sim) => (sim.s.f[0].cost = 16),
      input: (t, sim) => {
        const me = sim.s.f[0];
        const dummy = sim.s.f[1].statHitsTaken > 0 ? 0 : shuffle(t);
        if (me.move === M_N3 && me.moveHit) return [t % 2 ? btn : 0, dummy];
        return [t >= 20 && t < 110 && t % 4 === 0 ? IN_ATK : 0, dummy];
      },
    };
  }
  if (m.field) {
    // a field at the dummy's feet; the dummy tries to step out → shocked
    return { dist: 3.6, input: (t) => [t === 16 ? btn : 0, t === 56 ? IN_STEP | IN_STICK | 8 : 0] };
  }
  if (m.dash || m.cancelFrom?.includes('dashThrust')) {
    // step → dash through the guarding dummy (→ turnback crush → combo)
    const turn = !m.dash;
    // (ヴォルト S2: overcharge from neutral first, so the loop shows both uses of the button)
    const oc = turn && !!c.s2Neutral;
    const t0 = oc ? 44 : 20;
    return {
      dist: 3.8,
      setup: oc ? (sim) => (sim.s.f[0].cost = 16) : undefined,
      input: (t, sim) => {
        const me = sim.s.f[0];
        if (oc && t === 4) return [IN_S2, 0];
        if (t === t0) return [IN_STEP | IN_STICK, 0];
        if (t === t0 + 3) return [IN_S1 | IN_STICK, 0];
        if (turn && me.move === M_S1 && me.sf === 12) return [IN_S2, 0];
        if (turn && t > t0 + 50 && t % 5 === 0 && sim.s.f[1].st !== ST_FREE) return [IN_ATK, 0];
        return [0, 0];
      },
    };
  }
  if (m.counterStance) {
    // the dummy swings into the stance → reversal → the strike chains into 2 → 3
    return {
      dist: 1.9,
      input: (t, sim) => {
        const me = sim.s.f[0];
        const follow = (me.move === M_STRIKE || me.move === M_N2) && t % 3 === 0 ? IN_ATK : 0;
        return [t === 22 ? btn : follow, t === 12 ? IN_ATK : 0];
      },
    };
  }
  if (m.guardBreak) {
    // the dummy is guarding → crush, then a follow-up combo
    return {
      dist: Math.max(1.6, m.reach + m.lunge * 0.7),
      input: (t, sim) => [press(t) || (t > 60 && t % 5 === 0 && sim.s.f[1].st !== ST_FREE ? IN_ATK : 0), 0],
    };
  }
  if (m.ghost) {
    // out of range: the decoy steps in while the real one slips sideways, then shows itself
    return { dist: 4.2, input: (t) => [t === 20 ? btn : t > 26 && t < 48 ? IN_STICK | 8 : 0, 0] };
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
    cap60(this.app.ticker);
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
    // an illusion is shown from its owner's side: the decoy translucent, the real one marked
    const ghostDemo = this.kind !== 'normals' && !!this.c.skills[this.kind === 's1' ? 0 : 1].ghost;
    const view = new BattleView(sim, { local: ghostDemo ? 0 : -1, tags: [this.c.name, 'DUMMY'], host: this.app, zoom: 1.7 });
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
