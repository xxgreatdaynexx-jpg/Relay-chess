/**
 * Private Island estate retreat (shared/island.ts): once per UTC day, an island estate's owner who is ON the island
 * collects 0.25% of the estate's list price (price-indexed). Nothing accrues while away. One claim per estate per day
 * (the ledger tx_key is per estate + day, UNIQUE in wallet_transactions), so trading a deed mid-day cannot pay twice.
 */
import { ISLAND_LOTS, islandRetreatBase, islandRetreatKey } from '../shared/island.js';
import { isDisabledName } from '../shared/disabled.js';

export const ISLAND_RETREAT_GAME = 'island_retreat';
export class RetreatError extends Error {}
export interface RetreatBank { ready: boolean; hasKey(key: string): boolean; transferConfirmed(name: string, amount: number, opts: { key: string; game: string; memo?: string }): Promise<boolean>; account(name: string): { chips: number } }
export interface RetreatDeps {
  bank: () => RetreatBank;
  ownerOf: (id: string) => Promise<{ key: string; name: string } | null>;
  atIsland: (name: string) => boolean;
  jailed: (name: string) => boolean;
  px: (n: number) => number;
  clock?: () => number;
}
export interface RetreatRow { id: string; label: string; amount: number; owner: string | null; mine: boolean; claimed: boolean }
const keyOf = (n: string) => n.trim().toLowerCase();
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10); // same day boundary as the daily bonus

export async function retreatState(name: string | null, d: RetreatDeps): Promise<{ day: string; rows: RetreatRow[]; here: boolean }> {
  const day = utcDay((d.clock ?? Date.now)()); const bank = d.bank();
  const rows: RetreatRow[] = [];
  for (const l of ISLAND_LOTS) {
    const o = await d.ownerOf(l.id);
    rows.push({ id: l.id, label: l.label, amount: d.px(islandRetreatBase(l.id)), owner: o?.name ?? null, mine: !!name && !!o && o.key === keyOf(name), claimed: bank.hasKey(islandRetreatKey(l.id, day)) });
  }
  return { day, rows, here: !!name && d.atIsland(name) };
}

export async function claimRetreat(name: string, d: RetreatDeps): Promise<{ paid: number; estates: string[]; chips: number }> {
  if (!d.atIsland(name)) throw new RetreatError('Be on the Private Island to collect your retreat.');
  if (d.jailed(name) || isDisabledName(name)) throw new RetreatError('No retreat today.');
  const bank = d.bank(); if (!bank.ready) throw new RetreatError('Wallet temporarily unavailable.');
  const day = utcDay((d.clock ?? Date.now)()); let paid = 0; const estates: string[] = []; let owns = false;
  for (const l of ISLAND_LOTS) {
    const o = await d.ownerOf(l.id); if (!o || o.key !== keyOf(name)) continue; owns = true;
    const key = islandRetreatKey(l.id, day); if (bank.hasKey(key)) continue;
    const amount = d.px(islandRetreatBase(l.id)); if (amount <= 0) continue;
    if (await bank.transferConfirmed(name, amount, { key, game: ISLAND_RETREAT_GAME, memo: `🍹 Island retreat · ${l.label} · ${day}` })) { paid += amount; estates.push(l.label); }
  }
  if (!owns) throw new RetreatError('Only island estate owners collect a retreat. Buy an estate first.');
  if (!paid) throw new RetreatError('Already collected today. Come back after 00:00 UTC.');
  return { paid, estates, chips: bank.account(name).chips };
}
