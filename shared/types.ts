export const ALL_SEATS = ['white1', 'black1', 'white2', 'black2', 'white3', 'black3'] as const;

export type Seat = (typeof ALL_SEATS)[number];

/** The classic 2v2 seats, in move order. */
export const SEATS = ['white1', 'black1', 'white2', 'black2'] as const satisfies readonly Seat[];
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
  | 'timeout'
  | 'missed_mate';

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
  /** Who played it, kept so analysis still knows after seats change. */
  name?: string;
  /** Positions around the move, for post-game analysis. */
  fenBefore?: string;
  fenAfter?: string;
  /** Missed-mate rule fired: pieces taken off after this move. */
  missedMate?: MissedMateNote;
}

export interface MissedMateNote {
  /** Mating moves that were on the board, SAN. */
  missed: string[];
  removed: { square: string; piece: string }[];
}

export interface MissedMateCall {
  at: number;
  ply: number;
  name: string;
  side: Side;
  missed: string[];
  removed: { square: string; piece: string }[];
}

export interface TeamsBanner {
  at: number;
  scrambled: boolean;
  white: string[];
  black: string[];
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

export interface OpeningCall {
  name: string;
  ply: number;
  at: number;
}

export type MoveGrade = 'brilliant' | 'good' | 'blunder';

export interface MoveMark {
  square: string;
  ply: number;
  at: number;
  grade: MoveGrade;
}

export interface BailoutOffer {
  side: Side;
  deadline: number;
}

export interface KingEscape {
  square: string;
  from: string;
  at: number;
  name: string;
  side: Side;
  ply: number;
}

export type StreakKind = 'double' | 'streak';

export interface StreakCall {
  name: string;
  seat: Seat;
  ply: number;
  at: number;
  kind: StreakKind;
}

export interface MateInOneCall {
  ply: number;
}

export interface LeaderboardRow {
  name: string;
  wins: number;
  losses: number;
  draws: number;
  played: number;
  winRate: number;
  /** Rated moves and their quality (absent on older servers). */
  moves?: number;
  accuracy?: number | null;
  brilliant?: number;
  great?: number;
  mistake?: number;
  blunder?: number;
}

/** Thinking time one seated player has used this game (not the team clock). */
export interface ThinkTime {
  seat: Seat;
  name: string;
  totalMs: number;
  moves: number;
  longestMs: number;
  /** Ms into the current think when this seat is to move, as of serverNow. */
  currentMs: number;
}

export interface PublicState {
  code: string;
  status: 'lobby' | 'playing' | 'ended';
  clockPreset: string;
  mode: GameMode;
  pairSide: Side | null;
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
  /** Rematch reshuffles everyone across both colors and seats. */
  scrambleRematch: boolean;
  /** New teams announced after a rematch starts. */
  teams: TeamsBanner | null;
  clock: ClockView | null;
  yourSeat: Seat | null;
  /** True when this socket is watching read-only. */
  spectating: boolean;
  /** How many spectators are watching. */
  watching: number;
  hints: HintArrow[];
  serverNow: number;
  opening: OpeningCall | null;
  mark: MoveMark | null;
  bailout: BailoutOffer | null;
  escape: KingEscape | null;
  missedMate: MissedMateCall | null;
  streak: StreakCall | null;
  mateInOne: MateInOneCall | null;
  /** Per-player thinking time, every seat that has played or is to move. */
  thinkTimes: ThinkTime[];
  /** Tournament code when this table is a tournament match. */
  tournament: string | null;
}

export interface Ack {
  ok: boolean;
  error?: string;
  fatal?: boolean;
  /** The action needs a signed-in name. */
  auth?: boolean;
  token?: string;
  code?: string;
  /** Fake checkmate bailout could not find a safe square. */
  declined?: boolean;
  /** Lobby: how many tables have a free seat right now. */
  openTables?: number;
  /** Lobby: every live table. */
  tables?: TableSummary[];
  tournament?: TournamentView;
  hostKey?: string;
  tournaments?: TournamentSummary[];
  /** Analysis: engine evaluation of one position. */
  evaluation?: import('./analysis.js').Evaluation | null;
}

export interface TableSummary {
  code: string;
  mode: GameMode;
  pairSide: Side | null;
  label: string;
  status: 'lobby' | 'playing' | 'ended';
  filled: number;
  total: number;
  openSeats: number;
  players: { seat: Seat; name: string }[];
  clock: { whiteMs: number; blackMs: number; active: Side | null; running: boolean } | null;
  clockPreset: string;
  watching: number;
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

export const GAME_MODES = ['1v1', '2v1', '2v2', '3v2', '3v3'] as const;
export type GameMode = (typeof GAME_MODES)[number];

export interface TableSetup {
  mode: GameMode;
  /** In 2v1 / 3v2, the color with the larger team. Null in every other mode. */
  pairSide: Side | null;
}

export function isSeat(value: unknown): value is Seat {
  return typeof value === 'string' && (ALL_SEATS as readonly string[]).includes(value);
}

export function isSide(value: unknown): value is Side {
  return value === 'white' || value === 'black';
}

function unevenMode(mode: GameMode): boolean {
  return mode === '2v1' || mode === '3v2';
}

export function tableSetup(mode: unknown, pairSide: unknown): TableSetup | null {
  if (mode == null || mode === '') return { mode: '2v2', pairSide: null };
  if (typeof mode !== 'string' || !(GAME_MODES as readonly string[]).includes(mode)) return null;
  const m = mode as GameMode;
  if (unevenMode(m)) {
    if (pairSide == null || pairSide === '') return m === '3v2' ? { mode: m, pairSide: 'white' } : null;
    if (!isSide(pairSide)) return null;
    return { mode: m, pairSide };
  }
  return { mode: m, pairSide: null };
}

/** Number of players on each side. */
export function teamSizes(setup: TableSetup): Record<Side, number> {
  switch (setup.mode) {
    case '1v1':
      return { white: 1, black: 1 };
    case '2v2':
      return { white: 2, black: 2 };
    case '3v3':
      return { white: 3, black: 3 };
    case '2v1':
    case '3v2': {
      const big = setup.mode === '2v1' ? 2 : 3;
      const small = big - 1;
      return setup.pairSide === 'black' ? { white: small, black: big } : { white: big, black: small };
    }
  }
}

function sideSeat(side: Side, index: number): Seat {
  return `${side}${index + 1}` as Seat;
}

/** Seats in play: interleaved (W1, B1, W2, B2, ...) for even teams, White then Black for uneven ones. */
export function seatsFor(setup: TableSetup): Seat[] {
  const sizes = teamSizes(setup);
  const out: Seat[] = [];
  if (sizes.white !== sizes.black) {
    for (let i = 0; i < sizes.white; i += 1) out.push(sideSeat('white', i));
    for (let i = 0; i < sizes.black; i += 1) out.push(sideSeat('black', i));
    return out;
  }
  for (let i = 0; i < Math.max(sizes.white, sizes.black); i += 1) {
    if (i < sizes.white) out.push(sideSeat('white', i));
    if (i < sizes.black) out.push(sideSeat('black', i));
  }
  return out;
}

function mod(value: number, base: number): number {
  return ((value % base) + base) % base;
}

/** Whose seat moves at this ply. White always moves on even plies; each team cycles its own players. */
export function seatForSetup(ply: number, setup: TableSetup): Seat {
  const sizes = teamSizes(setup);
  const side: Side = mod(ply, 2) === 0 ? 'white' : 'black';
  const moveOnSide = Math.floor(ply / 2);
  return sideSeat(side, mod(moveOnSide, sizes[side]));
}

export function seatForPly(ply: number): Seat {
  return seatForSetup(ply, { mode: '2v2', pairSide: null });
}

export function modeLabel(setup: TableSetup): string {
  if (setup.mode === '2v1' || setup.mode === '3v2') {
    const n = setup.mode === '2v1' ? 'two' : 'three';
    return `${setup.mode} · ${n} on ${setup.pairSide === 'black' ? 'Black' : 'White'}`;
  }
  return setup.mode;
}

export function seatSide(seat: Seat): Side {
  return seat.startsWith('white') ? 'white' : 'black';
}

export function seatLabel(seat: Seat, active?: readonly Seat[]): string {
  const side = seatSide(seat) === 'white' ? 'White' : 'Black';
  const mates = (active ?? SEATS).filter((item) => seatSide(item) === seatSide(seat));
  if (mates.length < 2) return side;
  return `${side} ${seat.slice(-1)}`;
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
    case 'missed_mate':
      return {
        headline: 'Missed mate',
        detail: `${loser} skipped a mate in one and losing the piece left their king hanging. ${winner} wins.`,
      };
  }
}

export interface TournamentMatchView {
  id: string;
  round: number;
  white: string | null;
  black: string | null;
  room: string | null;
  winner: string | null;
  /** win = played out; draw-time = drawn, less thinking time advanced; forfeit = no-show/host; bye. */
  how: 'win' | 'draw-time' | 'forfeit' | 'bye' | null;
  live: boolean;
  readyAt: number | null;
}

export interface TournamentView {
  code: string;
  host: string;
  clockId: string;
  size: number;
  status: 'signup' | 'running' | 'done';
  entrants: string[];
  champion: string | null;
  rounds: TournamentMatchView[][];
  yourMatch: { room: string; side: Side; readyAt: number | null } | null;
}

export interface TournamentSummary {
  code: string;
  host: string;
  clockId: string;
  size: number;
  players: number;
  status: 'signup' | 'running' | 'done';
}
