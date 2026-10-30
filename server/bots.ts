import { Chess } from 'chess.js';
import { applyMove as applyCheckers, legalMoves as checkersMoves, parseFen as parseCheckers, type CPosition } from '../shared/checkers.js';
import type { GameType, MoveInput, Promotion } from '../shared/types.js';

/**
 * House bots. Strength is one server knob, BOT_ELO (default 650), mapped to a
 * shallow search depth, an eval-noise level and a blunder rate (chance of a
 * uniformly random legal move). Raise BOT_ELO to make them tougher.
 */
export interface BotProfile {
  elo: number;
  /** Plies searched (material only). */
  depth: number;
  /** Chance of playing a random legal move instead of searching. */
  blunderRate: number;
  /** Uniform noise (centipawns, ±) added to each root move's score. */
  noiseCp: number;
  /** Human-ish think delay range. */
  minDelayMs: number;
  maxDelayMs: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function botElo(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.BOT_ELO);
  return Number.isFinite(raw) && raw >= 100 && raw <= 3000 ? Math.round(raw) : 650;
}

export function botProfile(elo = botElo()): BotProfile {
  return {
    elo,
    depth: elo < 900 ? 1 : elo < 1500 ? 2 : 3,
    blunderRate: clamp(0.55 - elo / 2000, 0.02, 0.5),
    noiseCp: Math.round(clamp(400 - elo / 4, 15, 300)),
    minDelayMs: 1000,
    maxDelayMs: 4000,
  };
}

export const BOT_PIECES = ['Rook', 'Knight', 'Bishop', 'Pawn', 'Queen', 'King'] as const;
export const botName = (elo: number, piece: string) => `Bot ${elo} · ${piece}`;
/** Bot names can't be claimed or used by people. */
export const isBotName = (name: string) => /^bot(?![a-z])/i.test(name.trim());

export function thinkDelay(profile: BotProfile, random: () => number = Math.random): number {
  return Math.round(profile.minDelayMs + random() * (profile.maxDelayMs - profile.minDelayMs));
}

const VALUE: Record<string, number> = { p: 100, n: 300, b: 310, r: 500, q: 900, k: 0 };

function chessMaterial(chess: Chess): number {
  // From the side to move's point of view.
  const turn = chess.turn();
  let score = 0;
  for (const row of chess.board()) for (const sq of row) if (sq) score += (sq.color === turn ? 1 : -1) * VALUE[sq.type]!;
  return score;
}

function chessSearch(chess: Chess, depth: number): number {
  if (chess.isCheckmate()) return -100_000;
  if (chess.isDraw() || chess.isStalemate()) return 0;
  if (depth === 0) return chessMaterial(chess);
  let best = -Infinity;
  for (const m of chess.moves({ verbose: true })) {
    chess.move(m);
    best = Math.max(best, -chessSearch(chess, depth - 1));
    chess.undo();
  }
  return best;
}

function pick<T>(items: T[], score: (item: T) => number, profile: BotProfile, random: () => number): T {
  if (items.length === 1 || random() < profile.blunderRate) return items[Math.floor(random() * items.length)]!;
  let best: T = items[0] as T;
  let bestScore = -Infinity;
  for (const item of items) {
    const s = score(item) + (random() * 2 - 1) * profile.noiseCp;
    if (s > bestScore) {
      bestScore = s;
      best = item as T;
    }
  }
  return best;
}

export function chooseChessMove(fen: string, profile: BotProfile, random: () => number = Math.random): MoveInput | null {
  const chess = new Chess(fen, { skipValidation: true });
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return null;
  const m = pick(
    moves,
    (move) => {
      chess.move(move);
      const s = -chessSearch(chess, profile.depth - 1);
      chess.undo();
      return s;
    },
    profile,
    random,
  );
  return { from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion as Promotion } : {}) };
}

function checkersMaterial(p: CPosition): number {
  let s = 0;
  for (const piece of p.board.values()) s += (piece.c === p.turn ? 1 : -1) * (piece.king ? 160 : 100);
  return s;
}

function checkersSearch(p: CPosition, depth: number): number {
  const moves = checkersMoves(p);
  if (!moves.length) return -100_000;
  if (depth === 0) return checkersMaterial(p);
  let best = -Infinity;
  for (const m of moves) best = Math.max(best, -checkersSearch(applyCheckers(p, m), depth - 1));
  return best;
}

export function chooseCheckersMove(fen: string, profile: BotProfile, random: () => number = Math.random): MoveInput | null {
  const p = parseCheckers(fen);
  if (!p) return null;
  const moves = checkersMoves(p);
  if (!moves.length) return null;
  const m = pick(moves, (move) => -checkersSearch(applyCheckers(p, move), profile.depth - 1), profile, random);
  return { from: m.from, to: m.to, ...(m.path.length > 1 ? { via: m.path.slice(0, -1) } : {}) };
}

export function chooseMove(gameType: GameType, fen: string, profile: BotProfile, random?: () => number): MoveInput | null {
  return gameType === 'checkers' ? chooseCheckersMove(fen, profile, random) : chooseChessMove(fen, profile, random);
}
