import { ensureSignedIn } from './auth-helper';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeApp, createApp, type AppContext } from '../server/app.js';
import { resetLeaderboard } from '../server/leaderboard.js';
import type { Ack, PublicState, Seat, TableSummary } from '../shared/types.js';

let ctx: AppContext;
let port = 0;
const opened: Socket[] = [];

beforeAll(async () => {
  resetLeaderboard(path.join(mkdtempSync(path.join(tmpdir(), 'relay-spec-')), 'leaderboard.json'));
  ctx = await createApp();
  await new Promise<void>((resolve) => ctx.httpServer.listen(0, '127.0.0.1', () => resolve()));
  port = (ctx.httpServer.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const socket of opened) socket.disconnect();
  await closeApp(ctx);
});

function connect() {
  const socket = ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
  opened.push(socket);
  const states: PublicState[] = [];
  const lists: TableSummary[][] = [];
  socket.on('state', (s: PublicState) => states.push(s));
  socket.on('tables', (t: TableSummary[]) => lists.push(t));
  const wait = <T>(arr: T[], pred: (v: T) => boolean) =>
    new Promise<T>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const hit = arr.find(pred);
        if (hit) return resolve(hit);
        if (Date.now() - start > 5000) return reject(new Error('timeout'));
        setTimeout(tick, 20);
      };
      tick();
    });
  return {
    socket,
    states,
    until: (pred: (s: PublicState) => boolean) => wait(states, pred),
    list: (pred: (t: TableSummary[]) => boolean) => wait(lists, pred),
  };
}

async function ask(socket: Socket, event: string, data?: unknown): Promise<Ack> {
  await ensureSignedIn(socket, data);
  return new Promise((resolve) => socket.emit(event, data ?? {}, (res: Ack) => resolve(res)));
}

it('runs a 3v3 with a spectator who can watch but never act', async () => {
  const lobby = connect();
  const initial = await ask(lobby.socket, 'watch_tables');
  expect(initial.ok).toBe(true);

  const seats: Seat[] = ['white1', 'black1', 'white2', 'black2', 'white3', 'black3'];
  const players = seats.map(() => connect());
  const created = await ask(players[0].socket, 'create_room', { name: 'P0', clockId: '5+0', mode: '3v3' });
  expect(created.ok).toBe(true);
  const code = created.code!;
  await lobby.list((t) => t.some((row) => row.code === code && row.mode === '3v3' && row.total === 6));
  for (let i = 1; i < 6; i += 1) expect((await ask(players[i].socket, 'join_room', { code, name: `P${i}` })).ok).toBe(true);
  for (let i = 0; i < 6; i += 1) expect((await ask(players[i].socket, 'sit', { seat: seats[i] })).ok).toBe(true);
  await players[0].until((s) => s.status === 'playing');

  const watcher = connect();
  const spec = await ask(watcher.socket, 'spectate', { code });
  expect(spec.ok).toBe(true);
  expect(spec.token).toBeUndefined();
  const seen = await watcher.until((s) => s.status === 'playing' && s.spectating);
  expect(seen.legalMoves).toEqual([]);
  expect(seen.yourSeat).toBeNull();
  await players[0].until((s) => s.watching === 1);
  await lobby.list((t) => t.some((row) => row.code === code && row.status === 'playing' && row.watching === 1));

  for (const event of ['move', 'resign', 'offer_draw', 'pay_bailout', 'accept_mate', 'vote_rematch']) {
    const res = await ask(watcher.socket, event, { from: 'e2', to: 'e4', seat: 'white1' });
    expect(res.ok).toBe(false);
  }
  expect((await ask(watcher.socket, 'sit', { seat: 'white1' })).ok).toBe(false);

  expect((await ask(players[0].socket, 'move', { from: 'e2', to: 'e4' })).ok).toBe(true);
  await watcher.until((s) => s.moves.length === 1);

  expect((await ask(watcher.socket, 'leave_table')).ok).toBe(true);
  const after = await players[1].until((s) => s.watching === 0 && s.moves.length === 1);
  expect(after.status).toBe('playing');
  expect(after.moves).toHaveLength(1);
  expect((await ask(players[1].socket, 'move', { from: 'e7', to: 'e5' })).ok).toBe(true);
});
