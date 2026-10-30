import { createApp } from './app.js';
import { initLeaderboardStorage } from './leaderboard.js';
import { initCasinoStorage } from './casino-store.js';
import { initAccountStorage } from './accounts.js';

await initLeaderboardStorage();
await initCasinoStorage();
await initAccountStorage();

const port = Number(process.env.PORT) || 4317;

const { httpServer } = await createApp();
httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Chud Hub listening on http://0.0.0.0:${port}`);
});
