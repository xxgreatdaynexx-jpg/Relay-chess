/**
 * House art auction (Billionaire Update): rotating lots at the Billionaire's Club. Bids are escrowed, the winner
 * pays (chip sink) and receives the piece as placeable, no-resale home decor. A bid in the last ANTI_SNIPE_MS
 * extends the clock. No refunds after a lot settles.
 */
export interface ArtPiece { id: string; name: string; estimate: number; icon: string; color: number; accent: number; shape: string; blurb: string }

export const ART_PIECES: ArtPiece[] = [
  { id: 'art-horizon', name: 'Horizon in Gold', estimate: 80_000, icon: '🖼️', color: 0xd4af37, accent: 0x1a2a4a, shape: 'painting', blurb: 'A wide gold field over a dark sea.' },
  { id: 'art-marblebust', name: 'Marble Chud Bust', estimate: 120_000, icon: '🗿', color: 0xe8e4dc, accent: 0xb0a898, shape: 'statue', blurb: 'A cool stone portrait on a plinth.' },
  { id: 'art-neon', name: 'Neon Nocturne', estimate: 60_000, icon: '🌃', color: 0x1a0a24, accent: 0xff3cac, shape: 'painting', blurb: 'The city at night, all glow and glass.' },
  { id: 'art-reef', name: 'Reef Memory', estimate: 45_000, icon: '🪸', color: 0x0a4a5a, accent: 0x4fc3d9, shape: 'painting', blurb: 'Coral and light, remembered from the water.' },
  { id: 'art-bronze', name: 'Bronze Runner', estimate: 150_000, icon: '🥉', color: 0x8a5a2a, accent: 0xd4af37, shape: 'statue', blurb: 'A figure mid-stride, heavier than it looks.' },
  { id: 'art-void', name: 'The Quiet Void', estimate: 200_000, icon: '⬛', color: 0x111111, accent: 0xf1faee, shape: 'painting', blurb: 'Almost nothing. Collectors fight over almost nothing.' },
  { id: 'art-orchard', name: 'Orchard Evening', estimate: 35_000, icon: '🍑', color: 0xc45a3a, accent: 0xe8c26a, shape: 'painting', blurb: 'Warm fruit and a long shadow.' },
  { id: 'art-crystal', name: 'Crystal Spire', estimate: 180_000, icon: '💎', color: 0xdff6ff, accent: 0x7ab8ff, shape: 'statue', blurb: 'A glass tower that catches every lamp in the room.' },
];
export const ART_BY_ID = new Map(ART_PIECES.map((p) => [p.id, p]));

export const LOT_MS = 6 * 60 * 60 * 1000;
export const ANTI_SNIPE_MS = 30_000;
export const MIN_BID_STEP = 1_000;
export const openingBid = (estimate: number) => Math.max(MIN_BID_STEP, Math.round(estimate * 0.5 / 500) * 500);
export const minRaise = (current: number) => Math.max(MIN_BID_STEP, Math.round(current * 0.05 / 100) * 100);
export const nextBidFloor = (current: number | null, estimate: number) => current == null ? openingBid(estimate) : current + minRaise(current);
