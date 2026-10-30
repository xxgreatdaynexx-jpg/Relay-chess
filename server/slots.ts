// 3-reel slot machine on casino chips. Server picks reels; client only animates.
import { pickSymbol, slotMultiplier, SLOTS_MAX_BET, SLOTS_MIN_BET, type SlotSymbol } from '../shared/casino-games.js';
import type { CasinoBank } from './casino-store.js';
import { secureRand } from './video-poker.js';

export interface SpinResult { reels: SlotSymbol[]; multiplier: number; returned: number; net: number; chips: number }

export function spinSlots(bank: CasinoBank, name: string, bet: number, rand: () => number = secureRand): SpinResult {
  if (!Number.isInteger(bet) || bet < SLOTS_MIN_BET || bet > SLOTS_MAX_BET) throw new Error(`Bet ${SLOTS_MIN_BET}–${SLOTS_MAX_BET} chips.`);
  bank.debit(name, bet);
  const reels = [pickSymbol(rand()), pickSymbol(rand()), pickSymbol(rand())];
  const multiplier = slotMultiplier(reels);
  const returned = bet * multiplier;
  const net = returned - bet;
  bank.settle(name, returned, net, 'spin');
  return { reels, multiplier, returned, net, chips: bank.account(name).chips };
}
