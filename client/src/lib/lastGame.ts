import type { GameMode, GameType, MoveRecord, PublicState, Side, ThinkTime } from '../../../shared/types';
import { seatsFor, seatSide } from '../../../shared/types';

export interface FinishedGame {
  code: string;
  mode: GameMode;
  pairSide: Side | null;
  moves: MoveRecord[];
  headline: string;
  detail: string;
  winner: Side | null;
  white: string[];
  black: string[];
  endedAt: number;
  thinkTimes?: ThinkTime[];
  gameType?: GameType;
}

const KEY = 'relay:last-game';
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function snapshotGame(state: PublicState): FinishedGame | null {
  if (state.status !== 'ended' || !state.result || state.moves.length === 0) return null;
  const setup = { mode: state.mode, pairSide: state.pairSide };
  const names = (side: Side) =>
    seatsFor(setup)
      .filter((seat) => seatSide(seat) === side)
      .map((seat) => state.seats[seat]?.name ?? seat);
  return {
    code: state.code,
    mode: state.mode,
    pairSide: state.pairSide,
    moves: state.moves.map((move) => ({ ...move, name: move.name ?? state.seats[move.seat]?.name })),
    headline: state.result.headline,
    detail: state.result.detail,
    winner: state.result.winner,
    white: names('white'),
    black: names('black'),
    endedAt: Date.now(),
    thinkTimes: state.thinkTimes ?? [],
    gameType: state.gameType ?? 'chess',
  };
}

export function saveLastGame(game: FinishedGame): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(game));
  } catch {
    /* storage full or blocked */
  }
}

export function loadLastGame(): FinishedGame | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as FinishedGame) : null;
  } catch {
    return null;
  }
}

export function gameToPgn(game: FinishedGame): string {
  const start = game.moves[0]?.fenBefore ?? START_FEN;
  const result = game.winner === 'white' ? '1-0' : game.winner === 'black' ? '0-1' : '1/2-1/2';
  const date = new Date(game.endedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const headers: [string, string][] = [
    ['Event', `Chud Hub Relay Chess ${game.mode}`],
    ['Site', 'https://chudhub.club'],
    ['Date', `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`],
    ['White', game.white.join(' & ')],
    ['Black', game.black.join(' & ')],
    ['Result', result],
    ['Termination', `${game.headline}. ${game.detail}`],
  ];
  if (start !== START_FEN) headers.push(['SetUp', '1'], ['FEN', start]);
  const startFullmove = Number(start.split(' ')[5] ?? 1) || 1;
  const blackFirst = start.split(' ')[1] === 'b';
  const parts: string[] = [];
  game.moves.forEach((move, index) => {
    const ply = index + (blackFirst ? 1 : 0);
    const number = startFullmove + Math.floor(ply / 2);
    if (ply % 2 === 0) parts.push(`${number}.`);
    else if (index === 0) parts.push(`${number}...`);
    parts.push(move.san);
    if (move.name) parts.push(`{${move.name.replace(/[{}]/g, '')}}`);
    if (move.missedMate) {
      const lost = move.missedMate.removed.map((r) => `${r.piece.toUpperCase()}${r.square}`).join(', ');
      parts.push(`{missed mate ${move.missedMate.missed.join('/')}: lost ${lost}; position ${move.fenAfter ?? ''}}`);
    }
    const next = game.moves[index + 1];
    if (!move.missedMate && next?.fenBefore && move.fenAfter && next.fenBefore !== move.fenAfter) parts.push('{king escape}');
  });
  parts.push(result);
  return `${headers.map(([k, v]) => `[${k} "${v.replace(/"/g, "'")}"]`).join('\n')}\n\n${parts.join(' ')}\n`;
}
