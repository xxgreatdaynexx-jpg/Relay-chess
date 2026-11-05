/**
 * Property back-tax (Dayne, Nov 4 2026). Until this fix the land surcharge was priced on the LIST price of what a buyer
 * owned, so anyone whose holdings had been bought with a surcharge was under-counted (e.g. 66,406 list vs 136K paid).
 * The base is now price paid + upgrades (same as the 5% purchase wealth tax). Players who bought under the old base
 * owe the difference before they can buy more property or cars.
 *
 * Replay (per player, in ledger order, only events before BACKTAX_CUTOFF):
 *   holdings: property_buy adds {id: paid}; property_sell and repossession (property_tax table) remove the id.
 *   For each buy:  base = sum of paid prices held just before it (upgrades NOT reconstructed: under-counts, in the
 *                  player's favour); list = paid / old multiplier (old base parsed from the memo "you own N in property",
 *                  0 when no memo note);  should = landPrice(list, base).
 *   surcharge owed = max(0, should − paid)                               (sink, burned like the surcharge itself)
 *   wealth tax owed = max(0, purchaseTaxOf(base, should) − tax actually charged on that buy), only for buys after the
 *                  wealth tax went live (WTAX_START)                         (shared with active players, like the tax)
 *   debt = Σ owed − Σ back-tax already paid (ledger game property_backtax). QA / guest / bot accounts owe nothing.
 * Pay-off is one atomic transferAtomic: key property_backtax:<player>:<payments so far> so a double-click/replay can't
 * charge twice.
 */
import { landPrice, landMultiplier, propertyById } from '../shared/realEstate.js';
import { purchaseTaxOf, purchaseShares } from '../shared/purchaseTax.js';
import { junk, recipientsFor } from './purchase-tax.js';

type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: any[] }> };
export const BACKTAX_GAME = 'property_backtax';
export const BACKTAX_SHARE_GAME = 'property_backtax_share';
export const BACKTAX_CUTOFF = Date.parse('2026-11-05T01:30:00Z'); // buys after the fix ships are priced on the new base
export const WTAX_START = Date.parse('2026-11-04T17:28:00Z');      // 0ddf69f, purchase wealth tax
const keyOf = (n: string) => n.replace(/\s+/g, ' ').trim().toLowerCase();

export type BackTax = { debt: number; surcharge: number; wealthTax: number; paid: number; buys: number };
const ZERO: BackTax = { debt: 0, surcharge: 0, wealthTax: 0, paid: 0, buys: 0 };

export async function backTaxOf(db: Q, name: string): Promise<BackTax> {
  if (junk(name) || keyOf(name).startsWith('qa-')) return ZERO;
  const k = keyOf(name);
  // A missing read must never look like a clean ledger. Callers use this to gate purchases.
  let led: any[]; let repo: any[];
  try {
    led = (await db.query(`SELECT id, tx_key, game, amount, memo, created_at FROM wallet_transactions WHERE player_key = $1 AND game IN ('property_buy','property_sell','wealth_tax_buy','${BACKTAX_GAME}') ORDER BY id`, [k])).rows;
    repo = (await db.query('SELECT property_id, at FROM property_tax WHERE owner_key = $1 AND repossessed = true', [k])).rows;
  } catch (e) {
    throw new BackTaxError('Could not verify property back-tax. Please try again.', { cause: e });
  }
  const taxByKey = new Map<string, number>(); let paid = 0;
  for (const r of led) { if (r.game === 'wealth_tax_buy') taxByKey.set(String(r.tx_key).replace(/^wealth_tax_buy:/, ''), -Number(r.amount)); if (r.game === BACKTAX_GAME) paid += -Number(r.amount); }
  const repos = repo.map((r) => ({ id: String(r.property_id), at: Number(r.at) })).sort((a, b) => a.at - b.at);
  const held = new Map<string, number>(); let surcharge = 0, wtax = 0, buys = 0;
  const idOf = (memo: string) => { const m = [...(memo ?? '').matchAll(/\(([^()]+)\)/g)].map((x) => x[1]!); return m.find((x) => propertyById(x)) ?? m.at(-1) ?? ''; };
  for (const r of led) {
    const at = new Date(r.created_at).getTime(); if (at >= BACKTAX_CUTOFF) break;
    while (repos.length && repos[0]!.at <= at) held.delete(repos.shift()!.id);
    const memo = String(r.memo ?? ''); const id = idOf(memo);
    if (r.game === 'property_sell') { held.delete(id); continue; }
    if (r.game !== 'property_buy') continue;
    const pricePaid = -Number(r.amount); if (!(pricePaid > 0)) continue;
    const base = [...held.values()].reduce((a, b) => a + b, 0);
    const old = Number((/you own ([\d,]+) in property/.exec(memo)?.[1] ?? '0').replace(/,/g, ''));
    const list = propertyById(id) ? Math.round(pricePaid / landMultiplier(old)) : pricePaid;
    const should = landPrice(list, base);
    const s = Math.max(0, should - pricePaid);
    const w = at >= WTAX_START ? Math.max(0, purchaseTaxOf(base, should) - (taxByKey.get(String(r.tx_key)) ?? 0)) : 0;
    if (s + w > 0) buys++;
    surcharge += s; wtax += w; held.set(id, pricePaid);
  }
  const owed = surcharge + wtax; const debt = Math.max(0, owed - paid);
  // apply what was paid to the surcharge part first (sink), the rest to the wealth-tax part
  const remS = Math.max(0, surcharge - paid); const remW = debt - remS;
  return { debt, surcharge: remS, wealthTax: remW, paid, buys };
}

export class BackTaxError extends Error {}
export const backTaxBlockMsg = (b: BackTax) => `You owe ${b.debt.toLocaleString('en-US')} chips in property back-tax (surcharge under-charged before Nov 4). Pay it on any deed to buy more property or cars.`;

/** Moves for paying the whole debt (empty when nothing is owed). Keyed by payment count: replay-safe. */
export async function backTaxMoves(db: Q, name: string, now = Date.now()) {
  const b = await backTaxOf(db, name); if (!b.debt) return { b, moves: [] as Array<{ name: string; amount: number; key: string; game: string; memo?: string }> };
  const n = Number((await db.query(`SELECT COUNT(*) n FROM wallet_transactions WHERE player_key = $1 AND game = '${BACKTAX_GAME}'`, [keyOf(name)])).rows[0]?.n ?? 0);
  const key = `${BACKTAX_GAME}:${keyOf(name)}:${n}`;
  const moves: Array<{ name: string; amount: number; key: string; game: string; memo?: string }> = [{ name, amount: -b.debt, key, game: BACKTAX_GAME, memo: `Property back-tax: ${b.surcharge.toLocaleString('en-US')} surcharge + ${b.wealthTax.toLocaleString('en-US')} wealth tax` }];
  if (b.wealthTax > 0) {
    const rec = await recipientsFor(db, name, now);
    if (rec.length) { const byKey = new Map(rec.map((x) => [x.key, x.name])); for (const s of purchaseShares(b.wealthTax, rec.map((x) => x.key))) if (s.amount > 0) moves.push({ name: byKey.get(s.name)!, amount: s.amount, key: `${BACKTAX_SHARE_GAME}:${key}:${s.name}`, game: BACKTAX_SHARE_GAME, memo: 'Wealth tax share (property back-tax)' }); }
  }
  return { b, moves };
}
