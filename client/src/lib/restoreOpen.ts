/**
 * QA r10: whether a game window should reopen after a page load. Live-session windows (Mines, Arena) never
 * restore: a reload ends the server session, so a restored window was an empty full-screen overlay that
 * blocked clicks. The stale key is cleared so old browsers stop reopening it too.
 */
export const SESSION_ONLY_KEYS = ['relay-mines-open', 'relay-fps-open'] as const;
export function restoreOpen(key: string, store: Pick<Storage, 'getItem' | 'removeItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): boolean {
  try {
    if (!store) return false;
    if ((SESSION_ONLY_KEYS as readonly string[]).includes(key)) { store.removeItem(key); return false; }
    return store.getItem(key) === '1';
  } catch { return false; }
}
