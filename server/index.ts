import { initInventoryFence, refreshFenceTriggers, markReady, markMapPools } from './invFence.js'; // FIRST: sets PGAPPNAME before any pool exists
import { initRequests } from './requests.js';
import { initRoyalties } from './royalty.js';
import { initPopupStorage } from './popups.js';
import { initPlayTimeStorage } from './playtime.js';
import { initEconomy } from './economy.js';
import { startWealthTax } from './wealth-tax.js';
import { startNetWorthSnapshots } from './networth-snapshots.js';
import { startSinkRoom } from './sink-room.js';
import { startPlantCap } from './plant-cap.js';
import { getChatLog, initChatStorage } from './chat.js';
import { initArenaStorage } from './arena-store.js';
import { initChessStatsStorage } from './chess-stats.js';
import { createApp } from './app.js';
import { initCheckersLeaderboardStorage, initLeaderboardStorage } from './leaderboard.js';
import { getBank, initCasinoStorage } from './casino-store.js';
import { getVault, initSkinStorage } from './skins.js';
import { initMarketStorage } from './market.js';
import { initStocks } from './stocks.js';
import { initJail, getJail } from './jail.js';
import { initRealEstate } from './realEstate.js';
import { initCars } from './cars.js';
import { initLogistics } from './logistics.js';
import { initLocStore } from './locstock.js';
import { initLocMoves } from './locmoves.js';
import { initMapPools } from './mapPools.js';
import { properties } from '../shared/realEstate.js';
import { initHomes } from './homes.js';
import { initRace } from './race.js';
import { initTravel } from './travel.js';
import { getFortMc, initFortMc } from './fortmc.js';
import { initFleet } from './fleet.js';
import { initVanity } from './vanity.js';
import { initPatronage } from './patronage.js';
import { getEstate, initEstate } from './estateProjects.js';
import { initAuction } from './artAuction.js';
import { initFarm } from './farm.js';
import { initWarehouse } from './warehouse.js';
import { initCoop } from './coop.js';
import { initRaids } from './mineRaids.js';
import { initSupply } from './supplyContracts.js';
import { initWeekly } from './weeklyEvent.js';
import { initLinks } from './linked.js';
import { initMineTools } from './mineTools.js';
import { initMineBackpack } from './mineBackpack.js';
import { initMineGear } from './mineGear.js';
import { initFishGear } from './fishGear.js';
import { initEmployment } from './employment.js';
import { initLootMatch } from './lootMatch.js';
import { initMayor } from './mayor.js';
import { initCity } from './city.js';
import { databaseUrl as cityDbUrl } from './leaderboard-store.js';
import { initFishing } from './fishing.js';
import { initCigarettes } from './cigarettes.js';
import { initFishPan } from './fishPan.js';
import { initCooking } from './cooking.js';
import { getMines, initMinesStorage } from './mines.js';
import { getFactory, initFactory } from './factory.js';
import { bootCarbonTax } from './carbon-tax.js';
import { initAccountStorage } from './accounts.js';
import { getConquest, initConquestStorage } from './conquest.js';
import { getSolitro, initSolitroStorage } from './solitro.js';
import { getRoomPersistence, initRoomStorage } from './room-store.js';

await initLeaderboardStorage();
await initCheckersLeaderboardStorage();
await initCasinoStorage();
await initInventoryFence(); // truck logistics cutover: newest server is the only inventory writer (throws = fail closed, no boot)
await markMapPools(); // irreversible boundary FIRST: from here no pre-map-pool server may hold inventory writes
await initMapPools(cityDbUrl(), properties().filter((p) => p.map === 'resort').map((p) => p.id)); // pre-Millionaire restore: one inventory per owner per map (one transaction, idempotent)
await initSkinStorage();
await initMarketStorage();
await initMinesStorage();
initFactory();
await initArenaStorage();
await initChessStatsStorage();
await initAccountStorage();
await initRoomStorage();
await initChatStorage();
await initRequests();
await initPopupStorage();
await initPlayTimeStorage();
await initEconomy();
await initJail();
setInterval(() => getJail().sweep(), 30_000).unref();
setInterval(() => {
  const e = getEstate(); const f = getFortMc(); if (!e) return;
  for (const name of e.knownPlayers()) {
    void e.tick(name, f ? (owner, qty) => f.creditStock(owner, 'crude', qty) : undefined).catch((err) => console.error('[estate] tick', (err as Error).message));
  }
}, 60_000).unref();
await initStocks();
await initRealEstate();
initRoyalties();
await initCars();
await initLocStore();
await initLogistics();
await initHomes();
await initRace();
await initTravel();
await initFortMc();
await initFleet();
await initVanity();
await initPatronage();
await initEstate();
await initAuction();
await initFarm();
await initWarehouse();
await initCoop();
initRaids();
await initLinks();
await initSupply();
await initWeekly();
await initMineTools();
await initMineBackpack();
await initMineGear();
await initFishGear();
await initEmployment();
await initLootMatch();
await initMayor();
await initCity(cityDbUrl());
await bootCarbonTax();
await initFishing();
await initCigarettes();
initFishPan();
startWealthTax();
startNetWorthSnapshots();
startSinkRoom();
startPlantCap();
await initCooking();
await initLocMoves({ dbUrl: cityDbUrl() }); // truck logistics: wires producers + freight, then moves legacy stock to each owner's factory BEFORE serving (idempotent)
await refreshFenceTriggers();
await initConquestStorage();
await initSolitroStorage();

const port = Number(process.env.PORT) || 4317;

const { httpServer } = await createApp();
markReady(); // inventory boot done: from here a failure no longer hands the fence back (see server/invFence.ts)
httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Chud Hub listening on http://0.0.0.0:${port}`);
});

/**
 * Render sends SIGTERM on deploy/restart and waits (30 s by default) before SIGKILL.
 * Save every table, stop taking connections, then exit. Clients auto-reconnect to the new instance.
 */
let shuttingDown = false;
const SHUTDOWN_STEP_MS = 5_000;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal}: saving tables`);
  const hard = setTimeout(() => process.exit(0), 20_000);
  hard.unref();
  // Backpacks first (fast, most valuable), then every other table. Each step has its own timeout so one stuck store cannot block the rest.
  getMines().closing = true;
  const step = async (label: string, f: () => Promise<unknown> | undefined) => {
    let t: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([Promise.resolve().then(f), new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timed out')), SHUTDOWN_STEP_MS); })]); }
    catch (error) { console.error(`[shutdown] ${label} save failed:`, (error as Error).message); }
    finally { if (t) clearTimeout(t); }
  };
  await step('mines', () => getMines().flush());
  await step('rooms', async () => { const p = getRoomPersistence(); if (p) { p.stop(); await p.flush(); } });
  await step('chat', () => getChatLog().flush());
  await step('solitro', () => getSolitro().flush());
  await step('conquest', () => getConquest().flush());
  await step('bank', () => getBank().flush());
  await step('vault', () => getVault().flush());
  await step('factory', () => getFactory().flush());
  await step('mines (after factory)', () => getMines().flush());
  httpServer.close();
  console.log('[shutdown] done');
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
