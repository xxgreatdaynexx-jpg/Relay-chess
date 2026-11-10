/** Public, read-only player profile: what another player owns. No email, password, session or ledger detail is ever exposed. */
import express from 'express';
import pg from 'pg';
import type { Server } from 'socket.io';
import { onlineSnapshot } from './chat.js';
import { databaseUrl } from './leaderboard-store.js';
import { getAccounts, RateLimiter } from './accounts.js';
import { getBank } from './casino-store.js';
import { getEconomy } from './economy.js';
import { getExchange } from './stocks.js';
import { getDerivs } from './derivs.js';
import { getRealEstate } from './realEstate.js';
import { getGarage } from './cars.js';
import { getVault } from './skins.js';
import { getSkills } from './skills.js';
import { houseRoom } from './house-room.js';
import { getPlayTime } from './playtime.js';
import { NETWORTH_MIGRATION } from './networth-snapshots.js';
import { isQaName } from '../shared/qa.js';
import { propertyById } from '../shared/realEstate.js';
import { cropById } from '../shared/farm.js';
import { fishById } from '../shared/fishing.js';
import { CAR_BY_ID } from '../shared/cars.js';
import { SKIN_BY_ID } from '../shared/skins.js';

export const keyOf = (n: string) => n.replace(/\s+/g, ' ').trim().toLowerCase();
export const validName = (n: unknown): n is string => typeof n === 'string' && n.trim().length > 0 && n.length <= 40 && /^[\w .\-]+$/.test(n);
const RANK: Record<string, number> = { ultra: 3, rare: 2, common: 1 };
const safe = async <T>(p: () => Promise<T> | T, fallback: T): Promise<T> => { try { return await p(); } catch { return fallback; } };

const safeSync = <T>(f: () => T): T | null => { try { return f(); } catch { return null; } };

type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
let pool: pg.Pool | null = null;
const getPool = (): Q | null => { const url = databaseUrl(); if (!url) return null; return (pool ??= new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 })); };

export interface ProfileDeps {
  db: () => Q | null;
  account: (key: string) => Promise<{ name: string } | null>;
  online: (key: string) => { online: boolean; where?: string | null };
  now: () => number;
}

/** Build the public profile, or null when no such account exists (never creates one). */
export async function buildPlayerProfile(raw: string, deps: ProfileDeps) {
  const key = keyOf(raw);
  const acct = await deps.account(key);
  if (!acct) return null;
  const name = acct.name; const now = deps.now(); const db = deps.db();
  const row1 = async (sql: string) => (db ? (await safe(() => db.query(sql, [key]), { rows: [] })).rows : []);

  const bank = getBank();
  const chips = bank.ready ? await safe(() => bank.refresh(name), 0) : null;
  const assets = await safe(() => getEconomy()?.playerAssets(name, now) ?? null, null);
  const assetTotal = assets?.total ?? 0;

  const re = getRealEstate();
  const properties = (re ? await safe(() => re.mine(name), []) : []).map((p) => {
    const def = propertyById(p.id);
    return { id: p.id, label: p.label, type: p.type, value: p.value, x: def?.x ?? null, z: def?.z ?? null, map: def?.map ?? 'city' };
  });

  const tiles = await row1('SELECT t.plot_id, t.crop, t.planted_at FROM farm_tiles t JOIN properties p ON p.id = t.plot_id AND p.owner_key = t.owner_key WHERE t.owner_key = $1');
  const farmMap = new Map<string, { plot: string; label: string; x: number | null; z: number | null; map: string; crops: Map<string, { crop: string; label: string; emoji: string; n: number; ready: number }> }>();
  for (const t of tiles) {
    const plot = String(t.plot_id); const def = propertyById(plot); const c = cropById(t.crop);
    const f = farmMap.get(plot) ?? { plot, label: def?.label ?? plot, x: def?.x ?? null, z: def?.z ?? null, map: def?.map ?? 'city', crops: new Map() };
    farmMap.set(plot, f);
    const k = String(t.crop); const e = f.crops.get(k) ?? { crop: k, label: c?.label ?? k, emoji: c?.emoji ?? '🌱', n: 0, ready: 0 };
    e.n++; if (c && Number(t.planted_at) + c.grow <= now) e.ready++;
    f.crops.set(k, e);
  }
  const farms = [...farmMap.values()].map((f) => ({ ...f, crops: [...f.crops.values()].sort((a, b) => b.n - a.n) }));

  const g = getGarage();
  const cars = (g ? (await safe(async () => (await g.garage(name)).cars as Array<{ carId: string; value: number }>, [])) : []).map((c) => ({ carId: c.carId, name: CAR_BY_ID.get(c.carId)?.name ?? c.carId, value: c.value }));
  const lot = (await row1('SELECT lot FROM trailer_lots WHERE player_key = $1'))[0];
  const trailer = lot ? { lot: Number(lot.lot) } : null;

  const ex = getExchange();
  const stocks = ex ? (await safe(() => ex.holdings(name), [])).filter((h) => h.shares > 0).map((h) => { const price = ex.price(h.ticker) ?? 0; return { ticker: h.ticker, shares: h.shares, price, value: Math.floor(h.shares * price) }; }) : [];
  const dv = getDerivs();
  const port = dv ? await safe(() => dv.portfolio(name), null) : null;
  const funds = (port?.funds ?? []).map((f) => ({ fund: f.fund, name: f.name, units: f.units, value: f.value }));
  const options = (port?.options ?? []).map((o) => ({ ticker: o.ticker, kind: o.kind, strike: o.strike, qty: o.qty, value: Math.floor(o.mark ?? 0) }));
  const shorts = (port?.shorts ?? []).map((s) => ({ ticker: s.ticker, shares: s.shares, value: s.equity }));

  const items = await safe(() => getVault().inventory(name), []);
  const skinItems = items.filter((i) => i.kind === 'skin');
  const highlights = skinItems.map((i) => ({ i, d: SKIN_BY_ID.get(i.skin) })).filter((x) => x.d)
    .sort((a, b) => (RANK[b.d!.rarity] ?? 0) - (RANK[a.d!.rarity] ?? 0) || a.i.float - b.i.float).slice(0, 6)
    .map(({ i, d }) => ({ name: d!.name, weapon: d!.weapon, rarity: d!.rarity, color: d!.colors[0], equipped: i.equipped }));
  const skins = { total: skinItems.length, cases: items.filter((i) => i.kind === 'case').length, keys: items.filter((i) => i.kind === 'key').length, highlights };

  const skills = await safe(() => getSkills().profile(name), null);
  const fish = (await row1('SELECT species, weight_g, value, caught_at FROM fish_catches WHERE player_key = $1 AND COALESCE(hired, FALSE) = FALSE ORDER BY weight_g DESC, caught_at ASC, id ASC LIMIT 1'))[0];
  const biggestFish = fish ? { species: String(fish.species), label: fishById(fish.species)?.label ?? String(fish.species), emoji: fishById(fish.species)?.emoji ?? '🐟', grams: Number(fish.weight_g), value: Number(fish.value), at: Number(fish.caught_at) } : null;
  const playMs = await safe(() => getPlayTime().total(name), 0);
  const since = (await row1('SELECT created_at FROM players WHERE player_key = $1'))[0];
  // #31 (chessguy2): net worth chart. A snapshot is stored at most hourly when the profile is built (deduped against the hourly all-player job in networth-snapshots.ts), plus the chips
  // line is backfilled from the wallet ledger (daily closing balance, 30 days). Read-only for the wallet.
  const netWorthNow = (chips ?? 0) + assetTotal;
  const history = await safe(async () => {
    if (!db) return { points: [] as Array<{ t: number; net: number }>, chips: [] as Array<{ t: number; chips: number }> };
    for (const stmt of NETWORTH_MIGRATION) await db.query(stmt);
    const last = (await db.query('SELECT MAX(t) AS t FROM networth_history WHERE player_key = $1', [key])).rows[0];
    if (chips != null && (!last?.t || Number(last.t) < now - 3_600_000)) await db.query('INSERT INTO networth_history (player_key, t, net, chips) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [key, now, Math.round(netWorthNow), Math.round(chips)]);
    const pts = (await db.query('SELECT t, net FROM networth_history WHERE player_key = $1 AND t > $2 ORDER BY t', [key, now - 90 * 86_400_000])).rows.map((x) => ({ t: Number(x.t), net: Number(x.net) }));
    const cl = (await db.query(`SELECT DISTINCT ON (date_trunc('day', created_at)) date_trunc('day', created_at) AS d, balance FROM wallet_transactions WHERE player_key = $1 AND created_at > now() - interval '30 days' ORDER BY date_trunc('day', created_at), id DESC`, [key])).rows.map((x) => ({ t: new Date(x.d as string).getTime() + 86_399_000, chips: Number(x.balance) }));
    return { points: pts, chips: cl };
  }, { points: [], chips: [] });
  const royalties = await safe(async () => (await row1("SELECT split_part(tx_key, ':', 2) AS lm, COALESCE(SUM(amount),0) AS total FROM wallet_transactions WHERE player_key = $1 AND game = 'monument_royalty' GROUP BY 1 ORDER BY 2 DESC")).map((r) => ({ lm: String(r.lm), total: Number(r.total) })), [] as Array<{ lm: string; total: number }>);
  const dividends = await safe(async () => { const x = (await row1("SELECT COALESCE(SUM(amount),0) AS total FROM wallet_transactions WHERE player_key = $1 AND game = 'dividend'"))[0]; return Number(x?.total ?? 0); }, 0);

  return {
    name, memberSince: since ? new Date(since.created_at as string).toISOString() : null, playMs, ...deps.online(key),
    chips, assets: assetTotal, netWorth: (chips ?? 0) + assetTotal,
    categories: (assets?.categories ?? []).filter((c) => c.value > 0).map((c) => ({ key: c.key, label: c.label, value: Math.round(c.value) })),
    properties, farms, cars, trailer, stocks, funds, options, shorts, skins, skills, biggestFish,
    houseRoom: safeSync(() => houseRoom(name, now)),
    history, dividends, royalties,
  };
}

export type PlayerProfile = NonNullable<Awaited<ReturnType<typeof buildPlayerProfile>>>;

/** GET /api/player/:name — public, cached 5s per player, 30 requests/min per IP. QA accounts are hidden unless the viewer is QA. */
export function playerProfileRouter(io: Server | null, viewerIsQa: (req: express.Request) => Promise<boolean>, deps?: Partial<ProfileDeps>) {
  const r = express.Router();
  const cache = new Map<string, { at: number; body: unknown }>();
  const limiter = new RateLimiter(30, 60_000, 30_000);
  const full: ProfileDeps = {
    db: getPool,
    account: async (key) => { const a = await getAccounts().store.get(key); return a ? { name: a.name } : null; },
    online: (key) => {
      if (!io) return { online: false };
      const u = onlineSnapshot(io, true).users.find((x) => keyOf(x.name) === key);
      return u ? { online: true, where: u.where ?? null } : { online: false };
    },
    now: () => Date.now(),
    ...deps,
  };
  r.get('/api/player/:name', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const ip = req.ip ?? 'unknown'; const now = full.now();
    const wait = limiter.blocked(ip, now);
    if (wait) { res.set('Retry-After', String(wait)); return res.status(429).json({ ok: false, error: `Slow down — try again in ${wait}s.` }); }
    limiter.fail(ip, now);
    const name = req.params.name;
    if (!validName(name)) return res.status(400).json({ ok: false, error: 'Bad name' });
    if (isQaName(name) && !(await viewerIsQa(req))) return res.status(404).json({ ok: false, error: 'No such player' });
    const key = keyOf(name); const hit = cache.get(key);
    if (hit && now - hit.at < 5_000) return res.json(hit.body);
    try {
      const p = await buildPlayerProfile(name, full);
      if (!p) return res.status(404).json({ ok: false, error: 'No such player' });
      const body = { ok: true, profile: p }; cache.set(key, { at: now, body });
      if (cache.size > 500) cache.delete(cache.keys().next().value!);
      res.json(body);
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });
  return r;
}
