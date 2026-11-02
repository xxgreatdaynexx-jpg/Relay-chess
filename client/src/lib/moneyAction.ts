import { useCallback, useRef, useState } from 'react';

/** QA r12: the spinner stays at least this long, so it's visible even when the server answers in 50 ms, and a
 *  second click of a double-click (≈ 200–300 ms later) always lands on a disabled button. */
export const MIN_BUSY_MS = 500;

/**
 * One money action at a time per panel. `run(key, fn)` flips the lock and the render state in the click handler
 * itself (before any await), so the button is disabled + aria-busy + spinning on the very next paint, and keeps
 * it so for the whole request (min MIN_BUSY_MS). A click while busy is ignored.
 */
export function useMoneyAction(minMs = MIN_BUSY_MS) {
  const [busy, setBusy] = useState<string | false>(false);
  const lk = useRef(false);
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (lk.current) return undefined;
    lk.current = true; setBusy(key);
    try {
      const [r] = await Promise.all([fn(), new Promise((res) => setTimeout(res, minMs))]);
      return r;
    } finally { lk.current = false; setBusy(false); }
  }, [minMs]);
  return { busy, run };
}
