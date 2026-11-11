/**
 * Carbon tax: chips per coal burned as fuel in factory smelters, paid by the factory owner, credited to the
 * city treasury. Production is never blocked; unpaid tax is held as arrears and collected on the next catch-up
 * when the owner has chips. Fort McChud does not burn coal (turbines burn natural gas; petcoke ships to the
 * factory as coal and is taxed only when a smelter later burns it).
 */
import { randomUUID } from 'node:crypto';
import { LEVERS } from '../shared/city.js';
import { playerKey } from './skins.js';
import { getBank } from './casino-store.js';
import { cityCarbonTaxRate, treasuryStmtsFor } from './city-rates.js';
import { databaseUrl } from './leaderboard-store.js';
import pg from 'pg';

export const CARBON_TAX_MIGRATION = `
CREATE TABLE IF NOT EXISTS carbon_tax_arrears (
  player_key TEXT PRIMARY KEY,
  unpaid BIGINT NOT NULL DEFAULT 0 CHECK (unpaid >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
let pool: Q | null = null;
const arrears = new Map<string, number>();
let seq = 0;

export function resetCarbonTax() { arrears.clear(); seq = 0; }
export function carbonUnpaid(name: string) { return arrears.get(playerKey(name)) ?? 0; }
export function setCarbonTaxPool(p: Q | null) { pool = p; }

export async function initCarbonTax(p: Q | null) {
  pool = p;
  if (!p) return;
  await p.query(CARBON_TAX_MIGRATION);
  const r = await p.query('SELECT player_key, unpaid FROM carbon_tax_arrears');
  for (const row of r.rows) arrears.set(String(row.player_key), Math.max(0, Math.floor(Number(row.unpaid) || 0)));
}

/** Production boot: same DATABASE_URL as the rest of the game. No-op when no database is configured. */
export async function bootCarbonTax() {
  const url = databaseUrl(); if (!url) return;
  const p = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  p.on('error', (e) => console.error('[carbon-tax] pool error:', e.message));
  try { await initCarbonTax(p); console.log('[carbon-tax] ready'); }
  catch (e) { console.error('[carbon-tax] init failed:', (e as Error).message); }
}

export function carbonRate(): number {
  const s = LEVERS.carbon_tax;
  const n = Number(cityCarbonTaxRate());
  if (!Number.isFinite(n)) return s.base;
  return Math.min(s.max, Math.max(s.min, Math.round(n / s.step) * s.step));
}

/**
 * Charge for `coal` just burned, plus any unpaid balance. Debits what the player can afford (never below
 * zero, never throws). Remaining unpaid is kept and retried on the next call. Production must already have
 * happened; this never rolls back crafts.
 */
export function collectCarbonTax(name: string, coal: number): { charged: number; unpaid: number; rate: number; coal: number } {
  const rate = carbonRate();
  const k = playerKey(name);
  const burned = Math.max(0, Math.floor(coal));
  const due = burned * rate + (arrears.get(k) ?? 0);
  if (due <= 0) { arrears.set(k, 0); return { charged: 0, unpaid: 0, rate, coal: burned }; }
  let pay = 0;
  const memo = `Carbon tax: ${burned} coal × ${rate} chip${rate === 1 ? '' : 's'} / coal`.slice(0, 200);
  try {
    const bank = getBank();
    const chips = Math.max(0, bank.account(name).chips);
    pay = Math.min(chips, due);
    if (pay > 0) {
      const key = `carbon_tax:${k}:${Date.now()}:${++seq}:${randomUUID()}`;
      const w = bank.transferAtomic([{ name, amount: -pay, key, game: 'carbon_tax', memo }]);
      const remain = due - pay;
      const stmts = [
        ...w.stmts,
        ...treasuryStmtsFor(name, 'carbon_tax', pay, memo),
        { sql: `INSERT INTO carbon_tax_arrears (player_key, unpaid, updated_at) VALUES ($1,$2,now()) ON CONFLICT (player_key) DO UPDATE SET unpaid = EXCLUDED.unpaid, updated_at = now()`, args: [k, remain] },
      ];
      if (pool) {
        const db = pool;
        const run = (async () => {
          await w.after;
          for (const s of stmts) await db.query(s.sql, s.args);
        })();
        w.bind(run);
        void run.catch((e) => { w.revert(); arrears.set(k, due); console.error('[carbon-tax] write failed:', (e as Error).message); });
      }
    }
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (!/chips|enough|unavailable|ready|Guard|not ready/i.test(msg)) console.error('[carbon-tax]', e);
    pay = 0;
  }
  const remain = due - pay;
  arrears.set(k, remain);
  return { charged: pay, unpaid: remain, rate, coal: burned };
}
