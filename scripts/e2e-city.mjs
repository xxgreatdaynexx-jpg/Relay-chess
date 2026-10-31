// usage: node scripts/e2e-city.mjs [baseUrl]  (needs playwright). Opens/closes each building and checks the city returns.
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://localhost:5391';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const fails = [];
const cityUp = async (what) => { await p.waitForTimeout(600); const ok = await p.locator('.world').isVisible() && !(await p.getByText('How it works').first().isVisible().catch(() => false)); console.log(ok ? 'ok ' : 'FAIL', what); if (!ok) fails.push(what); };
await p.goto(base + '/'); await p.waitForSelector('.world'); await p.waitForTimeout(2500);
await cityUp('landing');
for (const [tab, close] of [['mines-tab', 'Close mines'], ['arena-tab', 'Close arena'], ['factory-tab', 'Close factory'], ['blackjack-tab', 'Close blackjack'], ['chat-tab', 'Close chat']]) {
  if (!(await p.locator(`[data-testid=${tab}]`).count())) continue;
  await p.click(`[data-testid=${tab}]`); await p.waitForTimeout(1200);
  await p.getByRole('button', { name: close, exact: true }).first().click(); await cityUp(`after ${tab}`);
}
// No quick-button row any more: drive buildings through the 2D map tiles (same go() as a 3D building click).
await p.click('[data-testid=world-mode]'); await p.waitForSelector('[data-testid=world-grid]');
for (const [spot, close] of [['mine', 'Close mines'], ['warehouse', 'Close inventory'], ['factory', 'Close factory']]) {
  await p.click(`[data-testid=world-tile-${spot}]`); await p.waitForTimeout(1200);
  await p.getByRole('button', { name: close, exact: true }).first().click({ timeout: 5000 }).catch(() => fails.push(`close ${spot}`));
  await cityUp(`after building ${spot}`);
}
await p.click('[data-testid=world-tile-chess]'); await p.getByText('How it works').first().waitFor({ timeout: 15000 }).catch(() => {});
const hero = await p.getByText('How it works').first().isVisible(); console.log(hero ? 'ok ' : 'FAIL', 'chess club shows Relay Chess'); if (!hero) fails.push('chess');
await p.screenshot({ path: '/workspace/relay-city-chessclub.png' });
await p.click('[data-testid=world-map-btn]'); await cityUp('back to city from chess');
await p.screenshot({ path: '/workspace/relay-city-home.png' });
await b.close(); process.exit(fails.length ? 1 : 0);
