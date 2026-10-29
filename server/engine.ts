import { Chess, type Color, type Square } from 'chess.js';
import {
  SEATS,
  opposite,
  seatForPly,
  seatSide,
  type DrawOffer,
  type GameResult,
  type LegalMove,
  type MoveInput,
  type MoveRecord,
  type Promotion,
  type Seat,
  type Side,
} from '../shared/types.js';
import { GameError } from './errors.js';

/** Network lag cushion before a clock is treated as a flag fall. */
export const LAG_GRACE_MS = 300;

interface Clock {
  initialMs: number;
  incrementMs: number;
  remaining: Record<Side, number>;
  running: boolean;
  asOf: number;
}

export interface Timing {
  initialMs: number;
  incrementMs: number;
}

const PROMOTIONS = new Set<Promotion>(['q', 'r', 'b', 'n']);

function isSquare(value: string): value is Square {
  return /^[a-h][1-8]$/.test(value);
}

function isPromotion(value: string | undefined): value is Promotion {
  return value !== undefined && PROMOTIONS.has(value as Promotion);
}

export function detectTerminal(chess: Chess): GameResult | null {
  if (chess.isCheckmate()) {
    return { type: 'checkmate', winner: chess.turn() === 'w' ? 'black' : 'white' };
  }
  if (chess.isStalemate()) return { type: 'stalemate', winner: null };
  if (chess.isInsufficientMaterial()) return { type: 'insufficient', winner: null };
  if (chess.isThreefoldRepetition()) return { type: 'threefold', winner: null };
  if (chess.isDrawByFiftyMoves()) return { type: 'fifty_move', winner: null };
  return null;
}

/**
 * FIDE 6.9: flag fall is a draw when the opponent cannot checkmate by any
 * legal series of moves, even with the flagging side's cooperation.
 * Lone king, king and knight, king and bishop, and same-color bishops only
 * cannot mate. Two knights can mate with help, so that is a loss on time.
 */
export function canPossiblyMate(chess: Chess, color: Color): boolean {
  const own: { type: string; square: Square }[] = [];
  const other: { type: string; square: Square }[] = [];
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece || piece.type === 'k') continue;
      const entry = { type: piece.type, square: piece.square };
      if (piece.color === color) own.push(entry);
      else other.push(entry);
    }
  }
  if (own.length === 0) return false;
  if (own.length === 1 && (own[0].type === 'n' || own[0].type === 'b')) return false;
  const bishopsOnly = (pieces: { type: string; square: Square }[]) =>
    pieces.length > 0 && pieces.every((piece) => piece.type === 'b');
  if (bishopsOnly(own) && (other.length === 0 || bishopsOnly(other))) {
    const colors = new Set(
      [...own, ...other].map((piece) => (piece.square.charCodeAt(0) + Number(piece.square[1])) % 2),
    );
    if (colors.size === 1) return false;
  }
  return true;
}

export class RelayGame {
  status: 'lobby' | 'playing' | 'ended' = 'lobby';
  result: GameResult | null = null;
  drawOffer: DrawOffer | null = null;
  readonly rematchVotes = new Set<Seat>();

  private chess = new Chess();
  private moves: MoveRecord[] = [];
  private basePly = 0;
  private clock: Clock | null;

  constructor(timing: Timing | null) {
    this.clock =
      timing && timing.initialMs > 0
        ? {
            initialMs: timing.initialMs,
            incrementMs: timing.incrementMs,
            remaining: { white: timing.initialMs, black: timing.initialMs },
            running: false,
            asOf: 0,
          }
        : null;
  }

  static fromPosition(fen: string, ply: number, timing: Timing | null = null, now = 0): RelayGame {
    const game = new RelayGame(timing);
    game.chess = new Chess(fen);
    const seat = seatForPly(ply);
    const turn: Color = seatSide(seat) === 'white' ? 'w' : 'b';
    if (game.chess.turn() !== turn) {
      throw new Error(`FEN side to move does not match ply ${ply}`);
    }
    game.basePly = ply;
    game.status = 'playing';
    if (game.clock) {
      game.clock.running = true;
      game.clock.asOf = now;
    }
    const terminal = detectTerminal(game.chess);
    if (terminal) game.finish(terminal);
    return game;
  }

  fen(): string {
    return this.chess.fen();
  }

  ply(): number {
    return this.basePly + this.moves.length;
  }

  seatToMove(): Seat | null {
    if (this.status !== 'playing') return null;
    return seatForPly(this.ply());
  }

  inCheck(): boolean {
    return this.status === 'playing' && this.chess.isCheck();
  }

  hasResult(): boolean {
    return this.result !== null;
  }

  isClockRunning(): boolean {
    return Boolean(this.clock?.running);
  }

  history(): MoveRecord[] {
    return this.moves.map((move) => ({ ...move }));
  }

  legalMoves(): LegalMove[] {
    if (this.status !== 'playing') return [];
    return this.chess.moves({ verbose: true }).map((move) => ({
      from: move.from,
      to: move.to,
      san: move.san,
      ...(isPromotion(move.promotion) ? { promotion: move.promotion } : {}),
    }));
  }

  clockView(now: number): {
    whiteMs: number;
    blackMs: number;
    incrementMs: number;
    running: boolean;
    active: Side | null;
    asOf: number;
    serverNow: number;
  } | null {
    if (!this.clock) return null;
    const seat = this.seatToMove();
    return {
      whiteMs: this.clock.remaining.white,
      blackMs: this.clock.remaining.black,
      incrementMs: this.clock.incrementMs,
      running: this.clock.running,
      active: seat ? seatSide(seat) : null,
      asOf: this.clock.asOf,
      serverNow: now,
    };
  }

  start(now: number): void {
    if (this.status !== 'lobby') return;
    this.status = 'playing';
    if (this.clock) {
      this.clock.running = true;
      this.clock.asOf = now;
    }
  }

  /** Advance a running clock. Ends the game on flag fall. */
  tick(now: number): void {
    const clock = this.clock;
    if (!clock || !clock.running || this.status !== 'playing' || this.result) return;
    const elapsed = now - clock.asOf;
    if (elapsed <= 0) {
      if (elapsed < 0) clock.asOf = now;
      return;
    }
    clock.asOf = now;
    const seat = this.seatToMove();
    if (!seat) return;
    const side = seatSide(seat);
    clock.remaining[side] -= elapsed;
    if (clock.remaining[side] <= -LAG_GRACE_MS) {
      clock.remaining[side] = 0;
      clock.running = false;
      this.finishTimeout(side);
    }
  }

  setMoverConnected(connected: boolean, now: number): void {
    if (!this.clock || this.status !== 'playing' || this.result) return;
    if (!connected) {
      if (this.clock.running) {
        this.tick(now);
        if (!this.result) this.clock.running = false;
      }
      return;
    }
    if (!this.clock.running) {
      this.clock.running = true;
      this.clock.asOf = now;
    }
  }

  move(seat: Seat, input: MoveInput, now: number): void {
    if (this.status !== 'playing' || this.result) {
      throw new GameError('The game is not in progress.');
    }
    if (seat !== this.seatToMove()) {
      throw new GameError("It's not your turn.");
    }
    if (!isSquare(input.from) || !isSquare(input.to)) {
      throw new GameError('Illegal move.');
    }
    if (input.promotion !== undefined && !isPromotion(input.promotion)) {
      throw new GameError('Choose a queen, rook, bishop, or knight.');
    }

    const snapshot = this.cloneClock();
    if (this.clock && !this.clock.running) {
      this.clock.asOf = now;
      this.clock.running = true;
    }
    this.tick(now);
    if (this.result) throw new GameError('Time has run out.');

    const side = seatSide(seat);
    if (this.clock && this.clock.remaining[side] < 0) this.clock.remaining[side] = 0;

    let played: { san: string; from: string; to: string } | null = null;
    try {
      played = this.chess.move({
        from: input.from,
        to: input.to,
        ...(input.promotion ? { promotion: input.promotion } : {}),
      });
    } catch {
      played = null;
    }
    if (!played) {
      this.clock = snapshot;
      throw new GameError('Illegal move.');
    }

    if (this.clock) {
      this.clock.remaining[side] += this.clock.incrementMs;
      this.clock.asOf = now;
      this.clock.running = true;
    }

    if (this.drawOffer && seatSide(seat) !== this.drawOffer.side) {
      this.drawOffer = null;
    }

    this.moves.push({
      san: played.san,
      from: played.from,
      to: played.to,
      seat,
    });

    const terminal = detectTerminal(this.chess);
    if (terminal) this.finish(terminal);
  }

  resign(seat: Seat): void {
    if (this.status !== 'playing' || this.result) {
      throw new GameError('The game is not in progress.');
    }
    this.finish({
      type: 'resignation',
      winner: opposite(seatSide(seat)),
      bySeat: seat,
    });
  }

  offerDraw(seat: Seat, now: number): void {
    if (this.status !== 'playing' || this.result) {
      throw new GameError('The game is not in progress.');
    }
    if (this.seatToMove() !== seat) {
      throw new GameError('You can offer a draw on your turn.');
    }
    this.tick(now);
    if (this.result) throw new GameError('Time has run out.');
    if (this.drawOffer?.seat === seat) {
      this.drawOffer = null;
      return;
    }
    this.drawOffer = { seat, side: seatSide(seat) };
  }

  answerDraw(seat: Seat, accept: boolean, now: number): void {
    if (this.status !== 'playing' || this.result || !this.drawOffer) {
      throw new GameError('There is no draw offer.');
    }
    if (seatSide(seat) === this.drawOffer.side) {
      throw new GameError('Only the other team can answer a draw.');
    }
    if (!accept) {
      this.drawOffer = null;
      return;
    }
    this.tick(now);
    if (this.result) return;
    this.finish({ type: 'draw_agreed', winner: null });
  }

  voteRematch(seat: Seat, now: number): void {
    if (this.status !== 'ended') return;
    this.rematchVotes.add(seat);
    if (SEATS.every((candidate) => this.rematchVotes.has(candidate))) {
      this.reset(now);
    }
  }

  private finishTimeout(flagged: Side): void {
    const opponent = opposite(flagged);
    const oppColor: Color = opponent === 'white' ? 'w' : 'b';
    const winner = canPossiblyMate(this.chess, oppColor) ? opponent : null;
    this.finish({ type: 'timeout', winner });
  }

  private finish(result: GameResult): void {
    if (this.result) return;
    this.result = result;
    this.status = 'ended';
    this.drawOffer = null;
    if (this.clock) this.clock.running = false;
  }

  private reset(now: number): void {
    this.chess = new Chess();
    this.moves = [];
    this.basePly = 0;
    this.result = null;
    this.drawOffer = null;
    this.rematchVotes.clear();
    this.status = 'playing';
    if (this.clock) {
      this.clock.remaining.white = this.clock.initialMs;
      this.clock.remaining.black = this.clock.initialMs;
      this.clock.running = true;
      this.clock.asOf = now;
    }
  }

  private cloneClock(): Clock | null {
    if (!this.clock) return null;
    return {
      ...this.clock,
      remaining: { ...this.clock.remaining },
    };
  }
}
