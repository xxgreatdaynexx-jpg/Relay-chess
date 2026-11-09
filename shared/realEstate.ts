import { JAIL_SITE, JAIL_HALF } from './jail.js';
import { HUB_MAPS } from './logistics.js';
import { farmBarns, barnPrice } from './farmBarns.js';
/**
 * City real estate: every building, lot, park and plaza on the World Map is a property with a stable id, a list price
 * and a daily property tax. Landmarks are trophy properties: buying one is prestige only (the building stays open to
 * every player). Trailer Park (Chud Acres) lots are not properties: they stay free and auto-assigned.
 *
 * Price table (chips, before the size factor):
 *   Empty lot 8,000 · Park 20,000 · Plaza 25,000
 *   Housing with 1/2/3 employee slots: 10,000 / 20,000 / 30,000 base, independent of footprint.
 *   Four-slot housing keeps its existing price. Legacy size-based references below preserve existing slot counts.
 *   Landmarks: Casino / Bank 2,000,000 · Stock Exchange 1,500,000 · Arena / Chess Club / Market 1,000,000
 *              Factory / Mine 750,000 · Warehouse / Leaderboard / Chat 500,000
 * Size factor (buildings, lots, parks, plazas): footprint area vs the type's mid-size footprint, and floors vs the mid
 * floor count for buildings, each clamped to 0.8..1.25. Rounded to 500. Landmarks have a fixed price.
 * Tax: 0.5% of list price per UTC day (rounded up), charged once a day. 3 unpaid days in a row = repossessed, no refund.
 * Sell back to the city: 70% of list price.
 * Farmland (Farm district, shared/farm.ts): 180 per tile + 500, rounded to 500 (4x4 = 3,500 ... 12x10 = 22,000).
 */
import { cityFill, landmarks, LANDMARK_IDS, obbOverlap, type OBB } from './worldLayout.js';
import { BUILDING_IDS, civicPad } from './city.js';
import { HOUSING_TYPES } from './housing.js';
import { farmPlots, farmPrice, plotId } from './farm.js';
import { propertyPaid } from './netWorth.js';
import { allFieldPlots, fieldPlotId, fieldPlotPrice, fieldPlotLabel } from './fieldFarms.js';
import { RESORT_TYPES, resortLots, resortPlots, resortPlotId, resortPlotPrice } from './resort.js';
import { countryHomes, countryBusinesses, businessType, COMMERCIAL_PRICE, COMMERCIAL_LABEL } from './outskirts.js';

export const TAX_RATE = 0.005;
export const SELL_BACK = 0.7;
export const GRACE_DAYS = 3;
/** Legacy size-based reference values: used to preserve canonical housing employee capacities before repricing. */
export const BASE_PRICE: Record<string, number> = { lot: 8_000, park: 20_000, plaza: 25_000, house: 15_000, rowhouse: 30_000, apartment: 60_000, tower: 150_000 };
export const LANDMARK_PRICE: Record<string, number> = {
  casino: 2_000_000, bank: 2_000_000, stocks: 1_500_000, arena: 1_000_000, chess: 1_000_000, market: 1_000_000,
  factory: 750_000, mine: 750_000, 'mine-frost': 750_000, 'mine-magma': 750_000, warehouse: 500_000, leaderboard: 500_000, chat: 500_000, dealer: 750_000, mechanic: 600_000, airport: 3_000_000, racetrack: 1_500_000, dock: 600_000, employ: 600_000, furniture: 600_000,
};
export const LANDMARK_LABEL: Record<string, string> = {
  casino: 'Casino', bank: 'Bank', stocks: 'Stock Exchange', arena: 'Arena', chess: 'Chess Club', market: 'Market',
  factory: 'Factory', mine: 'Mine', 'mine-frost': 'Frostbite Caverns', 'mine-magma': 'Magma Depths', warehouse: 'Warehouse', leaderboard: 'Leaderboard', chat: 'Chat Hall', dealer: 'Car Dealership', mechanic: 'Mechanic Shop', airport: 'Chud Hub International Airport', racetrack: 'Chud Hub Speedway', dock: 'Fishing Dock', employ: 'Employment Office', furniture: 'Furniture Store',
};
/** Chosen design prices: jail matches Factory/Mine; harbour matches Speedway (below Airport). Public services stay public. */
export const PUBLIC_SERVICE_DEEDS: Property[] = [
  { ...JAIL_SITE, w: JAIL_HALF.x * 2, d: JAIL_HALF.z * 2, id: 'lm:jail', kind: 'landmark', type: 'jail', label: 'City Jail', price: 750_000 },
  { x: HUB_MAPS.city.port.pier[0]![0] - 7, z: HUB_MAPS.city.port.pier[0]![1] - 7, w: 76, d: 16, rot: 0, id: 'lm:harbour', kind: 'landmark', type: 'harbour', label: 'Chud Hub Harbour', price: 1_500_000 },
];
const PATCH_LABEL: Record<string, string> = { lot: 'Empty lot', park: 'Park', plaza: 'Plaza' };
const PATCH_REF: Record<string, number> = { lot: 13 * 13 * 0.95, park: 13 * 13 * 0.95, plaza: 81 * 0.95 };

export type PropertyKind = 'building' | 'patch' | 'landmark' | 'farm';
export interface Property extends OBB { id: string; kind: PropertyKind; type: string; label: string; price: number; /** farmland: full plot cols × rows (zoning) */ tiles?: number; h?: number; map?: 'resort'; /** under a civic plot: never for sale again, drawn only while someone still owns it */ retired?: boolean; /** Housing capacity captured from its original canonical price band, never from its new price. */ housingEmployees?: number }

const clamp = (x: number) => Math.min(1.25, Math.max(0.8, x));
const round500 = (n: number) => Math.max(500, Math.round(n / 500) * 500);
const pos = (b: OBB) => `${Math.round(b.x * 10)}:${Math.round(b.z * 10)}`;
/**
 * THE value of an owned property everywhere (Bank totals, profile, wealth tax, Daily Report, Real estate panel, property
 * tax, economy totals -> house-sell cap): the price the owner actually paid (surcharged buy or hostile buyout included);
 * the current list price only when no paid price is recorded. The land surcharge on NEW buys stays on list prices.
 */
export function propertyValue(paid: number | null | undefined, list: number): number { return propertyPaid(paid, list); }
export const taxOf = (price: number) => Math.ceil(price * TAX_RATE);
/** Tess QA #8: property tax is on the price actually paid (buyouts can't dodge it; a surcharged buy pays on what it cost). */
export const taxBasisOf = (paid: number | null | undefined, list: number) => propertyValue(paid, list);
/**
 * Tess QA #7: the client's optimistic ownership after a buy/buyout. A buyout keeps the city's sell-back basis (what the
 * city was originally paid), so the deed's Sell-back matches what the server will refund (was: basis dropped -> 70% of the
 * buyout price shown, e.g. 840k instead of 420k on the Factory).
 */
export function optimisticOwn(prev: OwnedProperty | undefined, ev: 're_buy' | 're_buyout', id: string, me: string, paid: number, now: number): OwnedProperty {
  const basis = ev === 're_buyout' && prev ? (prev.basis ?? prev.price) : undefined;
  return { id, owner: me, price: paid, arrears: 0, boughtAt: now, ...(basis != null && basis !== paid ? { basis } : {}) };
}
export const sellBackOf = (price: number) => Math.floor(price * SELL_BACK);
/** Land surcharge (pt1388u, replaces the old ×1.5-per-parcel growth): the next purchase costs list × (1 + surcharge),
 * surcharge % = SURCHARGE_PCT_PER_1K × (total paid value plus upgrades of the properties the buyer already owns ÷ 1,000). No cap.
 * Owning nothing = 0%. A 5,000 farm owned = +5%; 100,000 owned = +100%. Tax policy is unchanged; sell-back is 70% of
 * what was actually paid. Trailer Park lots are separate and free. Tune here. */
// Dayne Nov 7: halve the surcharge rate, without changing the base or other taxes.
export const SURCHARGE_PCT_PER_1K = 1;
/** Surcharge percent for a buyer whose owned properties have paid value plus upgrades ownedValue. */
/** per1k = surcharge percent per 1,000 owned: the mayor's Property surcharge lever (pt2020u), default SURCHARGE_PCT_PER_1K. */
const per1kOf = (p?: number) => (typeof p === 'number' && Number.isFinite(p) && p >= 0 ? p : SURCHARGE_PCT_PER_1K);
export const landSurchargePct = (ownedValue: number, per1k?: number) => Math.max(0, ownedValue) / 1000 * per1kOf(per1k);
export const landMultiplier = (ownedValue: number, per1k?: number) => 1 + landSurchargePct(ownedValue, per1k) / 100;
export const landPrice = (listPrice: number, ownedValue: number, per1k?: number) => Math.round(listPrice * landMultiplier(ownedValue, per1k));
const pctText = (ownedValue: number, per1k?: number) => `+${+landSurchargePct(ownedValue, per1k).toFixed(1)}%`;
/** "+10% surcharge: you own 5,000 in property" (empty when you own none). */
export const landMultiplierNote = (ownedValue: number, per1k?: number) => ownedValue > 0 ? `${pctText(ownedValue, per1k)} surcharge: you own ${Math.round(ownedValue).toLocaleString('en-US')} in property` : '';

/** Civic buildings are not for sale (City Hall belongs to the city). */
export const CIVIC_IDS = new Set(['cityhall']);
/** City lot under a civic building plot (shared/city.ts CIVIC_PLOTS). Retired, not deleted: it keeps its id and catalog
 *  entry so an owner (even one who bought it during a rollout) keeps it, its value, tax and sell-back; it just can't be bought. */
export const civicRetired = (b: OBB) => BUILDING_IDS.some((id) => obbOverlap(civicPad(id), b, 1.5));
/** Original Employment Office price bands; non-housing property bonuses keep this exact rule. */
const employeesForPrice = (price: number) => price < 25_000 ? 1 : price < 75_000 ? 2 : price < 250_000 ? 3 : 4;
export const HOUSING_BASE_PER_EMPLOYEE = 10_000;
const housingTypes = new Set([...HOUSING_TYPES.map((t) => t.id), ...Object.keys(RESORT_TYPES)]);
export const isEmployeeHousing = (p: Pick<Property, 'kind' | 'type'>) => p.kind === 'building' && housingTypes.has(p.type);
let cache: Property[] | null = null; let byId: Map<string, Property> | null = null;
/** Every property on the map (deterministic: same layout -> same ids and prices). */
export function properties(): Property[] {
  if (cache) return cache;
  const { houses, patches } = cityFill(7); const out: Property[] = PUBLIC_SERVICE_DEEDS.map((p) => ({ ...p }));
  const NON_DEED_LANDMARKS = new Set(['mine-quarry']); // Stone Quarry: public manual mine only (chessguy2)
  for (const [id, b] of Object.entries(landmarks())) if (LANDMARK_IDS.includes(id) && !CIVIC_IDS.has(id) && !NON_DEED_LANDMARKS.has(id)) out.push({ ...b, id: `lm:${id}`, kind: 'landmark', type: id, label: LANDMARK_LABEL[id] ?? id, price: LANDMARK_PRICE[id] ?? 500_000 });
  for (const h of [...houses, ...countryHomes()]) {
    const t = HOUSING_TYPES.find((x) => x.id === h.type); if (!t) continue;
    const ref = ((t.w[0] + t.w[1]) / 2) * ((t.d[0] + t.d[1]) / 2), midH = ((t.floors[0] + t.floors[1]) / 2) * t.floorH;
    const price = round500((BASE_PRICE[t.id] ?? 15_000) * clamp((h.w * h.d) / ref) * clamp(h.h / midH));
    out.push({ x: h.x, z: h.z, w: h.w, d: h.d, rot: h.rot, h: h.h, id: `b:${t.id}:${pos(h)}`, kind: 'building', type: t.id, label: t.label, price, ...(civicRetired(h) ? { retired: true } : {}) });
  }
  for (const p of patches) out.push({ x: p.x, z: p.z, w: p.w, d: p.d, rot: p.rot, id: `p:${p.kind}:${pos(p)}`, kind: 'patch', type: p.kind, label: PATCH_LABEL[p.kind] ?? p.kind, price: round500(BASE_PRICE[p.kind]! * clamp((p.w * p.d) / PATCH_REF[p.kind]!)), ...(civicRetired(p) ? { retired: true } : {}) });
  // Separate barn deeds: never modify or confer ownership of the neighboring farm.
  for (const b of farmBarns()) out.push({ x: b.x, z: b.z, w: b.w, d: b.d, rot: b.rot, id: b.id, kind: 'building', type: 'barn', label: b.label, price: barnPrice(b) });
  // Farm district (shared/farm.ts): farmland plots, priced by tile count.
  for (const f of farmPlots()) out.push({ x: f.x, z: f.z, w: f.w, d: f.d, rot: 0, id: plotId(f.n), kind: 'farm', type: 'farmland', label: `Farm plot #${f.n} (${f.cols}×${f.rows})`, price: farmPrice(f.cols * f.rows), tiles: f.cols * f.rows });
  // Countryside crop fields (shared/fieldFarms.ts): the same farm system, priced by tile count like farmland.
  for (const f of allFieldPlots()) out.push({ x: f.x, z: f.z, w: f.w, d: f.d, rot: 0, id: fieldPlotId(f.n), kind: 'farm', type: 'farmland', label: fieldPlotLabel(f), price: fieldPlotPrice(f), tiles: f.cols * f.rows });
  // Countryside businesses (shared/outskirts.ts): gas stations and warehouses, fixed prices.
  for (const b of countryBusinesses()) { const t = businessType(b); out.push({ x: b.x, z: b.z, w: b.w, d: b.d, rot: b.rot, h: b.h, id: `b:${t}:${pos(b)}`, kind: 'building', type: t, label: COMMERCIAL_LABEL[t]!, price: COMMERCIAL_PRICE[t]! }); }
  // Chud Resort (shared/resort.ts): its own map, only buyable while you are there (server-enforced).
  for (const l of resortLots()) out.push({ x: l.x, z: l.z, w: l.w, d: l.d, rot: l.rot, h: l.h, id: l.id, kind: 'building', type: l.type, label: l.label, price: l.price, map: 'resort' });
  for (const f of resortPlots()) out.push({ x: f.x, z: f.z, w: f.w, d: f.d, rot: 0, id: resortPlotId(f.n), kind: 'farm', type: 'plantation', label: `${f.estate ? 'Estate plantation' : 'Plantation plot'} #${f.n} (${f.cols}×${f.rows})`, price: resortPlotPrice(f), map: 'resort', tiles: f.cols * f.rows });
  // Reprice only housing. Capture the actual old employment bonus BEFORE lowering its base price: otherwise
  // a two-slot home priced at 20k would silently lose a slot, and a three-slot home at 30k would become two-slot.
  // No owned rows, paid prices, IDs, geometry or equipment are changed. Slots outside 1–3 keep their old price.
  for (const p of out) if (isEmployeeHousing(p)) {
    p.housingEmployees = employeesForPrice(p.price);
    if (p.housingEmployees >= 1 && p.housingEmployees <= 3) p.price = p.housingEmployees * HOUSING_BASE_PER_EMPLOYEE;
  }
  cache = out; byId = new Map(out.map((p) => [p.id, p])); return out;
}
export const propertyById = (id: unknown): Property | undefined => { properties(); return typeof id === 'string' ? byId!.get(id) : undefined; };
/** Stable id of a map building / patch (for the picker). */
export const buildingId = (type: string, b: OBB) => `b:${type}:${pos(b)}`;
export const patchId = (kind: string, b: OBB) => `p:${kind}:${pos(b)}`;

export interface OwnedProperty { id: string; owner: string; price: number; arrears: number; boughtAt: number; /** what the city was paid, when a buyout raised price above it (sell-back basis) */ basis?: number }

/** Worker cap from property (pt1344u / t2104u): housing keeps its canonical pre-reprice slots; other buildings/landmarks use base
 * (un-indexed) list price. Empty lots, parks, plazas, farmland, barns and plantation plots add none (they are land, not housing).
 *   under 25,000 (detached home)                       +1
 *   25,000 – 74,999 (row houses, apartment, gas station, beach house) +2
 *   75,000 – 249,999 (tower, depot, condo, villa)      +3
 *   250,000+ (hotel, landmarks)                        +4
 * Bonuses from all owned properties add up with no hard max (office cap = MAX_WORKERS + sum). */
export const workerBonusOf = (id: unknown): number => {
  const p = propertyById(id); if (!p || p.type === 'barn' || (p.kind !== 'building' && p.kind !== 'landmark')) return 0;
  return p.housingEmployees ?? employeesForPrice(p.price);
};
export const workerBonusTotal = (ids: Iterable<unknown>): number => { let n = 0; for (const id of ids) n += workerBonusOf(id); return n; };
