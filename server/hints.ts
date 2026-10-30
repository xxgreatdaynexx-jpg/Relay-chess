import { createRequire } from 'node:module';
import { Chess } from 'chess.js';
import { parseEngineEval, type Evaluation } from '../shared/analysis.js';
import type { HintArrow } from '../shared/types.js';

const require = createRequire(import.meta.url);

export type HintFinder = (fen: string) => Promise<HintArrow | null>;

const cache = new Map<string, HintArrow | null>();
const pending = new Map<string, Promise<void>>();
let finder: HintFinder = defaultFinder;
let onReady: ((fen: string) => void) | null = null;

export function onHintReady(listener: (fen: string) => void): void {
  onReady = listener;
}

export function setHintFinder(next: HintFinder): void {
  finder = next;
}

export function useDefaultHintFinder(): void {
  finder = defaultFinder;
}

export function resetHintCache(): void {
  cache.clear();
  pending.clear();
}

export function peekHint(fen: string): HintArrow | null | undefined {
  if (!cache.has(fen)) return undefined;
  return cache.get(fen) ?? null;
}

export function requestHint(fen: string): void {
  if (cache.has(fen) || pending.has(fen)) return;
  const job = finder(fen)
    .then((arrow) => {
      cache.set(fen, arrow);
    })
    .catch(() => {
      cache.set(fen, null);
    })
    .finally(() => {
      pending.delete(fen);
      onReady?.(fen);
    });
  pending.set(fen, job);
}

export async function resolveBestMove(
  fen: string,
  cloud: (fen: string) => Promise<HintArrow | null>,
  local: (fen: string) => Promise<HintArrow | null>,
): Promise<HintArrow | null> {
  try {
    const arrow = await cloud(fen);
    if (arrow) return arrow;
  } catch {
    // The public eval missed this position or the request failed.
  }
  try {
    return await local(fen);
  } catch {
    return null;
  }
}

export function arrowFromCloud(body: unknown): HintArrow | null {
  if (!body || typeof body !== 'object') return null;
  const pvs = (body as { pvs?: unknown }).pvs;
  if (!Array.isArray(pvs) || !pvs[0] || typeof pvs[0] !== 'object') return null;
  const moves = (pvs[0] as { moves?: unknown }).moves;
  if (typeof moves !== 'string') return null;
  return arrowFromUci(moves.split(/\s+/)[0] ?? '');
}

export function arrowFromBestmove(line: string): HintArrow | null {
  const match = line.match(/bestmove\s+([a-h][1-8][a-h][1-8])/);
  return match ? arrowFromUci(match[1]) : null;
}

export function arrowFromUci(uci: string): HintArrow | null {
  if (!/^[a-h][1-8][a-h][1-8]/.test(uci)) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
}

async function defaultFinder(fen: string): Promise<HintArrow | null> {
  return resolveBestMove(fen, lichessCloud, stockfishMove);
}

async function lichessCloud(fen: string): Promise<HintArrow | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1600);
  try {
    const response = await fetch(
      `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=1`,
      {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'RelayChess/1.0 (team chess)',
        },
      },
    );
    if (!response.ok) return null;
    return arrowFromCloud(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

interface StockfishEngine {
  postMessage?: (command: string) => void;
  onCustomMessage?: (command: string) => void;
  addMessageListener?: (listener: (line: string) => void) => void;
}

let enginePromise: Promise<StockfishEngine> | null = null;
let engineChain: Promise<unknown> = Promise.resolve();
const listeners = new Set<(line: string) => void>();

function send(engine: StockfishEngine, command: string): void {
  if (typeof engine.onCustomMessage === 'function') engine.onCustomMessage(command);
  else engine.postMessage?.(command);
}

async function getEngine(): Promise<StockfishEngine> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const Stockfish = require('stockfish/src/stockfish-nnue-16-single.js') as () => () => Promise<StockfishEngine>;
      const engine = await Stockfish()();
      engine.addMessageListener?.((line) => {
        const text = String(line);
        for (const listener of listeners) listener(text);
      });
      send(engine, 'uci');
      await waitForLine((line) => line.includes('uciok'), 8000);
      return engine;
    })().catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

function waitForLine(predicate: (line: string) => boolean, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      listeners.delete(onLine);
      reject(new Error('Stockfish timed out'));
    }, timeoutMs);
    const onLine = (line: string) => {
      if (!predicate(line)) return;
      clearTimeout(timer);
      listeners.delete(onLine);
      resolve(line);
    };
    listeners.add(onLine);
  });
}

async function stockfishMove(fen: string): Promise<HintArrow | null> {
  const run = engineChain.then(async () => {
    const engine = await getEngine();
    send(engine, 'ucinewgame');
    send(engine, `position fen ${fen}`);
    const pendingLine = waitForLine((line) => line.startsWith('bestmove '), 4000);
    send(engine, 'go depth 12');
    return arrowFromBestmove(await pendingLine);
  });
  engineChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Score every root move with one short search. MultiPV is restored so the
 * chessgawd best-move search stays a single line.
 */
export async function stockfishSearchLines(
  fen: string,
  multiPv: number,
  bounds: { depth: number; movetime: number },
): Promise<string[]> {
  const width = Math.max(1, Math.min(256, Math.floor(multiPv)));
  const run = engineChain.then(async () => {
    const engine = await getEngine();
    const lines: string[] = [];
    const collect = (line: string) => {
      lines.push(line);
    };
    listeners.add(collect);
    try {
      send(engine, `setoption name MultiPV value ${width}`);
      send(engine, `position fen ${fen}`);
      const pending = waitForLine((line) => line.startsWith('bestmove '), bounds.movetime + 700);
      send(engine, `go depth ${bounds.depth} movetime ${bounds.movetime}`);
      try {
        await pending;
      } catch {
        send(engine, 'stop');
        await waitForLine((line) => line.startsWith('bestmove '), 400).catch(() => undefined);
      }
      return lines;
    } finally {
      listeners.delete(collect);
      send(engine, 'setoption name MultiPV value 1');
    }
  });
  engineChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const analysisCache = new Map<string, Evaluation | null>();
const ANALYSIS_CACHE_MAX = 5000;
export const ANALYSIS_DEPTH = 12;
export const ANALYSIS_MOVETIME_MS = 300;

/** One post-game position: eval from White's side plus the best move. Cached by FEN. */
export async function analyzePosition(fen: string): Promise<Evaluation | null> {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  const key = chess.fen();
  if (analysisCache.has(key)) return analysisCache.get(key) ?? null;
  let result: Evaluation | null;
  if (chess.isCheckmate()) {
    // The side to move is mated.
    result = { cp: null, mate: chess.turn() === 'w' ? -1 : 1, best: null, depth: 0 };
  } else if (chess.isDraw() || chess.isStalemate()) {
    result = { cp: 0, mate: null, best: null, depth: 0 };
  } else if (process.env.VITEST) {
    result = null;
  } else {
    const lines = await stockfishSearchLines(key, 1, { depth: ANALYSIS_DEPTH, movetime: ANALYSIS_MOVETIME_MS });
    result = parseEngineEval(lines, chess.turn() === 'w');
  }
  if (analysisCache.size >= ANALYSIS_CACHE_MAX) {
    const first = analysisCache.keys().next().value;
    if (first !== undefined) analysisCache.delete(first);
  }
  if (result) analysisCache.set(key, result);
  return result;
}
