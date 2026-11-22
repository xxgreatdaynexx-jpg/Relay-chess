/**
 * Chudbai oil & gas (shared/chudbai.ts has the rules and the pure sim). Same persistence pattern as Fort McChud:
 * one JSON row per player (chudbai_state), official concessions (chudbai_leases) and daily sale totals (chudbai_daily).
 * Every chip move is ONE Postgres transaction with the state write, so a failed write charges nothing.
 * Ledger games: 'chudbai' (asset purchases), 'chudbai_upkeep' (repairs: a sink) and 'chudbai_sale' (Mercantile Exchange).
 * Every action needs the player to be AT Chudbai (selling too: the exchange buys in person only).
 */
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { databaseUrl } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { px, priceIndex } from './price-index.js';
import { cityTicketPrice } from './city-rates.js';
import { requireChudbai, TravelError } from './travel.js';
import { playerKey } from './skins.js';
import {
  CHUDBAI_TICKET_BASE, ESP_COST, G_PIPES, G_PRODUCTS, G_SURVEY_COST, G_TRACTS, G_UNITS, G_WELLS_PER_TRACT,
  buildGulfSite, exchangeGross, gPowerDemand, gSettle, gTankCap, gTractInfo, gUnitCount, gWhole, gulfWorth, isGProduct, isGTract, isGUnitKind,
  newGulf, repairCost, sellPayout, wellCost, type GProduct, type GulfSite, type GulfState,
} from '../shared/chudbai.js';

export class GulfError extends Error {}
export const CHUDBAI_MIGRATION = `
CREATE TABLE IF NOT EXISTS chudbai_state (player_key TEXT PRIMARY KEY, name TEXT NOT NULL, state TEXT NOT NULL, updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS chudbai_daily (player_key TEXT NOT NULL, day TEXT NOT NULL, gross BIGINT NOT NULL DEFAULT 0, paid BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (player_key, day));
CREATE TABLE IF NOT EXISTS chudbai_leases (tract SMALLINT PRIMARY KEY CHECK (tract >= 1 AND tract <= 10), player_key TEXT NOT NULL, name TEXT NOT NULL, leased_at BIGINT NOT NULL);`;
type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
type PoolLike = Q & { connect: () => Promise<Q & { release: () => void }> };
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const clone = (s: GulfState): GulfState => JSON.parse(JSON.stringify(s));
const fmt = (n: number) => n.toLocaleString('en-US');

export class Chudbai {
  private states = new Map<string, GulfState>();
  private names = new Map<string, string>();
  private leases = new Map<number, { key: string; name: string }>();
  private daily = new Map<string, { day: string; gross: number; paid: number }>();
  private locks = new Map<string, Promise<unknown>>();
  private seq = 0;
  private io: Server | null = null;
  private loaded = false;
  constructor(private readonly pool: PoolLike | null, private readonly clock = () => Date.now(),
    private readonly gate: (name: string) => Promise<void> = (n) => requireChudbai(n, GulfError)) {}
  attachIo(io: Server) { this.io = io; }
  async init() {
    if (!this.pool) { this.loaded = true; return; }
    await this.pool.query(CHUDBAI_MIGRATION);
    for (const r of (await this.pool.query('SELECT player_key, name, state FROM chudbai_state')).rows) {
      try { this.states.set(String(r.player_key), JSON.parse(String(r.state)) as GulfState); this.names.set(String(r.player_key), String(r.name)); } catch { /* skip a bad row */ }
    }
    for (const r of (await this.pool.query('SELECT tract, player_key, name FROM chudbai_leases')).rows) this.leases.set(Number(r.tract), { key: String(r.player_key), name: String(r.name) });
    this.loaded = true;
  }
  private lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve(); const p = prev.then(fn, fn); const tail = p.catch(() => {});
    this.locks.set(id, tail); void tail.then(() => { if (this.locks.get(id) === tail) this.locks.delete(id); }); return p;
  }
  private async load(name: string): Promise<GulfState> {
    const k = playerKey(name); let s = this.states.get(k);
    if (!s) {
      const r = this.pool ? (await this.pool.query('SELECT state FROM chudbai_state WHERE player_key = $1', [k])).rows[0] : undefined;
      s = r ? (JSON.parse(String(r.state)) as GulfState) : newGulf(this.clock()); this.states.set(k, s);
    }
    this.names.set(k, name.trim()); gSettle(s, this.clock()); return s;
  }
  private async today(name: string) {
    const k = playerKey(name); const day = utcDay(this.clock()); const c = this.daily.get(k);
    if (c?.day === day) return c;
    const r = this.pool ? (await this.pool.query('SELECT gross, paid FROM chudbai_daily WHERE player_key = $1 AND day = $2', [k, day])).rows[0] : undefined;
    const v = { day, gross: Number(r?.gross ?? 0), paid: Number(r?.paid ?? 0) }; this.daily.set(k, v); return v;
  }
  snapshot(me: string | null): GulfSite {
    const now = this.clock(); const meKey = me ? playerKey(me) : null;
    const site = buildGulfSite(now, Object.fromEntries([...this.leases].map(([n, v]) => [String(n), v])), [...this.states].map(([key, state]) => ({ key, name: this.names.get(key) ?? key, state })));
    for (const L of Object.values(site.leases)) L.mine = !!meKey && L.key === meKey;
    for (const t of site.tracts) if (t.lease) t.lease = { ...t.lease, mine: !!meKey && t.lease.key === meKey };
    return site;
  }
  private emitSite() { try { this.io?.emit('chudbai_site', this.snapshot(null)); } catch (e) { console.error('[chudbai] site emit failed:', (e as Error).message); } }

  /** Mutate a copy, move chips (negative = charge), write state (+ extra SQL) in one transaction. */
  private async commit(name: string, next: GulfState, chips: number, game: string, memo: string, extra?: (cl: Q) => Promise<void>) {
    const k = playerKey(name); const bank = getBank(); const now = this.clock(); this.seq++;
    if (chips < 0 && !bank.canAfford(name, -chips)) throw new GulfError(`Not enough chips: that costs ${fmt(-chips)}.`);
    const w = chips !== 0 ? bank.transferAtomic([{ name, amount: chips, key: `${game}:${k}:${now}:${this.seq}`, game, memo }]) : { stmts: [], after: Promise.resolve(), bind: () => {}, revert: () => {} };
    const run = async () => {
      if (!this.pool) { if (extra) await extra({ query: async () => ({ rows: [] }) }); return; }
      await w.after; const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        await cl.query('INSERT INTO chudbai_state (player_key, name, state, updated_at) VALUES ($1,$2,$3,$4) ON CONFLICT (player_key) DO UPDATE SET name = EXCLUDED.name, state = EXCLUDED.state, updated_at = EXCLUDED.updated_at', [k, name.trim(), JSON.stringify(next), now]);
        if (extra) await extra(cl);
        for (const s of w.stmts) await cl.query(s.sql, s.args);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) { w.revert(); if (e instanceof GulfError) throw e; console.error('[chudbai] write failed:', (e as Error).message); throw new GulfError(/chips|balance/i.test((e as Error).message) ? 'Not enough chips.' : 'That didn’t go through. Nothing was charged.'); }
    this.states.set(k, next);
  }

  async view(name: string | null) {
    const s = name ? await this.load(name) : newGulf(this.clock()); const t = name ? await this.today(name) : { gross: 0, paid: 0 };
    return { gulf: s, now: this.clock(), index: priceIndex(), today: { gross: t.gross, paid: t.paid }, ticket: cityTicketPrice(px(CHUDBAI_TICKET_BASE)), cap: gTankCap(s), demand: gPowerDemand(s), value: px(gulfWorth(s)), site: this.snapshot(name), meKey: name ? playerKey(name) : null };
  }
  async valueOf(name: string): Promise<number> {
    const k = playerKey(name); let s = this.states.get(k);
    if (!s && this.pool) { const r = (await this.pool.query('SELECT state FROM chudbai_state WHERE player_key = $1', [k])).rows[0]; if (r) { s = JSON.parse(String(r.state)) as GulfState; this.states.set(k, s); } }
    if (!s) return 0; gSettle(s, this.clock()); return Math.round(px(gulfWorth(s)));
  }
  async values(): Promise<number> {
    const now = this.clock(); let tot = 0;
    for (const [k, s] of this.states) { if (k.startsWith('qa-')) continue; gSettle(s, now); tot += px(gulfWorth(s)); }
    return Math.round(tot);
  }

  /** Sell at the Chudbai Mercantile Exchange (in person): one product, `qty` or everything ('all'). Daily tiers like Fort McChud's. */
  private async sell(name: string, s: GulfState, b: Record<string, unknown>) {
    const ids: GProduct[] = b.id === 'all' ? (Object.keys(G_PRODUCTS) as GProduct[]).filter((p) => G_PRODUCTS[p].sellable && gWhole(s.stock[p]) > 0) : isGProduct(b.id) ? [b.id] : [];
    if (!ids.length) throw new GulfError(b.id === 'all' ? 'Nothing in your tanks to sell.' : 'Pick something to sell.');
    let gross = 0; const lines: string[] = [];
    for (const id of ids) {
      if (!G_PRODUCTS[id].sellable) throw new GulfError(`${G_PRODUCTS[id].name} can’t be sold; process it first.`);
      const have = gWhole(s.stock[id]); const qty = b.id === 'all' || b.qty === 'all' ? have : Math.floor(Number(b.qty));
      if (!(qty > 0) || qty > have) throw new GulfError('You don’t have that much.');
      s.stock[id] = (s.stock[id] ?? 0) - qty; gross += exchangeGross(id, qty); lines.push(`${qty} ${G_PRODUCTS[id].name}`);
    }
    const k = playerKey(name); const t = await this.today(name); const pay = px(sellPayout(gross, t.gross));
    await this.commit(name, s, pay, 'chudbai_sale', `Chudbai Mercantile Exchange: sold ${lines.join(', ')}`.slice(0, 200), async (cl) => {
      await cl.query('INSERT INTO chudbai_daily (player_key, day, gross, paid) VALUES ($1,$2,$3,$4) ON CONFLICT (player_key, day) DO UPDATE SET gross = chudbai_daily.gross + EXCLUDED.gross, paid = chudbai_daily.paid + EXCLUDED.paid', [k, t.day, gross, pay]);
    });
    t.gross += gross; t.paid += pay;
    return { paid: pay, gross: px(gross) };
  }

  async act(name: string, b: Record<string, unknown>) {
    await this.gate(name);
    const op0 = String(b.op ?? ''); const land = op0 === 'lease' || op0 === 'drill' || op0 === 'esp' || op0 === 'pipe';
    const run = () => this.lock(playerKey(name), async () => {
      const s = clone(await this.load(name)); const op = String(b.op ?? '');
      const tr = () => { const n = Number(b.tract); if (!isGTract(n)) throw new GulfError('Pick a block.'); return n; };
      const own = (n: number) => { const hold = this.leases.get(n); if (!hold) throw new GulfError('Sign that concession first.'); if (hold.key !== playerKey(name)) throw new GulfError(`Only ${hold.name} can build on this block.`); return s.tracts[String(n)] ?? (s.tracts[String(n)] = { leased: true, pipe: 0, wells: [] }); };
      const unitOf = () => { const u = s.units.find((x) => x.id === Number(b.id)); if (!u) throw new GulfError('No such unit.'); return u; };
      let result: unknown = null;
      switch (op) {
        case 'survey': { const n = tr(); if (s.surveyed.includes(n)) throw new GulfError('Already surveyed.'); s.surveyed.push(n); await this.commit(name, s, -px(G_SURVEY_COST), 'chudbai', `Seismic survey: ${gTractInfo(n).name}`); break; }
        case 'lease': {
          const n = tr(); if (!s.surveyed.includes(n)) throw new GulfError('Survey it first.');
          const hold = this.leases.get(n); if (hold) throw new GulfError(hold.key === playerKey(name) ? 'You already hold that concession.' : `${hold.name} already holds this concession.`);
          s.tracts[String(n)] = { leased: true, pipe: 0, wells: [] }; const k = playerKey(name); const now = this.clock();
          await this.commit(name, s, -px(gTractInfo(n).lease), 'chudbai', `Oil concession: ${gTractInfo(n).name}`, async (cl) => {
            try { await cl.query('INSERT INTO chudbai_leases (tract, player_key, name, leased_at) VALUES ($1,$2,$3,$4)', [n, k, name.trim(), now]); }
            catch (e) { if (/unique|duplicate|conflict/i.test((e as Error).message ?? '')) throw new GulfError('Someone already holds this concession.'); throw e; }
          });
          this.leases.set(n, { key: k, name: name.trim() }); break;
        }
        case 'drill': { const n = tr(); const t = own(n); if (t.wells.length >= G_WELLS_PER_TRACT) throw new GulfError(`Max ${G_WELLS_PER_TRACT} wells per block.`); t.wells.push({ esp: false, cond: 100 }); await this.commit(name, s, -px(wellCost(n)), 'chudbai', `${gTractInfo(n).offshore ? 'Offshore platform well' : 'Desert well'} #${t.wells.length}: ${gTractInfo(n).name}`); break; }
        case 'esp': { const n = tr(); const t = own(n); const w = t.wells.find((x) => !x.esp); if (!w) throw new GulfError('Every well here already has an ESP pump.'); w.esp = true; await this.commit(name, s, -px(ESP_COST), 'chudbai', `ESP pump: ${gTractInfo(n).name}`); break; }
        case 'pipe': { const n = tr(); const t = own(n); if (t.pipe >= G_PIPES.length - 1) throw new GulfError('Pipeline is already at max capacity.'); t.pipe++; await this.commit(name, s, -px(G_PIPES[t.pipe]!.cost), 'chudbai', `Pipeline tier ${t.pipe}: ${gTractInfo(n).name}`); break; }
        case 'build': { const kind = b.kind; if (!isGUnitKind(kind)) throw new GulfError('Unknown unit.'); const d = G_UNITS[kind]; if (gUnitCount(s, kind) >= d.max) throw new GulfError(`Max ${d.max} × ${d.name}.`); s.seq++; s.units.push({ id: s.seq, k: kind, cond: 100, on: true }); await this.commit(name, s, -px(d.cost), 'chudbai', `Built ${d.name}`); break; }
        case 'toggle': { const u = unitOf(); u.on = !u.on; await this.commit(name, s, 0, 'chudbai', 'toggle'); break; }
        case 'repair': {
          let cost = 0; const what = b.what;
          for (const u of s.units) if (what === 'all' || u.id === Number(b.id)) { cost += repairCost(G_UNITS[u.k].cost, u.cond); u.cond = 100; }
          if (what === 'all' || what === 'wells') for (const [key, t] of Object.entries(s.tracts)) for (const w of t.wells) { cost += repairCost(wellCost(Number(key)) + (w.esp ? ESP_COST : 0), w.cond); w.cond = 100; }
          cost = px(cost); if (cost <= 0) throw new GulfError('Nothing needs repairs.'); await this.commit(name, s, -cost, 'chudbai_upkeep', 'Chudbai maintenance crew'); break;
        }
        case 'sell': result = await this.sell(name, s, b); break;
        default: throw new GulfError('Unknown action.');
      }
      if (op !== 'sell' && op !== 'toggle') this.emitSite();
      return result;
    });
    return land ? this.lock('__site__', run) : run();
  }
}

let chudbai: Chudbai = new Chudbai(null);
export const getChudbai = () => chudbai;
export function setChudbai(c: Chudbai) { chudbai = c; }
export async function initChudbai(): Promise<void> {
  const url = databaseUrl(); if (!url) return;
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[chudbai] pool error:', e.message));
  try { const c = new Chudbai(pool as unknown as PoolLike); await c.init(); chudbai = c; console.log('[chudbai] ready'); } catch (e) { console.error('[chudbai] init failed:', (e as Error).message); }
}
type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerChudbai(io: Server, socket: Socket): void {
  chudbai.attachIo(io);
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const known = (e: unknown) => e instanceof GulfError || e instanceof TravelError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message);
  socket.on('chudbai_state', async (_b: unknown, ack?: Ack) => {
    if (typeof _b === 'function') ack = _b as Ack;
    try { ack?.({ ok: true, ...(await chudbai.view(nameOf())) }); } catch (e) { ack?.({ ok: false, error: 'Chudbai is offline right now.' }); console.error('[chudbai]', e); }
  });
  socket.on('chudbai_act', async (b: unknown, ack?: Ack) => {
    const n = nameOf();
    try { if (!n) throw new GulfError('Sign in first.'); const result = await chudbai.act(n, (b && typeof b === 'object' ? b : {}) as Record<string, unknown>); ack?.({ ok: true, result, ...(await chudbai.view(n)) }); }
    catch (e) { if (!known(e)) console.error('[chudbai]', e); ack?.({ ok: false, error: known(e) ? (e as Error).message : 'Something went wrong.', ...(n ? await chudbai.view(n).catch(() => ({})) : {}) }); }
  });
}
