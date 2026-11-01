/** QA r11: a second press within this many ms of the same bet is a double-click, not a new bet. */
export const DOUBLE_CLICK_MS = 450;
/** True when a roulette chip press should be ignored: a bet is still waiting for its ack, or it's the same spot again too soon. */
export function isDoubleBet(last: { k: string; at: number; busy: boolean }, k: string, now: number): boolean {
  return last.busy || (last.k === k && now - last.at < DOUBLE_CLICK_MS);
}
