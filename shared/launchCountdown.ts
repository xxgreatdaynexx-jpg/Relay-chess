/** Millionaire Update launch moment: Nov 6, 2026, 8:00 PM CST (UTC-6). */
export const LAUNCH_AT = Date.parse('2026-11-07T02:00:00Z');
export const LAUNCH_DATE_LABEL = 'Nov 6, 8:00 PM CST';

/** 'Xd Xh Xm Xs' until launch, or null once it's launched (at or after 0). */
export function fmtCountdown(msLeft: number): string | null {
  if (!(msLeft > 0)) return null;
  const s = Math.ceil(msLeft / 1000);
  return `${Math.floor(s / 86400)}d ${Math.floor(s / 3600) % 24}h ${Math.floor(s / 60) % 60}m ${s % 60}s`;
}

/** Map label under the clock. */
export const mapCountdownLabel = (now: number, at = LAUNCH_AT): string => { const c = fmtCountdown(at - now); return c ? `Millionaire Update: ${c}` : 'Millionaire Update: soon'; };
