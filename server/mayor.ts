/**
 * City Hall / mayor election server (shared/mayor.ts has the schedule and limits). Postgres is the source of truth:
 * mayor_candidates, mayor_votes, mayor_terms, mayor_rates. Results are tallied lazily (first read after voting closes)
 * with ON CONFLICT DO NOTHING, so restarts and multiple instances can't double-count. The filing fee is burned through
 * the atomic wallet (ledger game 'mayor_filing') in the same transaction as the candidate row. The only thing a mayor
 * controls is two clamped multipliers read by property tax (realEstate) and the Market / Stock Exchange fees.
 */
import { randomUUID } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { bootAttach, setBootState } from './boot-retry.js';
import { databaseUrl } from './leaderboard-store.js';
import { getBank, type CasinoBank } from './casino-store.js';
import { adminAuthorized } from './admin.js';
import { playerKey } from './skins.js';
import {
  schedule, clampRate, nextAbMidnight, abDayStart, FILING_FEE, SLOGAN_MAX, MIN_VOTER_AGE_MS, MIN_PLAY_TX, RATE_MIN, RATE_MAX, RATE_STEP,
  BASE_PROPERTY_TAX, BASE_MARKET_FEE, BASE_STOCK_FEE, WEEK_MS,
  type Candidate, type Term, type RateChange, type CityRates, type CityHallView,
} from '../shared/mayor.js';

export const MAYOR_MIGRATION = `
CREATE TABLE IF NOT EXISTS mayor_candidates (week TEXT NOT NULL, player_key TEXT NOT NULL, name TEXT NOT NULL, slogan TEXT NOT NULL, filed_at BIGINT NOT NULL, PRIMARY KEY (week, player_key));
CREATE TABLE IF NOT EXISTS mayor_votes (week TEXT NOT NULL, voter_key TEXT NOT NULL, candidate_key TEXT NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (week, voter_key));
CREATE TABLE IF NOT EXISTS mayor_terms (week TEXT PRIMARY KEY, player_key TEXT NOT NULL, name TEXT NOT NULL, votes INTEGER NOT NULL, starts_at BIGINT NOT NULL, ends_at BIGINT NOT NULL, removed_at BIGINT, note TEXT);
CREATE TABLE IF NOT EXISTS mayor_rates (id TEXT PRIMARY KEY, at BIGINT NOT NULL, effective_at BIGINT NOT NULL, by_name TEXT NOT NULL, property DOUBLE PRECISION NOT NULL, fee DOUBLE PRECISION NOT NULL, note TEXT);
CREATE TABLE IF NOT EXISTS mayor_rate_days (day BIGINT PRIMARY KEY, rate_id TEXT NOT NULL, by_name TEXT NOT NULL, at BIGINT NOT NULL);
`;
export class MayorError extends Error {}
const NOT_GAMES = ['daily_bonus', 'admin', 'admin_grant', 'bailout', 'mayor_filing'];

export class Mayor {
  log: RateChange[] = []; // oldest first, every change ever (small)
  constructor(private readonly pool: pg.Pool, private readonly bank: () => CasinoBank = getBank, private readonly clock = () => Date.now()) {}
  async init() { await this.pool.query(MAYOR_MIGRATION); await this.reload(); }
  async reload() {
    const r = await this.pool.query('SELECT * FROM mayor_rates ORDER BY at ASC, id ASC');
    this.log = r.rows.map((x: any) => ({ at: Number(x.at), effectiveAt: Number(x.effective_at), by: String(x.by_name), property: Number(x.property), fee: Number(x.fee), note: x.note ?? undefined }));
  }
  /** Multipliers in force at t (default 1/1). Synchronous: used on the hot fee path. */
  rates(t = this.clock()): CityRates {
    let cur: CityRates = { property: 1, fee: 1 };
    for (const c of this.log) if (c.effectiveAt <= t) cur = { property: clampRate(c.property), fee: clampRate(c.fee) };
    return cur;
  }
  pending(t = this.clock()): RateChange | null { const p = this.log.filter((c) => c.effectiveAt > t); return p.length ? p[p.length - 1] : null; }

  private async tx(body: (cl: pg.PoolClient) => Promise<void>, charge?: { name: string; amount: number; game: string; memo: string }) {
    let w: ReturnType<CasinoBank['transferAtomic']> | null = null;
    try { w = charge ? this.bank().transferAtomic([{ name: charge.name, amount: charge.amount, key: `${charge.game}:${randomUUID()}`, game: charge.game, memo: charge.memo }]) : null; }
    catch (e) { throw new MayorError(/chips|balance/i.test((e as Error).message) ? 'Not enough chips.' : (e as Error).message === 'Wallet temporarily unavailable.' ? 'Wallet temporarily unavailable.' : 'Something went wrong. Nothing was charged.'); }
    const run = async () => {
      if (w) await w.after; const cl = await this.pool.connect();
      try { await cl.query('BEGIN'); await body(cl); if (w) for (const s of w.stmts) await cl.query(s.sql, s.args); await cl.query('COMMIT'); }
      catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); const ww = w; ww?.bind(p);
    try { await p; } catch (e) { ww?.revert(); if (e instanceof MayorError) throw e; if (/duplicate|unique/i.test((e as Error).message)) throw new MayorError('Already done.'); if (w && /chips|balance|null value/i.test((e as Error).message)) throw new MayorError('Not enough chips.'); console.error('[mayor] failed:', (e as Error).message); throw new MayorError('Something went wrong. Nothing was charged.'); }
  }

  /** Anti-alt gate for voting and running: account >= 24 h old and some real play on the ledger. */
  async eligibility(name: string): Promise<string | undefined> {
    const key = playerKey(name); const now = this.clock();
    try {
      const r = await this.pool.query('SELECT created_at FROM players WHERE player_key = $1', [key]); const t = r.rows[0]?.created_at;
      const ms = t ? new Date(t).getTime() : NaN; if (!Number.isFinite(ms) || now - ms < MIN_VOTER_AGE_MS) return 'Your account must be at least 24 hours old.';
      const n = Number((await this.pool.query(`SELECT count(*) AS n FROM wallet_transactions WHERE player_key = $1 AND game NOT IN (${NOT_GAMES.map((_, i) => `$${i + 2}`).join(',')})`, [key, ...NOT_GAMES])).rows[0]?.n ?? 0);
      if (n < MIN_PLAY_TX) return 'Play a few games first (casino, mining, fishing, trading…) before taking part.';
    } catch { return 'City Hall can’t check your account right now.'; } // fail closed
    return undefined;
  }

  async candidates(week: string): Promise<Candidate[]> {
    return (await this.tallied(week)).map(({ key: _k, ...c }) => c);
  }
  /** Candidates of a week with vote counts, filing order. */
  async tallied(week: string): Promise<Array<Candidate & { key: string; votes: number }>> {
    const r = await this.pool.query('SELECT player_key, name, slogan, filed_at FROM mayor_candidates WHERE week = $1 ORDER BY filed_at ASC, player_key ASC', [week]);
    const v = await this.pool.query('SELECT candidate_key FROM mayor_votes WHERE week = $1', [week]);
    const n = new Map<string, number>(); for (const x of v.rows as any[]) n.set(String(x.candidate_key), (n.get(String(x.candidate_key)) ?? 0) + 1);
    return r.rows.map((x: any) => ({ key: String(x.player_key), name: String(x.name), slogan: String(x.slogan), filedAt: Number(x.filed_at), votes: n.get(String(x.player_key)) ?? 0 }));
  }
  /** Tally a closed week once (idempotent). Most votes wins; ties -> earliest filer. No candidates -> no term. */
  async settle(t = this.clock()) {
    for (const back of [WEEK_MS, 0]) {
      const s = schedule(t - back); if (t < s.resultsAt) continue;
      const have = await this.pool.query('SELECT 1 FROM mayor_terms WHERE week = $1', [s.week]); if (have.rows.length) continue;
      const win = pickWinner(await this.tallied(s.week)); if (!win) continue;
      await this.pool.query('INSERT INTO mayor_terms (week, player_key, name, votes, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [s.week, win.key, win.name, win.votes, s.termStart, s.termEnd]);
      console.log(`[mayor] ${s.week}: ${win.name} elected with ${win.votes} votes`);
    }
  }
  private term(x: any): Term { return { week: String(x.week), name: String(x.name), votes: Number(x.votes), startsAt: Number(x.starts_at), endsAt: Number(x.ends_at), removedAt: x.removed_at == null ? null : Number(x.removed_at), note: x.note ?? null }; }
  async mayor(t = this.clock()): Promise<(Term & { key: string }) | null> {
    const r = await this.pool.query('SELECT * FROM mayor_terms WHERE starts_at <= $1 AND ends_at > $1 AND removed_at IS NULL ORDER BY starts_at DESC LIMIT 1', [t]);
    return r.rows[0] ? { ...this.term(r.rows[0]), key: String(r.rows[0].player_key) } : null;
  }
  async elect(t = this.clock()): Promise<Term | null> {
    const r = await this.pool.query('SELECT * FROM mayor_terms WHERE starts_at > $1 AND removed_at IS NULL ORDER BY starts_at ASC LIMIT 1', [t]);
    return r.rows[0] ? this.term(r.rows[0]) : null;
  }

  async file(name: string, slogan: unknown) {
    const now = this.clock(); const s = schedule(now);
    if (s.phase !== 'filing') throw new MayorError('Filing is closed. You can run Monday to Thursday (Alberta time).');
    const text = String(slogan ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < 3) throw new MayorError('Write a short slogan (at least 3 characters).');
    if (text.length > SLOGAN_MAX) throw new MayorError(`Keep your slogan under ${SLOGAN_MAX} characters.`);
    const why = await this.eligibility(name); if (why) throw new MayorError(why);
    const key = playerKey(name);
    const dup = await this.pool.query('SELECT 1 FROM mayor_candidates WHERE week = $1 AND player_key = $2', [s.week, key]); if (dup.rows.length) throw new MayorError('You are already running this week.');
    await this.tx(async (cl) => { await cl.query('INSERT INTO mayor_candidates (week, player_key, name, slogan, filed_at) VALUES ($1,$2,$3,$4,$5)', [s.week, key, name.trim(), text, now]); },
      { name, amount: -FILING_FEE, game: 'mayor_filing', memo: `Ran for mayor (week of ${s.week})` });
    return { fee: FILING_FEE };
  }
  async vote(name: string, candidate: unknown) {
    const now = this.clock(); const s = schedule(now);
    if (s.phase !== 'voting') throw new MayorError('Voting is open Friday and Saturday (Alberta time).');
    const why = await this.eligibility(name); if (why) throw new MayorError(why);
    const ck = playerKey(String(candidate ?? ''));
    const c = await this.pool.query('SELECT name FROM mayor_candidates WHERE week = $1 AND player_key = $2', [s.week, ck]); if (!c.rows.length) throw new MayorError('No such candidate.');
    const r = await this.pool.query('INSERT INTO mayor_votes (week, voter_key, candidate_key, at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [s.week, playerKey(name), ck, now]);
    if (!r.rowCount) throw new MayorError('You already voted this week.');
    return { votedFor: String(c.rows[0].name) };
  }
  private changeBlock(t: number): string | undefined {
    const today = abDayStart(t); if (this.log.some((c) => c.at >= today && c.by !== 'admin')) return 'You already changed rates today. Try again after midnight (Alberta time).';
    return undefined;
  }
  async setRates(name: string, body: { property?: unknown; fee?: unknown }) {
    const now = this.clock(); await this.settle(now); const m = await this.mayor(now);
    if (!m || m.key !== playerKey(name)) throw new MayorError('Only the sitting mayor can set city rates.');
    const why = this.changeBlock(now); if (why) throw new MayorError(why);
    const property = clampRate(body.property), fee = clampRate(body.fee);
    const c: RateChange = { at: now, effectiveAt: nextAbMidnight(now), by: m.name, property, fee };
    const day = abDayStart(now), id = randomUUID(), taken = 'You already changed rates today. Try again after midnight (Alberta time).';
    // Server-side check against Postgres (the in-memory log can be stale on another instance), then a per-day primary key
    // claimed in the same transaction as the rate row, so concurrent requests on any instance can't both land.
    if ((await this.pool.query('SELECT 1 FROM mayor_rate_days WHERE day = $1', [day])).rows.length) throw new MayorError(taken);
    await this.tx(async (cl) => {
      const claim = await cl.query('INSERT INTO mayor_rate_days (day, rate_id, by_name, at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [day, id, c.by, now]);
      if (!claim.rowCount) throw new MayorError(taken);
      await cl.query('INSERT INTO mayor_rates (id, at, effective_at, by_name, property, fee) VALUES ($1,$2,$3,$4,$5,$6)', [id, c.at, c.effectiveAt, c.by, property, fee]);
    });
    this.log.push(c); return c;
  }
  /** Admin: remove the sitting mayor (or mayor-elect) and put rates back to default immediately. */
  async remove(note: unknown) {
    const now = this.clock(); await this.settle(now); const m = (await this.mayor(now)) ?? (await this.elect(now));
    if (!m) throw new MayorError('There is no mayor to remove.');
    const n = String(note ?? '').slice(0, 200) || 'Removed by admin';
    await this.pool.query('UPDATE mayor_terms SET removed_at = $2, note = $3 WHERE week = $1', [m.week, now, n]);
    const c: RateChange = { at: now, effectiveAt: now, by: 'admin', property: 1, fee: 1, note: `Rates reset: ${m.name} removed (${n})` };
    await this.pool.query('INSERT INTO mayor_rates (id, at, effective_at, by_name, property, fee, note) VALUES ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), c.at, c.effectiveAt, c.by, 1, 1, c.note]);
    this.log.push(c); console.log(`[mayor] admin removed ${m.name}`);
    return { removed: m.name };
  }

  async view(name: string | null): Promise<CityHallView> {
    const now = this.clock(); await this.settle(now); const s = schedule(now);
    const [candidates, mayor, elect] = await Promise.all([this.candidates(s.week), this.mayor(now), this.elect(now)]);
    const v: CityHallView = {
      // Hide live per-candidate tallies while filing/voting; Sunday results (and settle) may show them.
      now, schedule: s, candidates: s.phase === 'results' ? candidates : candidates.map(({ votes: _v, ...c }) => c),
      mayor: mayor ? { week: mayor.week, name: mayor.name, votes: mayor.votes, startsAt: mayor.startsAt, endsAt: mayor.endsAt, removedAt: null } : null, elect,
      rates: this.rates(now), pending: this.pending(now), log: this.log.slice(-30).reverse(),
      limits: { min: RATE_MIN, max: RATE_MAX, step: RATE_STEP, fee: FILING_FEE, base: { property: BASE_PROPERTY_TAX, market: BASE_MARKET_FEE, stock: BASE_STOCK_FEE } },
    };
    if (name) {
      const key = playerKey(name);
      const voted = await this.pool.query('SELECT c.name FROM mayor_votes v JOIN mayor_candidates c ON c.week = v.week AND c.player_key = v.candidate_key WHERE v.week = $1 AND v.voter_key = $2', [s.week, key]);
      const reason = await this.eligibility(name); const isMayor = !!mayor && mayor.key === key; const changeReason = isMayor ? this.changeBlock(now) : 'Only the sitting mayor can set city rates.';
      v.me = { name, filed: candidates.some((c) => playerKey(c.name) === key), votedFor: voted.rows[0]?.name ?? null, canVote: s.phase === 'voting' && !reason && !voted.rows.length, reason, isMayor, canChange: isMayor && !changeReason, changeReason };
    }
    return v;
  }
}
export function pickWinner<T extends { key: string; filedAt: number; votes: number }>(rows: T[]): T | null {
  return [...rows].sort((a, b) => b.votes - a.votes || a.filedAt - b.filedAt || a.key.localeCompare(b.key))[0] ?? null;
}

let mayorInst: Mayor | null = null;
export const getMayor = () => mayorInst;
export const setMayorForTest = (m: Mayor | null) => { mayorInst = m; };
/** Hot-path readers (default 1 when City Hall is offline). */
export const cityPropertyTaxMul = (t?: number) => mayorInst?.rates(t).property ?? 1;
export const cityFeeMul = (t?: number) => mayorInst?.rates(t).fee ?? 1;
export async function initMayor(): Promise<void> {
  const url = databaseUrl(); if (!url) { setBootState('mayor', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[mayor] pool error:', e.message));
  await bootAttach('mayor', async () => { try { const m = new Mayor(pool); await m.init(); mayorInst = m; console.log('[mayor] ready'); return true; } catch (e) { console.error('[mayor] init failed:', (e as Error).message); return false; } });
  setInterval(() => { void mayorInst?.reload().catch(() => {}); }, 60_000).unref?.();
}
export function mayorRouter() {
  const r = express.Router();
  r.get('/api/city-hall', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!mayorInst) return res.json({ ok: true, live: false, rates: { property: 1, fee: 1 } });
    try { res.json({ ok: true, live: true, view: await mayorInst.view(null) }); } catch { res.status(503).json({ ok: false, error: 'City Hall is closed right now.' }); }
  });
  r.post('/api/admin/mayor/remove', express.json({ limit: '2kb' }), async (req, res) => {
    if (!adminAuthorized(req.get('authorization'))) return res.status(401).json({ ok: false, error: 'Unauthorized.' });
    if (!mayorInst) return res.status(503).json({ ok: false, error: 'City Hall is offline.' });
    try { res.json({ ok: true, ...(await mayorInst.remove((req.body ?? {}).note)) }); } catch (e) { res.status(400).json({ ok: false, error: (e as Error).message }); }
  });
  return r;
}
type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerMayor(_io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const need = () => { const n = nameOf(); if (!n) throw new MayorError('Sign in to take part.'); return n; };
  const on = (ev: string, fn: (b: Record<string, unknown>, m: Mayor) => Promise<object>) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    try { if (!mayorInst) throw new MayorError('City Hall is closed right now.'); const r = await fn(b, mayorInst); ack?.({ ok: true, ...r, view: await mayorInst.view(nameOf()) }); }
    catch (e) { let view: CityHallView | undefined; try { view = mayorInst ? await mayorInst.view(nameOf()) : undefined; } catch { /* */ } ack?.({ ok: false, error: e instanceof MayorError ? e.message : 'Something went wrong.', view }); if (!(e instanceof MayorError)) console.error('[mayor]', e); }
  });
  on('mayor_view', async () => ({}));
  on('mayor_file', async (b, m) => m.file(need(), b.slogan));
  on('mayor_vote', async (b, m) => m.vote(need(), b.candidate));
  on('mayor_rates', async (b, m) => m.setRates(need(), { property: b.property, fee: b.fee }));
}
