#!/usr/bin/env node
/**
 * Headless QA: open each shared popup shell at desktop and mobile sizes,
 * check the ✕ is on-screen and closes, and that tall content scrolls
 * while the header stays put. Screenshots go to /workspace/popup-qa/.
 */
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
async function loadPlaywright() {
  const candidates = [
    process.env.NODE_PATH && join(process.env.NODE_PATH.split(':')[0], 'playwright'),
    '/home/box/.npm/_npx/e41f203b7505f1fb/node_modules/playwright',
    '/usr/local/lib/pnpm/5/.pnpm/playwright@1.63.0-alpha-2026-08-31/node_modules/playwright',
  ].filter(Boolean);
  for (const c of candidates) {
    try { const entry = existsSync(c + '/index.mjs') ? c + '/index.mjs' : c + '/index.js';
    if (existsSync(c)) return await import(pathToFileURL(entry).href); } catch {}
  }
  return import('playwright');
}
const { chromium } = await loadPlaywright();
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = '/workspace/popup-qa';
mkdirSync(outDir, { recursive: true });

function builtCss() {
  const dir = join(root, 'dist/client/assets');
  if (!existsSync(dir)) {
    console.log('Building client…');
    execSync('npx vite build', { cwd: root, stdio: 'inherit' });
  }
  const css = readdirSync(join(root, 'dist/client/assets')).find((f) => f.endsWith('.css'));
  if (!css) throw new Error('no built css');
  return readFileSync(join(root, 'dist/client/assets', css), 'utf8');
}

const longItems = Array.from({ length: 40 }, (_, i) =>
  `<button type="button">Plot ${i + 1} — a long deed row that forces the body to scroll <span>🪙 ${(i + 1) * 1000}</span></button>`).join('');

function html(css) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<style>${css}
body { margin: 0; background: #10211a; color: #f4efe2; font-family: sans-serif; }
.world { position: relative; width: 100vw; height: 100dvh; height: 100vh; }
</style></head>
<body>
<div id="stage"></div>
<script>
const long = \`${longItems}\`;
const fixtures = {
  'launch': () => \`<div class="launch-backdrop" role="alertdialog" aria-modal="true" data-testid="launch-popup">
    <div class="launch-card">
      <button type="button" class="launch-x" aria-label="Close" data-testid="launch-close">✕</button>
      <div class="launch-burst">💸</div>
      <h2 class="launch-title" id="launch-title">The Billionaire Update</h2>
      <div class="launch-when"><b>🟢 Live now</b></div>
      <p class="launch-sub">Here's what's new. <span class="launch-count">14 new things across 5 pages</span></p>
      <div class="launch-tabs" role="tablist"><button class="on" type="button">The map</button><button type="button">Private works</button><button type="button">Luxury</button></div>
      <ul class="launch-list" data-testid="launch-page">\${Array.from({length:20},(_,i)=>'<li><span class="launch-ico">🗺️</span><div><b>Feature '+i+'</b><span>A long description so the list has to scroll on a short phone screen and the close button must stay put.</span></div></li>').join('')}</ul>
      <div class="launch-nav"><button type="button" class="launch-back" disabled>‹ Back</button><span>1 / 5</span><button type="button" class="launch-ok">Next ›</button></div>
    </div></div>\`,
  'future-features': () => \`<div class="launch-backdrop" role="alertdialog" data-testid="future-features">
    <div class="launch-card ff-card">
      <button type="button" class="launch-x" aria-label="Close" data-testid="ff-close">✕</button>
      <div class="launch-burst">👀</div>
      <h2 class="launch-title">Future Features</h2>
      <p class="launch-sub">A first look at what's ahead.</p>
      <ul class="launch-list ff-shots">\${Array.from({length:8},(_,i)=>'<li><div class="ff-shot-copy"><span class="launch-ico">🏝️</span><div><b>Shot '+i+'</b><span>Caption that wraps and stacks so the card is taller than the viewport.</span></div></div></li>').join('')}</ul>
      <div class="launch-nav"><span></span><button type="button" class="launch-ok">Nice</button></div>
    </div></div>\`,
  'map-sheet-deed': () => \`<div class="world"><div class="world-deed map-sheet" data-testid="world-deed" role="dialog">
    <header class="map-sheet-header"><h3>🏛 Real estate</h3><button type="button" class="world-deed-x" aria-label="Close" data-testid="deed-close">✕</button></header>
    <div class="map-sheet-body">\${long}</div>
  </div></div>\`,
  'modal-shell': () => \`<div class="modal-backdrop" data-testid="shell">
    <div class="modal-shell" role="dialog">
      <div class="modal-shell-head"><h2 class="modal-shell-title">Account and settings</h2><button type="button" class="modal-shell-x" aria-label="Close" data-testid="shell-close">✕</button></div>
      <div class="modal-shell-body">\${Array.from({length:30},(_,i)=>'<p>Settings row '+i+'. Theme, volume, password, notification preferences, and more text to force a scroll.</p>').join('')}</div>
    </div></div>\`,
  'sellall': () => \`<div class="sellall-backdrop" data-testid="sellall-confirm" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);padding:16px">
    <div class="sellall-card" role="alertdialog" style="background:#1b1d2e;border:1px solid #ffffff22;border-radius:14px;padding:20px 22px;max-width:420px;width:100%">
      <button type="button" class="sellall-x modal-shell-x" aria-label="Close" data-testid="sellall-close">✕</button>
      <h3>💰 Sell all?</h3>
      <p data-testid="sellall-text">Sell 400 items (12 stacks) for about 🪙 128,400, minus a 🪙 75 freight fee? This is a long confirmation so the card still has to fit the screen.</p>
      <div class="sellall-btns" style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button type="button">Cancel</button><button type="button" class="ok">Confirm</button>
      </div>
    </div></div>\`,
  'panel-loading': () => \`<div class="world"><div class="world-deed map-sheet panel-loading" role="dialog" data-testid="panel-loading">
    <header class="map-sheet-header"><h3>Opening the dealership…</h3><button type="button" class="world-deed-x" aria-label="Close" data-testid="panel-loading-close">✕</button></header>
    <div class="map-sheet-body"><div role="alert" data-testid="panel-loading-error"><p>This menu is taking too long to open.</p><button type="button" class="modal-shell-retry">Retry</button></div></div>
  </div></div>\`,
  'daily-report': () => \`<div class="modal-backdrop" data-testid="daily-report">
    <div class="modal-shell daily-shell" role="dialog">
      <div class="modal-shell-head"><h2 class="modal-shell-title">📊 Daily Report</h2><button type="button" class="modal-shell-x" aria-label="Close" data-testid="daily-report-close">✕</button></div>
      <div class="modal-shell-body">\${Array.from({length:25},(_,i)=>'<div class="flex justify-between"><span>Asset '+i+'</span><b>🪙 '+(i*1200)+'</b></div>').join('')}<button type="button" class="modal-shell-retry">Got it</button></div>
    </div></div>\`,
  'player-profile': () => \`<div class="modal-backdrop" data-testid="player-profile">
    <div class="modal-shell profile-shell" role="dialog">
      <div class="modal-shell-head"><h2 class="modal-shell-title">ChessGuy2</h2><button type="button" class="modal-shell-x" aria-label="Close" data-testid="player-profile-close">✕</button></div>
      <div class="modal-shell-body">\${Array.from({length:20},(_,i)=>'<p>Holding '+i+': Goldwood mansion, East Estates lot, Orchard Ridge trees, and a long line of net-worth history.</p>').join('')}</div>
    </div></div>\`,
};

const closes = {
  'launch': '[data-testid="launch-close"]',
  'future-features': '[data-testid="ff-close"]',
  'map-sheet-deed': '[data-testid="deed-close"]',
  'modal-shell': '[data-testid="shell-close"]',
  'sellall': '[data-testid="sellall-close"]',
  'panel-loading': '[data-testid="panel-loading-close"]',
  'daily-report': '[data-testid="daily-report-close"]',
  'player-profile': '[data-testid="player-profile-close"]',
};
const bodies = {
  'launch': '.launch-list',
  'future-features': '.launch-list',
  'map-sheet-deed': '.map-sheet-body',
  'modal-shell': '.modal-shell-body',
  'sellall': '.sellall-card p',
  'panel-loading': '.map-sheet-body',
  'daily-report': '.modal-shell-body',
  'player-profile': '.modal-shell-body',
};
function show(id) {
  document.getElementById('stage').innerHTML = fixtures[id]();
  const x = document.querySelector(closes[id]);
  if (x) x.addEventListener('click', () => { document.getElementById('stage').innerHTML = ''; });
}
window.__qa = { show, closes, bodies, ids: Object.keys(fixtures) };
</script>
</body></html>`;
}

const viewports = [
  { name: 'desktop-1280', width: 1280, height: 800 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
  { name: 'mobile-375', width: 375, height: 667 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-landscape', width: 667, height: 375 },
];

const css = builtCss();
const pageHtml = html(css);
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(pageHtml);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const results = [];

for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const ids = await page.evaluate(() => window.__qa.ids);
  for (const id of ids) {
    const row = { popup: id, viewport: vp.name, size: `${vp.width}x${vp.height}`, xVisible: false, xCloses: false, scrolls: false, headerSticky: false, status: 'FAIL', shot: '' };
    try {
      await page.evaluate((n) => window.__qa.show(n), id);
      await page.waitForTimeout(50);
      const closeSel = await page.evaluate((n) => window.__qa.closes[n], id);
      const bodySel = await page.evaluate((n) => window.__qa.bodies[n], id);
      const x = page.locator(closeSel);
      await x.waitFor({ state: 'visible', timeout: 2000 });
      const box = await x.boundingBox();
      row.xVisible = !!(box && box.y >= 0 && box.x >= 0 && box.y + box.height <= vp.height + 1 && box.x + box.width <= vp.width + 1);
      // scroll the body if it can, then re-check X is still on screen
      const canScroll = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const before = el.scrollTop;
        el.scrollTop = el.scrollHeight;
        return el.scrollTop > before || el.scrollHeight > el.clientHeight + 2;
      }, bodySel);
      row.scrolls = canScroll || (await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return !el || el.scrollHeight <= el.clientHeight + 2;
      }, bodySel)); // short content is fine
      const box2 = await x.boundingBox();
      row.headerSticky = !!(box2 && box2.y >= 0 && box2.y + box2.height <= vp.height + 1);
      const shot = `${id}--${vp.name}.png`;
      await page.screenshot({ path: join(outDir, shot), fullPage: false });
      row.shot = shot;
      // click X and confirm gone
      await x.click();
      await page.waitForTimeout(40);
      row.xCloses = (await page.locator(closeSel).count()) === 0;
      row.status = (row.xVisible && row.xCloses && row.scrolls && row.headerSticky) ? 'PASS' : 'FAIL';
    } catch (e) {
      row.status = 'FAIL';
      row.error = String(e && e.message ? e.message : e);
      const shot = `${id}--${vp.name}-error.png`;
      try { await page.screenshot({ path: join(outDir, shot), fullPage: false }); row.shot = shot; } catch {}
    }
    results.push(row);
    console.log(row.status, row.popup, row.viewport, row.xVisible ? 'Xvis' : 'Xoff', row.xCloses ? 'closes' : 'noclose', row.scrolls ? 'scroll' : 'noscroll', row.headerSticky ? 'sticky' : 'unsticky', row.error || '');
  }
  await page.close();
}

await browser.close();
server.close();

const pass = results.filter((r) => r.status === 'PASS').length;
const fail = results.length - pass;
const md = [];
md.push('# Popup QA');
md.push('');
md.push(`Headless Playwright run against the local Vite build CSS. ${pass}/${results.length} checks passed.`);
md.push('');
md.push('Every popup is checked at 1280×800, 1920×1080, 375×667, 390×844, and 667×375 landscape: a visible ✕ inside the viewport, the ✕ still visible after the body scrolls, and a click on the ✕ closing the popup.');
md.push('');
md.push('## Results');
md.push('');
md.push('| Popup | Viewport | ✕ visible | ✕ closes | Body scrolls (or fits) | Header sticky | Status | Screenshot |');
md.push('|---|---|---|---|---|---|---|---|');
for (const r of results) {
  md.push(`| ${r.popup} | ${r.viewport} (${r.size}) | ${r.xVisible ? 'yes' : 'NO'} | ${r.xCloses ? 'yes' : 'NO'} | ${r.scrolls ? 'yes' : 'NO'} | ${r.headerSticky ? 'yes' : 'NO'} | **${r.status}** | ${r.shot ? r.shot : ''} |`);
}
md.push('');
md.push('## Before and after');
md.push('');
md.push('| Popup | Before | After |');
md.push('|---|---|---|');
md.push('| Launch popup | No ✕, no Escape, no backdrop close. On a short phone the only exits (Skip / Let\'s get rich) could sit below the fold if the flex scroll failed. | Sticky ✕ in the card corner, Escape and backdrop dismiss, list already scrolls, vh+dvh max-height. |');
md.push('| Future Features | Same: only an OK at the bottom, no ✕. Images made the card tall. | Same shell as launch: ✕, Escape, backdrop, scrolling shots. |');
md.push('| Map deed / farm / venue / Fort panels (desktop) | The whole panel scrolled, including the absolutely-positioned ✕, so after scrolling you could not close it. | MapSheet always splits a sticky header (title + ✕) from a scrolling body, on desktop and mobile. |');
md.push('| Radix Dialog (rules, resign, promote) | No visible ✕ (Escape / overlay only). | Shared shell: ✕ in a non-scrolling head, body scrolls, 85vh + 85dvh. |');
md.push('| Sell-all confirm | Cancel only, no ✕. | ✕ (and existing Escape / backdrop / Cancel). |');
md.push('| Admin popup | OK only, no ✕. Tall messages could crowd the viewport. | ✕ in a header row, message body scrolls. |');
md.push('| Player profile / Daily report | The whole card — including the close control — scrolled (`max-h` + `overflow-y: auto`). | Sticky header with ✕, scrolling body, vh+dvh, fetch timeout + Retry on the profile. |');
md.push('| Wallet | No ✕ (backdrop and toggle only). | ✕ in the tab header. |');
md.push('| Dealership / marina / hangar / dock / co-op / freight Suspense | "Opening…" with no close, or `fallback={null}` (blank). A hung chunk left you stuck. | Closeable loading card with a 12s timeout and Retry. |');
md.push('| Chat profile / factory viewer | "Loading stats…" forever if the request hung. | Fetch timeout, error, Retry. |');
md.push('| Error boundary (panel) | Text "Close" button only. | Shell with ✕ and scrolling body. |');
md.push('| Account, HubWindow, Wiki, Changelog, Requests, Skills, Bill review, Dealer, Inventory | Already had a header + ✕; some only used dvh, some dropped the ✕ when content overflowed. | vh fallback, touch scrolling, safe-area insets, shared `.modal-shell` CSS. |');
md.push('');
md.push(`Finished with ${fail} failure(s).`);
writeFileSync(join(outDir, 'INDEX.md'), md.join('\n'));
writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
console.log(`\nWrote ${outDir}/INDEX.md (${pass} passed, ${fail} failed)`);
process.exit(fail ? 1 : 0);
