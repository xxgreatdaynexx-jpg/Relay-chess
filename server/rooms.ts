import { randomBytes } from 'node:crypto';
import { RelayGame, type Timing } from './engine.js';
import { GameError } from './errors.js';
import {
  clockPreset,
  describeResult,
  isSeat,
  type ClockPreset,
  type MoveInput,
  type PublicState,
  type Seat,
  type SeatView,
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
  readonly createdAt = Date.now();
  lastActivity = Date.now();
  lastClockPush = 0;
  readonly game: RelayGame;

  private members = new Map<string, Member>();
  private sockets = new Map<string, string>();

  constructor(code: string, preset: ClockPreset) {
    this.code = code;
    this.presetId = preset.id;
    const timing: Timing | null =
      preset.initialMs > 0 ? { initialMs: preset.initialMs, incrementMs: preset.incrementMs } : null;
    this.game = new RelayGame(timing);
  }

  addMember(name: string): string {
    if (this.members.size >= MAX_MEMBERS) throw new GameError('This table is full.');
    if (name.length < 1 || name.length > 18) throw new GameError('Enter a name (1–18 characters).');
    const token = randomBytes(24).toString('hex');
    this.members.set(token, { token, name, seat: null, sockets: new Set() });
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
    if (this.game.status !== 'lobby') throw new GameError('Seats lock when the game starts.');
    const member = this.must(token);
    const occupant = this.memberOn(seat);
    if (occupant && occupant.token !== member.token) throw new GameError('That seat is taken.');
    member.seat = seat;
    this.touch();
    if (this.countSeated() === 4) {
      this.game.start(now);
      this.syncPresence(now);
    }
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
    this.game.move(member.seat, input, now);
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
    const you = this.memberBySocket(socketId);
    const raw = this.game.result;
    const described = raw ? describeResult(raw, (seat) => this.nameFor(seat)) : null;
    return {
      code: this.code,
      status: this.game.status,
      clockPreset: this.presetId,
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

  private countSeated(): number {
    let count = 0;
    for (const member of this.members.values()) if (member.seat) count += 1;
    return count;
  }

  private must(token: string): Member {
    const member = this.members.get(token);
    if (!member) throw new GameError('You are not at this table.', true);
    return member;
  }

  private touch(): void {
    this.lastActivity = Date.now();
  }
}

export function createRoom(preset: ClockPreset): Room {
  let code = makeCode();
  while (rooms.has(code)) code = makeCode();
  const room = new Room(code, preset);
  rooms.set(code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

export function listRooms(): Room[] {
  return [...rooms.values()];
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
