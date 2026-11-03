/**
 * Chud Resort fleet: the Marina (boats) and, later, the Hangar (private jets). Same money rules as the car dealership:
 * a buy is ONE Postgres transaction holding the ledger row (CasinoBank.transferAtomic) and the fleet_owned row; a
 * sell-back pays 70% of today's list price. Chips never move any other way.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { bootAttach, setBootState } from './boot-retry.js';
import { databaseUrl } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { px } from './price-index.js';
import { requireResort } from './travel.js';
import { BOATS, MAX_BOATS, bestBoat, fleetModel, fleetResale, type FleetKind } from '../shared/fleet.js';

export class FleetError extends Error {}
const keyOf = (n: string) => n.trim().toLowerCase();

export const FLEET_MIGRATION = `CREATE TABLE IF NOT EXISTS fleet_owned (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
  model TEXT NOT NULL, paid BIGINT NOT NULL, bought_at BIGINT NOT NULL, arrears INT NOT NULL DEFAULT 0, upkeep_paid BIGINT NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS fleet_owned_player ON fleet_owned (player_key);`;

export interface OwnedCraft { id: string; kind: FleetKind; model: string; paid: number; boughtAt: number; arrears: number; upkeepPaid: number }
type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
type PoolLike = Q & { connect: () => Promise<Q & { release: () => void }> };
const row = (r: Record<string, unknown>): OwnedCraft => ({ id: String(r.id), kind: String(r.kind) as FleetKind, model: String(r.model), paid: Number(r.paid), boughtAt: Number(r.bought_at), arrears: Number(r.arrears ?? 0), upkeepPaid: Number(r.upkeep_paid ?? 0) });
/** Sell-back / asset value: 70% of today's indexed list price (unknown models: 70% of what was paid). */
export const craftValue = (c: { model: string; paid: number }) => { const m = fleetModel(c.model); return fleetResale(m ? px(m.price) : c.paid); };

export class Fleet {
  onChange?: () => void;
  private mem = new Map<string, OwnedCraft[]>();
  constructor(private readonly pool: PoolLike | null, private readonly clock = () => Date.now()) {}
  async init() { if (this.pool) await this.pool.query(FLEET_MIGRATION); }

  async owned(name: string, kind?: FleetKind): Promise<OwnedCraft[]> {
    const k = keyOf(name);
    const all = this.pool ? (await this.pool.query('SELECT * FROM fleet_owned WHERE player_key = $1 ORDER BY bought_at', [k])).rows.map(row) : [...(this.mem.get(k) ?? [])];
    return kind ? all.filter((c) => c.kind === kind) : all;
  }
  async view(name: string | null) {
    const mine = name ? (await this.owned(name)).map((c) => ({ ...c, value: craftValue(c) })) : [];
    return { signedIn: !!name, owned: mine, chips: name && getBank().ready ? getBank().account(name).chips : null, deep: bestBoat(mine.filter((c) => c.kind === 'boat').map((c) => c.model)) };
  }
  /** Deep-sea access for fishing: best zone + bite multiplier of the boats this player owns. */
  async boatOf(name: string) { return bestBoat((await this.owned(name, 'boat')).map((c) => c.model)); }

  async buy(name: string, kind: FleetKind, modelId: unknown) {
    const m = fleetModel(modelId, kind); if (!m) throw new FleetError(kind === 'boat' ? 'That boat is not in the Marina.' : 'That jet is not in the Hangar.');
    const mine = await this.owned(name, kind); const cap = kind === 'boat' ? MAX_BOATS : 2;
    if (mine.length >= cap) throw new FleetError(`You already own ${cap} ${kind === 'boat' ? 'boats' : 'jets'}. Sell one first.`);
    const price = px(m.price); const bank = getBank(); if (!bank.canAfford(name, price)) throw new FleetError('Not enough chips.');
    const id = randomUUID(); const at = this.clock(); const k = keyOf(name); const game = `${kind}_buy`;
    const w = bank.transferAtomic([{ name, amount: -price, key: `${game}:${id}`, game, memo: `Bought ${m.name}` }]);
    const run = async () => {
      if (!this.pool) { const l = this.mem.get(k) ?? []; l.push({ id, kind, model: m.id, paid: price, boughtAt: at, arrears: 0, upkeepPaid: 0 }); this.mem.set(k, l); return; }
      await w.after; const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        await cl.query('INSERT INTO fleet_owned (id, player_key, name, kind, model, paid, bought_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, k, name.trim(), kind, m.id, price, at]);
        for (const s of w.stmts) await cl.query(s.sql, s.args);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) { w.revert(); console.error('[fleet] buy failed:', (e as Error).message); throw new FleetError(/chips|balance|null value/i.test((e as Error).message) ? 'Not enough chips.' : 'Purchase failed. Nothing was charged.'); }
    this.onChange?.();
    return { id, model: m.id, price, chips: bank.account(name).chips };
  }

  async sell(name: string, ownedId: unknown) {
    if (typeof ownedId !== 'string') throw new FleetError('Pick one to sell.');
    const k = keyOf(name); const c = (await this.owned(name)).find((x) => x.id === ownedId); if (!c) throw new FleetError('You do not own that.');
    const m = fleetModel(c.model); const pay = craftValue(c); const bank = getBank(); const game = `${c.kind}_sell`;
    const w = bank.transferAtomic([{ name, amount: pay, key: `${game}:${c.id}`, game, memo: `Sold ${m?.name ?? c.model} back to the ${c.kind === 'boat' ? 'Marina' : 'Hangar'}` }]);
    const run = async () => {
      if (!this.pool) { const l = this.mem.get(k) ?? []; const i = l.findIndex((x) => x.id === c.id); if (i < 0) throw new FleetError('You do not own that.'); l.splice(i, 1); return; }
      await w.after; const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        if (((await cl.query('DELETE FROM fleet_owned WHERE id = $1 AND player_key = $2', [c.id, k])).rowCount ?? 0) === 0) throw new FleetError('You do not own that.');
        for (const s of w.stmts) await cl.query(s.sql, s.args);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) { w.revert(); if (e instanceof FleetError) throw e; console.error('[fleet] sell failed:', (e as Error).message); throw new FleetError('Sale failed. Nothing changed.'); }
    this.onChange?.();
    return { paid: pay, chips: bank.account(name).chips };
  }

  /** Every player's fleet at resale value (economy assets; QA excluded). */
  async values(): Promise<number> {
    const all = this.pool ? (await this.pool.query("SELECT model, paid FROM fleet_owned WHERE player_key NOT LIKE 'qa-%'")).rows.map((r) => ({ model: String(r.model), paid: Number(r.paid) }))
      : [...this.mem.entries()].filter(([k]) => !k.startsWith('qa-')).flatMap(([, l]) => l);
    return all.reduce((a, c) => a + craftValue(c), 0);
  }
  async valueOf(name: string): Promise<number> { return (await this.owned(name)).reduce((a, c) => a + craftValue(c), 0); }
}

let fleet: Fleet | null = null;
export const getFleet = () => fleet;
export function setFleet(f: Fleet | null) { fleet = f; }
export async function initFleet(): Promise<void> {
  const url = databaseUrl();
  if (!url) { fleet = new Fleet(null); setBootState('fleet', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[fleet] pool error:', e.message));
  await bootAttach('fleet', async () => { try { const f = new Fleet(pool as unknown as PoolLike); await f.init(); fleet = f; console.log('[fleet] ready'); return true; } catch (e) { console.error('[fleet] init failed:', (e as Error).message); return false; } });
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerFleet(_io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const need = () => { const n = nameOf(); if (!n) throw new FleetError('Sign in to buy. Guests can browse.'); return n; };
  const on = (ev: string, fn: (b: Record<string, unknown>, f: Fleet) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try { if (!fleet) throw new FleetError('Opening up. Try again in a moment.'); const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; ack?.({ ok: true, ...((await fn(b, fleet)) as object ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof FleetError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$|Chud Resort/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); }
  });
  on('marina_view', async (_b, f) => ({ ...(await f.view(nameOf())), catalog: BOATS.map((m) => ({ ...m, basePrice: m.price, price: px(m.price) })) }));
  on('marina_buy', async (b, f) => { const n = need(); await requireResort(n, FleetError); return f.buy(n, 'boat', b.model); });
  on('fleet_sell', async (b, f) => { const n = need(); const c = (await f.owned(n)).find((x) => x.id === b.id); if (c?.kind === 'boat') await requireResort(n, FleetError); return f.sell(n, b.id); });
}
