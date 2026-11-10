/**
 * Per-player house-cap bonus from seed chips paid today (UTC day = cap day, resets 00:00 UTC / 6 PM CST).
 * Source of truth is the wallet ledger (`farm_seed`): boot/reload sums this cap day's charges so the
 * bonus is correct and idempotent after a restart. Live plantings attach via the bank listener.
 * Failed or reverted charges are not kept. Earlier cap days are not included.
 */
import pg from 'pg';
import { databaseUrl } from './leaderboard-store.js';
import { getBank, type WalletTx } from './casino-store.js';
import { playerKey } from './skins.js';
import { dayKey } from '../shared/mines.js';
import { plantCapBonusFromPaid } from '../shared/plantCap.js';

interface DayPaid { day: string; paid: number; name: string }
const days = new Map<string, DayPaid>();
const seen = new Set<string>();
let unhook: (() => void) | null = null;

function dayOf(name: string, now: number): DayPaid {
  const k = playerKey(name);
  const day = dayKey(now);
  let d = days.get(k);
  if (!d || d.day !== day) { d = { day, paid: 0, name: name.trim() || k }; days.set(k, d); }
  else if (name.trim()) d.name = name.trim();
  return d;
}

/** Apply one farm_seed ledger row (negative amount = chips charged). Reverts and refunds net out. */
export function recordPlantSeed(name: string, row: { game: string; amount: number; memo?: string | null; key?: string | null }, now = Date.now()) {
  if (row.game !== 'farm_seed' || !row.amount) return;
  if (row.key) { if (seen.has(row.key)) return; seen.add(row.key); }
  dayOf(name, now).paid += -row.amount;
}

export const plantCapPaid = (name: string, now = Date.now()) => {
  const d = days.get(playerKey(name));
  return d && d.day === dayKey(now) ? Math.max(0, d.paid) : 0;
};
export const plantCapBonus = (name: string, now = Date.now()) => plantCapBonusFromPaid(plantCapPaid(name, now));

export function resetPlantCapForTest() {
  days.clear(); seen.clear();
  hookBank();
}

function hookBank() {
  unhook?.();
  unhook = getBank().onChange((_a, tx: WalletTx) => recordPlantSeed(tx.name, { game: tx.game, amount: tx.amount, memo: tx.memo, key: tx.key }));
}

function utcDayStart(now = Date.now()) {
  return Math.floor(now / 86_400_000) * 86_400_000;
}

/** Seed from this cap day's farm_seed ledger rows and listen for new charges. */
export function startPlantCap(): void {
  hookBank();
  const url = databaseUrl(); if (!url) return;
  const db = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  const start = utcDayStart();
  const day = dayKey(start);
  void db.query(
    `SELECT name, amount, tx_key FROM wallet_transactions WHERE game = 'farm_seed' AND created_at >= to_timestamp($1/1000.0) ORDER BY id`,
    [start],
  ).then((r) => {
    for (const x of r.rows) recordPlantSeed(String(x.name), { game: 'farm_seed', amount: Number(x.amount), key: x.tx_key ? String(x.tx_key) : null }, start);
    const parts = [...days.values()]
      .filter((d) => d.day === day && d.paid > 0)
      .map((d) => ({ name: d.name, paid: d.paid, bonus: plantCapBonusFromPaid(d.paid) }))
      .sort((a, b) => b.bonus - a.bonus || a.name.localeCompare(b.name))
      .map((d) => `${d.name} +${d.bonus.toLocaleString('en-US')} (paid ${d.paid.toLocaleString('en-US')})`);
    console.log(`[plant-cap] backfilled ${parts.length} player(s) for ${day}${parts.length ? ': ' + parts.join(', ') : ''}`);
  }).catch((e) => console.error('[plant-cap] seed failed:', (e as Error).message)).finally(() => void db.end().catch(() => {}));
}
