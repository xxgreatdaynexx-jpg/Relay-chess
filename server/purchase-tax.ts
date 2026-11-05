/**
 * Purchase wealth tax (shared/purchaseTax.ts for the rule). purchaseTaxMoves() returns the extra wallet moves (buyer
 * debit + one credit per recipient) that the caller appends to its own transferAtomic call, so the tax, the shares and
 * the purchase itself commit in ONE Postgres transaction or not at all. Keys derive from the purchase's own key
 * (`wealth_tax_buy:<purchaseKey>`, `wealth_tax_share:<purchaseKey>:<player>`), so a replayed purchase can never pay twice.
 * Recipient credits are batched (CasinoBank.transferAtomic { batch: true }): 3 statements for any number of players.
 */
import { cityWealthTaxRate } from './city-rates.js';
import { isJailed } from './jail.js';
import { getEconomy } from './economy.js';
import { isDisabledName } from '../shared/disabled.js';
import { TAX_SHARE_MIN_NET_WORTH } from '../shared/wealthTax.js';
import { propertyPaidPlusUpgradesOf } from './realEstate.js';
import { isQaName } from '../shared/qa.js';
import { PURCHASE_SHARE_GAME, PURCHASE_TAX_GAME, purchaseShares, purchaseTaxLine, purchaseTaxOf, type PurchaseTaxQuote } from '../shared/purchaseTax.js';

type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: any[] }> };
type Move = { name: string; amount: number; key: string; game: string; memo?: string };
const DAY = 86_400_000;
const keyOf = (n: string) => n.replace(/\s+/g, ' ').trim().toLowerCase();
const junk = (n: string) => isQaName(n) || /^guest/i.test(n.trim()) || /^bot(?![a-z])/i.test(n.trim());

/** Wealth-tax threshold: property at price paid + upgrades held (shared propertyPaidPlusUpgrades; planted seed NOT counted). */
export async function propertyPaidValue(db: Q, name: string): Promise<number> { return propertyPaidPlusUpgradesOf(db, name); }

let cache: { at: number; rows: Array<{ key: string; name: string; netWorth: number }> } | null = null;
export const resetPurchaseTaxCache = () => { cache = null; };
/** Active players (any ledger row in 7 days), sorted by key, junk excluded. Cached 60 s: the ledger scan is the costly part. */
async function activePlayers(db: Q, now: number) {
  if (cache && now - cache.at < 60_000 && now >= cache.at) return cache.rows;
  const r = await db.query(`SELECT DISTINCT ON (player_key) player_key, name FROM wallet_transactions WHERE created_at >= to_timestamp($1/1000.0) ORDER BY player_key, id DESC`, [now - 7 * DAY]);
  const base = r.rows.map((x) => ({ key: String(x.player_key), name: String(x.name) })).filter((x) => !junk(x.name) && !x.key.startsWith('qa-'));
  // Net worth = chips + assets, the same definition as the profile / daily wealth tax (economy.playerAssets total).
  const chips = new Map<string, number>();
  if (base.length) for (const c of (await db.query('SELECT player_key, chips FROM casino_players WHERE player_key = ANY($1)', [base.map((x) => x.key)])).rows) chips.set(String(c.player_key), Number(c.chips));
  const econ = getEconomy(); const rows: Array<{ key: string; name: string; netWorth: number }> = [];
  for (const x of base) rows.push({ ...x, netWorth: (chips.get(x.key) ?? 0) + ((await econ?.playerAssets(x.name, now))?.total ?? 0) });
  cache = { at: now, rows }; return rows;
}
/** Jail and disabled are checked live (not cached). Recipients need net worth >= TAX_SHARE_MIN_NET_WORTH (5,000). */
export async function recipientsFor(db: Q, buyer: string, now: number) {
  const k = keyOf(buyer);
  return (await activePlayers(db, now)).filter((x) => x.key !== k && keyOf(x.name) !== k && !isJailed(x.name) && !isDisabledName(x.name) && !isDisabledName(x.key) && x.netWorth >= TAX_SHARE_MIN_NET_WORTH);
}

export async function quotePurchaseTax(db: Q, buyer: string, price: number, now = Date.now()): Promise<PurchaseTaxQuote> {
  const propertyValue = await propertyPaidValue(db, buyer); const rate = cityWealthTaxRate(); let tax = purchaseTaxOf(propertyValue, price, rate); let n = 0;
  if (tax > 0) { n = (await recipientsFor(db, buyer, now)).length; if (!n) tax = 0; }
  return { tax, recipients: n, propertyValue, line: tax ? purchaseTaxLine(tax, n, rate) : '' };
}

/** Extra moves for one purchase. Empty when untaxed. what = short item label for the memos. */
export async function purchaseTaxMoves(db: Q, buyer: string, price: number, purchaseKey: string, what: string, now = Date.now()): Promise<{ tax: number; recipients: number; moves: Move[]; line: string }> {
  const q = await quotePurchaseTax(db, buyer, price, now); if (!q.tax) return { tax: 0, recipients: 0, moves: [], line: '' };
  const rec = await recipientsFor(db, buyer, now);
  const shares = purchaseShares(q.tax, rec.map((x) => x.key)); const byKey = new Map(rec.map((x) => [x.key, x.name]));
  const moves: Move[] = [{ name: buyer, amount: -q.tax, key: `${PURCHASE_TAX_GAME}:${purchaseKey}`, game: PURCHASE_TAX_GAME, memo: `${purchaseTaxLine(q.tax, rec.length, cityWealthTaxRate())} (on ${what})` }];
  for (const s of shares) moves.push({ name: byKey.get(s.name)!, amount: s.amount, key: `${PURCHASE_SHARE_GAME}:${purchaseKey}:${s.name}`, game: PURCHASE_SHARE_GAME, memo: `Wealth tax share: a player holding 100K+ in property paid the purchase wealth tax` });
  return { tax: q.tax, recipients: rec.length, moves, line: q.line };
}
