// Dev: performance checks in headless Chromium (needs the dev server). CLAUDE.md §12.
//   node tools/perf-bench.mjs fight [seconds=12] [quality=mid|high|low]
//     A busy fight (scripted aggressive bot vs HARD CPU, HP pinned): times every
//     view.render / app.render call, rAF intervals and JS heap growth.
//   node tools/perf-bench.mjs firstuse
//     After the title's warm-up (render/warmup.ts): the frame time of the FIRST use of every
//     battle filter and every effect sheet. Anything well above the rest (> ~5ms here) means
//     a new filter / sheet is not warmed up — the first hit in a fight would hitch.
//   node tools/perf-bench.mjs resize
//     Resizes the window while shockwaves (nested filters) are on screen, like a phone
//     rotating or its browser bar appearing. Must print "no errors" and keep drawing
//     (the Pixi 8.21 workaround in render/pixi-app.ts; CLAUDE.md §12.2-9).
// Chromium renders with swiftshader here, so GPU work lands in another process: the numbers
// are MAIN-THREAD costs (JS + Pixi scene/batch building, shader compiles, texture uploads),
// which is what stalls input, the sim and the netcode on a phone. Compare before / after.
import { chromium } from 'playwright';

const mode = process.argv[2] ?? 'fight';
const url = process.env.URL ?? 'http://localhost:5173/';
const b = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'],
});
const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: Number(process.env.DPR ?? 1), hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto(url);

if (mode === 'resize') {
  await p.waitForTimeout(1500);
  await p.getByText('CPUと戦う').first().click();
  await p.waitForTimeout(400);
  await p.getByText('決定').first().click();
  await p.waitForTimeout(600);
  const start = p.getByText('対戦開始');
  if (await start.count()) await start.first().click();
  await p.waitForTimeout(2500);
  await p.evaluate(() => {
    const host = window.__battle.view.host;
    const r = host.render.bind(host);
    window.__draws = 0;
    host.render = () => {
      window.__draws++;
      r();
    };
  });
  const sizes = [[800, 380], [844, 390], [700, 360], [844, 390]];
  for (const [w, h] of sizes) {
    await p.evaluate(() => {
      const v = window.__battle.view;
      v.wave(500, 400, 1);
      v.wave(700, 300, 1.3);
    });
    await p.waitForTimeout(120);
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(600);
  }
  const d0 = await p.evaluate(() => window.__draws);
  await p.waitForTimeout(1000);
  const d1 = await p.evaluate(() => window.__draws);
  console.log(`draws in the last second after resizing: ${d1 - d0}`);
  if (d1 - d0 <= 0) errs.push('the battle stopped drawing after a resize');
} else if (mode === 'firstuse') {
  await p.waitForTimeout(8000); // the title: warm-up jobs run one per frame
  await p.getByText('トレーニング').first().click();
  await p.waitForTimeout(500);
  await p.getByText('決定').first().click();
  await p.waitForTimeout(3000);
  const r = await p.evaluate(async () => {
    const B = window.__battle;
    B.pause(true);
    const v = B.view;
    const host = v.host;
    const gl = host.renderer.gl;
    const time = (fn) => {
      fn();
      gl.finish();
      const t = performance.now();
      host.render();
      gl.finish();
      return Math.round((performance.now() - t) * 10) / 10;
    };
    const out = { base: time(() => {}) };
    out['filter:shockwave'] = time(() => v.wave(500, 400, 1));
    out['filter:rgbSplit'] = time(() => { v.chroma = 1; v.applyFilters(); });
    out['filter:mono'] = time(() => { v.monoAmt = 1; v.applyFilters(); });
    v.chroma = 0; v.monoAmt = 0; v.waves.length = 0; v.applyFilters();
    const manifest = await (await fetch(new URL('fx/fx.json', document.baseURI))).json();
    for (const n of Object.keys(manifest)) {
      out['sheet:' + n] = time(() => v.fx.spawn(n, { x: 600, y: 450, size: 200 }));
      v.fx.clear();
    }
    return out;
  });
  const worst = Object.entries(r).sort((x, y) => y[1] - x[1]);
  console.log(JSON.stringify(r, null, 1));
  console.log('worst:', worst.slice(0, 5).map(([k, t]) => `${k} ${t}ms`).join(', '));
} else {
  const secs = Number(process.argv[3] ?? 12);
  const quality = process.argv[4] ?? 'mid';
  await p.waitForTimeout(1200);
  await p.getByText('CPUと戦う').first().click();
  await p.waitForTimeout(400);
  await p.getByText('決定').first().click();
  await p.waitForTimeout(600);
  const start = p.getByText('対戦開始');
  if (await start.count()) await start.first().click();
  await p.waitForTimeout(3500);
  await p.evaluate((q) => {
    const B = window.__battle;
    const v = B.view;
    v.setQuality(q);
    B.sim.s.noTimer = 1;
    const st = { view: [], app: [], dt: [], heap0: performance.memory?.usedJSHeapSize ?? 0, last: performance.now(), frames: 0 };
    const vr = v.render.bind(v);
    v.render = (d) => {
      const t = performance.now();
      vr(d);
      st.view.push(performance.now() - t);
    };
    const host = v.host;
    const ar = host.render.bind(host);
    host.render = () => {
      const t = performance.now();
      ar();
      st.app.push(performance.now() - t);
    };
    const loop = (now) => {
      st.dt.push(now - st.last);
      st.last = now;
      st.frames++;
      if (!st.stop) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    window.__perf = st;
    let t = 0;
    B.setBot((sim) => {
      t++;
      for (const f of sim.s.f) f.hp = Math.max(f.hp, 600);
      const me = sim.s.f[0];
      const op = sim.s.f[1];
      const dx = op.x - me.x;
      const dy = op.y - me.y;
      const d = Math.hypot(dx, dy);
      const dir = ((Math.round((Math.atan2(dy, dx) / (Math.PI * 2)) * 32) % 32) + 32) % 32;
      let w = 0;
      if (d > 1900) w |= 32 | dir;
      if (t % 6 === 0 && d < 2600) w |= 64;
      if (t % 97 === 0) w |= 128;
      if (t % 131 === 0) w |= 256;
      if (t % 53 === 0) w |= 512 | 32 | ((dir + 8) % 32);
      return w;
    });
  }, quality);
  await p.waitForTimeout(secs * 1000);
  const r = await p.evaluate(() => {
    const st = window.__perf;
    st.stop = true;
    const q = (a, k) => {
      const s = [...a].sort((x, y) => x - y);
      return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * k))] : 0;
    };
    const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
    const f = (x) => Math.round(x * 100) / 100;
    const heap = (performance.memory?.usedJSHeapSize ?? 0) - st.heap0;
    return {
      frames: st.frames,
      renders: st.view.length,
      viewRender: { avg: f(avg(st.view)), p50: f(q(st.view, 0.5)), p95: f(q(st.view, 0.95)), max: f(q(st.view, 1)) },
      appRender: { avg: f(avg(st.app)), p50: f(q(st.app, 0.5)), p95: f(q(st.app, 0.95)), max: f(q(st.app, 1)) },
      rafInterval: { avg: f(avg(st.dt)), p95: f(q(st.dt, 0.95)) },
      heapDeltaMB: f(heap / 1048576),
    };
  });
  console.log(JSON.stringify(r, null, 1));
}
console.log(errs.join('\n') || 'no errors');
await b.close();
