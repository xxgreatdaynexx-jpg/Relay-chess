/** One saved player name for chess, quick join, the arena and the leaderboard. */
export const NAME_KEY = 'relay-chess-name';
export const MAX_NAME_LENGTH = 18;
const LEGACY_KEYS = ['relay-chess-session'];

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): Store | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Same rule as the server: trimmed, 1–18 characters. */
export function cleanName(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, MAX_NAME_LENGTH).trim() : '';
}

export function loadName(store: Store | null = storage()): string {
  if (!store) return '';
  try {
    const saved = cleanName(store.getItem(NAME_KEY));
    if (saved) return saved;
    // Fall back to older places a name lived, and adopt it.
    for (const key of LEGACY_KEYS) {
      const raw = store.getItem(key);
      if (!raw) continue;
      let value: unknown = raw;
      if (raw.startsWith('{')) {
        try {
          value = (JSON.parse(raw) as { name?: unknown }).name;
        } catch {
          value = '';
        }
      }
      const legacy = cleanName(value);
      if (legacy) {
        store.setItem(NAME_KEY, legacy);
        return legacy;
      }
    }
  } catch {
    // storage blocked
  }
  return '';
}

/** Saves a non-empty cleaned name. Empty input leaves the old one in place. */
export function saveName(raw: string, store: Store | null = storage()): string {
  const name = cleanName(raw);
  if (name && store) {
    try {
      store.setItem(NAME_KEY, name);
    } catch {
      // storage full or blocked
    }
  }
  return name;
}
