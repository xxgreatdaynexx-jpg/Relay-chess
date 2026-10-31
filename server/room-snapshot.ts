/**
 * Serialize / restore chess and checkers tables so they survive a server restart or deploy.
 * Generic over the Room and game fields (so new plain fields persist automatically); live-only
 * state (sockets, spectators, timers, RNG) is dropped and rebuilt on restore.
 */
import { Chess } from 'chess.js';
import { Room } from './rooms.js';
import type { GameType, Seat, TableSetup } from '../shared/types.js';

export const SNAPSHOT_VERSION = 1;

/** Room fields that only make sense while the process is alive. */
const ROOM_SKIP = new Set(['game', 'sockets', 'spectators', 'random', 'members', 'lastClockPush']);

export interface RoomSnapshot {
  v: number;
  savedAt: number;
  code: string;
  presetId: string;
  setup: TableSetup;
  gameType: GameType;
  room: Record<string, unknown>;
  members: { token: string; name: string; seat: Seat | null; bot?: boolean }[];
  game: Record<string, unknown>;
}

type Json = unknown;

function enc(value: unknown): Json {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'function') return undefined;
  if (value instanceof Chess) return { $chess: { pgn: value.pgn(), fen: value.fen() } };
  if (value instanceof Map) return { $map: [...value.entries()].map(([k, v]) => [k, enc(v)]) };
  if (value instanceof Set) return { $set: [...value].map(enc) };
  if (Array.isArray(value)) return value.map(enc);
  if (typeof value === 'object') {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value)) {
      const e = enc(v);
      if (e !== undefined) out[k] = e;
    }
    return out;
  }
  return value;
}

function restoreChess(pgn: string, fen: string): Chess {
  try {
    const c = new Chess();
    c.loadPgn(pgn);
    if (c.fen() === fen) return c; // keeps repetition history
  } catch {
    /* fall through */
  }
  return new Chess(fen, { skipValidation: true });
}

function dec(value: Json): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(dec);
  const o = value as Record<string, any>;
  if (o.$chess) return restoreChess(String(o.$chess.pgn ?? ''), String(o.$chess.fen));
  if (o.$map) return new Map((o.$map as [unknown, Json][]).map(([k, v]) => [k, dec(v)]));
  if (o.$set) return new Set((o.$set as Json[]).map(dec));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = dec(v);
  return out;
}

/** Tournament match rooms are not persisted (brackets live in memory). */
export function persistable(room: Room): boolean {
  return !room.tournament && (room.gameType === 'chess' || room.gameType === 'checkers');
}

export function snapshotRoom(room: Room, now = Date.now()): RoomSnapshot {
  const r = room as unknown as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (ROOM_SKIP.has(k) || typeof v === 'function') continue;
    const e = enc(v);
    if (e !== undefined) fields[k] = e;
  }
  const members = [...(r.members as Map<string, { token: string; name: string; seat: Seat | null; bot?: boolean }>).values()].map(
    (m) => ({ token: m.token, name: m.name, seat: m.seat, ...(m.bot ? { bot: true } : {}) }),
  );
  const game: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(room.game as unknown as Record<string, unknown>)) {
    const e = enc(v);
    if (e !== undefined) game[k] = e;
  }
  return { v: SNAPSHOT_VERSION, savedAt: now, code: room.code, presetId: room.presetId, setup: room.setup, gameType: room.gameType, room: fields, members, game };
}

/**
 * Rebuild a Room. Downtime does not count: the running clock, turn timer and bailout deadline
 * are shifted forward by (now - savedAt), and the clock then pauses until the mover reconnects.
 */
export function restoreRoom(snap: RoomSnapshot, now = Date.now()): Room {
  if (snap.v !== SNAPSHOT_VERSION) throw new Error(`unknown snapshot version ${snap.v}`);
  const room = new Room(snap.code, { id: snap.presetId, initialMs: 0, incrementMs: 0 } as never, snap.setup, snap.gameType);
  const r = room as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(snap.room)) r[k] = dec(v);
  const members = r.members as Map<string, unknown>;
  members.clear();
  for (const m of snap.members) members.set(m.token, { ...m, sockets: new Set<string>() });
  const g = room.game as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(snap.game)) g[k] = dec(v);

  const downtime = Math.max(0, now - snap.savedAt);
  const clock = g.clock as { running: boolean; asOf: number } | null;
  if (clock) clock.asOf = clock.running ? clock.asOf + downtime : now;
  if (typeof g.turnStartedAt === 'number') g.turnStartedAt = (g.turnStartedAt as number) + downtime;
  const bailout = g.bailout as { deadline: number } | null;
  if (bailout) bailout.deadline += downtime;
  r.lastActivity = Math.min(now, (r.lastActivity as number) + downtime);
  // scoreIfNeeded compares by identity; a finished, already-scored game must not score again.
  if (r.scoredResult) r.scoredResult = room.game.result;
  try { room.reconcileWagers(); } catch (error) { console.error(`[wager] reconcile ${room.code}:`, (error as Error).message); }
  room.syncPresence(now); // nobody is connected yet: a human mover's clock pauses
  return room;
}
