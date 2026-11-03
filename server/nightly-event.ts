/**
 * Nightly 10x reward event (request #35; rules in shared/nightlyEvent.ts). Game code calls `payNightlyBonus` after it
 * pays a winner; if the event is live for that game, the 9x extra goes to the winner through the wallet + ledger
 * (bank.transfer, game 'nightly_10x', idempotent key per win). Tonight's per-player totals live in memory
 * (a restart resets them; the per-win cap still bounds every single payout).
 */
import { getBank, type CasinoBank } from './casino-store.js';
import { px } from './price-index.js';
import { nightlyBonus, nightlyEvent, NIGHTLY_BONUS_CAP_PER_NIGHT, NIGHTLY_BONUS_CAP_PER_WIN, NIGHTLY_MULT, type NightlyGame } from '../shared/nightlyEvent.js';
import { isQaName } from '../shared/qa.js';

const paid = new Map<string, number>(); // `${day}:${player}` -> bonus paid tonight
const recent: Array<{ name: string; game: NightlyGame; bonus: number; at: number }> = [];
let clock = () => Date.now();
export const setNightlyClock = (c: () => number) => { clock = c; };
export const resetNightly = () => { paid.clear(); recent.length = 0; };

export function payNightlyBonus(name: string, game: NightlyGame, netWin: number, ref: string, bank: CasinoBank = getBank()): number {
  try {
    const ev = nightlyEvent(clock());
    if (!ev.active || ev.game !== game || !(netWin > 0) || !name || isQaName(name)) return 0;
    const k = `${ev.day}:${name.trim().toLowerCase()}`; const already = paid.get(k) ?? 0;
    const bonus = nightlyBonus(netWin, already, px(NIGHTLY_BONUS_CAP_PER_WIN), px(NIGHTLY_BONUS_CAP_PER_NIGHT));
    if (bonus <= 0) return 0;
    if (!bank.transfer(name, bonus, { key: `nightly10x:${ev.day}:${ref}:${name.trim().toLowerCase()}`, game: 'nightly_10x', memo: `Nightly ${NIGHTLY_MULT}x event bonus (${game})` })) return 0;
    paid.set(k, already + bonus); recent.unshift({ name, game, bonus, at: clock() }); recent.length = Math.min(recent.length, 10);
    return bonus;
  } catch (e) { console.error('[nightly-10x] bonus failed:', (e as Error).message); return 0; }
}
export const nightlyView = () => ({ ...nightlyEvent(clock()), mult: NIGHTLY_MULT, capPerWin: px(NIGHTLY_BONUS_CAP_PER_WIN), capPerNight: px(NIGHTLY_BONUS_CAP_PER_NIGHT), recent: recent.slice(0, 5), serverNow: clock() });
