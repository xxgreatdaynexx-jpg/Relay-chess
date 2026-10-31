import type { Server, Socket } from 'socket.io';
import { BROKE_BELOW, getBank, START_CHIPS } from './casino-store.js';
import { signedIn } from './auth-sockets.js';
import type { Ack } from '../shared/types.js';

const roomOf = (name: string) => `w:${name.trim().toLowerCase()}`;
let unsubscribe: (() => void) | null = null;
let attachedTo: Server | null = null;

/** Push every balance change to that account's open tabs. */
export function startWallet(io: Server): void {
  if (attachedTo === io && unsubscribe) return;
  unsubscribe?.();
  attachedTo = io;
  unsubscribe = getBank().onChange((a, tx) => {
    io.to(roomOf(a.name)).emit('wallet', { chips: a.chips, tx, brokeBelow: BROKE_BELOW, start: START_CHIPS });
  });
}

export function registerWallet(_io: Server, socket: Socket): void {
  const reply = (ack: unknown, res: Record<string, unknown>) => { if (typeof ack === 'function') (ack as (r: Ack) => void)(res as unknown as Ack); };
  /** Join this account's wallet room (leaving any previous one) and return balance + history. */
  socket.on('wallet_sub', async (_payload: unknown, ack?: unknown) => {
    for (const r of socket.rooms) if (r.startsWith('w:')) socket.leave(r);
    let name = '';
    try { name = signedIn(socket); } catch { return reply(ack, { ok: true, signedIn: false }); }
    socket.join(roomOf(name));
    const bank = getBank();
    reply(ack, { ok: true, signedIn: true, chips: bank.account(name).chips, history: await bank.recent(name, 25), brokeBelow: BROKE_BELOW, start: START_CHIPS });
  });
  socket.on('wallet_reset', (_payload: unknown, ack?: unknown) => {
    try {
      const a = getBank().reset(signedIn(socket));
      reply(ack, { ok: true, chips: a.chips });
    } catch (error) {
      reply(ack, { ok: false, error: (error as Error).message });
    }
  });
}
