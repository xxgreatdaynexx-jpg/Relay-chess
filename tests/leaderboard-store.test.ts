import { newDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';
import { Leaderboard } from '../server/leaderboard.js';
import { PgLeaderboardStore, type LeaderboardStore } from '../server/leaderboard-store.js';

function memStore() {
  const { Pool } = newDb({ noAstCoverageCheck: true }).adapters.createPg();
  return new PgLeaderboardStore(new Pool());
}

describe('postgres leaderboard store', () => {
  it('migrates idempotently and upserts with atomic increments', async () => {
    const store = memStore();
    await store.init();
    await store.init();
    await Promise.all([
      store.increment({ key: 'ada', name: 'Ada', wins: 1, losses: 0, draws: 0 }),
      store.increment({ key: 'ada', name: 'ADA', wins: 1, losses: 1, draws: 0 }),
    ]);
    await store.rename('ada', 'Ada L');
    const rows = await store.loadAll();
    expect(rows).toEqual([{ key: 'ada', name: 'Ada L', wins: 2, losses: 1, draws: 0 }]);
  });

  it('persists board results and survives a restart', async () => {
    const store = memStore();
    const first = new Leaderboard(null);
    await first.attachStore(store);
    first.record({ winner: 'white', white: ['Ada', 'Bo'], black: ['Cy'] });
    first.record({ winner: null, white: ['Ada'], black: ['Cy'] });
    await first.flush();
    const second = new Leaderboard(null);
    expect(await second.attachStore(store)).toBe(true);
    const ada = second.standings().find((r) => r.name === 'Ada');
    expect(ada).toMatchObject({ wins: 1, draws: 1, losses: 0 });
    expect(second.standings().find((r) => r.name === 'Cy')).toMatchObject({ losses: 1, draws: 1 });
  });

  it('keeps running when the database is down', async () => {
    const broken: LeaderboardStore = {
      init: async () => { throw new Error('down'); },
      loadAll: async () => { throw new Error('down'); },
      increment: async () => { throw new Error('down'); },
      rename: async () => { throw new Error('down'); },
      close: async () => {},
    };
    const board = new Leaderboard(null);
    expect(await board.attachStore(broken)).toBe(false);
    board.record({ winner: 'black', white: ['A'], black: ['B'] });
    await board.flush();
    await board.refresh();
    expect(board.standings().find((r) => r.name === 'B')?.wins).toBe(1);
  });
});
