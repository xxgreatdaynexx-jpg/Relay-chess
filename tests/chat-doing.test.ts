import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import { cleanDoing, doingLabel, topDoing, DOING_KINDS, DOING_INFO, DOING_RANK, DOING_DETAIL_MAX } from '../shared/doing';
import { buildSnapshot, resetChatLog, getChatLog } from '../server/chat';
import { resetAccounts } from '../server/accounts.js';
import { closeApp, createApp, type AppContext } from '../server/app.js';

describe('chat activity status (pure)', () => {
  it('every kind has an icon, label and rank', () => {
    for (const k of DOING_KINDS) { expect(DOING_INFO[k].label).toBeTruthy(); expect(typeof DOING_RANK[k]).toBe('number'); }
  });
  it('validates reports: known kinds only, detail sanitized + capped', () => {
    expect(cleanDoing({ kind: 'mining', detail: 'Magma Depths' })).toEqual({ kind: 'mining', detail: 'Magma Depths' });
    expect(cleanDoing({ kind: 'hacking' })).toBeNull();
    expect(cleanDoing('mining')).toBeNull();
    expect(cleanDoing(null)).toBeNull();
    expect(cleanDoing({ kind: 'farming', detail: '<b>North</b>\nField' })).toEqual({ kind: 'farming', detail: 'North Field' });
    expect(cleanDoing({ kind: 'farming', detail: 42 })).toEqual({ kind: 'farming' });
    expect(cleanDoing({ kind: 'farming', detail: '   ' })).toEqual({ kind: 'farming' });
    expect([...cleanDoing({ kind: 'cooking', detail: 'x'.repeat(200) })!.detail!].length).toBe(DOING_DETAIL_MAX);
  });
  it('labels', () => {
    expect(doingLabel({ kind: 'mining', detail: 'Magma Depths' })).toBe('⛏️ Mining · Magma Depths');
    expect(doingLabel({ kind: 'stocks' })).toBe('📈 Stock market');
    expect(doingLabel(null)).toBe('');
  });
  it('picks the most relevant activity; ties go to the latest', () => {
    expect(topDoing([{ kind: 'city' }, { kind: 'mining', detail: 'The Mine' }, { kind: 'farming' }])).toEqual({ kind: 'mining', detail: 'The Mine' });
    expect(topDoing([{ kind: 'cooking' }, { kind: 'farming' }])).toEqual({ kind: 'farming' });
    expect(topDoing([])).toBeNull();
  });
  it('snapshot: newest tab wins per user, guests/bots never carry status', () => {
    const tt = () => null;
    const snap = buildSnapshot([
      { name: 'Dayne', activities: [], doing: { kind: 'farming' }, doingAt: 10 },
      { name: 'dayne', activities: [], doing: { kind: 'stocks' }, doingAt: 20 },
      { name: 'Liam', activities: [], doing: null },
      { name: null, activities: [], doing: { kind: 'mining' }, doingAt: 5 },
    ], false, tt);
    expect(snap.users.find((u) => u.name === 'Dayne')?.doing).toEqual({ kind: 'stocks' });
    expect(snap.users.find((u) => u.name === 'Liam')?.doing ?? null).toBeNull();
    expect(snap.guests).toBe(1);
  });
});

describe('chat activity over sockets', () => {
  let ctx: AppContext; let base = ''; const socks: Socket[] = [];
  beforeAll(async () => {
    resetAccounts(); resetChatLog(); ctx = await createApp();
    await new Promise<void>((r) => ctx.httpServer.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(ctx.httpServer.address() as AddressInfo).port}`;
  });
  afterAll(async () => { for (const s of socks) s.close(); await closeApp(ctx); });
  const connect = async () => { const s = ioClient(base, { transports: ['websocket'], forceNew: true }); socks.push(s); await new Promise<void>((r) => s.once('connect', () => r())); return s; };
  const call = <T,>(s: Socket, ev: string, data: unknown = {}) => new Promise<T>((r) => s.emit(ev, data, r));
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('reports status into the online list, throttles bursts, and never posts into chat', async () => {
    const a = await connect();
    await call(a, 'auth_claim', { name: 'Miner', password: 'test-pass-123' });
    const viewer = await connect();
    const before = getChatLog().size;
    a.emit('presence', { activities: [], doing: { kind: 'mining', detail: 'Magma Depths' } });
    a.emit('presence', { activities: [], doing: { kind: 'stocks' } }); // inside the throttle window: dropped
    await wait(50);
    type On = { users: { name: string; doing?: { kind: string; detail?: string } | null }[] };
    let on = await call<On>(viewer, 'online_get');
    expect(on.users.find((u) => u.name === 'Miner')?.doing).toEqual({ kind: 'mining', detail: 'Magma Depths' });
    await wait(550);
    a.emit('presence', { activities: [], doing: { kind: 'bogus' } });
    await wait(50);
    on = await call<On>(viewer, 'online_get');
    expect(on.users.find((u) => u.name === 'Miner')?.doing ?? null).toBeNull();
    expect(getChatLog().size).toBe(before);
  });
});
