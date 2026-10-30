import { randomBytes } from 'node:crypto';
import { RelayGame, type Timing } from './engine.js';
import { GameError } from './errors.js';
import { beginBlunderCheck } from './blunders.js';
import { getChessStats } from './chess-stats.js';
import { peekHint, requestHint } from './hints.js';
import { getCheckersLeaderboard, getLeaderboard, normalizeName } from './leaderboard.js';
import { CheckersGame } from './checkers-game.js';
import { BOT_PIECES, botName, botProfile, chooseMove, thinkDelay, type BotProfile } from './bots.js';
import { moveUci, openingName } from './openings.js';
import { hasMateInOne } from '../shared/mate.js';
import { recordStreak } from '../shared/streak.js';
import { scrambleSeats, type Arrangement } from '../shared/scramble.js';
import {
  clockPreset,
  describeResult,
  modeLabel,
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
  type TableSummary,
  type TeamsBanner,
  type GameType,
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
  /** House bot: always present, never scored, no sockets. */
  bot?: boolean;
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
  readonly gameType: GameType;

  private members = new Map<string, Member>();
  private sockets = new Map<string, string>();
  private readonly spectators = new Set<string>();
  private scoredResult: GameResult | null = null;
  private openingFlash: OpeningCall | null = null;
  private openingNameSeen: string | null = null;
  private moveMark: MoveMark | null = null;
  private streak: StreakCall | null = null;
  private mateInOne: MateInOneCall | null = null;
  private readonly streaks = new Map<Seat, number>();
  private blunderSeq = 0;
  /** Scramble teams on rematch. On by default except 1v1. */
  scrambleRematch: boolean;
  private teams: TeamsBanner | null = null;
  /** Tournament match: seats reserved by name, no rematch, hidden from Quick Join. */
  tournament: { code: string; seats: Partial<Record<Seat, string>> } | null = null;
  /** Randomness source for scrambles; swappable in tests. */
  random: () => number = () => randomBytes(4).readUInt32BE(0) / 0x1_0000_0000;

  constructor(code: string, preset: ClockPreset, setup: TableSetup = { mode: '2v2', pairSide: null }, gameType: GameType = 'chess') {
    this.gameType = gameType;
    this.code = code;
    this.presetId = preset.id;
    this.setup = setup;
    this.scrambleRematch = setup.mode !== '1v1';
    const timing: Timing | null =
      preset.initialMs > 0 ? { initialMs: preset.initialMs, incrementMs: preset.incrementMs } : null;
    this.game = gameType === 'checkers' ? new CheckersGame(timing, setup) : new RelayGame(timing, setup);
  }

  /** Bot strength for this room (from BOT_ELO). */
  botProfile: BotProfile = botProfile();

  /** Fill an empty seat with a house bot. Any seated player or the creator can do it. */
  addBot(token: string, seat: unknown, now = Date.now()): string {
    const member = this.must(token);
    if (member.bot) throw new GameError('Bots cannot add bots.');
    if (this.tournament) throw new GameError('Tournament matches are people only.');
    if (!isSeat(seat)) throw new GameError('That is not a seat.');
    if (!seatsFor(this.setup).includes(seat)) throw new GameError('That seat is not in this game.');
    if (this.game.status !== 'lobby') throw new GameError('Seats lock when the game starts.');
    if (this.memberOn(seat)) throw new GameError('That seat is taken.');
    if (this.members.size >= MAX_MEMBERS) throw new GameError('This table is full.');
    const used = new Set([...this.members.values()].map((m) => m.name));
    const piece = BOT_PIECES.find((p) => !used.has(botName(this.botProfile.elo, p))) ?? 'Pawn';
    const name = botName(this.botProfile.elo, piece);
    const botToken = `bot-${randomBytes(12).toString('hex')}`;
    this.members.set(botToken, { token: botToken, name, seat, sockets: new Set(), bot: true });
    this.touch();
    if (this.seatsFilled()) {
      this.game.start(now);
      this.syncPresence(now);
    }
    return name;
  }

  /** Take a bot off its seat before the game starts. */
  removeBot(token: string, seat: unknown): void {
    this.must(token);
    if (this.game.status !== 'lobby') throw new GameError('Bots stay until the game ends.');
    const bot = isSeat(seat) ? this.memberOn(seat) : undefined;
    if (!bot?.bot) throw new GameError('There is no bot on that seat.');
    this.members.delete(bot.token);
    this.touch();
  }

  hasBots(): boolean {
    for (const m of this.members.values()) if (m.bot && m.seat) return true;
    return false;
  }

  private isBotSeat(seat: Seat | null): boolean {
    return Boolean(seat && this.memberOn(seat)?.bot);
  }

  /**
   * What a bot must do next, if anything: move, answer a draw, accept a mate
   * offer, or vote for a rematch. Null when it's a human's turn or nothing to do.
   */
  botDuty(): { kind: 'move' | 'draw' | 'mate' | 'rematch'; seat: Seat } | null {
    const game = this.game;
    if (game.status === 'ended') return null; // rematch votes are cast alongside the human vote
    if (game.status !== 'playing' || game.result) return null;
    if (game.bailout) {
      const seat = seatsFor(this.setup).find((s) => seatSide(s) === game.bailout!.side && this.isBotSeat(s));
      // Bot side accepts mate only when no human on that side could pay.
      const humans = seatsFor(this.setup).some((s) => seatSide(s) === game.bailout!.side && !this.isBotSeat(s));
      return seat && !humans ? { kind: 'mate', seat } : null;
    }
    if (game.drawOffer) {
      const seats = seatsFor(this.setup).filter((s) => seatSide(s) !== game.drawOffer!.side);
      if (seats.every((s) => this.isBotSeat(s))) return { kind: 'draw', seat: seats[0]! };
    }
    const mover = game.seatToMove();
    return mover && this.isBotSeat(mover) ? { kind: 'move', seat: mover } : null;
  }

  /** Delay before the pending bot duty runs. */
  botDelay(random: () => number = Math.random): number {
    const duty = this.botDuty();
    if (!duty) return -1;
    return duty.kind === 'move' ? thinkDelay(this.botProfile, random) : 800;
  }

  /** Perform the pending bot duty. Never throws; returns true if anything changed. */
  playBot(now = Date.now(), random: () => number = Math.random): boolean {
    const duty = this.botDuty();
    if (!duty) return false;
    const bot = this.memberOn(duty.seat)!;
    try {
      this.game.tick(now);
      if (this.game.result) return true;
      if (duty.kind === 'mate') {
        this.game.acceptMate(duty.seat);
      } else if (duty.kind === 'draw') {
        this.game.answerDraw(duty.seat, false, now);
      } else {
        const input = chooseMove(this.gameType, this.game.fen(), this.botProfile, random);
        if (!input) return false;
        this.move(bot.token, input, now);
      }
      this.touch();
      return true;
    } catch (error) {
      // A bot must never hang the game: fall back to the first legal move, else resign.
      try {
        const legal = this.game.legalMoves()[0];
        if (duty.kind === 'move' && legal) {
          this.move(bot.token, { from: legal.from, to: legal.to, ...(legal.promotion ? { promotion: legal.promotion } : {}), ...(legal.path && legal.path.length > 1 ? { via: legal.path.slice(0, -1) } : {}) }, now);
        } else if (!this.game.result) {
          this.game.resign(duty.seat, now);
        }
      } catch {
        if (!this.game.result && this.game.status === 'playing') this.game.resign(duty.seat, now);
      }
      void error;
      return true;
    }
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

  /** Watch read-only. Spectators hold no token and can never act. */
  addSpectator(socketId: string): void {
    if (this.sockets.has(socketId)) throw new GameError('You are already seated at this table.');
    this.spectators.add(socketId);
  }

  removeSpectator(socketId: string): void {
    this.spectators.delete(socketId);
  }

  isSpectator(socketId: string): boolean {
    return this.spectators.has(socketId);
  }

  watching(): number {
    return this.spectators.size;
  }

  summary(now = Date.now()): TableSummary {
    this.game.tick(now);
    const seats = seatsFor(this.setup);
    const players: { seat: Seat; name: string }[] = [];
    for (const seat of seats) {
      const name = this.nameFor(seat);
      if (name) players.push({ seat, name });
    }
    const clock = this.game.clockView(now);
    return {
      code: this.code,
      gameType: this.gameType,
      mode: this.setup.mode,
      pairSide: this.setup.pairSide,
      label: modeLabel(this.setup),
      status: this.game.status,
      filled: players.length,
      total: seats.length,
      openSeats: this.openSeats().length,
      players,
      clock: clock
        ? { whiteMs: clock.whiteMs, blackMs: clock.blackMs, active: clock.active, running: clock.running }
        : null,
      clockPreset: this.presetId,
      watching: this.spectators.size,
    };
  }

  disconnect(socketId: string, now = Date.now()): void {
    this.spectators.delete(socketId);
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
    const reserved = this.tournament?.seats[seat];
    if (reserved && normalizeName(reserved) !== normalizeName(member.name)) {
      throw new GameError(`That seat is reserved for ${reserved} (tournament match).`);
    }
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
    this.game.move(member.seat, input, now, member.name);
    const played = this.game.history().at(-1);
    if (this.gameType === 'chess') {
      this.noteOpening(now);
      if (played) this.noteBlunder(beforeFen, legal, played);
      this.noteMateInOne();
    }
    this.syncPresence(now);
    this.touch();
  }

  resign(token: string, now = Date.now()): void {
    const member = this.must(token);
    if (!member.seat) throw new GameError('Take a seat before resigning.');
    this.game.resign(member.seat, now);
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
    if (this.tournament) throw new GameError('Tournament matches have no rematch. Head back to the bracket.');
    let started = this.game.voteRematch(member.seat, now);
    for (const m of this.members.values()) if (!started && m.bot && m.seat) started = this.game.voteRematch(m.seat, now);
    if (started) {
      if (this.scrambleRematch) this.scramble();
      this.teams = { at: now, scrambled: this.scrambleRematch, white: this.teamNames('white'), black: this.teamNames('black') };
    }
    this.syncPresence(now);
    this.touch();
  }

  setScramble(token: string, on: boolean): void {
    const member = this.must(token);
    if (!member.seat) throw new GameError('Only players choose how the rematch is seated.');
    if (this.game.status !== 'ended') throw new GameError('Pick scramble once the game is over.');
    this.scrambleRematch = on;
    this.touch();
  }

  /** Reseat every player at random across both colors. Mode and team sizes stay. */
  scramble(): void {
    const current: Arrangement<Member> = {};
    for (const member of this.members.values()) {
      if (member.seat && seatsFor(this.setup).includes(member.seat)) current[member.seat] = member;
    }
    const next = scrambleSeats(current, this.setup, this.random, (member) => member.token);
    for (const member of Object.values(current)) if (member) member.seat = null;
    for (const [seat, member] of Object.entries(next)) if (member) member.seat = seat as Seat;
  }

  private teamNames(side: Side): string[] {
    return seatsFor(this.setup)
      .filter((seat) => seatSide(seat) === side)
      .map((seat) => this.nameFor(seat) ?? seat);
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
    this.game.setMoverConnected(Boolean(member && (member.bot || member.sockets.size > 0)), now);
  }

  view(socketId: string, now: number): PublicState {
    this.game.tick(now);
    this.game.expireBailout(now);
    this.clearAnnouncementsIfReset();
    this.scoreIfNeeded();
    const spectating = this.spectators.has(socketId);
    const you = spectating ? undefined : this.memberBySocket(socketId);
    const raw = this.game.result;
    const described = raw ? describeResult(raw, (seat) => this.nameFor(seat)) : null;
    return {
      code: this.code,
      gameType: this.gameType,
      status: this.game.status,
      clockPreset: this.presetId,
      mode: this.setup.mode,
      pairSide: this.setup.pairSide,
      seats: this.seatMap(),
      fen: this.game.fen(),
      ply: this.game.ply(),
      seatToMove: this.game.seatToMove(),
      inCheck: this.game.inCheck(),
      legalMoves: spectating ? [] : this.game.legalMoves(),
      moves: this.game.history(),
      result: raw && described ? { ...raw, ...described } : null,
      drawOffer: this.game.drawOffer ? { ...this.game.drawOffer } : null,
      rematchVotes: [...this.game.rematchVotes],
      scrambleRematch: this.scrambleRematch,
      teams: this.teams && now - this.teams.at < 15_000 ? { ...this.teams } : null,
      clock: this.game.clockView(now),
      yourSeat: you?.seat ?? null,
      spectating,
      watching: this.spectators.size,
      hints: this.hintsFor(you?.seat ?? null),
      serverNow: now,
      opening: this.openingFlash,
      mark: this.moveMark,
      bailout: this.game.bailout ? { ...this.game.bailout } : null,
      escape: this.game.escape ? { ...this.game.escape } : null,
      missedMate: this.game.missedMate ? { ...this.game.missedMate } : null,
      streak: this.streak ? { ...this.streak } : null,
      mateInOne:
        this.game.status === 'playing' && !this.game.result && this.mateInOne?.ply === this.game.ply()
          ? { ply: this.mateInOne.ply }
          : null,
      thinkTimes: this.game.thinkTimes(now, this.seatNames()),
      tournament: this.tournament?.code || null,
    };
  }

  private seatNames(): Partial<Record<Seat, string>> {
    const names: Partial<Record<Seat, string>> = {};
    for (const member of this.members.values()) if (member.seat) names[member.seat] = member.name;
    return names;
  }

  private seatMap(): Record<Seat, SeatView | null> {
    const seats: Record<Seat, SeatView | null> = {
      white1: null,
      white2: null,
      white3: null,
      black1: null,
      black2: null,
      black3: null,
    };
    for (const member of this.members.values()) {
      if (!member.seat) continue;
      seats[member.seat] = { name: member.name, connected: member.bot || member.sockets.size > 0, ...(member.bot ? { bot: true } : {}) };
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

  /** Is a member with this name sitting on `seat` and connected? */
  seatedAndConnected(seat: Seat): boolean {
    const m = this.memberOn(seat);
    return Boolean(m && (m.bot || m.sockets.size > 0));
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
      accept: (mark, ranked, quality) => {
        const mover = this.nameFor(played.seat);
        if (quality && mover && !this.hasBots()) getChessStats().record(mover, quality);
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
    if (this.gameType !== 'chess') return [];
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
    for (const seat of seatsFor(this.setup)) {
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
    if (this.hasBots()) return; // games with any bot never count
    const name = (seat: Seat) => this.nameFor(seat);
    const named = (side: Side) =>
      seatsFor(this.setup)
        .filter((seat) => seatSide(seat) === side)
        .map((seat) => name(seat))
        .filter((value): value is string => Boolean(value));
    (this.gameType === 'checkers' ? getCheckersLeaderboard() : getLeaderboard()).record({
      winner: result.winner,
      white: named('white'),
      black: named('black'),
    });
  }
}

export function createRoom(preset: ClockPreset, setup?: TableSetup, gameType: GameType = 'chess'): Room {
  let code = makeCode();
  while (rooms.has(code)) code = makeCode();
  const room = new Room(code, preset, setup, gameType);
  rooms.set(code, room);
  return room;
}

const expiredCodes = new Set<string>();

/** Why a table code has no room: it idled out on this server, or it predates the last restart (rooms live in memory). */
export function missingRoomMessage(code: string): string {
  if (expiredCodes.has(code)) return 'That table expired after sitting idle.';
  return 'No table with that code. If you were just playing there, Chud Hub restarted for an update and tables in progress were closed. Sorry! Start a new table.';
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
    .filter((room) => !room.tournament && room.anyoneConnected() && room.openSeats().length > 0)
    .sort((a, b) => a.openSeats().length - b.openSeats().length || a.createdAt - b.createdAt);
}

/** Every table worth showing in the lobby list: someone is there, waiting tables first. */
export function liveRooms(): Room[] {
  const rank = (room: Room) => (room.game.status === 'lobby' ? 0 : room.game.status === 'playing' ? 1 : 2);
  return listRooms()
    .filter((room) => room.anyoneConnected())
    .sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt);
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
    expiredCodes.add(room.code);
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
