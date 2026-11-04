/**
 * Fort McChud oil & gas + Deep Ore Mine (shared/fortmc.ts has the rules and the pure sim).
 * State: one JSON row per player (fortmc_state) + daily sale totals (fortmc_daily). Every chip move is ONE Postgres
 * transaction with the state write (bank.transferAtomic stmts + upsert), so a failed write charges nothing.
 * Ledger games: 'fortmc' (survey, lease, drilling, builds, upgrades, repairs: asset purchases, like mine/factory builds,
 * NOT a sink-room debit), 'fortmc_upkeep' (repairs: pure spend, counted as a sink like property tax) and 'fortmc_sale' (Commodity Exchange payouts). Actions need you to be AT Fort McChud.
 */
import { cityTicketPrice } from './city-rates.js';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { databaseUrl } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { px, priceIndex } from './price-index.js';
import { requireFortMc, TravelError } from './travel.js';
import { mineOreSink, type OreSink } from './employment.js';
import { playerKey } from './skins.js';
import { getLogistics, shipStmt, FreightError, type Shipment } from './logistics.js';
import { MAX_SHIP_QTY, MODES, isMode } from '../shared/logistics.js';
import { saleLogStmt } from './warehouse-log.js';
import { ORES, isOre, type OreId } from '../shared/mines.js';
import {
  FORTMC_TICKET_BASE, MINE_LEVELS, PIPES, PRODUCTS, PUMPJACK_COST, SURVEY_COST, UNITS, WELLS_PER_TRACT, WELL_COST,
  isProduct, isTract, isUnitKind, newFort, repairCost, sellPayout, settle, tractInfo, unitCount, whole, powerDemand, tankCap, fortBuildValue,
  type FortState, type Product,
  unloadHaul,
} from '../shared/fortmc.js';

export class FortError extends Error {}
export const FORTMC_MIGRATION = `
CREATE TABLE IF NOT EXISTS fortmc_state (player_key TEXT PRIMARY KEY, name TEXT NOT NULL, state TEXT NOT NULL, updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS fortmc_daily (player_key TEXT NOT NULL, day TEXT NOT NULL, gross BIGINT NOT NULL DEFAULT 0, paid BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (player_key, day));`;
type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
type PoolLike = Q & { connect: () => Promise<Q & { release: () => void }> };
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const clone = (s: FortState): FortState => JSON.parse(JSON.stringify(s));
const fmt = (n: number) => n.toLocaleString('en-US');

export class FortMc {
  private forts = new Map<string, FortState>();
  private daily = new Map<string, { day: string; gross: number; paid: number }>();
  private locks = new Map<string, Promise<unknown>>();
  private seq = 0;
  constructor(private readonly pool: PoolLike | null, private readonly clock = () => Date.now(),
    private readonly oreSink: (account: string) => OreSink = mineOreSink,
    private readonly gate: (name: string) => Promise<void> = (n) => requireFortMc(n, FortError)) {}
  async init() { if (this.pool) await this.pool.query(FORTMC_MIGRATION); }

  private lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve(); const p = prev.then(fn, fn); const tail = p.catch(() => {});
    this.locks.set(id, tail); void tail.then(() => { if (this.locks.get(id) === tail) this.locks.delete(id); }); return p;
  }
  private async load(name: string): Promise<FortState> {
    const k = playerKey(name); let s = this.forts.get(k);
    if (!s) {
      const r = this.pool ? (await this.pool.query('SELECT state FROM fortmc_state WHERE player_key = $1', [k])).rows[0] : undefined;
      s = r ? (JSON.parse(String(r.state)) as FortState) : newFort(this.clock()); this.forts.set(k, s);
    }
    settle(s, this.clock()); return s;
  }
  private async today(name: string) {
    const k = playerKey(name); const day = utcDay(this.clock()); const c = this.daily.get(k);
    if (c?.day === day) return c;
    const r = this.pool ? (await this.pool.query('SELECT gross, paid FROM fortmc_daily WHERE player_key = $1 AND day = $2', [k, day])).rows[0] : undefined;
    const v = { day, gross: Number(r?.gross ?? 0), paid: Number(r?.paid ?? 0) }; this.daily.set(k, v); return v;
  }

  /** Mutate a copy, move chips (negative = charge), write state (+ extra SQL) in one transaction, then publish. */
  private async commit(name: string, next: FortState, chips: number, game: string, memo: string, extra?: (cl: Q) => Promise<void>) {
    const k = playerKey(name); const bank = getBank(); const now = this.clock(); this.seq++;
    if (chips < 0 && !bank.canAfford(name, -chips)) throw new FortError(`Not enough chips: that costs ${fmt(-chips)}.`);
    const w = chips !== 0 ? bank.transferAtomic([{ name, amount: chips, key: `${game}:${k}:${now}:${this.seq}`, game, memo }]) : { stmts: [], after: Promise.resolve(), bind: () => {}, revert: () => {} };
    const run = async () => {
      if (!this.pool) { if (extra) await extra({ query: async () => ({ rows: [] }) }); return; }
      await w.after; const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        await cl.query('INSERT INTO fortmc_state (player_key, name, state, updated_at) VALUES ($1,$2,$3,$4) ON CONFLICT (player_key) DO UPDATE SET name = EXCLUDED.name, state = EXCLUDED.state, updated_at = EXCLUDED.updated_at', [k, name.trim(), JSON.stringify(next), now]);
        if (extra) await extra(cl);
        for (const s of w.stmts) await cl.query(s.sql, s.args);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) { w.revert(); if (e instanceof FortError) throw e; console.error('[fortmc] write failed:', (e as Error).message); throw new FortError(/chips|balance/i.test((e as Error).message) ? 'Not enough chips.' : 'That didn’t go through. Nothing was charged.'); }
    this.forts.set(k, next);
  }

  /** Walk-in Fort McChud Mine bin (server/warehouse.ts wires it): read the banked haul / guarded take statements. */
  haul: { read: (name: string) => Promise<Map<string, number>>; take: (name: string, items: Array<[string, number]>) => Array<{ sql: string; args: unknown[] }> } | null = null;
  async view(name: string | null) {
    const s = name ? await this.load(name) : newFort(this.clock()); const t = name ? await this.today(name) : { gross: 0, paid: 0 };
    return { fort: s, now: this.clock(), index: priceIndex(), today: { gross: t.gross, paid: t.paid }, ticket: cityTicketPrice(px(FORTMC_TICKET_BASE)), cap: tankCap(s), demand: powerDemand(s), value: px(fortBuildValue(s)), haul: name && this.haul ? Object.fromEntries(await this.haul.read(name).catch(() => new Map<string, number>())) : {} };
  }

  /** Every paid / state-changing action. */
  /**
   * Ship & sell: load `qty` of one product/ore from the fort's tanks/bin onto a truck (own = free, hired/plane/ship = fee,
   * ledger 'freight') bound for the Chud City Warehouse, where it sells on arrival (sellDelivered). Goods leave the fort,
   * the fee is debited and the shipment row is written in ONE transaction. `auto` = dispatched by the auto-sell sweep.
   */
  private async shipSellIn(name: string, s: FortState, b: Record<string, unknown>, auto: boolean) {
    const id = b.id; const qty = Math.floor(Number(b.qty));
    let type: 'fort' | 'ore';
    if (isProduct(id)) { if (!PRODUCTS[id].sellable) throw new FortError(`${PRODUCTS[id].name} can’t be sold; process it first.`); type = 'fort'; if (!(qty > 0) || qty > whole(s.stock[id])) throw new FortError('You don’t have that much.'); s.stock[id] = (s.stock[id] ?? 0) - qty; }
    else if (isOre(id)) { type = 'ore'; if (!(qty > 0) || qty > whole(s.ore[id])) throw new FortError('You don’t have that much.'); s.ore[id] = (s.ore[id] ?? 0) - qty; }
    else throw new FortError('Pick something to ship.');
    const lg = getLogistics(); if (!lg) throw new FortError('Freight is offline right now.');
    let sh: Shipment; try { sh = lg.planSell(name, { mode: b.mode, from: 'fortmc', type, id: String(id), qty, src: 'fortmc', auto }); } catch (e) { if (e instanceof FreightError) throw new FortError(e.message); throw e; }
    const label = type === 'fort' ? PRODUCTS[id as Product].name : ORES[id as OreId].name;
    await this.commit(name, s, -sh.fee, 'freight', `${auto ? 'Auto-sell' : 'Ship & sell'}: ${qty} ${label} Fort McChud → Chud City Warehouse`, async (cl) => { const st = shipStmt(sh); await cl.query(st.sql, st.args); });
    lg.admit(sh); return { shipment: sh.id, mode: sh.mode, fee: sh.fee, arriveAt: sh.arriveAt };
  }
  /**
   * Ship ore + petcoke (as coal) to your factory storage in Chud City. Like all freight it rides a truck: your idle
   * truck(s) (free) or hired rigs / plane / ship (fee, ledger 'freight'), one load per ore up to the vehicle's capacity.
   * Goods leave the fort, the fee is debited and every shipment row is written in ONE transaction; the ore lands in
   * factory storage when the truck arrives (factoryDelivered). Room counts loads already on the road.
   */
  private async shipFactoryIn(name: string, s: FortState, b: Record<string, unknown>) {
    const lg = getLogistics(); if (!lg) throw new FortError('Freight is offline right now.');
    const mode = b.mode ?? (lg.idleTruck(name) ? 'truck' : 'hired'); if (!isMode(mode)) throw new FortError('Pick how to ship it.');
    const sink = this.oreSink(name); const road = lg.pending(name, 'factory');
    const room = (id: OreId) => Math.max(0, (sink.room?.(id) ?? Infinity) - (road.get(id) ?? 0));
    const want: Array<[OreId, number]> = [];
    for (const id of Object.keys(s.ore) as OreId[]) { const n = Math.min(whole(s.ore[id]), room(id)); if (n > 0) want.push([id, n]); }
    const cokeRoom = room('coal') - (want.find((x) => x[0] === 'coal')?.[1] ?? 0); const coke = Math.max(0, Math.min(whole(s.stock.petcoke), cokeRoom));
    if (coke > 0) { const c = want.find((x) => x[0] === 'coal'); if (c) c[1] += coke; else want.push(['coal', coke]); }
    if (!want.length) throw new FortError('Nothing to ship (or your factory storage is full).');
    const loads: Shipment[] = []; const skip = new Set<string>(); let stop: Error | null = null;
    for (const [id, total] of want) {
      let left = total;
      while (left > 0 && !stop) {
        const cap = mode === 'truck' ? (lg.idleTruck(name, skip)?.cap ?? 0) : MODES[mode].cap;
        if (cap <= 0) { stop = new FortError(lg.owned(name).length ? 'All your trucks are out on deliveries. Hire one, or wait.' : 'You do not own a truck. Buy one at the truck store, or hire one for a fee.'); break; }
        try { const sh = lg.planSell(name, { mode, from: 'fortmc', type: 'ore', id, qty: Math.min(left, cap, MAX_SHIP_QTY), src: 'fortmc', kind: 'factory', skip }); loads.push(sh); if (sh.truck) skip.add(sh.truck); left -= sh.qty; }
        catch (e) { stop = e instanceof FreightError ? new FortError(e.message) : (e as Error); }
      }
      if (stop) break;
    }
    if (!loads.length) throw stop ?? new FortError('Nothing to ship.');
    const sent = new Map<OreId, number>(); for (const l of loads) sent.set(l.itemId as OreId, (sent.get(l.itemId as OreId) ?? 0) + l.qty);
    let petcoke = 0;
    for (const [id, n] of sent) { const fromOre = Math.min(n, whole(s.ore[id])); s.ore[id] = (s.ore[id] ?? 0) - fromOre; if (id === 'coal' && n > fromOre) { petcoke = n - fromOre; s.stock.petcoke = (s.stock.petcoke ?? 0) - petcoke; } }
    const fee = loads.reduce((a, l) => a + l.fee, 0);
    const what = [...sent].map(([id, n]) => `${n} ${ORES[id].name}`).join(', ');
    await this.commit(name, s, -fee, 'freight', `Fort McChud → your factory: ${what}`.slice(0, 200), async (cl) => { for (const l of loads) { const st = shipStmt(l); await cl.query(st.sql, st.args); } });
    for (const l of loads) lg.admit(l);
    return { shipped: [...sent], petcoke, loads: loads.length, mode, fee, arriveAt: Math.max(...loads.map((l) => l.arriveAt)), partial: stop ? stop.message : null };
  }
  private delivered = new Set<string>();
  /** A Fort McChud → factory load arrived: add it to factory storage exactly once (shipment row flips transit→delivered in the same transaction). */
  async factoryDelivered(sh: Shipment): Promise<void> {
    if (!isOre(sh.itemId)) throw new FortError('Not an ore.');
    const id = sh.itemId; const items: Array<[OreId, number]> = [[id, sh.qty]];
    return this.lock(playerKey(sh.ownerName), async () => {
      if (this.delivered.has(sh.id)) return;
      const sink = this.oreSink(sh.ownerName);
      if (!this.pool) { await sink.write({ query: async () => ({ rows: [] }) } as unknown as Q, items); sink.after(items); this.delivered.add(sh.id); return; }
      const cl = await this.pool.connect(); let fresh = false;
      try {
        await cl.query('BEGIN');
        const u = await cl.query("UPDATE freight_shipments SET status = 'delivered' WHERE id = $1 AND status = 'transit'", [sh.id]) as { rowCount?: number | null };
        fresh = (u.rowCount ?? 0) === 1;
        if (fresh) await sink.write(cl, items);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
      if (fresh) sink.after(items); this.delivered.add(sh.id);
    });
  }
  /** Auto-sell sweep entry (no travel gate: the trucks go without you). */
  async autoShip(name: string, id: string, qty: number, mode: string) {
    return this.lock(playerKey(name), async () => { const s = clone(await this.load(name)); return this.shipSellIn(name, s, { id, qty, mode }, true); });
  }
  /** Fort inventory snapshot (whole units) for the warehouse / auto-sell. */
  async inventory(name: string) { const s = await this.load(name); return { stock: s.stock, ore: s.ore, units: s.units }; }
  /**
   * A ship-&-sell load of fort products reached the Chud City Warehouse: pay it at the Commodity Exchange tiers
   * (fortmc_daily), ledger 'fortmc_sale' keyed by the shipment id (idempotent), log it and mark the shipment delivered.
   */
  async sellDelivered(sh: Shipment): Promise<number> {
    if (!isProduct(sh.itemId)) throw new FortError('Not a fort product.');
    const name = sh.ownerName; const k = playerKey(name); const gross = Math.floor(sh.qty * PRODUCTS[sh.itemId].price);
    return this.lock(k, async () => {
      const t = await this.today(name); const pay = px(sellPayout(gross, t.gross)); const day = t.day;
      const bank = getBank(); let w;
      try { w = bank.transferAtomic([{ name, amount: pay, key: `whsale:${sh.id}`, game: 'fortmc_sale', memo: `Chud City Warehouse: sold ${sh.qty} ${PRODUCTS[sh.itemId as Product].name} from Fort McChud`.slice(0, 200) }]); }
      catch (e) { if ((e as Error).message === 'Already applied.') return 0; throw e; }
      const rows = [
        { sql: 'INSERT INTO fortmc_daily (player_key, day, gross, paid) VALUES ($1,$2,$3,$4) ON CONFLICT (player_key, day) DO UPDATE SET gross = fortmc_daily.gross + EXCLUDED.gross, paid = fortmc_daily.paid + EXCLUDED.paid', args: [k, day, gross, pay] },
        saleLogStmt(sh, 'sold', pay, null), shipStmt({ ...sh, status: 'delivered' }), ...w.stmts,
      ];
      const run = async () => {
        if (!this.pool) return; await w.after; const cl = await this.pool.connect();
        try { await cl.query('BEGIN'); for (const r of rows) await cl.query(r.sql, r.args); await cl.query('COMMIT'); }
        catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
      };
      const p = run(); w.bind(p);
      try { await p; } catch (e) { w.revert(); throw e; }
      t.gross += gross; t.paid += pay; return pay;
    });
  }

  async act(name: string, b: Record<string, unknown>) {
    await this.gate(name);
    return this.lock(playerKey(name), async () => {
      const cur = await this.load(name); const s = clone(cur); const op = String(b.op ?? '');
      const tr = () => { const n = Number(b.tract); if (!isTract(n)) throw new FortError('Pick a tract.'); return n; };
      const tractOf = (n: number) => { const t = s.tracts[String(n)]; if (!t?.leased) throw new FortError('Lease that tract first.'); return t; };
      const unitOf = () => { const u = s.units.find((x) => x.id === Number(b.id)); if (!u) throw new FortError('No such unit.'); return u; };
      switch (op) {
        case 'survey': { const n = tr(); if (s.surveyed.includes(n)) throw new FortError('Already surveyed.'); s.surveyed.push(n); await this.commit(name, s, -px(SURVEY_COST), 'fortmc', `Seismic survey: ${tractInfo(n).name}`); break; }
        case 'lease': { const n = tr(); if (!s.surveyed.includes(n)) throw new FortError('Survey it first.'); if (s.tracts[String(n)]?.leased) throw new FortError('You already hold that lease.'); s.tracts[String(n)] = { leased: true, pipe: 0, wells: [] }; await this.commit(name, s, -px(tractInfo(n).lease), 'fortmc', `Mineral lease: ${tractInfo(n).name}`); break; }
        case 'drill': { const n = tr(); const t = tractOf(n); if (t.wells.length >= WELLS_PER_TRACT) throw new FortError(`Max ${WELLS_PER_TRACT} wells per tract.`); t.wells.push({ jack: false, cond: 100 }); await this.commit(name, s, -px(WELL_COST), 'fortmc', `Drilled well #${t.wells.length}: ${tractInfo(n).name}`); break; }
        case 'pumpjack': { const n = tr(); const t = tractOf(n); const w = t.wells.find((x) => !x.jack); if (!w) throw new FortError('Every well here already has a pumpjack.'); w.jack = true; await this.commit(name, s, -px(PUMPJACK_COST), 'fortmc', `Pumpjack: ${tractInfo(n).name}`); break; }
        case 'pipe': { const n = tr(); const t = tractOf(n); if (t.pipe >= PIPES.length - 1) throw new FortError('Pipeline is already at max capacity.'); t.pipe++; await this.commit(name, s, -px(PIPES[t.pipe]!.cost), 'fortmc', `Pipeline tier ${t.pipe}: ${tractInfo(n).name}`); break; }
        case 'build': { const k = b.kind; if (!isUnitKind(k)) throw new FortError('Unknown unit.'); const d = UNITS[k]; if (unitCount(s, k) >= d.max) throw new FortError(`Max ${d.max} × ${d.name}.`); s.seq++; s.units.push({ id: s.seq, k, cond: 100, on: true }); await this.commit(name, s, -px(d.cost), 'fortmc', `Built ${d.name}`); break; }
        case 'toggle': { const u = unitOf(); u.on = !u.on; await this.commit(name, s, 0, 'fortmc', 'toggle'); break; }
        case 'repair': {
          let cost = 0; const what = b.what;
          for (const u of s.units) if (what === 'all' || u.id === Number(b.id)) { cost += repairCost(UNITS[u.k].cost, u.cond); u.cond = 100; }
          for (const t of Object.values(s.tracts)) for (const w of t.wells) if (what === 'all' || what === 'wells') { cost += repairCost(WELL_COST + (w.jack ? PUMPJACK_COST : 0), w.cond); w.cond = 100; }
          if (s.mine && (what === 'all' || what === 'mine')) { cost += repairCost(MINE_LEVELS[s.mine.level - 1]!.cost, s.mine.cond); s.mine.cond = 100; }
          cost = px(cost); if (cost <= 0) throw new FortError('Nothing needs repairs.'); await this.commit(name, s, -cost, 'fortmc_upkeep', 'Maintenance crew'); break;
        }
        case 'mine': {
          const lv = (s.mine?.level ?? 0) + 1; if (lv > MINE_LEVELS.length) throw new FortError('The mine is fully expanded.');
          s.mine = { level: lv, cond: 100, on: true }; await this.commit(name, s, -px(MINE_LEVELS[lv - 1]!.cost), 'fortmc', lv === 1 ? 'Built the Deep Ore Mine' : `Deep Ore Mine level ${lv}`); break;
        }
        case 'unload': {
          if (!this.haul) throw new FortError('The mine lift is offline right now.');
          const have = await this.haul.read(name); const took = unloadHaul(s, have);
          if (!took.length) throw new FortError('Nothing to unload: dig in the Fort McChud Mine and bank your haul at the lift.');
          const take = this.haul.take(name, took);
          await this.commit(name, s, 0, 'fortmc', 'Unloaded mine haul', async (cl) => { for (const st of take) { const r = await cl.query(st.sql, st.args); if (!r.rowCount) throw new FortError('Your haul changed. Try again.'); } });
          break;
        }
        case 'mine_toggle': { if (!s.mine) throw new FortError('Build the mine first.'); s.mine.on = !s.mine.on; await this.commit(name, s, 0, 'fortmc', 'toggle'); break; }
        // Millionaire Update: no selling at the fort. Everything sells at the Chud City Warehouse: ship it there.
        case 'sell': throw new FortError('Fort McChud has no market. Use Ship & sell: your goods go by truck to the Chud City Warehouse and sell when they arrive.');
        case 'ship_sell': return this.shipSellIn(name, s, b, false);
        case 'ship': return this.shipFactoryIn(name, s, b);
        default: throw new FortError('Unknown action.');
      }
      return null;
    });
  }
}

let fort: FortMc = new FortMc(null);
export const getFortMc = () => fort;
export function setFortMc(f: FortMc) { fort = f; }
export async function initFortMc(): Promise<void> {
  const url = databaseUrl(); if (!url) return;
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[fortmc] pool error:', e.message));
  try { const f = new FortMc(pool as unknown as PoolLike); await f.init(); fort = f; console.log('[fortmc] ready'); } catch (e) { console.error('[fortmc] init failed:', (e as Error).message); }
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerFortMc(_io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const known = (e: unknown) => e instanceof FortError || e instanceof TravelError || /^(Not enough chips\.|Wallet temporarily unavailable\.|Your mine storage is full.*|The mines are .*)$/.test((e as Error).message);
  socket.on('fort_state', async (_b: unknown, ack?: Ack) => {
    if (typeof _b === 'function') ack = _b as Ack;
    try { ack?.({ ok: true, ...(await fort.view(nameOf())) }); } catch (e) { ack?.({ ok: false, error: 'Fort McChud is offline right now.' }); console.error('[fortmc]', e); }
  });
  socket.on('fort_act', async (b: unknown, ack?: Ack) => {
    const n = nameOf();
    try { if (!n) throw new FortError('Sign in first.'); const result = await fort.act(n, (b && typeof b === 'object' ? b : {}) as Record<string, unknown>); ack?.({ ok: true, result, ...(await fort.view(n)) }); }
    catch (e) { if (!known(e)) console.error('[fortmc]', e); ack?.({ ok: false, error: known(e) ? (e as Error).message : 'Something went wrong.', ...(n ? await fort.view(n).catch(() => ({})) : {}) }); }
  });
}
export type { Product };
