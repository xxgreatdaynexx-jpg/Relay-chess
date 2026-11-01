import { beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { attachWithRetry, PgMineStore, resetMines, type MineStore, type MinesWorld } from '../server/mines';
import { resetFactory, type FactoryWorld } from '../server/factory';
import { getBank, resetBank } from '../server/casino-store';

const rich = (n: string, chips: number) => getBank().transfer(n, chips - getBank().account(n).chips, { game: 'test' });
/** A store whose connect times out (Neon cold start), like the prod boots on Nov 1. */
const dead = (): MineStore => ({ init: async () => { throw new Error('Connection terminated due to connection timeout'); }, load: async () => ({ items: [], daily: [] }), save: async () => {} });

let w: MinesWorld; let f: FactoryWorld;
beforeEach(() => { resetBank(); w = resetMines(); f = resetFactory(); });

describe('factories survive a boot where postgres is unreachable', () => {
  it('reproduces the wipe: an offline boot must not show "no factory", rebuild it, or overwrite the saved row', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const A = 'QA-Wipe'; rich(A, 5000);
    await w.attach(new PgMineStore(pool));
    f.expand(A, 0); f.place(A, [{ k: 'belt', x: 3, y: 3, d: 1 }], 1000);
    w.packOf(A).set('bar:iron_bar', { type: 'bar', id: 'iron_bar', qty: 7 });
    await f.flush(); await w.flush(); await w.savePack(A, []);
    const chips = getBank().account(A).chips;

    // Next deploy: first connects time out.
    const w2 = resetMines(); const f2 = resetFactory();
    expect(await attachWithRetry(w2, dead, () => {}, { tries: 2, delayMs: 1, retryMs: 60_000 })).toBe(false);
    expect(w2.offline).toBe(true);
    expect(() => f2.get(A, 2000)).toThrow(/reconnecting/);
    expect(() => f2.expand(A, 2000)).toThrow(/reconnecting/); // never re-sells the building
    expect(() => w2.storage(A)).toThrow(/reconnecting/);
    expect(getBank().account(A).chips).toBe(chips);
    await f2.flush(); await w2.flush();

    // DB comes back: the real factory and storage are all there.
    expect(await w2.attach(new PgMineStore(pool))).toBe(true);
    expect(w2.offline).toBe(false);
    const s = f2.get(A, 3000)!;
    expect(s).not.toBeNull();
    expect(s.ents.some((e) => e.k === 'belt' && e.x === 3)).toBe(true);
    expect(w2.storage(A).find((x) => x.id === 'iron_bar')?.qty).toBe(7);
  });

  it('retries a transient timeout and loads the rows', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    let n = 0; const flaky = () => (n++ === 0 ? dead() : new PgMineStore(pool));
    expect(await attachWithRetry(w, flaky, () => {}, { tries: 3, delayMs: 1 })).toBe(true);
    expect(w.offline).toBe(false);
  });

  it('guests still mine while offline', () => {
    w.offline = true;
    const m = w.join('g1', null, 0);
    expect(m.account).toBeNull();
    expect(() => w.backpack('g1')).not.toThrow();
  });
});
