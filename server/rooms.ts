import { randomBytes } from 'node:crypto';
import { RelayGame, type Timing } from './engine.js';
import { GameError } from './errors.js';
import { beginBlunderCheck } from './blunders.js';
import { peekHint, requestHint } from './hints.js';
import { getLeaderboard, normalizeName } from './leaderboard.js';
import { moveUci, openingName } from './openings.js';
import { hasMateInOne } from '../shared/mate.js';
import { recordStreak } from '../shared/streak.js';
import {
  clockPreset,
  describeResult,
  isSeat,
  seatsFor,
  seatSide,
  tableSetup,
  type ClockPreset,
  type GameResult,
  type HintArrow,
  type LegalMove,
  type MoveInput,
  type MoveRecord,
  type MoveMark,
  type OpeningCall,
  type PublicState,
  type MateInOneCall,
  type StreakCall,
  type Seat,
  type SeatView,
  type Side,
  type TableSetup,
} from '../shared/types.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_MEMBERS = 8;
export const EMPTY_ROOM_MS = 30 * 60 * 1000;
export const HARD_ROOM_MS = 12 * 60 * 60 * 1000;

interface Member {
  token: string;
  name: string;
  seat: Seat | null;
  sockets: Set<string>;
}

const rooms = new Map<string, Room>();

export function makeCode(): string {
  const bytes = randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i += 1) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

export class Room {
  readonly code: string;
  readonly presetId: string;
  readonly setup: TableSetup;
  readonly createdAt = Date.now();
  lastActivity = Date.now();
  lastClockPush = 0;
  readonly game: RelayGame;

  private members = new Map<string, Member>();
  private sockets = new Map<string, string>();
  private scoredResult: GameResult | null = null;
  private openingFlash: OpeningCall | null = null;
  private openingNameSeen: string | null = null;
  private moveMark: MoveMark | null = null;
  private streak: StreakCall | null = null;
  private mateInOne: MateInOneCall | null = null;
  private readonly streaks = new Map<Seat, number>();
  private blunderSeq = 0;

  constructor(code: string, preset: ClockPreset, setup: TableSetup = { mode: '2v2', pairSide: null }) {
    this.code = code;
    this.presetId = preset.id;
    this.setup = setup;
    const timing: Timing | null =
      preset.initialMs > 0 ? { initialMs: preset.initialMs, incrementMs: preset.incrementMs } : null;
    this.game = new RelayGame(timing, setup);
  }

  addMember(name: string): string {
    if (this.members.size >= MAX_MEMBERS) throw new GameError('This table is full.');
    if (name.length < 1 || name.length > 18) throw new GameError('Enter a name (1–18 characters).');
    const token = randomBytes(24).toString('hex');
    this.members.set(token, { token, name, seat: null, sockets: new Set() });
    getLeaderboard().rememberName(name);
    this.touch();
    return token;
  }

  has(token: string): boolean {
    return this.members.has(token);
  }

  connect(token: string, socketId: string, now = Date.now()): void {
    const member = this.must(token);
    member.sockets.add(socketId);
    this.sockets.set(socketId, token);
    this.syncPresence(now);
    this.touch();
  }

  disconnect(socketId: string, now = Date.now()): void {
    const token = this.sockets.get(socketId);
    if (!token) return;
    this.sockets.delete(socketId);
    const member = this.members.get(token);
    if (!member) return;
    member.sockets.delete(socketId);
    this.syncPresence(now);
    this.touch();
  }

  leave(token: string): void {
    if (this.game.status !== 'lobby') {
      throw new GameError('Resign if you want to end a game that has started.');
    }
    const member = this.must(token);
    for (const socketId of member.sockets) this.sockets.delete(socketId);
    this.members.delete(token);
    this.touch();
  }

  sit(token: string, seat: unknown, now = Date.now()): void {
    if (!isSeat(seat)) throw new GameError('That is not a seat.');
    if (!seatsFor(this.setup).includes(seat)) throw new GameError('That seat is not in this game.');
    if (this.game.status !== 'lobby') throw new GameError('Seats lock when the game starts.');
    const member = this.must(token);
    const occupant = this.memberOn(seat);
    if (occupant && occupant.token !== member.token) throw new GameError('That seat is taken.');
    member.seat = seat;
    this.touch();
    if (this.seatsFilled()) {
      this.game.start(now);
      this.syncPresence(now);
    }
  }

  /** Seats in this game nobody has taken yet. Empty once the game starts. */
  openSeats(): Seat[] {
    if (this.game.status !== 'lobby') return [];
    if (this.members.size >= MAX_MEMBERS) return [];
    return seatsFor(this.setup).filter((seat) => !this.memberOn(seat));
  }

  stand(token: string): void {
    if (this.game.status !== 'lobby') throw new GameError('You can only stand up before the game starts.');
    const member = this.must(token);
    member.seat = null;
    this.touch();
  }

  move(token: string, input: MoveInput, now = Date.now()): void {
    const member = this.must(token);
    if (!member.seat) throw new GameError('Take a seat before moving.');
    const beforeFen = this.game.fen();
    const legal = this.game.legalMoves();
    this.game.move(member.seat, input, now);
    const played = this.game.history().at(-1);
    this.noteOpening(now);
    if (played) this.noteBlunder(beforeFen, legal, played);
    this.noteMateInOne();
    this.syncPresence(now);
    this.touch();
  }

  resign(token: string): void {
    const member = this.must(token);
    if (!member.seat) throw new GameError('Take a seat before resigning.');
    this.game.resign(member.seat);
    this.touch();
  }

  offerDraw(token: string, now = Date.now()): void {
    const member = this.must(token);
    if (!member.seat) throw new GameError('Take a seat before offering a draw.');
    this.game.offerDraw(member.seat, now);
    this.touch();
  }

  answerDraw(token: string, accept: boolean, now = Date.now()): void {
    const member = this.must(token);
    if (!member.seat) throw new GameError('Take a seat before answering a draw.');
    this.game.answerDraw(member.seat, accept, now);
    this.touch();
  }

  voteRematch(token: string, now = Date.now()): void {
    const member = this.must(token);
    if (!member.seat) throw new GameError("Spectators don't vote on a rematch.");
    this.game.voteRematch(member.seat, now);
    this.syncPresence(now);
    this.touch();
  }

  payBailout(token: string, now = Date.now()): boolean {
    const member = this.must(token);
    if (!member.seat) throw new GameError('Take a seat before paying Dayne.');
    const paid = this.game.payBailout(member.seat, member.name, now);
    this.noteMateInOne();
    this.syncPresence(now);
    this.touch();
    return paid.declined;
  }

  acceptMate(token: string): void {
    const member = this.must(token);
    if (!member.seat) throw new GameError('Take a seat before answering checkmate.');
    this.game.acceptMate(member.seat);
    this.touch();
  }

  anyoneConnected(): boolean {
    for (const member of this.members.values()) {
      if (member.sockets.size > 0) return true;
    }
    return false;
  }

  syncPresence(now: number): void {
    const seat = this.game.seatToMove();
    if (!seat) return;
    const member = this.memberOn(seat);
    this.game.setMoverConnected(Boolean(member && member.sockets.size > 0), now);
  }

  view(socketId: string, now: number): PublicState {
    this.game.tick(now);
    this.game.expireBailout(now);
    this.clearAnnouncementsIfReset();
    this.scoreIfNeeded();
    const you = this.memberBySocket(socketId);
    const raw = this.game.result;
    const described = raw ? describeResult(raw, (seat) => this.nameFor(seat)) : null;
    return {
      code: this.code,
      status: this.game.status,
      clockPreset: this.presetId,
      mode: this.setup.mode,
      pairSide: this.setup.pairSide,
      seats: this.seatMap(),
      fen: this.game.fen(),
      ply: this.game.ply(),
      seatToMove: this.game.seatToMove(),
      inCheck: this.game.inCheck(),
      legalMoves: this.game.legalMoves(),
      moves: this.game.history(),
      result: raw && described ? { ...raw, ...described } : null,
      drawOffer: this.game.drawOffer ? { ...this.game.drawOffer } : null,
      rematchVotes: [...this.game.rematchVotes],
      clock: this.game.clockView(now),
      yourSeat: you?.seat ?? null,
      hints: this.hintsFor(you?.seat ?? null),
      serverNow: now,
      opening: this.openingFlash,
      mark: this.moveMark,
      bailout: this.game.bailout ? { ...this.game.bailout } : null,
      escape: this.game.escape ? { ...this.game.escape } : null,
      streak: this.streak ? { ...this.streak } : null,
      mateInOne:
        this.game.status === 'playing' && !this.game.result && this.mateInOne?.ply === this.game.ply()
          ? { ply: this.mateInOne.ply }
          : null,
    };
  }

  private seatMap(): Record<Seat, SeatView | null> {
    const seats: Record<Seat, SeatView | null> = {
      white1: null,
      white2: null,
      black1: null,
      black2: null,
    };
    for (const member of this.members.values()) {
      if (!member.seat) continue;
      seats[member.seat] = { name: member.name, connected: member.sockets.size > 0 };
    }
    return seats;
  }

  private memberOn(seat: Seat): Member | undefined {
    for (const member of this.members.values()) {
      if (member.seat === seat) return member;
    }
    return undefined;
  }

  private memberBySocket(socketId: string): Member | undefined {
    const token = this.sockets.get(socketId);
    return token ? this.members.get(token) : undefined;
  }

  private nameFor(seat: Seat): string | undefined {
    return this.memberOn(seat)?.name;
  }

  private seatsFilled(): boolean {
    return seatsFor(this.setup).every((seat) => this.memberOn(seat));
  }

  private must(token: string): Member {
    const member = this.members.get(token);
    if (!member) throw new GameError('You are not at this table.', true);
    return member;
  }

  private touch(): void {
    this.lastActivity = Date.now();
  }

  private noteOpening(now: number): void {
    const name = openingName(this.game.history().map((move) => moveUci(move)));
    if (!name || name === this.openingNameSeen) return;
    this.openingNameSeen = name;
    this.openingFlash = { name, ply: this.game.ply(), at: now };
  }

  private noteBlunder(fen: string, legal: LegalMove[], played: MoveRecord): void {
    const token = ++this.blunderSeq;
    const ply = this.game.ply();
    beginBlunderCheck({
      code: this.code,
      fen,
      ucis: legal.map((move) => moveUci(move)),
      playedUci: moveUci(played),
      ply,
      destination: played.to,
      accept: (mark, ranked) => {
        if (token !== this.blunderSeq || this.game.ply() !== ply) return false;
        this.moveMark = mark;
        const hit = ranked ? recordStreak(this.streaks, played.seat, mark?.grade ?? null, legal.length) : null;
        if (hit) {
          this.streak = {
            name: this.nameFor(played.seat) ?? played.seat,
            seat: played.seat,
            ply,
            at: Date.now(),
            kind: hit,
          };
        }
        return mark !== null;
      },
    });
  }

  private noteMateInOne(): void {
    if (this.game.status !== 'playing' || this.game.result) {
      this.mateInOne = null;
      return;
    }
    const ply = this.game.ply();
    this.mateInOne = hasMateInOne(this.game.fen()) ? { ply } : null;
  }

  private clearAnnouncementsIfReset(): void {
    if (this.game.ply() !== 0) return;
    if (this.openingFlash || this.moveMark || this.openingNameSeen || this.streak || this.streaks.size > 0) {
      this.blunderSeq += 1;
    }
    this.openingFlash = null;
    this.openingNameSeen = null;
    this.moveMark = null;
    this.streak = null;
    this.streaks.clear();
    this.mateInOne = null;
  }

  private hintsFor(seat: Seat | null): HintArrow[] {
    if (!seat || this.game.status !== 'playing' || this.game.bailout) return [];
    const mover = this.game.seatToMove();
    if (!mover) return [];
    const side = seatSide(mover);
    if (seatSide(seat) !== side || !this.sideHasEngine(side)) return [];
    const fen = this.game.fen();
    const hint = peekHint(fen);
    if (hint === undefined) {
      requestHint(fen);
      return [];
    }
    return hint ? [hint] : [];
  }

  private sideHasEngine(side: Side): boolean {
    for (const seat of (['white1', 'white2', 'black1', 'black2'] as const)) {
      if (seatSide(seat) !== side) continue;
      const name = this.nameFor(seat);
      if (name && normalizeName(name) === 'chessgawd') return true;
    }
    return false;
  }

  private scoreIfNeeded(): void {
    const result = this.game.result;
    if (this.game.status !== 'ended' || !result || this.scoredResult === result) return;
    this.scoredResult = result;
    const name = (seat: Seat) => this.nameFor(seat);
    const named = (side: Side) =>
      seatsFor(this.setup)
        .filter((seat) => seatSide(seat) === side)
        .map((seat) => name(seat))
        .filter((value): value is string => Boolean(value));
    getLeaderboard().record({
      winner: result.winner,
      white: named('white'),
      black: named('black'),
    });
  }
}

export function createRoom(preset: ClockPreset, setup?: TableSetup): Room {
  let code = makeCode();
  while (rooms.has(code)) code = makeCode();
  const room = new Room(code, preset, setup);
  rooms.set(code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

export function listRooms(): Room[] {
  return [...rooms.values()];
}

/** Tables waiting for players with a free seat, closest to full first, then oldest. */
export function openRooms(): Room[] {
  return listRooms()
    .filter((room) => room.anyoneConnected() && room.openSeats().length > 0)
    .sort((a, b) => a.openSeats().length - b.openSeats().length || a.createdAt - b.createdAt);
}

export function resetRooms(): void {
  rooms.clear();
}

export function pruneRooms(now = Date.now()): string[] {
  const gone: string[] = [];
  for (const room of rooms.values()) {
    const idle = now - room.lastActivity;
    const expired = (!room.anyoneConnected() && idle > EMPTY_ROOM_MS) || idle > HARD_ROOM_MS;
    if (!expired) continue;
    rooms.delete(room.code);
    gone.push(room.code);
  }
  return gone;
}

export function presetOrThrow(id: unknown): ClockPreset {
  const preset = clockPreset(id);
  if (!preset) throw new GameError('Choose a clock.');
  return preset;
}

export function setupOrThrow(mode: unknown, pairSide: unknown): TableSetup {
  const setup = tableSetup(mode, pairSide);
  if (!setup) throw new GameError('Choose a game mode.');
  return setup;
}
