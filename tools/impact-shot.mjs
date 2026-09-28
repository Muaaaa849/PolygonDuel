// Dev: screenshots of a wall impact and a just dodge → blink JA (needs the dev server). node tools/impact-shot.mjs <outDir>
import { chromium } from 'playwright';
const OUT = process.argv[2];
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto('http://localhost:5173/');
await p.waitForTimeout(1200);
await p.getByText('トレーニング').first().click();
await p.waitForTimeout(500);
await p.getByText('決定').first().click();
await p.waitForTimeout(2500);
const ev = (s) => p.evaluate(s);
// ── wall impact: blaze 1-2-3 into the right edge
await ev(`(() => { const B = __battle; B.pause(true); B.setTime(0); B.reset(); const s = B.sim.s; s.f[1].x = 24750 - 900; s.f[0].x = s.f[1].x - 1600; s.f[0].y = s.f[1].y = 6975; window.__t = 0; })()`);
let shots = 0;
for (let k = 0; k < 200; k++) {
  const r = await ev(`(() => { const B = __battle; const w = B.sim.s.frame; B.step(1, (__t++ % 4 === 0) ? 64 : 0, (__t % 20 < 10) ? (32|8) : (32|24)); return B.sim.events.map(e => e.type); })()`);
  if (r.includes(21)) {
    for (const d of [2, 6, 14]) {
      await ev(`__battle.view.render(${d === 2 ? 2 : 4}); __battle.step(0)`);
      await p.waitForTimeout(80);
      await p.screenshot({ path: `${OUT}/wall-${shots++}.png` });
    }
    break;
  }
}
// ── just dodge → slow → blink JA
await ev(`(() => { const B = __battle; B.reset(); const s = B.sim.s; s.f[0].x = 11300; s.f[1].x = 13500; s.f[0].y = s.f[1].y = 6975; window.__t = 0; })()`);
// dummy (B) attacks toward A; A steps away at frame 20
let justAt = -1;
for (let t = 0; t < 120; t++) {
  const a = t === 20 ? (512 | 32 | 16) : 0; // STEP left
  const bIn = t === 0 ? 64 : 0;
  const r = await ev(`(() => { __battle.step(1, ${a}, ${bIn}); return __battle.sim.events.map(e => e.type); })()`);
  if (r.includes(7)) { justAt = t; break; }
}
console.log('just at', justAt);
for (let k = 0; k < 3; k++) {
  await ev(`__battle.step(4, 0, 0); __battle.view.render(4)`);
  await p.waitForTimeout(150);
  await p.screenshot({ path: `${OUT}/just-${k}.png` });
}
await ev(`__battle.step(1, 64, 0); __battle.view.render(1)`);
await ev(`__battle.step(1, 0, 0); __battle.view.render(2)`);
await p.waitForTimeout(80);
await p.screenshot({ path: `${OUT}/blink-0.png` });
await ev(`__battle.step(8, 0, 0); __battle.view.render(4)`);
await p.waitForTimeout(80);
await p.screenshot({ path: `${OUT}/blink-1.png` });
console.log(errs.join('\n') || 'no errors');
await b.close();
