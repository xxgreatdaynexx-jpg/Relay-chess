/** Name accounts: a name can be claimed with a password; using a claimed name needs that password or a session. */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';
import { databaseUrl, type Queryable } from './leaderboard-store.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

export const MIN_PASSWORD = 4;
export const MAX_PASSWORD = 200;
export const SESSION_DAYS = 90;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function nameKey(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Guest-style names are reserved for anonymous Arena players and can never be claimed. */
export const isGuestName = (name: string) => /^guest/i.test(name.trim());
/** House bot names ("Bot 650 · Rook") can never be claimed. */
export const isBotName = (name: string) => /^bot(?![a-z])/i.test(name.trim());

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export interface AccountRow { key: string; name: string; passwordHash: string }
export interface AccountStore {
  init(): Promise<void>;
  get(key: string): Promise<AccountRow | null>;
  /** Inserts; false when the key is already taken. */
  create(row: AccountRow): Promise<boolean>;
  remove(key: string): Promise<boolean>;
  addSession(hash: string, key: string, expiresAt: number): Promise<void>;
  getSession(hash: string): Promise<{ key: string; expiresAt: number } | null>;
  removeSession(hash: string): Promise<void>;
  setPassword(key: string, passwordHash: string): Promise<void>;
  getSettings(key: string): Promise<unknown | null>;
  setSettings(key: string, data: unknown): Promise<void>;
}

export const ACCOUNTS_MIGRATION = [
  `CREATE TABLE IF NOT EXISTS players (
    player_key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS player_sessions (
    token_hash TEXT PRIMARY KEY,
    player_key TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // Additive: per-account preferences (JSON text, validated by shared/settings before it is written).
  `CREATE TABLE IF NOT EXISTS player_settings (
    player_key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
];

export class PgAccountStore implements AccountStore {
  constructor(private readonly db: Queryable) {
    db.on?.('error', (err) => console.error('[accounts] postgres pool error:', err.message));
  }
  async init() {
    for (const sql of ACCOUNTS_MIGRATION) await this.db.query(sql);
  }
  async get(key: string) {
    const { rows } = await this.db.query('SELECT player_key, name, password_hash FROM players WHERE player_key = $1', [key]);
    const r = rows[0];
    return r ? { key: String(r.player_key), name: String(r.name), passwordHash: String(r.password_hash) } : null;
  }
  async create(row: AccountRow) {
    const res = await this.db.query('INSERT INTO players (player_key, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (player_key) DO NOTHING RETURNING player_key', [row.key, row.name, row.passwordHash]);
    return res.rows.length > 0;
  }
  async remove(key: string) {
    await this.db.query('DELETE FROM player_sessions WHERE player_key = $1', [key]);
    await this.db.query('DELETE FROM player_settings WHERE player_key = $1', [key]);
    const res = await this.db.query('DELETE FROM players WHERE player_key = $1 RETURNING player_key', [key]);
    return res.rows.length > 0;
  }
  async addSession(hash: string, key: string, expiresAt: number) {
    await this.db.query('INSERT INTO player_sessions (token_hash, player_key, expires_at) VALUES ($1, $2, $3)', [hash, key, new Date(expiresAt).toISOString()]);
  }
  async getSession(hash: string) {
    const { rows } = await this.db.query('SELECT player_key, expires_at FROM player_sessions WHERE token_hash = $1', [hash]);
    const r = rows[0];
    return r ? { key: String(r.player_key), expiresAt: new Date(r.expires_at as string).getTime() } : null;
  }
  async removeSession(hash: string) {
    await this.db.query('DELETE FROM player_sessions WHERE token_hash = $1', [hash]);
  }
  async setPassword(key: string, passwordHash: string) {
    await this.db.query('UPDATE players SET password_hash = $2 WHERE player_key = $1', [key, passwordHash]);
  }
  async getSettings(key: string) {
    const { rows } = await this.db.query('SELECT data FROM player_settings WHERE player_key = $1', [key]);
    if (!rows[0]) return null;
    try { return JSON.parse(String(rows[0].data)) as unknown; } catch { return null; }
  }
  async setSettings(key: string, data: unknown) {
    const json = JSON.stringify(data);
    const res = await this.db.query('UPDATE player_settings SET data = $2, updated_at = now() WHERE player_key = $1 RETURNING player_key', [key, json]);
    if (!res.rows.length) await this.db.query('INSERT INTO player_settings (player_key, data) VALUES ($1, $2) ON CONFLICT (player_key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()', [key, json]);
  }
}

export class MemoryAccountStore implements AccountStore {
  accounts = new Map<string, AccountRow>();
  sessions = new Map<string, { key: string; expiresAt: number }>();
  async init() {}
  async get(key: string) { return this.accounts.get(key) ?? null; }
  async create(row: AccountRow) {
    if (this.accounts.has(row.key)) return false;
    this.accounts.set(row.key, row);
    return true;
  }
  async remove(key: string) {
    for (const [h, s] of this.sessions) if (s.key === key) this.sessions.delete(h);
    return this.accounts.delete(key);
  }
  async addSession(hash: string, key: string, expiresAt: number) { this.sessions.set(hash, { key, expiresAt }); }
  async getSession(hash: string) { return this.sessions.get(hash) ?? null; }
  async removeSession(hash: string) { this.sessions.delete(hash); }
  settings = new Map<string, string>();
  async setPassword(key: string, passwordHash: string) {
    const row = this.accounts.get(key);
    if (row) this.accounts.set(key, { ...row, passwordHash });
  }
  async getSettings(key: string) { const v = this.settings.get(key); return v ? (JSON.parse(v) as unknown) : null; }
  async setSettings(key: string, data: unknown) { this.settings.set(key, JSON.stringify(data)); }
}

/** Sliding-window limiter with exponential lockout after repeated bursts. */
export class RateLimiter {
  private hits = new Map<string, { times: number[]; lockedUntil: number; strikes: number }>();
  constructor(private readonly max = 5, private readonly windowMs = 60_000, private readonly baseLockMs = 60_000) {}
  /** Seconds to wait, or 0 when allowed. */
  blocked(id: string, now: number): number {
    const h = this.hits.get(id);
    if (!h) return 0;
    if (h.lockedUntil > now) return Math.ceil((h.lockedUntil - now) / 1000);
    return 0;
  }
  fail(id: string, now: number): void {
    const h = this.hits.get(id) ?? { times: [], lockedUntil: 0, strikes: 0 };
    h.times = h.times.filter((t) => now - t < this.windowMs);
    h.times.push(now);
    if (h.times.length >= this.max) {
      h.strikes += 1;
      h.lockedUntil = now + this.baseLockMs * 2 ** (h.strikes - 1);
      h.times = [];
    }
    this.hits.set(id, h);
  }
  clear(id: string): void {
    this.hits.delete(id);
  }
}

export class AuthError extends Error {}
export interface Identity { key: string; name: string }

export class Accounts {
  readonly ipLimiter = new RateLimiter(10, 60_000, 60_000);
  readonly nameLimiter = new RateLimiter(5, 60_000, 60_000);
  constructor(readonly store: AccountStore) {}

  async status(name: string): Promise<{ claimed: boolean; reserved: boolean }> {
    if (isGuestName(name) || isBotName(name)) return { claimed: false, reserved: true };
    return { claimed: !!(await this.store.get(nameKey(name))), reserved: false };
  }

  private check(ip: string, key: string, now: number) {
    const wait = Math.max(this.ipLimiter.blocked(ip, now), this.nameLimiter.blocked(key, now));
    if (wait) throw new AuthError(`Too many tries. Wait ${wait} seconds and try again.`);
  }

  private async issue(key: string, now: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.store.addSession(tokenHash(token), key, now + SESSION_DAYS * 86_400_000);
    return token;
  }

  async claim(name: string, password: string, ip: string, now = Date.now()): Promise<{ identity: Identity; token: string }> {
    const key = nameKey(name);
    if (isGuestName(name)) throw new AuthError('Names starting with "Guest" are reserved. Pick another.');
    if (isBotName(name)) throw new AuthError('Names starting with "Bot" are reserved for house bots. Pick another.');
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) throw new AuthError(`Password must be at least ${MIN_PASSWORD} characters.`);
    if (password.length > MAX_PASSWORD) throw new AuthError('That password is too long.');
    this.check(ip, key, now);
    const ok = await this.store.create({ key, name: name.trim(), passwordHash: await hashPassword(password) });
    if (!ok) throw new AuthError('That name is already taken. Sign in with its password, or pick another name.');
    return { identity: { key, name: name.trim() }, token: await this.issue(key, now) };
  }

  async login(name: string, password: string, ip: string, now = Date.now()): Promise<{ identity: Identity; token: string }> {
    const key = nameKey(name);
    this.check(ip, key, now);
    const row = await this.store.get(key);
    if (!row) throw new AuthError('No one has claimed that name yet. Set a password to claim it.');
    if (typeof password !== 'string' || password.length > MAX_PASSWORD || !(await verifyPassword(password, row.passwordHash))) {
      this.ipLimiter.fail(ip, now);
      this.nameLimiter.fail(key, now);
      throw new AuthError('Wrong password for that name.');
    }
    this.nameLimiter.clear(key);
    return { identity: { key, name: row.name }, token: await this.issue(key, now) };
  }

  async resume(token: unknown, now = Date.now()): Promise<Identity | null> {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
    const s = await this.store.getSession(tokenHash(token));
    if (!s) return null;
    if (s.expiresAt <= now) {
      await this.store.removeSession(tokenHash(token));
      return null;
    }
    const row = await this.store.get(s.key);
    return row ? { key: row.key, name: row.name } : null;
  }

  /** Needs the current password; rate-limited like sign-in. */
  async changePassword(key: string, current: unknown, next: unknown, ip: string, now = Date.now()): Promise<void> {
    this.check(ip, key, now);
    const row = await this.store.get(key);
    if (!row) throw new AuthError('Sign in first.');
    if (typeof current !== 'string' || current.length > MAX_PASSWORD || !(await verifyPassword(current, row.passwordHash))) {
      this.ipLimiter.fail(ip, now);
      this.nameLimiter.fail(key, now);
      throw new AuthError('Your current password is wrong.');
    }
    if (typeof next !== 'string' || next.length < MIN_PASSWORD) throw new AuthError(`New password must be at least ${MIN_PASSWORD} characters.`);
    if (next.length > MAX_PASSWORD) throw new AuthError('That password is too long.');
    await this.store.setPassword(key, await hashPassword(next));
  }

  async logout(token: unknown): Promise<void> {
    if (typeof token === 'string' && token) await this.store.removeSession(tokenHash(token));
  }
}

let current = new Accounts(new MemoryAccountStore());
export const getAccounts = () => current;
export function resetAccounts(store: AccountStore = new MemoryAccountStore()): Accounts {
  current = new Accounts(store);
  return current;
}

export function createPgAccountStore(url: string): PgAccountStore {
  return new PgAccountStore(new pg.Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 10_000 }));
}

export async function initAccountStorage(): Promise<void> {
  const url = databaseUrl();
  if (!url) {
    console.warn('[accounts] no DATABASE_URL set; name accounts are in-memory only');
    return;
  }
  const store = createPgAccountStore(url);
  try {
    await store.init();
    current = new Accounts(store);
    console.log('[accounts] connected to postgres');
  } catch (err) {
    console.error('[accounts] postgres unavailable, accounts are in-memory only:', (err as Error).message);
  }
}
