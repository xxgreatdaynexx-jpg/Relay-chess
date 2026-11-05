/**
 * Nightly 10x reward event (request #35; rules in shared/nightlyEvent.ts). Game code calls `payNightlyBonus` after it
 * pays a winner; if the event is live for that game, the 9x extra goes to the winner through the wallet + ledger
 * (bank.transfer, game 'nightly_10x').
 *
 * The per-night cap is persisted in the ledger keys themselves (like the Arena / hockey daily caps): tonight's cap is split
 * into NIGHTLY_SLOTS equal slots, and a bonus that uses k slots starting at slot s is written with the UNIQUE tx_key
 * `nightly10x:<day>:<player>:<s>+<k>`. The bank reloads every tx_key on boot, so after a restart (or on another
 * instance, where the UNIQUE key rejects a second claim of the same slots) the used slots are found again with hasKey.
 * Slots round up, so a player can fall a little short of the nightly cap but can never go over it.
 */
import { getBank, type CasinoBank } from './casino-store.js';
import { px } from './price-index.js';
import { nightlyBonus, nightlyEvent, NIGHTLY_BONUS_CAP_PER_NIGHT, NIGHTLY_BONUS_CAP_PER_WIN, NIGHTLY_MULT, type NightlyGame } from '../shared/nightlyEvent.js';
import { isQaName } from '../shared/qa.js';

export const NIGHTLY_SLOTS = 200;
export const nightlySlotKey = (day: string, player: string, start: number, len: number) => `nightly10x:${day}:${player}:${start}+${len}`;
const recent: Array<{ name: string; game: NightlyGame; bonus: number; at: number }> = [];
const seenRefs = new Set<string>(); // fast path only; callers already pay once per win via their own keyed payouts
let clock = () => Date.now();
export const setNightlyClock = (c: () => number) => { clock = c; };
export const resetNightly = () => { seenRefs.clear(); recent.length = 0; };

type NightlyBank = Pick<CasinoBank, 'transfer' | 'hasKey'>;
/** Slots already used tonight by `player`, read from ledger keys. */
export function nightlySlotsUsed(bank: NightlyBank, day: string, player: string, maxLen: number): number {
  let s = 0;
  for (;;) {
    let step = 0;
    for (let k = 1; k <= maxLen && s + k <= NIGHTLY_SLOTS; k++) if (bank.hasKey(nightlySlotKey(day, player, s, k))) { step = k; break; }
    if (!step) return s; s += step;
  }
}

export function payNightlyBonus(name: string, game: NightlyGame, netWin: number, ref: string, bank: NightlyBank = getBank()): number {
  try {
    const ev = nightlyEvent(clock());
    if (!ev.active || ev.game !== game || !(netWin > 0) || !name || isQaName(name)) return 0;
    const player = name.trim().toLowerCase(); const r = `${ev.day}:${ref}:${player}`;
    if (seenRefs.has(r)) return 0;
    const capWin = px(NIGHTLY_BONUS_CAP_PER_WIN), capNight = px(NIGHTLY_BONUS_CAP_PER_NIGHT);
    const unit = Math.max(1, Math.ceil(capNight / NIGHTLY_SLOTS)); const maxLen = Math.ceil(capWin / unit);
    const used = nightlySlotsUsed(bank, ev.day, player, maxLen);
    const bonus = Math.min(nightlyBonus(netWin, used * unit, capWin, capNight), (NIGHTLY_SLOTS - used) * unit);
    if (bonus <= 0) return 0;
    const len = Math.ceil(bonus / unit);
    if (!bank.transfer(name, bonus, { key: nightlySlotKey(ev.day, player, used, len), game: 'nightly_10x', memo: `Nightly ${NIGHTLY_MULT}x event bonus (${game} ${ref})` })) return 0;
    seenRefs.add(r); if (seenRefs.size > 20_000) seenRefs.delete(seenRefs.values().next().value as string);
    recent.unshift({ name, game, bonus, at: clock() }); recent.length = Math.min(recent.length, 10);
    return bonus;
  } catch (e) { console.error('[nightly-10x] bonus failed:', (e as Error).message); return 0; }
}
export const nightlyView = () => ({ ...nightlyEvent(clock()), mult: NIGHTLY_MULT, capPerWin: px(NIGHTLY_BONUS_CAP_PER_WIN), capPerNight: px(NIGHTLY_BONUS_CAP_PER_NIGHT), recent: recent.slice(0, 5), serverNow: clock() });
