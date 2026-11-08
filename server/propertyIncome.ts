/** Durable elapsed-time business income. No speculative wallet/cache changes, no claim endpoint.
 * All credits, ledger rows and cumulative checkpoints use the caller's transaction and property row lock.
 * An ambiguous COMMIT is safe to retry: committed checkpoints never repay; uncommitted work never advances.
 */
import type pg from 'pg';
import { createHash } from 'node:crypto';
import { incomeEligible, incomeEntitlement, incomeBasisOf } from '../shared/propertyIncome.js';
export const PROPERTY_INCOME_MIGRATION = `
CREATE TABLE IF NOT EXISTS property_income_activation (id INT PRIMARY KEY CHECK (id = 1), started_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS property_income (property_id TEXT PRIMARY KEY, ownership TEXT NOT NULL, started_at BIGINT NOT NULL,
 basis BIGINT NOT NULL, paid BIGINT NOT NULL DEFAULT 0);`;
export class PropertyIncomeFailure extends Error {
 constructor(readonly failedIds: string[], detail: string) { super(detail); }
}
export interface IncomeOwner { owner_key: string; owner_name: string; price: string | number; bought_at: string | number; deed: string | null; city_price: string | number | null; }
export class PropertyIncome {
 constructor(private pool: pg.Pool, private clock = () => Date.now()) {}
 async init() {
   await this.pool.query(PROPERTY_INCOME_MIGRATION);
   // Exactly one durable feature cutover, not a process boot time and never historical ownership backpay.
   await this.pool.query('INSERT INTO property_income_activation (id, started_at) VALUES (1,$1) ON CONFLICT DO NOTHING', [this.clock()]);
 }
 async settle(cl: pg.PoolClient, id: string, now: number, expected?: { key: string; boughtAt?: number; price?: number }) {
   if (!incomeEligible(id)) return { amount: 0, owner: '' };
   const r = (await cl.query('SELECT owner_key, owner_name, price, city_price, bought_at, deed FROM properties WHERE id = $1 FOR UPDATE', [id])).rows[0] as IncomeOwner | undefined;
   if (!r) return { amount: 0, owner: '' };
   if (expected && (r.owner_key !== expected.key || (expected.boughtAt != null && Number(r.bought_at) !== expected.boughtAt) || (expected.price != null && Number(r.price) !== expected.price))) throw Error('Property income owner changed');
   // Existing durable anti-arbitrage convention: normal purchases use their actual city-paid price;
   // player-to-player buyout premiums never increase the minting basis (same cap as city sell-back).
   const basis = incomeBasisOf(Number(r.price), r.city_price == null ? null : Number(r.city_price));
   const activation = Number((await cl.query('SELECT started_at FROM property_income_activation WHERE id = 1')).rows[0].started_at);
   const start = Math.max(activation, Number(r.bought_at));
   const ownership = createHash('sha256').update(JSON.stringify([r.owner_key, r.bought_at.toString(), r.deed, basis])).digest('hex');
   await cl.query(`INSERT INTO property_income(property_id, ownership, started_at, basis, paid) VALUES ($1,$2,$3,$4,0)
     ON CONFLICT(property_id) DO UPDATE SET ownership = EXCLUDED.ownership, started_at = EXCLUDED.started_at, basis = EXCLUDED.basis, paid = 0
     WHERE property_income.ownership <> EXCLUDED.ownership`, [id, ownership, start, basis]);
   const state = (await cl.query('SELECT * FROM property_income WHERE property_id = $1', [id])).rows[0];
   const total = incomeEntitlement(Number(state.basis), Number(state.started_at), now);
   const amount = total - BigInt(state.paid);
   if (amount <= 0n) return { amount: 0, owner: r.owner_name };
   if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('Income exceeds safe wallet range');
   // Same additive wallet + durable keyed ledger convention as PgCasinoStore, existing wallet only.
   // Never create a fresh starter balance or use a stale cached absolute balance to pay income.
   const w = await cl.query('UPDATE casino_players SET chips = chips + $2, updated_at = now() WHERE player_key = $1 AND chips + $2 <= 9007199254740991 RETURNING chips', [r.owner_key, amount.toString()]);
   if (!w.rowCount) throw Error('Existing safe-range owner wallet required for property income');
   await cl.query(`INSERT INTO wallet_transactions(tx_key,player_key,name,game,amount,balance,memo) VALUES($1,$2,$3,'property_income',$4,$5,$6)`,
     [`property-income:${id}:${ownership}:${total}`, r.owner_key, r.owner_name, amount.toString(), w.rows[0].chips, `Automatic business income (${id}); city-paid deed basis / 7 days`]);
   await cl.query('UPDATE property_income SET paid = $2 WHERE property_id = $1', [id, total.toString()]);
   return { amount: Number(amount), owner: r.owner_name };
 }
 async run(now = this.clock(), notify?: (name: string) => Promise<unknown>) {
   const ids = (await this.pool.query('SELECT id FROM properties ORDER BY id')).rows.map(r => String(r.id)).filter(incomeEligible);
   let paid = 0; const failed: string[] = []; const errors: string[] = [];
   for (const id of ids) {
     const cl = await this.pool.connect(); let owner = '';
     try {
       await cl.query('BEGIN'); const result = await this.settle(cl, id, now); owner = result.owner;
       await cl.query('COMMIT'); paid += result.amount;
     } catch (e) { await cl.query('ROLLBACK').catch(() => {}); failed.push(id); errors.push((e as Error).message); }
     finally { cl.release(); if (owner && notify) await notify(owner).catch(() => {}); }
   }
   if (failed.length) throw new PropertyIncomeFailure(failed, errors.join('; '));
   return paid;
 }
}
