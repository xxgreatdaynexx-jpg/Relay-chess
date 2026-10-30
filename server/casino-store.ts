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

export interface CasinoStore {
  init(): Promise<void>;
  loadAll(): Promise<CasinoAccount[]>;
  save(account: CasinoAccount): Promise<void>;
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

export class PgCasinoStore implements CasinoStore {
  constructor(private readonly db: Queryable) {
    db.on?.('error', (err) => console.error('[casino] postgres pool error:', err.message));
  }
  async init(): Promise<void> {
    await this.db.query(CASINO_MIGRATION);
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
/** Below this you may reset to START_CHIPS. */
export const BROKE_BELOW = 5;

function keyOf(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Server-side chip bank. Memory is the source of truth while running; Postgres is written behind. */
export class CasinoBank {
  private accounts = new Map<string, CasinoAccount>();
  private store: CasinoStore | null = null;
  private pending = new Map<string, Promise<void>>();

  async attach(store: CasinoStore): Promise<boolean> {
    try {
      await store.init();
      for (const a of await store.loadAll()) this.accounts.set(a.key, a);
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

  /** Take a stake. Throws when short. */
  debit(name: string, amount: number): void {
    const a = this.account(name);
    if (!Number.isInteger(amount) || amount <= 0) throw new Error('Bad amount.');
    if (amount > a.chips) throw new Error('Not enough chips.');
    a.chips -= amount;
    this.persist(a);
  }

  /** Settle one blackjack hand or roulette spin: `returned` chips come back, `net` is the result vs. stake. */
  settle(name: string, returned: number, net: number, kind: 'hand' | 'spin'): void {
    const a = this.account(name);
    a.chips += returned;
    a.netWon += net;
    if (net > a.biggestWin) a.biggestWin = net;
    if (kind === 'hand') a.hands += 1;
    else a.spins += 1;
    this.persist(a);
  }

  /** Refund a stake that never played (e.g. bet withdrawn). */
  refund(name: string, amount: number): void {
    const a = this.account(name);
    a.chips += amount;
    this.persist(a);
  }

  reset(name: string): CasinoAccount {
    const a = this.account(name);
    if (a.chips >= BROKE_BELOW) throw new Error('You can reset only when you are broke.');
    a.chips = START_CHIPS;
    this.persist(a);
    return a;
  }

  standings(limit = 50): CasinoAccount[] {
    return [...this.accounts.values()]
      .filter((a) => a.hands + a.spins > 0)
      .sort((x, y) => y.chips - x.chips || y.netWon - x.netWon || x.name.localeCompare(y.name))
      .slice(0, limit)
      .map((a) => ({ ...a }));
  }

  /** Resolves once every queued write has landed (tests / shutdown). */
  async flush(): Promise<void> {
    await Promise.all([...this.pending.values()]);
  }

  private persist(a: CasinoAccount): void {
    if (!this.store) return;
    const snapshot = { ...a };
    const prev = this.pending.get(a.key) ?? Promise.resolve();
    const next = prev
      .then(() => this.store!.save(snapshot))
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
