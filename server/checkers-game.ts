import type { LegalMove, MoveInput, Seat, Side } from '../shared/types.js';
import { opposite, seatSide } from '../shared/types.js';
import {
  applyMissedWin,
  applyMove,
  checkersLoser,
  findMove,
  initialPosition,
  isDark,
  legalMoves,
  parseFen,
  positionKey,
  QUIET_DRAW_PLIES,
  toFen,
  winningMoves,
  type CPosition,
} from '../shared/checkers.js';
import { RelayGame, type Clock, type Timing } from './engine.js';
import { GameError } from './errors.js';
import type { TableSetup } from '../shared/types.js';

/** Relay Checkers: the relay table machinery from RelayGame, American checkers rules on the board. */
export class CheckersGame extends RelayGame {
  private pos: CPosition = initialPosition();
  private seen = new Map<string, number>();

  constructor(timing: Timing | null, setup?: TableSetup) {
    super(timing, setup);
    this.note(this.pos);
  }

  static fromCheckers(fen: string, ply: number, setup?: TableSetup): CheckersGame {
    const game = new CheckersGame(null, setup);
    const pos = parseFen(fen);
    if (!pos) throw new Error('Bad checkers position');
    game.pos = pos;
    game.seen.clear();
    game.note(pos);
    game.basePly = ply;
    game.status = 'playing';
    return game;
  }

  private note(p: CPosition): number {
    const key = positionKey(p);
    const n = (this.seen.get(key) ?? 0) + 1;
    this.seen.set(key, n);
    return n;
  }

  override fen(): string {
    return toFen(this.pos);
  }

  override inCheck(): boolean {
    return false;
  }

  override legalMoves(): LegalMove[] {
    if (this.status !== 'playing') return [];
    return legalMoves(this.pos).map((m) => ({ from: m.from, to: m.to, san: m.san, path: m.path, captures: m.captures }));
  }

  protected override resetPosition(): void {
    this.pos = initialPosition();
    this.seen.clear();
    this.note(this.pos);
  }

  protected override finishTimeout(flagged: Side): void {
    // Any piece can still win in checkers, so a flag always loses unless the winner has nothing left.
    const opp = opposite(flagged);
    const has = [...this.pos.board.values()].some((p) => p.c === (opp === 'white' ? 'w' : 'b'));
    this.finish({ type: 'timeout', winner: has ? opp : null });
  }

  protected override playOnBoard(seat: Seat, input: MoveInput, now: number, side: Side, snapshot: Clock | null, name?: string): void {
    const via = Array.isArray(input.via) ? input.via.filter((s) => typeof s === 'string' && isDark(s)).slice(0, 12) : undefined;
    const before = this.pos;
    const played = isDark(input.from) && isDark(input.to) ? findMove(before, input.from, input.to, via) : null;
    if (!played) {
      this.clock = snapshot;
      throw new GameError('Illegal move.');
    }
    const wins = winningMoves(before);
    let after = applyMove(before, played);

    if (this.clock) {
      this.clock.remaining[side] += this.clock.incrementMs;
      this.clock.asOf = now;
      this.clock.running = true;
    }
    if (this.drawOffer && seatSide(seat) !== this.drawOffer.side) this.drawOffer = null;

    const lost = applyMissedWin(before, played, after, wins);
    if (lost) after = lost.position;
    const fenBefore = toFen(before);
    this.pos = after;
    const unpunished = applyMove(before, played);
    const removed = lost
      ? lost.removed.map((square) => ({ square, piece: unpunished.board.get(square)?.king ? 'k' : 'p' }))
      : [];
    const note = lost ? { missed: lost.missed, removed } : undefined;

    this.moves.push({
      san: played.san,
      from: played.from,
      to: played.to,
      seat,
      ...(name ? { name } : {}),
      fenBefore,
      fenAfter: toFen(after),
      ...(note ? { missedMate: note } : {}),
    });
    this.addThink(seat, now, true, name);
    if (note) this.missedMate = { at: now, ply: this.ply(), name: name ?? seat, side, ...note };

    const loser = checkersLoser(after);
    if (loser) {
      const loserSide: Side = loser === 'w' ? 'white' : 'black';
      if (lost && loserSide === side) this.finish({ type: 'missed_win', winner: opposite(side), bySeat: seat });
      else this.finish({ type: 'no_moves', winner: opposite(loserSide) });
      return;
    }
    if (this.note(after) >= 3) {
      this.finish({ type: 'threefold', winner: null });
      return;
    }
    if (after.quiet >= QUIET_DRAW_PLIES) this.finish({ type: 'forty_move', winner: null });
  }
}
