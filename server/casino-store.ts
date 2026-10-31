import pg from 'pg';
import { databaseUrl, type Queryable } from './leaderboard-store.js';

/** One play-money casino account (blackjack + roulette), keyed by normalized saved name. */
export interface CasinoAccount {
  key: string;
  name: string;
  chips: number;
  hands: number;
  spins: number;
  netWon: number;
  biggestWin: number;
}

/** One chip movement in the unified wallet. `key` makes game payouts idempotent (null for casino hands/spins). */
export interface WalletTx {
  key: string | null;
  name: string;
  game: string;
  amount: number;
  balance: number;
  memo?: string;
  at: number;
}

/** Per-write stat increments that ride along with a chip delta. */
export interface StatDelta { hands?: number; spins?: number; netWon?: number; biggestWin?: number }

/** Result of one atomic write: the DB balance after it, or why the DB refused it. */
export type ApplyResult = { ok: true; chips: number } | { ok: false; reason: 'funds' | 'duplicate'; chips: number };

export interface CasinoStore {
  init(): Promise<void>;
  loadAll(): Promise<CasinoAccount[]>;
  /** Atomically add tx.amount (+ stats) to the DB row and insert the ledger row with balance = the DB value after. */
  apply(tx: WalletTx, playerKey: string, stats?: StatDelta): Promise<ApplyResult>;
  /** Current DB balance (null when the player has no row yet). */
  chipsOf(playerKey: string): Promise<number | null>;
  loadKeys?(): Promise<string[]>;
  recent?(playerKey: string, limit: number): Promise<WalletTx[]>;
}

/** Separate table; the chess `leaderboard` table is never touched. */
export const CASINO_MIGRATION = `CREATE TABLE IF NOT EXISTS casino_players (
  player_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  chips BIGINT NOT NULL DEFAULT 1000,
  hands INTEGER NOT NULL DEFAULT 0,
  spins INTEGER NOT NULL DEFAULT 0,
  net_won BIGINT NOT NULL DEFAULT 0,
  biggest_win BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

/** Unified wallet ledger: every chip movement for every game. tx_key is unique so payouts never double. */
export const WALLET_MIGRATION = `CREATE TABLE IF NOT EXISTS wallet_transactions (
  id BIGSERIAL PRIMARY KEY,
  tx_key TEXT UNIQUE,
  player_key TEXT NOT NULL,
  name TEXT NOT NULL,
  game TEXT NOT NULL,
  amount BIGINT NOT NULL,
  balance BIGINT NOT NULL,
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_tx_player ON wallet_transactions (player_key, id DESC)`;

const isUniqueViolation = (e: unknown) => (e as { code?: string }).code === '23505' || /duplicate key|unique/i.test((e as Error).message ?? '');

/** SQL fragments shared by the single-write path and transferAtomic (caller's transaction). */
const ENSURE_ROW = `INSERT INTO casino_players (player_key, name, chips) VALUES ($1,$2,$3) ON CONFLICT (player_key) DO UPDATE SET name = EXCLUDED.name`;
const LEDGER_INSERT = 'INSERT INTO wallet_transactions (tx_key, player_key, name, game, amount, balance, memo) VALUES ($1,$2,$3,$4,$5,$6,$7)';

export class PgCasinoStore implements CasinoStore {
  constructor(private readonly db: Queryable) {
    db.on?.('error', (err) => console.error('[casino] postgres pool error:', err.message));
  }
  async init(): Promise<void> {
    await this.db.query(CASINO_MIGRATION);
    await this.db.query(WALLET_MIGRATION);
    // Belt and braces for the WHERE guard: a CHECK constraint, but only when no row is already negative.
    try {
      const { rows } = await this.db.query('SELECT count(*) AS n FROM casino_players WHERE chips < 0');
      if (Number(rows[0]?.n) > 0) console.warn(`[casino] ${rows[0]?.n} negative balance row(s); skipping chips >= 0 constraint`);
      else await this.db.query('ALTER TABLE casino_players ADD CONSTRAINT casino_chips_nonneg CHECK (chips >= 0)');
    } catch (e) {
      if (!/already exists/i.test((e as Error).message ?? '')) console.warn('[casino] chips constraint not added:', (e as Error).message);
    }
  }
  /**
   * One chip movement, all in ONE transaction: ensure the row, `chips = chips + delta` guarded by `chips + delta >= 0`,
   * then the ledger row with balance = the RETURNING value. Never writes an absolute balance from memory.
   */
  async apply(tx: WalletTx, playerKey: string, stats: StatDelta = {}): Promise<ApplyResult> {
    const pool = this.db as Queryable & { connect?: () => Promise<Queryable & { release: () => void }> };
    const c = pool.connect ? await pool.connect() : null;
    const q = (sql: string, args: unknown[]) => (c ?? this.db).query(sql, args);
    try {
      if (c) await c.query('BEGIN');
      await q(ENSURE_ROW, [playerKey, tx.name, START_CHIPS]);
      // Key already used (e.g. by another instance)? No-op. The UNIQUE index below is the race-proof backstop.
      if (tx.key && (await q('SELECT 1 FROM wallet_transactions WHERE tx_key = $1', [tx.key])).rows.length) {
        if (c) await c.query('ROLLBACK');
        return { ok: false, reason: 'duplicate', chips: (await this.chipsOf(playerKey)) ?? START_CHIPS };
      }
      const bw = Math.max(0, stats.biggestWin ?? 0);
      const upd = await q(`UPDATE casino_players SET chips = chips + $2, hands = hands + $3, spins = spins + $4, net_won = net_won + $5,
          biggest_win = CASE WHEN biggest_win < $6 THEN $6 ELSE biggest_win END, updated_at = now()
        WHERE player_key = $1 AND chips + $2 >= 0 RETURNING chips`,
        [playerKey, tx.amount, stats.hands ?? 0, stats.spins ?? 0, stats.netWon ?? 0, bw]);
      if (!upd.rows.length) {
        if (c) await c.query('ROLLBACK');
        return { ok: false, reason: 'funds', chips: (await this.chipsOf(playerKey)) ?? START_CHIPS };
      }
      const chips = Number(upd.rows[0].chips);
      if (tx.amount !== 0 || tx.key) {
        try {
          await q(LEDGER_INSERT, [tx.key, playerKey, tx.name, tx.game, tx.amount, chips, tx.memo ?? null]);
        } catch (e) {
          if (!isUniqueViolation(e)) throw e;
          if (c) await c.query('ROLLBACK');
          return { ok: false, reason: 'duplicate', chips: (await this.chipsOf(playerKey)) ?? START_CHIPS };
        }
      }
      if (c) await c.query('COMMIT');
      return { ok: true, chips };
    } catch (error) {
      if (c) await c.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      c?.release();
    }
  }
  async chipsOf(playerKey: string): Promise<number | null> {
    const { rows } = await this.db.query('SELECT chips FROM casino_players WHERE player_key = $1', [playerKey]);
    return rows.length ? Number(rows[0].chips) : null;
  }
  async loadKeys(): Promise<string[]> {
    const { rows } = await this.db.query('SELECT tx_key FROM wallet_transactions WHERE tx_key IS NOT NULL');
    return rows.map((r) => String(r.tx_key));
  }
  async recent(playerKey: string, limit: number): Promise<WalletTx[]> {
    const { rows } = await this.db.query(
      'SELECT tx_key, name, game, amount, balance, memo, created_at FROM wallet_transactions WHERE player_key = $1 ORDER BY id DESC LIMIT $2',
      [playerKey, limit],
    );
    return rows.map((r) => ({ key: r.tx_key ?? null, name: String(r.name), game: String(r.game), amount: Number(r.amount), balance: Number(r.balance), ...(r.memo ? { memo: String(r.memo) } : {}), at: new Date(r.created_at).getTime() }));
  }
  /** Read-only snapshot for the in-memory cache (leaderboard). Nothing is ever written back from it. */
  async loadAll(): Promise<CasinoAccount[]> {
    const { rows } = await this.db.query('SELECT player_key, name, chips, hands, spins, net_won, biggest_win FROM casino_players');
    return rows.map((r) => ({
      key: String(r.player_key),
      name: String(r.name),
      chips: Number(r.chips) || 0,
      hands: Number(r.hands) || 0,
      spins: Number(r.spins) || 0,
      netWon: Number(r.net_won) || 0,
      biggestWin: Number(r.biggest_win) || 0,
    }));
  }
}

export const START_CHIPS = 1000;

function keyOf(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Server-side chip bank and unified wallet for every game. POSTGRES IS THE SOURCE OF TRUTH: every change is an atomic
 * `chips = chips + delta` (guarded >= 0) in the same transaction as its ledger row, so overlapping instances (deploys)
 * can never overwrite each other. Memory is a cache: it answers synchronously for game flow, and is re-synced from
 * RETURNING after every write and from the DB on wallet reads (`refresh`).
 */
export const WALLET_UNAVAILABLE = 'Wallet temporarily unavailable.';
export class WalletUnavailable extends Error { constructor() { super(WALLET_UNAVAILABLE); this.name = 'WalletUnavailable'; } }

export class CasinoBank {
  private accounts = new Map<string, CasinoAccount>();
  private store: CasinoStore | null = null;
  private pending = new Map<string, Promise<void>>();
  /** Sum of this instance's deltas per account that are not yet committed (cache = DB + inflight). */
  private inflight = new Map<string, number>();
  private keys = new Set<string>();
  private recentTx = new Map<string, WalletTx[]>();
  private listeners = new Set<(a: CasinoAccount, tx: WalletTx) => void>();
  /** Backoff between retries of a write that failed for infrastructure reasons (tests shorten it). */
  retryMs = [250, 500, 1000, 2000];

  /**
   * Chip DB state. 'memory' only for dev/tests with no DATABASE_URL (never in production). While 'connecting' or 'down',
   * every chip-moving call throws WALLET_UNAVAILABLE and balances are not served: chips never run in-memory-only.
   */
  status: 'memory' | 'connecting' | 'down' | 'ok' = 'memory';
  lastError: string | null = null;
  get ready(): boolean { return this.status === 'ok' || this.status === 'memory'; }
  private guard(): void { if (!this.ready) throw new WalletUnavailable(); }

  async attach(store: CasinoStore): Promise<boolean> {
    try {
      await store.init();
      const accounts = await store.loadAll();
      const keys = (await store.loadKeys?.()) ?? [];
      this.accounts.clear(); this.keys.clear(); this.recentTx.clear();
      for (const a of accounts) this.accounts.set(a.key, a);
      for (const k of keys) this.keys.add(k);
      this.store = store;
      this.status = 'ok'; this.lastError = null;
      return true;
    } catch (err) {
      this.lastError = (err as Error).message;
      console.error('[casino] chip DB connect failed (wallet refusing chip actions until connected):', this.lastError);
      return false;
    }
  }

  /** Mark the bank as needing a DB (production): refuses chip actions until connectUntilReady succeeds. */
  requireDb(): void { if (this.status !== 'ok') this.status = 'connecting'; }

  /** Boot connect: retry with backoff (capped) until it attaches. Resolves true when connected; never gives up. */
  async connectUntilReady(store: CasinoStore, backoffMs = [500, 1000, 2000, 5000, 10_000, 15_000, 30_000], sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<boolean> {
    this.requireDb();
    for (let i = 0; ; i++) {
      if (await this.attach(store)) return true;
      await sleep(backoffMs[Math.min(i, backoffMs.length - 1)]);
    }
  }

  account(name: string): CasinoAccount {
    const key = keyOf(name);
    let a = this.accounts.get(key);
    if (!a) {
      a = { key, name: name.trim(), chips: START_CHIPS, hands: 0, spins: 0, netWon: 0, biggestWin: 0 };
      this.accounts.set(key, a);
    } else if (a.name !== name.trim()) {
      a.name = name.trim();
    }
    return a;
  }

  /** Re-read the balance from Postgres (login / join / wallet read). Returns the fresh cached balance. */
  async refresh(name: string): Promise<number> {
    this.guard();
    const a = this.account(name);
    if (!this.store) return a.chips;
    await this.pending.get(a.key);
    try {
      const db = await this.store.chipsOf(a.key);
      if (db !== null) a.chips = db + (this.inflight.get(a.key) ?? 0);
    } catch (err) { console.error('[casino] refresh failed:', (err as Error).message); }
    return a.chips;
  }

  /** Called after every balance change (wallet push). */
  onChange(fn: (a: CasinoAccount, tx: WalletTx) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** True once a keyed transaction has been applied (in this run or, via Postgres, before a restart). */
  hasKey(key: string): boolean {
    return this.keys.has(key);
  }

  canAfford(name: string, amount: number): boolean {
    if (!this.ready) return false;
    return this.account(name).chips >= amount;
  }

  /**
   * Move chips for a game (wager stake, payout, refund, buy-in). Negative = debit, never below zero.
   * With a key it is idempotent: a repeat (reconnect, retry, restart) is a no-op and returns false.
   */
  transfer(name: string, amount: number, opts: { key?: string; game: string; memo?: string }): boolean {
    this.guard();
    if (!Number.isInteger(amount)) throw new Error('Bad amount.');
    if (opts.key && this.keys.has(opts.key)) return false;
    const a = this.account(name);
    if (amount < 0 && a.chips + amount < 0) throw new Error('Not enough chips.');
    a.chips += amount;
    if (opts.key) this.keys.add(opts.key);
    this.log(a, amount, opts.game, opts.key ?? null, opts.memo);
    return true;
  }

  /**
   * Several keyed transfers that must land in Postgres inside the CALLER's transaction (e.g. a market buy with item rows).
   * All-or-nothing in memory (validates every move first). Returns SQL rows that do atomic increments (the ledger insert
   * fails — aborting the caller's transaction — if a balance would go negative or a key was already used), a promise for
   * the accounts' earlier queued writes, `bind(p)` so later writes queue behind the caller's transaction (the cache is
   * re-read from the DB once it commits), and `revert()` for when it never committed.
   */
  transferAtomic(moves: Array<{ name: string; amount: number; key: string; game: string; memo?: string }>): { stmts: Array<{ sql: string; args: unknown[] }>; after: Promise<unknown>; bind: (p: Promise<unknown>) => void; revert: () => void } {
    this.guard();
    const need = new Map<string, number>();
    for (const m of moves) {
      if (!Number.isInteger(m.amount) || !m.key) throw new Error('Bad amount.');
      if (this.keys.has(m.key)) throw new Error('Already applied.');
      const a = this.account(m.name); need.set(a.key, (need.get(a.key) ?? a.chips) + m.amount);
      if (need.get(a.key)! < 0) throw new Error('Not enough chips.');
    }
    const stmts: Array<{ sql: string; args: unknown[] }> = []; const touched = new Map<string, CasinoAccount>(); const done: Array<{ a: CasinoAccount; m: (typeof moves)[number]; tx: WalletTx }> = [];
    for (const m of moves) {
      const a = this.account(m.name); a.chips += m.amount; this.keys.add(m.key); touched.set(a.key, a);
      this.inflight.set(a.key, (this.inflight.get(a.key) ?? 0) + m.amount);
      const tx = this.log(a, m.amount, m.game, m.key, m.memo, true); done.push({ a, m, tx });
      stmts.push({ sql: ENSURE_ROW, args: [a.key, a.name, START_CHIPS] });
      stmts.push({ sql: 'UPDATE casino_players SET chips = chips + $2, updated_at = now() WHERE player_key = $1', args: [a.key, m.amount] });
      // balance is NOT NULL: a negative result yields NULL here and aborts the whole transaction (as does a reused tx_key).
      stmts.push({ sql: `INSERT INTO wallet_transactions (tx_key, player_key, name, game, amount, balance, memo)
        VALUES ($1,$2,$3,$4,$5,(SELECT CASE WHEN chips >= 0 THEN chips ELSE NULL END FROM casino_players WHERE player_key = $2),$6)`, args: [m.key, a.key, a.name, m.game, m.amount, m.memo ?? null] });
    }
    const keys = [...touched.keys()];
    const after = Promise.all(keys.map((k) => this.pending.get(k) ?? Promise.resolve()));
    let settled = false;
    const release = () => { if (settled) return false; settled = true; for (const { a, m } of done) this.inflight.set(a.key, (this.inflight.get(a.key) ?? 0) - m.amount); return true; };
    const bind = (p: Promise<unknown>) => {
      const q = p.then(async () => {
        if (!release()) return;
        for (const a of touched.values()) {
          try { const db = await this.store?.chipsOf(a.key); if (db != null) a.chips = db + (this.inflight.get(a.key) ?? 0); } catch { /* keep cache */ }
        }
      }, () => {});
      for (const k of keys) { this.pending.set(k, q); void q.then(() => { if (this.pending.get(k) === q) this.pending.delete(k); }); }
    };
    /** Undo the in-memory side when the caller's transaction never committed (nothing reached the DB). */
    let reverted = false;
    const revert = () => {
      if (reverted) return; reverted = true; release();
      for (const { a, m, tx } of done.reverse()) {
        a.chips -= m.amount; this.keys.delete(m.key);
        const list = this.recentTx.get(a.key); if (list) { const i = list.indexOf(tx); if (i >= 0) list.splice(i, 1); }
        const note: WalletTx = { key: null, name: a.name, game: m.game, amount: -m.amount, balance: a.chips, memo: 'reverted', at: Date.now() };
        this.emit(a, note);
      }
    };
    if (!this.store) release();
    return { stmts: this.store ? stmts : [], after, bind, revert };
  }

  /** Take a stake. Throws when short. */
  debit(name: string, amount: number, game = 'casino'): void {
    this.guard();
    const a = this.account(name);
    if (!Number.isInteger(amount) || amount <= 0) throw new Error('Bad amount.');
    if (amount > a.chips) throw new Error('Not enough chips.');
    a.chips -= amount;
    this.log(a, -amount, game);
  }

  /** Settle one blackjack hand or roulette spin: `returned` chips come back, `net` is the result vs. stake. */
  settle(name: string, returned: number, net: number, kind: 'hand' | 'spin', game = 'casino'): void {
    this.guard();
    const a = this.account(name);
    a.chips += returned;
    a.netWon += net;
    if (net > a.biggestWin) a.biggestWin = net;
    if (kind === 'hand') a.hands += 1;
    else a.spins += 1;
    this.log(a, returned, game, null, undefined, false, { hands: kind === 'hand' ? 1 : 0, spins: kind === 'spin' ? 1 : 0, netWon: net, biggestWin: net });
  }

  /** Refund a stake that never played (e.g. bet withdrawn). A compensating +amount increment. */
  refund(name: string, amount: number, game = 'casino'): void {
    this.guard();
    const a = this.account(name);
    a.chips += amount;
    this.log(a, amount, game, null, 'refund');
  }

  /** Newest first. Memory for this run, else the Postgres ledger. */
  async recent(name: string, limit = 25): Promise<WalletTx[]> {
    this.guard();
    const key = keyOf(name);
    if (this.store?.recent) {
      await this.pending.get(key);
      try { return await this.store.recent(key, limit); } catch { /* fall back */ }
    }
    return (this.recentTx.get(key) ?? []).slice(0, limit);
  }

  standings(limit = 50): CasinoAccount[] {
    if (!this.ready) return [];
    return [...this.accounts.values()]
      .filter((a) => a.hands + a.spins > 0 || a.chips !== START_CHIPS)
      .sort((x, y) => y.chips - x.chips || y.netWon - x.netWon || x.name.localeCompare(y.name))
      .slice(0, limit)
      .map((a) => ({ ...a }));
  }

  /** Resolves once every queued write has landed (tests / shutdown). */
  async flush(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending.values()]);
  }

  private emit(a: CasinoAccount, tx: WalletTx): void {
    for (const fn of this.listeners) {
      try { fn({ ...a }, tx); } catch (err) { console.error('[wallet] listener failed:', (err as Error).message); }
    }
  }

  private log(a: CasinoAccount, amount: number, game: string, key: string | null = null, memo?: string, deferPersist = false, stats?: StatDelta): WalletTx {
    const tx: WalletTx = { key, name: a.name, game, amount, balance: a.chips, ...(memo ? { memo } : {}), at: Date.now() };
    if (amount !== 0 || key) {
      const list = this.recentTx.get(a.key) ?? [];
      list.unshift(tx);
      if (list.length > 50) list.length = 50;
      this.recentTx.set(a.key, list);
    }
    if (!deferPersist) this.persist(a, tx, stats);
    this.emit(a, tx);
    return tx;
  }

  /** Queue the atomic DB write; afterwards the cache = DB value (RETURNING) + this instance's still-queued deltas. */
  private persist(a: CasinoAccount, tx: WalletTx, stats?: StatDelta): void {
    if (!this.store) return;
    const store = this.store;
    this.inflight.set(a.key, (this.inflight.get(a.key) ?? 0) + tx.amount);
    const run = async () => {
      let res: ApplyResult | null = null;
      for (let i = 0; ; i++) {
        try { res = await store.apply(tx, a.key, stats); break; } catch (err) {
          if (i >= this.retryMs.length) { console.error(`[casino] write failed for ${a.name} (${tx.game} ${tx.amount}):`, (err as Error).message); break; }
          await new Promise((r) => setTimeout(r, this.retryMs[i]));
        }
      }
      this.inflight.set(a.key, (this.inflight.get(a.key) ?? 0) - tx.amount);
      const rest = this.inflight.get(a.key) ?? 0;
      if (res?.ok) { a.chips = res.chips + rest; tx.balance = res.chips; return; }
      // Refused by the DB (another instance spent the chips, or used the key) or never landed: drop it from the cache.
      const list = this.recentTx.get(a.key); if (list) { const j = list.indexOf(tx); if (j >= 0) list.splice(j, 1); }
      if (res) a.chips = res.chips + rest; else a.chips -= tx.amount;
      if (res && !res.ok) console.warn(`[casino] ${res.reason === 'funds' ? 'insufficient funds in DB' : 'duplicate key'}; dropped ${tx.game} ${tx.amount} for ${a.name}${tx.key ? ` key=${tx.key}` : ''}`);
      this.emit(a, { key: null, name: a.name, game: tx.game, amount: 0, balance: a.chips, memo: 'reverted', at: Date.now() });
    };
    const prev = this.pending.get(a.key) ?? Promise.resolve();
    const next = prev.then(run).catch((err) => console.error('[casino] save failed:', (err as Error).message));
    this.pending.set(a.key, next);
    void next.then(() => {
      if (this.pending.get(a.key) === next) this.pending.delete(a.key);
    });
  }
}

let bank = new CasinoBank();
export const getBank = () => bank;
export function resetBank(): CasinoBank {
  bank = new CasinoBank();
  return bank;
}

/** Production must never run chips without the DB; dev/tests with no DATABASE_URL use the memory bank. */
export async function initCasinoStorage(): Promise<void> {
  const url = databaseUrl();
  if (!url) {
    if (process.env.NODE_ENV === 'production') {
      bank.status = 'down'; bank.lastError = 'no DATABASE_URL';
      console.error('[casino] no DATABASE_URL in production; wallet refuses all chip actions');
    } else console.warn('[casino] no DATABASE_URL set (dev); chips are in-memory');
    return;
  }
  const pool = new pg.Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 10_000 });
  const b = bank;
  b.requireDb();
  // Wait briefly for the first attempt so a healthy boot is ready at listen; keep retrying in the background otherwise.
  const done = b.connectUntilReady(new PgCasinoStore(pool)).then(() => console.log(`[casino] connected to postgres (${b.standings(10_000).length} players loaded)`));
  await Promise.race([done, new Promise((r) => setTimeout(r, 15_000))]);
}

/** Socket events that can move chips (stakes, buys, payouts, seats with buy-ins). Refused while the chip DB is down. */
const CHIP_EVENT = /^(bj_|he_sit|he_action|roulette_bet|roulette_rebet|vp_deal|vp_draw|vslots_|mines_(hit|collect|craft|sell|pack|factory|factory_upgrade|join)|fac_(buy|expand|place)|stk_(buy|sell)|casino_me|wallet_sub)|^(sit|pay_bailout|create_room|quick_join|tournament_create|tournament_join|vote_rematch)$/;
export const isChipEvent = (event: string): boolean => CHIP_EVENT.test(event);
