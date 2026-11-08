/** pt1969u: small-community contract sizes. Real PostgreSQL (own throwaway database) for the live-contract transition. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Coop } from '../server/coop';
import { PgCasinoStore, getBank, resetBank } from '../server/casino-store';
import { CONTRACT_REBALANCE_FROM, CONTRACT_ROTATION, CONTRACT_ROTATION_V1, contractAt, contractPay, playerCap } from '../shared/coop';
import { FRECIPES } from '../shared/factory';
import { GOODS } from '../shared/mines';

const DAY = 86_400_000;
/** Raw ore per unit through the factory chain. */
function oreOf(key: string): number { const r = FRECIPES.find((x) => x.out[0] === key); if (!r) return 1; return r.in.reduce((a, [k, q]) => a + q * oreOf(k), 0) / r.out[1]; }

describe('contract sizes', () => {
  it('contracts before the cutover keep their original targets; from the cutover on, the small sizes', () => {
    for (let i = 0; i < 7; i++) {
      const old = contractAt(CONTRACT_REBALANCE_FROM - 7 + i), now = contractAt(CONTRACT_REBALANCE_FROM + i);
      expect(old.item).toBe(now.item); // same rotation order
      expect(old.qty).toBe(CONTRACT_ROTATION_V1.find((r) => r.item === old.item)!.qty);
      expect(now.qty).toBe(CONTRACT_ROTATION.find((r) => r.item === now.item)!.qty);
      expect(now.qty * 10).toBeLessThan(old.qty); // meaningfully lower, not a token change
    }
    expect(contractAt(CONTRACT_REBALANCE_FROM).item).toBe('glass'); // the order live on 2026-11-08 UTC (Nov 7 evening UTC-6)
  });
  it('tiny community: two eligible players fill any order, each order is ~2.5k-3.2k raw ore, pay per unit unchanged', () => {
    for (const r of CONTRACT_ROTATION) {
      const c = { qty: r.qty }; expect(2 * playerCap(c)).toBeGreaterThanOrEqual(r.qty);
      const ore = r.qty * oreOf(`${GOODS[r.item].type}:${r.item}`); expect(ore).toBeGreaterThanOrEqual(2_400); expect(ore).toBeLessThanOrEqual(3_200);
      expect(contractPay({ item: r.item }, 100, false).base).toBe(Math.floor(100 * GOODS[r.item].price * 1.15));
    }
  });
});

const url = process.env.MAYOR_LAWS_TEST_DATABASE_URL;
let root: pg.Client; let pool: pg.Pool; let dbName = '';
beforeAll(async () => {
  if (!url) return; const u = new URL(url); if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('local DB only');
  dbName = `cbreb_${process.pid}_${Date.now()}`; root = new pg.Client({ connectionString: url }); await root.connect(); await root.query(`CREATE DATABASE ${dbName}`);
  u.pathname = `/${dbName}`; pool = new pg.Pool({ connectionString: u.toString(), max: 4 });
});
afterAll(async () => { if (!url) return; await pool.end(); await root.query(`DROP DATABASE ${dbName}`); await root.end(); });

describe.skipIf(!url)('live contract transition (real Postgres)', () => {
  it('existing deliveries are kept; the live order fills at the lower target; claims pay once (also after restart); older orders keep old targets', async () => {
    const cur = contractAt(CONTRACT_REBALANCE_FROM); const prev = contractAt(CONTRACT_REBALANCE_FROM - 1);
    const now = cur.start + 6 * 3_600_000; const clock = () => now;
    const b = resetBank(); b.retryMs = []; await b.attach(new PgCasinoStore(pool));
    let c = new Coop(pool as never, clock); await c.init(); // creates the coop tables
    // Deliveries made under the OLD sizes (old cap 25% = 125,000 glass): Ann 120 glass, Bob 40 glass on the live order;
    // Ann 30,000 steel_beam... on yesterday's order (old target 40,000 cable: stays unfilled even though > new 500).
    const ins = (id: string, cid: string, k: string, name: string, item: string, qty: number, at: number) => pool.query('INSERT INTO coop_deliveries (id, contract, player_key, name, item, qty, at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, cid, k, name, item, qty, at]);
    await ins('coop:ann:a1', cur.id, 'ann', 'Ann', cur.item, 120, cur.start + 3_600_000);
    await ins('coop:bob:b1', cur.id, 'bob', 'Bob', cur.item, 40, cur.start + 2 * 3_600_000);
    await ins('coop:ann:a0', prev.id, 'ann', 'Ann', prev.item, 900, prev.start + 3_600_000);
    c = new Coop(pool as never, clock); await c.init(); // a deploy restart replays the stored deliveries
    const v = c.contractView(c.current(), 'Ann');
    expect(v.id).toBe(cur.id); expect(v.qty).toBe(150); expect(v.delivered).toBe(160); expect(v.filled).toBe(true);
    expect(v.myDelivered).toBe(120); // over the new 75 cap: kept and paid in full, nothing clawed back
    expect(c.contractView(c.current(), 'Bob').myDelivered).toBe(40);
    await expect(c.deliver('Carl', { contract: cur.id, qty: 5, nonce: 'n0000001x' })).rejects.toThrow(/already filled|account|play/);
    // Exactly-once completion pay through the existing coop_claim mechanism.
    const ann0 = getBank().account('Ann').chips; const exp = contractPay(cur, 120, true); expect(exp.bonus).toBeGreaterThan(0);
    const r = await Promise.allSettled([c.claim('Ann', cur.id), c.claim('Ann', cur.id)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(getBank().account('Ann').chips).toBe(ann0 + exp.total);
    c = new Coop(pool as never, clock); await c.init(); // restart: still claimed once
    await expect(c.claim('Ann', cur.id)).rejects.toThrow(/Already/);
    expect((await pool.query("SELECT count(*)::int n, sum(amount)::bigint s FROM wallet_transactions WHERE tx_key = $1", [`coop_claim:${cur.id}:ann`])).rows[0]).toEqual({ n: 1, s: String(exp.total) });
    // Yesterday's order keeps its old target: not filled, no retroactive bonus.
    const pv = c.contractView((c as unknown as { contract: (id: string) => never }).contract(prev.id), 'Ann');
    expect(pv.qty).toBe(prev.qty); expect(pv.filled).toBe(false); expect(pv.claimable?.bonus).toBe(0);
  }, 30_000);
});
