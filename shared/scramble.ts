import { seatsFor, seatSide, type Seat, type TableSetup } from './types.js';

export type Arrangement<T> = Partial<Record<Seat, T>>;

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function teamKey<T>(arr: Arrangement<T>, setup: TableSetup, id: (value: T) => string): string {
  const side = (s: 'white' | 'black') =>
    seatsFor(setup)
      .filter((seat) => seatSide(seat) === s)
      .map((seat) => (arr[seat] === undefined ? '' : id(arr[seat] as T)))
      .sort()
      .join(',');
  return `${side('white')}|${side('black')}`;
}

function seatKey<T>(arr: Arrangement<T>, setup: TableSetup, id: (value: T) => string): string {
  return seatsFor(setup)
    .map((seat) => (arr[seat] === undefined ? '' : id(arr[seat] as T)))
    .join(',');
}

/**
 * Reshuffle every seated player across both colors and seat positions, keeping
 * the mode and team sizes. Prefers new teams, then at least a new seating, when
 * one exists. In 1v1 this swaps colors.
 */
export function scrambleSeats<T>(
  current: Arrangement<T>,
  setup: TableSetup,
  random: () => number = Math.random,
  id: (value: T) => string = (value) => String(value),
): Arrangement<T> {
  const seats = seatsFor(setup);
  const players = seats.map((seat) => current[seat]).filter((value): value is T => value !== undefined);
  const build = (order: T[]): Arrangement<T> => {
    const next: Arrangement<T> = {};
    seats.forEach((seat, index) => {
      if (index < order.length) next[seat] = order[index];
    });
    return next;
  };
  const oldTeams = teamKey(current, setup, id);
  const oldSeats = seatKey(current, setup, id);
  let fallback: Arrangement<T> | null = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const candidate = build(shuffle(players, random));
    if (teamKey(candidate, setup, id) !== oldTeams) return candidate;
    if (!fallback && seatKey(candidate, setup, id) !== oldSeats) fallback = candidate;
  }
  if (fallback) return fallback;
  // Deterministic last resort: rotate everyone one seat along.
  if (players.length > 1) return build([...players.slice(1), players[0]]);
  return build(players);
}
