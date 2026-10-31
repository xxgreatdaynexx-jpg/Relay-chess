/**
 * Mining leaderboard, computed from authoritative persisted events only:
 *  - chips: house payouts in the wallet ledger (wallet_transactions, tx_key 'mine:sell:%', written by bank.transfer())
 *  - ore / best haul: mine_banks rows written in the same transaction as the banked stacks at the EXIT lift.
 * Guests never reach either table; QA- accounts are excluded.
 */
import { isQaName } from '../shared/qa.js';
import { periodStart, type MineBoardRow, type MineMetric, type MinePeriod } from '../shared/minesBoard.js';
import type { Queryable } from './leaderboard-store.js';

export const MINE_BOARD_LIMIT = 25;
const CACHE_MS = 15_000;
export type MineBoard = Record<MineMetric, MineBoardRow[]>;

export class MinesLeaderboard {
  private cache = new Map<MinePeriod, { at: number; board: MineBoard }>();
  constructor(private readonly db: Queryable | null) {}
  get usingDatabase() { return !!this.db; }

  async board(period: MinePeriod, now = Date.now(), fresh = false): Promise<MineBoard> {
    const c = this.cache.get(period);
    if (!fresh && c && now - c.at < CACHE_MS) return c.board;
    const board = await this.compute(period, now);
    this.cache.set(period, { at: now, board });
    return board;
  }

  private async compute(period: MinePeriod, now: number): Promise<MineBoard> {
    const empty: MineBoard = { chips: [], ore: [], haul: [] };
    if (!this.db) return empty;
    const since = periodStart(period, now);
    const rows = new Map<string, MineBoardRow>();
    const row = (key: string, name: string) => { let r = rows.get(key); if (!r) { r = { name, chips: 0, ore: 0, haul: 0 }; rows.set(key, r); } return r; };
    const chips = await this.db.query(
      `SELECT player_key, max(name) AS name, sum(amount) AS chips FROM wallet_transactions
       WHERE game = 'mines' AND tx_key LIKE 'mine:sell:%' AND amount > 0 AND created_at >= $1 GROUP BY player_key`, [new Date(since).toISOString()]);
    for (const r of chips.rows) row(String(r.player_key), String(r.name)).chips = Number(r.chips);
    const banks = await this.db.query(
      `SELECT player_key, max(owner_name) AS name, sum(ore_qty) AS ore, max(worth) AS haul FROM mine_banks WHERE at >= $1 GROUP BY player_key`, [since]);
    for (const r of banks.rows) { const x = row(String(r.player_key), String(r.name)); x.ore = Number(r.ore); x.haul = Math.floor(Number(r.haul)); }
    const all = [...rows.values()].filter((r) => !isQaName(r.name));
    const top = (m: MineMetric) => all.filter((r) => r[m] > 0).sort((a, b) => b[m] - a[m] || a.name.localeCompare(b.name)).slice(0, MINE_BOARD_LIMIT);
    return { chips: top('chips'), ore: top('ore'), haul: top('haul') };
  }
}

let board = new MinesLeaderboard(null);
export const getMinesBoard = () => board;
export const setMinesBoard = (b: MinesLeaderboard) => { board = b; };
