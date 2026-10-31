/** Pure kill-feed / multi-kill pop-up helpers (DOM-free so they can be unit-tested). */
export interface FeedItem { key: number; killer: string; victim: string; cause: string; self: boolean; mine: boolean; head?: boolean; noscope?: boolean; multi?: string }

export type FeedPart = { t: 'killer' | 'victim' | 'multi'; text: string } | { t: 'weapon'; cause: string } | { t: 'head' } | { t: 'noscope' };

/** Ordered pieces of one feed line: killer · weapon · [headshot icon] · victim, or a "NAME — TRIPLE KILL" line. */
export function feedParts(f: FeedItem): FeedPart[] {
  if (f.multi) return [{ t: 'killer', text: f.killer }, { t: 'multi', text: `— ${f.multi}` }];
  const out: FeedPart[] = [];
  if (!f.self) out.push({ t: 'killer', text: f.killer });
  out.push({ t: 'weapon', cause: f.cause });
  if (f.noscope && !f.self) out.push({ t: 'noscope' });
  if (f.head && !f.self) out.push({ t: 'head' });
  out.push({ t: 'victim', text: f.victim });
  return out;
}

/** Pop-up font scale per tier level (1 double … 5 multi): bigger each tier. */
export function popupScale(level: number): number {
  return 1 + 0.18 * (Math.max(1, Math.min(5, level)) - 1);
}
export const POPUP_MS = 1500;
