import type { Server, Socket } from 'socket.io';
import { registerChat, startPresence, stopPresence } from './chat.js';
import { onBlunderReady } from './blunders.js';
import { GameError } from './errors.js';
import { getRoomPersistence } from './room-store.js';
import { registerFps } from './fps.js';
import { AuthError, getAccounts } from './accounts.js';
import { registerAuth, signedIn } from './auth-sockets.js';
import { registerCasino, startCasino, stopCasino } from './casino-sockets.js';
import { getBank, isChipEvent, WALLET_UNAVAILABLE } from './casino-store.js';
import { registerWallet, startWallet } from './wallet-sockets.js';
import { registerSolitro } from './solitro.js';
import { registerSkins } from './skins.js';
import { registerMarket } from './market.js';
import { registerMines } from './mines.js';
import { registerFactory } from './factory.js';
import { registerConquest } from './conquest.js';
import { analyzePosition, onHintReady } from './hints.js';
import {
  createRoom,
  getRoom,
  listRooms,
  liveRooms,
  missingRoomMessage,
  openRooms,
  presetOrThrow,
  pruneRooms,
  setupOrThrow,
  type Room,
} from './rooms.js';
import { MAX_WAGER, type Ack, type Promotion, type TableSummary, type TournamentSummary } from '../shared/types.js';
import {
  createTournament,
  getTournament,
  listTournaments,
  pruneTournaments,
  type MatchRooms,
  type Tournament,
} from './tournament.js';

/** Tournament matches are ordinary 1v1 rooms with seats reserved by name. */
export const matchRooms: MatchRooms = {
  create(clockId, white, black, gameType = 'chess') {
    const room = createRoom(presetOrThrow(clockId), { mode: '1v1', pairSide: null }, gameType);
    room.tournament = { code: '', seats: { white1: white, black1: black } };
    return room.code;
  },
  status(code) {
    const room = getRoom(code);
    if (!room) return null;
    const used = { white: 0, black: 0 };
    for (const t of room.game.thinkTimes(Date.now())) used[t.seat.startsWith('white') ? 'white' : 'black'] += t.totalMs + t.currentMs;
    return {
      started: room.game.status !== 'lobby',
      ended: room.game.status === 'ended' && room.game.hasResult(),
      winner: room.game.result?.winner ?? null,
      present: { white: room.seatedAndConnected('white1'), black: room.seatedAndConnected('black1') },
      usedMs: used,
    };
  },
};

export function tournamentList(): TournamentSummary[] {
  return listTournaments()
    .filter((t) => t.status !== 'done' || Date.now() - t.lastActivity < 10 * 60 * 1000)
    .map((t) => ({ code: t.code, host: t.host, clockId: t.clockId, size: t.size, players: t.entrants.length, status: t.status }));
}

function pushTournament(io: Server, t: Tournament): void {
  const members = io.sockets.adapter.rooms.get(`t:${t.code}`);
  if (members) {
    for (const id of members) {
      const sock = io.sockets.sockets.get(id);
      sock?.emit('tournament', t.view(sock.data.tname as string | undefined));
    }
  }
  io.to(LOBBY).emit('tournaments', tournamentList());
}

function tournamentOrThrow(code: unknown): Tournament {
  const t = typeof code === 'string' ? getTournament(code.toUpperCase().replace(/[^A-Z0-9]/g, '')) : undefined;
  if (!t) throw new GameError('No tournament with that code. Tournaments are lost when the server restarts.');
  return t;
}

const CLOCK_PUSH_MS = 5000;
let timer: ReturnType<typeof setInterval> | null = null;
const LOBBY = 'lobby:tables';
const TABLES_PUSH_MS = 2000;
let lastTablesPush = 0;
let tablesQueued: ReturnType<typeof setTimeout> | null = null;

export function tableList(now = Date.now()): TableSummary[] {
  return liveRooms().map((room) => room.summary(now));
}

/** Push the live table list to every lobby watcher. */
export function pushTables(io: Server, now = Date.now()): void {
  lastTablesPush = now;
  const watchers = io.sockets.adapter.rooms.get(LOBBY);
  if (!watchers || watchers.size === 0) return;
  io.to(LOBBY).emit('tables', tableList(now));
}

function queueTables(io: Server): void {
  if (tablesQueued) return;
  tablesQueued = setTimeout(() => {
    tablesQueued = null;
    pushTables(io);
  }, 250);
  (tablesQueued as unknown as { unref?: () => void }).unref?.();
}

export function startMaintenance(io: Server): void {
  if (timer) return;
  timer = setInterval(() => {
    const now = Date.now();
    for (const room of listRooms()) {
      if (room.game.status === 'playing') scheduleBot(io, room);
      else clearBot(room.code);
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
    for (const t of listTournaments()) {
      if (t.sync(matchRooms, now)) {
        tagMatchRooms(t);
        pushTournament(io, t);
      }
    }
    pruneTournaments(now);
    let pruned = false;
    for (const code of pruneRooms(now)) {
      expire(io, code);
      pruned = true;
    }
    if (pruned || now - lastTablesPush > TABLES_PUSH_MS) pushTables(io, now);
  }, 200);
  (timer as unknown as { unref?: () => void }).unref?.();
}

export function stopMaintenance(): void {
  stopPresence();
  stopCasino();
  for (const code of [...botTimers.keys()]) clearBot(code);
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
  startCasino(io);
  startWallet(io);
  startPresence(io);

  io.use((socket, next) => {
    const token = (socket.handshake.auth as { session?: unknown } | undefined)?.session;
    if (!token) return next();
    getAccounts()
      .resume(token)
      .then((identity) => {
        socket.data.account = identity ?? undefined;
        next();
      })
      .catch(() => next());
  });

  io.on('connection', (socket) => {
    // Fail closed: while the chip DB isn't connected, refuse every chip-moving event before its handler runs.
    socket.use((packet, next) => {
      const event = String(packet[0]);
      if (getBank().ready || !isChipEvent(event)) return next();
      const ack = packet[packet.length - 1];
      if (typeof ack === 'function') (ack as (r: unknown) => void)({ ok: false, unavailable: true, error: WALLET_UNAVAILABLE });
    });
    // Tables saved before a restart/deploy are loaded on demand, before the handler runs.
    socket.use((packet, next) => {
      const [event, payload] = packet as [string, unknown];
      const code = (payload as { code?: unknown } | null)?.code;
      const store = getRoomPersistence();
      if (!store || typeof code !== 'string' || !['rejoin', 'join_room', 'spectate'].includes(event)) return next();
      store.loadOne(code.trim().toUpperCase()).finally(() => next());
    });
    registerAuth(socket);
    registerFps(io, socket);
    registerCasino(io, socket);
    registerWallet(io, socket);
    registerSolitro(io, socket);
    registerSkins(io, socket);
    registerMarket(io, socket);
    registerMines(io, socket);
    registerFactory(io, socket);
    registerChat(io, socket);
    registerConquest(io, socket);
    socket.on('create_room', (payload: unknown, ack?: (res: Ack) => void) => {
      try {
        const body = asRecord(payload);
        const name = signedIn(socket);
        const preset = presetOrThrow(body.clockId);
        const setup = setupOrThrow(body.mode, body.pairSide);
        const gameType = body.gameType === 'checkers' ? 'checkers' : 'chess';
        release(io, socket);
        const wager = Math.max(0, Math.min(MAX_WAGER, Math.floor(Number(body.wager) || 0)));
        if (wager > 0 && !getBank().canAfford(name, wager)) throw new GameError(`You need ${wager} chips to open that table. You have ${getBank().account(name).chips}.`);
        const room = createRoom(preset, setup, gameType);
        room.wager = wager;
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
        const name = signedIn(socket);
        void getBank().refresh(name).catch(() => {}); // re-sync the chip cache from Postgres before any wager
        const code = cleanCode(body.code);
        const room = getRoom(code);
        if (!room) throw new GameError(missingRoomMessage(code), true);
        release(io, socket);
        const token = room.addMember(name);
        adopt(socket, room, token);
        ack?.({ ok: true, token, code: room.code });
        broadcast(io, room.code);
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('tournament_create', (payload: unknown, ack?: (res: Ack) => void) => {
      try {
        const body = asRecord(payload);
        const name = signedIn(socket);
        const preset = presetOrThrow(body.clockId);
        const t = createTournament(name, preset.id, Number(body.size), Date.now(), body.gameType === 'checkers' ? 'checkers' : 'chess');
        socket.data.tname = name;
        socket.join(`t:${t.code}`);
        ack?.({ ok: true, tournament: t.view(name), hostKey: t.hostKey });
        pushTournament(io, t);
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('tournament_join', (payload: unknown, ack?: (res: Ack) => void) => {
      try {
        const body = asRecord(payload);
        const t = tournamentOrThrow(body.code);
        const name = socket.data.account ? signedIn(socket) : undefined;
        if (body.enter) t.join(signedIn(socket));
        socket.data.tname = name;
        socket.join(`t:${t.code}`);
        ack?.({ ok: true, tournament: t.view(name) });
        pushTournament(io, t);
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('tournament_leave', (payload: unknown, ack?: (res: Ack) => void) => {
      try {
        const body = asRecord(payload);
        const t = tournamentOrThrow(body.code);
        if (body.withdraw && socket.data.tname) t.leave(socket.data.tname as string);
        socket.leave(`t:${t.code}`);
        ack?.({ ok: true });
        pushTournament(io, t);
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('tournament_start', (payload: unknown, ack?: (res: Ack) => void) => {
      try {
        const body = asRecord(payload);
        const t = tournamentOrThrow(body.code);
        if (body.hostKey !== t.hostKey) throw new GameError('Only the host can start.');
        t.start(matchRooms);
        tagMatchRooms(t);
        ack?.({ ok: true });
        pushTournament(io, t);
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('tournament_forfeit', (payload: unknown, ack?: (res: Ack) => void) => {
      try {
        const body = asRecord(payload);
        const t = tournamentOrThrow(body.code);
        t.forfeit(String(body.hostKey ?? ''), cleanName(body.loser), matchRooms);
        tagMatchRooms(t);
        ack?.({ ok: true });
        pushTournament(io, t);
      } catch (error) {
        fail(ack, error);
      }
    });

    /** Sit the caller at their reserved seat in their current match. */
    socket.on('tournament_play', (payload: unknown, ack?: (res: Ack) => void) => {
      try {
        const body = asRecord(payload);
        const t = tournamentOrThrow(body.code);
        const name = signedIn(socket);
        const match = t.matchFor(name);
        if (!match?.room) throw new GameError('You have no match ready right now.');
        const room = getRoom(match.room);
        if (!room) throw new GameError('That match table expired.');
        const seat = match.white && match.white.toLowerCase() === name.toLowerCase() ? 'white1' : 'black1';
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

    socket.on('open_tables', (_payload: unknown, ack?: (res: Ack) => void) => {
      ack?.({ ok: true, openTables: openRooms().length, tables: tableList() });
    });

    socket.on('watch_tables', (_payload: unknown, ack?: (res: Ack) => void) => {
      socket.join(LOBBY);
      ack?.({ ok: true, openTables: openRooms().length, tables: tableList(), tournaments: tournamentList() });
    });

    socket.on('unwatch_tables', (_payload: unknown, ack?: (res: Ack) => void) => {
      socket.leave(LOBBY);
      ack?.({ ok: true });
    });

    socket.on('spectate', (payload: unknown, ack?: (res: Ack) => void) => {
      try {
        const body = asRecord(payload);
        const code = cleanCode(body.code);
        const room = getRoom(code);
        if (!room) throw new GameError(missingRoomMessage(code), true);
        release(io, socket);
        room.addSpectator(socket.id);
        socket.data.code = room.code;
        socket.data.spectating = true;
        socket.join(room.code);
        ack?.({ ok: true, code: room.code });
        broadcast(io, room.code);
      } catch (error) {
        fail(ack, error);
      }
    });

    socket.on('quick_join', (payload: unknown, ack?: (res: Ack) => void) => {
      try {
        const body = asRecord(payload);
        const name = signedIn(socket);
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
        if (!room) throw new GameError(missingRoomMessage(code), true);
        if (!token || !room.has(token)) {
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

    socket.on('add_bot', (payload: unknown, ack?: (res: Ack) => void) => {
      withRoom(io, socket, ack, (room, token) => {
        room.addBot(token, asRecord(payload).seat);
      });
    });

    socket.on('remove_bot', (payload: unknown, ack?: (res: Ack) => void) => {
      withRoom(io, socket, ack, (room, token) => {
        room.removeBot(token, asRecord(payload).seat);
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
        if (room && socket.data.spectating) {
          release(io, socket);
          ack?.({ ok: true });
          return;
        }
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
        if (socket.data.spectating) throw new GameError('Spectators can only watch.');
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

    socket.on('set_scramble', (payload: unknown, ack?: (res: Ack) => void) => {
      withRoom(io, socket, ack, (room, token) => {
        room.setScramble(token, Boolean(asRecord(payload).on));
      });
    });

    socket.on('analyze', (payload: unknown, ack?: (res: Ack) => void) => {
      const fen = asRecord(payload).fen;
      if (typeof fen !== 'string' || fen.length > 120) {
        ack?.({ ok: false, error: 'Bad position.' });
        return;
      }
      void analyzePosition(fen).then(
        (evaluation) => ack?.({ ok: true, evaluation }),
        () => ack?.({ ok: false, error: 'The engine is busy. Try again.' }),
      );
    });

    socket.on('pay_bailout', (_payload: unknown, ack?: (res: Ack) => void) => {
      const code = socket.data.code as string | undefined;
      const room = code ? getRoom(code) : undefined;
      try {
        if (!room) throw new GameError('You are not at a table.', true);
        if (socket.data.spectating) throw new GameError('Spectators can only watch.');
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

function tagMatchRooms(t: Tournament): void {
  for (const m of t.liveMatches()) {
    const room = m.room ? getRoom(m.room) : undefined;
    if (room?.tournament) room.tournament.code = t.code;
  }
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
    if (socket.data.spectating) throw new GameError('Spectators can only watch.');
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
  if (socket.data.spectating) {
    const prior = getRoom(socket.data.code as string);
    prior?.removeSpectator(socket.id);
    if (socket.data.code) socket.leave(socket.data.code as string);
    delete socket.data.spectating;
  }
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
  room?.removeSpectator(socket.id);
  socket.leave(code);
  delete socket.data.code;
  delete socket.data.token;
  delete socket.data.spectating;
  if (room && getRoom(code)) broadcast(io, code);
}

const botTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Make sure a pending bot turn will run. One timer per room; cleared when the room ends or expires. */
export function scheduleBot(io: Server, room: Room): void {
  if (botTimers.has(room.code)) return;
  const delay = room.botDelay();
  if (delay < 0) return;
  const handle = setTimeout(() => {
    botTimers.delete(room.code);
    if (getRoom(room.code) !== room) return;
    try {
      if (room.playBot()) broadcast(io, room.code);
    } catch (error) {
      console.error('bot turn failed', error);
    }
    scheduleBot(io, room);
  }, delay);
  (handle as unknown as { unref?: () => void }).unref?.();
  botTimers.set(room.code, handle);
}

export function clearBot(code: string): void {
  const handle = botTimers.get(code);
  if (handle) clearTimeout(handle);
  botTimers.delete(code);
}

export function broadcast(io: Server, code: string, now = Date.now()): void {
  const room = getRoom(code);
  if (!room) return;
  queueTables(io);
  if (room.game.status !== 'playing') clearBot(code);
  else scheduleBot(io, room);
  const members = io.sockets.adapter.rooms.get(code);
  if (!members) return;
  for (const id of members) {
    const sock = io.sockets.sockets.get(id);
    if (!sock) continue;
    sock.emit('state', room.view(id, now));
  }
}

function expire(io: Server, code: string): void {
  clearBot(code);
  const members = io.sockets.adapter.rooms.get(code);
  if (!members) return;
  for (const id of [...members]) {
    const sock = io.sockets.sockets.get(id);
    if (!sock) continue;
    sock.emit('game_error', { message: 'This table expired.', fatal: true });
    sock.leave(code);
    delete sock.data.code;
    delete sock.data.token;
    delete sock.data.spectating;
  }
}

function fail(ack: ((res: Ack) => void) | undefined, error: unknown): void {
  if (error instanceof GameError) {
    ack?.({ ok: false, error: error.message, fatal: error.fatal });
    return;
  }
  if (error instanceof AuthError) {
    ack?.({ ok: false, error: error.message, auth: true });
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

export function cleanMove(input: unknown): { from: string; to: string; promotion?: Promotion; via?: string[] } {
  const body = asRecord(input);
  const via = Array.isArray(body.via) ? body.via.filter((s): s is string => typeof s === 'string' && /^[a-h][1-8]$/.test(s)).slice(0, 12) : [];
  const from = body.from;
  const to = body.to;
  const promotion = body.promotion;
  if (typeof from !== 'string' || typeof to !== 'string' || !/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to)) {
    throw new GameError('Illegal move.');
  }
  if (via.length) return { from, to, via };
  if (promotion == null || promotion === '') return { from, to };
  if (promotion !== 'q' && promotion !== 'r' && promotion !== 'b' && promotion !== 'n') {
    throw new GameError('Choose a queen, rook, bishop, or knight.');
  }
  return { from, to, promotion };
}
