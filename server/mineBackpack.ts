/**
 * Mining pack (carry) upgrades (requested by Jay). Current tier lives in Postgres; chips move only through the
 * atomic wallet (CasinoBank.transferAtomic, ledger game 'mine_backpack') in the same transaction as the upgrade
 * row, so a double click buys once and a failed write charges nothing. MinesWorld reads the cap synchronously
 * from the in-memory cache (`capOf`), loaded at boot and updated on every buy.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { bootAttach, setBootState } from './boot-retry.js';
import { databaseUrl } from './leaderboard-store.js';
import { getBank, type CasinoBank } from './casino-store.js';
import { px, priceIndex } from './price-index.js';
import { setMineBackpackHook } from './mines.js';
import {
  BACKPACK_BASE_CAP, BACKPACK_UPGRADES, MAX_BACKPACK_CAP, backpackDef, canBuyBackpack, capForTier,
  isMineBackpack, nextUpgrade, type MineBackpackId, type MineBackpackView,
} from '../shared/mineBackpack.js';

export const MINE_BACKPACK_MIGRATION = `
CREATE TABLE IF NOT EXISTS mine_backpack_upgrades (
  player_key TEXT NOT NULL,
  upgrade_id TEXT NOT NULL,
  cap INTEGER NOT NULL,
  price BIGINT NOT NULL,
  bought_at BIGINT NOT NULL,
  PRIMARY KEY (player_key, upgrade_id)
);
`;
export class MineBackpackError extends Error {}
const keyOf = (n: string) => n.trim().toLowerCase();

export class MineBackpack {
  /** Highest owned tier per player (0 = starter 120). */
  tiers = new Map<string, number>();
  private locks = new Map<string, Promise<unknown>>();
  constructor(private readonly pool: pg.Pool, private readonly bank: () => CasinoBank = getBank, private readonly clock = () => Date.now()) {}
  async init() {
    await this.pool.query(MINE_BACKPACK_MIGRATION);
    const best = new Map<string, number>();
    for (const r of (await this.pool.query('SELECT player_key, upgrade_id FROM mine_backpack_upgrades')).rows as Array<{ player_key: string; upgrade_id: string }>) {
      const d = backpackDef(r.upgrade_id); if (!d) continue;
      best.set(r.player_key, Math.max(best.get(r.player_key) ?? 0, d.tier));
    }
    this.tiers = best;
  }
  private lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve(); const p = prev.then(fn, fn); const tail = p.catch(() => {});
    this.locks.set(id, tail); void tail.then(() => { if (this.locks.get(id) === tail) this.locks.delete(id); }); return p;
  }
  tierOf(name: string | null): number { return name ? (this.tiers.get(keyOf(name)) ?? 0) : 0; }
  /** Carry cap for an account (guests and unknown = the 120 starter pack). */
  capOf(name: string | null): number { return capForTier(this.tierOf(name)); }
  view(name: string | null): MineBackpackView {
    const tier = this.tierOf(name); const nxt = nextUpgrade(tier);
    const prices = Object.fromEntries(BACKPACK_UPGRADES.map((t) => [t.id, px(t.price)]));
    return {
      cap: capForTier(tier),
      tier,
      next: nxt ? { id: nxt.id, name: nxt.name, cap: nxt.cap, price: prices[nxt.id]! } : null,
      prices,
      index: priceIndex(),
      signedIn: !!name,
    };
  }

  async buy(name: string, id?: unknown) {
    const k = keyOf(name);
    return this.lock(k, async () => {
      const tier = this.tierOf(name);
      const nxt = nextUpgrade(tier);
      if (!nxt) throw new MineBackpackError(`Your pack is already at the maximum ${MAX_BACKPACK_CAP} capacity.`);
      if (id != null && id !== '' && !(isMineBackpack(id) && canBuyBackpack(tier, id))) {
        if (isMineBackpack(id) && backpackDef(id)!.tier <= tier) throw new MineBackpackError(`You already have the ${backpackDef(id)!.name}.`);
        throw new MineBackpackError(`Buy the ${nxt.name} first.`);
      }
      const d = nxt;
      const cost = px(d.price); const bank = this.bank(); await bank.refresh(name);
      if (bank.account(name).chips < cost) throw new MineBackpackError(`Not enough chips: the ${d.name} costs ${cost.toLocaleString('en-US')}.`);
      const w = bank.transferAtomic([{ name, amount: -cost, key: `mine_backpack:${k}:${d.id}:${randomUUID()}`, game: 'mine_backpack', memo: `Mines: bought a ${d.name} (${d.cap} carry)` }]);
      const run = async () => {
        await w.after; const cl = await this.pool.connect();
        try {
          await cl.query('BEGIN');
          const ins = await cl.query(
            'INSERT INTO mine_backpack_upgrades (player_key, upgrade_id, cap, price, bought_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (player_key, upgrade_id) DO NOTHING',
            [k, d.id, d.cap, cost, this.clock()],
          );
          if (!ins.rowCount) throw new MineBackpackError(`You already have the ${d.name}. Nothing was charged.`);
          for (const s of w.stmts) await cl.query(s.sql, s.args);
          await cl.query('COMMIT');
        } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
      };
      const p = run(); w.bind(p);
      try { await p; } catch (e) { w.revert(); if (e instanceof MineBackpackError) throw e; console.error('[mine-backpack] buy failed:', (e as Error).message); throw new MineBackpackError(/chips|balance|null value/i.test((e as Error).message) ? 'Not enough chips.' : 'Something went wrong. Nothing was charged.'); }
      this.tiers.set(k, d.tier);
      return { upgrade: d.id, cap: d.cap, cost, chips: bank.account(name).chips };
    });
  }
}

let packs: MineBackpack | null = null;
export const getMineBackpack = () => packs;
export function setMineBackpack(p: MineBackpack | null) {
  packs = p;
  setMineBackpackHook((a) => (packs ? packs.capOf(a) : BACKPACK_BASE_CAP));
}
export async function initMineBackpack(): Promise<void> {
  const url = databaseUrl(); if (!url) { setBootState('mine-backpack', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[mine-backpack] pool error:', e.message));
  await bootAttach('mine-backpack', async () => { try { const p = new MineBackpack(pool); await p.init(); setMineBackpack(p); console.log('[mine-backpack] ready'); return true; } catch (e) { console.error('[mine-backpack] init failed:', (e as Error).message); return false; } });
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerMineBackpack(_io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const on = (ev: string, fn: (b: Record<string, unknown>, p: MineBackpack) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try {
      if (!packs) throw new MineBackpackError('Pack upgrades are offline right now.');
      const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      const r = (await fn(b, packs)) as object | undefined;
      ack?.({ ok: true, ...(r ?? {}), backpack: packs.view(nameOf()) });
    } catch (e) { ack?.({ ok: false, error: e instanceof MineBackpackError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); }
  });
  const need = () => { const n = nameOf(); if (!n) throw new MineBackpackError('Sign in to buy pack upgrades.'); return n; };
  on('mine_backpack_view', () => undefined);
  on('mine_backpack_buy', (b, p) => p.buy(need(), b.upgrade));
}
