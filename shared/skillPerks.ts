/**
 * Skill perks: small, level-scaled (1 -> 99) gameplay bonuses. Every perk is applied server-side; the client only shows text.
 * Rules: perks never create chips from nothing (they only speed things up, shave fees/tax the player pays, or shift odds a
 * little inside activities that already have daily caps). Gambling has no perk and never touches casino odds or payouts.
 * Daily XP and sales caps are unchanged. The 5% mine key/chest drop rate is unchanged (bonus ore never rolls a drop).
 */
import { MAX_LEVEL, type SkillId } from './skills.js';

/** 0 at level 1, 1 at level 99, linear in between. */
export const perkT = (level: number) => Math.max(0, Math.min(1, (Math.floor(Number(level) || 1) - 1) / (MAX_LEVEL - 1)));

export const MINING_MAX_SPEEDUP = 0.35;
export const MINING_MAX_BONUS = 0.15;
export const ENGINEERING_MAX_SPEEDUP = 0.25;
export const FARMING_MAX_SPEEDUP = 0.25;
/** Farming level bonus yield (Dayne, Nov 3 2026): up to +25% crops at 99. Separate from the #27 fertilizer rework (Nov 6). */
export const FARMING_MAX_YIELD = 0.25;
export const RACING_MAX_DISCOUNT = 0.2;
export const COMBAT_MAX_ARMOR = 0.05;
export const TRADING_MAX_DISCOUNT = 0.3;
export const CHESS_MAX_BONUS = 50; // base chips (× price index) added to the daily bonus at 99
export const FISHING_MAX_BITE = 0.25;
export const FISHING_MAX_LUCK = 0.08;
export const PROPERTY_MAX_DISCOUNT = 0.2;

/** Mining: swing/break time multiplier (1 -> 0.65). */
export const miningSwingMul = (l: number) => 1 - MINING_MAX_SPEEDUP * perkT(l);
/** Mining: chance a broken vein gives one extra ore (0 -> 15%). */
export const miningBonusChance = (l: number) => MINING_MAX_BONUS * perkT(l);
/** Engineering: factory craft time multiplier (1 -> 0.75). */
export const engineeringTimeMul = (l: number) => 1 - ENGINEERING_MAX_SPEEDUP * perkT(l);
/** Farming: crop grow time multiplier (1 -> 0.75). */
export const farmingGrowMul = (l: number) => 1 - FARMING_MAX_SPEEDUP * perkT(l);
/** Farming: bonus yield fraction (0 -> +25%). Extra crops = tiles × this; the fractional part is rolled as a chance. */
export const farmingYieldBonus = (l: number) => FARMING_MAX_YIELD * perkT(l);
/** Extra crops for a harvest of `tiles` tiles at bonus `y`: floor(tiles·y) plus one more with probability of the remainder. */
export const bonusCrops = (tiles: number, y: number, rand: () => number = Math.random) => { const e = Math.max(0, tiles * y); const k = Math.floor(e); return k + (rand() < e - k ? 1 : 0); };
/** Racing: Daily Cup entry fee multiplier (1 -> 0.8). The prize pool uses the fees actually paid. */
export const racingEntryMul = (l: number) => 1 - RACING_MAX_DISCOUNT * perkT(l);
/** Combat: arena damage taken multiplier (1 -> 0.95). */
export const combatDamageMul = (l: number) => 1 - COMBAT_MAX_ARMOR * perkT(l);
/** Trading: Market/stock fee multiplier (1 -> 0.7). Fees stay >= 1 chip. */
export const tradingFeeMul = (l: number) => 1 - TRADING_MAX_DISCOUNT * perkT(l);
/** Chess: base chips added to the once-a-day login bonus (0 -> 50, × price index). */
export const chessDailyBonus = (l: number) => Math.floor(CHESS_MAX_BONUS * perkT(l));
/** Fishing: bite wait multiplier (1 -> 0.75). */
export const fishingBiteMul = (l: number) => 1 - FISHING_MAX_BITE * perkT(l);
/** Fishing: shifts the rarity roll toward rarer fish by up to 8% of the remaining range. */
export const fishingLuckRoll = (u: number, l: number) => Math.min(0.999999, u + (1 - u) * FISHING_MAX_LUCK * perkT(l));
/** Property: daily property tax multiplier (1 -> 0.8). */
export const propertyTaxMul = (l: number) => 1 - PROPERTY_MAX_DISCOUNT * perkT(l);

const pct = (x: number) => `${Math.round(x * 100)}%`;
/** One-line perk text for the Skills panel. */
export function perkText(skill: SkillId | string, level: number): string {
  const t = perkT(level);
  switch (skill) {
    case 'mining': return `${pct(MINING_MAX_SPEEDUP * t)} faster swings, ${pct(MINING_MAX_BONUS * t)} chance of double ore`;
    case 'engineering': return `Factory machines craft ${pct(ENGINEERING_MAX_SPEEDUP * t)} faster`;
    case 'farming': return `Crops grow ${pct(FARMING_MAX_SPEEDUP * t)} faster, +${pct(FARMING_MAX_YIELD * t)} yield`;
    case 'racing': return `${pct(RACING_MAX_DISCOUNT * t)} off the Daily Cup entry`;
    case 'combat': return `${pct(COMBAT_MAX_ARMOR * t)} less damage taken in the Arena`;
    case 'trading': return `${pct(TRADING_MAX_DISCOUNT * t)} off Market and stock fees`;
    case 'chess': return `+${chessDailyBonus(level)} chips on your daily bonus`;
    case 'fishing': return `Bites ${pct(FISHING_MAX_BITE * t)} sooner, +${pct(FISHING_MAX_LUCK * t)} rare-fish luck`;
    case 'property': return `${pct(PROPERTY_MAX_DISCOUNT * t)} off property tax`;
    case 'cooking': return 'Wider perfect-cook window; unlocks rarer fish';
    case 'gambling': return 'Bragging rights only (casino odds never change)';
    default: return '';
  }
}
