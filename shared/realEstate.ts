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
 * Farmland (Farm district, shared/farm.ts): 180 per tile + 500, rounded to 500 (4x4 = 3,500 ... 12x10 = 22,000).
 */
import { cityFill, landmarks, LANDMARK_IDS, type OBB } from './worldLayout.js';
import { HOUSING_TYPES } from './housing.js';
import { farmPlots, farmPrice, plotId } from './farm.js';
import { fieldPlots, fieldPlotId } from './fieldFarms.js';
import { resortLots, resortPlots, resortPlotId, resortFarmPrice } from './resort.js';
import { countryHomes, countryBusinesses, businessType, COMMERCIAL_PRICE, COMMERCIAL_LABEL } from './outskirts.js';

export const TAX_RATE = 0.005;
export const SELL_BACK = 0.7;
export const GRACE_DAYS = 3;
export const BASE_PRICE: Record<string, number> = { lot: 8_000, park: 20_000, plaza: 25_000, house: 15_000, rowhouse: 30_000, apartment: 60_000, tower: 150_000 };
export const LANDMARK_PRICE: Record<string, number> = {
  casino: 2_000_000, bank: 2_000_000, stocks: 1_500_000, arena: 1_000_000, chess: 1_000_000, market: 1_000_000,
  factory: 750_000, mine: 750_000, 'mine-frost': 750_000, 'mine-magma': 750_000, warehouse: 500_000, leaderboard: 500_000, chat: 500_000, dealer: 750_000, mechanic: 600_000, airport: 3_000_000, racetrack: 1_500_000, dock: 600_000, employ: 600_000,
};
export const LANDMARK_LABEL: Record<string, string> = {
  casino: 'Casino', bank: 'Bank', stocks: 'Stock Exchange', arena: 'Arena', chess: 'Chess Club', market: 'Market',
  factory: 'Factory', mine: 'Mine', 'mine-frost': 'Frostbite Caverns', 'mine-magma': 'Magma Depths', warehouse: 'Warehouse', leaderboard: 'Leaderboard', chat: 'Chat Hall', dealer: 'Car Dealership', mechanic: 'Mechanic Shop', airport: 'Chud Hub International Airport', racetrack: 'Chud Hub Speedway', dock: 'Fishing Dock', employ: 'Employment Office',
};
const PATCH_LABEL: Record<string, string> = { lot: 'Empty lot', park: 'Park', plaza: 'Plaza' };
const PATCH_REF: Record<string, number> = { lot: 13 * 13 * 0.95, park: 13 * 13 * 0.95, plaza: 81 * 0.95 };

export type PropertyKind = 'building' | 'patch' | 'landmark' | 'farm';
export interface Property extends OBB { id: string; kind: PropertyKind; type: string; label: string; price: number; h?: number; map?: 'resort' }

const clamp = (x: number) => Math.min(1.25, Math.max(0.8, x));
const round500 = (n: number) => Math.max(500, Math.round(n / 500) * 500);
const pos = (b: OBB) => `${Math.round(b.x * 10)}:${Math.round(b.z * 10)}`;
export const taxOf = (price: number) => Math.ceil(price * TAX_RATE);
export const sellBackOf = (price: number) => Math.floor(price * SELL_BACK);
/** Land surcharge (pt1388u, replaces the old ×1.5-per-parcel growth): the next purchase costs list × (1 + surcharge),
 * surcharge % = SURCHARGE_PCT_PER_1K × (total list value of the properties the buyer already owns ÷ 1,000). No cap.
 * Owning nothing = 0%. A 5,000 farm owned = +10%; 100,000 owned = +200%. Tax stays on the list price; sell-back is 70% of
 * what was actually paid. Trailer Park lots are separate and free. Tune here. */
export const SURCHARGE_PCT_PER_1K = 2;
/** Surcharge percent for a buyer whose owned properties are worth ownedValue (list prices). */
export const landSurchargePct = (ownedValue: number) => Math.max(0, ownedValue) / 1000 * SURCHARGE_PCT_PER_1K;
export const landMultiplier = (ownedValue: number) => 1 + landSurchargePct(ownedValue) / 100;
export const landPrice = (listPrice: number, ownedValue: number) => Math.round(listPrice * landMultiplier(ownedValue));
const pctText = (ownedValue: number) => `+${+landSurchargePct(ownedValue).toFixed(1)}%`;
/** "+10% surcharge: you own 5,000 in property" (empty when you own none). */
export const landMultiplierNote = (ownedValue: number) => ownedValue > 0 ? `${pctText(ownedValue)} surcharge: you own ${Math.round(ownedValue).toLocaleString('en-US')} in property` : '';

/** Civic buildings are not for sale (City Hall belongs to the city). */
export const CIVIC_IDS = new Set(['cityhall']);
let cache: Property[] | null = null; let byId: Map<string, Property> | null = null;
/** Every property on the map (deterministic: same layout -> same ids and prices). */
export function properties(): Property[] {
  if (cache) return cache;
  const { houses, patches } = cityFill(7); const out: Property[] = [];
  for (const [id, b] of Object.entries(landmarks())) if (LANDMARK_IDS.includes(id) && !CIVIC_IDS.has(id)) out.push({ ...b, id: `lm:${id}`, kind: 'landmark', type: id, label: LANDMARK_LABEL[id] ?? id, price: LANDMARK_PRICE[id] ?? 500_000 });
  for (const h of [...houses, ...countryHomes()]) {
    const t = HOUSING_TYPES.find((x) => x.id === h.type); if (!t) continue;
    const ref = ((t.w[0] + t.w[1]) / 2) * ((t.d[0] + t.d[1]) / 2), midH = ((t.floors[0] + t.floors[1]) / 2) * t.floorH;
    const price = round500((BASE_PRICE[t.id] ?? 15_000) * clamp((h.w * h.d) / ref) * clamp(h.h / midH));
    out.push({ x: h.x, z: h.z, w: h.w, d: h.d, rot: h.rot, h: h.h, id: `b:${t.id}:${pos(h)}`, kind: 'building', type: t.id, label: t.label, price });
  }
  for (const p of patches) out.push({ x: p.x, z: p.z, w: p.w, d: p.d, rot: p.rot, id: `p:${p.kind}:${pos(p)}`, kind: 'patch', type: p.kind, label: PATCH_LABEL[p.kind] ?? p.kind, price: round500(BASE_PRICE[p.kind]! * clamp((p.w * p.d) / PATCH_REF[p.kind]!)) });
  // Farm district (shared/farm.ts): farmland plots, priced by tile count.
  for (const f of farmPlots()) out.push({ x: f.x, z: f.z, w: f.w, d: f.d, rot: 0, id: plotId(f.n), kind: 'farm', type: 'farmland', label: `Farm plot #${f.n} (${f.cols}×${f.rows})`, price: farmPrice(f.cols * f.rows) });
  // Countryside crop fields (shared/fieldFarms.ts): the same farm system, priced by tile count like farmland.
  for (const f of fieldPlots()) out.push({ x: f.x, z: f.z, w: f.w, d: f.d, rot: 0, id: fieldPlotId(f.n), kind: 'farm', type: 'farmland', label: `Countryside field #${f.n + 1} (${f.cols}×${f.rows})`, price: farmPrice(f.cols * f.rows) });
  // Countryside businesses (shared/outskirts.ts): gas stations and warehouses, fixed prices.
  for (const b of countryBusinesses()) { const t = businessType(b); out.push({ x: b.x, z: b.z, w: b.w, d: b.d, rot: b.rot, h: b.h, id: `b:${t}:${pos(b)}`, kind: 'building', type: t, label: COMMERCIAL_LABEL[t]!, price: COMMERCIAL_PRICE[t]! }); }
  // Chud Resort (shared/resort.ts): its own map, only buyable while you are there (server-enforced).
  for (const l of resortLots()) out.push({ x: l.x, z: l.z, w: l.w, d: l.d, rot: l.rot, h: l.h, id: l.id, kind: 'building', type: l.type, label: l.label, price: l.price, map: 'resort' });
  for (const f of resortPlots()) out.push({ x: f.x, z: f.z, w: f.w, d: f.d, rot: 0, id: resortPlotId(f.n), kind: 'farm', type: 'plantation', label: `Plantation plot #${f.n} (${f.cols}×${f.rows})`, price: resortFarmPrice(f.cols * f.rows), map: 'resort' });
  cache = out; byId = new Map(out.map((p) => [p.id, p])); return out;
}
export const propertyById = (id: unknown): Property | undefined => { properties(); return typeof id === 'string' ? byId!.get(id) : undefined; };
/** Stable id of a map building / patch (for the picker). */
export const buildingId = (type: string, b: OBB) => `b:${type}:${pos(b)}`;
export const patchId = (kind: string, b: OBB) => `p:${kind}:${pos(b)}`;

export interface OwnedProperty { id: string; owner: string; price: number; arrears: number; boughtAt: number }

/** Worker cap from property (pt1344u): each owned building or landmark adds Employment Office hire slots, by its base
 * (un-indexed) list price. Empty lots, parks, plazas, farmland and plantation plots add none (they are land, not housing).
 *   under 25,000 (detached home)                       +1
 *   25,000 – 74,999 (row houses, apartment, gas station, beach house) +2
 *   75,000 – 249,999 (tower, depot, condo, villa)      +3
 *   250,000+ (hotel, landmarks)                        +4
 * Bonuses from all owned properties add up, capped at +WORKER_BONUS_MAX. */
export const WORKER_BONUS_MAX = 7;
export const workerBonusOf = (id: unknown): number => {
  const p = propertyById(id); if (!p || (p.kind !== 'building' && p.kind !== 'landmark')) return 0;
  return p.price < 25_000 ? 1 : p.price < 75_000 ? 2 : p.price < 250_000 ? 3 : 4;
};
export const workerBonusTotal = (ids: Iterable<unknown>): number => { let n = 0; for (const id of ids) n += workerBonusOf(id); return Math.min(WORKER_BONUS_MAX, n); };
