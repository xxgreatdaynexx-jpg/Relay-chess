/**
 * Boot-time Postgres attach with retry (pt1101): Neon cold starts often time out the first connect. Subsystems that
 * load their rows once at boot used to give up on the first failure and run from empty memory for the life of the
 * instance (inventories, stats and boards looked wiped; saves from that empty state could clobber real rows).
 * Now: a few quick retries with backoff, then keep reconnecting in the background. While a subsystem is offline it
 * must refuse reads-as-real and writes (see each module's `offline` flag); once it connects it loads the real rows.
 */
export type BootState = 'connecting' | 'ok' | 'offline' | 'memory';
const states = new Map<string, BootState>();
/** Informational per-subsystem DB status for /api/health (only the chip DB gates the health check). */
export const bootStates = (): Record<string, BootState> => Object.fromEntries(states);
export const setBootState = (name: string, s: BootState) => { states.set(name, s); };
export const resetBootStates = () => states.clear();

/** Player-facing refusal while a subsystem is reconnecting. */
export const reconnectMsg = (what: string) => `${what} is reconnecting to the database. Nothing was changed, try again in a minute.`;

export interface BootOpts { tries?: number; delayMs?: number; retryMs?: number; onOk?: () => void | Promise<void> }

/**
 * Run `once` (resolve true when connected and loaded) up to `tries` times with exponential backoff, then every
 * `retryMs` in the background until it succeeds. Never throws. Resolves with whether the boot attempts connected.
 */
export async function bootAttach(name: string, once: () => Promise<boolean>, opts: BootOpts = {}): Promise<boolean> {
  const tries = opts.tries ?? 4, delay = opts.delayMs ?? 2000, retryMs = opts.retryMs ?? 15_000;
  const attempt = () => once().catch((e) => { console.error(`[${name}] attach failed:`, (e as Error).message); return false; });
  const ok = async () => {
    states.set(name, 'ok');
    try { await opts.onOk?.(); } catch (e) { console.error(`[${name}] post-connect step failed:`, (e as Error).message); }
    return true;
  };
  states.set(name, 'connecting');
  for (let i = 0; i < tries; i++) {
    if (await attempt()) return ok();
    if (i < tries - 1) await new Promise((r) => setTimeout(r, delay * 2 ** i));
  }
  states.set(name, 'offline');
  console.error(`[${name}] still offline after ${tries} tries: refusing writes, retrying every ${Math.round(retryMs / 1000)}s`);
  let busy = false;
  const t = setInterval(() => {
    if (busy) return; busy = true;
    void attempt().then(async (a) => { busy = false; if (a) { clearInterval(t); console.log(`[${name}] reconnected to postgres`); await ok(); } });
  }, retryMs);
  t.unref?.();
  return false;
}
