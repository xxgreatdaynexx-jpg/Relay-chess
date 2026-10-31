import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Server, Socket } from 'socket.io';
import { registerWallet } from '../server/wallet-sockets.js';
import { registerCasino } from '../server/casino-sockets.js';
import { CasinoBank, START_CHIPS, getBank, resetBank } from '../server/casino-store.js';

function fakeSocket() {
  const s = new EventEmitter() as EventEmitter & Record<string, unknown>;
  Object.assign(s, { id: 'sock1', rooms: new Set<string>(), data: {}, join() {}, leave() {}, to() { return { emit() {} }; }, emit() { return true; }, handshake: { headers: {}, address: '' } });
  return s as unknown as Socket & EventEmitter;
}
const io = { to: () => ({ emit() {} }), emit() {}, sockets: { sockets: new Map() } } as unknown as Server;

describe('"Broke? Refill to 1,000" is gone', () => {
  beforeEach(() => resetBank());
  it('no wallet_reset or casino_reset socket handler is registered', () => {
    const s = fakeSocket();
    registerWallet(io, s);
    registerCasino(io, s);
    expect(s.listenerCount('casino_me')).toBe(1);
    expect(s.listenerCount('wallet_sub')).toBe(1);
    expect(s.listenerCount('wallet_reset')).toBe(0);
    expect(s.listenerCount('casino_reset')).toBe(0);
    // emitting the old events is ignored: no ack, balance unchanged
    getBank().debit('Ada', 998);
    let acked = false;
    s.emit('wallet_reset', {}, () => { acked = true; });
    s.emit('casino_reset', { name: 'Ada' }, () => { acked = true; });
    expect(acked).toBe(false);
    expect(getBank().account('Ada').chips).toBe(2);
  });
  it('bank has no reset; new accounts still start at 1,000', () => {
    const bank = new CasinoBank();
    expect((bank as unknown as Record<string, unknown>).reset).toBeUndefined();
    expect(START_CHIPS).toBe(1000);
    expect(bank.account('Newbie').chips).toBe(1000);
  });
});
