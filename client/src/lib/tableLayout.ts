/** Pure layout math for the felt casino tables (Blackjack + Hold'em). Positions are % of the table box. */

export interface Pt { x: number; y: number }

/** Blackjack: seats spread along the bottom arc of a kidney table, dealer at the top. Seat 0 is on the player's right (dealer's left). */
export function bjSeatPositions(n: number): Pt[] {
  if (n <= 0) return [];
  const out: Pt[] = [];
  // Arc from 160° (left) to 20° (right), centred on (50, 18) with radii in %.
  const a0 = 200, a1 = 340; // degrees, measured on screen with y down → use sin for y
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    // seat 0 starts at the right (first base), last seat is third base on the left
    const deg = a1 - t * (a1 - a0);
    const r = (deg * Math.PI) / 180;
    out.push({ x: round(50 + 40 * Math.cos(r)), y: round(22 - 58 * Math.sin(r)) });
  }
  return out;
}

/** Hold'em: seats evenly round an oval, seat 0 bottom-centre-right, going clockwise. */
export function ovalSeatPositions(n: number, rx = 43, ry = 39): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const deg = 90 + 30 - (360 / n) * i; // start just right of bottom centre, go clockwise on screen
    const r = (deg * Math.PI) / 180;
    out.push({ x: round(50 + rx * Math.cos(r) * -1), y: round(50 + ry * Math.sin(r)) });
  }
  return out;
}

/** Point a fraction of the way from a seat toward the table centre (bet circles sit on the felt in front of the seat). */
export function towardCentre(p: Pt, f: number, c: Pt = { x: 50, y: 50 }): Pt {
  return { x: round(p.x + (c.x - p.x) * f), y: round(p.y + (c.y - p.y) * f) };
}

/**
 * Offset (in container-query width units, cqw) from a target spot back to the dealing source, used as the
 * animation's start translate. The table's aspect ratio (w/h) converts the % y-delta into width units.
 */
export function dealOffset(from: Pt, to: Pt, aspect: number): { dx: number; dy: number } {
  return { dx: round(from.x - to.x), dy: round((from.y - to.y) / aspect) };
}

/** Pick the table size that fits a window: keeps the aspect ratio and never exceeds either side. */
export function fitTable(availW: number, availH: number, aspect: number, min = 280): { w: number; h: number } {
  let w = Math.max(min, availW);
  if (availH > 0 && w / aspect > availH) w = Math.max(min, availH * aspect);
  w = Math.min(w, Math.max(min, availW));
  return { w: Math.round(w), h: Math.round(w / aspect) };
}

/** Aspect ratio: wide windows get a flatter table, narrow/phone windows a taller one so seats keep room. */
export function tableAspect(width: number, kind: 'bj' | 'he'): number {
  if (kind === 'bj') return width < 520 ? 1.15 : width < 900 ? 1.5 : 1.8;
  return width < 520 ? 0.95 : width < 900 ? 1.35 : 1.7;
}

/** SB/BB seats the same way the server posts them (heads-up: the button is the small blind). */
export function blindSeats(seats: ({ inHand: boolean } | null)[], button: number): { sb: number; bb: number } | null {
  const n = seats.length;
  const live = seats.filter((s) => s?.inHand).length;
  if (live < 2 || button < 0) return null;
  const next = (from: number) => {
    for (let k = 1; k <= n; k++) { const i = (from + k) % n; if (seats[i]?.inHand) return i; }
    return from;
  };
  const sb = live === 2 ? button : next(button);
  return { sb, bb: next(sb) };
}

/** Break a chip amount into casino denominations for a stack picture (largest first, capped). */
export const CHIP_DENOMS = [1000, 500, 100, 25, 5, 1] as const;
export function chipStack(amount: number, max = 8): number[] {
  const out: number[] = [];
  let left = Math.max(0, Math.floor(amount));
  for (const d of CHIP_DENOMS) while (left >= d && out.length < max) { out.push(d); left -= d; }
  return out;
}

function round(v: number) { return Math.round(v * 100) / 100; }
