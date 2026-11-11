/**
 * House art auction at the Billionaire's Club. Bids are escrowed (wallet never goes negative). A higher bid refunds
 * the previous bidder. When a lot settles, the winner's escrow is burned (sink 'auction') and the piece is granted
 * as no-resale furniture. A bid in the last ANTI_SNIPE_MS extends the clock.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { bootAttach, setBootState } from './boot-retry.js';
import { databaseUrl } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { px } from './price-index.js';
import { getHomes } from './homes.js';
import { ART_BY_ID, ART_PIECES, ANTI_SNIPE_MS, LOT_MS, nextBidFloor, openingBid } from '../shared/artAuction.js';

export class AuctionError extends Error {}
const keyOf = (n: string) => n.trim().toLowerCase();

export const AUCTION_MIGRATION = `
CREATE TABLE IF NOT EXISTS auction_lots (
  id TEXT PRIMARY KEY, item TEXT NOT NULL, start_at BIGINT NOT NULL, end_at BIGINT NOT NULL, settled BOOLEAN NOT NULL DEFAULT FALSE);
CREATE TABLE IF NOT EXISTS auction_bids (
  id TEXT PRIMARY KEY, lot_id TEXT NOT NULL, player_key TEXT NOT NULL, name TEXT NOT NULL, amount BIGINT NOT NULL, at BIGINT NOT NULL, live BOOLEAN NOT NULL DEFAULT TRUE);
CREATE INDEX IF NOT EXISTS auction_bids_lot ON auction_bids (lot_id, live);
`;

type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
type PoolLike = Q & { connect: () => Promise<Q & { release: () => void }> };

interface Lot { id: string; item: string; startAt: number; endAt: number; settled: boolean }
interface Bid { id: string; lotId: string; key: string; name: string; amount: number; at: number }

export class ArtAuction {
  private lots: Lot[] = [];
  private bids = new Map<string, Bid[]>();
  private cursor = 0;
  constructor(private readonly pool: PoolLike | null, private readonly clock = () => Date.now()) {}
  async init() {
    if (this.pool) {
      await this.pool.query(AUCTION_MIGRATION);
      this.lots = (await this.pool.query('SELECT * FROM auction_lots ORDER BY start_at')).rows.map((r) => ({
        id: String(r.id), item: String(r.item), startAt: Number(r.start_at), endAt: Number(r.end_at), settled: !!r.settled,
      }));
      const rows = (await this.pool.query('SELECT * FROM auction_bids ORDER BY at')).rows;
      for (const r of rows) {
        const b: Bid = { id: String(r.id), lotId: String(r.lot_id), key: String(r.player_key), name: String(r.name), amount: Number(r.amount), at: Number(r.at) };
        const l = this.bids.get(b.lotId) ?? []; l.push(b); this.bids.set(b.lotId, l);
      }
    }
    await this.ensureLive();
  }

  private high(lotId: string): Bid | null {
    const list = (this.bids.get(lotId) ?? []).slice();
    return list.sort((a, b) => b.amount - a.amount || b.at - a.at)[0] ?? null;
  }

  private async ensureLive() {
    const now = this.clock();
    const open = this.lots.filter((l) => !l.settled && l.endAt > now);
    if (open.length) return;
    const ended = this.lots.filter((l) => !l.settled && l.endAt <= now);
    for (const l of ended) await this.settle(l.id);
    const piece = ART_PIECES[this.cursor % ART_PIECES.length]!;
    this.cursor++;
    const lot: Lot = { id: randomUUID(), item: piece.id, startAt: now, endAt: now + LOT_MS, settled: false };
    this.lots.push(lot);
    if (this.pool) await this.pool.query('INSERT INTO auction_lots (id, item, start_at, end_at, settled) VALUES ($1,$2,$3,$4,FALSE)', [lot.id, lot.item, lot.startAt, lot.endAt]);
  }

  async view(name: string | null) {
    await this.ensureLive();
    const now = this.clock();
    const live = this.lots.filter((l) => !l.settled).sort((a, b) => a.endAt - b.endAt)[0];
    const piece = live ? ART_BY_ID.get(live.item) : undefined;
    const high = live ? this.high(live.id) : null;
    const floor = piece ? (high ? nextBidFloor(high.amount, piece.estimate) : px(openingBid(piece.estimate))) : 0;
    return {
      signedIn: !!name,
      chips: name && getBank().ready ? getBank().account(name).chips : null,
      now,
      lot: live && piece ? {
        id: live.id, item: piece, estimate: px(piece.estimate), floor, endsAt: live.endAt,
        high: high ? { name: high.name, amount: high.amount, mine: !!name && keyOf(name) === high.key } : null,
      } : null,
    };
  }

  async bid(name: string, lotId: unknown, amount: unknown) {
    await this.ensureLive();
    if (typeof lotId !== 'string') throw new AuctionError('Pick a lot.');
    const lot = this.lots.find((l) => l.id === lotId); if (!lot || lot.settled) throw new AuctionError('That lot is not open.');
    const now = this.clock(); if (now >= lot.endAt) { await this.settle(lot.id); throw new AuctionError('That lot has ended.'); }
    const piece = ART_BY_ID.get(lot.item); if (!piece) throw new AuctionError('Unknown piece.');
    const high = this.high(lot.id);
    const floor = high ? nextBidFloor(high.amount, piece.estimate) : px(openingBid(piece.estimate));
    const amt = Math.floor(Number(amount));
    if (!Number.isInteger(amt) || amt < floor) throw new AuctionError(`Bid at least 🪙 ${floor.toLocaleString('en-US')}.`);
    const k = keyOf(name);
    if (high && high.key === k) throw new AuctionError('You are already the high bidder.');
    const bank = getBank(); await bank.refresh(name).catch(() => 0);
    if (!bank.canAfford(name, amt)) throw new AuctionError('Not enough chips.');
    const bidId = randomUUID();
    const w = bank.transferAtomic([{ name, amount: -amt, key: `auction:bid:${bidId}`, game: 'auction', memo: `Art auction bid: ${piece.name}` }]);
    const refund = high ? bank.transferAtomic([{ name: high.name, amount: high.amount, key: `auction:refund:${high.id}`, game: 'auction', memo: `Art auction outbid: ${piece.name}` }]) : null;
    const run = async () => {
      if (!this.pool) {
        const list = this.bids.get(lot.id) ?? [];
        list.push({ id: bidId, lotId: lot.id, key: k, name: name.trim(), amount: amt, at: now });
        this.bids.set(lot.id, list);
        return;
      }
      await w.after; if (refund) await refund.after;
      const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        await cl.query('INSERT INTO auction_bids (id, lot_id, player_key, name, amount, at, live) VALUES ($1,$2,$3,$4,$5,$6,TRUE)', [bidId, lot.id, k, name.trim(), amt, now]);
        if (high) await cl.query('UPDATE auction_bids SET live = FALSE WHERE id = $1', [high.id]);
        for (const s of [...w.stmts, ...(refund?.stmts ?? [])]) await cl.query(s.sql, s.args);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
      const list = this.bids.get(lot.id) ?? [];
      list.push({ id: bidId, lotId: lot.id, key: k, name: name.trim(), amount: amt, at: now });
      this.bids.set(lot.id, list);
    };
    const p = run(); w.bind(p); refund?.bind(p);
    try { await p; } catch (e) { w.revert(); refund?.revert(); console.error('[auction] bid failed:', (e as Error).message); throw new AuctionError(/chips|balance/i.test((e as Error).message) ? 'Not enough chips.' : 'Bid failed. Nothing was charged.'); }
    if (lot.endAt - now < ANTI_SNIPE_MS) {
      lot.endAt = now + ANTI_SNIPE_MS;
      if (this.pool) await this.pool.query('UPDATE auction_lots SET end_at = $2 WHERE id = $1 AND settled = FALSE', [lot.id, lot.endAt]);
    }
    return { amount: amt, endsAt: lot.endAt, chips: bank.account(name).chips };
  }

  async settle(lotId: string) {
    const lot = this.lots.find((l) => l.id === lotId); if (!lot || lot.settled) return { settled: false };
    lot.settled = true;
    if (this.pool) await this.pool.query('UPDATE auction_lots SET settled = TRUE WHERE id = $1', [lot.id]);
    const high = this.high(lot.id);
    if (high) {
      const piece = ART_BY_ID.get(lot.item);
      try { await getHomes()?.grant(high.name, lot.item, 1); }
      catch (e) { console.error('[auction] grant failed:', (e as Error).message); }
      return { settled: true, winner: high.name, item: piece?.id, amount: high.amount };
    }
    return { settled: true, winner: null };
  }

  async tick() {
    const now = this.clock();
    for (const l of this.lots.filter((x) => !x.settled && x.endAt <= now)) await this.settle(l.id);
    await this.ensureLive();
  }
}

let auction: ArtAuction | null = null;
export const getAuction = () => auction;
export function setAuction(a: ArtAuction | null) { auction = a; }
export async function initAuction(): Promise<void> {
  const url = databaseUrl();
  if (!url) { const a = new ArtAuction(null); await a.init(); setAuction(a); setBootState('auction', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[auction] pool error:', e.message));
  await bootAttach('auction', async () => { try { const a = new ArtAuction(pool as unknown as PoolLike); await a.init(); setAuction(a); a.tick(); setInterval(() => { void a.tick().catch((e) => console.error('[auction] tick failed:', (e as Error).message)); }, 15_000).unref?.(); console.log('[auction] ready'); return true; } catch (e) { console.error('[auction] init failed:', (e as Error).message); return false; } });
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerAuction(_io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const need = () => { const n = nameOf(); if (!n) throw new AuctionError('Sign in first.'); return n; };
  const on = (ev: string, fn: (b: Record<string, unknown>, a: ArtAuction) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try { if (!auction) throw new AuctionError('Opening up. Try again in a moment.'); const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; ack?.({ ok: true, ...((await fn(b, auction)) as object ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof AuctionError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); }
  });
  on('auction_view', async (_b, a) => a.view(nameOf()));
  on('auction_bid', async (b, a) => a.bid(need(), b.lotId, b.amount));
}
