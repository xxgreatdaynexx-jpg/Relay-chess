import type { Server, Socket } from 'socket.io';
import { onBlunderReady } from './blunders.js';
import { GameError } from './errors.js';
import { onHintReady } from './hints.js';
import {
  createRoom,
  getRoom,
  listRooms,
  openRooms,
  presetOrThrow,
  pruneRooms,
  setupOrThrow,
  type Room,
} from './rooms.js';
import type { Ack, Promotion } from '../shared/types.js';

const CLOCK_PUSH_MS = 5000;
let timer: ReturnType<typeof setInterval> | null = null;

export function startMaintenance(io: Server): void {
  if (timer) return;
  timer = setInterval(() => {
    const now = Date.now();
    for (const room of listRooms()) {
      const hadResult = room.game.hasResult();
      const clocking = room.game.isClockRunning();
      if (clocking) room.game.tick(now);
      const expired = room.game.expireBailout(now);
      const flagged = !hadResult && room.game.hasResult();
      const due = clocking && now - room.lastClockPush > CLOCK_PUSH_MS;
      if (flagged || expired || due) {
        room.lastClockPush = now;
        broadcast(io, room.code, now);
      }
    }
    for (const code of pruneRooms(now)) expire(io, code);
  }, 200);
  (timer as unknown as { unref?: () => void }).unref?.();
}

export function stopMaintenance(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export function registerSockets(io: Server): void {
  onHintReady((fen) => {
    for (const room of listRooms()) {
      if (room.game.status === 'playing' && room.game.fen() === fen) broadcast(io, room.code);
    }
  });
  onBlunderReady((code) => {
    if (getRoom(code)) broadcast(io, code);
  });
  startMaintenance(io);

  io.on('connection', (socket) => {
    socket.on('create_room', (payload: unknown, ack?: (res: Ack) => void) => {
      try {
        const body = asRecord(payload);
        const name = cleanName(body.name);
        const preset = presetOrThrow(body.clockId);
        const setup = setupOrThrow(body.mode, body.pairSide);
        release(io, socket);
        const room = createRoom(preset, setup);
        const token = room.addMember(name);
        adopt(socket, room, token);
        ack?.({ ok: true, token, code: room.code });
        broadcast(io, room.code);
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('join_room', (payload: unknown, ack?: (res: Ack) => void) => {
      try {
        const body = asRecord(payload);
        const name = cleanName(body.name);
        const code = cleanCode(body.code);
        const room = getRoom(code);
        if (!room) throw new GameError('No table with that code. It may have expired.', true);
        release(io, socket);
        const token = room.addMember(name);
        adopt(socket, room, token);
        ack?.({ ok: true, token, code: room.code });
        broadcast(io, room.code);
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('open_tables', (_payload: unknown, ack?: (res: Ack) => void) => {
      ack?.({ ok: true, openTables: openRooms().length });
    });

    socket.on('quick_join', (payload: unknown, ack?: (res: Ack) => void) => {
      try {
        const body = asRecord(payload);
        const name = cleanName(body.name);
        const room = openRooms()[0];
        if (!room) throw new GameError('No open tables right now. Create one instead.');
        const seat = room.openSeats()[0];
        release(io, socket);
        const token = room.addMember(name);
        room.sit(token, seat);
        adopt(socket, room, token);
        ack?.({ ok: true, token, code: room.code });
        broadcast(io, room.code);
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('rejoin', (payload: unknown, ack?: (res: Ack) => void) => {
      try {
        const body = asRecord(payload);
        const code = cleanCode(body.code);
        const token = typeof body.token === 'string' ? body.token : '';
        const room = getRoom(code);
        if (!room || !token || !room.has(token)) {
          throw new GameError('That table is no longer available.', true);
        }
        adopt(socket, room, token);
        ack?.({ ok: true, token, code: room.code });
        broadcast(io, room.code);
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('sit', (payload: unknown, ack?: (res: Ack) => void) => {
      withRoom(io, socket, ack, (room, token) => {
        const body = asRecord(payload);
        room.sit(token, body.seat);
      });
    });

    socket.on('stand', (_payload: unknown, ack?: (res: Ack) => void) => {
      withRoom(io, socket, ack, (room, token) => {
        room.stand(token);
      });
    });

    socket.on('leave_table', (_payload: unknown, ack?: (res: Ack) => void) => {
      try {
        const code = socket.data.code as string | undefined;
        const token = socket.data.token as string | undefined;
        const room = code ? getRoom(code) : undefined;
        if (!room || !token) throw new GameError('You are not at a table.', true);
        room.leave(token);
        socket.leave(code!);
        delete socket.data.code;
        delete socket.data.token;
        ack?.({ ok: true });
        broadcast(io, room.code);
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('move', (payload: unknown, ack?: (res: Ack) => void) => {
      const code = socket.data.code as string | undefined;
      const room = code ? getRoom(code) : undefined;
      try {
        if (!room) throw new GameError('You are not at a table.', true);
        const token = socket.data.token as string | undefined;
        if (!token) throw new GameError('You are not at a table.', true);
        room.move(token, cleanMove(payload));
        ack?.({ ok: true });
        broadcast(io, room.code);
      } catch (error) {
        if (room?.game.hasResult()) broadcast(io, room.code);
        fail(ack, error);
      }
    });

    socket.on('resign', (_payload: unknown, ack?: (res: Ack) => void) => {
      withRoom(io, socket, ack, (room, token) => {
        room.resign(token);
      });
    });

    socket.on('offer_draw', (_payload: unknown, ack?: (res: Ack) => void) => {
      withRoom(io, socket, ack, (room, token) => {
        room.offerDraw(token);
      });
    });

    socket.on('answer_draw', (payload: unknown, ack?: (res: Ack) => void) => {
      withRoom(io, socket, ack, (room, token) => {
        const body = asRecord(payload);
        room.answerDraw(token, Boolean(body.accept));
      });
    });

    socket.on('vote_rematch', (_payload: unknown, ack?: (res: Ack) => void) => {
      withRoom(io, socket, ack, (room, token) => {
        room.voteRematch(token);
      });
    });

    socket.on('pay_bailout', (_payload: unknown, ack?: (res: Ack) => void) => {
      const code = socket.data.code as string | undefined;
      const room = code ? getRoom(code) : undefined;
      try {
        if (!room) throw new GameError('You are not at a table.', true);
        const token = socket.data.token as string | undefined;
        if (!token) throw new GameError('You are not at a table.', true);
        const declined = room.payBailout(token);
        ack?.({ ok: true, declined });
        broadcast(io, room.code);
      } catch (error) {
        if (room?.game.hasResult()) broadcast(io, room.code);
        fail(ack, error);
      }
    });

    socket.on('accept_mate', (_payload: unknown, ack?: (res: Ack) => void) => {
      withRoom(io, socket, ack, (room, token) => {
        room.acceptMate(token);
      });
    });

    socket.on('disconnect', () => {
      const code = socket.data.code as string | undefined;
      if (!code) return;
      const room = getRoom(code);
      room?.disconnect(socket.id);
      if (room && getRoom(code)) broadcast(io, code);
    });
  });
}

function withRoom(
  io: Server,
  socket: Socket,
  ack: ((res: Ack) => void) | undefined,
  fn: (room: Room, token: string) => void,
): void {
  const code = socket.data.code as string | undefined;
  const room = code ? getRoom(code) : undefined;
  try {
    if (!room) throw new GameError('You are not at a table.', true);
    const token = socket.data.token as string | undefined;
    if (!token) throw new GameError('You are not at a table.', true);
    fn(room, token);
    ack?.({ ok: true });
    broadcast(io, room.code);
  } catch (error) {
    if (room?.game.hasResult()) broadcast(io, room.code);
    fail(ack, error);
  }
}

function adopt(socket: Socket, room: Room, token: string): void {
  socket.data.code = room.code;
  socket.data.token = token;
  socket.join(room.code);
  room.connect(token, socket.id);
}

function release(io: Server, socket: Socket): void {
  const code = socket.data.code as string | undefined;
  if (!code) return;
  const room = getRoom(code);
  room?.disconnect(socket.id);
  socket.leave(code);
  delete socket.data.code;
  delete socket.data.token;
  if (room && getRoom(code)) broadcast(io, code);
}

export function broadcast(io: Server, code: string, now = Date.now()): void {
  const room = getRoom(code);
  if (!room) return;
  const members = io.sockets.adapter.rooms.get(code);
  if (!members) return;
  for (const id of members) {
    const sock = io.sockets.sockets.get(id);
    if (!sock) continue;
    sock.emit('state', room.view(id, now));
  }
}

function expire(io: Server, code: string): void {
  const members = io.sockets.adapter.rooms.get(code);
  if (!members) return;
  for (const id of [...members]) {
    const sock = io.sockets.sockets.get(id);
    if (!sock) continue;
    sock.emit('game_error', { message: 'This table expired.', fatal: true });
    sock.leave(code);
    delete sock.data.code;
    delete sock.data.token;
  }
}

function fail(ack: ((res: Ack) => void) | undefined, error: unknown): void {
  if (error instanceof GameError) {
    ack?.({ ok: false, error: error.message, fatal: error.fatal });
    return;
  }
  console.error(error);
  ack?.({ ok: false, error: 'Something went wrong.' });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return {};
}

export function cleanName(input: unknown): string {
  if (typeof input !== 'string') throw new GameError('Enter a name.');
  const name = input.replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > 18) throw new GameError('Enter a name (1–18 characters).');
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .'-]*$/u.test(name)) {
    throw new GameError('Use letters, numbers, and spaces in your name.');
  }
  return name;
}

export function cleanCode(input: unknown): string {
  if (typeof input !== 'string') throw new GameError('Enter a table code.');
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4 || code.length > 8) throw new GameError('Enter the table code.');
  return code;
}

export function cleanMove(input: unknown): { from: string; to: string; promotion?: Promotion } {
  const body = asRecord(input);
  const from = body.from;
  const to = body.to;
  const promotion = body.promotion;
  if (typeof from !== 'string' || typeof to !== 'string' || !/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to)) {
    throw new GameError('Illegal move.');
  }
  if (promotion == null || promotion === '') return { from, to };
  if (promotion !== 'q' && promotion !== 'r' && promotion !== 'b' && promotion !== 'n') {
    throw new GameError('Choose a queen, rook, bishop, or knight.');
  }
  return { from, to, promotion };
}
