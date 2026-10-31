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

export interface CasinoStore {
  init(): Promise<void>;
  loadAll(): Promise<CasinoAccount[]>;
  save(account: CasinoAccount): Promise<void>;
  /** Write one ledger row and the new balance atomically. */
  record?(tx: WalletTx, account: CasinoAccount): Promise<void>;
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

export class PgCasinoStore implements CasinoStore {
  constructor(private readonly db: Queryable) {
    db.on?.('error', (err) => console.error('[casino] postgres pool error:', err.message));
  }
  async init(): Promise<void> {
    await this.db.query(CASINO_MIGRATION);
    await this.db.query(WALLET_MIGRATION);
  }
  async record(tx: WalletTx, a: CasinoAccount): Promise<void> {
    const ledger = ['INSERT INTO wallet_transactions (tx_key, player_key, name, game, amount, balance, memo) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tx_key) DO NOTHING',
      [tx.key, a.key, a.name, tx.game, tx.amount, tx.balance, tx.memo ?? null]] as const;
    const upsert = [`INSERT INTO casino_players (player_key, name, chips, hands, spins, net_won, biggest_win) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (player_key) DO UPDATE SET name = EXCLUDED.name, chips = EXCLUDED.chips, hands = EXCLUDED.hands,
         spins = EXCLUDED.spins, net_won = EXCLUDED.net_won, biggest_win = EXCLUDED.biggest_win, updated_at = now()`,
      [a.key, a.name, a.chips, a.hands, a.spins, a.netWon, a.biggestWin]] as const;
    // Ledger row and balance land together or not at all.
    const pool = this.db as Queryable & { connect?: () => Promise<Queryable & { release: () => void }> };
    if (!pool.connect) {
      await this.db.query(ledger[0], [...ledger[1]]);
      await this.db.query(upsert[0], [...upsert[1]]);
      return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(ledger[0], [...ledger[1]]);
      await client.query(upsert[0], [...upsert[1]]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
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
  async save(a: CasinoAccount): Promise<void> {
    await this.db.query(
      `INSERT INTO casino_players (player_key, name, chips, hands, spins, net_won, biggest_win) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (player_key) DO UPDATE SET name = EXCLUDED.name, chips = EXCLUDED.chips, hands = EXCLUDED.hands,
         spins = EXCLUDED.spins, net_won = EXCLUDED.net_won, biggest_win = EXCLUDED.biggest_win, updated_at = now()`,
      [a.key, a.name, a.chips, a.hands, a.spins, a.netWon, a.biggestWin],
    );
  }
}

export const START_CHIPS = 1000;

function keyOf(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Server-side chip bank and unified wallet for every game. Memory is the source of truth while running; Postgres is written behind, ledger row + balance in one statement. */
export class CasinoBank {
  private accounts = new Map<string, CasinoAccount>();
  private store: CasinoStore | null = null;
  private pending = new Map<string, Promise<void>>();
  private keys = new Set<string>();
  private recentTx = new Map<string, WalletTx[]>();
  private listeners = new Set<(a: CasinoAccount, tx: WalletTx) => void>();

  async attach(store: CasinoStore): Promise<boolean> {
    try {
      await store.init();
      for (const a of await store.loadAll()) this.accounts.set(a.key, a);
      for (const k of (await store.loadKeys?.()) ?? []) this.keys.add(k);
      this.store = store;
      return true;
    } catch (err) {
      console.error('[casino] postgres unavailable, chips are in-memory only:', (err as Error).message);
      return false;
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
    return this.account(name).chips >= amount;
  }

  /**
   * Move chips for a game (wager stake, payout, refund, buy-in). Negative = debit, never below zero.
   * With a key it is idempotent: a repeat (reconnect, retry, restart) is a no-op and returns false.
   */
  transfer(name: string, amount: number, opts: { key?: string; game: string; memo?: string }): boolean {
    if (!Number.isInteger(amount)) throw new Error('Bad amount.');
    if (opts.key && this.keys.has(opts.key)) return false;
    const a = this.account(name);
    if (amount < 0 && a.chips + amount < 0) throw new Error('Not enough chips.');
    a.chips += amount;
    if (opts.key) this.keys.add(opts.key);
    this.log(a, amount, opts.game, opts.key ?? null, opts.memo);
    return true;
  }

  /** Take a stake. Throws when short. */
  debit(name: string, amount: number, game = 'casino'): void {
    const a = this.account(name);
    if (!Number.isInteger(amount) || amount <= 0) throw new Error('Bad amount.');
    if (amount > a.chips) throw new Error('Not enough chips.');
    a.chips -= amount;
    this.log(a, -amount, game);
  }

  /** Settle one blackjack hand or roulette spin: `returned` chips come back, `net` is the result vs. stake. */
  settle(name: string, returned: number, net: number, kind: 'hand' | 'spin', game = 'casino'): void {
    const a = this.account(name);
    a.chips += returned;
    a.netWon += net;
    if (net > a.biggestWin) a.biggestWin = net;
    if (kind === 'hand') a.hands += 1;
    else a.spins += 1;
    this.log(a, returned, game);
  }

  /** Refund a stake that never played (e.g. bet withdrawn). */
  refund(name: string, amount: number, game = 'casino'): void {
    const a = this.account(name);
    a.chips += amount;
    this.log(a, amount, game, null, 'refund');
  }

  /** Newest first. Memory for this run, else the Postgres ledger. */
  async recent(name: string, limit = 25): Promise<WalletTx[]> {
    const key = keyOf(name);
    if (this.store?.recent) {
      await this.pending.get(key);
      try { return await this.store.recent(key, limit); } catch { /* fall back */ }
    }
    return (this.recentTx.get(key) ?? []).slice(0, limit);
  }

  standings(limit = 50): CasinoAccount[] {
    return [...this.accounts.values()]
      .filter((a) => a.hands + a.spins > 0 || a.chips !== START_CHIPS)
      .sort((x, y) => y.chips - x.chips || y.netWon - x.netWon || x.name.localeCompare(y.name))
      .slice(0, limit)
      .map((a) => ({ ...a }));
  }

  /** Resolves once every queued write has landed (tests / shutdown). */
  async flush(): Promise<void> {
    await Promise.all([...this.pending.values()]);
  }

  private log(a: CasinoAccount, amount: number, game: string, key: string | null = null, memo?: string): void {
    const tx: WalletTx = { key, name: a.name, game, amount, balance: a.chips, ...(memo ? { memo } : {}), at: Date.now() };
    if (amount !== 0 || key) {
      const list = this.recentTx.get(a.key) ?? [];
      list.unshift(tx);
      if (list.length > 50) list.length = 50;
      this.recentTx.set(a.key, list);
    }
    this.persist(a, amount !== 0 || key ? tx : null);
    for (const fn of this.listeners) {
      try { fn({ ...a }, tx); } catch (err) { console.error('[wallet] listener failed:', (err as Error).message); }
    }
  }

  private persist(a: CasinoAccount, tx: WalletTx | null): void {
    if (!this.store) return;
    const snapshot = { ...a };
    const store = this.store;
    const prev = this.pending.get(a.key) ?? Promise.resolve();
    const next = prev
      .then(() => (tx && store.record ? store.record(tx, snapshot) : store.save(snapshot)))
      .catch((err) => console.error('[casino] save failed:', (err as Error).message));
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

export async function initCasinoStorage(): Promise<void> {
  const url = databaseUrl();
  if (!url) {
    console.warn('[casino] no DATABASE_URL set; chips are in-memory only');
    return;
  }
  const pool = new pg.Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 10_000 });
  const ok = await bank.attach(new PgCasinoStore(pool));
  if (ok) console.log(`[casino] connected to postgres (${bank.standings(10_000).length} players loaded)`);
}
