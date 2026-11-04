/**
 * Server-only stock news schedule. Each company's daily events are derived from a server secret
 * (STOCK_NEWS_SECRET, or a random value generated once and stored in the DB), so the public code
 * can't be used to predict when news lands or which way it moves. Never import this from client/ or shared/.
 */
import { createHmac, randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { Company, NewsItem } from '../shared/stocks.js';

const GOOD = ['beats earnings estimates', 'wins a big city contract', 'unveils a hit new product', 'is the subject of a merger rumor', 'gets an analyst upgrade', 'reports record quarterly sales', 'announces a share buyback', 'lands a celebrity endorsement'];
const BAD = ['misses earnings estimates', 'is hit by an accounting scandal', 'issues a product recall', 'loses a major contract', 'gets an analyst downgrade', 'CEO resigns abruptly', 'faces a regulator investigation', 'suffers a warehouse fire'];

/** Keyed random stream: each draw is an HMAC of (ticker, day, index), so seeing some events reveals nothing about others. */
const stream = (secret: string, key: string) => { let k = 0; return () => createHmac('sha256', secret).update(`${key}:${k++}`).digest().readUInt32BE(0) / 4294967296; };

/** The day's scheduled events for one company: 1-2 events at secret-seeded times, shock scaled by volatility. */
export function dailyEvents(c: Company, day: string, secret: string): NewsItem[] {
  if (!secret) throw new Error('stock news secret missing');
  const r = stream(secret, `${c.ticker}:${day}`); const t0 = Date.parse(`${day}T00:00:00Z`);
  const n = r() < 0.25 ? 2 : 1; const out: NewsItem[] = [];
  for (let i = 0; i < n; i++) {
    const good = r() < 0.52; const list = good ? GOOD : BAD; const what = list[Math.floor(r() * list.length)]!;
    const size = c.vol * (0.8 + r() * 1.7); // ~1-2.5 daily sigmas
    // ids use an "n" prefix so they never collide with news published under the old public schedule
    out.push({ id: `${c.ticker}:${day}:n${i}`, ticker: c.ticker, at: t0 + Math.floor(r() * 86_400_000), headline: `${c.name} ${what}`, move: Math.round((good ? size : -size) * 10000) / 10000, good });
  }
  return out.sort((a, b) => a.at - b.at);
}

export interface NewsKey { secret: string; /** events at or before this time are never published (keeps history from before the switch untouched) */ since: number }

const MIG = `CREATE TABLE IF NOT EXISTS stock_news_key (id INT PRIMARY KEY, secret TEXT NOT NULL, since BIGINT NOT NULL)`;
/** Loads (or creates once) the news key. The env secret wins when set; the DB-generated one survives restarts otherwise. */
export async function loadNewsKey(pool: pg.Pool, now: number, env = process.env.STOCK_NEWS_SECRET): Promise<NewsKey> {
  await pool.query(MIG);
  await pool.query('INSERT INTO stock_news_key (id, secret, since) VALUES (1, $1, $2) ON CONFLICT DO NOTHING', [randomBytes(32).toString('hex'), now]);
  const row = (await pool.query('SELECT secret, since FROM stock_news_key WHERE id = 1')).rows[0];
  return { secret: env && env.length >= 16 ? env : String(row.secret), since: Number(row.since) };
}
/** Memory mode (tests / dev without a DB): env secret or a per-process random one, no cutover. */
export const memoryNewsKey = (env = process.env.STOCK_NEWS_SECRET): NewsKey => ({ secret: env && env.length >= 16 ? env : randomBytes(32).toString('hex'), since: 0 });
