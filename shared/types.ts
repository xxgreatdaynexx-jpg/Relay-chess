export const SEATS = ['white1', 'black1', 'white2', 'black2'] as const;

export type Seat = (typeof SEATS)[number];
export type Side = 'white' | 'black';
export type Promotion = 'q' | 'r' | 'b' | 'n';

export type ResultType =
  | 'checkmate'
  | 'stalemate'
  | 'resignation'
  | 'draw_agreed'
  | 'threefold'
  | 'fifty_move'
  | 'insufficient'
  | 'timeout';

export interface GameResult {
  type: ResultType;
  winner: Side | null;
  bySeat?: Seat;
}

export interface LegalMove {
  from: string;
  to: string;
  promotion?: Promotion;
  san: string;
}

export interface MoveRecord {
  san: string;
  from: string;
  to: string;
  seat: Seat;
}

export interface SeatView {
  name: string;
  connected: boolean;
}

export interface ClockView {
  whiteMs: number;
  blackMs: number;
  incrementMs: number;
  running: boolean;
  active: Side | null;
  asOf: number;
  serverNow: number;
}

export interface DrawOffer {
  seat: Seat;
  side: Side;
}

export interface PublicResult extends GameResult {
  headline: string;
  detail: string;
}

export interface HintArrow {
  from: string;
  to: string;
}

export interface LeaderboardRow {
  name: string;
  wins: number;
  losses: number;
  draws: number;
  played: number;
  winRate: number;
}

export interface PublicState {
  code: string;
  status: 'lobby' | 'playing' | 'ended';
  clockPreset: string;
  seats: Record<Seat, SeatView | null>;
  fen: string;
  ply: number;
  seatToMove: Seat | null;
  inCheck: boolean;
  legalMoves: LegalMove[];
  moves: MoveRecord[];
  result: PublicResult | null;
  drawOffer: DrawOffer | null;
  rematchVotes: Seat[];
  clock: ClockView | null;
  yourSeat: Seat | null;
  hints: HintArrow[];
}

export interface Ack {
  ok: boolean;
  error?: string;
  fatal?: boolean;
  token?: string;
  code?: string;
}

export interface MoveInput {
  from: string;
  to: string;
  promotion?: Promotion;
}

export const CLOCK_PRESETS = [
  { id: 'off', label: 'No clock', blurb: 'Casual', initialMs: 0, incrementMs: 0 },
  { id: '3+2', label: '3+2', blurb: 'Blitz', initialMs: 3 * 60_000, incrementMs: 2_000 },
  { id: '5+0', label: '5 min', blurb: 'Rapid', initialMs: 5 * 60_000, incrementMs: 0 },
  { id: '10+0', label: '10 min', blurb: 'Rapid', initialMs: 10 * 60_000, incrementMs: 0 },
  { id: '15+10', label: '15+10', blurb: 'Classical', initialMs: 15 * 60_000, incrementMs: 10_000 },
] as const;

export type ClockPreset = (typeof CLOCK_PRESETS)[number];
export type ClockId = ClockPreset['id'];

export function clockPreset(id: unknown): ClockPreset | null {
  if (typeof id !== 'string') return null;
  return CLOCK_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function isSeat(value: unknown): value is Seat {
  return typeof value === 'string' && (SEATS as readonly string[]).includes(value);
}

export function seatForPly(ply: number): Seat {
  const index = ((ply % 4) + 4) % 4;
  return SEATS[index];
}

export function seatSide(seat: Seat): Side {
  return seat.startsWith('white') ? 'white' : 'black';
}

export function seatLabel(seat: Seat): string {
  switch (seat) {
    case 'white1':
      return 'White 1';
    case 'white2':
      return 'White 2';
    case 'black1':
      return 'Black 1';
    case 'black2':
      return 'Black 2';
  }
}

export function opposite(side: Side): Side {
  return side === 'white' ? 'black' : 'white';
}

function sideName(side: Side | null): string {
  if (side === 'white') return 'White';
  if (side === 'black') return 'Black';
  return 'Draw';
}

export function describeResult(
  result: GameResult,
  nameFor: (seat: Seat) => string | undefined,
): { headline: string; detail: string } {
  const winner = result.winner ? sideName(result.winner) : null;
  const loser = result.winner ? sideName(opposite(result.winner)) : null;
  switch (result.type) {
    case 'checkmate':
      return { headline: 'Checkmate', detail: `${winner} wins.` };
    case 'stalemate':
      return {
        headline: 'Stalemate',
        detail: 'No legal move, and the king is not in check. Draw.',
      };
    case 'resignation': {
      const name = result.bySeat ? nameFor(result.bySeat) : undefined;
      const who = name ? `${name} resigned` : `${loser} resigned`;
      return { headline: 'Resignation', detail: `${who}. ${winner} wins.` };
    }
    case 'draw_agreed':
      return { headline: 'Draw agreed', detail: 'Both teams accepted a draw.' };
    case 'threefold':
      return {
        headline: 'Threefold repetition',
        detail: 'The same position occurred three times. Draw.',
      };
    case 'fifty_move':
      return {
        headline: 'Fifty-move rule',
        detail: 'Fifty moves without a capture or a pawn move. Draw.',
      };
    case 'insufficient':
      return {
        headline: 'Insufficient material',
        detail: 'Not enough material left to checkmate. Draw.',
      };
    case 'timeout':
      if (!winner) {
        return {
          headline: 'Out of time',
          detail: 'Flag fall, but the other team has no mating material. Draw.',
        };
      }
      return { headline: 'Out of time', detail: `${loser} ran out of time. ${winner} wins.` };
  }
}
