import { randomBytes } from 'node:crypto';
import { GameError } from './errors.js';
import type { Side, TournamentMatchView, TournamentView } from '../shared/types.js';

/** No-show forfeit: a match that has not started this long after it was ready is forfeited. */
export const NO_SHOW_MS = 2 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** What a tournament needs to know about a match room. Rooms are real tables; tests fake this. */
export interface MatchRooms {
  create(clockId: string, white: string, black: string): string;
  status(code: string): MatchRoomStatus | null;
}
export interface MatchRoomStatus {
  started: boolean;
  ended: boolean;
  winner: Side | null;
  /** Seated (and connected) before the game started. */
  present: { white: boolean; black: boolean };
  /** Thinking time used, ms (feature 1); tie-break for draws. */
  usedMs: { white: number; black: number };
}

interface Match {
  id: string;
  round: number;
  slot: number;
  white: string | null;
  black: string | null;
  room: string | null;
  readyAt: number | null;
  winner: string | null;
  how: TournamentMatchView['how'];
}

export class Tournament {
  readonly code: string;
  readonly host: string;
  readonly hostKey = randomBytes(16).toString('hex');
  readonly clockId: string;
  readonly size: 4 | 8;
  readonly createdAt: number;
  status: 'signup' | 'running' | 'done' = 'signup';
  entrants: string[] = [];
  rounds: Match[][] = [];
  champion: string | null = null;
  lastActivity: number;

  constructor(code: string, host: string, clockId: string, size: number, now = Date.now()) {
    if (size !== 4 && size !== 8) throw new GameError('Pick 4 or 8 players.');
    this.code = code;
    this.host = host;
    this.clockId = clockId;
    this.size = size;
    this.createdAt = now;
    this.lastActivity = now;
    this.entrants.push(host);
  }

  join(name: string): void {
    if (this.entrants.some((e) => same(e, name))) return;
    if (this.status !== 'signup') throw new GameError('This tournament has already started.');
    if (this.entrants.length >= this.size) throw new GameError('This tournament is full.');
    this.entrants.push(name);
  }

  leave(name: string): void {
    if (this.status !== 'signup' || same(name, this.host)) return;
    this.entrants = this.entrants.filter((e) => !same(e, name));
  }

  /** Shuffle into a single-elimination bracket. Byes go to distinct first-round matches. */
  start(rooms: MatchRooms, now = Date.now(), random: () => number = Math.random): void {
    if (this.status !== 'signup') throw new GameError('Already started.');
    if (this.entrants.length < 2) throw new GameError('Need at least 2 players.');
    const players = [...this.entrants];
    for (let i = players.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [players[i], players[j]] = [players[j]!, players[i]!];
    }
    const slots: (string | null)[] = new Array(this.size).fill(null);
    // Fill one player per match first (even slots), then the opponents; leftover odd slots are byes.
    const order = [...Array(this.size / 2).keys()].map((i) => i * 2).concat([...Array(this.size / 2).keys()].map((i) => i * 2 + 1));
    players.forEach((p, i) => (slots[order[i]!] = p));
    const roundsCount = Math.log2(this.size);
    this.rounds = [];
    for (let r = 0; r < roundsCount; r += 1) {
      const count = this.size / 2 ** (r + 1);
      this.rounds.push(
        [...Array(count).keys()].map((slot) => ({
          id: `${r}-${slot}`, round: r, slot, white: null, black: null, room: null, readyAt: null, winner: null, how: null,
        })),
      );
    }
    this.rounds[0]!.forEach((m, i) => {
      m.white = slots[i * 2] ?? null;
      m.black = slots[i * 2 + 1] ?? null;
    });
    this.status = 'running';
    for (const m of this.rounds[0]!) {
      if (m.white && !m.black) this.decide(m, m.white, 'bye', rooms, now);
      else if (m.black && !m.white) this.decide(m, m.black, 'bye', rooms, now);
      else if (!m.white && !m.black) this.decide(m, null, 'bye', rooms, now);
    }
    this.openReady(rooms, now);
  }

  /** Poll match rooms: results, draws, no-shows. Returns true when anything changed. */
  sync(rooms: MatchRooms, now = Date.now()): boolean {
    if (this.status !== 'running') return false;
    let changed = false;
    for (const m of this.liveMatches()) {
      const st = rooms.status(m.room!);
      if (!st) {
        // Room vanished (expired): treat as no-show.
        this.decide(m, m.white!, 'forfeit', rooms, now);
        changed = true;
        continue;
      }
      if (st.ended) {
        if (st.winner) {
          this.decide(m, st.winner === 'white' ? m.white! : m.black!, 'win', rooms, now);
        } else {
          // Draw tie-break: whoever used less thinking time advances; exact tie → white.
          const winner = st.usedMs.black < st.usedMs.white ? m.black! : m.white!;
          this.decide(m, winner, 'draw-time', rooms, now);
        }
        changed = true;
      } else if (!st.started && m.readyAt !== null && now - m.readyAt >= NO_SHOW_MS) {
        const winner = st.present.black && !st.present.white ? m.black! : m.white!;
        this.decide(m, winner, 'forfeit', rooms, now);
        changed = true;
      }
    }
    return changed;
  }

  /** Host forfeits `loser` in their current match. */
  forfeit(hostKey: string, loser: string, rooms: MatchRooms, now = Date.now()): void {
    if (hostKey !== this.hostKey) throw new GameError('Only the host can do that.');
    const m = this.liveMatches().find((x) => same(x.white, loser) || same(x.black, loser));
    if (!m) throw new GameError('That player has no live match.');
    this.decide(m, same(m.white, loser) ? m.black! : m.white!, 'forfeit', rooms, now);
  }

  matchFor(name: string): Match | undefined {
    return this.liveMatches().find((m) => same(m.white, name) || same(m.black, name));
  }

  liveMatches(): Match[] {
    return this.rounds.flat().filter((m) => m.room && !m.how);
  }

  view(you?: string): TournamentView {
    const mine = you ? this.matchFor(you) : undefined;
    return {
      code: this.code,
      host: this.host,
      clockId: this.clockId,
      size: this.size,
      status: this.status,
      entrants: [...this.entrants],
      champion: this.champion,
      rounds: this.rounds.map((round) =>
        round.map((m) => ({
          id: m.id, round: m.round, white: m.white, black: m.black, room: m.room, winner: m.winner, how: m.how,
          live: Boolean(m.room && !m.how), readyAt: m.readyAt,
        })),
      ),
      yourMatch: mine?.room ? { room: mine.room, side: same(mine.white, you!) ? 'white' : 'black', readyAt: mine.readyAt } : null,
    };
  }

  private decide(m: Match, winner: string | null, how: TournamentMatchView['how'], rooms: MatchRooms, now: number): void {
    m.winner = winner;
    m.how = how;
    this.lastActivity = now;
    const next = this.rounds[m.round + 1];
    if (!next) {
      this.champion = winner;
      this.status = 'done';
      return;
    }
    const target = next[Math.floor(m.slot / 2)]!;
    if (m.slot % 2 === 0) target.white = winner;
    else target.black = winner;
    // A bye path with no player at all: if the sibling is also decided and empty, cascade.
    const sibling = this.rounds[m.round]![m.slot ^ 1]!;
    if (sibling.how && !target.how) {
      if (target.white && !target.black) this.decide(target, target.white, 'bye', rooms, now);
      else if (target.black && !target.white) this.decide(target, target.black, 'bye', rooms, now);
      else if (!target.white && !target.black) this.decide(target, null, 'bye', rooms, now);
    }
    this.openReady(rooms, now);
  }

  private openReady(rooms: MatchRooms, now: number): void {
    if (this.status !== 'running') return;
    for (const m of this.rounds.flat()) {
      if (!m.room && !m.how && m.white && m.black) {
        m.room = rooms.create(this.clockId, m.white, m.black);
        m.readyAt = now;
      }
    }
  }
}

function same(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

const tournaments = new Map<string, Tournament>();

export function createTournament(host: string, clockId: string, size: number, now = Date.now()): Tournament {
  let code = '';
  do {
    const bytes = randomBytes(5);
    code = 'T' + [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  } while (tournaments.has(code));
  const t = new Tournament(code, host, clockId, size, now);
  tournaments.set(code, t);
  return t;
}
export const getTournament = (code: string) => tournaments.get(code);
export const listTournaments = () => [...tournaments.values()];
export function resetTournaments(): void {
  tournaments.clear();
}
/** In-memory only: drop finished/abandoned tournaments after 6h idle. */
export function pruneTournaments(now = Date.now()): void {
  for (const [code, t] of tournaments) if (now - t.lastActivity > 6 * 60 * 60 * 1000) tournaments.delete(code);
}
