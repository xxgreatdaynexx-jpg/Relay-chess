/**
 * PvP Hockey server (Millionaire Update). One shared rink, modelled on the Arena (server/fps.ts): sockets join a room,
 * a fixed-rate ticker runs the authoritative HockeyGame, bots fill every empty slot, and the only chips that move are a
 * small house-paid win prize through the shared wallet + ledger (keyed per match + account, so it can never pay twice).
 * Free to play: no entry fee, so nobody can lose chips here.
 */
import type { Server, Socket } from 'socket.io';
import { getBank } from './casino-store.js';
import { px } from './price-index.js';
import { dayKey } from '../shared/mines.js';
import { driveBots, HK_DAILY_PAID_WINS, HK_TICK_HZ, HK_WIN_CHIPS, HockeyGame, prizeWinners, type HkEvent, type HkResult, type HkTeam } from '../shared/hockey.js';

const ROOM = '__hockey_rink';
/** Dev/QA only: HOCKEY_PERIOD_S shortens periods (ignored in production). */
const devPeriodS = () => { const n = Number(process.env.HOCKEY_PERIOD_S); return process.env.NODE_ENV !== 'production' && n >= 10 ? n : undefined; };
let game = new HockeyGame({ periodS: devPeriodS() });
game.fillBots();
let ticker: ReturnType<typeof setInterval> | null = null;
/** socket id -> signed-in account name (guests are absent and never paid). */
const claimed = new Map<string, string>();
/** account(lower) -> { day, paid wins today } */
const paidToday = new Map<string, { day: string; n: number }>();
const acct = (n: string) => n.trim().toLowerCase();
let lastResultId = '';

export const getHockeyGame = () => game;
export function claimHockeyName(id: string, name: string | null): void { if (name) claimed.set(id, name); else claimed.delete(id); }
export function resetHockey(seed?: number): HockeyGame {
  if (ticker) clearInterval(ticker);
  ticker = null;
  game = new HockeyGame({ seed, periodS: devPeriodS() });
  game.fillBots();
  claimed.clear(); paidToday.clear(); lastResultId = '';
  return game;
}

/** Pays the win prize once per finished match. Returns the result with `prize` and `account` filled in. */
export function settleHockey(r: HkResult, now = Date.now()): HkResult {
  if (lastResultId === r.matchId) return r;
  lastResultId = r.matchId;
  const totalPlayS = Math.max(0, ...r.players.map((p) => p.playS));
  for (const p of r.players) { const a = !p.bot ? claimed.get(p.id) : undefined; if (a) p.account = a; }
  const winners = prizeWinners({ winner: r.winner, players: r.players, totalPlayS });
  const day = dayKey(now);
  const amount = px(HK_WIN_CHIPS);
  const paid: string[] = [];
  for (const name of winners) {
    const k = acct(name);
    const d = paidToday.get(k);
    const n = d && d.day === day ? d.n : 0;
    if (n >= HK_DAILY_PAID_WINS) continue;
    if (getBank().transfer(name, amount, { key: `hockey-win:${r.matchId}:${k}`, game: 'hockey', memo: 'Hockey win' })) {
      paidToday.set(k, { day, n: n + 1 });
      paid.push(name);
    }
  }
  if (paid.length) r.prize = { names: paid, amount };
  return r;
}

function emit(io: Server, events: HkEvent[]): void {
  for (const e of events) {
    if (e.ev === 'hk_end' && game.result) settleHockey(game.result);
    io.to(ROOM).emit(e.ev, e.data);
  }
}

function ensureTicker(io: Server): void {
  if (ticker) return;
  ticker = setInterval(() => {
    if (!game.humans().length) { if (ticker) clearInterval(ticker); ticker = null; return; }
    driveBots(game);
    emit(io, game.tick());
    io.to(ROOM).emit('hk_state', game.snapshot());
  }, Math.round(1000 / HK_TICK_HZ));
  (ticker as unknown as { unref?: () => void }).unref?.();
}

const body = (p: unknown) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {});

function leave(io: Server, socket: Socket): void {
  if (!game.leave(socket.id)) return;
  claimed.delete(socket.id);
  socket.leave(ROOM);
  io.to(ROOM).emit('hk_state', game.snapshot());
}

export function registerHockey(io: Server, socket: Socket): void {
  socket.on('hk_join', (payload: unknown, ack?: (res: unknown) => void) => {
    const b = body(payload);
    const account = (socket.data.account as { name?: string } | undefined)?.name;
    const team = b.team === 0 || b.team === 1 ? (b.team as HkTeam) : undefined;
    const name = account ?? `Guest ${socket.id.slice(0, 4)}`;
    const p = game.join(socket.id, name, { team, goalie: b.goalie === true });
    if (!p) { if (typeof ack === 'function') ack({ ok: false, error: 'The rink is full (8 players). Try again soon.' }); return; }
    claimHockeyName(socket.id, account ?? null);
    socket.join(ROOM);
    if (typeof ack === 'function') ack({ ok: true, id: socket.id, team: p.team, role: p.role, paid: !!account });
    io.to(ROOM).emit('hk_state', game.snapshot());
    ensureTicker(io);
  });
  socket.on('hk_peek', (_p: unknown, ack?: (res: unknown) => void) => { if (typeof ack === 'function') ack(game.snapshot()); });
  socket.on('hk_input', (p: unknown) => game.setInput(socket.id, p));
  socket.on('hk_goalie', (_p: unknown, ack?: (res: unknown) => void) => { const ok = game.takeGoalie(socket.id); if (typeof ack === 'function') ack({ ok }); });
  socket.on('hk_leave', () => leave(io, socket));
  socket.on('disconnect', () => leave(io, socket));
}
