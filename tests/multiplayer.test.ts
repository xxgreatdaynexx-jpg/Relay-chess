import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeApp, createApp, type AppContext } from '../server/app.js';
import { resetLeaderboard } from '../server/leaderboard.js';
import type { Ack, LeaderboardRow, PublicState, Seat } from '../shared/types.js';

let ctx: AppContext;
let port = 0;
const opened: Socket[] = [];

beforeAll(async () => {
  resetLeaderboard(path.join(mkdtempSync(path.join(tmpdir(), 'relay-lb-')), 'leaderboard.json'));
  ctx = await createApp();
  await new Promise<void>((resolve) => {
    ctx.httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const address = ctx.httpServer.address() as AddressInfo;
  port = address.port;
});

afterAll(async () => {
  for (const socket of opened) socket.disconnect();
  await closeApp(ctx);
});

function connect() {
  const socket = ioClient(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    forceNew: true,
  });
  opened.push(socket);
  const states: PublicState[] = [];
  socket.on('state', (state: PublicState) => states.push(state));
  return {
    socket,
    states,
    latest: () => states.at(-1),
    until(pred: (state: PublicState) => boolean) {
      const existing = states.find(pred);
      if (existing) return Promise.resolve(existing);
      return new Promise<PublicState>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out. last=${JSON.stringify(states.at(-1))}`)), 5000);
        const onState = (state: PublicState) => {
          if (!pred(state)) return;
          clearTimeout(timer);
          socket.off('state', onState);
          resolve(state);
        };
        socket.on('state', onState);
      });
    },
  };
}

function ask(socket: Socket, event: string, data?: unknown): Promise<Ack> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ack for ${event}`)), 5000);
    socket.emit(event, data ?? {}, (res: Ack) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

it('serves a health check', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  expect(await response.json()).toEqual({ ok: true });
});

it('runs a four-player game, enforces turns, reconnects a seat, and rematches', async () => {
  const names = ['Ada', 'Jules', 'Sam', 'Ren'] as const;
  const seats: Seat[] = ['white1', 'black1', 'white2', 'black2'];
  const players = names.map(() => connect());

  const created = await ask(players[0].socket, 'create_room', { name: 'Ada', clockId: 'off' });
  expect(created.ok).toBe(true);
  const code = created.code!;
  const adaToken = created.token!;

  for (let index = 1; index < 4; index += 1) {
    const joined = await ask(players[index].socket, 'join_room', { code, name: names[index] });
    expect(joined.ok).toBe(true);
  }

  const spectator = connect();
  const watching = await ask(spectator.socket, 'join_room', { code, name: 'Nia' });
  expect(watching.ok).toBe(true);

  for (let index = 0; index < 3; index += 1) {
    expect((await ask(players[index].socket, 'sit', { seat: seats[index] })).ok).toBe(true);
  }
  const waiting = await players[0].until((state) => state.seats.white2?.name === 'Sam');
  expect(waiting.status).toBe('lobby');

  expect((await ask(players[3].socket, 'sit', { seat: 'black2' })).ok).toBe(true);
  const started = await players[0].until((state) => state.status === 'playing' && state.yourSeat === 'white1');
  expect(started.seatToMove).toBe('white1');
  expect(started.mode).toBe('2v2');
  expect(started.pairSide).toBeNull();
  const watched = await spectator.until((state) => state.status === 'playing');
  expect(watched.yourSeat).toBeNull();
  expect((await ask(spectator.socket, 'move', { from: 'f2', to: 'f3' })).ok).toBe(false);

  const mate = [
    { from: 'f2', to: 'f3' },
    { from: 'e7', to: 'e5' },
    { from: 'g2', to: 'g4' },
    { from: 'd8', to: 'h4' },
  ];
  for (let index = 0; index < mate.length; index += 1) {
    const wrong = players[(index + 1) % 4];
    const rejected = await ask(wrong.socket, 'move', mate[index]);
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toMatch(/turn/i);
    const accepted = await ask(players[index].socket, 'move', mate[index]);
    expect(accepted.ok).toBe(true);
    await players[0].until((state) => state.moves.length === index + 1);
  }

  const offered = await players[0].until((state) => state.bailout?.side === 'white' && state.moves.length === 4);
  expect(offered.result).toBeNull();
  expect(offered.status).toBe('playing');
  const denied = await ask(players[1].socket, 'pay_bailout');
  expect(denied.ok).toBe(false);
  expect((await ask(players[0].socket, 'accept_mate')).ok).toBe(true);

  const ended = await players[2].until((state) => state.result?.type === 'checkmate');
  expect(ended.result).toMatchObject({ type: 'checkmate', winner: 'black' });
  expect(ended.moves.map((move) => move.seat)).toEqual(['white1', 'black1', 'white2', 'black2']);
  expect(ended.moves.map((move) => move.san)).toEqual(['f3', 'e5', 'g4', 'Qh4#']);
  const board = await fetch(`http://127.0.0.1:${port}/api/leaderboard`);
  const body = (await board.json()) as { rows: LeaderboardRow[] };
  expect(body.rows.find((row) => row.name === 'Jules')).toMatchObject({ wins: 1, losses: 0 });
  expect(body.rows.find((row) => row.name === 'Ren')).toMatchObject({ wins: 1, losses: 0 });
  expect(body.rows.find((row) => row.name === 'Ada')).toMatchObject({ wins: 0, losses: 1 });
  expect(body.rows.find((row) => row.name === 'Nia')).toBeUndefined();

  for (const player of players) {
    expect((await ask(player.socket, 'vote_rematch')).ok).toBe(true);
  }
  const again = await players[0].until((state) => state.status === 'playing' && state.moves.length === 0);
  expect(again.seatToMove).toBe('white1');
  expect(again.fen.startsWith('rnbqkbnr/pppppppp')).toBe(true);

  players[0].socket.disconnect();
  await players[1].until((state) => state.seats.white1?.connected === false);
  const returned = connect();
  const rejoined = await ask(returned.socket, 'rejoin', { code, token: adaToken });
  expect(rejoined.ok).toBe(true);
  const home = await returned.until((state) => state.yourSeat === 'white1' && state.seats.white1?.connected === true);
  expect(home.seatToMove).toBe('white1');
  expect((await ask(returned.socket, 'move', { from: 'e2', to: 'e4' })).ok).toBe(true);
  await returned.until((state) => state.moves[0]?.san === 'e4' && state.seatToMove === 'black1');

  const missing = await ask(connect().socket, 'join_room', { code: 'ZZZZZZ', name: 'Ada' });
  expect(missing.ok).toBe(false);
});
