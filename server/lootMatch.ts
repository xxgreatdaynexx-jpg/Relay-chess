/**
 * Loot Match scores: personal best + public top board. No chip payouts.
 * Submits are validated with plausibleScore (move count + hard cap).
 */
import express from 'express';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { databaseUrl } from './leaderboard-store.js';
import { bootAttach, setBootState } from './boot-retry.js';
import { playerKey } from './skins.js';
import { isQaName } from '../shared/qa.js';
import { LM_MOVES, LM_SCORE_CAP, plausibleScore } from '../shared/lootMatch.js';

export const LM_MIGRATION = `
CREATE TABLE IF NOT EXISTS loot_match_scores (
  player_key TEXT PRIMARY KEY, name TEXT NOT NULL, best INTEGER NOT NULL DEFAULT 0,
  games INTEGER NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS loot_match_scores_best ON loot_match_scores (best DESC, updated_at ASC);
`;

interface Rec { key: string; name: string; best: number; games: number; updatedAt: number }

class LootMatchHall {
  private recs = new Map<string, Rec>();
  constructor(private readonly pool: pg.Pool | null, private readonly clock = () => Date.now()) {}
  async init() {
    if (!this.pool) return;
    await this.pool.query(LM_MIGRATION);
    const { rows } = await this.pool.query('SELECT player_key, name, best, games, updated_at FROM loot_match_scores');
    for (const r of rows as any[]) this.recs.set(String(r.player_key), {
      key: String(r.player_key), name: String(r.name), best: Number(r.best) || 0, games: Number(r.games) || 0, updatedAt: Number(r.updated_at) || 0,
    });
  }
  private async save(rec: Rec) {
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO loot_match_scores (player_key, name, best, games, updated_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (player_key) DO UPDATE SET name = EXCLUDED.name, best = EXCLUDED.best, games = EXCLUDED.games, updated_at = EXCLUDED.updated_at`,
      [rec.key, rec.name, rec.best, rec.games, rec.updatedAt],
    );
  }
  board(limit = 20) {
    return [...this.recs.values()].filter((r) => r.best > 0 && !isQaName(r.name))
      .sort((a, b) => b.best - a.best || a.updatedAt - b.updatedAt || a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((r) => ({ name: r.name, best: r.best, games: r.games }));
  }
  me(name: string | null) {
    if (!name) return { best: 0, games: 0 };
    const r = this.recs.get(playerKey(name));
    return r ? { best: r.best, games: r.games } : { best: 0, games: 0 };
  }
  async submit(name: string, score: unknown, movesUsed: unknown) {
    const s = Number(score), m = Number(movesUsed);
    if (!plausibleScore(s, m)) throw new Error('Score rejected.');
    const key = playerKey(name);
    let r = this.recs.get(key);
    if (!r) { r = { key, name: name.trim(), best: 0, games: 0, updatedAt: 0 }; this.recs.set(key, r); }
    r.name = name.trim(); r.games += 1; r.updatedAt = this.clock();
    const improved = s > r.best; if (improved) r.best = Math.floor(s);
    await this.save(r);
    return { best: r.best, games: r.games, improved, board: this.board() };
  }
}

let hall: LootMatchHall | null = null;
export const getLootMatch = () => hall;
export async function initLootMatch(): Promise<void> {
  const url = databaseUrl();
  if (!url) { hall = new LootMatchHall(null); setBootState('lootMatch', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[lootMatch] pool error:', e.message));
  await bootAttach('lootMatch', async () => {
    try { const h = new LootMatchHall(pool); await h.init(); hall = h; console.log('[lootMatch] ready'); return true; }
    catch (e) { console.error('[lootMatch] init failed:', (e as Error).message); return false; }
  });
}
export function lootMatchRouter() {
  const r = express.Router();
  r.get('/api/loot-match', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, live: !!hall, moves: LM_MOVES, scoreCap: LM_SCORE_CAP, board: hall?.board() ?? [], me: null });
  });
  return r;
}
type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerLootMatch(_io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  socket.on('loot_match_board', (_p: unknown, ack?: Ack) => {
    const n = nameOf();
    ack?.({ ok: true, board: hall?.board() ?? [], me: hall?.me(n) ?? { best: 0, games: 0 }, moves: LM_MOVES });
  });
  socket.on('loot_match_submit', async (payload: unknown, ack?: Ack) => {
    try {
      const n = nameOf(); if (!n) throw new Error('Sign in to save a score.');
      if (!hall) throw new Error('Loot Match is offline right now.');
      const b = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const out = await hall.submit(n, b.score, b.movesUsed);
      ack?.({ ok: true, ...out });
    } catch (e) { ack?.({ ok: false, error: (e as Error).message || 'Something went wrong.' }); }
  });
}
