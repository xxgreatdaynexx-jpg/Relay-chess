/**
 * City patronage: naming-rights sinks for plaza, fireworks dock, weekly festival, and a monument.
 * Chips are burned (game 'patronage'); nothing is paid to the mayor or treasury. Additive table only.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { bootAttach, setBootState } from './boot-retry.js';
import { databaseUrl } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { px } from './price-index.js';
import { PATRON_SLOTS, patronSlot, patronTermMs } from '../shared/patronage.js';

export class PatronError extends Error {}
const keyOf = (n: string) => n.trim().toLowerCase();

export const PATRONAGE_MIGRATION = `
CREATE TABLE IF NOT EXISTS patronage_grants (
  slot TEXT PRIMARY KEY, player_key TEXT NOT NULL, name TEXT NOT NULL, paid BIGINT NOT NULL, started_at BIGINT NOT NULL, ends_at BIGINT NOT NULL);
`;

type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
type PoolLike = Q & { connect: () => Promise<Q & { release: () => void }> };

export interface Grant { slot: string; playerKey: string; name: string; paid: number; startedAt: number; endsAt: number }

const asGrant = (r: Record<string, unknown>): Grant => ({ slot: String(r.slot), playerKey: String(r.player_key), name: String(r.name), paid: Number(r.paid), startedAt: Number(r.started_at), endsAt: Number(r.ends_at) });

export class Patronage {
  private mem = new Map<string, Grant>();
  constructor(private readonly pool: PoolLike | null, private readonly clock = () => Date.now()) {}
  async init() { if (this.pool) await this.pool.query(PATRONAGE_MIGRATION); }

  async grant(slot: string): Promise<Grant | null> {
    if (this.pool) {
      const r = (await this.pool.query('SELECT * FROM patronage_grants WHERE slot = $1', [slot])).rows[0];
      return r ? asGrant(r) : null;
    }
    return this.mem.get(slot) ?? null;
  }
  async grants(): Promise<Grant[]> {
    if (this.pool) return (await this.pool.query('SELECT * FROM patronage_grants')).rows.map(asGrant);
    return [...this.mem.values()];
  }

  current(g: Grant | null, now = this.clock()): Grant | null {
    return g && g.endsAt > now ? g : null;
  }

  async view(name: string | null) {
    const now = this.clock();
    const all = await this.grants();
    const by = new Map(all.map((g) => [g.slot, g]));
    const me = name ? keyOf(name) : null;
    const slots = PATRON_SLOTS.map((s) => {
      const g = by.get(s.id) ?? null; const live = this.current(g, now);
      const price = px(s.price);
      return {
        ...s, basePrice: s.price, price,
        patron: live ? { name: live.name, endsAt: live.endsAt, mine: !!me && live.playerKey === me } : null,
        canBuy: !live || (!!me && live.playerKey === me),
      };
    });
    return { signedIn: !!name, chips: name && getBank().ready ? getBank().account(name).chips : null, now, slots };
  }

  async buy(name: string, slotId: unknown) {
    const s = patronSlot(slotId); if (!s) throw new PatronError('That patronage is not on offer.');
    const now = this.clock(); const k = keyOf(name);
    const existing = await this.grant(s.id);
    const live = this.current(existing, now);
    if (live && live.playerKey !== k) {
      const until = new Date(live.endsAt).toISOString().slice(0, 10);
      throw new PatronError(`${live.name} holds the ${s.name} until ${until}. You can take over after it expires.`);
    }
    const price = px(s.price);
    const bank = getBank();
    if (!bank.canAfford(name, price)) throw new PatronError('Not enough chips.');
    const start = live ? live.startedAt : now;
    const ends = (live ? live.endsAt : now) + patronTermMs(s);
    const bid = randomUUID();
    const w = bank.transferAtomic([{ name, amount: -price, key: `patronage:${s.id}:${bid}`, game: 'patronage', memo: `City patronage: ${s.name}` }]);
    const grant: Grant = { slot: s.id, playerKey: k, name: name.trim(), paid: (live?.paid ?? 0) + price, startedAt: start, endsAt: ends };
    const run = async () => {
      if (!this.pool) { this.mem.set(s.id, grant); return; }
      await w.after; const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        await cl.query(
          `INSERT INTO patronage_grants (slot, player_key, name, paid, started_at, ends_at) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (slot) DO UPDATE SET player_key = EXCLUDED.player_key, name = EXCLUDED.name, paid = patronage_grants.paid + EXCLUDED.paid, ends_at = EXCLUDED.ends_at`,
          [s.id, k, name.trim(), price, start, ends],
        );
        for (const st of w.stmts) await cl.query(st.sql, st.args);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) { w.revert(); throw new PatronError(/chips|balance/i.test((e as Error).message) ? 'Not enough chips.' : 'Purchase failed. Nothing was charged.'); }
    return { slot: s.id, price, endsAt: ends, chips: bank.account(name).chips };
  }
}

let patronage: Patronage | null = null;
export const getPatronage = () => patronage;
export function setPatronage(p: Patronage | null) { patronage = p; }
export async function initPatronage(): Promise<void> {
  const url = databaseUrl();
  if (!url) { setPatronage(new Patronage(null)); setBootState('patronage', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[patronage] pool error:', e.message));
  await bootAttach('patronage', async () => { try { const p = new Patronage(pool as unknown as PoolLike); await p.init(); setPatronage(p); console.log('[patronage] ready'); return true; } catch (e) { console.error('[patronage] init failed:', (e as Error).message); return false; } });
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerPatronage(_io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const need = () => { const n = nameOf(); if (!n) throw new PatronError('Sign in first.'); return n; };
  const on = (ev: string, fn: (b: Record<string, unknown>, p: Patronage) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try { if (!patronage) throw new PatronError('Opening up. Try again in a moment.'); const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; ack?.({ ok: true, ...((await fn(b, patronage)) as object ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof PatronError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); }
  });
  on('patronage_view', async (_b, p) => p.view(nameOf()));
  on('patronage_buy', async (b, p) => p.buy(need(), b.slot));
}
