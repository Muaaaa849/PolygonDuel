// Interactive tutorial, ~90 seconds (plan §13): each lesson teaches one shape → one answer.
import type { Sim } from '../../core/sim';
import {
  type SimEvent, EV_BLOCK, EV_CRUSH, EV_HIT, EV_MOVE, EV_JUST,
} from '../../core/events';
import { M_GC, M_N1, M_S2 } from '../../core/compile';
import { IN_ATK, IN_S2, IN_STICK } from '../../core/input';
import { ST_ATTACK, ST_FREE, ST_STEP, PH_FIGHT } from '../../core/state';
import { h, shapeIcon } from '../ui';
import { sfx } from '../../audio/sfx';
import type { TutorialHooks } from './battle';

interface Lesson {
  title: string;
  shape: 'square' | 'hexagon' | 'circle' | 'triangle' | 'star';
  steps: { text: string; sub: string; goal: number }[];
}

const LESSONS: Lesson[] = [
  {
    title: '動く・止まる',
    shape: 'hexagon',
    steps: [
      { text: 'スティックで動いてみよう', sub: '画面の左半分のどこに触れてもスティックになります（PCは WASD）', goal: 50 },
      { text: '指を離すと 六角＝ガード', sub: '止まる＝守る。ガード中は自動で相手を向きます', goal: 45 },
    ],
  },
  {
    title: '円を見たら止まる',
    shape: 'circle',
    steps: [
      { text: '相手が「円」になったら、指を離してガード', sub: '円は攻撃の予兆。矢印が伸びきると棒が出ます', goal: 2 },
      { text: 'ガードした直後に攻撃ボタン → ガード反撃（GC）', sub: 'ガード硬直中に押しておけば最速で出ます', goal: 1 },
    ],
  },
  {
    title: '三角を見たら動く',
    shape: 'triangle',
    steps: [
      { text: '「三角」はガードを壊す技。止まらずに動く／ステップ！', sub: '縁が点滅する三角＝危険。六角のままだと崩されます', goal: 2 },
    ],
  },
  {
    title: '六角には三角',
    shape: 'star',
    steps: [
      { text: 'ガードを固めた相手に S2（三角）', sub: '相手が星つき四角（スタン）になったら…', goal: 1 },
      { text: 'スタン中に 攻撃 を連打してフルコンボ', sub: '星＝フルコンボのチャンス', goal: 3 },
    ],
  },
  {
    title: 'コンボ',
    shape: 'circle',
    steps: [
      { text: '攻撃を連打して 1→2→3', sub: '1段目が当たれば、3段目まで確定で繋がります', goal: 3 },
      { text: '1→2→S1→1→2→3 に挑戦', sub: '2段目の後にS1。フレアラッシュが当たると1段目からやり直せます', goal: 6 },
    ],
  },
];

export function createTutorial(onFinish: () => void): TutorialHooks {
  let lesson = 0;
  let step = 0;
  let count = 0;
  let sim: Sim;
  let api: { banner: (t: string, sub?: string) => void; reset: () => void };
  let t = 0;
  let cooldown = 60;
  let gbPending = false;
  let crushed = false;
  let done = false;
  let comboStart = -1;

  const n = h('div', { class: 'n' });
  const icon = h('div', { style: 'width:30px;height:30px;flex:none' });
  const body = h('div', { class: 'body' });
  const prog = h('div', { class: 'prog' });
  const el = h('div', { class: 'lesson' }, icon, n, body, prog);

  function render(): void {
    const L = LESSONS[lesson];
    const S = L.steps[step];
    n.textContent = `${lesson + 1}/${LESSONS.length}`;
    icon.innerHTML = shapeIcon(L.shape, '#6ff3ff');
    body.innerHTML = '';
    body.append(h('b', null, S.text), h('small', null, S.sub));
    prog.innerHTML = '';
    const goal = S.goal > 10 ? 1 : S.goal;
    const have = S.goal > 10 ? (count >= S.goal ? 1 : 0) : count;
    for (let i = 0; i < goal; i++) prog.append(h('i', { class: i < have ? 'on' : '' }));
  }

  function advance(): void {
    sfx.success();
    el.classList.add('done');
    setTimeout(() => el.classList.remove('done'), 400);
    count = 0;
    step++;
    if (step >= LESSONS[lesson].steps.length) {
      step = 0;
      lesson++;
      if (lesson >= LESSONS.length) {
        done = true;
        api.banner('COMPLETE!', '');
        setTimeout(onFinish, 1400);
        return;
      }
      api.banner(`LESSON ${lesson + 1}`, LESSONS[lesson].title);
      setTimeout(() => api.reset(), 50);
      setup();
    }
    render();
  }

  function progress(k = 1): void {
    if (done) return;
    count += k;
    const goal = LESSONS[lesson].steps[step].goal;
    render();
    if (count >= goal) advance();
    else sfx.confirm();
  }

  function setup(): void {
    const [me, dm] = sim.s.f;
    dm.infGuard = lesson === 0 || lesson === 3 ? 1 : 0;
    dm.infCost = 1;
    me.infCost = lesson >= 3 ? 1 : 0;
    // learning to guard shouldn't end in a gauge break
    me.infGuard = lesson <= 2 ? 1 : 0;
    cooldown = 80;
  }

  const toward = () => {
    const [me, dm] = sim.s.f;
    const a = Math.atan2(me.y - dm.y, me.x - dm.x);
    return (((Math.round((a / (Math.PI * 2)) * 32) % 32) + 32) % 32);
  };
  const dist = () => {
    const [me, dm] = sim.s.f;
    return Math.hypot(me.x - dm.x, me.y - dm.y) / 1000;
  };

  return {
    el,
    attach(s, a) {
      sim = s;
      api = a;
      setup();
      render();
      api.banner('LESSON 1', LESSONS[0].title);
    },
    dummy() {
      if (!sim || sim.s.phase !== PH_FIGHT) return 0;
      const dm = sim.s.f[1];
      t++;
      if (cooldown > 0) cooldown--;
      switch (lesson) {
        case 0:
          return 0;
        case 1: {
          // walk in, then a slow, readable 1st hit
          if (dm.st === ST_ATTACK) return 0;
          if (dist() > 2.3) return IN_STICK | toward();
          if (cooldown === 0 && dm.st === ST_FREE) {
            cooldown = 110;
            return IN_ATK | IN_STICK | toward();
          }
          // stay a square (not guarding) so the GC can land
          return IN_STICK | ((toward() + (Math.floor(t / 12) % 2 ? 8 : 24)) % 32);
        }
        case 2: {
          if (dm.st === ST_ATTACK) return 0;
          if (dist() > 3.6) return IN_STICK | toward();
          if (cooldown === 0 && dm.st === ST_FREE) {
            cooldown = 130;
            return IN_S2 | IN_STICK | toward();
          }
          return 0;
        }
        case 3:
          return 0;
        default:
          return IN_STICK | ((toward() + (Math.floor(t / 25) % 2 ? 8 : 24)) % 32);
      }
    },
    onEvent(e: SimEvent) {
      if (done || !sim) return;
      const f = sim.s.f;
      if (lesson === 1 && step === 0 && e.type === EV_BLOCK && e.who === 1) progress();
      if (lesson === 1 && step === 1 && e.type === EV_HIT && e.who === 0 && f[0].move === M_GC) progress();
      if (lesson === 1 && step === 0 && e.type === EV_HIT && e.who === 1) api.banner('止まってガード！', '円を見たら指を離す');
      if (lesson === 2) {
        if (e.type === EV_MOVE && e.who === 1 && e.a === M_S2) {
          gbPending = true;
          crushed = false;
        }
        if (e.type === EV_CRUSH && e.who === 1) {
          crushed = true;
          api.banner('崩された！', '三角を見たら動く');
        }
        if (e.type === EV_JUST && e.who === 0) api.banner('JUST!', 'ステップで避けると最高');
      }
      if (lesson === 3 && step === 0 && e.type === EV_CRUSH && e.who === 0) progress();
      if (lesson === 3 && step === 1 && e.type === EV_HIT && e.who === 0) {
        // hits after the crush (crush = hit 1 of the combo)
        if ((e.b >> 8) + 1 >= 2) progress();
      }
      if (lesson === 4 && e.type === EV_HIT && e.who === 0) {
        const combo = (e.b >> 8) + 1;
        if (combo === 1) comboStart = t;
        const goal = LESSONS[4].steps[step].goal;
        if (combo >= goal) {
          count = goal - 1;
          progress();
        } else if (combo > count) {
          count = combo;
          render();
        }
      }
      void M_N1;
    },
    onTick() {
      if (done || !sim) return;
      const [me, dm] = sim.s.f;
      if (lesson === 0) {
        if (step === 0 && me.st === ST_FREE && me.guardF === 0) {
          count++;
          if (count % 10 === 0) render();
          if (count >= LESSONS[0].steps[0].goal) advance();
        } else if (step === 1 && me.st === ST_FREE && me.guardF >= 2) {
          count++;
          if (count % 10 === 0) render();
          if (count >= LESSONS[0].steps[1].goal) advance();
        }
      }
      if (lesson === 2 && gbPending && dm.st !== ST_ATTACK) {
        gbPending = false;
        if (!crushed) progress();
      }
      if (lesson === 4 && me.st === ST_STEP) comboStart = -1;
      void comboStart;
    },
  };
}
