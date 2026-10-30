// Modern 5x3 video slots (Dragon Queen / Warzone / Gold Rush) on casino chips. Server decides; client only animates.
import type { CasinoBank } from './casino-store.js';
import { secureRand } from './video-poker.js';
import { buyBonusPrice, isMachineId, playBuyBonus, playRound, VS_BETS, type MachineId, type RoundResult } from '../shared/video-slots.js';

export interface VideoSpinResult { round: RoundResult; returned: number; net: number; chips: number; cost: number }

function checkBet(machine: unknown, bet: number): asserts machine is MachineId {
  if (!isMachineId(machine)) throw new Error('Unknown machine.');
  if (!(VS_BETS as readonly number[]).includes(bet)) throw new Error(`Bet one of ${VS_BETS.join(', ')} chips.`);
}

/**
 * One complete round decided here with the secure RNG: base spin plus any free spins, pick-a-chest,
 * airstrike or hold-and-spin. The stake is debited and the full win credited in the same synchronous
 * step, so there is no client-held bonus state to replay or forge.
 */
export function spinVideoSlot(bank: CasinoBank, name: string, machine: unknown, bet: number, rand: () => number = secureRand): VideoSpinResult {
  checkBet(machine, bet);
  bank.debit(name, bet);
  const round = playRound(machine, bet, rand);
  const returned = round.totalWin;
  const net = returned - bet;
  bank.settle(name, returned, net, 'spin');
  return { round, returned, net, chips: bank.account(name).chips, cost: bet };
}

/**
 * Buy Bonus: the price is computed here from the bet (never taken from the client), debited, the
 * guaranteed-bonus round is played with the secure RNG and its win credited, all in one synchronous step.
 */
export function buyVideoBonus(bank: CasinoBank, name: string, machine: unknown, bet: number, rand: () => number = secureRand): VideoSpinResult {
  checkBet(machine, bet);
  const cost = buyBonusPrice(machine, bet);
  if (bank.account(name).chips < cost) throw new Error('Not enough chips.');
  const round = playBuyBonus(machine, bet, rand);
  bank.debit(name, cost);
  const returned = round.totalWin;
  const net = returned - cost;
  bank.settle(name, returned, net, 'spin');
  return { round, returned, net, chips: bank.account(name).chips, cost };
}
