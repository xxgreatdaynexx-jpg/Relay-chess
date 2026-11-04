import { isJailed } from './jail.js';
/**
 * Daily wealth tax (pt1397u). At each UTC reset: active players (any ledger row in the last 7 days, QA excluded), net
 * worth = chips + assets (same as the profile/leaderboard), threshold = 2× the median of active players at 10K+ (under 10K never pay). Above it pay 1% of the excess from
 * chips only; the total is split evenly among active players below it. All debits and credits land in ONE Postgres
 * transaction (atomic wallet + ledger) with per-player-per-day keys, plus a wealth_tax_days row (PK = day) so a day can
 * never run twice, even across instances or restarts.
 */
import express from 'express';
import pg from 'pg';
import { databaseUrl } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { getEconomy } from './economy.js';
import { utcDay } from './daily-bonus.js';
import { planWealthTax, WEALTH_TAX_ACTIVE_DAYS, WEALTH_TAX_GAME, WEALTH_TAX_MULT, WEALTH_TAX_RATE, type WealthPlan, type WealthRow } from '../shared/wealthTax.js';

const DAY = 86_400_000;
const norm = (n: string) => n.replace(/\s+/g, ' ').trim().toLowerCase();
export const wealthTaxKey = (name: string, day: string) => `wealth_tax:${norm(name)}:${day}`;
export const wealthShareKey = (name: string, day: string) => `wealth_tax_share:${norm(name)}:${day}`;

const MIGRATION = `CREATE TABLE IF NOT EXISTS wealth_tax_days (day TEXT PRIMARY KEY, data JSONB NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now())`;

let pool: pg.Pool | null = null;
const getPool = () => { const url = databaseUrl(); if (!url) return null; return (pool ??= new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 })); };

export async function activeRows(db: pg.Pool, now = Date.now()): Promise<WealthRow[]> {
  const r = await db.query(`SELECT DISTINCT ON (player_key) name FROM wallet_transactions
    WHERE created_at >= to_timestamp($1/1000.0) AND player_key NOT LIKE 'qa-%' ORDER BY player_key, id DESC`, [now - WEALTH_TAX_ACTIVE_DAYS * DAY]);
  const bank = getBank(); const econ = getEconomy(); const out: WealthRow[] = [];
  for (const row of r.rows) {
    const name = String(row.name);
    const chips = await bank.refresh(name).catch(() => bank.account(name).chips);
    const assets = (await econ?.playerAssets(name, now).catch(() => null))?.total ?? 0;
    out.push({ name, chips, netWorth: chips + assets });
  }
  return out;
}

type Summary = { day: string; median: number; threshold: number; payers: number; recipients: number; total: number; share: number; taxes: Array<{ name: string; amount: number }> };
const summarize = (day: string, p: WealthPlan): Summary => ({ day, median: Math.round(p.median), threshold: p.threshold, payers: p.taxes.length, recipients: p.shares.length, total: p.total, share: p.shares.length ? Math.floor(p.total / p.shares.length) : 0, taxes: p.taxes.map((t) => ({ name: t.name, amount: t.amount })) });

/** Run one day's tax. Returns the summary, or null when that day already ran (or the wallet is down). */
export async function runWealthTax(db: pg.Pool, now = Date.now()): Promise<Summary | null> {
  const bank = getBank(); if (!bank.ready) return null;
  const day = utcDay(now);
  if ((await db.query('SELECT 1 FROM wealth_tax_days WHERE day = $1', [day])).rowCount) return null;
  const plan = planWealthTax(await activeRows(db, now), (n) => isJailed(n)); // jailed players get no share
  const sum = summarize(day, plan);
  const moves = [
    ...plan.taxes.map((t) => ({ name: t.name, amount: -t.amount, key: wealthTaxKey(t.name, day), game: WEALTH_TAX_GAME, memo: 'Wealth tax' })),
    ...plan.shares.map((s) => ({ name: s.name, amount: s.amount, key: wealthShareKey(s.name, day), game: WEALTH_TAX_GAME, memo: 'Wealth tax share' })),
  ];
  const w = moves.length ? bank.transferAtomic(moves) : null;
  const run = async () => {
    if (w) await w.after; const cl = await db.connect();
    try {
      await cl.query('BEGIN');
      await cl.query('INSERT INTO wealth_tax_days (day, data) VALUES ($1, $2)', [day, JSON.stringify(sum)]);
      if (w) for (const s of w.stmts) await cl.query(s.sql, s.args);
      await cl.query('COMMIT');
    } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
  };
  const p = run(); w?.bind(p);
  try { await p; } catch (e) { w?.revert(); console.error('[wealth-tax] failed (nothing moved):', (e as Error).message); return null; }
  console.log(`[wealth-tax] ${day}: ${sum.payers} payers, ${sum.total} chips to ${sum.recipients} players`);
  return sum;
}

let cache: { at: number; v: { median: number; threshold: number; rows: WealthRow[]; plan: WealthPlan } } | null = null;
async function estimate(db: pg.Pool) {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.v;
  const rows = await activeRows(db); const plan = planWealthTax(rows);
  cache = { at: Date.now(), v: { median: plan.median, threshold: plan.threshold, rows, plan } };
  return cache.v;
}

export function startWealthTax(): void {
  const db = getPool(); if (!db) return;
  void db.query(MIGRATION).then(() => {
    // Fire a minute after each UTC reset (after the economy snapshot and price index refresh).
    const arm = () => { const now = Date.now(); const next = (Math.floor(now / DAY) + 1) * DAY + 60_000; const t = setTimeout(() => { void runWealthTax(db).catch((e) => console.error('[wealth-tax]', (e as Error).message)).finally(() => { cache = null; arm(); }); }, next - now); t.unref?.(); };
    arm();
    // Catch up after a restart that slept through a reset, but only once the tax has run before (never on first deploy).
    void db.query('SELECT 1 FROM wealth_tax_days WHERE day = $1', [utcDay(Date.now() - DAY)]).then((r) => { if (r.rowCount) setTimeout(() => void runWealthTax(db).catch(() => {}), 120_000).unref?.(); }).catch(() => {});
  }).catch((e) => console.error('[wealth-tax] init failed:', (e as Error).message));
}

export function wealthTaxRouter(): express.Router {
  const r = express.Router();
  r.get('/api/wealth-tax', async (req, res) => {
    const db = getPool(); if (!db) return res.json({ ok: false, error: 'Wealth tax needs the database.' });
    try {
      const e = await estimate(db); const name = typeof req.query.name === 'string' ? norm(req.query.name) : '';
      const me = name ? e.rows.find((x) => norm(x.name) === name) : undefined;
      const myTax = me ? (e.plan.taxes.find((t) => norm(t.name) === name)?.amount ?? 0) : null;
      const myShare = me ? (e.plan.shares.find((s) => norm(s.name) === name)?.amount ?? 0) : null;
      const raw = (await db.query('SELECT data FROM wealth_tax_days ORDER BY day DESC LIMIT 1')).rows[0]?.data as Summary | undefined;
      const last = raw ? { day: raw.day, threshold: raw.threshold, payers: raw.payers, recipients: raw.recipients, total: raw.total, share: raw.share } : null; // no names in public output
      res.set('Cache-Control', 'private, max-age=60');
      res.json({ ok: true, rate: WEALTH_TAX_RATE, mult: WEALTH_TAX_MULT, activeDays: WEALTH_TAX_ACTIVE_DAYS, active: e.rows.length, median: Math.round(e.median), threshold: e.threshold,
        payers: e.plan.taxes.length, total: e.plan.total, recipients: e.plan.shares.length,
        me: me ? { netWorth: me.netWorth, tax: myTax, share: myShare } : null, last });
    } catch (err) { console.error('[wealth-tax] estimate failed:', (err as Error).message); res.status(500).json({ ok: false, error: 'Could not compute the wealth tax.' }); }
  });
  return r;
}
