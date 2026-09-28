// Dev: scripted battle screenshots in training mode (needs the dev server).
// node tools/char-shot.mjs <outDir> <charIndex> '[{"eval":"__battle.step(...)"},{"shot":"name"}]'
import { chromium } from 'playwright';
const OUT = process.argv[2];
const CHAR = Number(process.argv[3] ?? 4);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto('http://localhost:5173/');
await p.waitForTimeout(1500);
await p.getByText('トレーニング').first().click();
await p.waitForTimeout(500);
await p.evaluate((i) => document.querySelectorAll('.char-card')[i].click(), CHAR);
await p.waitForTimeout(200);
await p.getByText('決定').first().click();
await p.waitForTimeout(3000);
const ev = (s) => p.evaluate(s);
const shot = async (name) => { await ev(`__battle.view.render(1)`); await p.waitForTimeout(120); await p.screenshot({ path: `${OUT}/${name}.png` }); };
await ev(`(() => { const B = __battle; B.pause(true); B.reset(); window.__t = 0; })()`);
const steps = JSON.parse(process.argv[4]);
for (const s of steps) {
  if (s.eval) await ev(s.eval);
  if (s.shot) await shot(s.shot);
}
console.log(errs.slice(0, 10).join('\n') || 'no errors');
await b.close();
