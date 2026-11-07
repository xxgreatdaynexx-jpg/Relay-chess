/** Real PostgreSQL: resort barn restored exactly once (lost-ACK re-run = no-op); unprovenanced stock listed, never moved. */
import { afterAll, expect, it } from 'vitest';
import pg from 'pg';
import { FOLD_PREP, restoreResortBarn, heldLegacyReview } from '../server/mapPools.js';
const url = process.env.MAYOR_LAWS_TEST_DATABASE_URL;
const drops: Array<() => Promise<void>> = [];
afterAll(async () => { for (const d of drops) await d(); });
it.skipIf(!url)('barn -> resort pool once; NULL fish/dish/fillets held and reviewable', async () => {
  const u = new URL(url!); if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('local DB only');
  const name = `hl_${process.pid}_${Date.now()}`; const root = new pg.Client({ connectionString: url }); await root.connect(); await root.query(`CREATE DATABASE ${name}`);
  u.pathname = `/${name}`; const pool = new pg.Pool({ connectionString: u.toString(), max: 4 });
  drops.push(async () => { await pool.end(); await root.query(`DROP DATABASE ${name}`); await root.end(); });
  await pool.query(FOLD_PREP);
  await pool.query("INSERT INTO building_inv VALUES('a','A','resort_farm','crop:wheat',7),('a','A','resort_farm','harvest',2)");
  await pool.query("INSERT INTO loc_stock VALUES('a','A','resort','crop:wheat',3)");
  await pool.query("INSERT INTO kitchen_fillets VALUES('a','cod',4)");
  const a = restoreResortBarn(pool); const b = restoreResortBarn(pool); // concurrent instances
  const [ra, rb] = await Promise.all([a, b]);
  expect([ra.already, rb.already].sort()).toEqual([false, true]);
  expect((await restoreResortBarn(pool)).already).toBe(true); // restart / lost ACK re-run
  expect(Number((await pool.query("SELECT qty FROM loc_stock WHERE loc='resort' AND item='crop:wheat'")).rows[0].qty)).toBe(10);
  expect(Number((await pool.query("SELECT qty FROM building_inv WHERE item='crop:wheat'")).rows[0].qty)).toBe(0);
  const held = await heldLegacyReview(pool, 'a');
  expect(held.map((h) => [h.kind, h.what, h.n])).toEqual([['fillet', 'fillet_cod', 4], ['barn', 'harvest', 2]]);
}, 30_000);
