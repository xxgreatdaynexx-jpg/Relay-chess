/**
 * City real estate: every building, lot, park and plaza on the World Map is a property with a stable id, a list price
 * and a daily property tax. Landmarks are trophy properties: buying one is prestige only (the building stays open to
 * every player). Trailer Park (Chud Acres) lots are not properties: they stay free and auto-assigned.
 *
 * Price table (chips, before the size factor):
 *   Empty lot 8,000 · Park 20,000 · Plaza 25,000
 *   Detached home 15,000 · Row houses 30,000 · Apartment block 60,000 · Residential tower 150,000
 *   Landmarks: Casino / Bank 2,000,000 · Stock Exchange 1,500,000 · Arena / Chess Club / Market 1,000,000
 *              Factory / Mine 750,000 · Warehouse / Leaderboard / Chat 500,000
 * Size factor (buildings, lots, parks, plazas): footprint area vs the type's mid-size footprint, and floors vs the mid
 * floor count for buildings, each clamped to 0.8..1.25. Rounded to 500. Landmarks have a fixed price.
 * Tax: 0.5% of list price per UTC day (rounded up), charged once a day. 3 unpaid days in a row = repossessed, no refund.
 * Sell back to the city: 70% of list price.
 */
import { cityFill, landmarks, LANDMARK_IDS, type OBB } from './worldLayout.js';
import { HOUSING_TYPES } from './housing.js';

export const TAX_RATE = 0.005;
export const SELL_BACK = 0.7;
export const GRACE_DAYS = 3;
export const BASE_PRICE: Record<string, number> = { lot: 8_000, park: 20_000, plaza: 25_000, house: 15_000, rowhouse: 30_000, apartment: 60_000, tower: 150_000 };
export const LANDMARK_PRICE: Record<string, number> = {
  casino: 2_000_000, bank: 2_000_000, stocks: 1_500_000, arena: 1_000_000, chess: 1_000_000, market: 1_000_000,
  factory: 750_000, mine: 750_000, warehouse: 500_000, leaderboard: 500_000, chat: 500_000,
};
export const LANDMARK_LABEL: Record<string, string> = {
  casino: 'Casino', bank: 'Bank', stocks: 'Stock Exchange', arena: 'Arena', chess: 'Chess Club', market: 'Market',
  factory: 'Factory', mine: 'Mine', warehouse: 'Warehouse', leaderboard: 'Leaderboard', chat: 'Chat Hall',
};
const PATCH_LABEL: Record<string, string> = { lot: 'Empty lot', park: 'Park', plaza: 'Plaza' };
const PATCH_REF: Record<string, number> = { lot: 13 * 13 * 0.95, park: 13 * 13 * 0.95, plaza: 81 * 0.95 };

export type PropertyKind = 'building' | 'patch' | 'landmark';
export interface Property extends OBB { id: string; kind: PropertyKind; type: string; label: string; price: number; h?: number }

const clamp = (x: number) => Math.min(1.25, Math.max(0.8, x));
const round500 = (n: number) => Math.max(500, Math.round(n / 500) * 500);
const pos = (b: OBB) => `${Math.round(b.x * 10)}:${Math.round(b.z * 10)}`;
export const taxOf = (price: number) => Math.ceil(price * TAX_RATE);
export const sellBackOf = (price: number) => Math.floor(price * SELL_BACK);

let cache: Property[] | null = null; let byId: Map<string, Property> | null = null;
/** Every property on the map (deterministic: same layout -> same ids and prices). */
export function properties(): Property[] {
  if (cache) return cache;
  const { houses, patches } = cityFill(7); const out: Property[] = [];
  for (const [id, b] of Object.entries(landmarks())) if (LANDMARK_IDS.includes(id)) out.push({ ...b, id: `lm:${id}`, kind: 'landmark', type: id, label: LANDMARK_LABEL[id] ?? id, price: LANDMARK_PRICE[id] ?? 500_000 });
  for (const h of houses) {
    const t = HOUSING_TYPES.find((x) => x.id === h.type); if (!t) continue;
    const ref = ((t.w[0] + t.w[1]) / 2) * ((t.d[0] + t.d[1]) / 2), midH = ((t.floors[0] + t.floors[1]) / 2) * t.floorH;
    const price = round500((BASE_PRICE[t.id] ?? 15_000) * clamp((h.w * h.d) / ref) * clamp(h.h / midH));
    out.push({ x: h.x, z: h.z, w: h.w, d: h.d, rot: h.rot, h: h.h, id: `b:${t.id}:${pos(h)}`, kind: 'building', type: t.id, label: t.label, price });
  }
  for (const p of patches) out.push({ x: p.x, z: p.z, w: p.w, d: p.d, rot: p.rot, id: `p:${p.kind}:${pos(p)}`, kind: 'patch', type: p.kind, label: PATCH_LABEL[p.kind] ?? p.kind, price: round500(BASE_PRICE[p.kind]! * clamp((p.w * p.d) / PATCH_REF[p.kind]!)) });
  cache = out; byId = new Map(out.map((p) => [p.id, p])); return out;
}
export const propertyById = (id: unknown): Property | undefined => { properties(); return typeof id === 'string' ? byId!.get(id) : undefined; };
/** Stable id of a map building / patch (for the picker). */
export const buildingId = (type: string, b: OBB) => `b:${type}:${pos(b)}`;
export const patchId = (kind: string, b: OBB) => `p:${kind}:${pos(b)}`;

export interface OwnedProperty { id: string; owner: string; price: number; arrears: number; boughtAt: number }
