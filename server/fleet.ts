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
import { setFishBoatHook } from './fishing.js';
import { setTravelJetHook } from './travel.js';
import { GRACE_DAYS } from '../shared/realEstate.js';
import { BOATS, JETS, MAX_JETS, MAX_BOATS, bestBoat, fleetModel, fleetResale, type FleetKind } from '../shared/fleet.js';

export class FleetError extends Error {}
const keyOf = (n: string) => n.trim().toLowerCase();

export const FLEET_MIGRATION = `CREATE TABLE IF NOT EXISTS fleet_owned (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
  model TEXT NOT NULL, paid BIGINT NOT NULL, bought_at BIGINT NOT NULL, arrears INT NOT NULL DEFAULT 0, upkeep_paid BIGINT NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS fleet_owned_player ON fleet_owned (player_key);
CREATE TABLE IF NOT EXISTS fleet_upkeep (day TEXT NOT NULL, craft_id TEXT NOT NULL, owner_key TEXT NOT NULL, amount BIGINT NOT NULL, paid BOOLEAN NOT NULL,
  repossessed BOOLEAN NOT NULL DEFAULT FALSE, at BIGINT NOT NULL, claim TEXT NOT NULL, PRIMARY KEY (day, craft_id));`;
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
/** Tess QA #4: what a jet owner sees about upkeep (Hangar + Daily Report): per day, next charge (next UTC midnight), arrears, paid so far. */
export function jetUpkeepInfo(c: { model: string; arrears: number; upkeepPaid: number }, now: number) {
  const perDay = jetUpkeep(c.model); const next = Date.parse(new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z') + 86_400_000;
  return { perDay, nextChargeAt: next, arrears: c.arrears, arrearsChips: c.arrears * perDay, paidTotal: c.upkeepPaid, graceDays: GRACE_DAYS };
}
/** Daily jet upkeep at today's price index. */
export const jetUpkeep = (model: string) => px(fleetModel(model, 'jet')?.upkeep ?? 0);

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
    const now = this.clock(); const mine = name ? (await this.owned(name)).map((c) => ({ ...c, value: craftValue(c), ...(c.kind === 'jet' ? { upkeepInfo: jetUpkeepInfo(c, now) } : {}) })) : [];
    return { signedIn: !!name, owned: mine, chips: name && getBank().ready ? getBank().account(name).chips : null, deep: bestBoat(mine.filter((c) => c.kind === 'boat').map((c) => c.model)) };
  }
  /** Deep-sea access for fishing: best zone + bite multiplier of the boats this player owns. */
  async boatOf(name: string) { return bestBoat((await this.owned(name, 'boat')).map((c) => c.model)); }

  async buy(name: string, kind: FleetKind, modelId: unknown) {
    const m = fleetModel(modelId, kind); if (!m) throw new FleetError(kind === 'boat' ? 'That boat is not in the Marina.' : 'That jet is not in the Hangar.');
    const mine = await this.owned(name, kind); const cap = kind === 'boat' ? MAX_BOATS : MAX_JETS;
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

  /** Best (priciest) jet this player owns, or null. */
  async jetOf(name: string): Promise<string | null> {
    const j = (await this.owned(name, 'jet')).map((c) => fleetModel(c.model, 'jet')).filter((m) => !!m).sort((a, b) => b!.price - a!.price)[0];
    return j?.name ?? null;
  }
  private memUpkeep = new Set<string>();
  /**
   * Daily jet upkeep (#11), same pattern as property tax: once per UTC day per jet owned since before today.
   * Paid -> ONE transaction (ledger 'jet_upkeep' + claim row + arrears = 0). Unpaid -> arrears+1;
   * GRACE_DAYS unpaid days in a row -> repossessed (row deleted, no refund). Claim nonce makes reruns no-ops.
   */
  async runUpkeep(): Promise<{ charged: number; paid: number; unpaid: number; repossessed: number }> {
    const now = this.clock(); const day = utcDay(now); const start = Date.parse(`${day}T00:00:00Z`); const bank = getBank();
    const out = { charged: 0, paid: 0, unpaid: 0, repossessed: 0 };
    const jets: Array<OwnedCraft & { owner: string; key: string }> = this.pool
      ? (await this.pool.query("SELECT * FROM fleet_owned WHERE kind = 'jet' AND bought_at < $1 AND id NOT IN (SELECT craft_id FROM fleet_upkeep WHERE day = $2) ORDER BY player_key, bought_at", [start, day])).rows.map((r) => ({ ...row(r), owner: String(r.name), key: String(r.player_key) }))
      : [...this.mem.entries()].flatMap(([key, l]) => l.filter((c) => c.kind === 'jet' && c.boughtAt < start && !this.memUpkeep.has(`${day}:${c.id}`)).map((c) => ({ ...c, owner: key, key })));
    for (const j of jets) {
      const amount = jetUpkeep(j.model); if (amount <= 0) continue;
      try { await bank.refresh(j.owner); } catch { continue; }
      const repo = j.arrears + 1 >= GRACE_DAYS; const label = fleetModel(j.model)?.name ?? j.model;
      const claim = async (cl: Q, paid: boolean) => {
        const nonce = randomUUID();
        await cl.query('INSERT INTO fleet_upkeep (day, craft_id, owner_key, amount, paid, repossessed, at, claim) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING', [day, j.id, j.key, amount, paid, !paid && repo, now, nonce]);
        if ((await cl.query('SELECT claim FROM fleet_upkeep WHERE day = $1 AND craft_id = $2', [day, j.id])).rows[0]?.claim !== nonce) throw new FleetError('claimed');
        const u = paid ? await cl.query('UPDATE fleet_owned SET arrears = 0, upkeep_paid = upkeep_paid + $3 WHERE id = $1 AND player_key = $2', [j.id, j.key, amount])
          : repo ? await cl.query('DELETE FROM fleet_owned WHERE id = $1 AND player_key = $2', [j.id, j.key])
          : await cl.query('UPDATE fleet_owned SET arrears = arrears + 1 WHERE id = $1 AND player_key = $2', [j.id, j.key]);
        if (!u.rowCount) throw new FleetError('changed');
      };
      try {
        if (bank.account(j.owner).chips >= amount) {
          const w = bank.transferAtomic([{ name: j.owner, amount: -amount, key: `jet_upkeep:${day}:${j.id}`, game: 'jet_upkeep', memo: `Jet upkeep ${day}: ${label} (crew, fuel, hangar)` }]);
          const run = async () => {
            if (!this.pool) { this.memUpkeep.add(`${day}:${j.id}`); const c = this.mem.get(j.key)?.find((x) => x.id === j.id); if (c) { c.arrears = 0; c.upkeepPaid += amount; } return; }
            await w.after; const cl = await this.pool.connect();
            try { await cl.query('BEGIN'); await claim(cl, true); for (const s of w.stmts) await cl.query(s.sql, s.args); await cl.query('COMMIT'); }
            catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
          };
          const p = run(); w.bind(p);
          try { await p; out.paid++; out.charged += amount; continue; } catch (e) { w.revert(); if (e instanceof FleetError) throw e; if (!/chips|balance/i.test((e as Error).message)) throw e; }
        }
        if (!this.pool) { this.memUpkeep.add(`${day}:${j.id}`); const l = this.mem.get(j.key) ?? []; const i = l.findIndex((x) => x.id === j.id); if (i >= 0) { if (repo) l.splice(i, 1); else l[i]!.arrears++; } }
        else { const cl = await this.pool.connect(); try { await cl.query('BEGIN'); await claim(cl, false); await cl.query('COMMIT'); } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); } }
        out.unpaid++; if (repo) out.repossessed++;
      } catch (e) { if (!(e instanceof FleetError)) console.error('[fleet] upkeep failed:', (e as Error).message); }
    }
    if (out.paid + out.unpaid) { console.log(`[fleet] jet upkeep ${day}: paid ${out.paid} (${out.charged} chips), unpaid ${out.unpaid}, repossessed ${out.repossessed}`); this.onChange?.(); }
    return out;
  }
  private timer: ReturnType<typeof setInterval> | null = null;
  start() { const run = () => { void this.runUpkeep().catch((e) => console.error('[fleet] upkeep run failed:', (e as Error).message)); }; this.timer = setInterval(run, 10 * 60_000); this.timer.unref?.(); setTimeout(run, 30_000).unref?.(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

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
setFishBoatHook(async (n) => (fleet ? fleet.boatOf(n) : bestBoat([])));
setTravelJetHook(async (n) => (fleet ? fleet.jetOf(n) : null));
export function setFleet(f: Fleet | null) { fleet = f; }
export async function initFleet(): Promise<void> {
  const url = databaseUrl();
  if (!url) { fleet = new Fleet(null); fleet.start(); setBootState('fleet', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[fleet] pool error:', e.message));
  await bootAttach('fleet', async () => { try { const f = new Fleet(pool as unknown as PoolLike); await f.init(); fleet = f; f.start(); console.log('[fleet] ready'); return true; } catch (e) { console.error('[fleet] init failed:', (e as Error).message); return false; } });
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
  on('hangar_view', async (_b, f) => ({ ...(await f.view(nameOf())), catalog: JETS.map((m) => ({ ...m, basePrice: m.price, price: px(m.price), upkeep: jetUpkeep(m.id) })) }));
  on('hangar_buy', async (b, f) => f.buy(need(), 'jet', b.model)); // the Hangar is at Chud Hub International (and the resort airfield): no location gate
  on('fleet_sell', async (b, f) => { const n = need(); const c = (await f.owned(n)).find((x) => x.id === b.id); if (c?.kind === 'boat') await requireResort(n, FleetError); return f.sell(n, b.id); });
}
