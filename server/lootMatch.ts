/**
 * Loot Match: personal best + leaderboard + small chip payouts on completed rounds.
 * Server-authoritative: start-round token, min duration, one payout per token, daily Regina cap,
 * plausibleScore gate. No retroactive payouts for rounds started before this ships.
 */
import express from 'express';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { databaseUrl } from './leaderboard-store.js';
import { bootAttach, setBootState } from './boot-retry.js';
import { playerKey } from './skins.js';
import { isQaName } from '../shared/qa.js';
import { getBank } from './casino-store.js';
import {
  LM_CHIP_DAILY_CAP, LM_MIN_ROUND_MS, LM_MOVES, LM_SCORE_CAP, LM_START_GAP_MS,
  lmReginaDay, lootMatchPayout, plausibleScore,
} from '../shared/lootMatch.js';

export const LM_MIGRATION = `
CREATE TABLE IF NOT EXISTS loot_match_scores (
  player_key TEXT PRIMARY KEY, name TEXT NOT NULL, best INTEGER NOT NULL DEFAULT 0,
  games INTEGER NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS loot_match_scores_best ON loot_match_scores (best DESC, updated_at ASC);
CREATE TABLE IF NOT EXISTS loot_match_daily (
  player_key TEXT NOT NULL, day TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_key, day)
);
`;

interface Rec { key: string; name: string; best: number; games: number; updatedAt: number }
interface RoundTok { token: string; key: string; name: string; startedAt: number; used: boolean }

class LootMatchHall {
  private recs = new Map<string, Rec>();
  private daily = new Map<string, number>(); // `${key}|${day}` → paid
  private open = new Map<string, RoundTok>(); // player_key → open token
  private byToken = new Map<string, RoundTok>();
  private lastStart = new Map<string, number>();
  constructor(private readonly pool: pg.Pool | null, private readonly clock = () => Date.now()) {}
  async init() {
    if (!this.pool) return;
    await this.pool.query(LM_MIGRATION);
    const { rows } = await this.pool.query('SELECT player_key, name, best, games, updated_at FROM loot_match_scores');
    for (const r of rows as any[]) this.recs.set(String(r.player_key), {
      key: String(r.player_key), name: String(r.name), best: Number(r.best) || 0, games: Number(r.games) || 0, updatedAt: Number(r.updated_at) || 0,
    });
    const day = lmReginaDay(this.clock());
    const drows = await this.pool.query('SELECT player_key, paid FROM loot_match_daily WHERE day = $1', [day]);
    for (const r of drows.rows as any[]) this.daily.set(`${r.player_key}|${day}`, Number(r.paid) || 0);
  }
  private async saveRec(rec: Rec) {
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO loot_match_scores (player_key, name, best, games, updated_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (player_key) DO UPDATE SET name = EXCLUDED.name, best = EXCLUDED.best, games = EXCLUDED.games, updated_at = EXCLUDED.updated_at`,
      [rec.key, rec.name, rec.best, rec.games, rec.updatedAt],
    );
  }
  private async saveDaily(key: string, day: string, paid: number) {
    this.daily.set(`${key}|${day}`, paid);
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO loot_match_daily (player_key, day, paid) VALUES ($1,$2,$3)
       ON CONFLICT (player_key, day) DO UPDATE SET paid = EXCLUDED.paid`,
      [key, day, paid],
    );
  }
  todayPaid(name: string | null, now = this.clock()) {
    if (!name) return 0;
    return this.daily.get(`${playerKey(name)}|${lmReginaDay(now)}`) ?? 0;
  }
  board(limit = 20) {
    return [...this.recs.values()].filter((r) => r.best > 0 && !isQaName(r.name))
      .sort((a, b) => b.best - a.best || a.updatedAt - b.updatedAt || a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((r) => ({ name: r.name, best: r.best, games: r.games }));
  }
  me(name: string | null, now = this.clock()) {
    if (!name) return { best: 0, games: 0, todayPaid: 0, dailyCap: LM_CHIP_DAILY_CAP };
    const r = this.recs.get(playerKey(name));
    return { best: r?.best ?? 0, games: r?.games ?? 0, todayPaid: this.todayPaid(name, now), dailyCap: LM_CHIP_DAILY_CAP };
  }
  start(name: string) {
    const now = this.clock(); const key = playerKey(name);
    const last = this.lastStart.get(key) ?? 0;
    if (now - last < LM_START_GAP_MS) throw new Error('Slow down — wait a moment before starting another round.');
    // Abandon any unused open token (no payout)
    const prev = this.open.get(key);
    if (prev && !prev.used) this.byToken.delete(prev.token);
    const token = randomUUID().replace(/-/g, '');
    const tok: RoundTok = { token, key, name: name.trim(), startedAt: now, used: false };
    this.open.set(key, tok); this.byToken.set(token, tok); this.lastStart.set(key, now);
    return {
      token, startedAt: now, minMs: LM_MIN_ROUND_MS, moves: LM_MOVES,
      todayPaid: this.todayPaid(name, now), dailyCap: LM_CHIP_DAILY_CAP,
      chipPer: 500, roundMax: 300,
    };
  }
  async submit(name: string, score: unknown, movesUsed: unknown, token: unknown) {
    const s = Number(score), m = Number(movesUsed);
    if (typeof token !== 'string' || !/^[a-f0-9]{16,64}$/i.test(token)) throw new Error('Start a new round first.');
    if (!plausibleScore(s, m)) throw new Error('Score rejected.');
    if (m !== LM_MOVES) throw new Error('Only completed 30-move rounds earn chips.');
    const key = playerKey(name);
    const tok = this.byToken.get(token);
    if (!tok || tok.key !== key) throw new Error('That round token is invalid. Start a new round.');
    if (tok.used) throw new Error('That round was already submitted.');
    const now = this.clock();
    if (now - tok.startedAt < LM_MIN_ROUND_MS) throw new Error('Round finished too quickly — no payout.');
    tok.used = true; this.open.delete(key);

    let r = this.recs.get(key);
    if (!r) { r = { key, name: name.trim(), best: 0, games: 0, updatedAt: 0 }; this.recs.set(key, r); }
    r.name = name.trim(); r.games += 1; r.updatedAt = now;
    const improved = s > r.best; if (improved) r.best = Math.floor(s);
    await this.saveRec(r);

    const day = lmReginaDay(now);
    const already = this.daily.get(`${key}|${day}`) ?? 0;
    const remaining = Math.max(0, LM_CHIP_DAILY_CAP - already);
    const gross = lootMatchPayout(Math.floor(s));
    const paid = Math.min(gross, remaining);
    let chips: number | null = null;
    if (paid > 0) {
      const bank = getBank();
      if (!bank.ready) throw new Error('Wallet is reconnecting. Score saved; try again in a moment for chips.');
      const ok = await bank.transferConfirmed(name, paid, {
        key: `lootmatch:pay:${token}`,
        game: 'loot_match',
        memo: `Loot Match payout · ${Math.floor(s)} pts`,
      });
      if (!ok) {
        // Already paid this token (idempotent) — treat as success with 0 new chips
      } else {
        await this.saveDaily(key, day, already + paid);
        chips = bank.account(name).chips;
      }
    }
    const todayPaid = this.todayPaid(name, now);
    return {
      best: r.best, games: r.games, improved, board: this.board(),
      paid, gross, todayPaid, dailyCap: LM_CHIP_DAILY_CAP, chips,
    };
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
    res.json({
      ok: true, live: !!hall, moves: LM_MOVES, scoreCap: LM_SCORE_CAP,
      dailyCap: LM_CHIP_DAILY_CAP, chipPer: 500, roundMax: 300, minRoundMs: LM_MIN_ROUND_MS,
      board: hall?.board() ?? [], me: null,
    });
  });
  return r;
}
type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerLootMatch(_io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  socket.on('loot_match_board', (_p: unknown, ack?: Ack) => {
    const n = nameOf();
    ack?.({ ok: true, board: hall?.board() ?? [], me: hall?.me(n) ?? { best: 0, games: 0, todayPaid: 0, dailyCap: LM_CHIP_DAILY_CAP }, moves: LM_MOVES });
  });
  socket.on('loot_match_start', (_p: unknown, ack?: Ack) => {
    try {
      const n = nameOf(); if (!n) throw new Error('Sign in to play for chips.');
      if (!hall) throw new Error('Loot Match is offline right now.');
      ack?.({ ok: true, ...hall.start(n) });
    } catch (e) { ack?.({ ok: false, error: (e as Error).message || 'Something went wrong.' }); }
  });
  socket.on('loot_match_submit', async (payload: unknown, ack?: Ack) => {
    try {
      const n = nameOf(); if (!n) throw new Error('Sign in to save a score.');
      if (!hall) throw new Error('Loot Match is offline right now.');
      const b = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const out = await hall.submit(n, b.score, b.movesUsed, b.token);
      ack?.({ ok: true, ...out });
    } catch (e) { ack?.({ ok: false, error: (e as Error).message || 'Something went wrong.' }); }
  });
}
