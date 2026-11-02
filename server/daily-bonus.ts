/** Daily login bonus: 1,000 chips once per UTC day (same day boundary as daily_economy) per signed-in account. */
import type { Socket } from 'socket.io';
import { getBank } from './casino-store.js';
import { px } from './price-index.js';
import { buildDailyReport } from './daily-report.js';
import { skillLevelAsync } from './skills.js';
import { chessDailyBonus } from '../shared/skillPerks.js';

export const DAILY_BONUS = 1000;
export const DAILY_BONUS_GAME = 'daily_bonus';
export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
export const dailyBonusKey = (name: string, day: string) => `daily_bonus:${name.replace(/\s+/g, ' ').trim().toLowerCase()}:${day}`;

/** Today's bonus after the price index. */
export const dailyBonusAmount = () => px(DAILY_BONUS);

/**
 * Credit today's bonus if this account hasn't had it. Idempotent across tabs, restarts and Render instances: the ledger
 * tx_key (UNIQUE in wallet_transactions) is the claim. Returns the award, or null when already claimed / wallet down.
 */
export async function claimDailyBonus(name: string, now = Date.now()): Promise<{ amount: number; chips: number; day: string } | null> {
  const bank = getBank();
  if (!bank.ready) return null;
  const day = utcDay(now);
  const key = dailyBonusKey(name, day);
  if (bank.hasKey(key)) return null;
  try {
    const amount = dailyBonusAmount() + px(chessDailyBonus(await skillLevelAsync(name, 'chess'))); // Chess perk (tiny, same ledger row)
    const ok = await bank.transferConfirmed(name, amount, { key, game: DAILY_BONUS_GAME, memo: `Daily login bonus ${day}` });
    return ok ? { amount, chips: bank.account(name).chips, day } : null;
  } catch (e) {
    console.error('[daily-bonus] failed:', (e as Error).message);
    return null;
  }
}

/** Fire-and-forget after a successful sign-in / resume; tells only this socket when chips were awarded. */
export function grantDailyBonus(socket: Socket, name: string): void {
  void claimDailyBonus(name).then(async (r) => {
    if (!r) return;
    socket.emit('daily_bonus', r);
    try { socket.emit('daily_report', await buildDailyReport(name, r.amount)); } catch (e) { console.error('[daily-report] build failed:', (e as Error).message); }
  });
}
