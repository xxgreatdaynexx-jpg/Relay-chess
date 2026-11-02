import { beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { readFileSync } from 'node:fs';
import { ItemVault, resetVault } from '../server/skins';
import { Market, registerMarket, resetMarket } from '../server/market';
import { getBank, resetBank } from '../server/casino-store';
import { MemoryAccountStore, PgAccountStore, resetAccounts } from '../server/accounts';
import { lockLeft, NEW_ACCOUNT_TRADE_MS } from '../shared/tradeLock';

const H = 3_600_000;
let v: ItemVault; let m: Market; let store: MemoryAccountStore;
const acct = (name: string, ageMs: number) => store.accounts.set(name.toLowerCase(), { key: name.toLowerCase(), name, passwordHash: 'x', createdAt: Date.now() - ageMs });
const skin = (name: string) => { const i = v.make(name, 'skin', `t:${Math.random()}`, 'test', { id: 'c-pistol-0' } as never)!; v.commit([i], []); return i; };
type R = { ok: boolean; error?: string; [k: string]: unknown };
function client(name: string) {
  const h: Record<string, (p: unknown, ack: (r: R) => void) => Promise<void>> = {};
  const socket = { data: { account: { name } }, on: (ev: string, fn: never) => { h[ev] = fn; } };
  const io = { to: () => ({ emit: () => {} }) };
  registerMarket(io as never, socket as never);
  return (ev: string, body: object = {}) => new Promise<R>((res) => { void h[ev]!(body, res); });
}

beforeEach(() => {
  resetBank(); v = resetVault(); m = resetMarket(v);
  store = new MemoryAccountStore(); resetAccounts(store);
  acct('QA-Old', 30 * 24 * H); acct('QA-Old2', 48 * H); acct('QA-New', 2 * H);
  getBank().account('QA-Old'); getBank().account('QA-New'); getBank().account('QA-Old2');
});

describe('r14: no trading for the first 24 hours', () => {
  it('a new account cannot send, counter or accept trades, and nobody can trade with it', async () => {
    const neu = client('QA-New'); const old = client('QA-Old');
    let r = await neu('trade_offer', { to: 'QA-Old', give: [], want: [], giveChips: 1, wantChips: 0 });
    expect(r.ok).toBe(false); expect(r.error).toMatch(/first 24 hours.*You can trade in 2[12]h \d+m/);
    r = await old('trade_offer', { to: 'QA-New', give: [], want: [], giveChips: 1, wantChips: 0 });
    expect(r.ok).toBe(false); expect(r.error).toMatch(/QA-New joined less than 24 hours ago.*left/);
    // An offer made before the rule (or before the deploy) cannot be accepted or countered by either side.
    const t = m.offer('QA-Old', 'QA-New', [], [], 1, 0);
    expect((await neu('trade_accept', { id: t.id })).error).toMatch(/first 24 hours/);
    expect((await neu('trade_counter', { id: t.id, give: [], want: [], giveChips: 0, wantChips: 1 })).error).toMatch(/first 24 hours/);
    const t2 = m.offer('QA-New', 'QA-Old', [], [], 1, 0);
    expect((await old('trade_accept', { id: t2.id })).error).toMatch(/QA-New joined less than 24 hours ago/);
    expect(m.trades.get(t2.id)?.status).toBe('pending');
    // Cancelling / declining stays allowed so nothing gets stuck.
    expect((await neu('trade_cancel', { id: t2.id })).ok).toBe(true);
    expect((await neu('trade_decline', { id: t.id })).ok).toBe(true);
  });
  it('old accounts trade normally', async () => {
    const r = await client('QA-Old')('trade_offer', { to: 'QA-Old2', give: [], want: [], giveChips: 1, wantChips: 0 });
    expect(r.ok).toBe(true);
  });
  it('Market: a new account cannot list or buy, and nobody can buy a new account\'s listing', async () => {
    const neu = client('QA-New'); const old = client('QA-Old');
    expect((await neu('mkt_list', { id: skin('QA-New').id, price: 10 })).error).toMatch(/first 24 hours/);
    expect((await neu('mkt_list_stack', { type: 'ore', id: 'coal', qty: 1, unit: 1 })).error).toMatch(/first 24 hours/);
    const l = m.list('QA-Old', skin('QA-Old').id, 10);
    expect((await neu('mkt_buy', { id: l.id })).error).toMatch(/first 24 hours/);
    const ln = m.list('QA-New', skin('QA-New').id, 10); // listed before the rule
    const r = await old('mkt_buy', { id: ln.id });
    expect(r.error).toMatch(/QA-New joined less than 24 hours ago/); expect(m.listings.get(ln.id)?.status).toBe('active');
    m.stacks.set('s1', { id: 's1', seller: 'qa-new', sellerName: 'QA-New', type: 'ore', itemId: 'coal', qty: 5, total: 5, unit: 1, status: 'active', at: 0, sold: 0 } as never);
    expect((await old('mkt_buy_stack', { id: 's1', qty: 1 })).error).toMatch(/QA-New joined less than 24 hours ago/);
    const lo = m.list('QA-Old2', skin('QA-Old2').id, 10);
    expect((await old('mkt_buy', { id: lo.id })).ok).toBe(true);
  });
  it('unlocks at exactly 24 hours; trade_status reports the time left', async () => {
    acct('QA-Edge', NEW_ACCOUNT_TRADE_MS - 60_000);
    const s = await client('QA-Edge')('trade_status');
    expect(Number(s.lockMs)).toBeGreaterThan(0); expect(Number(s.lockMs)).toBeLessThanOrEqual(60_000);
    acct('QA-Edge', NEW_ACCOUNT_TRADE_MS + 1);
    expect((await client('QA-Edge')('trade_status')).lockMs).toBe(0);
    expect(lockLeft(5 * H + 12 * 60_000)).toBe('5h 12m'); expect(lockLeft(1)).toBe('1m');
  });
  it('Postgres store reads created_at; accounts without it are treated as old', async () => {
    const db = newDb(); const { Pool } = db.adapters.createPg(); const pg = new PgAccountStore(new Pool() as never); await pg.init();
    await pg.create({ key: 'qa-pg', name: 'QA-Pg', passwordHash: 'x' });
    const row = await pg.get('qa-pg');
    expect(Math.abs((row!.createdAt ?? 0) - Date.now())).toBeLessThan(60_000);
    resetAccounts(pg);
    expect(Number((await client('QA-Pg')('trade_status')).lockMs)).toBeGreaterThan(23 * H);
    store.accounts.set('qa-legacy', { key: 'qa-legacy', name: 'QA-Legacy', passwordHash: 'x' }); resetAccounts(store);
    expect((await client('QA-Legacy')('trade_status')).lockMs).toBe(0);
  });
  it('the Market and Trades UI show the lock banner; daily bonus untouched', () => {
    const ui = readFileSync('client/src/components/MarketPanel.tsx', 'utf8');
    expect(ui.match(/<TradeLockNote \/>/g)?.length).toBe(3);
    expect(readFileSync('server/daily-bonus.ts', 'utf8')).not.toMatch(/tradeLock|NEW_ACCOUNT_TRADE/);
  });
});
