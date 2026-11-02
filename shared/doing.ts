/**
 * Live "what are they doing" status for the chat's online list and message tags (status only — never posted into chat).
 * The client reports its single most relevant activity; the server validates it here and attaches it to the online list.
 */
export const DOING_KINDS = [
  'mining', 'factory', 'cooking', 'grocery', 'farming', 'fishing', 'stocks', 'market', 'casino', 'arena', 'resort',
  'chess', 'checkers', 'watching', 'conquest', 'solitaire', 'realestate', 'cityhall', 'jobs', 'dealership', 'mechanic',
  'driving', 'airport', 'racetrack', 'skills', 'skins', 'leaderboard', 'tournament', 'analysis', 'city', 'idle',
] as const;
export type DoingKind = (typeof DOING_KINDS)[number];
export interface Doing { kind: DoingKind; detail?: string }

export const DOING_INFO: Record<DoingKind, { icon: string; label: string }> = {
  mining: { icon: '⛏️', label: 'Mining' }, factory: { icon: '🏭', label: 'In the factory' }, cooking: { icon: '🍳', label: 'Cooking' },
  grocery: { icon: '🛒', label: 'Grocery shopping' }, farming: { icon: '🌾', label: 'Farming' }, fishing: { icon: '🎣', label: 'Fishing' },
  stocks: { icon: '📈', label: 'Stock market' }, market: { icon: '🏪', label: 'Market' }, casino: { icon: '🎰', label: 'Casino' },
  arena: { icon: '🔫', label: 'Arena' }, resort: { icon: '🏝️', label: 'At the resort' }, chess: { icon: '♟️', label: 'Playing chess' },
  checkers: { icon: '⛀', label: 'Playing checkers' }, watching: { icon: '👀', label: 'Watching a game' }, conquest: { icon: '🗺️', label: 'Conquest' },
  solitaire: { icon: '🃏', label: 'Solitaire' }, realestate: { icon: '🏛', label: 'Real estate' }, cityhall: { icon: '🏛️', label: 'City Hall' },
  jobs: { icon: '💼', label: 'Job board' }, dealership: { icon: '🚘', label: 'Car dealership' }, mechanic: { icon: '🔧', label: 'Mechanic' },
  driving: { icon: '🚗', label: 'Driving' }, airport: { icon: '🛫', label: 'Airport' }, racetrack: { icon: '🏁', label: 'Racetrack' },
  skills: { icon: '🧭', label: 'Skills' }, skins: { icon: '🎒', label: 'Inventory' }, leaderboard: { icon: '🏆', label: 'Leaderboard' },
  tournament: { icon: '🏆', label: 'Tournament' }, analysis: { icon: '🔍', label: 'Game analysis' }, city: { icon: '🌆', label: 'In the city' },
  idle: { icon: '💤', label: 'Idle' },
};

export const DOING_DETAIL_MAX = 32;
const isKind = (v: unknown): v is DoingKind => typeof v === 'string' && (DOING_KINDS as readonly string[]).includes(v);

/** Validate a client report: known kind only; detail is plain text, single line, capped. Anything else → null. */
export function cleanDoing(input: unknown): Doing | null {
  if (!input || typeof input !== 'object') return null;
  const { kind, detail } = input as { kind?: unknown; detail?: unknown };
  if (!isKind(kind)) return null;
  if (typeof detail !== 'string') return { kind };
  const d = detail.replace(/<[^>]*>?/g, '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  const cut = [...d].slice(0, DOING_DETAIL_MAX).join('');
  return cut ? { kind, detail: cut } : { kind };
}

/** "⛏️ Mining · Magma Depths" */
export function doingLabel(d: Doing | null | undefined): string {
  if (!d) return '';
  const info = DOING_INFO[d.kind];
  return `${info.icon} ${info.label}${d.detail ? ` · ${d.detail}` : ''}`;
}

/** Higher wins when a client has several things open at once (a game over the city map, etc). */
export const DOING_RANK: Record<DoingKind, number> = {
  idle: 0, city: 1, resort: 2, driving: 3, leaderboard: 4, tournament: 5, analysis: 5,
  realestate: 6, cityhall: 6, jobs: 6, dealership: 6, mechanic: 6, airport: 6, racetrack: 6, grocery: 6, skills: 6, skins: 6,
  farming: 7, cooking: 7, fishing: 7, market: 8, stocks: 8,
  chess: 9, checkers: 9, watching: 9, conquest: 9, solitaire: 9, casino: 9, factory: 9, mining: 10, arena: 10,
};
/** Pick the most relevant of several reports; ties go to the most recently opened (later in the list). */
export function topDoing(list: readonly Doing[]): Doing | null {
  let best: Doing | null = null;
  for (const d of list) if (!best || DOING_RANK[d.kind] >= DOING_RANK[best.kind]) best = d;
  return best;
}
/** Seconds of no input before a client reports itself idle. */
export const IDLE_AFTER_MS = 5 * 60_000;
