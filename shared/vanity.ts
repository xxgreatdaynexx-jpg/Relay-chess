/**
 * Vanity Desk (Billionaire Update): cosmetic chip sinks — titles, fireworks, vehicle liveries, and a city shout-out.
 * Prices are BASE chips; the server charges px(price). Purchases never resell. No sales tax, so the listed (indexed) price is what you pay.
 */
export interface VanityItem { id: string; name: string; price: number; blurb: string; icon: string }

export const VANITY_TITLES: VanityItem[] = [
  { id: 'tycoon', name: 'Tycoon', price: 50_000, icon: '💼', blurb: 'A gold nameplate for players who have arrived.' },
  { id: 'magnate', name: 'Magnate', price: 150_000, icon: '🏦', blurb: 'A heavier title for a heavier wallet.' },
  { id: 'billionaire', name: 'Billionaire', price: 500_000, icon: '💎', blurb: 'The loudest rank on the nameplate. Wear it in chat.' },
];

export const VANITY_FIREWORKS: Array<VanityItem & { durationMs: number }> = [
  { id: 'sparkler', name: 'Sparkler burst', price: 5_000, icon: '✨', durationMs: 6_000, blurb: 'A short burst over the city. Visible to everyone for a few seconds.' },
  { id: 'city', name: 'City fireworks', price: 25_000, icon: '🎇', durationMs: 14_000, blurb: 'A proper show over downtown.' },
  { id: 'gala', name: 'Grand gala', price: 100_000, icon: '🎆', durationMs: 24_000, blurb: 'The full gala — long, loud, and hard to miss.' },
];

export const VANITY_LIVERIES: Array<VanityItem & { color: number }> = [
  { id: 'goldleaf', name: 'Gold Leaf', price: 40_000, icon: '🟨', color: 0xd4af37, blurb: 'A gold finish for a yacht or jet you own.' },
  { id: 'midnight', name: 'Midnight', price: 40_000, icon: '⬛', color: 0x0b1220, blurb: 'Matte black, quiet flex.' },
  { id: 'rosegold', name: 'Rose Gold', price: 40_000, icon: '🟥', color: 0xb76e79, blurb: 'Warm metallic pink-gold.' },
  { id: 'marble', name: 'Marble', price: 40_000, icon: '⬜', color: 0xe8e4dc, blurb: 'Pale stone and pale metal.' },
  { id: 'racing', name: 'Racing Stripe', price: 40_000, icon: '🏎️', color: 0xc41e3a, blurb: 'A single loud stripe.' },
];

export const SHOUT_PRICE = 15_000;
export const SHOUT_MAX = 120;
export const SHOUT_COOLDOWN_MS = 60 * 60 * 1000;

export const titleById = (id: unknown) => VANITY_TITLES.find((t) => t.id === id);
export const fireworksById = (id: unknown) => VANITY_FIREWORKS.find((t) => t.id === id);
export const liveryById = (id: unknown) => VANITY_LIVERIES.find((t) => t.id === id);
