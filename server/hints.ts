import { createRequire } from 'node:module';
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
