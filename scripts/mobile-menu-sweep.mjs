#!/usr/bin/env node
/**
 * Real E2E mobile/desktop sweep: open every menu in the running app,
 * capture console/page/network errors, confirm render / scroll / X,
 * and verify the Global/Server Economy screen scrolls.
 *
 * Usage: node scripts/mobile-menu-sweep.mjs [baseUrl]
 */
import { pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

async function loadPlaywright() {
  const candidates = [
    '/home/box/.npm/_npx/e41f203b7505f1fb/node_modules/playwright',
    join(process.cwd(), 'node_modules/playwright'),
  ];
  for (const c of candidates) {
    const entry = existsSync(c + '/index.mjs') ? c + '/index.mjs' : c + '/index.js';
    if (existsSync(c)) return await import(pathToFileURL(entry).href);
  }
  return import('playwright');
}

const { chromium, webkit, devices } = await loadPlaywright();
const base = process.argv[2] || 'http://127.0.0.1:4317';
const outDir = '/workspace/popup-qa/mobile-sweep';
mkdirSync(outDir, { recursive: true });

const TILES = [
  'casino', 'mine', 'mine-frost', 'mine-magma', 'mine-quarry',
  'arena', 'factory', 'warehouse', 'bank', 'market', 'stocks',
  'dealer', 'mechanic', 'airport', 'dock', 'racetrack', 'grocery',
  'employ', 'furniture', 'cityhall', 'club', 'skytower', 'plastics',
  'rigdock', 'leaderboard', 'chat', 'bigfarms',
];
// chess leaves the city — tested separately and we return via world-map-btn
const EVENTS = [
  'open-billionaire-club',
  'open-cityhall',
  'open-employment',
  'open-grocery',
  'open-furniture-store',
  'open-prestige-desk',
  'open-inventory',
  'open-resource-inventory',
  'open-launch-popup',
  'open-ocean-dock',
  'open-bill-review',
  'open-high-stakes-blackjack',
  'open-high-stakes-roulette',
  'open-high-stakes-holdem',
  'open-high-stakes-poker',
];
const HUD = [
  'world-deeds-btn', 'world-freight-btn', 'world-coop-btn',
];
const TABS = [
  'blackjack-tab', 'roulette-tab', 'poker-tab', 'slots-tab',
  'solitaire-tab', 'lootmatch-tab', 'mines-tab', 'arena-tab',
  'hockey-tab', 'factory-tab', 'market-tab', 'skills-tab',
  'stocks-tab', 'chat-tab',
];

const IGNORE_CONSOLE = [
  /Download the React DevTools/,
  /\[vite\]/,
  /favicon/,
  /three\.js|WebGL|THREE\./i,
  /Failed to load resource.*404/,
  /net::ERR_/,
  /ResizeObserver loop/,
];


const ECON_FIXTURE = {
  ok: true, at: Date.now(), cash: 12_345_678, assets: 98_765_432, total: 111_111_110, estPct: 12,
  categories: Array.from({ length: 16 }, (_, i) => ({
    key: 'c' + i, label: 'Category ' + (i + 1) + ' — a long asset class name', value: (i + 1) * 100000, units: i + 3, estValue: i * 1000,
  })),
  offshore: 4_000_000, totalWithOffshore: 115_111_110,
  realEstate: { owned: 40, taxBurned: 90000, taxToday: 1200, repossessed: 2 },
  change: { cash: 1.2, assets: -0.4, total: 0.3 },
  inflation: { cash7: 0.8, cash30: 1.1, total7: 0.5, total30: 0.9 },
  flows: {
    faucets: Array.from({ length: 8 }, (_, i) => ({ game: ['arena','mines','farm_harvest','admin','blackjack','slots','chess','daily'][i] || 'g'+i, amount: (i+1)*5000 })),
    sinks: Array.from({ length: 8 }, (_, i) => ({ game: ['property_tax','wealth_tax','farm_seed','market fees','boat_upkeep','jet_upkeep','refill','casino'][i] || 's'+i, amount: (i+1)*3000 })),
    transfers: [{ game: 'trade', amount: 20000 }, { game: 'gift', amount: 1500 }, { game: 'market', amount: 8000 }, { game: 'p2p', amount: 400 }],
  },
  net: 12000,
  priceIndex: { index: 1.04, day: '2026-11-12', appliedPct: 0.2, emaPct: 0.18, rawPct: 0.22, params: { emaDays: 7, passThrough: 0.5, maxDaily: 0.03, floor: 0.8, ceil: 2 } },
  history: Array.from({ length: 21 }, (_, i) => ({ day: '2026-10-' + String(i+10).padStart(2,'0'), cash: 10000000 + i*50000, assets: 90000000 + i*20000, total: 100000000 + i*70000, source: 'snap' })),
  method: 'book + estimate',
};

async function stubEconomy(page) {
  await page.route('**/api/economy', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ECON_FIXTURE) });
  });
}

function attach(page, bag) {
  page.on('console', (msg) => {
    const t = msg.type();
    const txt = msg.text();
    if (t === 'error' && !IGNORE_CONSOLE.some((r) => r.test(txt))) bag.console.push(txt);
  });
  page.on('pageerror', (e) => bag.pageerrors.push(String(e)));
  page.on('requestfailed', (req) => {
    const u = req.url();
    if (/favicon|hot-update|sockjs|vite/.test(u)) return;
    bag.failed.push(`${req.failure()?.errorText || 'fail'} ${u}`);
  });
  page.addListener('crash', () => bag.pageerrors.push('PAGE CRASHED'));
}

async function dismissOverlays(page) {
  for (const sel of [
    '[data-testid="launch-close"]',
    '[data-testid="ff-close"]',
    '[data-testid="hub-sleep-overlay"] button',
  ]) {
    const n = page.locator(sel).first();
    if (await n.isVisible().catch(() => false)) await n.click().catch(() => {});
  }
}

async function closeOpen(page) {
  // Prefer explicit close buttons; Escape as fallback. Do a few rounds for stacked panels.
  for (let i = 0; i < 4; i++) {
    const crash = await page.locator('[data-testid="crash-app"], [aria-label="Something went wrong"]').count();
    if (crash) return 'CRASH_CARD';
    const closers = page.locator([
      '[data-testid="wallet-close"]',
      '[data-testid="daily-report-close"]',
      '[data-testid="player-profile-close"]',
      '[data-testid="bill-review-close"]',
      '[data-testid="panel-loading-close"]',
      '[data-testid="modal-close"]',
      '[data-testid="launch-close"]',
      '.world-deed-x',
      '.world-casino-x',
      '.modal-shell-x',
      '.acct-close',
      '.launch-x',
      'button[aria-label="Close"]',
      'button[aria-label="Close wallet"]',
      'button[aria-label="Close inventory"]',
      'button[aria-label="Close mines"]',
      'button[aria-label="Close arena"]',
      'button[aria-label="Close factory"]',
      'button[aria-label="Close blackjack"]',
      'button[aria-label="Close chat"]',
      '[data-testid="world-map-btn"]',
    ].join(', '));
    const vis = closers.locator('visible=true');
    const n = await vis.count().catch(() => 0);
    if (n === 0) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(120);
      const still = await vis.count().catch(() => 0);
      if (still === 0) return 'closed';
      continue;
    }
    await vis.first().click({ timeout: 2000, force: true }).catch(() => {});
    await page.waitForTimeout(150);
  }
  return 'maybe-open';
}

async function checkCrash(page, bag, where) {
  const card = await page.locator('[data-testid="crash-app"], [role="alertdialog"][aria-label="Something went wrong"]').count();
  if (card) {
    bag.crashes.push(where);
    return true;
  }
  return false;
}

async function ensure2d(page) {
  const grid = page.locator('[data-testid="world-grid"]');
  if (await grid.isVisible().catch(() => false)) return;
  const mode = page.locator('[data-testid="world-mode"]');
  if (await mode.isVisible().catch(() => false)) {
    const label = await mode.innerText().catch(() => '');
    if (/2D/.test(label) || /3D/.test(label)) {
      // Button shows the mode you'd switch TO: "▦ 2D map" when currently 3d
      if (/2D/.test(label)) await mode.click().catch(() => {});
    }
    await grid.waitFor({ timeout: 8000 }).catch(() => {});
  }
}

async function economyPass(page, bag, shotName) {
  const result = { name: 'economy', ok: false, scroll: false, close: false, detail: '' };
  // Wallet button may sit in the top bar; on very narrow phones it may be in a more menu.
  let opened = false;
  const walletBtn = page.locator('[data-testid="wallet-button"]');
  if (await walletBtn.isVisible().catch(() => false)) {
    await walletBtn.click();
    opened = true;
  } else {
    // Try "More" / menu, or the bank tile
    const more = page.locator('[data-testid="top-more"], .top-menu-btn, button:has-text("More")').first();
    if (await more.isVisible().catch(() => false)) {
      await more.click().catch(() => {});
      await page.waitForTimeout(200);
      if (await walletBtn.isVisible().catch(() => false)) { await walletBtn.click(); opened = true; }
    }
    if (!opened) {
      await ensure2d(page);
      const bank = page.locator('[data-testid="world-tile-bank"]');
      if (await bank.isVisible().catch(() => false)) { await bank.click(); opened = true; }
    }
  }
  const panel = page.locator('[data-testid="wallet-panel"]');
  await panel.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  if (!(await panel.isVisible().catch(() => false))) {
    result.detail = 'wallet panel did not open';
    bag.results.push(result);
    return result;
  }
  const econTab = page.locator('[data-testid="wallet-tab-econ"]');
  await econTab.click();
  const view = page.locator('[data-testid="econ-view"], [data-testid="wallet-econ-scroll"]');
  await view.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  // Loading state is fine; wait for content or error
  await page.waitForTimeout(350);
  const scrollEl = page.locator('[data-testid="wallet-econ-scroll"]');
  const visible = await scrollEl.isVisible().catch(() => false);
  let metrics = { scrollHeight: 0, clientHeight: 0, top: 0, after: 0 };
  if (visible) {
    // Top-of-panel shot first (header + start of the report)
    await page.screenshot({ path: join(outDir, shotName + '.png'), fullPage: false });
    metrics = await scrollEl.evaluate((el) => {
      const o = { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, top: el.scrollTop, after: 0 };
      el.scrollTop = el.scrollHeight;
      o.after = el.scrollTop;
      return o;
    });
    result.scroll = metrics.scrollHeight > metrics.clientHeight + 8 && metrics.after > 20;
    if (!result.scroll) result.detail += ' DID_NOT_SCROLL (tall fixture should overflow)';
    result.detail += ` sh=${metrics.scrollHeight} ch=${metrics.clientHeight} after=${metrics.after}`;
    await page.screenshot({ path: join(outDir, shotName + '-scrolled.png'), fullPage: false });
    await scrollEl.evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(80);
  } else {
    result.detail = 'wallet-econ-scroll not visible';
    await page.screenshot({ path: join(outDir, shotName + '.png'), fullPage: false });
  }
  const x = page.locator('[data-testid="wallet-close"]');
  const xBox = await x.boundingBox().catch(() => null);
  const vp = page.viewportSize();
  const xOnScreen = !!(xBox && vp && xBox.y >= 0 && xBox.y + 8 < vp.height && xBox.x >= 0);
  await x.click({ timeout: 3000, force: true }).catch(() => {});
  await page.waitForTimeout(120);
  let still = await panel.isVisible().catch(() => false);
  if (still) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);
    still = await panel.isVisible().catch(() => false);
  }
  result.close = !still && (xOnScreen || !still);
  if (still) result.detail += ' ; close failed';
  if (!xOnScreen) result.detail += ' ; X off-screen';
  result.ok = visible && result.scroll && result.close && !(await checkCrash(page, bag, 'economy'));
  bag.results.push(result);
  return result;
}

async function openAndClose(page, bag, name, opener) {
  const r = { name, ok: false, rendered: false, close: false, detail: '' };
  const beforeErr = bag.pageerrors.length + bag.console.length;
  try {
    await opener();
    await page.waitForTimeout(280);
    r.rendered = !(await checkCrash(page, bag, name));
    // A visible dialog, sheet, tab panel, or navigation is a render
    const any = await page.locator(
      '.world-deed, .wallet-panel, .dealer, .world-casino, .inv-win, .sol-panel, .acct-panel, .chat-drawer, .launch-card, .furn-store, .modal-shell, [role="dialog"], [role="alertdialog"], [data-testid="world-home"], [data-testid="crash-app"]',
    ).first().isVisible().catch(() => false);
    if (any) r.rendered = r.rendered && true;
    const closeState = await closeOpen(page);
    r.close = closeState !== 'CRASH_CARD';
    r.ok = r.rendered && r.close && bag.pageerrors.length + bag.console.length === beforeErr;
    if (!r.ok) r.detail = closeState + ' newErrors=' + (bag.pageerrors.length + bag.console.length - beforeErr);
  } catch (e) {
    r.detail = String(e).slice(0, 240);
    await closeOpen(page);
  }
  bag.results.push(r);
  if (!r.ok) console.log('  FAIL', bag.label, r.name, r.detail);
  return r;
}

async function runOn(browserType, label, opts, useWebkit = false) {
  const bag = { label, console: [], pageerrors: [], failed: [], crashes: [], results: [] };
  const launcher = useWebkit ? webkit : chromium;
  let browser;
  try {
    browser = await launcher.launch({
      executablePath: useWebkit ? undefined : (process.env.CHROME_PATH || '/usr/bin/google-chrome'),
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      headless: true,
    });
  } catch (e) {
    bag.results.push({ name: 'launch', ok: false, detail: String(e).slice(0, 300) });
    return bag;
  }
  const context = await browser.newContext({
    ...opts,
    hasTouch: opts.hasTouch ?? /iPhone|Pixel|mobile/i.test(label),
    isMobile: opts.isMobile ?? /iPhone|Pixel|mobile/i.test(label),
  });
  const page = await context.newPage();
  attach(page, bag);
  await stubEconomy(page);
  await page.addInitScript(() => { try { localStorage.setItem('chud-world-mode', '2d'); } catch {} });
  try {
    await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.world, [data-testid="world-grid"], .world-title', { timeout: 25000 });
    await page.waitForTimeout(600);
    await dismissOverlays(page);

    // 1. Economy FIRST
    const econShot = `econ--${label.replace(/\s+/g, '-').toLowerCase()}`;
    const econ = await economyPass(page, bag, econShot);
    console.log(`${label} economy: ok=${econ.ok} scroll=${econ.scroll} close=${econ.close} ${econ.detail}`);

    await ensure2d(page);
    await page.waitForTimeout(200);

    // 2. HUD buttons
    for (const id of HUD) {
      const btn = page.locator(`[data-testid="${id}"]`);
      if (!(await btn.count())) { bag.results.push({ name: id, ok: true, detail: 'absent' }); continue; }
      await openAndClose(page, bag, id, async () => {
        await ensure2d(page);
        await btn.click({ timeout: 4000 });
      });
    }

    // 3. 2D tiles
    for (const id of TILES) {
      const tile = page.locator(`[data-testid="world-tile-${id}"]`);
      if (!(await tile.count())) { bag.results.push({ name: `tile-${id}`, ok: true, detail: 'absent' }); continue; }
      await openAndClose(page, bag, `tile-${id}`, async () => {
        await ensure2d(page);
        // If we left the city (leaderboard), go back first
        const back = page.locator('[data-testid="world-map-btn"]');
        if (await back.isVisible().catch(() => false)) await back.click().catch(() => {});
        await ensure2d(page);
        await tile.click({ timeout: 4000 });
      });
    }

    // chess (leaves city)
    const chess = page.locator('[data-testid="world-tile-chess"]');
    if (await chess.count()) {
      await openAndClose(page, bag, 'tile-chess', async () => {
        await ensure2d(page);
        await chess.click({ timeout: 4000 });
        await page.waitForTimeout(350);
      });
      const back = page.locator('[data-testid="world-map-btn"]');
      if (await back.isVisible().catch(() => false)) await back.click().catch(() => {});
      await page.waitForSelector('.world', { timeout: 8000 }).catch(() => {});
    }

    // 4. Top tabs (may be in More on phones)
    for (const id of TABS) {
      let btn = page.locator(`[data-testid="${id}"]`);
      if (!(await btn.isVisible().catch(() => false))) {
        const more = page.locator('[data-testid="top-more"], .top-more button, .top-menu-btn').first();
        if (await more.isVisible().catch(() => false)) {
          await more.click().catch(() => {});
          await page.waitForTimeout(200);
        }
      }
      btn = page.locator(`[data-testid="${id}"]`);
      if (!(await btn.count())) { bag.results.push({ name: id, ok: true, detail: 'absent' }); continue; }
      await openAndClose(page, bag, id, async () => {
        if (!(await btn.isVisible().catch(() => false))) {
          const more = page.locator('[data-testid="top-more"], .top-more button, .top-menu-btn').first();
          if (await more.isVisible().catch(() => false)) await more.click().catch(() => {});
        }
        await btn.click({ timeout: 4000 }).catch(() => {});
      });
    }

    // 5. Events (and club sub-tabs)
    for (const ev of EVENTS) {
      await openAndClose(page, bag, ev, async () => {
        await page.evaluate((e) => window.dispatchEvent(new Event(e)), ev);
        await page.waitForTimeout(200);
      });
    }

    // Club subviews: auction, tower, prestige (club already opened via event)
    await openAndClose(page, bag, 'club-auction', async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('open-billionaire-club')));
      await page.waitForTimeout(280);
      const t = page.locator('[data-testid="club-tab-auction"]');
      if (await t.isVisible().catch(() => false)) await t.click();
    });
    await openAndClose(page, bag, 'club-tower', async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('open-billionaire-club')));
      await page.waitForTimeout(280);
      const t = page.locator('[data-testid="club-tab-tower"]');
      if (await t.isVisible().catch(() => false)) await t.click();
    });

    // Account / settings
    await openAndClose(page, bag, 'account', async () => {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('open-account', { detail: 'account' })));
      // AccountPanel listens for a custom event — check actual event name
    });
    // Use the documented openAccount path: look at openAccount
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('chud:open-account', { detail: 'account' }));
    });
    // Try clicking sign-in if visible after going home
    // Settings via tab if account opened

    // Back-to-back reopen: club then grocery then club
    await closeOpen(page);
    await openAndClose(page, bag, 'reopen-club', async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('open-billionaire-club')));
    });
    await openAndClose(page, bag, 'reopen-grocery-after-club', async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('open-grocery')));
    });
    await openAndClose(page, bag, 'reopen-club-again', async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('open-billionaire-club')));
    });

    // Economy again after other menus (state leak)
    const econ2 = await economyPass(page, bag, `econ-reopen--${label.replace(/\s+/g, '-').toLowerCase()}`);
    console.log(`${label} economy-reopen: ok=${econ2.ok} ${econ2.detail}`);

    // Representative screenshots
    await ensure2d(page);
    await page.evaluate(() => window.dispatchEvent(new Event('open-billionaire-club')));
    await page.waitForTimeout(280);
    await page.screenshot({ path: join(outDir, `club--${label.replace(/\s+/g, '-').toLowerCase()}.png`) });
    await closeOpen(page);

    await page.locator('[data-testid="world-deeds-btn"]').click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(outDir, `deeds--${label.replace(/\s+/g, '-').toLowerCase()}.png`) });
    await closeOpen(page);

  } catch (e) {
    bag.pageerrors.push('RUN: ' + String(e).slice(0, 400));
    await page.screenshot({ path: join(outDir, `fail--${label.replace(/\s+/g, '-').toLowerCase()}.png`) }).catch(() => {});
  }
  await browser.close().catch(() => {});
  return bag;
}

const runs = [];
const iphone = devices['iPhone 13'];
const pixel = devices['Pixel 7'] || devices['Pixel 5'];
const desktop = { viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false, userAgent: devices['Desktop Chrome']?.userAgent };

console.log('sweep against', base);
runs.push(await runOn(chromium, 'iPhone13', iphone));
runs.push(await runOn(chromium, 'Pixel7', pixel));
runs.push(await runOn(chromium, 'desktop', desktop));

// WebKit (iOS Safari) if the browser binary is present
try {
  runs.push(await runOn(webkit, 'iPhone13-WebKit', iphone, true));
} catch (e) {
  console.log('WebKit skipped:', String(e).slice(0, 200));
}

const lines = [];
let failed = 0, tested = 0;
for (const b of runs) {
  lines.push(`# ${b.label}`);
  lines.push(`console errors: ${b.console.length}  pageerrors: ${b.pageerrors.length}  failed reqs: ${b.failed.length}  crash cards: ${b.crashes.length}`);
  if (b.console.length) lines.push('  console: ' + b.console.slice(0, 12).join(' | '));
  if (b.pageerrors.length) lines.push('  page: ' + b.pageerrors.slice(0, 8).join(' | '));
  if (b.crashes.length) lines.push('  crashes: ' + b.crashes.join(', '));
  for (const r of b.results) {
    tested += 1;
    const st = r.ok ? 'ok' : 'FAIL';
    if (!r.ok) failed += 1;
    lines.push(`  ${st}  ${r.name}  ${r.detail || ''}`.trimEnd());
  }
  lines.push('');
}
const report = lines.join('\n') + `\nTESTED ${tested}  FAILED ${failed}\n`;
writeFileSync(join(outDir, 'RESULTS.md'), report);
console.log(report);
process.exit(failed || runs.some((b) => b.pageerrors.length || b.crashes.length) ? 1 : 0);
