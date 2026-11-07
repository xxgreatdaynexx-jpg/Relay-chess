/**
 * Truck logistics between individual locations (Dayne 2026-11-06; ids in shared/inventoryLocations.ts).
 *
 *  - Goods physically move: a load leaves its source location in the SAME transaction as the shipment row and the fee
 *    (existing Freight Yard prices: own truck fuel/upkeep, hired rig fee, plane/ship fees). It is unavailable while on
 *    the road and is credited at the destination exactly once on arrival (the shipment flips transit -> delivered in the
 *    crediting transaction; a second instance / restart / retry can never credit it twice).
 *  - Trucks (own or hired) only drive within one map; plane / cargo ship / own jet / boat cross maps. The server resolves
 *    both ends' maps and the vehicle; the client only names the source, destination, item, qty and carrier.
 *  - Only the Chud City Warehouse sells (sellAt). Destinations: your factory, the Warehouse, a kitchen in a home you own.
 */
import type { Server, Socket } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { getMines, MineError } from './mines.js';
import { getLocStore, mustOne, LocError, type LocPool } from './locstock.js';
import { getLogistics, shipStmt, FreightError, type Shipment } from './logistics.js';
import { getBank } from './casino-store.js';
import { treasuryStmtsFor } from './city-rates.js';
import { getWarehouse } from './warehouse.js';
import { getFishing, FishError } from './fishing.js';
import { getCooking, CookError } from './cooking.js';
import { getFarm, FarmError } from './farm.js';
import { playerKey } from './skins.js';
import { awayFromMarket } from './travel.js';
import { cityFreightMul } from './city-rates.js';
import { properties } from '../shared/realEstate.js';
import { BIN_ITEM, FACTORY, WAREHOUSE, arrivalKey, hubOfLoc, isDestKind, locLabel, parseLoc, type HubId, type Loc } from '../shared/inventoryLocations.js';
import { nameOf, sellable, type ItemType } from '../shared/mines.js';
import { cropById } from '../shared/farm.js';
import { fishById } from '../shared/fishing.js';
import { recipeById } from '../shared/cooking.js';
import { MODES } from '../shared/logistics.js';
void cityFreightMul;

export class MoveError extends Error {}
type Stmt = { sql: string; args: unknown[] };
type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
const PACK_TYPES = new Set(['ore', 'bar', 'good', 'food']);
const BIN_BUILDINGS = new Set(['coral', 'resort_farm']);
/** What moves: a stack ('ore:iron', 'crop:wheat'), raw fish of a species ('fish:trout'), cooler dishes ('fdish:trout'), kitchen dishes ('dish:<recipe>'). */
export function parseItem(v: unknown): { row: 'stack' | 'fish' | 'fdish' | 'dish'; item: string; type: string; id: string } {
  if (typeof v !== 'string') throw new MoveError('Unknown item.');
  const i = v.indexOf(':'); const type = v.slice(0, i); const id = v.slice(i + 1);
  if (BIN_ITEM.test(v)) return { row: 'stack', item: v, type, id };
  if ((type === 'fish' || type === 'fdish') && /^[a-z0-9_]{1,40}$/.test(id)) return { row: type, item: v, type, id };
  if (type === 'dish' && /^[a-z0-9_]{1,40}$/.test(id)) return { row: 'dish', item: v, type, id };
  throw new MoveError('Unknown item.');
}
export function itemLabel(item: string): string {
  try {
    const p = parseItem(item);
    if (p.type === 'crop') return cropById(p.id)?.label ?? p.id;
    if (p.row === 'fish') return fishById(p.id)?.label ?? p.id;
    if (p.row === 'fdish') return `${fishById(p.id)?.label ?? p.id} dish`;
    if (p.row === 'dish') return recipeById(p.id)?.label ?? p.id;
    return nameOf({ type: p.type as ItemType, id: p.id });
  } catch { return item; }
}
const fishWhere = (row: 'fish' | 'fdish') => (row === 'fish' ? 'dish IS NULL' : 'dish IS NOT NULL');

export class LocMoves {
  private locks = new Map<string, Promise<unknown>>();
  constructor(private readonly clock = () => Date.now()) {}
  private lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve(); const p = prev.then(fn, fn); const tail = p.catch(() => {});
    this.locks.set(id, tail); void tail.then(() => { if (this.locks.get(id) === tail) this.locks.delete(id); }); return p;
  }
  private fishPool(): LocPool { const f = getFishing(); if (!f) throw new MoveError('Fishing storage is offline right now.'); return f.pool as unknown as LocPool; }
  private async tx(pool: LocPool, rows: Stmt[], check?: (cl: Q) => Promise<void>, after?: Promise<unknown>) {
    await after; const cl = await pool.connect();
    try { await cl.query('BEGIN'); if (check) await check(cl); for (const r of rows) await cl.query(r.sql, r.args); await cl.query('COMMIT'); }
    catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
  }

  /** Homes (kitchens) this player owns: property id -> on the resort map? plus 'trailer' for a Trailer Park lot. */
  async homes(name: string, via?: { query: (sql: string, args?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }): Promise<Map<string, boolean>> {
    const out = new Map<string, boolean>(); const key = playerKey(name); const pool = via ?? this.fishPool(); const list = properties();
    try { for (const r of (await pool.query('SELECT id FROM properties WHERE owner_key = $1', [key])).rows) out.set(String(r.id), list.find((p) => p.id === String(r.id))?.map === 'resort'); } catch { /* no table */ }
    try { if ((await pool.query('SELECT 1 FROM trailer_lots WHERE player_key = $1', [key])).rows.length) out.set('trailer', false); } catch { /* no table */ }
    return out;
  }
  hasFactory(name: string): boolean { const m = getMines(); const k = playerKey(name); return (m.factories.get(k)?.level ?? 0) > 0 || m.fv2.has(k); }
  /** Map of a location (kitchens resolved from the real home). */
  async hub(name: string, l: Loc): Promise<HubId> { return l.kind === 'kitchen' ? hubOfLoc(l.id, (await this.homes(name)).get(l.ref) === true) : hubOfLoc(l.id); }

  // ------------------------------------------------------------------ stock
  /** Qty of an item at a location (fish/dishes counted from rows). */
  async qty(name: string, loc: string, item: string): Promise<number> {
    const l = parseLoc(loc); const it = parseItem(item); const key = playerKey(name);
    if (it.row === 'fish' || it.row === 'fdish') return Number((await this.fishPool().query(`SELECT count(*)::int AS n FROM fish_catches WHERE player_key = $1 AND loc = $2 AND species = $3 AND sold_at IS NULL AND ${fishWhere(it.row)}`, [key, l.id, it.id])).rows[0]?.n ?? 0);
    if (it.row === 'dish') return Number((await this.fishPool().query('SELECT count(*)::int AS n FROM kitchen_dishes WHERE player_key = $1 AND loc = $2 AND recipe = $3 AND sold_at IS NULL', [key, l.id, it.id])).rows[0]?.n ?? 0);
    if (l.kind === 'factory') return PACK_TYPES.has(it.type) ? getMines().stackQty(name, it.type as ItemType, it.id) : 0;
    if (BIN_BUILDINGS.has(l.kind)) return (await getWarehouse().bin(name, l.kind as 'coral')).get(item) ?? 0;
    return getLocStore().qty(name, l.id, item);
  }
  /** Every location this player has goods at (plus their factory, the Warehouse and their kitchens), with items. */
  async view(name: string) {
    const key = playerKey(name); const out = new Map<string, Array<{ item: string; label: string; qty: number }>>();
    const put = (loc: string, item: string, qty: number) => { if (qty <= 0) return; let a = out.get(loc); if (!a) { a = []; out.set(loc, a); } const x = a.find((r) => r.item === item); if (x) x.qty += qty; else a.push({ item, label: itemLabel(item), qty }); };
    try { for (const s of getMines().stacks(name)) put(FACTORY, `${s.type}:${s.id}`, s.qty); } catch { /* offline */ }
    for (const [loc, items] of getLocStore().locs(name)) for (const x of items) put(loc, x.item, x.qty);
    for (const b of BIN_BUILDINGS) for (const [item, q] of await getWarehouse().bin(name, b as 'coral').catch(() => new Map<string, number>())) if (BIN_ITEM.test(item)) put(b, item, q);
    const fp = getFishing()?.pool;
    if (fp) {
      for (const r of (await fp.query("SELECT loc, species, (dish IS NOT NULL) AS d, count(*)::int AS n FROM fish_catches WHERE player_key = $1 AND sold_at IS NULL AND loc IS NOT NULL AND loc NOT LIKE 'transit:%' GROUP BY 1,2,3", [key]).catch(() => ({ rows: [] }))).rows) put(String(r.loc), `${r.d ? 'fdish' : 'fish'}:${r.species}`, Number(r.n));
      for (const r of (await fp.query("SELECT loc, recipe, count(*)::int AS n FROM kitchen_dishes WHERE player_key = $1 AND sold_at IS NULL AND loc IS NOT NULL AND loc NOT LIKE 'transit:%' GROUP BY 1,2", [key]).catch(() => ({ rows: [] }))).rows) put(String(r.loc), `dish:${r.recipe}`, Number(r.n));
    }
    const homes = await this.homes(name).catch(() => new Map<string, boolean>());
    const dests = [...(this.hasFactory(name) ? [FACTORY] : []), WAREHOUSE, ...[...homes.keys()].map((h) => `kitchen:${h}`)];
    const ids = new Set([...out.keys(), ...dests]);
    const locations = await Promise.all([...ids].map(async (id) => { const l = parseLoc(id); return { id, label: locLabel(id), hub: await this.hub(name, l), dest: dests.includes(id), sells: id === WAREHOUSE, items: (out.get(id) ?? []).sort((a, b) => a.label.localeCompare(b.label)) }; }));
    const lg = getLogistics();
    const shipments = lg ? [...lg.ships.values()].filter((s) => s.kind === 'loc' && s.owner === key).map((s) => ({ id: s.id, from: s.fromLoc, to: s.toLoc, fromLabel: locLabel(s.fromLoc ?? ''), toLabel: locLabel(s.toLoc ?? ''), item: `${s.type}:${s.itemId}`, label: itemLabel(`${s.type}:${s.itemId}`), qty: s.qty, mode: s.mode, fee: s.fee, departAt: s.departAt, arriveAt: s.arriveAt })) : [];
    const busy = lg ? lg.busyTrucks(name) : new Set<string>();
    return { now: this.clock(), locations: locations.sort((a, b) => (a.id === WAREHOUSE ? -1 : b.id === WAREHOUSE ? 1 : a.label.localeCompare(b.label))), shipments,
      trucks: lg ? lg.owned(name).map((t) => ({ id: t.id, model: t.truckId, busy: busy.has(t.id) })) : [], hired: { perUnit: MODES.hired.perUnit, minFee: MODES.hired.minFee, cap: MODES.hired.cap } };
  }

  /** Fee quote for a planned leg (no reservation kept). */
  async quote(name: string, b: Record<string, unknown>) {
    const from = parseLoc(b.from), to = parseLoc(b.to); const it = parseItem(b.item); const qty = Math.floor(Number(b.qty));
    const lg = getLogistics(); if (!lg) throw new MoveError('Freight is offline right now.');
    const fromHub = await this.hub(name, from), toHub = await this.hub(name, to);
    try { const p = await lg.planLeg(name, { mode: b.mode, vehicle: b.vehicle, fromHub, toHub, type: it.type, itemId: it.id, qty, fromLoc: from.id, toLoc: to.id }); lg.release(p.shipment.id); return { fee: p.shipment.fee, trips: p.trips, arriveAt: p.shipment.arriveAt, sameMap: fromHub === toHub }; }
    catch (e) { if (e instanceof FreightError) throw new MoveError(e.message); throw e; }
  }

  // ------------------------------------------------------------------ dispatch
  async move(name: string, b: Record<string, unknown>) {
    return this.lock(playerKey(name), () => this.move0(name, b));
  }
  private async move0(name: string, b: Record<string, unknown>) {
    let from: Loc, to: Loc; try { from = parseLoc(b.from); to = parseLoc(b.to); } catch { throw new MoveError('Unknown location.'); }
    const it = parseItem(b.item); const qty = Number(b.qty);
    if (!Number.isSafeInteger(qty) || qty < 1) throw new MoveError('Pick a quantity.');
    if (from.id === to.id) throw new MoveError('Pick a different destination.');
    if (!isDestKind(to.kind)) throw new MoveError('Trucks deliver to your factory, the Chud City Warehouse or one of your kitchens.');
    if (to.kind === 'factory' && !this.hasFactory(name)) throw new MoveError('Build your factory first.');
    if (from.kind === 'factory' && !this.hasFactory(name)) throw new MoveError('You do not have a factory.');
    const homes = await this.homes(name);
    if (to.kind === 'kitchen' && !homes.has(to.ref)) throw new MoveError('You can only deliver to a kitchen in a home you own.');
    if (to.kind === 'kitchen' && !(it.type === 'food' || it.type === 'crop' || it.row === 'fish' || it.row === 'dish' || it.row === 'fdish')) throw new MoveError('Kitchens take food, crops, fish and dishes.');
    if (it.row === 'dish' && to.kind === 'factory') throw new MoveError('Plated dishes go to the Warehouse (to sell) or a kitchen.');
    if (it.row === 'stack' && from.kind === 'factory' && !PACK_TYPES.has(it.type)) throw new MoveError('Unknown item.');
    if (BIN_BUILDINGS.has(from.kind) && it.row !== 'stack') throw new MoveError('Unknown item.');
    const have = await this.qty(name, from.id, it.item);
    if (have < qty) throw new MoveError(`Only ${have.toLocaleString('en-US')} ${itemLabel(it.item)} at ${locLabel(from.id)}.`);
    const lg = getLogistics(); if (!lg) throw new MoveError('Freight is offline right now.');
    const fromHub = from.kind === 'kitchen' ? hubOfLoc(from.id, homes.get(from.ref) === true) : hubOfLoc(from.id);
    const toHub = to.kind === 'kitchen' ? hubOfLoc(to.id, homes.get(to.ref) === true) : hubOfLoc(to.id);
    let plan: Awaited<ReturnType<typeof lg.planLeg>>;
    try { plan = await lg.planLeg(name, { mode: b.mode, vehicle: b.vehicle, fromHub, toHub, type: it.type, itemId: it.id, qty, fromLoc: from.id, toLoc: to.id }); }
    catch (e) { if (e instanceof FreightError) throw new MoveError(e.message); throw e; }
    const s = plan.shipment; const bank = getBank();
    try {
      if (s.fee && !bank.canAfford(name, s.fee)) throw new MoveError(`Not enough chips for the 🪙 ${s.fee.toLocaleString('en-US')} fee.`);
      const w = s.fee ? bank.transferAtomic([{ name, amount: -s.fee, key: `freight:${s.id}`, game: 'freight', memo: `${MODES[s.mode].label}: ${qty} ${itemLabel(it.item)} ${locLabel(from.id)} → ${locLabel(to.id)}` }]) : null;
      const rows: Stmt[] = [shipStmt(s), ...(w?.stmts ?? []), ...(plan.surplus ? treasuryStmtsFor(name, 'freight', plan.surplus, 'Freight lever surplus') : [])];
      let p: Promise<void>;
      if (it.row === 'fish' || it.row === 'fdish') {
        p = this.tx(this.fishPool(), rows, async (cl) => {
          const r = await cl.query(`UPDATE fish_catches SET loc = $5 WHERE id IN (SELECT id FROM fish_catches WHERE player_key = $1 AND loc = $2 AND species = $3 AND sold_at IS NULL AND ${fishWhere(it.row as 'fish')} ORDER BY caught_at, id LIMIT $4 FOR UPDATE)`, [playerKey(name), from.id, it.id, qty, `transit:${s.id}`]);
          if (r.rowCount !== qty) throw new MoveError('Those fish just moved. Try again.');
        }, w?.after);
      } else if (it.row === 'dish') {
        p = this.tx(this.fishPool(), rows, async (cl) => {
          const r = await cl.query('UPDATE kitchen_dishes SET loc = $5 WHERE id IN (SELECT id FROM kitchen_dishes WHERE player_key = $1 AND loc = $2 AND recipe = $3 AND sold_at IS NULL ORDER BY cooked_at, id LIMIT $4 FOR UPDATE)', [playerKey(name), from.id, it.id, qty, `transit:${s.id}`]);
          if (r.rowCount !== qty) throw new MoveError('Those dishes just moved. Try again.');
        }, w?.after);
      } else if (from.kind === 'factory') {
        const mines = getMines(); let fail: Error | null = null; let done: Promise<unknown> = Promise.resolve(); let fb: Stmt[] | null = null;
        const ok = mines.adjustStack(name, it.type as ItemType, it.id, -qty, rows, (r) => { fb = r; }, { after: w?.after, bind: (x) => { done = x; }, onFail: (e) => { fail = e; } });
        if (!ok) { w?.revert(); throw new MoveError(`Only ${mines.stackQty(name, it.type as ItemType, it.id)} ${itemLabel(it.item)} at your factory.`); }
        p = (async () => { if (fb) { const wp = (getWarehouse() as unknown as { pool: LocPool | null }).pool; if (wp) await this.tx(wp, fb); } else await done; if (fail) throw fail; })();
      } else if (BIN_BUILDINGS.has(from.kind)) {
        const wp = (getWarehouse() as unknown as { pool: LocPool | null }).pool; if (!wp) throw new MoveError('Storage is offline right now.');
        p = this.tx(wp, [mustOne('UPDATE building_inv SET qty = qty - $4 WHERE player_key = $1 AND building = $2 AND item = $3 AND qty >= $4', [playerKey(name), from.kind, it.item, qty]), ...rows], undefined, w?.after);
      } else {
        const r = getLocStore().adjust(name, [{ loc: from.id, item: it.item, delta: -qty }], rows, { after: w?.after });
        if (r === false) { w?.revert(); throw new MoveError(`Not enough ${itemLabel(it.item)} at ${locLabel(from.id)}.`); }
        p = r;
      }
      w?.bind(p);
      try { await p; } catch (e) { w?.revert(); if (e instanceof MoveError) throw e; console.error('[locmoves] dispatch failed:', (e as Error).message); throw new MoveError(/division by zero/.test((e as Error).message) ? 'Those goods just moved. Nothing was charged.' : 'That didn’t go through. Nothing was moved or charged.'); }
    } catch (e) { lg.release(s.id); throw e; }
    lg.admit(s);
    return { shipment: { id: s.id, mode: s.mode, fee: s.fee, departAt: s.departAt, arriveAt: s.arriveAt, trips: plan.trips, from: from.id, to: to.id, item: it.item, qty } };
  }

  // ------------------------------------------------------------------ arrival
  /** Credit a delivered load at its destination exactly once (called by Logistics.tick; rejection = retried). */
  async arrive(s: Shipment): Promise<void> {
    const to = parseLoc(s.toLoc); const item = `${s.type}:${s.itemId}`; const it = parseItem(item);
    const flip = mustOne("UPDATE freight_shipments SET status = 'delivered' WHERE id = $1 AND status = 'transit'", [s.id]);
    try {
      if (it.row === 'fish' || it.row === 'fdish') {
        await this.tx(this.fishPool(), [{ sql: 'UPDATE fish_catches SET loc = $2 WHERE loc = $1', args: [`transit:${s.id}`, to.id] }, flip]);
      } else if (it.row === 'dish') {
        await this.tx(this.fishPool(), [{ sql: 'UPDATE kitchen_dishes SET loc = $2 WHERE loc = $1', args: [`transit:${s.id}`, to.id] }, flip]);
      } else {
        const key = arrivalKey(item, to.kind); const [t, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
        if (to.kind === 'factory') {
          if (!PACK_TYPES.has(t)) throw new Error(`factory can't store ${key}`);
          const mines = getMines(); let fail: Error | null = null; let done: Promise<unknown> = Promise.resolve(); let fb: Stmt[] | null = null;
          if (!mines.adjustStack(s.ownerName, t as ItemType, id, s.qty, [flip], (r) => { fb = r; }, { bind: (x) => { done = x; }, onFail: (e) => { fail = e; } })) throw new Error('could not store');
          if (fb) { const wp = (getWarehouse() as unknown as { pool: LocPool | null }).pool; if (wp) await this.tx(wp, fb); } else await done; if (fail) throw fail;
        } else {
          const r = getLocStore().adjust(s.ownerName, [{ loc: to.id, item: key, delta: s.qty }], [flip]); if (r === false) throw new Error('could not store');
          await r;
        }
      }
    } catch (e) {
      // Already delivered (another instance / an earlier attempt that committed): done, never credit twice.
      const pool = this.fishPool(); const r = await pool.query('SELECT status FROM freight_shipments WHERE id = $1', [s.id]).catch(() => ({ rows: [] as Record<string, unknown>[] }));
      if (r.rows[0]?.status === 'delivered') return;
      throw e;
    }
    this.onArrive?.(s);
  }
  onArrive: ((s: Shipment) => void) | null = null;

  // ------------------------------------------------------------------ selling (Chud City Warehouse only)
  async sell(name: string, b: Record<string, unknown>) {
    return this.lock(playerKey(name), () => this.sell0(name, b));
  }
  private async sell0(name: string, b: Record<string, unknown>) {
    const at = b.from === undefined ? WAREHOUSE : String(b.from);
    if (at !== WAREHOUSE) throw new MoveError('Goods only sell at the Chud City Warehouse. Send them there by truck first.');
    const it = parseItem(b.item); const have = await this.qty(name, WAREHOUSE, it.item);
    const qty = b.qty === undefined || b.qty === null || b.qty === 'all' ? have : Math.floor(Number(b.qty));
    if (!Number.isSafeInteger(qty) || qty < 1) throw new MoveError(have ? 'Pick a quantity.' : 'Nothing of that at the Warehouse. Send it there by truck first.');
    if (qty > have) throw new MoveError(`Only ${have.toLocaleString('en-US')} ${itemLabel(it.item)} at the Warehouse.`);
    const key = playerKey(name);
    if (it.row === 'fish' || it.row === 'fdish') {
      const ids = (await this.fishPool().query(`SELECT id FROM fish_catches WHERE player_key = $1 AND loc = $2 AND species = $3 AND sold_at IS NULL AND ${fishWhere(it.row)} ORDER BY caught_at, id LIMIT $4`, [key, WAREHOUSE, it.id, qty])).rows.map((r) => String(r.id));
      const f = getFishing(); if (!f) throw new MoveError('Fishing is offline right now.');
      return f.sell(name, ids);
    }
    if (it.row === 'dish') {
      const ids = (await this.fishPool().query('SELECT id FROM kitchen_dishes WHERE player_key = $1 AND loc = $2 AND recipe = $3 AND sold_at IS NULL ORDER BY cooked_at, id LIMIT $4', [key, WAREHOUSE, it.id, qty])).rows.map((r) => String(r.id));
      const c = getCooking(); if (!c) throw new MoveError('The kitchen is offline right now.');
      return c.sell(name, ids);
    }
    const ls = getLocStore();
    if (it.type === 'crop') {
      const farm = getFarm(); if (!farm) throw new MoveError('The farm is offline right now.');
      if (!ls.check(name, [{ loc: WAREHOUSE, item: it.item, delta: -qty }])) throw new MoveError('Not enough at the Warehouse.');
      const paid = await farm.sellShipped({ id: `wh:${randomUUID()}`, ownerName: name.trim(), itemId: it.id, qty }, ls.rowsFor(name, [{ loc: WAREHOUSE, item: it.item, delta: -qty }]), 'your Warehouse stock');
      ls.applyMem(name, [{ loc: WAREHOUSE, item: it.item, delta: -qty }]);
      return { sold: qty, paid, chips: getBank().account(name).chips };
    }
    if (!PACK_TYPES.has(it.type) || !sellable({ type: it.type as ItemType, id: it.id })) throw new MoveError('The Warehouse does not buy that.');
    const mines = getMines(); const now = this.clock();
    let sale: ReturnType<typeof mines.houseSale>;
    try { sale = mines.houseSale(name, now, [{ type: it.type as ItemType, id: it.id, qty }]); } catch (e) { if (e instanceof MineError) throw new MoveError(e.message); throw e; }
    const r = ls.adjust(name, [{ loc: WAREHOUSE, item: it.item, delta: -qty }], sale.stmts, { after: sale.w.after });
    if (r === false) { sale.w.revert(); throw new MoveError('Not enough at the Warehouse.'); }
    sale.w.bind(r);
    try { await r; } catch (e) { sale.w.revert(); console.error('[locmoves] sale failed:', (e as Error).message); throw new MoveError('That sale didn’t go through. Nothing was sold.'); }
    sale.apply();
    return { sold: qty, gross: sale.q.gross, paid: sale.q.paid, chips: getBank().account(name).chips };
  }

  // ------------------------------------------------------------------ legacy migration (Dayne: existing stock -> each owner's factory)
  /**
   * Banked stock (mine_items) already IS factory stock. This moves the rest: unsold cooler fish (and cooler dishes) and
   * kitchen dishes get loc 'factory'; cutting-board fillets become factory food stacks ('food:fillet_<kind>').
   * Only owners with a factory are moved; anyone else is held (left untouched, reported) - nothing is created or guessed.
   * Idempotent: rows already located are skipped; fillets move with a guarded decrement in the factory store transaction.
   */
  async migrateLegacy(): Promise<{ fish: number; dishes: number; fillets: number; held: string[] }> {
    const pool = this.fishPool(); const mines = getMines();
    const owners = new Set<string>([...mines.factories].filter(([, f]) => f.level > 0).map(([k]) => k)); for (const k of mines.fv2.keys()) owners.add(k);
    const list = [...owners];
    const fish = (await pool.query("UPDATE fish_catches SET loc = 'factory' WHERE loc IS NULL AND sold_at IS NULL AND player_key = ANY($1::text[])", [list])).rowCount ?? 0;
    const dishes = (await pool.query("UPDATE kitchen_dishes SET loc = 'factory' WHERE loc IS NULL AND sold_at IS NULL AND player_key = ANY($1::text[])", [list])).rowCount ?? 0;
    let fillets = 0;
    for (const r of (await pool.query('SELECT player_key, kind, qty FROM kitchen_fillets WHERE qty > 0')).rows) {
      const k = String(r.player_key); if (!owners.has(k)) continue; const q = Number(r.qty); const kind = String(r.kind);
      const nm = mines.names.get(k) ?? mines.fv2Names.get(k) ?? k;
      let fail: Error | null = null; let done: Promise<unknown> = Promise.resolve(); let fb: Stmt[] | null = null;
      const ok = mines.adjustStack(nm, 'food', `fillet_${kind}`, q, [mustOne('UPDATE kitchen_fillets SET qty = 0 WHERE player_key = $1 AND kind = $2 AND qty = $3', [k, kind, q])], (x) => { fb = x; }, { bind: (x) => { done = x; }, onFail: (e) => { fail = e; } });
      if (!ok) continue; if (fb) await this.tx(pool, fb); else await done; if (!fail) fillets += q;
    }
    const held = [...new Set([
      ...(await pool.query('SELECT DISTINCT player_key FROM fish_catches WHERE loc IS NULL AND sold_at IS NULL')).rows.map((r) => String(r.player_key)),
      ...(await pool.query('SELECT DISTINCT player_key FROM kitchen_dishes WHERE loc IS NULL AND sold_at IS NULL')).rows.map((r) => String(r.player_key)),
      ...(await pool.query('SELECT DISTINCT player_key FROM kitchen_fillets WHERE qty > 0')).rows.map((r) => String(r.player_key)),
    ])];
    const report = { fish, dishes, fillets, held, at: this.clock() };
    await pool.query("INSERT INTO loc_migrations (id, at, report) VALUES ('legacy-to-factory-v1', $1, $2) ON CONFLICT (id) DO UPDATE SET report = loc_migrations.report || jsonb_build_object('last', EXCLUDED.report)", [this.clock(), JSON.stringify(report)]).catch((e) => console.error('[locmoves] report write failed:', (e as Error).message));
    if (fish || dishes || fillets || held.length) console.log('[locmoves] legacy -> factory:', JSON.stringify({ fish, dishes, fillets, held: held.length }));
    return report;
  }
}

let lm = new LocMoves();
export const getLocMoves = () => lm;
export const setLocMoves = (x: LocMoves) => { lm = x; };
/** Hook producers + freight into per-location stock (idempotent). */
export function wireLocMoves() {
  const mines = getMines();
  if (!mines.cityBin) mines.cityBin = (acct, stacks, cave) => { const d = stacks.filter((x) => x.qty > 0).map((x) => ({ loc: `mine:${cave}`, item: `${x.type}:${x.id}`, delta: x.qty })); getLocStore().applyMem(acct, d); return getLocStore().rowsFor(acct, d); };
  const lg = getLogistics(); if (lg && !lg.onLoc) lg.onLoc = (s) => lm.arrive(s);
}
export async function initLocMoves() {
  wireLocMoves();
  for (let i = 0; i < 60; i++) {
    const m = getMines(); if (getFishing() && getCooking() && m.store && !m.offline && getLocStore().loaded) {
      try { await lm.migrateLegacy(); return; } catch (e) { console.error('[locmoves] legacy migration failed (will retry):', (e as Error).message); }
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerLocMoves(io: Server, socket: Socket): void {
  wireLocMoves();
  if (!lm.onArrive) lm.onArrive = (s) => io.to(`freight:${s.toKey}`).emit('loc_arrived', { id: s.id, to: s.toLoc, item: `${s.type}:${s.itemId}`, qty: s.qty });
  const nameOf_ = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const need = () => { const n = nameOf_(); if (!n) throw new MoveError('Sign in to move goods.'); return n; };
  const known = (e: unknown) => e instanceof MoveError || e instanceof LocError || e instanceof FreightError || e instanceof MineError || e instanceof FishError || e instanceof CookError || e instanceof FarmError || /^(Not enough chips\.|Wallet temporarily unavailable\.|Unknown location\.|Unknown item\.)$/.test((e as Error).message);
  const on = (ev: string, fn: (b: Record<string, unknown>, n: string) => Promise<unknown>) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try { const n = need(); const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; const r = await fn(b, n); ack?.({ ok: true, ...(r as object), view: await lm.view(n) }); }
    catch (e) { ack?.({ ok: false, error: known(e) ? (e as Error).message : 'Something went wrong.' }); if (!known(e)) console.error('[locmoves]', e); }
  });
  on('loc_view', async (_b, n) => { void socket.join(`freight:${playerKey(n)}`); return {}; });
  on('loc_quote', async (b, n) => ({ quote: await lm.quote(n, b) }));
  on('loc_move', async (b, n) => { const r = await lm.move(n, b); const lg = getLogistics(); if (lg) io.to('freight').emit('freight_live', lg.live()); return r; });
  on('loc_sell', async (b, n) => { awayFromMarket(n, MoveError); return { result: await lm.sell(n, b) }; });
}
