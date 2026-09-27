// E2E: two browser contexts connect through the QR/paste flow and play with rollback.
import { chromium } from 'playwright';
const url = process.env.URL ?? 'http://localhost:5173/';
const OUT = process.env.OUT;
const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const mk = async () => {
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, permissions: ['camera'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  p.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
  await p.goto(url);
  await p.waitForTimeout(800);
  return p;
};
const host = await mk();
const guest = await mk();
await host.getByText('オンライン対戦').first().click();
await host.getByText('QRで部屋を作る').click();
await host.waitForSelector('.qr-box[data-code]', { timeout: 15000 });
const offer = await host.getAttribute('.qr-box', 'data-code');
console.log('offer code length', offer.length);
await host.screenshot({ path: `${OUT}/online-host.png` });
await guest.getByText('オンライン対戦').first().click();
await guest.getByText('QRで部屋に入る').click();
await guest.waitForSelector('.pane .code-row input');
await guest.fill('.pane .code-row input', offer);
await guest.getByText('接続', { exact: true }).click();
await guest.waitForSelector('.qr-box[data-code]', { timeout: 15000 });
const answer = await guest.getAttribute('.qr-box', 'data-code');
console.log('answer code length', answer.length);
await guest.screenshot({ path: `${OUT}/online-guest.png` });
await host.fill('.pane .code-row input', answer);
await host.getByText('接続', { exact: true }).click();
await host.waitForSelector('text=準備OK', { timeout: 15000 });
await guest.waitForSelector('text=準備OK', { timeout: 15000 });
await host.waitForTimeout(1500);
await host.screenshot({ path: `${OUT}/online-select.png` });
console.log('badge:', await host.textContent('.badge'));
await guest.locator('.char-card').nth(2).click();
await host.getByRole('button', { name: '準備OK' }).click();
await guest.getByRole('button', { name: '準備OK' }).click();
await host.waitForTimeout(4000);
// play: host walks right and attacks, guest steps around
for (let i = 0; i < 20; i++) {
  await host.keyboard.down('KeyD');
  await guest.keyboard.down('KeyA');
  await host.waitForTimeout(120);
  await host.keyboard.press('KeyJ');
  await guest.keyboard.press(i % 3 ? 'KeyJ' : 'Space');
  await host.keyboard.up('KeyD');
  await guest.keyboard.up('KeyA');
  await host.waitForTimeout(150);
}
await host.screenshot({ path: `${OUT}/online-battle-host.png` });
await guest.screenshot({ path: `${OUT}/online-battle-guest.png` });
const stat = async (p) => p.evaluate(() => { const b = window.__battle; const s = b.session(); return { frame: b.sim.s.frame, hp: b.sim.s.f.map((f) => f.hp), stats: s.stats, confirmed: s.remoteConfirmed }; });
console.log('host', JSON.stringify(await stat(host)));
console.log('guest', JSON.stringify(await stat(guest)));
await b.close();
