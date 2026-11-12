/** Release-backed implementation metadata, not a vote or mutation of the permanent original bill.
 * Exact original identity is required; never match only on a bill number.
 * No policy is executed from this text. The referenced release already implemented these rules.
 */
import { createHash } from 'node:crypto';
import type { BillImplementation } from '../shared/mayorLaws.js';
import { BILL3_IDENTITY_SHA256, BILL3_IMPLEMENTATION_TEXT } from '../shared/bill3.js';

const BILL1_IDENTITY_SHA256 = 'a08f7b849a6f7399eb9d3523b7d08c1c77d16364c5ae31a503c87ba3f2b61d71';
const BILL1: Readonly<BillImplementation> = Object.freeze({ status: 'enacted', revision: 1,
  implementedAt: 1794170308521, release: 'fc56eedcc90c5008b53d0c13319a15649c66e82f',
  text: "Future property purchases have no property purchase surcharge; the mayor cannot re-enable it. New acquisitions are limited separately to 5 residential deeds and 5 commercial deeds per citizen. Commercial includes barns and all shop, factory and other landmark deeds. Farmland, including farm plots, fields, Big Farms and plantations, is limited to 1,500 full-plot tiles per citizen. Existing holdings are grandfathered, including holdings above a cap; zoning caps do not force sales or confiscation, but block additional acquisitions in that category. Resort lots and land patches are exempt. No prior surcharge refunds are issued. Base prices, the price index, purchase and daily wealth-tax rules and rates, ordinary property-tax rules, historical paid/city basis and sell-back rules are unchanged."
});

/** Filled with the implementing commit SHA after it is recorded. */
export const BILL3_RELEASE = 'release-queue';
const BILL3: Readonly<BillImplementation> = Object.freeze({ status: 'enacted', revision: 1,
  implementedAt: 0, release: BILL3_RELEASE, text: BILL3_IMPLEMENTATION_TEXT
});

function bill1Identity(r: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify([String(r.number), r.day, r.text, r.by_name, r.mayor_key, r.term_week, Number(r.at)])).digest('hex');
}
/** Official Bill 3: SHA-256 of JSON.stringify([number, day, text, by_name, at]). */
export function bill3Identity(r: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify([String(r.number), r.day, r.text, r.by_name, Number(r.at)])).digest('hex');
}

function cleanPending(r: Record<string, unknown>): boolean {
  return r.status === 'pending' && r.vetoed_at == null && r.vetoed_by_key == null && r.vetoed_by_name == null && r.vetoed_role == null && r.vetoed_term_week == null;
}

export function implementationOf(r: Record<string, unknown>): BillImplementation | undefined {
  if (!cleanPending(r)) return undefined;
  if (bill1Identity(r) === BILL1_IDENTITY_SHA256) return { ...BILL1 };
  if (bill3Identity(r) === BILL3_IDENTITY_SHA256) return { ...BILL3, implementedAt: BILL3.implementedAt || Number(r.at) };
  return undefined;
}
