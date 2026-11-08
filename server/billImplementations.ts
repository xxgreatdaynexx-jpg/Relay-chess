/** Release-backed implementation metadata, not a vote or mutation of the permanent original bill.
 * Exact full original identity (including author, term, timestamp and text) is required; never match only Bill 1.
 * No policy is executed from this text. The referenced release already implemented these rules.
 */
import { createHash } from 'node:crypto';
import type { BillImplementation } from '../shared/mayorLaws.js';
const ORIGINAL_IDENTITY_SHA256 = "a08f7b849a6f7399eb9d3523b7d08c1c77d16364c5ae31a503c87ba3f2b61d71";
const IMPLEMENTATION: Readonly<BillImplementation> = Object.freeze({ status: 'enacted', revision: 1,
  implementedAt: 1794170308521, release: 'fc56eedcc90c5008b53d0c13319a15649c66e82f',
  text: "Future property purchases have no property purchase surcharge; the mayor cannot re-enable it. New acquisitions are limited separately to 5 residential deeds and 5 commercial deeds per citizen. Commercial includes barns and all shop, factory and other landmark deeds. Farmland, including farm plots, fields, Big Farms and plantations, is limited to 1,500 full-plot tiles per citizen. Existing holdings are grandfathered, including holdings above a cap; zoning caps do not force sales or confiscation, but block additional acquisitions in that category. Resort lots and land patches are exempt. No prior surcharge refunds are issued. Base prices, the price index, purchase and daily wealth-tax rules and rates, ordinary property-tax rules, historical paid/city basis and sell-back rules are unchanged."
});
export function implementationOf(r: Record<string, unknown>): BillImplementation | undefined {
  if (r.status !== 'pending' || r.vetoed_at != null || r.vetoed_by_key != null || r.vetoed_by_name != null || r.vetoed_role != null || r.vetoed_term_week != null) return undefined;
  const identity = [String(r.number), r.day, r.text, r.by_name, r.mayor_key, r.term_week, Number(r.at)];
  if (createHash('sha256').update(JSON.stringify(identity)).digest('hex') !== ORIGINAL_IDENTITY_SHA256) return undefined;
  return { ...IMPLEMENTATION };
}
