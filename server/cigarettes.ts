/**
 * Cigarette inventory (warehouse goods) and the casino smoking buff.
 * Buff + daily bonus stay in memory and are upserted to cigarette_buff (additive table).
 * The bonus is paid from the house on net wins only, never taken from other players.
 */
import pg from 'pg';
import { playerKey } from './skins.js';
import { databaseUrl } from './leaderboard-store.js';
import { bootAttach, setBootState } from './boot-retry.js';
import { getBank, type CasinoBank } from './casino-store.js';
import { getLocStore } from './locstock.js';
import { fishingLoc, WAREHOUSE, RESORT_WAREHOUSE } from '../shared/inventoryLocations.js';
import { isFishSpot } from '../shared/fishing.js';
import {
  CIGARETTE_BUFF_MAX_MS, CIGARETTE_BUFF_MS, CIGARETTE_BUFF_RATE, CIGARETTE_DAILY_CAP,
  CIGARETTE_DROP_RATE, CIGARETTE_ITEM, cigaretteBonus, cigaretteDay, extendCigaretteBuff,
  isCigaretteGame, type CigaretteView,
} from '../shared/cigarettes.js';

export const CIGARETTE_MIGRATION = `
CREATE TABLE IF NOT EXISTS cigarette_buff (
  player_key TEXT PRIMARY KEY,
  until_ms BIGINT NOT NULL DEFAULT 0,
  day TEXT NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0
)`;

interface Row { until: number; day: string; paid: number }

export class CigaretteError extends Error {}

const LOCS = [WAREHOUSE, RESORT_WAREHOUSE] as const;

export class Cigarettes {
  private rows = new Map<string, Row>();
  private chain = new Map<string, Promise<unknown>>();
  constructor(private pool: pg.Pool | null = null, private clock = () => Date.now(), private bank: () => CasinoBank = getBank) {}

  async init() {
    if (!this.pool) return;
    await this.pool.query(CIGARETTE_MIGRATION);
    const r = await this.pool.query('SELECT player_key, until_ms, day, paid FROM cigarette_buff');
    this.rows.clear();
    for (const x of r.rows) this.rows.set(String(x.player_key), { until: Number(x.until_ms) || 0, day: String(x.day), paid: Math.max(0, Math.floor(Number(x.paid) || 0)) });
  }

  private key = (name: string) => playerKey(name);
  private now = () => this.clock();
  private row(name: string): Row {
    const k = this.key(name);
    const day = cigaretteDay(this.now());
    let r = this.rows.get(k);
    if (!r) { r = { until: 0, day, paid: 0 }; this.rows.set(k, r); }
    if (r.day !== day) { r.day = day; r.paid = 0; }
    return r;
  }
  private save(name: string, r: Row) {
    const k = this.key(name);
    if (!this.pool) return;
    void this.pool.query(
      `INSERT INTO cigarette_buff (player_key, until_ms, day, paid) VALUES ($1,$2,$3,$4)
       ON CONFLICT (player_key) DO UPDATE SET until_ms=EXCLUDED.until_ms, day=EXCLUDED.day, paid=EXCLUDED.paid`,
      [k, r.until, r.day, r.paid],
    ).catch((e) => console.error('[cigarettes] save failed:', (e as Error).message));
  }
  private lock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const k = this.key(name);
    const prev = this.chain.get(k) ?? Promise.resolve();
    const p = prev.then(fn, fn);
    this.chain.set(k, p.then(() => {}, () => {}));
    return p;
  }

  qty(name: string): number {
    try {
      const ls = getLocStore();
      let n = 0;
      for (const loc of LOCS) n += ls.qty(name, loc, CIGARETTE_ITEM);
      return n;
    } catch { return 0; }
  }

  view(name: string): CigaretteView {
    const r = this.row(name);
    const now = this.now();
    return {
      qty: this.qty(name),
      until: r.until > now ? r.until : 0,
      paid: r.paid,
      cap: CIGARETTE_DAILY_CAP,
      rate: CIGARETTE_BUFF_RATE,
      durationMs: CIGARETTE_BUFF_MS,
      maxMs: CIGARETTE_BUFF_MAX_MS,
      serverNow: now,
    };
  }

  active(name: string): boolean { return this.row(name).until > this.now(); }

  /** Consume one cigarette from warehouse or resort warehouse and extend the buff. */
  async smoke(name: string): Promise<CigaretteView> {
    return this.lock(name, async () => {
      const now = this.now();
      const r = this.row(name);
      if (r.until > now && r.until >= now + CIGARETTE_BUFF_MAX_MS) throw new CigaretteError('That buff is already at the 15-minute maximum.');
      if (this.qty(name) < 1) throw new CigaretteError("You don't have a cigarette.");
      const ls = getLocStore();
      let taken = false;
      for (const loc of LOCS) {
        if (ls.qty(name, loc, CIGARETTE_ITEM) <= 0) continue;
        const p = ls.adjust(name, [{ loc, item: CIGARETTE_ITEM, delta: -1 }]);
        if (p === false) continue;
        await p;
        taken = true;
        break;
      }
      if (!taken) throw new CigaretteError("You don't have a cigarette.");
      r.until = extendCigaretteBuff(r.until, now);
      this.save(name, r);
      return this.view(name);
    });
  }

  /**
   * If the buff is running, pay +10% of a net win from the house (capped per day).
   * Sync, like the nightly bonus, so it can run from game settle paths. Idempotent by `ref`.
   */
  payBonus(name: string, netWin: number, game: string, ref: string, bank: CasinoBank = this.bank()): number {
    try {
      if (!name || !isCigaretteGame(game) || !(netWin > 0) || !ref) return 0;
      const r = this.row(name);
      if (r.until <= this.now()) return 0;
      const bonus = cigaretteBonus(netWin, r.paid);
      if (bonus <= 0) return 0;
      const key = `cigbonus:${ref}`;
      if (!bank.transfer(name, bonus, { key, game: 'cigarette_bonus', memo: `Cigarette bonus (+${Math.round(CIGARETTE_BUFF_RATE * 100)}% of your ${game} win)` })) return 0;
      r.paid += bonus;
      this.save(name, r);
      return bonus;
    } catch (e) { console.error('[cigarettes] bonus failed:', (e as Error).message); return 0; }
  }
}

let inst = new Cigarettes();
export const getCigarettes = () => inst;
export const setCigarettesForTest = (c: Cigarettes) => { inst = c; };
export const resetCigarettesForTest = () => { inst = new Cigarettes(); };

/** After a game settle: house-paid bonus on a net win while the buff is active. Never throws. */
export function payCigaretteBonus(name: string, netWin: number, game: string, ref: string, bank?: CasinoBank): number {
  return inst.payBonus(name, netWin, game, ref, bank);
}

/** Roll and, on a hit, put one cigarette in the map warehouse for that fishing spot. Never throws; never fails the catch. */
export async function grantFishingCigarette(name: string, spot: string, roll: () => number): Promise<boolean> {
  try {
    if (roll() >= CIGARETTE_DROP_RATE) return false;
    const loc = fishingLoc(isFishSpot(spot) ? spot : 'lake');
    const p = getLocStore().adjust(name, [{ loc, item: CIGARETTE_ITEM, delta: 1 }]);
    if (p === false) return false;
    await p;
    return true;
  } catch (e) {
    console.error('[cigarettes] drop grant failed:', (e as Error).message);
    return false;
  }
}
export async function initCigarettes(): Promise<void> {
  const url = databaseUrl();
  if (!url) { inst = new Cigarettes(); setBootState('cigarettes', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[cigarettes] pool error:', e.message));
  const c = new Cigarettes(pool);
  inst = c;
  await bootAttach('cigarettes', async () => { try { await c.init(); return true; } catch (e) { console.error('[cigarettes] init failed:', (e as Error).message); return false; } }, { onOk: () => console.log('[cigarettes] ready') });
}
