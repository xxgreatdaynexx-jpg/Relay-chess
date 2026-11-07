import { isOutcomeUnknown } from './locstock.js';
import { invReady } from './invFence.js';
/**
 * Supply chain contracts (rules + sizing: shared/coop3.ts). A seller delivers goods to a buyer by truck on a schedule.
 *
 * Exploit safety
 *  - Chips: the seller's bond and the buyer's escrow are taken when the contract is made, and every payout comes out of
 *    them, through keyed wallet moves (sc_bond / sc_escrow / sc_pay / sc_miss / sc_breach / sc_end) in the SAME Postgres
 *    transaction as the contract snapshot and a guard row in sc_events (PK = contract + step), so a replay or a double
 *    tick can never pay twice.
 *  - Goods: dispatch takes them out of the seller's Warehouse and arrival puts them in the buyer's, each through
 *    Mines.adjustStack with the contract snapshot + guard row (+ the payout) in that one pack transaction.
 *  - Every mutation runs on ONE serial lock; memory only changes after the commit succeeds.
 *  - QA, bot and jailed accounts are excluded; both sides need account age + play time; linked accounts (same device or
 *    network in the last 30 days) can't contract with each other; the unit price must be within ±30% of house price.
 */
import type { Server, Socket } from 'socket.io';
import { getBank } from './casino-store.js';
import { getLocStore } from './locstock.js';
import { WAREHOUSE } from '../shared/inventoryLocations.js';
import { px } from './price-index.js';
import { isStackable } from './market.js';
import { getLogistics, setExtraBusyTrucks } from './logistics.js';
import { playerKey } from './skins.js';
import { roomOf } from './wallet-sockets.js';
import { getLinks, socketSigs } from './linked.js';
import { Coop3Error, Guard, NONCE, friendly, openPool, runTx, type PoolLike, type Stmt } from './coop3-gate.js';
import { TRUCK_BY_ID, truckTravelMs } from '../shared/logistics.js';
import { nameOf, priceOf, type ItemType } from '../shared/mines.js';
import {
  SC_BUYER_CANCEL_FEE, SC_GRACE_MS, SC_INTERVALS_H, SC_MAX_DELIVERIES, SC_MAX_MISSES, SC_MAX_OPEN, SC_MAX_QTY, SC_MIN_DELIVERIES, SC_MIN_VALUE, SC_OFFER_TTL_MS,
  scBand, scBond, scDueAt, scPenalty, scPriceOk, scValue, type ScStatus, type ScView,
} from '../shared/coop3.js';

export const SC_MIGRATION = `
CREATE TABLE IF NOT EXISTS supply_contracts (id TEXT PRIMARY KEY, seller_key TEXT NOT NULL, buyer_key TEXT NOT NULL, status TEXT NOT NULL, data JSONB NOT NULL, updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS sc_events (id TEXT PRIMARY KEY, contract TEXT NOT NULL, kind TEXT NOT NULL, at BIGINT NOT NULL);
`;
interface Sc {
  id: string; seller: string; buyer: string; type: ItemType; itemId: string; qty: number; unit: number; n: number; intervalMs: number; status: ScStatus;
  createdAt: number; startAt: number | null; k: number; delivered: number; missed: number; escrow: number; bond: number; bond0: number;
  transit: { k: number; arriveAt: number; truck: string } | null; cancelReq: 'seller' | 'buyer' | null; endedAt: number | null;
}
type Move = { name: string; amount: number; key: string; game: string; memo?: string };
const LIVE: ScStatus[] = ['pending', 'active'];
const fmt = (n: number) => n.toLocaleString('en-US');

export class SupplyContracts {
  private all = new Map<string, Sc>();
  private chain: Promise<unknown> = Promise.resolve();
  guard: Guard;
  /** Owned trucks + busy trucks (logistics). Injectable for tests. */
  trucksOf: (name: string) => Array<{ id: string; truckId: string }> = (n) => getLogistics()?.owned(n) ?? [];
  freightBusy: (name: string) => Set<string> = (n) => getLogistics()?.busyTrucks(n) ?? new Set();
  onChange?: (c: Sc, event: string) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly pool: PoolLike | null, private readonly clock = () => Date.now()) { this.guard = new Guard(pool, clock); }

  async init() {
    if (!this.pool) return; await this.pool.query(SC_MIGRATION);
    for (const r of (await this.pool.query("SELECT data FROM supply_contracts WHERE status IN ('pending','active') OR updated_at > $1", [this.clock() - 30 * 86_400_000])).rows) {
      const d = (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as Sc; this.all.set(d.id, d);
    }
  }
  start(ms = 15_000) { if (!this.timer) { this.timer = setInterval(() => { if (!invReady()) return; void this.tick().catch((e) => console.error('[supply] tick failed:', (e as Error).message)); }, ms); this.timer.unref?.(); } }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  private serial<T>(fn: () => Promise<T>): Promise<T> { const p = this.chain.then(fn, fn); this.chain = p.catch(() => {}); return p; }

  /** Trucks this player has out on contract deliveries (also busy for freight). */
  contractTrucks(name: string): string[] { const k = playerKey(name); return [...this.all.values()].filter((c) => c.transit && playerKey(c.seller) === k).map((c) => c.transit!.truck); }
  get(id: string) { return this.all.get(id) ?? null; }
  private row(c: Sc): Stmt { return { sql: 'INSERT INTO supply_contracts (id, seller_key, buyer_key, status, data, updated_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at', args: [c.id, playerKey(c.seller), playerKey(c.buyer), c.status, JSON.stringify(c), this.clock()] }; }
  private ev(c: Sc, kind: string): Stmt { return { sql: 'INSERT INTO sc_events (id, contract, kind, at) VALUES ($1,$2,$3,$4)', args: [`${c.id}#${kind}`, c.id, kind.split(':')[0], this.clock()] }; }

  /** Chip-only step: wallet moves + snapshot + guard in one transaction; memory updated after commit. */
  private async commitChips(next: Sc, kind: string, moves: Move[], event: string) {
    const bank = getBank(); const live = moves.filter((m) => m.amount !== 0);
    let w: ReturnType<typeof bank.transferAtomic> | null;
    try { w = live.length ? bank.transferAtomic(live) : null; } catch (e) { throw new Coop3Error(/Already/.test((e as Error).message) ? 'Already applied.' : 'Not enough chips.'); }
    const p = (async () => { await w?.after; await runTx(this.pool, [this.ev(next, kind), this.row(next), ...(w?.stmts ?? [])]); })(); w?.bind(p);
    try { await p; } catch (e) { w?.revert(); throw new Coop3Error(friendly(e)); }
    this.all.set(next.id, next); this.onChange?.(next, event);
  }
  /** Goods step: the stack delta + snapshot + guard (+ wallet moves) in one pack transaction. */
  private async commitGoods(owner: string, next: Sc, kind: string, delta: number, moves: Move[], event: string, short: string) {
    const bank = getBank(); const live = moves.filter((m) => m.amount !== 0);
    let w: ReturnType<typeof bank.transferAtomic> | null;
    try { w = live.length ? bank.transferAtomic(live) : null; } catch (e) { throw new Coop3Error(/Already/.test((e as Error).message) ? 'Already applied.' : 'Not enough chips.'); }
    // Truck logistics: supply-contract goods leave from / land at the Chud City Warehouse (loc_stock 'warehouse').
    const r = getLocStore().adjust(owner, [{ loc: WAREHOUSE, item: `${next.type}:${next.itemId}`, delta }], [this.ev(next, kind), this.row(next), ...(w?.stmts ?? [])], { after: w?.after,
      marker: { sql: 'SELECT 1 FROM sc_events WHERE id = $1', args: [`${next.id}#${kind}`] }, // the step's event row exists iff it committed
      onLate: (ok) => { if (ok) { w?.confirm(); this.all.set(next.id, next); this.onChange?.(next, event); } else w?.revert(); } });
    if (r === false) { w?.revert(); throw new Coop3Error(short); }
    w?.bind(r);
    try { await r; } catch (e) { if (isOutcomeUnknown(e)) throw new Coop3Error('Still confirming that step. Nothing will happen twice; check again in a minute.'); w?.revert(); throw new Coop3Error(friendly(e)); }
    this.all.set(next.id, next); this.onChange?.(next, event);
  }
  private openCount(name: string) { const k = playerKey(name); return [...this.all.values()].filter((c) => LIVE.includes(c.status) && (playerKey(c.seller) === k || playerKey(c.buyer) === k)).length; }
  private bigTruck(name: string, qty: number) { return this.trucksOf(name).some((t) => (TRUCK_BY_ID.get(t.truckId)?.cap ?? 0) >= qty); }
  private role(c: Sc, name: string): 'seller' | 'buyer' | null { const k = playerKey(name); return playerKey(c.seller) === k ? 'seller' : playerKey(c.buyer) === k ? 'buyer' : null; }
  private need(id: unknown, name: string) { const c = typeof id === 'string' ? this.all.get(id) : undefined; const r = c ? this.role(c, name) : null; if (!c || !r) throw new Coop3Error('No such contract.'); return { c, r }; }
  private label(c: Sc) { return `${fmt(c.qty)} ${nameOf({ type: c.type, id: c.itemId })}`; }
  ref(type: ItemType, id: string) { return Math.max(0, px(priceOf({ type, id }))); }

  /** Seller proposes; their bond is held now. */
  propose(seller: string, input: { buyer?: unknown; type?: unknown; id?: unknown; qty?: unknown; unit?: unknown; intervalH?: unknown; n?: unknown; nonce?: unknown }): Promise<ScView & { replay?: true }> {
    return this.serial(async () => {
      if (typeof input.nonce !== 'string' || !NONCE.test(input.nonce)) throw new Coop3Error('Bad request.');
      const id = `sc:${playerKey(seller)}:${input.nonce}`; const prev = this.all.get(id); if (prev) return { ...this.view(prev, seller), replay: true as const };
      const buyer = typeof input.buyer === 'string' ? input.buyer.replace(/\s+/g, ' ').trim() : '';
      if (!buyer) throw new Coop3Error('Pick a buyer.');
      this.guard.gate(seller); this.guard.gate(buyer, buyer); this.guard.noLink(seller, buyer);
      if (!isStackable(input.type, input.id)) throw new Coop3Error('Pick something from your Warehouse to sell.');
      const type = input.type as ItemType; const itemId = input.id as string;
      const qty = Number(input.qty), unit = Number(input.unit), n = Number(input.n), ih = Number(input.intervalH);
      if (!Number.isInteger(qty) || qty < 1 || qty > SC_MAX_QTY) throw new Coop3Error(`Each delivery is 1–${fmt(SC_MAX_QTY)} units.`);
      if (!Number.isInteger(n) || n < SC_MIN_DELIVERIES || n > SC_MAX_DELIVERIES) throw new Coop3Error(`Pick ${SC_MIN_DELIVERIES}–${SC_MAX_DELIVERIES} deliveries.`);
      if (!(SC_INTERVALS_H as readonly number[]).includes(ih)) throw new Coop3Error('Pick a delivery schedule.');
      const ref = this.ref(type, itemId); if (ref <= 0) throw new Coop3Error('That item has no house price.');
      if (!scPriceOk(unit, ref)) { const b = scBand(ref); throw new Coop3Error(`Price must be 🪙 ${fmt(b.lo)}–${fmt(b.hi)} each (±30% of today’s 🪙 ${fmt(ref)}).`); }
      if (scValue(unit, qty, n) < SC_MIN_VALUE) throw new Coop3Error(`Contracts must be worth at least 🪙 ${fmt(SC_MIN_VALUE)}.`);
      if (!this.bigTruck(seller, qty)) throw new Coop3Error(`You need a truck that carries ${fmt(qty)} (buy one at the truck store).`);
      if (this.openCount(seller) >= SC_MAX_OPEN) throw new Coop3Error(`You already have ${SC_MAX_OPEN} open contracts.`);
      if (this.openCount(buyer) >= SC_MAX_OPEN) throw new Coop3Error(`${buyer} already has ${SC_MAX_OPEN} open contracts.`);
      await this.guard.eligible(seller); await this.guard.eligible(buyer, buyer);
      const bond = scBond(unit, qty, n); const bank = getBank(); if (this.pool) await bank.refresh(seller);
      if (!bank.canAfford(seller, bond)) throw new Coop3Error(`You need 🪙 ${fmt(bond)} for the bond (20% of the contract).`);
      const c: Sc = { id, seller: seller.trim(), buyer, type, itemId, qty, unit, n, intervalMs: ih * 3_600_000, status: 'pending', createdAt: this.clock(), startAt: null, k: 0, delivered: 0, missed: 0, escrow: 0, bond, bond0: bond, transit: null, cancelReq: null, endedAt: null };
      await this.commitChips(c, 'propose', [{ name: seller, amount: -bond, key: `sc_bond:${id}`, game: 'supply', memo: `🚚 Supply contract bond: ${this.label(c)} × ${n} to ${buyer}` }], 'proposed');
      return this.view(c, seller);
    });
  }

  /** Buyer accepts; the whole contract price goes into escrow. */
  accept(buyer: string, cid: unknown): Promise<ScView> {
    return this.serial(async () => {
      const { c, r } = this.need(cid, buyer); if (r !== 'buyer') throw new Coop3Error('Only the buyer can accept.');
      if (c.status !== 'pending') throw new Coop3Error('That offer is no longer open.');
      if (this.clock() - c.createdAt > SC_OFFER_TTL_MS) throw new Coop3Error('That offer has expired.');
      this.guard.gate(c.seller, c.seller); this.guard.noLink(c.seller, buyer); await this.guard.eligible(buyer);
      const value = scValue(c.unit, c.qty, c.n); const bank = getBank(); if (this.pool) await bank.refresh(buyer);
      if (!bank.canAfford(buyer, value)) throw new Coop3Error(`You need 🪙 ${fmt(value)} to escrow this contract.`);
      const next: Sc = { ...c, status: 'active', startAt: this.clock(), escrow: value };
      await this.commitChips(next, 'accept', [{ name: buyer, amount: -value, key: `sc_escrow:${c.id}`, game: 'supply', memo: `🚚 Supply contract escrow: ${this.label(c)} × ${c.n} from ${c.seller}` }], 'accepted');
      return this.view(next, buyer);
    });
  }

  /** Pending offer: seller withdraws or buyer declines (bond back). */
  decline(name: string, cid: unknown): Promise<ScView> {
    return this.serial(async () => {
      const { c, r } = this.need(cid, name); if (c.status !== 'pending') throw new Coop3Error('That offer is no longer open.');
      return this.endPending(c, r === 'seller' ? 'withdrawn' : 'declined', name);
    });
  }
  private async endPending(c: Sc, status: ScStatus, viewer: string | null) {
    const next: Sc = { ...c, status, bond: 0, endedAt: this.clock() };
    await this.commitChips(next, 'end', [{ name: c.seller, amount: c.bond, key: `sc_end:${c.id}:s`, game: 'supply', memo: `🚚 Supply contract bond returned (${status})` }], status);
    return this.view(next, viewer);
  }

  /** Seller sends the next delivery from their Warehouse on an idle truck. */
  dispatch(seller: string, cid: unknown, truckWant?: unknown): Promise<ScView> {
    return this.serial(async () => {
      const { c, r } = this.need(cid, seller); if (r !== 'seller') throw new Coop3Error('Only the seller ships.');
      this.guard.gate(seller);
      if (c.status !== 'active' || c.startAt == null) throw new Coop3Error('That contract isn’t active.');
      if (c.transit) throw new Coop3Error('A delivery is already on the road.');
      const now = this.clock(); const due = scDueAt(c.startAt, c.intervalMs, c.k);
      if (now > due + SC_GRACE_MS) throw new Coop3Error('That delivery was missed.');
      if (now < due - c.intervalMs) throw new Coop3Error('Too early for the next delivery.');
      const busy = new Set([...this.freightBusy(seller), ...this.contractTrucks(seller)]);
      const fit = this.trucksOf(seller).filter((t) => !busy.has(t.id) && (TRUCK_BY_ID.get(t.truckId)?.cap ?? 0) >= c.qty);
      const t = (typeof truckWant === 'string' ? fit.find((x) => x.id === truckWant) : undefined) ?? fit.sort((a, b) => truckTravelMs(TRUCK_BY_ID.get(a.truckId)!) - truckTravelMs(TRUCK_BY_ID.get(b.truckId)!))[0];
      if (!t) throw new Coop3Error(`No idle truck that carries ${fmt(c.qty)}.`);
      const next: Sc = { ...c, transit: { k: c.k, arriveAt: now + truckTravelMs(TRUCK_BY_ID.get(t.truckId)!), truck: t.id } };
      await this.commitGoods(seller, next, `dispatch:${c.k}`, -c.qty, [], 'dispatched', `You don’t have ${this.label(c)} in your Warehouse.`);
      return this.view(next, seller);
    });
  }

  /** Cancel an active contract. mutual=true asks (or agrees); otherwise it's a unilateral walk-away with its penalty. */
  cancel(name: string, cid: unknown, mutual: unknown): Promise<ScView> {
    return this.serial(async () => {
      const { c, r } = this.need(cid, name);
      if (c.status !== 'active') throw new Coop3Error('That contract isn’t active.');
      if (c.transit) throw new Coop3Error('Wait for the truck on the road to arrive first.');
      const other = r === 'seller' ? 'buyer' : 'seller';
      if (c.cancelReq === other) { // both agreed: everyone gets their own money back
        const next: Sc = { ...c, status: 'cancelled', escrow: 0, bond: 0, cancelReq: null, endedAt: this.clock() };
        await this.commitChips(next, 'end', [
          { name: c.buyer, amount: c.escrow, key: `sc_end:${c.id}:b`, game: 'supply', memo: '🚚 Supply contract cancelled (both agreed): escrow back' },
          { name: c.seller, amount: c.bond, key: `sc_end:${c.id}:s`, game: 'supply', memo: '🚚 Supply contract cancelled (both agreed): bond back' }], 'cancelled');
        return this.view(next, name);
      }
      if (mutual === true) { if (c.cancelReq === r) return this.view(c, name); const next: Sc = { ...c, cancelReq: r }; await this.commitChips(next, `req:${r}:${c.k}:${c.missed}`, [], 'cancel_request'); return this.view(next, name); }
      if (r === 'seller') { // seller walks away = breach: buyer gets the escrow back and keeps the bond
        const next: Sc = { ...c, status: 'breached', escrow: 0, bond: 0, cancelReq: null, endedAt: this.clock() };
        await this.commitChips(next, 'end', [{ name: c.buyer, amount: c.escrow + c.bond, key: `sc_end:${c.id}:b`, game: 'supply', memo: `🚚 ${c.seller} broke a supply contract: escrow back + bond` }], 'breached');
        return this.view(next, name);
      }
      const fee = Math.floor(c.escrow * SC_BUYER_CANCEL_FEE); // buyer walks away: pays the seller a fee from escrow
      const next: Sc = { ...c, status: 'cancelled', escrow: 0, bond: 0, cancelReq: null, endedAt: this.clock() };
      await this.commitChips(next, 'end', [
        { name: c.buyer, amount: c.escrow - fee, key: `sc_end:${c.id}:b`, game: 'supply', memo: '🚚 Supply contract cancelled: escrow back less the cancel fee' },
        { name: c.seller, amount: c.bond + fee, key: `sc_end:${c.id}:s`, game: 'supply', memo: `🚚 ${c.buyer} cancelled a supply contract: bond back + cancel fee` }], 'cancelled');
      return this.view(next, name);
    });
  }

  /** Arrivals, misses and expiries. Each step is its own transaction; a failure is retried on the next tick. */
  tick(): Promise<number> {
    return this.serial(async () => {
      let done = 0; const now = this.clock();
      for (const c of [...this.all.values()]) {
        try {
          if (c.status === 'pending' && now - c.createdAt > SC_OFFER_TTL_MS) { await this.endPending(c, 'expired', null); done++; continue; }
          if (c.status !== 'active' || c.startAt == null) continue;
          if (c.transit && now >= c.transit.arriveAt) { await this.arrive(c); done++; continue; }
          if (!c.transit && now > scDueAt(c.startAt, c.intervalMs, c.k) + SC_GRACE_MS) { await this.miss(c); done++; }
        } catch (e) { console.error(`[supply] ${c.id} step failed:`, (e as Error).message); }
      }
      return done;
    });
  }
  private async arrive(c: Sc) {
    const k = c.transit!.k; const pay = c.unit * c.qty; const last = k + 1 >= c.n;
    const next: Sc = { ...c, transit: null, k: k + 1, delivered: c.delivered + 1, escrow: c.escrow - pay, cancelReq: null, ...(last ? { status: 'done' as const, bond: 0, endedAt: this.clock() } : {}) };
    await this.commitGoods(c.buyer, next, `arrive:${k}`, c.qty, [
      { name: c.seller, amount: pay, key: `sc_pay:${c.id}:${k}`, game: 'supply', memo: `🚚 Supply delivery ${k + 1}/${c.n}: ${this.label(c)} to ${c.buyer}` },
      ...(last ? [{ name: c.seller, amount: c.bond, key: `sc_end:${c.id}:s`, game: 'supply', memo: '🚚 Supply contract complete: bond back' }] : []),
    ], last ? 'done' : 'delivered', 'Delivery failed.');
  }
  private async miss(c: Sc) {
    const k = c.k; const pay = c.unit * c.qty;
    if (c.missed + 1 >= SC_MAX_MISSES) { // breach: buyer gets the rest of the escrow and the rest of the bond
      const next: Sc = { ...c, k: k + 1, missed: c.missed + 1, status: 'breached', escrow: 0, bond: 0, cancelReq: null, endedAt: this.clock() };
      await this.commitChips(next, `miss:${k}`, [{ name: c.buyer, amount: c.escrow + c.bond, key: `sc_breach:${c.id}`, game: 'supply', memo: `🚚 ${c.seller} breached a supply contract (${SC_MAX_MISSES} missed): escrow back + bond` }], 'breached');
      return;
    }
    const pen = Math.min(c.bond, scPenalty(c.bond0, c.n)); const last = k + 1 >= c.n;
    const next: Sc = { ...c, k: k + 1, missed: c.missed + 1, escrow: c.escrow - pay, bond: c.bond - pen, cancelReq: null, ...(last ? { status: 'done' as const, bond: 0, endedAt: this.clock() } : {}) };
    await this.commitChips(next, `miss:${k}`, [
      { name: c.buyer, amount: pay + pen, key: `sc_miss:${c.id}:${k}`, game: 'supply', memo: `🚚 Missed supply delivery ${k + 1}/${c.n} from ${c.seller}: refund + penalty` },
      ...(last ? [{ name: c.seller, amount: c.bond - pen, key: `sc_end:${c.id}:s`, game: 'supply', memo: '🚚 Supply contract finished: rest of bond back' }] : []),
    ], 'missed');
  }

  view(c: Sc, viewer: string | null): ScView {
    const nextDue = c.status === 'active' && c.startAt != null ? scDueAt(c.startAt, c.intervalMs, c.k) : null;
    return { id: c.id, seller: c.seller, buyer: c.buyer, type: c.type, itemId: c.itemId, name: nameOf({ type: c.type, id: c.itemId }), qty: c.qty, unit: c.unit, n: c.n, intervalMs: c.intervalMs,
      status: c.status, createdAt: c.createdAt, startAt: c.startAt, k: c.k, delivered: c.delivered, missed: c.missed, escrow: c.escrow, bond: c.bond, nextDue, transit: c.transit,
      cancelReq: c.cancelReq, role: viewer ? this.role(c, viewer) : null, endedAt: c.endedAt, ref: this.ref(c.type, c.itemId) };
  }
  list(viewer: string | null): ScView[] {
    if (!viewer) return []; const k = playerKey(viewer);
    const mine = [...this.all.values()].filter((c) => playerKey(c.seller) === k || playerKey(c.buyer) === k);
    const rank = (c: Sc) => (c.status === 'active' ? 0 : c.status === 'pending' ? 1 : 2);
    return mine.sort((a, b) => rank(a) - rank(b) || (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt)).slice(0, 30).map((c) => this.view(c, viewer));
  }
  /** Dev screenshots only: insert a contract directly. */
  devPut(c: Sc) { this.all.set(c.id, c); }
}

let sc = new SupplyContracts(null);
setExtraBusyTrucks((n) => sc.contractTrucks(n));
export const getSupply = () => sc;
export function resetSupply(s?: SupplyContracts) { sc = s ?? new SupplyContracts(null); return sc; }
export async function initSupply() {
  const pool = openPool('supply');
  if (pool) { try { const s = new SupplyContracts(pool); await s.init(); sc = s; console.log('[supply] ready'); } catch (e) { console.error('[supply] init failed:', (e as Error).message); } }
  sc.start();
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
let wiredIo: Server | null = null;
export function registerSupply(io: Server, socket: Socket): void {
  if (wiredIo !== io) { wiredIo = io; }
  sc.onChange = (c, event) => { for (const n of [c.seller, c.buyer]) wiredIo?.to(roomOf(n)).emit('sc_changed', { id: c.id, event }); };
  const nameOf_ = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const need = () => { const n = nameOf_(); if (!n) throw new Coop3Error('Sign in first.'); const s = socketSigs(socket); getLinks().record(n, s.ip, s.device); return n; };
  const on = (ev: string, fn: (b: Record<string, unknown>) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try { const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; ack?.({ ok: true, ...((await fn(b)) as object ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof Coop3Error || /^Not enough chips\./.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); if (!(e instanceof Coop3Error)) console.error(`[supply] ${ev} failed:`, (e as Error).message); }
  });
  const trucks = (n: string) => sc.trucksOf(n).map((t) => ({ id: t.id, name: TRUCK_BY_ID.get(t.truckId)?.name ?? t.truckId, cap: TRUCK_BY_ID.get(t.truckId)?.cap ?? 0 }));
  const stock = (n: string) => getLocStore().at(n, WAREHOUSE).flatMap((x) => { const i = x.item.indexOf(':'); const type = x.item.slice(0, i) as ItemType; const id = x.item.slice(i + 1); return isStackable(type, id) ? [{ type, id, qty: x.qty, name: nameOf({ type, id }), ref: sc.ref(type, id) }] : []; }).filter((s) => s.ref > 0);
  const full = (n: string) => ({ contracts: sc.list(n), trucks: trucks(n), stock: stock(n), me: n });
  on('sc_list', () => { const n = need(); return full(n); });
  on('sc_propose', async (b) => { const n = need(); const r = await sc.propose(n, b); return { result: r, ...full(n) }; });
  on('sc_accept', async (b) => { const n = need(); const r = await sc.accept(n, b.id); return { result: r, ...full(n) }; });
  on('sc_decline', async (b) => { const n = need(); const r = await sc.decline(n, b.id); return { result: r, ...full(n) }; });
  on('sc_dispatch', async (b) => { const n = need(); const r = await sc.dispatch(n, b.id, b.truck); return { result: r, ...full(n) }; });
  on('sc_cancel', async (b) => { const n = need(); const r = await sc.cancel(n, b.id, b.mutual); return { result: r, ...full(n) }; });
}
