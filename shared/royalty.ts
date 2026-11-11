/**
 * Monument royalties (pt1458u): the owner of a landmark earns a cut of what OTHER players earn at that landmark.
 * Paid as an extra mint on top (the earner keeps 100%), ledger game 'monument_royalty'. Not a sink.
 * Rate is per landmark (ROYALTY_RATE), default 1%. Only landmarks listed in ROYALTY_VENUE pay one.
 */
export const ROYALTY_DEFAULT = 0.01;
/** Per-landmark overrides (fraction, e.g. 0.02 = 2%). Unlisted landmarks use ROYALTY_DEFAULT. */
export const ROYALTY_RATE: Record<string, number> = { factory: 0.049 };
export const royaltyRate = (lm: string) => ROYALTY_RATE[lm] ?? ROYALTY_DEFAULT;
/** Landmark id -> what the royalty is a cut of (shown on the deed). */
export const ROYALTY_VENUE: Record<string, string> = {
  mine: 'ore sold after hauling it out of the Mine',
  'mine-frost': 'ore sold after hauling it out of Frostbite Caverns',
  'mine-magma': 'ore sold after hauling it out of Magma Depths',
  factory: 'factory goods (bars, goods, food) sold to the house',
  dock: 'fish and dishes sold at the Fishing Dock',
  racetrack: 'Speedway Daily Cup prizes',
  market: 'market sales (what sellers receive)',
  casino: "the house's net win on blackjack, roulette, slots, video poker and Solitro",
};
/** Casino games whose chips count toward the house net win (Hold'em is player vs player: no house). */
export const HOUSE_GAMES = new Set(['blackjack', 'roulette', 'slots', 'video-poker', 'solitro']);
/** Mine cave id -> landmark id. Coral (resort reef) has no landmark. */
export const CAVE_LANDMARK: Record<string, string> = { mine: 'mine', frost: 'mine-frost', magma: 'mine-magma' };
export const royaltyPct = (lm: string) => `${+(royaltyRate(lm) * 100).toFixed(2)}%`;

/** Hostile buyouts: any player can force-buy a monument for BUYOUT_MUL x what its owner paid (that becomes the new price). */
export const BUYOUT_MUL = 2;
/** A monument can't be bought out within this long after its last purchase or buyout. */
export const BUYOUT_PROTECT_MS = 24 * 3_600_000;
export const buyoutPrice = (paid: number) => Math.round(paid * BUYOUT_MUL);
