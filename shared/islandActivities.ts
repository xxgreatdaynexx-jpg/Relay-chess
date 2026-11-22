/**
 * More Private Island activities (all island-only, all paid through keyed ledger rows, no new tables):
 *  - Snorkel Reef: up to DIVE_PER_DAY dives per UTC day, one find per dive (collectibles worth a few chips).
 *  - Treasure Hunt: TREASURE_SPOTS X marks on the beaches; one hides today's chest (secret per player and day).
 *    DIG_PER_DAY digs per day; the chest pays CHEST_PAY, an empty dig turns up a trinket worth TRINKET_PAY.
 *  - Helicopter Tour: a sightseeing loop over the island; the first tour of the day pays a postcard bonus.
 * Amounts are base chips before the price index.
 */
export const ISLAND_SNORKEL = { id: 'i-reef', label: 'Snorkel Reef', icon: '🤿', blurb: 'Dive the coral garden off Palm Beach: 5 dives a day, a collectible find on every dive.', x: 58, z: 6 };
export const ISLAND_HUNT = { id: 'i-hunt', label: 'Treasure Hunt', icon: '🗺️', blurb: 'Twelve X marks on the beaches. One hides today\'s chest. Three digs a day.', x: -50, z: -24 };
export const ISLAND_HELI = { id: 'i-heli', label: 'Helipad', icon: '🚁', blurb: 'A sightseeing loop over the whole island. The first tour each day pays a postcard bonus.', x: -16, z: 14 };

export const DIVE_PER_DAY = 5;
export const DIVE_COOLDOWN_MS = 60_000;
export interface DiveFind { id: string; label: string; emoji: string; pay: number; odds: number }
/** Odds are percent and sum to 100. Expected value about 1,060 per dive (about 5,300 a day); best possible day 75,000. */
export const DIVE_FINDS: DiveFind[] = [
  { id: 'conch', label: 'Conch Shell', emoji: '🐚', pay: 400, odds: 50 },
  { id: 'seaglass', label: 'Sea Glass', emoji: '💎', pay: 700, odds: 25 },
  { id: 'coral', label: 'Red Coral Branch', emoji: '🪸', pay: 1_200, odds: 13 },
  { id: 'pearl', label: 'Lagoon Pearl', emoji: '⚪', pay: 2_500, odds: 8 },
  { id: 'blackpearl', label: 'Black Pearl', emoji: '⚫', pay: 6_000, odds: 3 },
  { id: 'doubloon', label: 'Golden Doubloon', emoji: '🪙', pay: 15_000, odds: 1 },
];
/** Pick a find from a uniform draw in [0,1). */
export function diveFindOf(u: number): DiveFind {
  let acc = 0; for (const f of DIVE_FINDS) { acc += f.odds; if (u * 100 < acc) return f; }
  return DIVE_FINDS[DIVE_FINDS.length - 1]!;
}
export const diveFindById = (id: string) => DIVE_FINDS.find((f) => f.id === id);
export const diveEV = () => DIVE_FINDS.reduce((a, f) => a + (f.odds / 100) * f.pay, 0);

export const TREASURE_SPOTS = 12;
export const DIG_PER_DAY = 3;
export const CHEST_PAY = 25_000;
export const TRINKET_PAY = 250;
/** X marks on the sand, spread around the beach ring (angles avoid the dock, lagoon pier, lounge and reef). */
export function treasureSpots(): Array<{ n: number; x: number; z: number }> {
  const angles = [150, 168, 205, 218, 232, 250, 268, 290, 312, 335, 352, 20];
  return angles.map((deg, i) => { const a = (deg * Math.PI) / 180; return { n: i + 1, x: Math.round(Math.cos(a) * 50), z: Math.round(-8 + Math.sin(a) * 50) }; });
}

export const TOUR_MS = 30_000;
export const TOUR_PAY = 2_000;
/** Sightseeing loop waypoints (x, y, z) the camera flies through, and what each points at. */
export const TOUR_PATH: Array<[number, number, number, number, number]> = [
  [-16, 30, 14, 0, -8], [-60, 34, 30, -40, 34], [-70, 40, -20, -36, -8], [-30, 46, -70, -20, -32],
  [30, 50, -72, 24, -44], [70, 40, -20, 36, -8], [76, 30, 20, 58, 6], [50, 34, 60, 40, 30], [0, 40, 80, 0, 28], [-16, 30, 14, 0, -8],
];

export const islandDayKey = (kind: 'dive' | 'dig' | 'tour', player: string, day: string, n: number | string) => `isle_${kind}:${player}:${day}:${n}`;
