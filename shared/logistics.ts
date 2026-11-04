/**
 * Logistics (Millionaire Update): move goods (ore, bars, factory goods, food) from map to map, to yourself or another player.
 * Pure rules shared by server and client: carriers, schedules, fees, the truck store and the on-map routes every moving
 * vehicle follows (so all goods movement is visible on the map).
 *
 * Carriers
 *  - own truck: leaves now, no fee (you bought the truck); capacity by model; one load at a time.
 *  - hired truck: anyone without a truck (or wanting more room) pays a per-unit fee; leaves now; the hired rig shows on the map.
 *  - freight plane: departs every hour on the hour from the Airport; fastest flight; mid-price.
 *  - cargo ship: departs every 2 hours from each map's ocean port; huge capacity; the cheapest way to move goods.
 */
export type HubId = 'city' | 'resort' | 'fortmc';
export type Mode = 'truck' | 'hired' | 'plane' | 'ship';
export const HUBS: Record<HubId, { label: string; icon: string; port: string }> = {
  city: { label: 'Chud Hub City', icon: '🏙', port: 'Chud Hub Harbour' },
  resort: { label: 'Resort Island', icon: '🏝', port: 'Resort Marina Port' },
  fortmc: { label: 'Fort McChud', icon: '🛢', port: 'Fort McChud Barge Terminal' },
};
export const HUB_IDS = Object.keys(HUBS) as HubId[];
export const isHub = (x: unknown): x is HubId => typeof x === 'string' && x in HUBS;

export interface ModeDef { id: Mode; label: string; icon: string; perUnit: number; minFee: number; travelMs: number; everyMs: number; cap: number; blurb: string }
const MIN = 60_000, HOUR = 60 * MIN;
export const MODES: Record<Mode, ModeDef> = {
  truck: { id: 'truck', label: 'My truck', icon: '🚚', perUnit: 0, minFee: 0, travelMs: 12 * MIN, everyMs: 0, cap: 0, blurb: 'Leaves now. Free: you own the truck.' },
  hired: { id: 'hired', label: 'Hired truck', icon: '🚛', perUnit: 2, minFee: 25, travelMs: 15 * MIN, everyMs: 0, cap: 2_000, blurb: 'No truck? Pay the fee and a hired rig takes it now.' },
  plane: { id: 'plane', label: 'Freight plane', icon: '✈️', perUnit: 1.5, minFee: 40, travelMs: 8 * MIN, everyMs: HOUR, cap: 10_000, blurb: 'Departs every hour on the hour. Fastest.' },
  ship: { id: 'ship', label: 'Cargo ship', icon: '🚢', perUnit: 0.25, minFee: 5, travelMs: 40 * MIN, everyMs: 2 * HOUR, cap: 100_000, blurb: 'Departs every 2 hours from the ocean port. Cheapest.' },
};
export const MODE_IDS = Object.keys(MODES) as Mode[];
export const isMode = (x: unknown): x is Mode => typeof x === 'string' && x in MODES;

/** Base (un-indexed) fee for qty units; the server multiplies by today's price index. Own trucks are free. */
export const feeBase = (mode: Mode, qty: number): number => { const m = MODES[mode]; return m.perUnit ? Math.max(m.minFee, Math.ceil(qty * m.perUnit)) : 0; };
/** Next scheduled departure at or after `now` (now itself for trucks). Plane: top of every hour; ship: every even hour (UTC). */
export const nextDeparture = (mode: Mode, now: number): number => { const e = MODES[mode].everyMs; return e ? Math.ceil(now / e) * e : now; };
export const arrivalOf = (mode: Mode, departAt: number) => departAt + MODES[mode].travelMs;

export interface TruckModel { id: string; name: string; price: number; cap: number; color: number; speed: number }
/** Truck store. `speed` scales travel time (1 = 12 min). */
export const TRUCKS: TruckModel[] = [
  { id: 'pickup', name: 'Chud Pickup', price: 4_000, cap: 250, color: 0x3b82f6, speed: 1.25 },
  { id: 'box', name: 'Box Truck', price: 12_000, cap: 1_500, color: 0xf59e0b, speed: 1 },
  { id: 'semi', name: 'Big Rig Semi', price: 35_000, cap: 6_000, color: 0xdc2626, speed: 0.9 },
  { id: 'tanker', name: 'Gold Tanker', price: 90_000, cap: 20_000, color: 0xeab308, speed: 1.1 },
];
export const TRUCK_BY_ID = new Map(TRUCKS.map((t) => [t.id, t]));
export const MAX_TRUCKS = 6;
export const TRUCK_SELL_BACK = 0.5;
export const truckTravelMs = (t: TruckModel) => Math.round(MODES.truck.travelMs / t.speed);
export const MAX_SHIP_QTY = 100_000;

/** What the map draws: one entry per moving (or loading) vehicle. */
export interface LiveVehicle { id: string; mode: Mode; label: string; owner: string | null; truck?: string; color: number; from: HubId; to: HubId; departAt: number; arriveAt: number; loads: number; units: number }

// ---- On-map routes (each map's own world coordinates, x/z). Every map has an ocean port. Routes run outbound from the
// map you're viewing; a load arriving at that map runs its route backwards. ----
type Pt = [number, number];
export interface HubMap { port: { x: number; z: number; pier: Pt[] }; truck: Pt[]; plane: Pt[]; ship: Pt[] }
export const HUB_MAPS: Record<HubId, HubMap> = {
  city: { port: { x: 40, z: 236, pier: [[40, 208], [40, 240]] }, // Chud Hub Harbour on the ocean coast south of the city (shared/ocean.ts)
    truck: [[65, -39], [52, -39], [0, -39], [0, -124], [0, -215]], plane: [[-200, 130], [-200, 6], [-200, -120], [-260, -320]], ship: [[40, 236], [54, 272], [90, 420], [140, 700]] },
  resort: { port: { x: 30, z: 66, pier: [[30, 40], [30, 66]] }, // between the Reef Pier and the Marina
    truck: [[20, -32], [-60, -32], [-125, -32], [-125, -95]], plane: [[-117, -78], [-83, -78], [-20, -90], [120, -200]], ship: [[30, 66], [36, 120], [10, 240], [-40, 400]] },
  fortmc: { port: { x: 90, z: 120, pier: [[90, 92], [90, 120]] }, // barge terminal on the river mouth
    // The truck leaves north up the east haul road and exits AT the map edge (FORT_Z0 = -110). It used to run to z=-230,
    // 120 m past the edge and the end of the road, so for most of the trip a tiny truck + label floated far to the north.
    // trucks leave the Commodity Exchange yard along the south road and the east haul road; planes take off from the airstrip
    truck: [[80, 56], [128, 56], [128, -4], [128, -116]], plane: [[-125, 70], [-85, 70], [-40, 50], [120, -260]], ship: [[90, 120], [120, 140], [150, 240], [170, 420]] },
};
export const PORT = HUB_MAPS.city.port;
export const DEPOT: Pt = HUB_MAPS.city.truck[0]!; // the Warehouse landmark
export const routeOf = (mode: Mode, hub: HubId = 'city'): Pt[] => { const m = HUB_MAPS[hub]; return mode === 'plane' ? m.plane : mode === 'ship' ? m.ship : m.truck; };
/** Does this vehicle appear on `hub`'s map? (it leaves from or arrives at that map) */
export const onMap = (v: Pick<LiveVehicle, 'from' | 'to'>, hub: HubId) => v.from === hub || v.to === hub;
/** Position along the route at time `now` on `hub`'s map: x, z, heading (rad, atan2(dz,dx)), altitude, and phase. Arriving loads run it backwards. */
export function vehiclePose(v: Pick<LiveVehicle, 'mode' | 'from' | 'to' | 'departAt' | 'arriveAt'>, now: number, hub: HubId = 'city'): { x: number; z: number; a: number; y: number; phase: 'loading' | 'moving' | 'arrived' } {
  const pts = routeOf(v.mode, hub); const inbound = v.to === hub && v.from !== hub; const path = inbound ? [...pts].reverse() : pts;
  const phase = now < v.departAt ? 'loading' : now >= v.arriveAt ? 'arrived' : 'moving';
  const u = phase === 'loading' ? 0 : phase === 'arrived' ? 1 : (now - v.departAt) / Math.max(1, v.arriveAt - v.departAt);
  const lens = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i]![0], p[1] - path[i]![1])); const total = lens.reduce((a, b) => a + b, 0);
  let s = u * total, i = 0; while (i < lens.length - 1 && s > lens[i]!) { s -= lens[i]!; i++; }
  const a0 = path[i]!, a1 = path[i + 1]!; const t = lens[i] ? Math.min(1, s / lens[i]!) : 0;
  const x = a0[0] + (a1[0] - a0[0]) * t, z = a0[1] + (a1[1] - a0[1]) * t;
  const y = v.mode !== 'plane' ? 0 : inbound ? Math.min(60, Math.max(0, (0.88 - u) * 260)) : Math.min(60, Math.max(0, (u - 0.12) * 260));
  return { x, z, a: Math.atan2(a1[1] - a0[1], a1[0] - a0[0]), y, phase };
}
export const fmtEta = (ms: number) => { const m = Math.max(0, Math.ceil(ms / MIN)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
