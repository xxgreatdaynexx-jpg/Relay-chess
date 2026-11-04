/**
 * Cargo capacity per vehicle tier (mu-cargo, Dayne 2026-11-04). Every truck, boat and jet carries a load that scales with its
 * size and price. Own-vehicle trips cost a per-trip running fee (fuel + crew) and trucks/boats a per-day-used upkeep, all
 * BASE chips multiplied by today's price index. A bigger vehicle = fewer trips and a lower per-unit fee.
 *
 * Payback guard: at REALISTIC_LOADS_PER_DAY full loads, a vehicle saves (public carrier fee) - (own trip fees + upkeep) a day;
 * payback = price / saving. Big tiers must not pay back faster than small ones (no "free money" at the top), every tier
 * must still be worth owning (saving > 0) and none may pay back in under MIN_PAYBACK_DAYS.
 */
export type CargoKind = 'truck' | 'boat' | 'jet';
export interface CargoSpec { kind: CargoKind; cap: number; trip: number; /** trucks/boats: base chips the first day a vehicle is used; jets pay the hangar's daily upkeep instead */ useUpkeep: number }
export const TRUCK_UNIT = 1_000;
export const CARGO: Record<string, CargoSpec> = {
  pickup: { kind: 'truck', cap: 1 * TRUCK_UNIT, trip: 120, useUpkeep: 400 }, // small 1x
  box: { kind: 'truck', cap: 2 * TRUCK_UNIT, trip: 200, useUpkeep: 1_500 },
  semi: { kind: 'truck', cap: 3 * TRUCK_UNIT, trip: 270, useUpkeep: 4_000 }, // big rig 3x
  tanker: { kind: 'truck', cap: 6 * TRUCK_UNIT, trip: 420, useUpkeep: 11_000 }, // tanker / road train 6x
  skiff: { kind: 'boat', cap: 4_000, trip: 200, useUpkeep: 300 },
  sportfisher: { kind: 'boat', cap: 10_000, trip: 400, useUpkeep: 1_200 },
  yacht: { kind: 'boat', cap: 25_000, trip: 800, useUpkeep: 4_500 },
  superyacht: { kind: 'boat', cap: 60_000, trip: 1_600, useUpkeep: 12_000 },
  citation: { kind: 'jet', cap: 3_000, trip: 900, useUpkeep: 0 },
  g700: { kind: 'jet', cap: 8_000, trip: 2_000, useUpkeep: 0 },
  chudone: { kind: 'jet', cap: 25_000, trip: 5_000, useUpkeep: 0 },
};
export const cargoOf = (id: unknown): CargoSpec | undefined => (typeof id === 'string' ? CARGO[id] : undefined);
export const cargoCap = (id: unknown) => cargoOf(id)?.cap ?? 0;
/** Trips a load needs (one-way legs carrying goods). */
export const tripsFor = (qty: number, cap: number) => (cap > 0 && qty > 0 ? Math.ceil(qty / cap) : 0);
/** Base (un-indexed) fee for moving qty in your own vehicle: trips x trip fee, plus the day's upkeep if it has not run yet today. */
export const ownFeeBase = (id: string, qty: number, firstTripToday: boolean) => { const c = CARGO[id]; if (!c) return 0; return tripsFor(qty, c.cap) * c.trip + (firstTripToday ? c.useUpkeep : 0); };
/** Per-unit fee on a full load (base chips). */
export const perUnitBase = (id: string) => { const c = CARGO[id]!; return c.trip / c.cap; };
/** Wall time for a multi-trip load: there and back between loads, the last leg one-way. */
export const multiTripMs = (legMs: number, trips: number) => legMs * Math.max(1, 2 * trips - 1);

export const REALISTIC_LOADS_PER_DAY = 2;
export const MIN_PAYBACK_DAYS = 1;
/** Public alternative per-unit base fee for each kind: hired rig, cargo ship, freight plane. */
export const PUBLIC_PER_UNIT: Record<CargoKind, number> = { truck: 2, boat: 0.25, jet: 1.5 };
export function payback(id: string, price: number, dailyUpkeep = 0) {
  const c = CARGO[id]!; const units = c.cap * REALISTIC_LOADS_PER_DAY;
  const publicCost = units * PUBLIC_PER_UNIT[c.kind]; const ownCost = REALISTIC_LOADS_PER_DAY * c.trip + c.useUpkeep + dailyUpkeep;
  const saving = publicCost - ownCost; return { units, publicCost, ownCost, saving, days: saving > 0 ? price / saving : Infinity };
}
