import type { MoveRecord, Seat, Side } from './types.js';

/** Engine evaluation, always from White's point of view. */
export interface Evaluation {
  /** Centipawns for White. Null when the position is a forced mate. */
  cp: number | null;
  /** Moves to mate: positive means White mates, negative means Black mates. */
  mate: number | null;
  /** Engine best move in UCI, or null at game end. */
  best: string | null;
  depth: number;
}

export type MoveLabel = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export const LABEL_GLYPH: Record<MoveLabel, string> = {
  best: '‼',
  good: '!',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
};

/** Thresholds in centipawns lost by the mover. */
export const INACCURACY_CP = 50;
export const MISTAKE_CP = 100;
export const BLUNDER_CP = 250;
const CAP_CP = 1000;

/** Collapse an evaluation to clamped centipawns for White. Mates count as ±1000. */
export function evalCp(evaluation: Pick<Evaluation, 'cp' | 'mate'>): number {
  if (evaluation.mate !== null && evaluation.mate !== undefined) {
    if (evaluation.mate === 0) return 0;
    return evaluation.mate > 0 ? CAP_CP : -CAP_CP;
  }
  const cp = evaluation.cp ?? 0;
  return Math.max(-CAP_CP, Math.min(CAP_CP, cp));
}

/** Centipawns the mover gave away, never negative. */
export function centipawnLoss(before: Pick<Evaluation, 'cp' | 'mate'>, after: Pick<Evaluation, 'cp' | 'mate'>, mover: Side): number {
  const sign = mover === 'white' ? 1 : -1;
  const loss = (evalCp(before) - evalCp(after)) * sign;
  return Math.max(0, Math.round(loss));
}

/** Label one move from the eval drop. Playing the engine's best move, or losing under 10cp, is best. */
export function classifyMove(lossCp: number, playedBest: boolean): MoveLabel {
  if (playedBest || lossCp <= 10) return 'best';
  if (lossCp < INACCURACY_CP) return 'good';
  if (lossCp < MISTAKE_CP) return 'inaccuracy';
  if (lossCp < BLUNDER_CP) return 'mistake';
  return 'blunder';
}

/** Winning chance for White in percent (lichess curve). */
export function winPercent(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** Lichess-style move accuracy from the winning-chance drop, 0–100. */
export function moveAccuracy(before: Pick<Evaluation, 'cp' | 'mate'>, after: Pick<Evaluation, 'cp' | 'mate'>, mover: Side): number {
  const sign = mover === 'white' ? 1 : -1;
  const wb = winPercent(evalCp(before) * sign);
  const wa = winPercent(evalCp(after) * sign);
  const drop = Math.max(0, wb - wa);
  const raw = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669;
  return Math.max(0, Math.min(100, raw));
}

export interface AnalyzedMove {
  label: MoveLabel;
  loss: number;
  accuracy: number;
}

export function analyzeMove(before: Evaluation, after: Evaluation, mover: Side, playedUci: string): AnalyzedMove {
  const loss = centipawnLoss(before, after, mover);
  return {
    loss,
    label: classifyMove(loss, before.best !== null && before.best === playedUci),
    accuracy: moveAccuracy(before, after, mover),
  };
}

export interface PlayerSummary {
  key: string;
  name: string;
  seat: Seat;
  moves: number;
  accuracy: number;
  acpl: number;
  best: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
}

/** Per-player totals. Players are keyed by name and seat so relayed teammates stay apart. */
export function summarizePlayers(
  moves: readonly Pick<MoveRecord, 'seat' | 'name'>[],
  analyzed: readonly (AnalyzedMove | null)[],
): PlayerSummary[] {
  const rows = new Map<string, PlayerSummary & { accSum: number; lossSum: number }>();
  moves.forEach((move, index) => {
    const name = move.name ?? move.seat;
    const key = `${move.seat}:${name}`;
    let row = rows.get(key);
    if (!row) {
      row = { key, name, seat: move.seat, moves: 0, accuracy: 0, acpl: 0, best: 0, blunders: 0, mistakes: 0, inaccuracies: 0, accSum: 0, lossSum: 0 };
      rows.set(key, row);
    }
    const result = analyzed[index];
    if (!result) return;
    row.moves += 1;
    row.accSum += result.accuracy;
    row.lossSum += result.loss;
    if (result.label === 'best') row.best += 1;
    if (result.label === 'blunder') row.blunders += 1;
    if (result.label === 'mistake') row.mistakes += 1;
    if (result.label === 'inaccuracy') row.inaccuracies += 1;
  });
  return [...rows.values()].map(({ accSum, lossSum, ...row }) => ({
    ...row,
    accuracy: row.moves ? Math.round((accSum / row.moves) * 10) / 10 : 0,
    acpl: row.moves ? Math.round(lossSum / row.moves) : 0,
  }));
}

/** Parse Stockfish info lines into a White-relative evaluation. */
export function parseEngineEval(lines: readonly string[], whiteToMove: boolean): Evaluation | null {
  let found = null as Evaluation | null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('bestmove ')) {
      const best = line.split(/\s+/)[1];
      if (found && best && best !== '(none)') found.best = best;
      continue;
    }
    if (!line.startsWith('info ') || line.includes(' currmove ')) continue;
    if (/\bmultipv (\d+)/.test(line) && !/\bmultipv 1\b/.test(line)) continue;
    const depth = Number(line.match(/\bdepth (\d+)/)?.[1] ?? 0);
    const mate = line.match(/\bscore mate (-?\d+)/);
    const cp = line.match(/\bscore cp (-?\d+)/);
    if (!mate && !cp) continue;
    if (found && depth < found.depth) continue;
    const sign = whiteToMove ? 1 : -1;
    const pv = line.match(/\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
    found = {
      cp: cp ? Number(cp[1]) * sign : null,
      mate: mate ? Number(mate[1]) * sign : null,
      best: pv ? pv[1] : (found?.best ?? null),
      depth,
    };
  }
  return found;
}
