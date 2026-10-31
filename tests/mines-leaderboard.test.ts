import { beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { MinesWorld, PgMineStore } from '../server/mines';
import { MinesLeaderboard } from '../server/mines-board';
import { PgCasinoStore, resetBank, getBank } from '../server/casino-store';
import { periodStart } from '../shared/minesBoard';
import type { Stack } from '../shared/mines';

const setup = () => { const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); return new Pool(); };
/** One trip: join, carry, walk onto the EXIT lift, bank, leave. */
const trip = (w: MinesWorld, id: string, account: string | null, stacks: Stack[]) => {
  const m = w.join(id, account, Date.now());
  for (const s of stacks) m.carried.set(`${s.type}:${s.id}`, { ...s });
  m.x = 4; m.y = 7; const r = w.exit(id); w.leave(id); return r;
};

describe('mining leaderboard (server-side, persisted events only)', () => {
  let pool: ReturnType<typeof setup>; let w: MinesWorld; let board: MinesLeaderboard;
  beforeEach(async () => {
    pool = setup(); resetBank(); await getBank().attach(new PgCasinoStore(pool));
    w = new MinesWorld(); await w.attach(new PgMineStore(pool)); board = new MinesLeaderboard(pool);
  });
  const settle = async () => { await w.flush(); await getBank().flush(); };

  it('ranks chips from house sales, ore banked, and best single haul', async () => {
    trip(w, 'a', 'Digger', [{ type: 'ore', id: 'coal', qty: 10 }]);
    trip(w, 'a2', 'Digger', [{ type: 'ore', id: 'iron', qty: 5 }]); // worth 20: best haul
    trip(w, 'b', 'Rocky', [{ type: 'ore', id: 'coal', qty: 30 }]);
    w.sell('Digger', Date.now()); await settle();
    const b = await board.board('all', Date.now(), true);
    expect(b.chips.map((r) => r.name)).toEqual(['Digger']);
    expect(b.chips[0].chips).toBe(30);
    expect(b.ore.map((r) => [r.name, r.ore])).toEqual([['Rocky', 30], ['Digger', 15]]);
    expect(b.haul.map((r) => [r.name, r.haul])).toEqual([['Rocky', 30], ['Digger', 20]]);
  });

  it('chips come from the wallet ledger, not the in-memory bank; factory spending is not counted', async () => {
    trip(w, 'a', 'Digger', [{ type: 'ore', id: 'iron', qty: 10 }]); w.sell('Digger', Date.now());
    getBank().transfer('Digger', 500, { key: 'gift:1', game: 'mines', memo: 'not a sale' });
    await settle();
    const fresh = new MinesLeaderboard(pool); // a restarted server reads the same numbers
    expect((await fresh.board('all', Date.now(), true)).chips[0]).toMatchObject({ name: 'Digger', chips: 40 });
  });

  it('excludes QA- accounts and guests', async () => {
    trip(w, 'q', 'QA-Tester', [{ type: 'ore', id: 'coal', qty: 50 }]); w.sell('QA-Tester', Date.now());
    trip(w, 'g', null, [{ type: 'ore', id: 'coal', qty: 50 }]);
    trip(w, 'a', 'Digger', [{ type: 'ore', id: 'coal', qty: 2 }]);
    await settle();
    const b = await board.board('all', Date.now(), true);
    for (const list of [b.chips, b.ore, b.haul]) expect(list.some((r) => /^qa-|^guest/i.test(r.name))).toBe(false);
    expect(b.ore.map((r) => r.name)).toEqual(['Digger']);
  });

  it('today / this week / all time windows', async () => {
    const now = Date.UTC(2026, 9, 30, 12); // Friday
    await pool.query(`INSERT INTO mine_banks (player_key, owner_name, ore_qty, worth, at) VALUES
      ('old','Old', 9, 9, $1), ('mon','Mon', 5, 5, $2), ('fri','Fri', 3, 3, $3)`, [Date.UTC(2026, 8, 1), Date.UTC(2026, 9, 26, 1), Date.UTC(2026, 9, 30, 2)]);
    const names = async (p: 'today' | 'week' | 'all') => (await board.board(p, now, true)).ore.map((r) => r.name).sort();
    expect(await names('today')).toEqual(['Fri']);
    expect(await names('week')).toEqual(['Fri', 'Mon']);
    expect(await names('all')).toEqual(['Fri', 'Mon', 'Old']);
    expect(periodStart('week', now)).toBe(Date.UTC(2026, 9, 26));
  });

  it('banking writes the haul row in the same transaction as the banked stacks', async () => {
    trip(w, 'a', 'Digger', [{ type: 'ore', id: 'coal', qty: 4 }]); await settle();
    const r = (await pool.query('SELECT ore_qty, worth FROM mine_banks')).rows;
    expect(r).toEqual([{ ore_qty: 4, worth: 4 }]);
    expect((await pool.query('SELECT qty FROM mine_items')).rows[0].qty).toBe(4);
  });

  it('memory mode returns an empty board', async () => {
    expect(await new MinesLeaderboard(null).board('all')).toEqual({ chips: [], ore: [], haul: [] });
  });
});
