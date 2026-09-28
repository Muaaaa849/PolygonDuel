// Dev: screenshots of the live move demos in the move sheet (needs the dev server). node tools/movesheet-shot.mjs <outDir> [name,name…]
import { chromium } from 'playwright';
const OUT = process.argv[2];
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto('http://localhost:5173/');
await p.waitForTimeout(1500);
await p.getByText('CPUと戦う').first().click();
await p.waitForTimeout(800);
const only = process.argv[3]?.split(',');
const all = [['リポスト', [900, 1300]], ['シールドバッシュ', [1500, 2200]], ['ブリーズ', [1600]], ['フレアラッシュ', [1000, 1400]],
  ['モード切替', [900, 1500, 2200]], ['スタティックフィールド', [900, 1500]], ['ダッシュスラスト', [700, 1100]], ['ターンバック', [1100, 1700]],
  ['サイコプル', [1200, 2000, 2800]], ['サイコバースト', [1500, 2300]]];
const shots = only ? all.filter(([n]) => only.includes(n)) : all;
let i = 0;
for (const [name, waits] of shots) {
  await p.locator('.skill-tag', { hasText: name }).click();
  let last = 0;
  for (const w of waits) {
    await p.waitForTimeout(w - last);
    last = w;
    await p.screenshot({ path: `${OUT}/${i++}-${name}.png` });
  }
  await p.getByText('閉じる').click();
  await p.waitForTimeout(300);
}
console.log(errs.join('\n') || 'no errors');
await b.close();
