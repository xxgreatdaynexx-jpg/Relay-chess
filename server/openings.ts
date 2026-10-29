import { OPENING_BY_UCI } from './opening-book.js';

export function moveUci(move: { from: string; to: string; promotion?: string; san?: string }): string {
  const fromSan = move.san?.match(/=([QRBN])/)?.[1]?.toLowerCase();
  const promo = move.promotion || fromSan || '';
  return `${move.from}${move.to}${promo}`;
}

/** Deepest named line whose moves are a prefix of the game. */
export function openingName(ucis: readonly string[]): string | null {
  let best: string | null = null;
  let key = '';
  for (let index = 0; index < ucis.length; index += 1) {
    key = index === 0 ? ucis[index] : `${key} ${ucis[index]}`;
    const name = OPENING_BY_UCI[key];
    if (name) best = name;
  }
  return best;
}
