import { shipmentManifest, manifestUnits, type ManifestLine } from '../shared/shipmentManifest.js';
import { fenceHeld, markMigrating } from './invFence.js';
import { packed, OutcomeUnknown, isOutcomeUnknown, outcome, ledgerMarker } from './locstock.js';
import { PANTRY_MAX } from '../shared/cooking.js';
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
import { randomUUID, createHash } from 'node:crypto';
import { getMines, MineError } from './mines.js';
import { getLocStore, mustOne, LocError, type LocPool } from './locstock.js';
import { getLogistics, shipStmt, rowShip, MANIFEST_MOVING, FreightError, type Shipment } from './logistics.js';
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
import { mineLoc, isPool, RESORT_WAREHOUSE, BIN_ITEM, FACTORY, WAREHOUSE, arrivalKey, hubOfLoc, isDestKind, locLabel, parseLoc, type HubId, type Loc } from '../shared/inventoryLocations.js';
import { MAX_BANKED_STACK, nameOf, sellable, type ItemType } from '../shared/mines.js';
import { cropById } from '../shared/farm.js';
import { fishById } from '../shared/fishing.js';
import { recipeById } from '../shared/cooking.js';
import { MODES } from '../shared/logistics.js';
void cityFreightMul;

export class MoveError extends Error {}
type Stmt = { sql: string; args: unknown[] };
type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
const PACK_TYPES = new Set(['ore', 'bar', 'good', 'food']);
const BIN_BUILDINGS = new Set(['coral']); // the Coral Grotto haul bin (building_inv). The pooled resort barn is legacy-only (migrated).
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
  private pendingManifests = new Set<string>();
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
    if (l.kind === 'factory' && PACK_TYPES.has(it.type)) return getMines().stackQty(name, it.type as ItemType, it.id); // crops kept as crops (legacy barn) live in loc_stock 'factory'
    if (BIN_BUILDINGS.has(l.kind)) return (await getWarehouse().bin(name, l.kind as 'coral')).get(item) ?? 0;
    return getLocStore().qty(name, l.id, item);
  }
  /** Every location this player has goods at (plus their factory, the Warehouse and their kitchens), with items. */
  async view(name: string) {
    const key = playerKey(name); const out = new Map<string, Array<{ item: string; label: string; qty: number }>>();
    const put = (loc: string, item: string, qty: number) => { if (qty <= 0) return; let a = out.get(loc); if (!a) { a = []; out.set(loc, a); } const x = a.find((r) => r.item === item); if (x) x.qty += qty; else a.push({ item, label: itemLabel(item), qty }); };
    // Map pools: your factory's stock IS the Chud City Warehouse stock (one city inventory, LocStore serves it under 'warehouse').
    for (const [loc, items] of getLocStore().locs(name)) for (const x of items) put(loc, x.item, x.qty);
    for (const b of BIN_BUILDINGS) for (const [item, q] of await getWarehouse().bin(name, b as 'coral').catch(() => new Map<string, number>())) if (BIN_ITEM.test(item)) put(b, item, q);
    const fp = getFishing()?.pool;
    if (fp) {
      for (const r of (await fp.query("SELECT loc, species, (dish IS NOT NULL) AS d, count(*)::int AS n FROM fish_catches WHERE player_key = $1 AND sold_at IS NULL AND loc IS NOT NULL AND loc NOT LIKE 'transit:%' GROUP BY 1,2,3", [key]).catch(() => ({ rows: [] }))).rows) put(String(r.loc), `${r.d ? 'fdish' : 'fish'}:${r.species}`, Number(r.n));
      for (const r of (await fp.query("SELECT loc, recipe, count(*)::int AS n FROM kitchen_dishes WHERE player_key = $1 AND sold_at IS NULL AND loc IS NOT NULL AND loc NOT LIKE 'transit:%' GROUP BY 1,2", [key]).catch(() => ({ rows: [] }))).rows) put(String(r.loc), `dish:${r.recipe}`, Number(r.n));
    }
    const homes = await this.homes(name).catch(() => new Map<string, boolean>());
    const dests = [WAREHOUSE, RESORT_WAREHOUSE]; void homes; // map pools: one warehouse per map; your factory works from the city one directly
    const ids = new Set([...out.keys(), ...dests]);
    // Unknown / unmapped locations (fold left them untouched): quarantined, listed apart, never guessed onto a map.
    const quarantined: Array<{ id: string; items: Array<{ item: string; label: string; qty: number }> }> = [];
    for (const id of [...ids]) { let ok = false; try { const k = parseLoc(id).kind; ok = isPool(id) || k === 'factory' || BIN_BUILDINGS.has(k); } catch { ok = false; } if (!ok) { ids.delete(id); quarantined.push({ id, items: out.get(id) ?? [] }); } }
    const locations = await Promise.all([...ids].map(async (id) => { const l = parseLoc(id); return { id, label: id === FACTORY && !this.hasFactory(name) ? 'Banked storage' : locLabel(id), held: id === FACTORY && !this.hasFactory(name), hub: await this.hub(name, l), dest: dests.includes(id), sells: isPool(id), items: (out.get(id) ?? []).sort((a, b) => a.label.localeCompare(b.label)) }; }));
    const lg = getLogistics();
    const shipments = lg ? [...lg.ships.values()].filter((s) => (s.kind === 'loc' || s.kind === 'batch') && s.owner === key).map((s) => ({ id: s.id, from: s.fromLoc, to: s.toLoc, fromLabel: locLabel(s.fromLoc ?? ''), toLabel: locLabel(s.toLoc ?? ''), item: `${s.type}:${s.itemId}`, label: s.manifest ? `${s.manifest.length} item types` : itemLabel(`${s.type}:${s.itemId}`), manifest: s.manifest?.map(l => ({ ...l, label: itemLabel(l.item) })), qty: s.qty, mode: s.mode, fee: s.fee, departAt: s.departAt, arriveAt: s.arriveAt })) : [];
    const busy = lg ? lg.busyTrucks(name) : new Set<string>();
    // Held legacy stock with no recorded map: listed for review (read-only), never usable or movable by guess.
    const hp = getLocStore().pool ?? fp; const held = hp ? await (await import('./mapPools.js')).heldLegacyReview(hp as never, key).catch(() => []) : [];
    return { now: this.clock(), quarantined, held, locations: locations.sort((a, b) => (a.id === WAREHOUSE ? -1 : b.id === WAREHOUSE ? 1 : a.label.localeCompare(b.label))), shipments,
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
    if (to.kind === 'factory' || from.kind === 'factory' && hubOfLoc(to.id) !== 'resort') throw new MoveError('Your factory already uses your Chud City Warehouse stock directly. Nothing to move.');
    if (!isDestKind(to.kind)) throw new MoveError('Goods go to a map warehouse (Chud City or Resort).');
    // (pre-update banked storage was usable without a factory: moving it out to the city warehouse is allowed)
    const homes = await this.homes(name);
    if (BIN_BUILDINGS.has(from.kind) && it.row !== 'stack') throw new MoveError('Unknown item.');
    const have = await this.qty(name, from.id, it.item);
    if (have < qty) throw new MoveError(`Only ${have.toLocaleString('en-US')} ${itemLabel(it.item)} at ${locLabel(from.id)}.`);
    const lg = getLogistics(); if (!lg) throw new MoveError('Freight is offline right now.');
    if (from.kind === 'factory' && PACK_TYPES.has(it.type) || packed(to.id, it.item)) { const m = getMines(); if (!m.store || m.offline) throw new MoveError('Factory storage is reconnecting. Nothing was moved; try again in a minute.'); }
    // Room at the destination, counting loads already on the way there (no stalled arrivals, nothing dropped).
    if (it.row === 'stack') {
      const key = arrivalKey(it.item, to.kind); const inbound = this.inbound(name, to.id, key);
      const [kt, kid] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
      const at = getLocStore().qty(name, to.id, key); void kid; // the city pool's stackables are the banked store (same cap as before)
      const cap = to.id === WAREHOUSE && PACK_TYPES.has(kt) ? MAX_BANKED_STACK : Infinity;
      if (at + inbound + qty > cap) throw new MoveError(`${locLabel(to.id)} has room for ${Math.max(0, cap - at - inbound).toLocaleString('en-US')} more ${itemLabel(key)}.`);
    }
    const fromHub = from.kind === 'kitchen' ? hubOfLoc(from.id, homes.get(from.ref) === true) : hubOfLoc(from.id);
    const toHub = hubOfLoc(to.id);
    let plan: Awaited<ReturnType<typeof lg.planLeg>>;
    try { plan = await lg.planLeg(name, { mode: b.mode, vehicle: b.vehicle, fromHub, toHub, type: it.type, itemId: it.id, qty, fromLoc: from.id, toLoc: to.id }); }
    catch (e) { if (e instanceof FreightError) throw new MoveError(e.message); throw e; }
    const s = plan.shipment; const bank = getBank(); let pending = false;
    try {
      if (s.fee && !bank.canAfford(name, s.fee)) throw new MoveError(`Not enough chips for the 🪙 ${s.fee.toLocaleString('en-US')} fee.`);
      const w = s.fee ? bank.transferAtomic([{ name, amount: -s.fee, key: `freight:${s.id}`, game: 'freight', memo: `${MODES[s.mode].label}: ${qty} ${itemLabel(it.item)} ${locLabel(from.id)} → ${locLabel(to.id)}` }]) : null;
      const rows: Stmt[] = [shipStmt(s), ...(w?.stmts ?? []), ...(plan.surplus ? treasuryStmtsFor(name, 'freight', plan.surplus, 'Freight lever surplus') : [])];
      let p: Promise<void>;
      // Late verdict for a dispatch whose outcome was unknown: if it had NOT committed, undo the fee and free the vehicle.
      const late = (ok: boolean) => { if (ok) w?.confirm(); if (!ok) { w?.revert(); lg.release(s.id); console.error(`[locmoves] dispatch ${s.id} did not commit (settled late): fee returned`); } };
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
      } else if (from.kind === 'factory' && PACK_TYPES.has(it.type)) {
        const mines = getMines(); let fail: Error | null = null; let done: Promise<unknown> = Promise.resolve(); let fb: Stmt[] | null = null;
        const ok = mines.adjustStack(name, it.type as ItemType, it.id, -qty, rows, (r) => { fb = r; }, { after: w?.after, bind: (x) => { done = x; }, onFail: (e) => { fail = e; }, committed: () => this.shipExists(s.id), onUnknown: (e) => { fail = new OutcomeUnknown(e); }, onLate: late });
        if (!ok) { w?.revert(); throw new MoveError(`Only ${mines.stackQty(name, it.type as ItemType, it.id)} ${itemLabel(it.item)} at your factory.`); }
        p = (async () => { if (fb) { const wp = (getWarehouse() as unknown as { pool: LocPool | null }).pool; if (wp) await this.tx(wp, fb); } else await done; if (fail) throw fail; })();
      } else if (BIN_BUILDINGS.has(from.kind)) {
        const wp = (getWarehouse() as unknown as { pool: LocPool | null }).pool; if (!wp) throw new MoveError('Storage is offline right now.');
        p = this.tx(wp, [mustOne('UPDATE building_inv SET qty = qty - $4 WHERE player_key = $1 AND building = $2 AND item = $3 AND qty >= $4', [playerKey(name), from.kind, it.item, qty]), ...rows], undefined, w?.after);
      } else {
        const r = getLocStore().adjust(name, [{ loc: from.id, item: it.item, delta: -qty }], rows, { after: w?.after, committed: () => this.shipExists(s.id), onLate: late });
        if (r === false) { w?.revert(); throw new MoveError(`Not enough ${itemLabel(it.item)} at ${locLabel(from.id)}.`); }
        p = r;
      }
      w?.bind(p);
      try { await p; } catch (e) {
        // Every dispatch transaction writes its shipment row: that row exists iff it committed (lost-ack reconcile).
        const v = e instanceof MoveError ? false : isOutcomeUnknown(e) ? null : await outcome(() => this.shipExists(s.id));
        if (v === null) { // unknown: keep fee + goods as moved and the leg admitted (its arrival only credits if the row exists)
          if (!isOutcomeUnknown(e)) void (async () => { for (let i = 0; ; i++) { await new Promise((r) => setTimeout(r, Math.min(60_000, 1000 * 2 ** Math.min(i, 6)))); const x = await outcome(() => this.shipExists(s.id), 1); if (x !== null) return late(x); } })();
          lg.admit(s); pending = true; throw new MoveError('Your move is still being confirmed. Check My places in a minute; nothing will be charged twice.');
        }
        if (v === false) { w?.revert(); if (e instanceof MoveError) throw e; console.error('[locmoves] dispatch failed:', (e as Error).message); throw new MoveError(/division by zero/.test((e as Error).message) ? 'Those goods just moved. Nothing was charged.' : 'That didn’t go through. Nothing was moved or charged.'); }
      }
    } catch (e) { if (!pending) lg.release(s.id); throw e; }
    lg.admit(s);
    return { shipment: { id: s.id, mode: s.mode, fee: s.fee, departAt: s.departAt, arriveAt: s.arriveAt, trips: plan.trips, from: from.id, to: to.id, item: it.item, qty } };
  }

  /** Inbound quantities include every manifest line, never parent total attributed to its first SKU. */
  private inbound(name: string, to: string, item: string) {
    return [...(getLogistics()?.ships.values() ?? [])].filter(s => (s.kind === 'loc' || s.kind === 'batch') && s.toKey === playerKey(name) && s.toLoc === to)
      .flatMap(s => s.manifest ?? [{ item: `${s.type}:${s.itemId}`, qty: s.qty }]).filter(l => l.item === item).reduce((n,l)=>n+l.qty,0);
  }
  private batchInput(b: Record<string, unknown>) {
    let lines: ManifestLine[]; try { lines=shipmentManifest(b.items); } catch(e) { throw new MoveError((e as Error).message); }
    if(typeof b.from!=='string'||typeof b.to!=='string'||!isPool(b.from)||!isPool(b.to)||b.from===b.to) throw new MoveError('Select two different map warehouses. Same-map stock is already shared.');
    if(!['ship','plane','jet','boat'].includes(String(b.mode)))throw new MoveError('Cross-map goods go by ship or plane, not truck.');
    for(const l of lines)parseItem(l.item);
    return {lines,from:b.from,to:b.to,qty:manifestUnits(lines)};
  }
  async batchQuote(name: string,b: Record<string,unknown>) {
    const x=this.batchInput(b);const lg=getLogistics();if(!lg)throw new MoveError('Freight is offline right now.');
    const first=parseItem(x.lines[0].item);const p=await lg.planLeg(name,{mode:b.mode,vehicle:b.vehicle,fromHub:hubOfLoc(x.from),toHub:hubOfLoc(x.to),type:first.type,itemId:first.id,qty:x.qty,fromLoc:x.from,toLoc:x.to});
    lg.release(p.shipment.id);
    return {fee:p.shipment.fee,trips:p.trips,arriveAt:p.shipment.arriveAt,departAt:p.shipment.departAt,total:x.qty,types:x.lines.length,capacity:p.capacity,maxTotal:100000};
  }
  async batchMove(name: string,b: Record<string,unknown>) {
    return this.lock(playerKey(name),async()=>{
      const x=this.batchInput(b);if(typeof b.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(b.requestId))throw new MoveError('A shipment retry key is required.');
      if(!Number.isSafeInteger(b.maxFee)||Number(b.maxFee)<0)throw new MoveError('Review the shipment quote first.');
      const id='manifest:'+createHash('sha256').update(playerKey(name)+'\0'+b.requestId).digest('hex');
      const hash=createHash('sha256').update(JSON.stringify([x.from,x.to,b.mode,b.vehicle??null,x.lines])).digest('hex');
      const lg=getLogistics();if(!lg)throw new MoveError('Freight is offline right now.');
      // Separate fishing pool owns only the mutex connection. Transaction writes use LocStore/city-pack pools:
      // waiting requests cannot exhaust the very pool needed to commit the current dispatch.
      const cl=await this.fishPool().connect();const lock='manifest-dispatch:'+playerKey(name);let locked=false;
      try {
        await cl.query('SELECT pg_advisory_lock(hashtext($1))',[lock]);locked=true;
        const prior=(await cl.query('SELECT * FROM freight_shipments WHERE id=$1',[id])).rows[0];
        if(prior){const done=rowShip(prior);if(done.owner!==playerKey(name)||done.requestHash!==hash)throw new MoveError('That retry key belongs to a different shipment.');if(done.status==='transit')lg.admit(done);return {shipment:done,replayed:true};}
        if(this.pendingManifests.has(id))throw new MoveError('This shipment is still being confirmed. Retry the same shipment shortly.');
        for(const line of x.lines){const it=parseItem(line.item);let have:number;
          if(it.row==='fish'||it.row==='fdish')have=Number((await cl.query(`SELECT count(*)::int n FROM fish_catches WHERE player_key=$1 AND loc=$2 AND species=$3 AND sold_at IS NULL AND ${fishWhere(it.row)}`,[playerKey(name),x.from,it.id])).rows[0].n);
          else if(it.row==='dish')have=Number((await cl.query('SELECT count(*)::int n FROM kitchen_dishes WHERE player_key=$1 AND loc=$2 AND recipe=$3 AND sold_at IS NULL',[playerKey(name),x.from,it.id])).rows[0].n);
          else have=getLocStore().qty(name,x.from,line.item);
          if(have<line.qty)throw new MoveError(`Only ${have} ${itemLabel(line.item)} at ${locLabel(x.from)}.`);
          if(it.row==='stack'&&packed(x.to,line.item)&&getLocStore().qty(name,x.to,line.item)+this.inbound(name,x.to,line.item)+line.qty>MAX_BANKED_STACK)throw new MoveError(`Destination storage is full for ${itemLabel(line.item)}.`);
        }
        const first=parseItem(x.lines[0].item);const plan=await lg.planLeg(name,{mode:b.mode,vehicle:b.vehicle,fromHub:hubOfLoc(x.from),toHub:hubOfLoc(x.to),type:first.type,itemId:first.id,qty:x.qty,fromLoc:x.from,toLoc:x.to});
        const ship=plan.shipment;lg.release(ship.id);ship.id=id;ship.kind='batch';ship.manifest=x.lines;ship.requestHash=hash;lg.ships.set(id,ship);
        const bank=getBank();let unknown=false;this.pendingManifests.add(id);
        try {
          if(ship.fee>Number(b.maxFee))throw new MoveError('The shipping fee changed. Review a new quote before dispatch.');
          const w=ship.fee?bank.transferAtomic([{name,amount:-ship.fee,key:`freight:${id}`,game:'freight',memo:`${x.lines.length} item types / ${x.qty} units ${locLabel(x.from)} → ${locLabel(x.to)}`} ]):null;
          const late=(ok:boolean)=>{this.pendingManifests.delete(id);if(ok){w?.confirm();lg.admit(ship);}else{w?.revert();lg.release(id);}};
          const rows:Stmt[]=[...this.manifestRows(name,x.lines,`transit:${id}`,x.from),shipStmt(ship),...(w?.stmts??[]),...(plan.surplus?treasuryStmtsFor(name,'freight',plan.surplus,'Freight lever surplus'):[])];
          const deltas=x.lines.filter(l=>parseItem(l.item).row==='stack').map(l=>({loc:x.from,item:l.item,delta:-l.qty}));
          let promise:Promise<void>;
          try {const p=getLocStore().adjust(name,deltas,rows,{after:w?.after,committed:()=>this.manifestExists(id),onLate:late});if(p===false)throw new MoveError('Some selected stock just moved. Nothing was sent.');promise=p;}
          catch(e){w?.revert();throw e;}
          w?.bind(promise);
          try{await promise;}catch(e){const verdict=isOutcomeUnknown(e)?null:await outcome(()=>this.manifestExists(id));
            if(verdict===false){w?.revert();throw new MoveError('The whole shipment failed. Nothing was moved or charged.');}
            if(verdict===null){unknown=true;if(!isOutcomeUnknown(e))void this.reconcileManifest(id,late);throw new MoveError('Shipment confirmation is pending. Retry this same shipment, not a new one.');}
            w?.confirm();
          }
          this.pendingManifests.delete(id);lg.admit(ship);return {shipment:ship,replayed:false};
        }catch(e){if(!unknown){this.pendingManifests.delete(id);lg.release(id);}throw e;}
      }finally{let failed:Error|undefined;try{if(locked)await cl.query('SELECT pg_advisory_unlock(hashtext($1))',[lock]);}catch(e){failed=e as Error;}(cl as {release:(error?:Error)=>void}).release(failed);}
    });
  }
  private async manifestExists(id:string){return !!(await (getLocStore().pool??this.fishPool()).query('SELECT 1 FROM freight_shipments WHERE id=$1',[id])).rows.length;}
  private async reconcileManifest(id:string,late:(ok:boolean)=>void){for(let i=0;;i++){await new Promise(r=>setTimeout(r,Math.min(60000,1000*2**Math.min(i,6))));const v=await outcome(()=>this.manifestExists(id),1);if(v!==null){late(v);return;}}}
  /** Move original fish/cooked rows, preserving IDs, quality, weight and every other metadata column. */
  private manifestRows(name:string,lines:ManifestLine[],to:string,from:string):Stmt[]{
    return lines.flatMap(line=>{const it=parseItem(line.item);if(it.row==='stack')return [];
      const table=it.row==='dish'?'kitchen_dishes':'fish_catches';const field=it.row==='dish'?'recipe':'species';const time=it.row==='dish'?'cooked_at':'caught_at';const extra=it.row==='dish'?'':` AND ${fishWhere(it.row)}`;
      return [{sql:`WITH moved AS (UPDATE ${table} SET loc=$5 WHERE id IN (SELECT id FROM ${table} WHERE player_key=$1 AND loc=$2 AND ${field}=$3 AND sold_at IS NULL${extra} ORDER BY ${time},id LIMIT $4 FOR UPDATE) RETURNING 1) SELECT 1 / CASE WHEN (SELECT count(*) FROM moved)=$4 THEN 1 ELSE 0 END AS ok`,args:[playerKey(name),from,it.id,line.qty,to]}];
    });
  }
  private async batchArrive(s:Shipment){
    if(!s.manifest||!isPool(s.toLoc??''))throw new MoveError('Invalid manifest destination.');const lines=shipmentManifest(s.manifest);const to=s.toLoc!;
    if(await this.delivered(s.id))return;
    const att=randomUUID();const mine=()=>this.arrivalIs(s.id,att);
    for(const l of lines)if(packed(to,l.item)&&getLocStore().qty(s.ownerName,to,l.item)+l.qty>MAX_BANKED_STACK)throw new MoveError('Destination full; the complete shipment is held safely for retry.');
    const rows=[...this.manifestRows(s.ownerName,lines,to,`transit:${s.id}`),mustOne("UPDATE freight_shipments SET status='delivered' WHERE id=$1 AND status=$2",[s.id,MANIFEST_MOVING]),arrivalMark(s.id,att,this.clock())];
    const deltas=lines.filter(l=>parseItem(l.item).row==='stack').map(l=>({loc:to,item:l.item,delta:l.qty}));
    const p=getLocStore().adjust(s.ownerName,deltas,rows,{committed:mine});if(p===false)throw new MoveError('Destination storage unavailable.');
    try{await p;}catch(e){if(await this.delivered(s.id))return;throw e;}
    this.onArrive?.(s);
  }

  // ------------------------------------------------------------------ arrival
  /** Credit a delivered load at its destination exactly once (called by Logistics.tick; rejection = retried). */
  async arrive(s: Shipment): Promise<void> {
    if(s.kind==='batch')return this.batchArrive(s);
    const to = parseLoc(s.toLoc); const item = `${s.type}:${s.itemId}`; const it = parseItem(item);
    const flip = mustOne("UPDATE freight_shipments SET status = 'delivered' WHERE id = $1 AND status = 'moving'", [s.id]);
    // Already delivered (an earlier attempt / another instance): never credit again. The commit-check below can not tell
    // a duplicate attempt from a lost acknowledgement, so a delivered leg is refused up front.
    if (await this.delivered(s.id)) return;
    // Durable per-attempt identity: this row commits with the credit iff THIS attempt landed (PK = shipment: at most once).
    const att = randomUUID(); const mark = arrivalMark(s.id, att, this.clock()); const mine = () => this.arrivalIs(s.id, att);
    try {
      if (it.row === 'fish' || it.row === 'fdish') {
        await this.tx(this.fishPool(), [{ sql: 'UPDATE fish_catches SET loc = $2 WHERE loc = $1', args: [`transit:${s.id}`, to.id] }, flip]);
      } else if (it.row === 'dish') {
        await this.tx(this.fishPool(), [{ sql: 'UPDATE kitchen_dishes SET loc = $2 WHERE loc = $1', args: [`transit:${s.id}`, to.id] }, flip]);
      } else {
        const key = arrivalKey(item, to.kind); const [t, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
        if (to.kind === 'factory') {
          if (!PACK_TYPES.has(t)) throw new Error(`factory can't store ${key}`);
          const mines = getMines(); if (!mines.store || mines.offline) throw new Error('factory storage offline (arrival retried)');
          let fail: Error | null = null; let done: Promise<unknown> = Promise.resolve(); let fb: Stmt[] | null = null;
          if (!mines.adjustStack(s.ownerName, t as ItemType, id, s.qty, [flip, mark], (r) => { fb = r; }, { bind: (x) => { done = x; }, onFail: (e) => { fail = e; }, committed: mine })) throw new Error('could not store');
          if (fb) { const wp = (getWarehouse() as unknown as { pool: LocPool | null }).pool; if (wp) await this.tx(wp, fb); } else await done; if (fail) throw fail;
        } else {
          const r = getLocStore().adjust(s.ownerName, [{ loc: to.id, item: key, delta: s.qty }], [flip, mark], { committed: mine }); if (r === false) throw new Error('could not store');
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
  /** Did THIS arrival attempt commit? (its own durable marker, never the shipment status) */
  private async arrivalIs(id: string, att: string): Promise<boolean> { return (await (getLocStore().pool ?? this.fishPool()).query('SELECT 1 FROM freight_arrivals WHERE ship_id = $1 AND attempt = $2', [id, att])).rows.length > 0; }
  private async delivered(id: string): Promise<boolean> { return String((await this.fishPool().query('SELECT status FROM freight_shipments WHERE id = $1', [id])).rows[0]?.status ?? '') === 'delivered'; }
  private async shipExists(id: string): Promise<boolean> { return !!(await this.fishPool().query('SELECT 1 FROM freight_shipments WHERE id = $1', [id])).rows.length; }

  /** Factory-to-factory loads (Freight Yard) and every legacy in-flight 'move' load: credited exactly once at the
   *  recipient's factory store. A recipient without a factory: the load waits at the dock (stays in transit, retried
   *  with backoff, reported by the migration) until they build one - never credited elsewhere, never lost. */
  async arriveLegacy(s: Shipment): Promise<void> {
    if (!this.hasFactory(s.toName)) throw new Error(`held at the dock: ${s.toName} has no factory (shipment ${s.id})`);
    const mines = getMines(); if (!mines.store || mines.offline) throw new Error('factory storage offline (arrival retried)');
    if (await this.delivered(s.id)) return; // landed earlier (this or another instance): never credit again
    const flip = mustOne("UPDATE freight_shipments SET status = 'delivered' WHERE id = $1 AND status = 'transit'", [s.id]);
    const att = randomUUID(); const mark = arrivalMark(s.id, att, this.clock());
    let fail: Error | null = null; let done: Promise<unknown> = Promise.resolve();
    if (!mines.adjustStack(s.toName, s.type, s.itemId, s.qty, [flip, mark], undefined, { bind: (x) => { done = x; }, onFail: (e) => { fail = e; }, committed: () => this.arrivalIs(s.id, att) })) throw new Error('could not store');
    await done; if (fail) { if (await this.delivered(s.id).catch(() => false)) return; throw fail; }
  }

  // ------------------------------------------------------------------ selling (Chud City Warehouse only)
  async sell(name: string, b: Record<string, unknown>) {
    return this.lock(playerKey(name), () => this.sell0(name, b));
  }
  private async sell0(name: string, b: Record<string, unknown>) {
    // Map pools: sell from either map's warehouse (your city or resort inventory), no hauling first.
    const at = b.from === undefined ? WAREHOUSE : String(b.from);
    if (!isPool(at)) throw new MoveError('Goods sell from your map warehouse (Chud City or Resort).');
    const it = parseItem(b.item); const have = await this.qty(name, at, it.item);
    const qty = b.qty === undefined || b.qty === null || b.qty === 'all' ? have : Math.floor(Number(b.qty));
    if (!Number.isSafeInteger(qty) || qty < 1) throw new MoveError(have ? 'Pick a quantity.' : 'Nothing of that at this warehouse.');
    if (qty > have) throw new MoveError(`Only ${have.toLocaleString('en-US')} ${itemLabel(it.item)} at the Warehouse.`);
    const key = playerKey(name);
    if (it.row === 'fish' || it.row === 'fdish') {
      const ids = (await this.fishPool().query(`SELECT id FROM fish_catches WHERE player_key = $1 AND loc = $2 AND species = $3 AND sold_at IS NULL AND ${fishWhere(it.row)} ORDER BY caught_at, id LIMIT $4`, [key, at, it.id, qty])).rows.map((r) => String(r.id));
      const f = getFishing(); if (!f) throw new MoveError('Fishing is offline right now.');
      return f.sell(name, ids);
    }
    if (it.row === 'dish') {
      const ids = (await this.fishPool().query('SELECT id FROM kitchen_dishes WHERE player_key = $1 AND loc = $2 AND recipe = $3 AND sold_at IS NULL ORDER BY cooked_at, id LIMIT $4', [key, at, it.id, qty])).rows.map((r) => String(r.id));
      const c = getCooking(); if (!c) throw new MoveError('The kitchen is offline right now.');
      return c.sell(name, ids);
    }
    const ls = getLocStore();
    if (it.type === 'crop') {
      const farm = getFarm(); if (!farm) throw new MoveError('The farm is offline right now.');
      if (!ls.check(name, [{ loc: at, item: it.item, delta: -qty }])) throw new MoveError('Not enough at the Warehouse.');
      const sid = `wh:${randomUUID()}`; const d = [{ loc: at, item: it.item, delta: -qty }];
      let paid: number;
      try { paid = await farm.sellShipped({ id: sid, ownerName: name.trim(), itemId: it.id, qty }, ls.rowsFor(name, d), 'your Warehouse stock'); }
      catch (e) {
        // Lost acknowledgement? The sale's ledger key (whsale:<id>) exists iff it committed.
        const v = await outcome(async () => ((await this.fishPool().query('SELECT 1 FROM wallet_transactions WHERE tx_key = $1', [`whsale:${sid}`])).rows.length > 0));
        if (v === true) { ls.applyMem(name, d); throw new MoveError('That sale went through; your chips will show shortly.'); }
        if (v === null) throw new MoveError('That sale is still being confirmed. Nothing will be sold twice; check again in a minute.');
        throw e;
      }
      ls.applyMem(name, d);
      return { sold: qty, paid, chips: getBank().account(name).chips };
    }
    if (!PACK_TYPES.has(it.type) || !sellable({ type: it.type as ItemType, id: it.id })) throw new MoveError('The Warehouse does not buy that.');
    const mines = getMines(); const now = this.clock();
    let sale: ReturnType<typeof mines.houseSale>;
    try { sale = mines.houseSale(name, now, [{ type: it.type as ItemType, id: it.id, qty }]); } catch (e) { if (e instanceof MineError) throw new MoveError(e.message); throw e; }
    const r = ls.adjust(name, [{ loc: at, item: it.item, delta: -qty }], sale.stmts, { after: sale.w.after, marker: ledgerMarker(sale.stmts),
      onLate: (ok) => { if (ok) { sale.w.confirm(); sale.apply(); } else sale.w.revert(); } }); // an unknown outcome settles later: apply or undo then
    if (r === false) { sale.w.revert(); throw new MoveError('Not enough at the Warehouse.'); }
    sale.w.bind(r);
    try { await r; } catch (e) { if (isOutcomeUnknown(e)) throw new MoveError('That sale is still being confirmed. Nothing will be sold twice; check again in a minute.'); sale.w.revert(); console.error('[locmoves] sale failed:', (e as Error).message); throw new MoveError('That sale didn’t go through. Nothing was sold.'); }
    sale.apply();
    return { sold: qty, gross: sale.q.gross, paid: sale.q.paid, chips: getBank().account(name).chips };
  }

  // ------------------------------------------------------------------ legacy migration (Dayne: existing stock -> each owner's factory)
  /**
   * Runs at boot AFTER this server took the inventory writer fence (server/invFence.ts) and BEFORE it serves, so no
   * old-code writer can add or consume legacy rows meanwhile. Banked stock (mine_items) already IS factory stock. Moves:
   *  - unsold located-nowhere cooler fish / cooler dishes / kitchen dishes -> loc 'factory' (rows keep species/weight/value);
   *  - shared cutting-board fillets (kitchen_fillets) -> factory food:fillet_<kind> (guarded zeroing, one transaction);
   *  - the pooled resort plantation barn (building_inv 'resort_farm') -> loc_stock 'factory' crop:<id> (still crops).
   * Owners with no factory are HELD: their legacy rows stay exactly as they are (unusable), and are reported.
   * Every step is idempotent; a step that fails for one owner is reported as held with its reason, never skipped silently.
   * The report has per-owner/item totals before and after (conservation check).
   */
  async migrateLegacy(): Promise<{ fish: number; dishes: number; fillets: number; barn: number; held: Array<{ owner: string; what: string; why: string }>; freightHeld: Array<{ id: string; to: string; item: string; qty: number }>; conserved: boolean }> {
    const pool = this.fishPool(); const mines = getMines(); const ls = getLocStore(); const lg = getLogistics();
    if (!mines.store || mines.offline || !ls.loaded) throw new Error('storage not ready');
    const owners = new Set<string>([...mines.factories].filter(([, f]) => f.level > 0).map(([k]) => k)); for (const k of mines.fv2.keys()) owners.add(k);
    const list = [...owners]; const held: Array<{ owner: string; what: string; why: string }> = [];
    const totals = async () => {
      const t = new Map<string, number>(); const add = (k: string, n: number) => t.set(k, (t.get(k) ?? 0) + n);
      for (const r of (await pool.query("SELECT player_key k, species s, (dish IS NOT NULL) d, count(*)::int n FROM fish_catches WHERE sold_at IS NULL GROUP BY 1,2,3")).rows) add(`${r.k}|${r.d ? 'fdish' : 'fish'}:${r.s}`, Number(r.n));
      for (const r of (await pool.query('SELECT player_key k, recipe s, count(*)::int n FROM kitchen_dishes WHERE sold_at IS NULL GROUP BY 1,2')).rows) add(`${r.k}|dish:${r.s}`, Number(r.n));
      for (const r of (await pool.query('SELECT player_key k, kind s, qty n FROM kitchen_fillets WHERE qty > 0')).rows) add(`${r.k}|food:fillet_${r.s}`, Number(r.n));
      for (const r of (await pool.query("SELECT player_key k, item_type t, item_id s, qty n FROM mine_items WHERE item_type = 'food' AND item_id LIKE 'fillet\\_%'")).rows) add(`${r.k}|${r.t}:${r.s}`, Number(r.n));
      for (const r of (await pool.query("SELECT player_key k, item s, qty n FROM building_inv WHERE building = 'resort_farm' AND qty > 0").catch(() => ({ rows: [] as Array<Record<string, unknown>> }))).rows) add(`${r.k}|${r.s}`, Number(r.n));
      for (const r of (await pool.query("SELECT player_key k, item s, qty n FROM loc_stock WHERE loc = 'factory' AND item LIKE 'crop:%'")).rows) add(`${r.k}|${r.s}`, Number(r.n));
      return t;
    };
    const before = await totals();
    const fish = (await pool.query("UPDATE fish_catches SET loc = 'factory' WHERE loc IS NULL AND sold_at IS NULL AND player_key = ANY($1::text[])", [list])).rowCount ?? 0;
    const dishes = (await pool.query("UPDATE kitchen_dishes SET loc = 'factory' WHERE loc IS NULL AND sold_at IS NULL AND player_key = ANY($1::text[])", [list])).rowCount ?? 0;
    let fillets = 0, barn = 0;
    for (const r of (await pool.query('SELECT player_key, kind, qty FROM kitchen_fillets WHERE qty > 0')).rows) {
      const k = String(r.player_key); const q = Number(r.qty); const kind = String(r.kind);
      if (!owners.has(k)) { held.push({ owner: k, what: `${q} fillet_${kind}`, why: 'no factory' }); continue; }
      const nm = mines.names.get(k) ?? mines.fv2Names.get(k) ?? k;
      let fail: Error | null = null; let done: Promise<unknown> = Promise.resolve();
      const guard = mustOne('UPDATE kitchen_fillets SET qty = 0 WHERE player_key = $1 AND kind = $2 AND qty = $3', [k, kind, q]);
      const gone = async () => Number((await pool.query('SELECT qty FROM kitchen_fillets WHERE player_key = $1 AND kind = $2', [k, kind])).rows[0]?.qty ?? -1) === 0;
      if (mines.stackQty(nm, 'food', `fillet_${kind}`) + q > MAX_BANKED_STACK) { held.push({ owner: k, what: `${q} fillet_${kind}`, why: 'factory stack full' }); continue; }
      if (!mines.adjustStack(nm, 'food', `fillet_${kind}`, q, [guard], undefined, { bind: (x) => { done = x; }, onFail: (e) => { fail = e; }, committed: gone })) { held.push({ owner: k, what: `${q} fillet_${kind}`, why: 'could not apply' }); continue; }
      await done; if (fail) held.push({ owner: k, what: `${q} fillet_${kind}`, why: (fail as Error).message.slice(0, 80) }); else fillets += q;
    }
    for (const r of (await pool.query("SELECT player_key, name, item, qty FROM building_inv WHERE building = 'resort_farm' AND qty > 0").catch(() => ({ rows: [] as Array<Record<string, unknown>> }))).rows) {
      const k = String(r.player_key); const q = Number(r.qty); const item = String(r.item);
      if (!owners.has(k)) { held.push({ owner: k, what: `${q} ${item} (resort barn)`, why: 'no factory' }); continue; }
      if (!item.startsWith('crop:')) { held.push({ owner: k, what: `${q} ${item} (resort barn)`, why: 'not a crop' }); continue; }
      const nm = String(r.name || k);
      const guard = mustOne("UPDATE building_inv SET qty = 0 WHERE player_key = $1 AND building = 'resort_farm' AND item = $2 AND qty = $3", [k, item, q]);
      const gone = async () => Number((await pool.query("SELECT qty FROM building_inv WHERE player_key = $1 AND building = 'resort_farm' AND item = $2", [k, item])).rows[0]?.qty ?? -1) === 0;
      const p = ls.adjust(nm, [{ loc: FACTORY, item, delta: q }], [guard], { committed: gone });
      try { if (p === false) throw new Error('could not apply'); await p; barn += q; } catch (e) { held.push({ owner: k, what: `${q} ${item} (resort barn)`, why: (e as Error).message.slice(0, 80) }); }
    }
    for (const r of (await pool.query('SELECT DISTINCT player_key FROM fish_catches WHERE loc IS NULL AND sold_at IS NULL')).rows) held.push({ owner: String(r.player_key), what: 'cooler fish', why: 'no factory' });
    for (const r of (await pool.query('SELECT DISTINCT player_key FROM kitchen_dishes WHERE loc IS NULL AND sold_at IS NULL')).rows) held.push({ owner: String(r.player_key), what: 'kitchen dishes', why: 'no factory' });
    // In-flight legacy freight to a player with no factory: it waits at the dock (see arriveLegacy) - reported, not guessed.
    const freightHeld = lg ? [...lg.ships.values()].filter((x) => (x.kind ?? 'move') === 'move' && !this.hasFactory(x.toName)).map((x) => ({ id: x.id, to: x.toKey, item: `${x.type}:${x.itemId}`, qty: x.qty })) : [];
    // Conservation: every owner/item total (fillets counted on the board + in the factory; barn crops in the barn + factory crops).
    const after = await totals(); const keys = new Set([...before.keys(), ...after.keys()]);
    const norm = (t: Map<string, number>) => { const o = new Map<string, number>(); for (const [k, n] of t) o.set(k, (o.get(k) ?? 0) + n); return o; };
    const b0 = norm(before), a0 = norm(after); let conserved = true; for (const k of keys) if ((b0.get(k) ?? 0) !== (a0.get(k) ?? 0)) { conserved = false; console.error('[locmoves] CONSERVATION MISMATCH', k, b0.get(k), a0.get(k)); }
    const report = { fish, dishes, fillets, barn, held, freightHeld, conserved, at: this.clock() };
    await pool.query("INSERT INTO loc_migrations (id, at, report) VALUES ('legacy-to-factory-v1', $1, $2) ON CONFLICT (id) DO UPDATE SET report = loc_migrations.report || jsonb_build_object('last', EXCLUDED.report)", [this.clock(), JSON.stringify(report)]);
    console.log('[locmoves] legacy -> factory:', JSON.stringify({ fish, dishes, fillets, barn, held: held.length, freightHeld: freightHeld.length, conserved }));
    return report;
  }
  ready = false;
  /** The boot migration's report (moved counts, held owners, held freight, conservation) for the operator log / tests. */
  lastMigration: Awaited<ReturnType<LocMoves['migrateLegacy']>> | null = null;
}

let lm = new LocMoves();
export const getLocMoves = () => lm;
export const setLocMoves = (x: LocMoves) => { lm = x; };
/** Hook producers + freight into per-location stock (idempotent). */
const arrivalMark = (id: string, att: string, at: number): Stmt => ({ sql: 'INSERT INTO freight_arrivals (ship_id, attempt, at) VALUES ($1,$2,$3)', args: [id, att, at] });
export function wireLocMoves() {
  const mines = getMines();
  const caveDeltas = (stacks: Array<{ type: string; id: string; qty: number }>, cave: string) => stacks.filter((x) => x.qty > 0).map((x) => ({ loc: mineLoc(cave), item: `${x.type}:${x.id}`, delta: x.qty }));
  if (!mines.cityBin) mines.cityBin = (acct, stacks, cave) => { if (!getLocStore().loaded) throw new MineError('Cave storage is starting up. Try again in a moment.'); return getLocStore().rowsFor(acct, caveDeltas(stacks, cave)); };
  if (!mines.cityBinDone) mines.cityBinDone = (acct, stacks, cave) => getLocStore().applyMem(acct, caveDeltas(stacks, cave));
  const lg = getLogistics(); if (lg && !lg.onLoc) lg.onLoc = (s) => lm.arrive(s);
  if (lg && !lg.onLegacy) lg.onLegacy = (s) => lm.arriveLegacy(s);
}
/** Boot step (awaited before the server listens): wire producers + freight, then run the legacy migration until it
 *  succeeds. Until then nothing is served (fail closed); no DB = dev memory mode, nothing to migrate. */
/** Map pools (mapPools.ts) supersede the legacy->factory migration: once folded it never runs again, so legacy HELD
 *  entries (NULL-loc fish/dishes, kitchen_fillets, the resort barn) stay exactly where they are; no map is guessed. */
export async function poolsFolded(): Promise<boolean> {
  const p = getLocStore().pool; if (!p) return false;
  return (await p.query("SELECT 1 FROM loc_migrations WHERE id = 'map-pools-v1'")).rows.length > 0;
}
export async function initLocMoves(opts: { dbUrl?: string | undefined } = {}) {
  wireLocMoves();
  if (!opts.dbUrl) { lm.ready = true; return; }
  // Bounded: a few attempts (storage still connecting / transient errors), then FAIL the boot (invFence releases the fence
  // only if that is provably safe). A failed conservation check is never retried: it stops the boot at once.
  const tries = Number(process.env.LM_MIGRATE_TRIES ?? 6);
  for (let i = 0; ; i++) {
    if (!fenceHeld()) throw new Error('[locmoves] a newer server holds the inventory fence: not serving inventory (fail closed)');
    const m = getMines(); let err: Error | null = null;
    if (getFishing() && getCooking() && m.store && !m.offline && getLocStore().loaded) {
      const t0 = Date.now(); let r: Awaited<ReturnType<LocMoves['migrateLegacy']>> | null = null;
      const hook = process.env.NODE_ENV === 'test' ? process.env.LM_TEST_FAIL : undefined; // test-only failure injection
      if (hook === 'hang') await new Promise(() => {});
      if (hook === 'premigrate') throw new Error('[locmoves] test: boot failed before migrating');
      try { await markMigrating(); if (hook === 'migrate') throw new Error('test: migration failed midway'); r = (await poolsFolded()) ? { conserved: true, skipped: 'map-pools-v1' } as unknown as typeof r : await lm.migrateLegacy(); } catch (e) { err = e as Error; console.error('[locmoves] legacy migration attempt failed:', err.message); }
      if (r) {
        lm.lastMigration = r; console.log(`[locmoves] migration took ${Date.now() - t0} ms`);
        if (!r.conserved) throw new Error('[locmoves] conservation check failed: see the log; not serving inventory');
        lm.ready = true; return; // the caller marks the process ready (invFence.markReady) right before it serves
      }
    } else err = new Error('storage not ready');
    if (i + 1 >= tries) throw new Error(`[locmoves] legacy migration did not complete after ${tries} attempts: ${err?.message ?? ''}`);
    await new Promise((r) => setTimeout(r, Math.min(30_000, 2000 * 2 ** Math.min(i, 4))));
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
    try { if (!lm.ready) throw new MoveError('Inventory is starting up. Nothing changed; try again in a moment.'); const n = need(); const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; const r = await fn(b, n); ack?.({ ok: true, ...(r as object), view: await lm.view(n) }); }
    catch (e) { ack?.({ ok: false, error: known(e) ? (e as Error).message : 'Something went wrong.' }); if (!known(e)) console.error('[locmoves]', e); }
  });
  on('loc_view', async (_b, n) => { void socket.join(`freight:${playerKey(n)}`); return {}; });
  on('loc_quote', async (b, n) => ({ quote: await lm.quote(n, b) }));
  on('loc_batch_quote', async(b,n)=>({quote:await lm.batchQuote(n,b)}));
  on('loc_batch_move', async(b,n)=>{const r=await lm.batchMove(n,b);const lg=getLogistics();if(lg)io.to('freight').emit('freight_live',lg.live());return r;});
  on('loc_move', async (b, n) => { const r = await lm.move(n, b); const lg = getLogistics(); if (lg) io.to('freight').emit('freight_live', lg.live()); return r; });
  on('loc_sell', async (b, n) => { awayFromMarket(n, MoveError); return { result: await lm.sell(n, b) }; });
}
