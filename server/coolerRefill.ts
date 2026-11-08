/** Dependency-neutral hook: freeing a cooler slot drains EXISTING fisher boxes, never produces or charges wages. */
let refill: ((name: string) => Promise<unknown>) | null = null;
export const setCoolerRefill = (fn: typeof refill) => { refill = fn; };
export async function refillCooler(name: string): Promise<void> {
  try { await refill?.(name); } catch (e) { console.error('[employ] cooler refill deferred; existing box retained:', (e as Error).message); }
}
