// E2E: two browser contexts connect through the QR/paste flow and play with rollback.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url = process.env.URL ?? 'http://localhost:5173/';
const OUT = process.env.OUT ?? '/tmp';
const TOUCH = process.env.TOUCH === '1';
const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const mk = async () => {
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, hasTouch: TOUCH, permissions: ['camera'] });
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
const fightPhase = await host.evaluate(async () => (await import('/src/core/state.ts')).PH_FIGHT);
for (const p of [host, guest]) await p.waitForFunction(phase => window.__battle?.sim.s.phase === phase, fightPhase, { timeout: 30000 });
// Stop the peer long enough to stall the host, tap and RELEASE during the stall,
// then resume. The real keyboard / battle loop must keep this one-shot input.
const stallsBefore = await host.evaluate(() => window.__battle.session().stats.stalls);
await guest.evaluate(() => window.__battle.pause(true));
await host.waitForFunction(before => window.__battle.session().stats.stalls > before, stallsBefore);
const moveType = await host.evaluate(async () => (await import('/src/core/events.ts')).EV_MOVE);
await host.evaluate((type) => {
  window.__stallMoves = 0;
  const session = window.__battle.session();
  const original = session.onEvents;
  session.onEvents = (events, resim) => {
    window.__stallMoves += events.filter(e => e.type === type && e.who === 0).length;
    original?.(events, resim);
  };
}, moveType);
if (TOUCH) {
  // Controls intentionally hit-test at the parent layer, using the button's coordinates.
  const box = await host.locator('.cbtn.atk').boundingBox();
  assert.ok(box);
  await host.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
} else await host.keyboard.press('KeyJ');
await host.waitForTimeout(100);
assert.equal(await host.evaluate(() => window.__stallMoves), 0);
await guest.evaluate(() => window.__battle.pause(false));
await host.waitForFunction(() => window.__stallMoves > 0, undefined, { timeout: 5000 });
console.log(`released ${TOUCH ? 'touch' : 'keyboard'} tap during network stall: preserved`);
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
const hs = await stat(host), gs = await stat(guest);
console.log('host', JSON.stringify(hs));
console.log('guest', JSON.stringify(gs));
assert.equal(hs.stats.desyncs + gs.stats.desyncs, 0);
assert.ok(hs.stats.checksumsCompared + gs.stats.checksumsCompared > 0);
await b.close();
