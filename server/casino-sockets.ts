/** Socket wiring for the shared blackjack tables and roulette wheel. Identity is the player's saved name. */
import { boardFor, isQaName } from '../shared/qa.js';
import type { Server, Socket } from 'socket.io';
import type { CasinoStanding } from '../shared/casino.js';
import { BlackjackCasino, type BJAction, type BlackjackTable } from './blackjack.js';
import { getBank } from './casino-store.js';
import { signedIn } from './auth-sockets.js';
import { VideoPoker } from './video-poker.js';
import { buyVideoBonus, spinVideoSlot } from './slots.js';
import { HoldemRoom, type HoldemTable } from './holdem.js';
import { HE_SPECTATE_DELAY_MS, type HEAction } from '../shared/holdem.js';
import { HoldemSpectators, type Viewer } from './holdem-spectate.js';

const envDelay = Number(process.env.HOLDEM_SPECTATOR_DELAY_MS);
let spectators = new HoldemSpectators(Number.isFinite(envDelay) && envDelay >= 0 ? envDelay : HE_SPECTATE_DELAY_MS);
const sockets = new Map<string, Socket>();
/** Last X-Forwarded-For hop (added by our proxy, so the client can't spoof it), else the socket address. */
function proxiedIp(s: Socket): string {
  const fwd = s.handshake.headers['x-forwarded-for'];
  const hops = (Array.isArray(fwd) ? fwd.join(',') : fwd ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return hops[hops.length - 1] || s.handshake.address || 'unknown';
}
function viewer(s: Socket): Viewer {
  const d = (s.handshake.auth as { device?: unknown } | undefined)?.device;
  return { id: s.id, name: nameOf(s), ip: proxiedIp(s), device: typeof d === 'string' && d.length >= 8 && d.length <= 64 ? d : null };
}
function pushSpectators(now = Date.now()): void {
  for (const d of spectators.due(room().tables, now)) {
    const s = sockets.get(d.id);
    if (!s) { spectators.unwatch(d.id); continue; }
    if (d.kicked) s.emit('he_spectate_end', { reason: d.kicked });
    else s.emit('he_spectate', d.view ?? null);
  }
}
function tableList() {
  return room().tables.map((t) => ({ id: t.id, seated: t.seated, phase: t.phase, watchers: spectators.count(t.id) }));
}

let holdem: HoldemRoom | null = null;
const room = () => (holdem ??= new HoldemRoom(getBank()));
const heWatchers = new Set<Socket>();
function pushHoldem(t: HoldemTable | null, now = Date.now()): void {
  for (const s of heWatchers) {
    const n = nameOf(s);
    const mine = n ? room().tableOf(n) : null;
    const target = mine ?? room().tables[0] ?? null;
    if (spectators.tableOf(s.id)) continue; // spectators get the delayed feed only
    if (!t || target === t) s.emit('he_state', target ? { ...target.view(n, now), watchers: spectators.count(target.id) } : null);
  }
  for (const x of t ? [t] : room().tables) spectators.record(x, now);
}

let vp: VideoPoker | null = null;
const poker = () => (vp ??= new VideoPoker(getBank()));
import { RouletteWheel } from './roulette.js';

type Ack = (res: { ok: boolean; error?: string; [k: string]: unknown }) => void;

let casino: BlackjackCasino | null = null;
let wheel: RouletteWheel | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const bjWatchers = new Set<Socket>();
const rouletteWatchers = new Set<Socket>();

function standings(viewerIsQa = false): CasinoStanding[] {
  return boardFor(getBank().standings(1e6), viewerIsQa, 25).map(({ name, chips, netWon, hands, spins, biggestWin }) => ({ name, chips, netWon, hands, spins, biggestWin, ...(isQaName(name) ? { qa: true } : {}) }));
}

/** Last few hundred acks by (account|rid), so a retried request is answered from cache. */
const recentAcks = new Map<string, { ok: boolean; [k: string]: unknown }>();
export function rememberAck(key: string, ack: { ok: boolean; [k: string]: unknown }): void {
  recentAcks.set(key, ack);
  if (recentAcks.size > 500) recentAcks.delete(recentAcks.keys().next().value as string);
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
  const pub = standings(), qa = standings(true);
  for (const id of io.sockets.adapter.rooms.get('casino-board') ?? []) {
    const s = io.sockets.sockets.get(id);
    if (s) s.emit('casino_board', isQaName(nameOf(s)) ? qa : pub);
  }
}

export function startCasino(io: Server): void {
  const now = Date.now();
  vp = new VideoPoker(getBank());
  holdem = new HoldemRoom(getBank());
  spectators = new HoldemSpectators(spectators.delayMs);
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
    const heChanged = holdem!.tick(t);
    for (const tb of heChanged) pushHoldem(tb, t);
    pushSpectators(t);
    if (heChanged.some((x) => x.phase === 'showdown')) pushBoard(io);
  }, 250);
  timer.unref?.();
}

export function stopCasino(): void {
  if (timer) clearInterval(timer);
  timer = null;
  bjWatchers.clear();
  heWatchers.clear();
  rouletteWatchers.clear();
}

export function registerCasino(io: Server, socket: Socket): void {
  const wrap = (fn: (body: Record<string, unknown>, now: number) => Record<string, unknown> | void) => (payload: unknown, ack?: Ack) => {
    try {
      const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      // Client retries (same rid) after a lost ack get the original answer instead of acting twice.
      const rid = typeof body.rid === 'string' && body.rid.length <= 40 ? `${nameOf(socket) ?? socket.id}|${body.rid}` : null;
      const seen = rid ? recentAcks.get(rid) : undefined;
      if (seen) return void ack?.(seen);
      let out: { ok: boolean; [k: string]: unknown };
      try { out = { ok: true, ...(fn(body, Date.now()) ?? {}) }; } catch (err) { out = { ok: false, error: (err as Error).message }; }
      if (rid) rememberAck(rid, out);
      ack?.(out);
    } catch (err) {
      ack?.({ ok: false, error: (err as Error).message });
    }
  };
  const setName = (_body: Record<string, unknown>) => {
    const name = signedIn(socket);
    return name;
  };

  socket.on('vp_state', wrap(() => ({ state: poker().view(signedIn(socket)) })));
  socket.on('vp_deal', wrap((body) => {
    const state = poker().deal(signedIn(socket), Number(body.bet));
    return { state };
  }));
  socket.on('vp_draw', wrap((body) => {
    const state = poker().draw(signedIn(socket), body.hold);
    pushBoard(io);
    return { state };
  }));
  sockets.set(socket.id, socket);
  socket.on('he_tables', wrap(() => ({ tables: tableList(), delayMs: spectators.delayMs })));
  socket.on('he_spectate', wrap((body, now) => {
    const t = room().tables.find((x) => x.id === String(body.table)) ?? null;
    if (!t) throw new Error('No such table.');
    const v = viewer(socket);
    spectators.noteIdentity(v);
    const state = spectators.watch(t, v, now);
    heWatchers.add(socket);
    return { state, delayMs: spectators.delayMs, table: t.id };
  }));
  socket.on('he_unspectate', wrap(() => { spectators.unwatch(socket.id); }));
  socket.on('he_watch', wrap((_b, now) => {
    spectators.noteIdentity(viewer(socket));
    heWatchers.add(socket);
    const n = nameOf(socket);
    const t = (n ? room().tableOf(n) : null) ?? room().tables[0] ?? null;
    return { state: t ? t.view(n, now) : null };
  }));
  socket.on('he_unwatch', wrap(() => { heWatchers.delete(socket); }));
  socket.on('he_sit', wrap((body, now) => {
    const name = signedIn(socket);
    spectators.noteIdentity(viewer(socket));
    spectators.unwatch(socket.id);
    heWatchers.add(socket);
    const t = room().sit(name, Number(body.buyIn), now);
    pushHoldem(null, now);
    return { state: t.view(name, now) };
  }));
  socket.on('he_leave', wrap((_b, now) => {
    const name = signedIn(socket);
    const t = room().leave(name, now);
    pushHoldem(null, now);
    pushBoard(io);
    return { state: (t && t.seated > 0 ? t : room().tables[0])?.view(name, now) ?? null };
  }));
  socket.on('he_action', wrap((body, now) => {
    const name = signedIn(socket);
    const t = room().tableOf(name);
    if (!t) throw new Error('Take a seat first.');
    const action = String(body.action) as HEAction;
    if (!['fold', 'check', 'call', 'raise', 'allin'].includes(action)) throw new Error('Unknown action.');
    t.act(name, action, Number(body.amount), now);
    pushHoldem(null, now);
    if (t.phase === 'showdown') pushBoard(io);
  }));
  socket.on('vslots_spin', wrap((body) => {
    const result = spinVideoSlot(getBank(), signedIn(socket), body.machine, Number(body.bet));
    if (result.net > 0) pushBoard(io);
    return { result };
  }));
  socket.on('vslots_buy', wrap((body) => {
    const result = buyVideoBonus(getBank(), signedIn(socket), body.machine, Number(body.bet));
    if (result.net > 0) pushBoard(io);
    return { result };
  }));
  socket.on('casino_board', wrap(() => {
    void socket.join('casino-board');
    return { rows: standings(isQaName(nameOf(socket))) };
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
    sockets.delete(socket.id);
    spectators.unwatch(socket.id);
    rouletteWatchers.delete(socket);
    if (heWatchers.delete(socket)) {
      const n = nameOf(socket);
      if (n && ![...heWatchers].some((x) => nameOf(x) === n) && room().tableOf(n)) {
        room().leave(n, Date.now());
        pushHoldem(null);
      }
    }
    if (!bjWatchers.delete(socket)) return;
    const name = nameOf(socket);
    if (!name) return;
    // Keep the seat if the same name has another live socket (other tab).
    for (const s of bjWatchers) if (nameOf(s) === name) return;
    const t = casino!.leave(name, Date.now());
    if (t) pushTable(t);
  });
}
