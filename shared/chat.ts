/** Site-wide chat + online list: shared types and pure helpers (used by server and tests). */
export const CHAT_MAX_LEN = 300;
export const CHAT_HISTORY = 200;
export const ACTIVITIES = ['blackjack', 'roulette', 'poker', 'slots', 'solitaire', 'arena'] as const;
export type Activity = (typeof ACTIVITIES)[number];

export interface ChatMessage { id: number; name: string; text: string; at: number; qa?: true }
export interface OnlineUser {
  name: string;
  qa?: true;
  /** Chess/checkers table they are seated at or watching (public lobby code). */
  table: { code: string; gameType: 'chess' | 'checkers'; watching: boolean } | null;
  /** Game windows they have open, most relevant first. */
  activities: Activity[];
  /** Short human label, e.g. "Lobby", "Table K3QX", "Arena · Slots". */
  where: string;
}
export interface OnlineSnapshot { users: OnlineUser[]; guests: number }

/** Strip HTML tags (anything shaped like <tag ...>; a bare '<3' or 'a < b' is kept and rendered as text) and control characters, collapse whitespace, trim. Does not censor anything else. */
export function sanitizeChat(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/<\/?[a-z!?][^>]*>?/gi, '')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type ChatCheck = { ok: true; text: string } | { ok: false; error: string };
export function validateChat(input: unknown): ChatCheck {
  const text = sanitizeChat(input);
  if (!text) return { ok: false, error: 'Type a message first.' };
  if ([...text].length > CHAT_MAX_LEN) return { ok: false, error: `Keep it under ${CHAT_MAX_LEN} characters.` };
  return { ok: true, text };
}

/** Validate a client's reported open game windows: known ids only, de-duplicated. */
export function cleanActivities(input: unknown): Activity[] {
  if (!Array.isArray(input)) return [];
  const out: Activity[] = [];
  for (const a of input.slice(0, 12)) if ((ACTIVITIES as readonly string[]).includes(a as string) && !out.includes(a as Activity)) out.push(a as Activity);
  return out;
}

const LABEL: Record<Activity, string> = { blackjack: 'Blackjack', roulette: 'Roulette', poker: 'Poker', slots: 'Slots', solitaire: 'Solitaire', arena: 'Arena' };
export function whereLabel(table: OnlineUser['table'], activities: readonly Activity[]): string {
  const parts: string[] = [];
  if (table) parts.push(`${table.watching ? 'Watching' : table.gameType === 'checkers' ? 'Checkers' : 'Chess'} · ${table.code}`);
  for (const a of activities) parts.push(LABEL[a]);
  return parts.length ? parts.join(' · ') : 'Lobby';
}
