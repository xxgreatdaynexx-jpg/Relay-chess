import { invReady } from './invFence.js';
import { isMillionairePrelaunch } from '../shared/millionairePrelaunch.js';
/**
 * Building inventories, ship-to-sell and auto-sell (rules: shared/autosell.ts).
 *
 * Storage
 *  - Fort McChud: its own tank farm + ore bin (fortmc_state.stock/.ore), unchanged.
 *  - Coral Grotto + Resort plantation barn: `building_inv` rows (player, building, 'type:id', qty).
 *  - Chud City Warehouse: the existing banked storage (mine_items / Mines packs). It IS the market.
 * Migration (additive, no data moved): existing global storage already sits in the Chud City Warehouse landmark, so it
 * stays as Warehouse inventory; existing fort stock stays in the fort. Only NEW coral hauls / resort harvests use bins.
 *
 * Selling: a building load is shipped with Logistics.planSell (fee ledger 'freight', goods + fee + shipment row in ONE
 * transaction); on arrival Logistics.tick calls onSell -> fort products: FortMc.sellDelivered, crops: Farm.sellShipped,
 * ore/gems/bars: land in the Warehouse and sell there through Mines.sell (house tiers). Every load writes warehouse_sales.
 */
import { fortSellPrice, houseSellPrice } from '../shared/sellBuff.js';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { databaseUrl } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { getMines } from './mines.js';
import { getLocStore, mustOne } from './locstock.js';
import { getLocMoves } from './locmoves.js';
import { WAREHOUSE } from '../shared/inventoryLocations.js';
import { getFarm } from './farm.js';
import { getFortMc } from './fortmc.js';
import { emitHaul } from './haulVisual.js';
import { priceIndex } from './price-index.js';
import { getLogistics, shipStmt, FreightError, type Shipment } from './logistics.js';
import { isAtFortMc, isAtResort, requireResort } from './travel.js';
import { playerKey } from './skins.js';
import { WAREHOUSE_MIGRATION, binAddStmt, saleLogStmt } from './warehouse-log.js';
import { AUTO_DEFAULT, AUTO_SWEEP_MS, BUILDINGS, MAX_RESERVE, autoCarrier, autoQty, isBuilding, splitKey, type AutoCfg, type BuildingId, type SaleLogRow } from '../shared/autosell.js';
import { MODES } from '../shared/logistics.js';
import { PRODUCTS, UNITS, isProduct, whole } from '../shared/fortmc.js';
import { ORES, RECIPES, isOre, nameOf, priceOf, type ItemType } from '../shared/mines.js';
import { FRECIPES } from '../shared/factory.js';
import { RECIPES as COOK } from '../shared/cooking.js';
import { cropById } from '../shared/farm.js';

export class WarehouseError extends Error {}
type Stmt = { sql: string; args: unknown[] };
type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
type PoolLike = Q & { connect: () => Promise<Q & { release: () => void }> };
const BIN_BUILDINGS: BuildingId[] = ['coral']; // truck logistics: resort plots keep their own stock (farm:rf:<n>); the old pooled barn is migrated

/** Is `type:id` an input of any recipe a player can run (mines furnace/workbench, Factory v2 machines, the kitchen)? */
export function recipeNeeds(type: string, id: string): boolean {
  const k = `${type}:${id}`;
  if (RECIPES.some((r) => r.in.some((x) => x.type === type && x.id === id))) return true;
  if (FRECIPES.some((r) => r.in.some(([x]) => x === k || (type === 'crop' && x === `food:crop_${id}`) || x.endsWith(`:crop_${id}`)))) return true;
  if (type === 'crop' && COOK.some((r) => id in r.ings)) return true;
  return false;
}

export class Warehouse {
  private mem = new Map<string, Map<string, number>>(); // no-DB mode: `${player}|${building}` -> item -> qty
  private cfgMem = new Map<string, Map<string, AutoCfg & { name: string }>>(); // player -> `${building}|${item}`
  private logMem: SaleLogRow[] = [];
  private locks = new Map<string, Promise<unknown>>();
  constructor(private readonly pool: PoolLike | null, private readonly clock = () => Date.now()) {}
  async init() { if (this.pool) await this.pool.query(WAREHOUSE_MIGRATION); this.wire(); }
  private lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve(); const p = prev.then(fn, fn); const tail = p.catch(() => {});
    this.locks.set(id, tail); void tail.then(() => { if (this.locks.get(id) === tail) this.locks.delete(id); }); return p;
  }
  private async tx(rows: Stmt[], check?: (cl: Q) => Promise<void>) {
    if (!this.pool) return; const cl = await this.pool.connect();
    try { await cl.query('BEGIN'); if (check) await check(cl); for (const r of rows) await cl.query(r.sql, r.args); await cl.query('COMMIT'); }
    catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
  }

  /** Hook the producers + freight into the warehouse (idempotent; services may attach after boot retries). */
  wire() {
    const mines = getMines(); if (!mines.coralBin) mines.coralBin = (acct, stacks) => this.binRows(acct, 'coral', stacks.map((s) => [`${s.type}:${s.id}`, s.qty]));
    if (!mines.fortBin) mines.fortBin = (acct, stacks) => this.binRows(acct, 'fortmc', stacks.map((s) => [`${s.type}:${s.id}`, s.qty]));
    const fm = getFortMc(); if (!fm.haul) fm.haul = { read: (name) => this.bin(name, 'fortmc'), take: (name, items) => this.binTake(name, 'fortmc', items) };
    const lg = getLogistics(); if (lg && !lg.onSell) lg.onSell = (s) => this.arrived(s);
    if (lg && !lg.onFactory) lg.onFactory = (s) => getFortMc().factoryDelivered(s);
  }
  /** Rows that add to a bin in the producer's own transaction (or, with no DB, add in memory now). */
  binRows(name: string, b: BuildingId, items: Array<[string, number]>): Stmt[] {
    const k = playerKey(name);
    if (!this.pool) { const m = this.binMem(k, b); for (const [i, n] of items) m.set(i, (m.get(i) ?? 0) + n); return []; }
    return items.filter(([, n]) => n > 0).map(([i, n]) => binAddStmt(k, name.trim(), b, i, n));
  }
  /** Guarded decrements for a bin (never below 0; the caller checks rowCount), or with no DB, take from memory now. */
  binTake(name: string, b: BuildingId, items: Array<[string, number]>): Stmt[] {
    const k = playerKey(name);
    if (!this.pool) { const m = this.binMem(k, b); for (const [i, n] of items) m.set(i, Math.max(0, (m.get(i) ?? 0) - n)); return []; }
    return items.map(([i, n]) => ({ sql: 'UPDATE building_inv SET qty = qty - $4 WHERE player_key = $1 AND building = $2 AND item = $3 AND qty >= $4', args: [k, b, i, n] }));
  }
  private binMem(k: string, b: BuildingId) { const key = `${k}|${b}`; let m = this.mem.get(key); if (!m) { m = new Map(); this.mem.set(key, m); } return m; }
  async bin(name: string, b: BuildingId): Promise<Map<string, number>> {
    const k = playerKey(name);
    if (!this.pool) return new Map(this.binMem(k, b));
    const r = await this.pool.query('SELECT item, qty FROM building_inv WHERE player_key = $1 AND building = $2 AND qty > 0', [k, b]);
    return new Map(r.rows.map((x) => [String(x.item), Number(x.qty)]));
  }
  /** One building's inventory as rows: key, label, qty, unit value. */
  async inventory(name: string, b: BuildingId): Promise<Array<{ key: string; label: string; qty: number; unit: number; needed: boolean }>> {
    if (b === 'farm') return [];
    if (b === 'fortmc') {
      const f = await getFortMc().inventory(name); const out: Array<{ key: string; label: string; qty: number; unit: number; needed: boolean }> = [];
      for (const [id, q] of Object.entries(f.stock)) if (isProduct(id) && PRODUCTS[id].sellable && whole(q) > 0) out.push({ key: `fort:${id}`, label: PRODUCTS[id].name, qty: whole(q), unit: fortSellPrice(id), needed: f.units.some((u) => u.on && (UNITS[u.k].input === id || UNITS[u.k].alt === id)) });
      for (const [id, q] of Object.entries(f.ore)) if (isOre(id) && whole(q) > 0) out.push({ key: `ore:${id}`, label: ORES[id].name, qty: whole(q), unit: ORES[id].price, needed: recipeNeeds('ore', id) });
      return out;
    }
    return [...(await this.bin(name, b))].map(([key, qty]) => { const [t, id] = splitKey(key); return { key, qty, ...this.describe(t, id) }; });
  }
  private describe(t: string, id: string) {
    if (t === 'crop') { const c = cropById(id); return { label: c?.label ?? id, unit: c?.sell ?? 0, needed: recipeNeeds('crop', id) }; }
    return { label: nameOf({ type: t as ItemType, id }), unit: houseSellPrice({ type: t, id }), needed: recipeNeeds(t, id) };
  }

  /**
   * Ship & sell from a bin (Coral Grotto / Resort barn): the bin row is decremented (guarded: never below 0), the freight
   * fee debited (ledger 'freight') and the shipment written in ONE transaction; then the truck is on the map.
   */
  async shipSell(name: string, b: BuildingId, item: string, qty: number, mode: unknown, auto = false) {
    if (b === 'fortmc') {
      const [, id] = splitKey(item); const f = getFortMc();
      const p = auto ? f.autoShip(name, id, qty, String(mode)) : f.act(name, { op: 'ship_sell', id, qty, mode }) as Promise<{ shipment: string; mode: string; fee: number; arriveAt: number }>;
      return p.catch((e) => { throw new WarehouseError((e as Error).message); });
    }
    if (!BIN_BUILDINGS.includes(b)) throw new WarehouseError('City goods are already in your Chud City Warehouse stock: sell or list them there.');
    const k = playerKey(name);
    return this.lock(k, async () => {
      if (!Number.isInteger(qty) || qty < 1) throw new WarehouseError('Pick a quantity.');
      const have = (await this.bin(name, b)).get(item) ?? 0; if (qty > have) throw new WarehouseError('You don’t have that much there.');
      const lg = getLogistics(); if (!lg) throw new WarehouseError('Freight is offline right now.');
      const [t, id] = splitKey(item);
      let sh: Shipment; try { sh = lg.planSell(name, { mode, from: BUILDINGS[b].hub, type: t, id, qty, src: b, auto }); } catch (e) { if (e instanceof FreightError) throw new WarehouseError(e.message); throw e; }
      const bank = getBank(); const label = this.describe(t, id).label;
      const w = sh.fee > 0 ? bank.transferAtomic([{ name, amount: -sh.fee, key: `freight:sell:${sh.id}`, game: 'freight', memo: `${auto ? 'Auto-sell' : 'Ship & sell'}: ${qty} ${label} ${BUILDINGS[b].label} → Chud City Warehouse` }]) : null;
      const take: Stmt = { sql: 'UPDATE building_inv SET qty = qty - $4 WHERE player_key = $1 AND building = $2 AND item = $3 AND qty >= $4', args: [k, b, item, qty] };
      const p = (async () => { await w?.after; await this.tx([shipStmt(sh), ...(w?.stmts ?? [])], async (cl) => { const r = await cl.query(take.sql, take.args); if (!r.rowCount) throw new WarehouseError('You don’t have that much there.'); }); })();
      w?.bind(p);
      try { await p; } catch (e) { w?.revert(); if (e instanceof WarehouseError) throw e; throw new WarehouseError(/chips|balance|null value/i.test((e as Error).message) ? 'Not enough chips for the freight fee.' : 'That didn’t go through. Nothing was charged.'); }
      if (!this.pool) { const m = this.binMem(k, b); const n = (m.get(item) ?? 0) - qty; if (n > 0) m.set(item, n); else m.delete(item); }
      lg.admit(sh); return { shipment: sh.id, mode: sh.mode, fee: sh.fee, arriveAt: sh.arriveAt };
    });
  }

  /** A ship-&-sell load reached the Chud City Warehouse (called by Logistics.tick; rejection = retried next tick). */
  async arrived(s: Shipment): Promise<void> {
    const now = this.clock(); const delivered = shipStmt({ ...s, status: 'delivered' });
    let row: SaleLogRow;
    if (s.type === ('fort' as ItemType)) {
      const paid = await getFortMc().sellDelivered(s); row = this.row(s, 'sold', paid, null, now);
      if (paid > 0) { try { emitHaul({ name: s.ownerName, from: 'warehouse', to: 'market', kind: 'warehouse', background: !!s.auto }); } catch { /* visual */ } }
    } else if (s.type === ('crop' as ItemType)) {
      const farm = getFarm(); if (!farm) throw new Error('farm offline');
      const paid = await farm.sellShipped(s, [saleLogStmt(s, 'sold', 0, null, now), delivered], 'the Resort plantation', 'all'); /* legacy in-flight barn load: keeps its baseline sale XP */ row = this.row(s, 'sold', paid, null, now);
      if (paid > 0) { try { emitHaul({ name: s.ownerName, from: 'warehouse', to: 'market', kind: 'warehouse', background: !!s.auto }); } catch { /* visual */ } }
    } else {
      // Ore / gems / bars land AT the Chud City Warehouse (loc_stock 'warehouse', exactly once with the delivered flip)
      // and sell there at the house price; whatever the daily tier can't take stays in your Warehouse stock.
      const ls = getLocStore(); const item = `${s.type}:${s.itemId}`;
      const flip = mustOne("UPDATE freight_shipments SET status = 'delivered' WHERE id = $1 AND status = 'transit'", [s.id]);
      const r = ls.adjust(s.ownerName, [{ loc: WAREHOUSE, item, delta: s.qty }], [saleLogStmt(s, 'stored', 0, 'Landed in the Warehouse', now), flip]);
      if (r === false) throw new Error('could not store');
      try { await r; } catch (e) {
        const st = this.pool ? (await this.pool.query('SELECT status FROM freight_shipments WHERE id = $1', [s.id])).rows[0]?.status : null;
        if (st === 'delivered') return; throw e;
      }
      let paid = 0; let note: string | null = null;
      try { paid = Number((await getLocMoves().sell(s.ownerName, { item, qty: s.qty }) as { paid?: number }).paid ?? 0); }
      catch (e) { note = `Kept in your Warehouse: ${(e as Error).message}`; }
      row = this.row(s, paid > 0 ? 'sold' : 'stored', paid, note, now);
      if (paid > 0 || note) await this.tx([saleLogStmt(s, row.status, paid, note, now)]).catch((e) => console.error('[warehouse] log failed:', (e as Error).message));
    }
    this.logMem.unshift(row); this.logMem.length = Math.min(this.logMem.length, 200);
    this.onSale?.(row, s);
  }
  onSale: ((r: SaleLogRow, s: Shipment) => void) | null = null;
  private row(s: Shipment, status: 'sold' | 'stored', paid: number, note: string | null, at: number): SaleLogRow {
    return { id: s.id, building: (s.src ?? s.from) as BuildingId, type: s.type as SaleLogRow['type'], item: s.itemId, qty: s.qty, fee: s.fee, paid, auto: !!s.auto, status, note, at };
  }
  async log(name: string): Promise<SaleLogRow[]> {
    const k = playerKey(name);
    if (!this.pool) return this.logMem.filter((r) => this.logOwner.get(r.id) === k || !this.logOwner.size).slice(0, 40);
    const r = await this.pool.query('SELECT * FROM warehouse_sales WHERE player_key = $1 ORDER BY at DESC LIMIT 40', [k]);
    return r.rows.map((x) => ({ id: String(x.id), building: String(x.building) as BuildingId, type: String(x.item_type) as SaleLogRow['type'], item: String(x.item_id), qty: Number(x.qty), fee: Number(x.fee), paid: Number(x.paid), auto: x.auto === true, status: String(x.status) as 'sold' | 'stored', note: x.note == null ? null : String(x.note), at: Number(x.at) }));
  }
  private logOwner = new Map<string, string>();

  // ---- auto-sell settings ----
  async cfgs(name: string): Promise<Map<string, AutoCfg>> {
    const k = playerKey(name);
    if (!this.pool) return new Map([...(this.cfgMem.get(k) ?? new Map())].map(([i, c]) => [i, { on: c.on, reserve: c.reserve, keepRecipe: c.keepRecipe }]));
    const r = await this.pool.query('SELECT building, item, on_, reserve, keep_recipe FROM autosell_cfg WHERE player_key = $1', [k]);
    return new Map(r.rows.map((x) => [`${x.building}|${x.item}`, { on: x.on_ === true, reserve: Number(x.reserve), keepRecipe: x.keep_recipe === true }]));
  }
  async setCfg(name: string, b: unknown, item: unknown, c: Partial<Record<keyof AutoCfg, unknown>>) {
    if (!isBuilding(b)) throw new WarehouseError('Unknown building.');
    if (typeof item !== 'string' || !/^((fort|ore|crop|bar|good|food|gem):[a-z0-9_]{1,40}|harvest)$/.test(item)) throw new WarehouseError('Unknown item.');
    if ((b === 'farm') !== (item === 'harvest') && !(b === 'resort_farm' && item === 'harvest')) throw new WarehouseError('Unknown item.');
    const k = playerKey(name); const cur = (await this.cfgs(name)).get(`${b}|${item}`) ?? AUTO_DEFAULT;
    const reserve = c.reserve === undefined ? cur.reserve : Math.floor(Number(c.reserve));
    if (!Number.isInteger(reserve) || reserve < 0 || reserve > MAX_RESERVE) throw new WarehouseError(`Reserve must be 0 to ${MAX_RESERVE.toLocaleString('en-US')}.`);
    const next: AutoCfg = { on: c.on === undefined ? cur.on : c.on === true, reserve, keepRecipe: c.keepRecipe === undefined ? cur.keepRecipe : c.keepRecipe === true };
    if (!this.pool) { let m = this.cfgMem.get(k); if (!m) { m = new Map(); this.cfgMem.set(k, m); } m.set(`${b}|${item}`, { ...next, name: name.trim() }); }
    else await this.pool.query(`INSERT INTO autosell_cfg (player_key, name, building, item, on_, reserve, keep_recipe, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (player_key, building, item) DO UPDATE SET name = EXCLUDED.name, on_ = EXCLUDED.on_, reserve = EXCLUDED.reserve, keep_recipe = EXCLUDED.keep_recipe, updated_at = EXCLUDED.updated_at`, [k, name.trim(), b, item, next.on, next.reserve, next.keepRecipe, this.clock()]);
    return next;
  }
  private async autoPlayers(): Promise<string[]> {
    if (!this.pool) return [...this.cfgMem.values()].filter((m) => [...m.values()].some((c) => c.on)).map((m) => [...m.values()][0]!.name);
    return (await this.pool.query('SELECT DISTINCT name FROM autosell_cfg WHERE on_ = true')).rows.map((x) => String(x.name));
  }

  /** One auto-sell pass for a player: harvest (if on), then dispatch one load per enabled output that is worth sending. */
  async sweep(name: string): Promise<Array<{ building: BuildingId; item: string; qty: number; mode: string } | { building: BuildingId; harvested: number }>> {
    this.wire(); const out: Array<{ building: BuildingId; item: string; qty: number; mode: string } | { building: BuildingId; harvested: number }> = [];
    const cfgs = await this.cfgs(name); const lg = getLogistics(); const farm = getFarm();
    for (const [key, c] of cfgs) {
      if (!c.on) continue; const [b, item] = key.split('|') as [BuildingId, string];
      if (item === 'harvest') { // every plot harvests into its own stock (city f:/cf: and resort rf: plots alike)
        if (!farm) continue;
        for (const pid of await farm.myPlots(name)) {
          if (pid.startsWith('rf:') !== (b === 'resort_farm')) continue;
          try { const r = await farm.harvest(name, pid) as { harvested: number }; out.push({ building: b, harvested: r.harvested }); } catch { /* nothing ready */ }
        }
        continue;
      }
      if (!lg) continue;
      const inv = await this.inventory(name, b); const row = inv.find((x) => x.key === item); if (!row) continue;
      const q = autoQty(row.qty, c, row.needed); if (!q) continue;
      const sameMap = BUILDINGS[b].hub === 'city'; const t = sameMap ? lg.idleTruck(name) : null;
      const pick = autoCarrier({ idleTruckCap: t?.cap ?? null, qty: q, value: q * row.unit, hiredFee: (n) => lg.quote('hired', n), hiredCap: MODES.hired.cap, sameMap, shipFee: (n) => lg.quote('ship', n), shipCap: MODES.ship.cap });
      if (!pick) continue;
      try { await this.shipSell(name, b, item, pick.qty, pick.mode, true); out.push({ building: b, item, qty: pick.qty, mode: pick.mode }); }
      catch (e) { console.warn('[autosell]', name, b, item, (e as Error).message); }
    }
    return out;
  }
  /** Auto-sell is paused (pre-Millionaire restore, Dayne 2026-11-07): settings rows are kept, nothing new is shipped to sell.
   *  Ship-to-sell loads already in flight still settle on arrival (Logistics.onSell). */
  static autoSellPaused = true;
  async sweepAll() { if (Warehouse.autoSellPaused || isMillionairePrelaunch()) return; for (const n of await this.autoPlayers()) { try { await this.sweep(n); } catch (e) { console.error('[autosell] sweep failed:', (e as Error).message); } } }

  async view(name: string) {
    this.wire(); const cfg = await this.cfgs(name);
    const buildings = await Promise.all((Object.keys(BUILDINGS) as BuildingId[]).map(async (b) => ({ id: b, ...BUILDINGS[b], items: await this.inventory(name, b) })));
    return { buildings, cfg: Object.fromEntries(cfg), log: await this.log(name), truck: getLogistics()?.idleTruck(name) ?? null, index: priceIndex() };
  }
}

let wh: Warehouse = new Warehouse(null);
export const getWarehouse = () => wh;
export function setWarehouse(w: Warehouse) { wh = w; }
let sweepTimer: NodeJS.Timeout | null = null;
export async function initWarehouse(): Promise<void> {
  const url = databaseUrl();
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
    pool.on('error', (e) => console.error('[warehouse] pool error:', e.message));
    try { const w = new Warehouse(pool as unknown as PoolLike); await w.init(); wh = w; console.log('[warehouse] ready'); } catch (e) { console.error('[warehouse] init failed:', (e as Error).message); }
  } else wh.wire();
  if (!sweepTimer) { sweepTimer = setInterval(() => { if (invReady()) void wh.sweepAll(); }, AUTO_SWEEP_MS); sweepTimer.unref?.(); }
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerWarehouse(io: Server, socket: Socket): void {
  wh.wire();
  if (!wh.onSale) wh.onSale = (r, s) => io.to(`freight:${s.toKey}`).emit('wh_sold', r);
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const need = () => { const n = nameOf(); if (!n) throw new WarehouseError('Sign in first.'); return n; };
  const on = (ev: string, fn: (b: Record<string, unknown>) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try { const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; ack?.({ ok: true, ...((await fn(b)) as object ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof WarehouseError || /^(Not enough chips\.|Wallet temporarily unavailable\.|You are not at .*|Travel .*)/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); if (!(e instanceof WarehouseError)) console.error('[warehouse]', e); }
  });
  on('wh_view', async () => (await wh.view(need())));
  on('wh_cfg', async (b) => { const n = need(); await wh.setCfg(n, b.building, b.item, { on: b.on, reserve: b.reserve, keepRecipe: b.keepRecipe }); return wh.view(n); });
  on('wh_ship', async (b) => {
    const n = need(); if (!isBuilding(b.building)) throw new WarehouseError('Unknown building.');
    if (BUILDINGS[b.building].hub === 'resort') await requireResort(n, WarehouseError);
    if (b.building === 'fortmc' && !isAtFortMc(n)) throw new WarehouseError('You are not at Fort McChud.');
    const r = await wh.shipSell(n, b.building, String(b.item), Math.floor(Number(b.qty)), b.mode);
    const lg = getLogistics(); if (lg) io.to('freight').emit('freight_live', lg.live());
    return { result: r, ...(await wh.view(n)) };
  });
}
export { isAtResort };
