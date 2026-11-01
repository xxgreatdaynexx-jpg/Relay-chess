/** After a deploy, an old tab asks for hashed chunks that no longer exist (server now 404s them). Reload once to pick up
 * the new build; a sessionStorage stamp makes sure we never loop if the reload doesn't help. */
export const CHUNK_RELOAD_KEY = 'chud:chunk-reload-at';
export const CHUNK_RELOAD_WINDOW_MS = 60_000;

export function isChunkLoadError(e: unknown): boolean {
  const m = e instanceof Error ? `${e.name} ${e.message}` : String(e ?? '');
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading (CSS )?chunk .* failed|Unable to preload CSS|is not a valid JavaScript MIME type/i.test(m);
}

type Env = { storage: Pick<Storage, 'getItem' | 'setItem'>; reload: () => void; now: () => number };
const browserEnv = (): Env | null => (typeof window === 'undefined' ? null : { storage: window.sessionStorage, reload: () => window.location.reload(), now: () => Date.now() });

/** Returns true if it triggered a reload. At most once per CHUNK_RELOAD_WINDOW_MS per tab session. */
export function reloadOnceForChunkError(e: unknown, env: Env | null = browserEnv()): boolean {
  if (!env || !isChunkLoadError(e)) return false;
  try {
    const last = Number(env.storage.getItem(CHUNK_RELOAD_KEY) || 0);
    if (last && env.now() - last < CHUNK_RELOAD_WINDOW_MS) return false;
    env.storage.setItem(CHUNK_RELOAD_KEY, String(env.now()));
  } catch { return false; }
  env.reload();
  return true;
}

/** Global safety net: Vite's preload errors and unhandled dynamic-import rejections. */
export function installChunkReload(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('vite:preloadError', (ev) => { if (reloadOnceForChunkError((ev as Event & { payload?: unknown }).payload ?? new Error('ChunkLoadError'))) ev.preventDefault(); });
  window.addEventListener('unhandledrejection', (ev) => { reloadOnceForChunkError(ev.reason); });
}
