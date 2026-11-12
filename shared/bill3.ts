/**
 * Bill Chud 3 implementation rules (release-backed). The original bill text stays archival on the official record.
 * Policy is executed by the referenced release, not by interpreting that original text.
 */
import { landmarks, type OBB } from './worldLayout.js';

/** Exact identity hash of the official Bill 3 row: SHA-256 of JSON.stringify([number, day, text, by_name, at]). */
export const BILL3_IDENTITY_SHA256 = 'd47fa37d76ba1f130e49c90a2d51bef0c006d6a43f461ea52e5a72f7ccaa2e29';
export const BILL3_NUMBER = '3';
export const BILL3_DAY = '2026-11-11';
export const BILL3_BY = 'carter2';
export const BILL3_AT = 1794436168678;

/** Public enacted wording (revised, exact terms). Does not replace the archival original. */
export const BILL3_IMPLEMENTATION_TEXT =
  'The Factory monument deed is retired and is no longer for sale or subject to buyouts. The recorded owner is refunded the purchase price on the deed in a one-time payout; royalties already paid are kept. The Factory building remains a public workplace and no longer pays monument royalties. ' +
  'Every citizen keeps the factory they already have, at no cost, grandfathered: it is not a new acquisition, does not count toward the commercial zoning cap, and adds no purchase or property-tax basis. Additional factories may be purchased as commercial deeds at the Factory list price of 750,000 chips (plus ordinary purchase wealth tax). Each additional factory is a separate plant at the public Factory, counts toward the 5-commercial cap, is taxed and sold back under ordinary property rules, and may be traded. The grandfathered first factory is not transferable. Existing holdings stay in place. ' +
  'Feature requests must be endorsed by both the sitting mayor and the sitting vice mayor before they are marked Approved by civic agreement. Administration of the request board, including maintenance and fixes, is unchanged. ' +
  'Citizens may trade real-estate deeds with each other at an agreed chip price, or by swapping deeds, within the recipient\'s zoning caps for each acquired deed. The city\'s 30% sell-back haircut does not apply to these trades. Deeds with arrears, and civic or retired deeds, cannot be traded.';

export const FACTORY_MONUMENT_ID = 'lm:factory';
export const FACTORY_MONUMENT_REFUND_KEY = 'bill3:factory-monument-refund:lm:factory';
export const FACTORY_MONUMENT_REFUND_GAME = 'factory_monument_refund';

/** Additional factory plants: scarce commercial deeds, like farm plots. The grandfathered first factory is not in this catalog. */
export const FACTORY_PLANT_TYPE = 'factory_plant';
export const FACTORY_PLANT_PRICE = 750_000; // same list price as the retired Factory monument
export const FACTORY_PLANT_COUNT = 12;
export const FACTORY_PLANT_N0 = 2;
export const factoryPlantId = (n: number) => `fac:${n}`;
export const isFactoryPlantId = (id: unknown): id is string => typeof id === 'string' && /^fac:[1-9]\d*$/.test(id) && Number(id.slice(4)) >= FACTORY_PLANT_N0 && Number(id.slice(4)) < FACTORY_PLANT_N0 + FACTORY_PLANT_COUNT;
export const factoryPlantN = (id: string) => Number(id.slice(4));
export const factoryPlantLabel = (n: number) => `Factory plant #${n}`;

export type FactoryPlantDeed = OBB & { id: string; kind: 'building'; type: typeof FACTORY_PLANT_TYPE; label: string; price: number; hidden: true };

/** Off-map commercial deeds parked at the public Factory so they have a stable origin, never drawn as lots. */
export function factoryPlants(): FactoryPlantDeed[] {
  const lm = landmarks().factory;
  const x = lm?.x ?? -65, z = lm?.z ?? 13;
  return Array.from({ length: FACTORY_PLANT_COUNT }, (_, i) => {
    const n = FACTORY_PLANT_N0 + i;
    return { x, z, w: 1, d: 1, rot: 0, id: factoryPlantId(n), kind: 'building' as const, type: FACTORY_PLANT_TYPE, label: factoryPlantLabel(n), price: FACTORY_PLANT_PRICE, hidden: true as const };
  });
}

export const PROPERTY_TRADE_EXPIRE_MS = 7 * 86_400_000;
export const propertyTradeId = () => `rt:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export type PropertyTradeStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
export interface PropertyTradeOffer {
  id: string;
  fromName: string;
  toName: string;
  giveIds: string[];
  wantIds: string[];
  giveChips: number;
  wantChips: number;
  status: PropertyTradeStatus;
  createdAt: number;
  closedAt?: number;
}

export function parseChipOffer(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 1_000_000_000) throw new Error('Chip amounts must be a whole number of chips from 0 to 1,000,000,000.');
  return v;
}

export function parseDeedList(v: unknown, label: string): string[] {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 8) throw new Error(`${label} can list at most 8 deeds.`);
  const out: string[] = [];
  for (const id of v) {
    if (typeof id !== 'string' || !id.trim() || id.length > 80) throw new Error(`Invalid ${label} deed.`);
    if (out.includes(id)) throw new Error(`Duplicate deed in ${label}.`);
    out.push(id);
  }
  return out;
}
