import { initInventoryFence, refreshFenceTriggers, markReady, invHealth, fenceToken, markMapPools } from '../../server/invFence'; // FIRST, as server/index.ts
/** One "server instance" for tests/locmoves-postgres.test.ts: boots the real stores on DATABASE_URL (a disposable local DB),
 *  runs one step, prints a JSON result line. Each step is a fresh process, so state across steps proves restart safety. */
import pg from 'pg';
import { initCasinoStorage, getBank } from '../../server/casino-store';
import { initMinesStorage, getMines } from '../../server/mines';
import { initLocStore, getLocStore } from '../../server/locstock';
import { Logistics, setLogistics, getLogistics } from '../../server/logistics';
import { initWarehouse } from '../../server/warehouse';
import { initFishing } from '../../server/fishing';
import { initCooking } from '../../server/cooking';
import { getLocMoves, initLocMoves } from '../../server/locmoves';
import { initSkinStorage } from '../../server/skins';
import { initMarketStorage, getMarket } from '../../server/market';
import { initRealEstate } from '../../server/realEstate';
import { initFarm, getFarm } from '../../server/farm';
import { initMapPools } from '../../server/mapPools';
import { properties } from '../../shared/realEstate';

const step = process.argv[2]!; const arg = JSON.parse(process.argv[3] ?? '{}') as Record<string, unknown>;
const off = Number(process.env.LM_CLOCK_OFFSET ?? 0); const clock = () => Date.now() + off;
const out = (o: unknown) => { process.stdout.write(`RESULT ${JSON.stringify(o)}\n`); };
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

async function boot() {
  // LM_SCHEMA_ONLY (test-only): stand in for the OLD server creating its tables (no fence, no fold, nothing served)
  const schemaOnly = !!process.env.LM_SCHEMA_ONLY;
  await initCasinoStorage();
  if (schemaOnly) {
    await initSkinStorage(); await initMarketStorage(); await initMinesStorage(); for (let i = 0; i < 100 && (getMines().offline || !getMines().store); i++) await settle(100);
    await initRealEstate(); await initLocStore(); const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 }); await new Logistics(pool as never, clock).init();
    await initFarm(); for (let i = 0; i < 100 && !getFarm(); i++) await settle(100); await initWarehouse(); await initFishing(); await initCooking(); return;
  }
  await initInventoryFence();
  if (process.env.NODE_ENV === 'test' && process.env.LM_TEST_FAIL === 'preboundary') throw new Error('test: boot failed before the map-pool boundary');
  // production boot order (server/index.ts): boundary, then the fold, BEFORE any inventory store loads
  await markMapPools(); await initMapPools(process.env.DATABASE_URL, properties().filter((p) => p.map === 'resort').map((p) => p.id));
  await initSkinStorage(); await initMarketStorage(); await initMinesStorage();
  for (let i = 0; i < 100 && (getMines().offline || !getMines().store); i++) await settle(100);
  await initRealEstate(); await initLocStore();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const l = new Logistics(pool as never, clock); await l.init(); setLogistics(l);
  await initFarm(); for (let i = 0; i < 100 && !getFarm(); i++) await settle(100);
  await initWarehouse(); await initFishing(); await initCooking(); await initLocMoves({ dbUrl: process.env.DATABASE_URL }); await refreshFenceTriggers(); markReady();
}
const snap = async (names: string[]) => {
  const m = getMines(); const ls = getLocStore(); const r: Record<string, unknown> = {};
  for (const n of names) r[n] = { chips: getBank().account(n).chips, factory: m.stacks(n).map((s) => [`${s.type}:${s.id}`, s.qty]), locs: [...ls.locs(n)].map(([loc, it]) => [loc, it.map((x) => [x.item, x.qty])]) };
  return r;
};
const tryIt = async (f: () => Promise<unknown>) => { try { return { ok: true, r: await f() }; } catch (e) { return { ok: false, error: (e as Error).message }; } };

try { await boot(); } catch (e) { if (step === 'failBoot') throw e; /* real path: the fatal handler decides the fence */ out({ bootError: (e as Error).message }); await settle(100); process.exit(0); }
const lm = getLocMoves(); const lg = getLogistics()!;
if (step === 'boot') out({ ok: true });
else if (step === 'migrate') { out(lm.lastMigration); } // what THIS boot's migration (run before serving) did
else if (step === 'remigrate') { out(await lm.migrateLegacy()); }
else if (step === 'fund') { for (const n of arg.names as string[]) getBank().transferConfirmed(n, Number(arg.amt), { key: `t_fund:${n}:${Date.now()}`, game: 'admin' }); await settle(800); out(await snap(arg.names as string[])); }
else if (step === 'stack') { for (const [n, t, id, q] of arg.items as Array<[string, string, string, number]>) getMines().adjustStack(n, t as 'ore', id, q); await settle(800); out({ ok: true }); }
else if (step === 'buyTruck') { out(await tryIt(() => lg.buyTruck(String(arg.name), arg.truck))); await settle(800); }
else if (step === 'move') { const res = await Promise.all((arg.moves as Array<Record<string, unknown>>).map((m) => tryIt(() => lm.move(String(m.name), m)))); await settle(800); out({ res, snap: await snap(arg.names as string[]) }); }
else if (step === 'sell') { out(await tryIt(() => lm.sell(String(arg.name), arg))); await settle(800); }
else if (step === 'quote') { out(await tryIt(() => lm.quote(String(arg.name), arg))); }
else if (step === 'tick') { lg.tick(); await settle(2500); lg.tick(); await settle(1500); out({ transit: [...lg.ships.values()].filter((s) => s.kind === 'loc').length, snap: await snap(arg.names as string[]) }); }
else if (step === 'snap') out(await snap(arg.names as string[]));
else if (step === 'harvest') out(await tryIt(() => getFarm()!.harvest(String(arg.name), String(arg.plot))));
else if (step === 'cancelListing') { out(await tryIt(async () => getMarket().cancelStack(String(arg.name), arg.id))); await getMines().flush(); await settle(500); }
else if (step === 'offlineTick') { const m = getMines(); m.offline = true; lg.tick(); await settle(2500); lg.tick(); await settle(1000); out({ moving: [...lg.ships.values()].filter((s) => s.kind === 'loc').length }); }
else if (step === 'health') out({ ...invHealth(), token: fenceToken() });
else if (step === 'holdWrite') { // an instance that loses the fence to a newer boot, then tries to write factory stock
  out({ before: invHealth() }); await settle(Number(arg.waitMs));
  const m = getMines(); let err: string | null = null; m.adjustStack(String(arg.name), 'ore', 'gold', 7, [], undefined, { onFail: (e) => { err = e.message; } });
  try { await m.flush(); } catch (e) { err = (e as Error).message; } await settle(1500);
  out({ after: invHealth(), err });
}
else if (step === 'view') out(await lm.view(String(arg.name)));
await settle(300); process.exit(0);
