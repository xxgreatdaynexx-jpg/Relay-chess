import type { Server, Socket } from 'socket.io';
import { getBank, START_CHIPS, WALLET_UNAVAILABLE } from './casino-store.js';
import { signedIn } from './auth-sockets.js';
import type { Ack } from '../shared/types.js';

export const roomOf = (name: string) => `w:${name.trim().toLowerCase()}`;
let unsubscribe: (() => void) | null = null;
let attachedTo: Server | null = null;

/** Push every balance change to that account's open tabs. */
export function startWallet(io: Server): void {
  if (attachedTo === io && unsubscribe) return;
  unsubscribe?.();
  attachedTo = io;
  unsubscribe = getBank().onChange((a, tx) => {
    io.to(roomOf(a.name)).emit('wallet', { chips: a.chips, tx, start: START_CHIPS });
  });
}

export const WALLET_PAGE = 25;
export const WALLET_PAGE_MAX = 50;

function pageLimit(n: unknown, fallback = WALLET_PAGE): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(1, Math.min(WALLET_PAGE_MAX, Math.floor(v)));
}

async function historyPage(name: string, limit: number, cursor?: number) {
  const rows = await getBank().recent(name, limit + 1, cursor);
  const hasMore = rows.length > limit;
  const history = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? history[history.length - 1]?.id : undefined;
  return { history, hasMore, ...(nextCursor != null ? { nextCursor } : {}) };
}

export function registerWallet(_io: Server, socket: Socket): void {
  const reply = (ack: unknown, res: Record<string, unknown>) => { if (typeof ack === 'function') (ack as (r: Ack) => void)(res as unknown as Ack); };
  /** Join this account's wallet room (leaving any previous one) and return balance + first history page. */
  socket.on('wallet_sub', async (payload: unknown, ack?: unknown) => {
    for (const r of socket.rooms) if (r.startsWith('w:')) socket.leave(r);
    let name = '';
    try { name = signedIn(socket); } catch { return reply(ack, { ok: true, signedIn: false }); }
    socket.join(roomOf(name));
    const bank = getBank();
    if (!bank.ready) return reply(ack, { ok: false, signedIn: true, unavailable: true, error: WALLET_UNAVAILABLE });
    try {
      const limit = pageLimit((payload as { limit?: unknown } | null)?.limit);
      const page = await historyPage(name, limit);
      reply(ack, { ok: true, signedIn: true, chips: await bank.refresh(name), ...page, start: START_CHIPS });
    } catch (e) { reply(ack, { ok: false, signedIn: true, unavailable: true, error: (e as Error).message }); }
  });
  /** Next wallet-log page: `{ cursor, limit }` where cursor is the last `id` from the previous page. */
  socket.on('wallet_history', async (payload: unknown, ack?: unknown) => {
    let name = '';
    try { name = signedIn(socket); } catch { return reply(ack, { ok: false, error: 'Sign in to view wallet history.' }); }
    const bank = getBank();
    if (!bank.ready) return reply(ack, { ok: false, unavailable: true, error: WALLET_UNAVAILABLE });
    const body = (payload ?? {}) as { cursor?: unknown; limit?: unknown };
    const cursor = Math.floor(Number(body.cursor));
    if (!Number.isFinite(cursor) || cursor <= 0) return reply(ack, { ok: false, error: 'cursor is required.' });
    try {
      reply(ack, { ok: true, ...await historyPage(name, pageLimit(body.limit), cursor) });
    } catch (e) { reply(ack, { ok: false, unavailable: true, error: (e as Error).message }); }
  });
}
