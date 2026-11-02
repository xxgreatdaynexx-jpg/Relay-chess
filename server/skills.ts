/**
 * Skills (RuneScape-style): XP per skill, levels 1..99, total level, hiscores.
 * XP is only awarded here, server-side, from real completed actions (hooks in mines/farm/race/factory/rooms/fps and the
 * wallet ledger). Every award goes through per-player per-skill hourly + daily caps so nothing can be spammed.
 * Postgres table player_skills is the source of truth; the upsert adds atomically so several instances never lose XP.
 * XP never moves chips and never touches casino odds or payouts. Levels drive small perks (shared/skillPerks.ts).
 */
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { databaseUrl, type Queryable } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { onArenaMatchEnd } from './fps.js';
import { SKILLS, isSkill, levelFor, totalLevel, titleFor, MAX_XP, type SkillId } from '../shared/skills.js';
import { isQaName } from '../shared/qa.js';

export const SKILLS_MIGRATION = `CREATE TABLE IF NOT EXISTS player_skills (
  player_key TEXT NOT NULL,
  name TEXT NOT NULL,
  skill TEXT NOT NULL,
  xp BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_key, skill)
);
CREATE INDEX IF NOT EXISTS player_skills_skill_xp ON player_skills (skill, xp);`;

/** Anti-farm caps per player per skill (XP). */
export const CAPS: Record<SkillId, { hour: number; day: number }> = {
  mining: { hour: 3000, day: 30000 },
  engineering: { hour: 2000, day: 20000 },
  farming: { hour: 3000, day: 25000 },
  racing: { hour: 2500, day: 20000 },
  combat: { hour: 3000, day: 25000 },
  trading: { hour: 1500, day: 12000 },
  gambling: { hour: 1500, day: 10000 },
  chess: { hour: 1500, day: 10000 },
  fishing: { hour: 2500, day: 20000 },
  property: { hour: 3000, day: 8000 },
  cooking: { hour: 2500, day: 20000 },
};

export const keyOf = (name: string) => name.replace(/\s+/g, ' ').trim().toLowerCase();
export interface XpEvent { name: string; skill: SkillId; gained: number; xp: number; level: number; leveledUp: boolean; total: number }
type Row = { player_key: string; name: string; skill: string; xp: string | number };

export interface SkillStore { init(): Promise<void>; add(key: string, name: string, skill: string, n: number): Promise<number>; all(): Promise<Row[]>; one(key: string): Promise<Row[]> }
export class PgSkillStore implements SkillStore {
  constructor(private db: Queryable) {}
  async init() { await this.db.query(SKILLS_MIGRATION); }
  async add(key: string, name: string, skill: string, n: number) {
    const r = await this.db.query(`INSERT INTO player_skills (player_key, name, skill, xp) VALUES ($1,$2,$3,LEAST($4::bigint, ${MAX_XP}))
      ON CONFLICT (player_key, skill) DO UPDATE SET xp = LEAST(player_skills.xp + EXCLUDED.xp, ${MAX_XP}), name = EXCLUDED.name, updated_at = now() RETURNING xp`, [key, name, skill, n]);
    return Number((r.rows[0] as { xp: string }).xp);
  }
  async all() { return (await this.db.query('SELECT player_key, name, skill, xp FROM player_skills')).rows as Row[]; }
  async one(key: string) { return (await this.db.query('SELECT player_key, name, skill, xp FROM player_skills WHERE player_key = $1', [key])).rows as Row[]; }
}
export class MemorySkillStore implements SkillStore {
  rows = new Map<string, Row>();
  async init() {}
  async add(key: string, name: string, skill: string, n: number) {
    const k = `${key}|${skill}`; const r = this.rows.get(k) ?? { player_key: key, name, skill, xp: 0 };
    r.xp = Math.min(MAX_XP, Number(r.xp) + n); r.name = name; this.rows.set(k, r); return Number(r.xp);
  }
  async all() { return [...this.rows.values()]; }
  async one(key: string) { return [...this.rows.values()].filter((r) => r.player_key === key); }
}

export class Skills {
  private used = new Map<string, { hour: number; h: number; day: string; d: number }>();
  private chain = new Map<string, Promise<unknown>>();
  private board: { at: number; rows: Row[] } | null = null;
  private listeners = new Set<(e: XpEvent) => void>();
  /** Cached XP per player key (for perks). Filled by award/profile/levelOf; stale by at most one award. */
  private xpCache = new Map<string, { at: number; xp: Record<string, number> }>();
  private warming = new Set<string>();
  /** Level right now from cache (1 when unknown); starts a background load so the next call is right. Never throws. */
  levelSync(name: string | null | undefined, skill: SkillId): number {
    if (!name) return 1; const key = keyOf(name); const c = this.xpCache.get(key);
    if (!c || this.clock() - c.at > 300_000) void this.levelOf(name, skill).catch(() => 1);
    return c ? levelFor(c.xp[skill] ?? 0) : 1;
  }
  /** Level from the store (cached 60s). Resolves 1 on any error. */
  async levelOf(name: string | null | undefined, skill: SkillId): Promise<number> {
    if (!name) return 1; const key = keyOf(name); if (!key) return 1;
    const c = this.xpCache.get(key); if (c && this.clock() - c.at < 60_000) return levelFor(c.xp[skill] ?? 0);
    if (this.warming.has(key)) return c ? levelFor(c.xp[skill] ?? 0) : 1;
    this.warming.add(key);
    try { const rows = await this.store.one(key); const xp: Record<string, number> = {}; for (const r of rows) xp[r.skill] = Number(r.xp); this.xpCache.set(key, { at: this.clock(), xp }); return levelFor(xp[skill] ?? 0); }
    catch { return c ? levelFor(c.xp[skill] ?? 0) : 1; } finally { this.warming.delete(key); }
  }
  constructor(readonly store: SkillStore, private clock = () => Date.now()) {}
  onXp(fn: (e: XpEvent) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  /** Clamp to what is left under the caps and reserve it. */
  allowance(key: string, skill: SkillId, n: number): number {
    const now = this.clock(); const hour = Math.floor(now / 3_600_000); const day = new Date(now).toISOString().slice(0, 10);
    const k = `${key}|${skill}`; let u = this.used.get(k);
    if (!u) { u = { hour, h: 0, day, d: 0 }; this.used.set(k, u); }
    if (u.hour !== hour) { u.hour = hour; u.h = 0; }
    if (u.day !== day) { u.day = day; u.d = 0; }
    const cap = CAPS[skill]; const g = Math.max(0, Math.min(n, cap.hour - u.h, cap.day - u.d));
    u.h += g; u.d += g; return g;
  }

  /** Award XP (rounded, capped). Resolves to the event, or null when nothing was awarded. Never throws. */
  async award(name: string | null | undefined, skill: SkillId, amount: number): Promise<XpEvent | null> {
    if (!name || !isSkill(skill) || !Number.isFinite(amount)) return null;
    const n = Math.floor(amount); if (n <= 0) return null;
    const clean = name.replace(/\s+/g, ' ').trim(); const key = keyOf(clean); if (!key) return null;
    const g = this.allowance(key, skill, n); if (!g) return null;
    const ck = `${key}|${skill}`;
    const p = (this.chain.get(ck) ?? Promise.resolve()).then(async () => {
      const xp = await this.store.add(key, clean, skill, g);
      const before = levelFor(xp - g), level = levelFor(xp);
      const mine = await this.store.one(key).catch(() => [] as Row[]);
      const map: Record<string, number> = {}; for (const r of mine) map[r.skill] = Number(r.xp); map[skill] = xp;
      this.xpCache.set(key, { at: this.clock(), xp: { ...map } });
      const e: XpEvent = { name: clean, skill, gained: g, xp, level, leveledUp: level > before, total: totalLevel(map) };
      for (const fn of this.listeners) { try { fn(e); } catch (err) { console.error('[skills] listener', err); } }
      return e;
    }).catch((err) => { console.error('[skills] award failed:', (err as Error).message); return null; });
    this.chain.set(ck, p); void p.finally(() => { if (this.chain.get(ck) === p) this.chain.delete(ck); });
    return p;
  }

  async profile(name: string) {
    const key = keyOf(name); const rows = await this.store.one(key);
    const xp: Record<string, number> = {}; for (const r of rows) xp[r.skill] = Number(r.xp);
    this.xpCache.set(key, { at: this.clock(), xp: { ...xp } });
    const total = totalLevel(xp);
    const all = await this.rows();
    const rank = (sk: string) => { const mine = xp[sk] ?? 0; if (!mine) return null; return 1 + all.filter((r) => r.skill === sk && !isQaName(r.name) && Number(r.xp) > mine).length; };
    return {
      name: rows[0]?.name ?? name.trim(), total, title: titleFor(total),
      totalXp: Object.values(xp).reduce((a, b) => a + b, 0),
      skills: SKILLS.map((s) => ({ id: s.id, xp: xp[s.id] ?? 0, level: levelFor(xp[s.id] ?? 0), rank: rank(s.id) })),
    };
  }
  private async rows() {
    if (this.board && this.clock() - this.board.at < 15_000) return this.board.rows;
    const rows = await this.store.all(); this.board = { at: this.clock(), rows }; return rows;
  }
  /** Top players for one skill, or overall (total level, then total XP). QA- accounts are never shown. */
  async hiscores(skill: string = 'overall', limit = 50) {
    const rows = (await this.rows()).filter((r) => !isQaName(r.name));
    if (skill !== 'overall') {
      if (!isSkill(skill)) return [];
      return rows.filter((r) => r.skill === skill && Number(r.xp) > 0).sort((a, b) => Number(b.xp) - Number(a.xp)).slice(0, limit)
        .map((r, i) => ({ rank: i + 1, name: r.name, level: levelFor(Number(r.xp)), xp: Number(r.xp) }));
    }
    const by = new Map<string, { name: string; xp: Record<string, number> }>();
    for (const r of rows) { const p = by.get(r.player_key) ?? { name: r.name, xp: {} }; p.xp[r.skill] = Number(r.xp); by.set(r.player_key, p); }
    return [...by.values()].map((p) => ({ name: p.name, level: totalLevel(p.xp), xp: Object.values(p.xp).reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.level - a.level || b.xp - a.xp).slice(0, limit).map((r, i) => ({ rank: i + 1, ...r, title: titleFor(r.level) }));
  }
}

let skills: Skills | null = null;
export function setSkills(s: Skills | null) { skills = s; }
export function getSkills(): Skills {
  if (skills) return skills;
  const url = databaseUrl();
  if (!url) return (skills = new Skills(new MemorySkillStore()));
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[skills] pool error:', e.message));
  return (skills = new Skills(new PgSkillStore(pool)));
}
/** Fire-and-forget XP award used by activity hooks. */
/** Perk level helpers (never throw; 1 when unknown). */
export function skillLevel(name: string | null | undefined, skill: SkillId): number { try { return getSkills().levelSync(name, skill); } catch { return 1; } }
export async function skillLevelAsync(name: string | null | undefined, skill: SkillId): Promise<number> { try { return await getSkills().levelOf(name, skill); } catch { return 1; } }
export function awardXp(name: string | null | undefined, skill: SkillId, amount: number): void {
  try { void getSkills().award(name, skill, amount); } catch (e) { console.error('[skills] award', (e as Error).message); }
}

// ---- Ledger-driven skills (no changes to casino/market/property code) ----
export const CASINO_GAMES = new Set(['roulette', 'blackjack', 'slots', 'holdem', 'video-poker', 'casino', 'solitro']);
/** XP for one wallet move, or null when it isn't a skill action. Exported for tests. */
export function ledgerXp(game: string, amount: number, memo?: string): { skill: SkillId; xp: number } | null {
  if (memo === 'reverted' || !amount) return null;
  const a = Math.abs(amount);
  if (CASINO_GAMES.has(game)) return amount < 0 ? { skill: 'gambling', xp: Math.min(50, Math.max(1, Math.round(a / 20))) } : null;
  if (game === 'stocks' || game === 'market' || game === 'trade') return { skill: 'trading', xp: Math.min(60, 5 + Math.round(a / 100)) };
  if (game === 'property_buy' && amount < 0) return { skill: 'property', xp: Math.min(2000, 200 + Math.round(a / 500)) };
  if (game === 'property_tax' && amount < 0) return { skill: 'property', xp: 40 };
  if (game === 'farm_harvest' && amount > 0) return { skill: 'farming', xp: Math.min(400, 10 + Math.round(a / 5)) };
  if (game === 'farm_seed' && amount < 0) return { skill: 'farming', xp: 5 };
  return null;
}

/** Combat XP for one finished arena match row. Exported for tests. */
export function combatXp(p: { kills: number; participationMs: number }, won: boolean): number {
  if (p.participationMs < 30_000 && !p.kills) return 0;
  return Math.min(40, Math.max(0, p.kills)) * 25 + (p.participationMs >= 60_000 ? 50 : 0) + (won ? 150 : 0);
}

let unsubArena: (() => void) | null = null;
let started: Server | null = null; let unsub: (() => void) | null = null; let unsubXp: (() => void) | null = null;
export function startSkills(io: Server): void {
  if (started === io) return;
  unsub?.(); unsubXp?.(); started = io;
  const s = getSkills();
  void s.store.init().catch((e) => console.error('[skills] migration failed:', (e as Error).message));
  const seen = new Set<string>();
  unsub = getBank().onChange((_a, tx) => {
    const r = ledgerXp(tx.game, tx.amount, tx.memo); if (!r) return;
    if (tx.key) { if (seen.has(tx.key)) return; seen.add(tx.key); if (seen.size > 20000) seen.clear(); }
    awardXp(tx.name, r.skill, r.xp);
  });
  unsubArena?.();
  unsubArena = onArenaMatchEnd((r) => {
    const humans = new Set(r.players.flatMap((p) => (p.account ? [keyOf(p.account)] : []))).size; // win bonus needs a real opponent
    for (const p of r.players) if (p.account) awardXp(p.account, 'combat', combatXp(p, humans >= 2 && p.id === r.winnerId));
  });
  unsubXp = s.onXp((e) => io.to(`w:${keyOf(e.name)}`).emit('xp', e));
}

export function registerSkills(_io: Server, socket: Socket): void {
  const reply = (ack: unknown, r: unknown) => { if (typeof ack === 'function') (ack as (x: unknown) => void)(r); };
  socket.on('skills_get', async (p: unknown, ack?: unknown) => {
    try {
      const asked = (p && typeof p === 'object' && typeof (p as { name?: unknown }).name === 'string') ? (p as { name: string }).name.slice(0, 40) : null;
      const name = asked ?? (socket.data.account as { name?: string } | undefined)?.name;
      if (!name) return reply(ack, { ok: false, error: 'Sign in to see your skills.' });
      reply(ack, { ok: true, ...(await getSkills().profile(name)) });
    } catch (e) { reply(ack, { ok: false, error: (e as Error).message }); }
  });
  socket.on('skills_hiscores', async (p: unknown, ack?: unknown) => {
    try {
      const skill = (p && typeof p === 'object' && typeof (p as { skill?: unknown }).skill === 'string') ? (p as { skill: string }).skill : 'overall';
      reply(ack, { ok: true, skill, rows: await getSkills().hiscores(skill) });
    } catch (e) { reply(ack, { ok: false, error: (e as Error).message }); }
  });
}
