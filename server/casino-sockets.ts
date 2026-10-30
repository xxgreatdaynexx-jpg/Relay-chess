/** Socket wiring for the shared blackjack tables and roulette wheel. Identity is the player's saved name. */
import type { Server, Socket } from 'socket.io';
import type { CasinoStanding } from '../shared/casino.js';
import { BlackjackCasino, type BJAction, type BlackjackTable } from './blackjack.js';
import { getBank } from './casino-store.js';
import { signedIn } from './auth-sockets.js';
import { RouletteWheel } from './roulette.js';

type Ack = (res: { ok: boolean; error?: string; [k: string]: unknown }) => void;

let casino: BlackjackCasino | null = null;
let wheel: RouletteWheel | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const bjWatchers = new Set<Socket>();
const rouletteWatchers = new Set<Socket>();

function standings(): CasinoStanding[] {
  return getBank().standings(25).map(({ name, chips, netWon, hands, spins, biggestWin }) => ({ name, chips, netWon, hands, spins, biggestWin }));
}

function nameOf(s: Socket): string | null {
  return (s.data as { account?: { name: string } }).account?.name ?? null;
}

function pushTable(t: BlackjackTable, now = Date.now()): void {
  for (const s of bjWatchers) {
    const n = nameOf(s);
    if (n && casino!.tableOf(n) === t) s.emit('bj_state', t.view(n, now));
  }
}

function pushWheel(now = Date.now()): void {
  for (const s of rouletteWatchers) s.emit('roulette_state', wheel!.view(nameOf(s), now));
}

function pushBoard(io: Server): void {
  io.to('casino-board').emit('casino_board', standings());
}

export function startCasino(io: Server): void {
  const now = Date.now();
  casino = new BlackjackCasino(getBank());
  wheel = new RouletteWheel(getBank(), now);
  timer = setInterval(() => {
    const t = Date.now();
    const changed = casino!.tick(t);
    for (const table of changed) pushTable(table, t);
    const settledBJ = changed.some((x) => x.phase === 'settled');
    const before = wheel!.phase;
    if (wheel!.tick(t)) {
      pushWheel(t);
      if (before === 'spinning') pushBoard(io);
    }
    if (settledBJ) pushBoard(io);
  }, 250);
  timer.unref?.();
}

export function stopCasino(): void {
  if (timer) clearInterval(timer);
  timer = null;
  bjWatchers.clear();
  rouletteWatchers.clear();
}

export function registerCasino(io: Server, socket: Socket): void {
  const wrap = (fn: (body: Record<string, unknown>, now: number) => Record<string, unknown> | void) => (payload: unknown, ack?: Ack) => {
    try {
      const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      const extra = fn(body, Date.now()) ?? {};
      ack?.({ ok: true, ...extra });
    } catch (err) {
      ack?.({ ok: false, error: (err as Error).message });
    }
  };
  const setName = (_body: Record<string, unknown>) => {
    const name = signedIn(socket);
    return name;
  };

  socket.on('casino_board', wrap(() => {
    void socket.join('casino-board');
    return { rows: standings() };
  }));

  socket.on('casino_me', wrap((body) => {
    const name = setName(body);
    return { chips: getBank().account(name).chips };
  }));

  socket.on('casino_reset', wrap((body) => {
    const name = setName(body);
    const a = getBank().reset(name);
    const t = casino!.tableOf(name);
    if (t) pushTable(t);
    pushWheel();
    return { chips: a.chips };
  }));

  socket.on('bj_join', wrap((body, now) => {
    const name = setName(body);
    bjWatchers.add(socket);
    const t = casino!.join(name, now);
    pushTable(t, now);
    return { table: t.view(name, now) };
  }));

  socket.on('bj_leave', wrap((_b, now) => {
    const name = nameOf(socket);
    bjWatchers.delete(socket);
    if (!name) return;
    const t = casino!.leave(name, now);
    if (t) pushTable(t, now);
  }));

  socket.on('bj_bet', wrap((body, now) => {
    const name = nameOf(socket);
    if (!name) throw new Error('Sit down first.');
    const t = casino!.tableOf(name);
    if (!t) throw new Error('Sit down first.');
    t.bet(name, Number(body.amount), now);
    pushTable(t, now);
  }));

  socket.on('bj_action', wrap((body, now) => {
    const name = nameOf(socket);
    const t = name ? casino!.tableOf(name) : null;
    if (!name || !t) throw new Error('Sit down first.');
    const action = String(body.action) as BJAction;
    if (!['hit', 'stand', 'double', 'split'].includes(action)) throw new Error('Unknown action.');
    t.act(name, action, now);
    pushTable(t, now);
    if (t.phase === 'settled') pushBoard(io);
  }));

  socket.on('roulette_watch', wrap((body, now) => {
    if (socket.data.account) setName(body);
    rouletteWatchers.add(socket);
    return { state: wheel!.view(nameOf(socket), now) };
  }));

  socket.on('roulette_unwatch', wrap(() => {
    rouletteWatchers.delete(socket);
  }));

  const rouletteAct = (fn: (name: string) => void) => wrap((body, now) => {
    const name = setName(body);
    if (!name) throw new Error('Save a name first.');
    fn(name);
    rouletteWatchers.add(socket);
    pushWheel(now);
  });
  socket.on('roulette_bet', (p: unknown, ack?: Ack) => rouletteAct((n) => wheel!.placeBet(n, (p as Record<string, unknown>)?.bet))(p, ack));
  socket.on('roulette_clear', rouletteAct((n) => wheel!.clear(n)));
  socket.on('roulette_rebet', rouletteAct((n) => wheel!.rebet(n)));

  socket.on('disconnect', () => {
    rouletteWatchers.delete(socket);
    if (!bjWatchers.delete(socket)) return;
    const name = nameOf(socket);
    if (!name) return;
    // Keep the seat if the same name has another live socket (other tab).
    for (const s of bjWatchers) if (nameOf(s) === name) return;
    const t = casino!.leave(name, Date.now());
    if (t) pushTable(t);
  });
}
