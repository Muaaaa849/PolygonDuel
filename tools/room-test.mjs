// E2E: link room. Host creates a room, guest opens the #room= link, both ready up and play.
// Needs the dev server and a PeerJS server; locally: RELAY=ws://127.0.0.1:9000/peerjs?key=peerjs
// (e.g. `node -e "require('peer').PeerServer({port:9000,host:'127.0.0.1',path:'/'})"`).
import { chromium } from 'playwright';
const url = process.env.URL ?? 'http://localhost:5173/';
const OUT = process.env.OUT;
const RELAY = process.env.RELAY;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const mk = async (hash = '') => {
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
  if (RELAY) await ctx.addInitScript((r) => localStorage.setItem('pd.relay', r), RELAY);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  p.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
  await p.goto(url + hash);
  await p.waitForTimeout(800);
  return p;
};
const host = await mk();
await host.getByText('オンライン対戦').first().click();
await host.getByText('リンクで部屋を作る').click();
await host.waitForSelector('.room-code span', { timeout: 15000 });
const code = (await host.locator('.room-code span').allTextContents()).join('');
const link = await host.textContent('.room-url');
console.log('room', code, link);
if (OUT) await host.screenshot({ path: `${OUT}/room-host.png` });
const t0 = Date.now();
const guest = await mk('#room=' + code);
if (OUT) await guest.waitForTimeout(300).then(() => guest.screenshot({ path: `${OUT}/room-guest.png` }));
await host.waitForSelector('text=準備OK', { timeout: 30000 });
await guest.waitForSelector('text=準備OK', { timeout: 30000 });
console.log('connected in', Date.now() - t0, 'ms');
await host.waitForTimeout(1200);
console.log('badge:', await host.textContent('.badge'));
await guest.locator('.char-card').nth(1).click();
await host.getByRole('button', { name: '準備OK' }).click();
await guest.getByRole('button', { name: '準備OK' }).click();
await host.waitForTimeout(4000);
for (let i = 0; i < 12; i++) {
  await host.keyboard.down('KeyD');
  await guest.keyboard.down('KeyA');
  await host.waitForTimeout(120);
  await host.keyboard.press('KeyJ');
  await guest.keyboard.press(i % 3 ? 'KeyJ' : 'Space');
  await host.keyboard.up('KeyD');
  await guest.keyboard.up('KeyA');
  await host.waitForTimeout(150);
}
if (OUT) await host.screenshot({ path: `${OUT}/room-battle.png` });
const stat = async (p) => p.evaluate(() => { const b = window.__battle; const s = b.session(); return { frame: b.sim.s.frame, hp: b.sim.s.f.map((f) => f.hp), desyncs: s.stats.desyncs, compared: s.stats.checksumsCompared }; });
console.log('host', JSON.stringify(await stat(host)));
console.log('guest', JSON.stringify(await stat(guest)));
await b.close();
