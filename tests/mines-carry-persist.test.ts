import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { MinesWorld, PgMineStore } from '../server/mines';

const setup = () => { const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); return new Pool(); };
const carry = (w: MinesWorld, id: string, qty: number) => {
  const m = w.miners.get(id)!; m.carried.set('ore:coal', { type: 'ore', id: 'coal', qty });
  (w as unknown as { markCarried(k: string): void }).markCarried('qa-carrier');
};
const total = (w: MinesWorld, id: string) => [...w.carried(id), ...w.backpack(id)].reduce((t, s) => t + s.qty, 0);

describe('mines carried haul survives restarts', () => {
  it('SIGTERM flush writes the debounced carry, and a new server restores it on join', async () => {
    const pool = setup();
    const w = new MinesWorld(); await w.attach(new PgMineStore(pool));
    w.join('a', 'QA-Carrier', 0); carry(w, 'a', 5);
    await w.flush(); // what server/index.ts shutdown() awaits on SIGTERM
    const w2 = new MinesWorld(); await w2.attach(new PgMineStore(pool));
    w2.join('b', 'QA-Carrier', Date.now());
    expect(w2.carried('b')).toEqual([{ type: 'ore', id: 'coal', qty: 5 }]);
  });
  it('extraction banks once: no duplicate after a restart', async () => {
    const pool = setup();
    const w = new MinesWorld(); await w.attach(new PgMineStore(pool));
    const m = w.join('a', 'QA-Carrier', 0); carry(w, 'a', 4); await w.flush();
    m.x = 4; m.y = 7; w.exit('a'); await w.flush();
    const w2 = new MinesWorld(); await w2.attach(new PgMineStore(pool));
    w2.join('b', 'QA-Carrier', Date.now());
    expect(w2.carried('b')).toEqual([]);
    expect(w2.backpack('b')).toEqual([{ type: 'ore', id: 'coal', qty: 4 }]);
    expect(total(w2, 'b')).toBe(4);
  });
  it('exit while a carry save is pending still lands exactly once', async () => {
    const pool = setup();
    const w = new MinesWorld(); await w.attach(new PgMineStore(pool));
    const m = w.join('a', 'QA-Carrier', 0); carry(w, 'a', 3);
    m.x = 4; m.y = 7; w.exit('a'); await w.flush();
    const w2 = new MinesWorld(); await w2.attach(new PgMineStore(pool));
    w2.join('b', 'QA-Carrier', Date.now());
    expect(total(w2, 'b')).toBe(3);
  });
  it('guests stay in memory only', async () => {
    const pool = setup();
    const w = new MinesWorld(); await w.attach(new PgMineStore(pool));
    w.join('g', null, 0); w.miners.get('g')!.carried.set('ore:coal', { type: 'ore', id: 'coal', qty: 2 }); await w.flush();
    expect((await pool.query('SELECT count(*)::int AS n FROM mine_carried')).rows[0].n).toBe(0);
  });
});
