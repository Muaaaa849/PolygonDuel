// Dev helper: screenshots of app flows at phone-landscape size.
import { chromium } from 'playwright';
const OUT = process.env.OUT;
const url = process.env.URL ?? 'http://localhost:5173/';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
const steps = JSON.parse(process.env.STEPS ?? '[]');
await p.goto(url);
await p.waitForTimeout(1200);
let i = 0;
for (const s of steps) {
  if (s.click) await p.getByText(s.click, { exact: s.exact ?? false }).first().click();
  if (s.eval) await p.evaluate(s.eval);
  if (s.key) await p.keyboard.down(s.key);
  if (s.keyup) await p.keyboard.up(s.keyup);
  if (s.wait) await p.waitForTimeout(s.wait);
  if (s.shot) await p.screenshot({ path: `${OUT}/${String(i++).padStart(2, '0')}-${s.shot}.png` });
}
console.log(errs.slice(0, 20).join('\n') || 'no errors');
await b.close();
