/**
 * Chud Resort fleet (Millionaire Update #10b / #11): boats from the Marina and private jets from the Hangar.
 * Prices are BASE chips (the server charges px(price)). Boats unlock deep-sea fishing zones; jets skip resort tickets
 * and cost a daily upkeep (a chip sink, charged like property tax: unpaid days pile up as arrears, GRACE_DAYS -> repossessed).
 */
export type FleetKind = 'boat' | 'jet';
export interface FleetModel { id: string; kind: FleetKind; name: string; emoji: string; price: number; blurb: string;
  /** boats: deepest deep-sea zone this hull can reach (1..3) */ zone?: 1 | 2 | 3;
  /** jets: base chips charged every UTC day after the purchase day */ upkeep?: number;
  /** boats: multiplier on the time to a bite at deep sea (<1 = faster) */ biteMul?: number;
  color: number }

export const BOATS: FleetModel[] = [
  { id: 'skiff', kind: 'boat', name: 'Reef Runner Skiff', emoji: '🚤', price: 30_000, zone: 1, color: 0xf2f2ea, blurb: 'Twin outboards and a bait well. Gets you past the reef to the Outer Banks.' },
  { id: 'sportfisher', kind: 'boat', name: 'Marlin Sportfisher', emoji: '🛥️', price: 120_000, zone: 2, biteMul: 0.95, color: 0xe8eef6, blurb: 'Fighting chair and outriggers. Reaches the Blue Water for swordfish and mako.' },
  { id: 'yacht', kind: 'boat', name: 'Azure 60 Yacht', emoji: '🛳️', price: 450_000, zone: 3, biteMul: 0.9, color: 0xffffff, blurb: 'Three cabins, a sonar rig and the range for the Abyss.' },
  { id: 'superyacht', kind: 'boat', name: 'Chud Royale Superyacht', emoji: '🚢', price: 2_500_000, zone: 3, biteMul: 0.8, color: 0x1a2a4a, blurb: 'Helipad, crew of twelve, a pool on the sun deck. Every zone, fastest bites, maximum status.' },
];
export const JETS: FleetModel[] = [
  { id: 'citation', kind: 'jet', name: 'Citation Light Jet', emoji: '🛩️', price: 400_000, upkeep: 6_000, color: 0xf4f4f4, blurb: 'Six seats and a short-field takeoff. Fly to Chud Resort or Fort McChud whenever you like, no ticket.' },
  { id: 'g700', kind: 'jet', name: 'Gulfstream G700', emoji: '✈️', price: 1_500_000, upkeep: 18_000, color: 0xdfe6ee, blurb: 'Intercontinental range and a bedroom suite. The tycoon standard.' },
  { id: 'chudone', kind: 'jet', name: 'Chud One (747-8 BBJ)', emoji: '🛫', price: 6_000_000, upkeep: 60_000, color: 0x1f3f8a, blurb: 'A private jumbo with a gold-trimmed boardroom. The loudest flex in Chud Hub.' },
];
export const FLEET: FleetModel[] = [...BOATS, ...JETS];
export const FLEET_BY_ID = new Map(FLEET.map((m) => [m.id, m]));
export const fleetModel = (id: unknown, kind?: FleetKind) => { const m = typeof id === 'string' ? FLEET_BY_ID.get(id) : undefined; return m && (!kind || m.kind === kind) ? m : undefined; };
/** Sell back (and net worth) at 70% of today's list price, like property. */
export const FLEET_RESALE = 0.7;
export const fleetResale = (listPx: number) => Math.round(listPx * FLEET_RESALE);
export const MAX_BOATS = 4, MAX_JETS = 2;
/** Deep-sea zones a boat tier reaches. */
export const DEEP_ZONES = [
  { zone: 1, name: 'Outer Banks', blurb: 'Bonito, wahoo and amberjack over the shelf. Black Marlin cruise here.' },
  { zone: 2, name: 'Blue Water', blurb: 'Swordfish, mako sharks and the odd giant squid.' },
  { zone: 3, name: 'The Abyss', blurb: 'Oarfish, anglerfish and the living fossil: a Coelacanth.' },
] as const;
/** Best zone / bite multiplier among a set of owned boat models. */
export function bestBoat(modelIds: string[]): { zone: 0 | 1 | 2 | 3; biteMul: number; name: string | null } {
  let best: FleetModel | null = null;
  for (const id of modelIds) { const m = fleetModel(id, 'boat'); if (m && (!best || (m.zone ?? 0) > (best.zone ?? 0) || ((m.zone ?? 0) === (best.zone ?? 0) && (m.biteMul ?? 1) < (best.biteMul ?? 1)))) best = m; }
  return { zone: (best?.zone ?? 0) as 0 | 1 | 2 | 3, biteMul: best?.biteMul ?? 1, name: best?.name ?? null };
}
