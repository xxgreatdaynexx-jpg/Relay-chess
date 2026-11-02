/**
 * Seasonal themes (request #17, Liam: "Make chudhub christmas themed thru Jan 5 2027").
 * Purely cosmetic: nothing here touches chips, odds, prices or the economy.
 * Change XMAS_END to move the switch-off date. Alberta time is fixed UTC-6 (no DST).
 */
/** First instant the Christmas theme is OFF: midnight after Jan 5, 2027, Alberta (UTC-6). */
export const XMAS_END = '2027-01-06T00:00:00-06:00';
export const XMAS_END_MS = Date.parse(XMAS_END);
/** Christmas theme on? `override` ('on' / 'off', e.g. from ?xmas=) wins for QA. */
export function isXmas(now: number = Date.now(), override?: string | null): boolean {
  if (override === 'on' || override === '1') return true;
  if (override === 'off' || override === '0') return false;
  return now < XMAS_END_MS;
}
/** Snow particle budget per device tier (phones / weak GPUs get far fewer). */
export const SNOW_COUNT: Record<'low' | 'mid' | 'high', number> = { low: 350, mid: 1200, high: 2600 };
/** Browser helper: reads ?xmas= once. */
export function xmasOn(): boolean {
  const loc = (globalThis as { location?: { search: string } }).location;
  const q = loc ? new URLSearchParams(loc.search).get('xmas') : null;
  return isXmas(Date.now(), q);
}
