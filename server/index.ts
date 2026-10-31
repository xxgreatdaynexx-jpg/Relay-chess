import { initBuildAnnounce } from './build.js';
import { getChatLog, initChatStorage } from './chat.js';
import { initArenaStorage } from './arena-store.js';
import { initChessStatsStorage } from './chess-stats.js';
import { createApp } from './app.js';
import { initCheckersLeaderboardStorage, initLeaderboardStorage } from './leaderboard.js';
import { getBank, initCasinoStorage } from './casino-store.js';
import { getVault, initSkinStorage } from './skins.js';
import { initMarketStorage } from './market.js';
import { getMines, initMinesStorage } from './mines.js';
import { getFactory, initFactory } from './factory.js';
import { initAccountStorage } from './accounts.js';
import { getConquest, initConquestStorage } from './conquest.js';
import { getSolitro, initSolitroStorage } from './solitro.js';
import { getRoomPersistence, initRoomStorage } from './room-store.js';

await initLeaderboardStorage();
await initCheckersLeaderboardStorage();
await initCasinoStorage();
await initSkinStorage();
await initMarketStorage();
await initMinesStorage();
initFactory();
await initArenaStorage();
await initChessStatsStorage();
await initAccountStorage();
await initRoomStorage();
await initChatStorage();
await initBuildAnnounce();
await initConquestStorage();
await initSolitroStorage();

const port = Number(process.env.PORT) || 4317;

const { httpServer } = await createApp();
httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Chud Hub listening on http://0.0.0.0:${port}`);
});

/**
 * Render sends SIGTERM on deploy/restart and waits (30 s by default) before SIGKILL.
 * Save every table, stop taking connections, then exit. Clients auto-reconnect to the new instance.
 */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal}: saving tables`);
  const hard = setTimeout(() => process.exit(0), 20_000);
  hard.unref();
  try {
    const p = getRoomPersistence();
    if (p) { p.stop(); await p.flush(); }
    await getChatLog().flush();
    await getSolitro().flush();
    await getConquest().flush();
    await getBank().flush();
    await getVault().flush();
    await getFactory().flush();
    await getMines().flush();
  } catch (error) {
    console.error('[shutdown] save failed:', (error as Error).message);
  }
  httpServer.close();
  console.log('[shutdown] done');
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
