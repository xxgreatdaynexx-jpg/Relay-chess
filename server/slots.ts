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

// ---- Modern 5x3 video slots (Dragon Queen / Warzone / Gold Rush) ----
import { isMachineId, playRound, VS_BETS, type RoundResult } from '../shared/video-slots.js';

export interface VideoSpinResult { round: RoundResult; returned: number; net: number; chips: number }

/**
 * One complete round decided here with the secure RNG: base spin plus any free spins, pick-a-chest,
 * airstrike or hold-and-spin. The stake is debited and the full win credited in the same synchronous
 * step, so there is no client-held bonus state to replay or forge.
 */
export function spinVideoSlot(bank: CasinoBank, name: string, machine: unknown, bet: number, rand: () => number = secureRand): VideoSpinResult {
  if (!isMachineId(machine)) throw new Error('Unknown machine.');
  if (!(VS_BETS as readonly number[]).includes(bet)) throw new Error(`Bet one of ${VS_BETS.join(', ')} chips.`);
  bank.debit(name, bet);
  const round = playRound(machine, bet, rand);
  const returned = round.totalWin;
  const net = returned - bet;
  bank.settle(name, returned, net, 'spin');
  return { round, returned, net, chips: bank.account(name).chips };
}
