import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as ioClient, type Socket } from 'socket.io-client';
import { newDb } from 'pg-mem';
import { Homes, registerHomes, resetHomesForTest, setHomes } from '../server/homes';
import { getBank, resetBank } from '../server/casino-store';
import { setPriceIndexForTest } from '../server/price-index';
import { properties } from '../shared/realEstate';
import { isHomeProperty } from '../shared/homes';

const [H1] = properties().filter(isHomeProperty).map((p) => p.id);
type A = { ok: boolean; error?: string; [k: string]: unknown };
let io: Server; let port = 0; const opened: Socket[] = [];
const owners = new Map<string, string>();

beforeAll(async () => {
  const http = createServer(); io = new Server(http);
  io.use((s, next) => { const n = (s.handshake.auth as { name?: string }).name; if (n) (s.data as { account?: { name: string } }).account = { name: n }; next(); });
  io.on('connection', (s) => registerHomes(io, s));
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', () => r())); port = (http.address() as AddressInfo).port;
});
afterAll(() => { for (const s of opened) s.disconnect(); io.close(); setHomes(null); });
beforeEach(() => { resetBank(); setPriceIndexForTest(1); resetHomesForTest(); owners.clear(); owners.set(H1, 'Ann'); setHomes(new Homes(null, async (id) => owners.get(id) ?? null)); });

const connect = async (name?: string) => { const s = ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true, auth: name ? { name } : {} }); opened.push(s); await new Promise<void>((r) => s.on('connect', () => r())); return s; };
const ask = (s: Socket, ev: string, d?: unknown) => new Promise<A>((r) => s.emit(ev, d, r));
const next = <T>(s: Socket, ev: string, pred: (x: T) => boolean = () => true) => new Promise<T>((res, rej) => { const t = setTimeout(() => rej(new Error(`no ${ev}`)), 3000); const f = (x: T) => { if (pred(x)) { clearTimeout(t); s.off(ev, f); res(x); } }; s.on(ev, f); });

describe('homes over sockets', () => {
  it('server enforces access: open, invite list, locked; guests must sign in', async () => {
    const ann = await connect('Ann'); const bob = await connect('Bob'); const cy = await connect('Cy'); const anon = await connect();
    expect((await ask(anon, 'home_enter', { id: H1 })).ok).toBe(false);
    expect((await ask(bob, 'home_enter', { id: H1 })).error).toMatch(/invite only/); // new homes default to invite-only
    expect((await ask(ann, 'home_access', { id: H1, access: 'open' })).ok).toBe(true);
    expect((await ask(bob, 'home_enter', { id: H1 })).ok).toBe(true);
    await ask(bob, 'home_leave');
    expect((await ask(bob, 'home_access', { id: H1, access: 'locked' })).error).toMatch(/owner/i); // only the owner sets access
    expect((await ask(ann, 'home_access', { id: H1, access: 'invite', invites: ['bob'] })).ok).toBe(true);
    expect((await ask(bob, 'home_enter', { id: H1 })).ok).toBe(true);
    const cyTry = await ask(cy, 'home_enter', { id: H1 }); expect(cyTry.ok).toBe(false); expect(cyTry.error).toMatch(/invite only/);
    const kicked = next<{ why: string }>(bob, 'home_kicked');
    expect((await ask(ann, 'home_access', { id: H1, access: 'locked' })).ok).toBe(true);
    expect((await kicked).why).toMatch(/locked/); // already-inside visitors are removed
    expect((await ask(bob, 'home_enter', { id: H1 })).error).toMatch(/locked/);
    expect((await ask(ann, 'home_enter', { id: H1 })).ok).toBe(true); // owner always gets in
  });
  it('visitors see each other join, move, chat and layout changes in real time', async () => {
    const ann = await connect('Ann'); const bob = await connect('Bob');
    await ask(ann, 'home_access', { id: H1, access: 'open' });
    const a = await ask(ann, 'home_enter', { id: H1 }); expect(a.owner).toBe(true);
    const joined = next<{ peers: { name: string }[] }>(ann, 'home_peers', (p) => p.peers.length === 2);
    const b = await ask(bob, 'home_enter', { id: H1 }); expect(b.owner).toBe(false); expect((b.home as { invites: string[] }).invites).toEqual([]);
    expect((await joined).peers.map((p) => p.name).sort()).toEqual(['Ann', 'Bob']);
    const moved = next<{ sid: string; x: number; z: number }>(ann, 'home_pos');
    bob.emit('home_pos', { x: 4.2, z: 3.1, ry: 1 });
    expect(await moved).toMatchObject({ sid: bob.id, x: 4.2, z: 3.1 });
    const chat = next<{ name: string; text: string }>(ann, 'home_chat'); bob.emit('home_chat', 'nice place');
    expect(await chat).toMatchObject({ name: 'Bob', text: 'nice place' });
    await getBank().transferConfirmed('Ann', 5_000, { key: 'fund:sock', game: 'admin' });
    expect((await ask(ann, 'furn_buy', { item: 'lamp' })).ok).toBe(true);
    const lay = next<{ layout: { items: unknown[] } }>(bob, 'home_layout');
    expect((await ask(ann, 'home_save', { id: H1, layout: { wall: 'plaster', floor: 'laminate', items: [{ uid: 'l1', f: 'lamp', x: 2, z: 2, r: 0 }] } })).ok).toBe(true);
    expect((await lay).layout.items).toHaveLength(1);
    expect((await ask(bob, 'home_save', { id: H1, layout: { wall: 'plaster', floor: 'laminate', items: [] } })).ok).toBe(false); // visitors can't edit
    const left = next<{ peers: unknown[] }>(ann, 'home_peers', (p) => p.peers.length === 1);
    bob.disconnect(); expect((await left).peers).toHaveLength(1);
  });
});

describe('placement persistence', () => {
  it('a saved layout (move + rotate + remove) survives a server restart (Postgres)', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    const own = async () => 'Ann';
    const h1 = new Homes(pool as never, own); await h1.init();
    await getBank().transferConfirmed('Ann', 20_000, { key: 'fund:persist', game: 'admin' });
    await h1.buy('Ann', 'sofa', 1); await h1.buy('Ann', 'lamp', 2);
    await h1.save('Ann', H1, { wall: 'plaster', floor: 'laminate', items: [{ uid: 's', f: 'sofa', x: 0, z: 0, r: 0 }, { uid: 'l', f: 'lamp', x: 5, z: 5, r: 0 }, { uid: 'm', f: 'lamp', x: 6, z: 6, r: 0 }] });
    await h1.save('Ann', H1, { wall: 'plaster', floor: 'laminate', items: [{ uid: 's', f: 'sofa', x: 3, z: 2, r: 1 }, { uid: 'l', f: 'lamp', x: 5, z: 5, r: 0 }] });
    const h2 = new Homes(pool as never, own); await h2.init();
    expect((await h2.state(H1)).layout.items).toEqual([{ uid: 's', f: 'sofa', x: 3, z: 2, r: 1 }, { uid: 'l', f: 'lamp', x: 5, z: 5, r: 0 }]);
    expect((await h2.locker('Ann')).items).toEqual(expect.arrayContaining([{ item: 'lamp', qty: 2, placed: 1 }, { item: 'sofa', qty: 1, placed: 1 }]));
  });
});
