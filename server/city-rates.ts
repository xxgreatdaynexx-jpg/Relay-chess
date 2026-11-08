/**
 * Light hot-path readers for the city (no heavy imports, so shops / travel / skills can import it without cycles).
 * server/city.ts registers the live City here. Everything defaults to "no effect" while City Hall is offline.
 */
import { randomUUID } from 'node:crypto';
import { LEVERS, TREASURY_CAP, isExcludedName, type LeverId, type PerkId, type Sector } from '../shared/city.js';

type Stmt = { sql: string; args: unknown[] };
export interface CityRates { lever(id: LeverId): number; policyMul(s: Sector): number; perk(p: PerkId): number }
let cityInst: CityRates | null = null;
export const setCityRates = (c: CityRates | null) => { cityInst = c; };
const playerKey = (name: string) => name.replace(/\s+/g, ' ').trim().toLowerCase();

/** QA / guest / bot names are out of city politics. CITY_DEV_ALLOW_QA=1 lets QA accounts in for local screenshots; ignored in production. */
export const politicsExcluded = (name: string) => {
  if (process.env.CITY_DEV_ALLOW_QA === '1' && process.env.NODE_ENV !== 'production' && /^qa[-_ ]/i.test(name.trim())) return false;
  return isExcludedName(name) || playerKey(name).startsWith('qa-');
};

/** Statements that credit the treasury (capped). Callers append them to the SAME transaction as the debit that funds them. */
export function treasuryCreditStmts(kind: string, amount: number, memo: string, at: number, id: string = randomUUID()): Stmt[] {
  const a = Math.floor(amount); if (!(a > 0)) return [];
  return [
    { sql: 'UPDATE city_treasury SET balance = CASE WHEN balance + $1::bigint > $2::bigint THEN $2::bigint ELSE balance + $1::bigint END WHERE id = \'main\'', args: [a, TREASURY_CAP] },
    { sql: 'INSERT INTO city_treasury_ledger (id, at, kind, amount, balance, memo) SELECT $1::text, $2::bigint, $3::text, $4::bigint, balance, $5::text FROM city_treasury WHERE id = \'main\'', args: [id, at, kind, a, memo.slice(0, 200)] },
  ];
}

/** Hot-path readers. All default to "no effect" when City Hall is offline. */
export const citySalesTaxRate = () => cityInst?.lever('sales_tax') ?? 0;
export const cityWealthTaxRate = () => cityInst?.lever('wealth_tax') ?? LEVERS.wealth_tax.base;
/** Property surcharge in percent per 1,000 owned (lever stored as a fraction: 0.01 -> 1). Offline -> the built-in rule. */
export const citySurchargePctPer1k = () => Math.round((cityInst?.lever('property_surcharge') ?? LEVERS.property_surcharge.base) * 10_000) / 100;
/** Daily net-worth wealth tax rate (fraction). Offline -> the built-in 1%. */
export const cityDailyWealthTaxRate = () => cityInst?.lever('daily_wealth_tax') ?? LEVERS.daily_wealth_tax.base;
export const cityFreightMul = () => (cityInst?.lever('freight') ?? 1) * (1 - (cityInst?.perk('freight_fee') ?? 0));
export const cityPolicyMul = (s: Sector) => cityInst?.policyMul(s) ?? 1;
export const cityPerk = (p: PerkId) => cityInst?.perk(p) ?? 0;
/** Tourism push policy x Transit Hub perk on a travel ticket (indexed chips in, chips out). */
export const cityTicketPrice = (chips: number) => (chips > 0 ? Math.max(1, Math.round(chips * cityPolicyMul('tourism') * (1 - cityPerk('ticket')))) : chips);
/** Market / Stock Exchange fee factor from policy + school (multiplies the mayor's fee rate). */
export const cityTradeFeeMul = () => cityPolicyMul('trading') * (1 - cityPerk('trade_fee'));
/** Treasury credit statements for a payer, or [] (burned) when City Hall is offline or the payer is QA / guest / bot. */
export function treasuryStmtsFor(payer: string, kind: string, amount: number, memo: string): Stmt[] {
  if (!cityInst || isExcludedName(payer) || playerKey(payer).startsWith('qa-')) return [];
  return treasuryCreditStmts(kind, amount, memo, Date.now());
}
/** Sales-tax wallet move + treasury statements for a game-shop purchase (empty when the rate is 0). */
export function salesTaxFor(buyer: string, price: number, purchaseKey: string, what: string): { tax: number; move: { name: string; amount: number; key: string; game: string; memo: string } | null; stmts: Stmt[] } {
  const rate = citySalesTaxRate(); const tax = price >= 100 && rate > 0 ? Math.ceil(price * Math.min(LEVERS.sales_tax.max, rate) - 1e-6) : 0;
  if (!tax) return { tax: 0, move: null, stmts: [] };
  const memo = `Sales tax ${+(rate * 100).toFixed(2)}% on ${what}`;
  return { tax, move: { name: buyer, amount: -tax, key: `sales_tax:${purchaseKey}`, game: 'sales_tax', memo }, stmts: treasuryStmtsFor(buyer, 'sales_tax', tax, memo) };
}

