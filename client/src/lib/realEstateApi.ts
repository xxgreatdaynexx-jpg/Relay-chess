import type { OwnedProperty } from '../../../shared/realEstate';

/** Public /api/real-estate payload. */
export type RealEstateList = {
  ok?: boolean;
  live?: boolean;
  owned?: OwnedProperty[];
  index?: number;
  royalties?: Record<string, number>;
};

/**
 * Load the public ownership list. Returns null when the request failed, the
 * subsystem is offline, or the body is not a live list — callers must keep
 * whatever they already have, so a 500 or boot response cannot make every
 * deed look like it is for sale.
 */
export async function fetchRealEstateList(): Promise<RealEstateList | null> {
  try {
    const r = await fetch('/api/real-estate', { cache: 'no-store' });
    const d = (await r.json()) as RealEstateList;
    if (!d?.ok || d.live === false || !Array.isArray(d.owned)) return null;
    return d;
  } catch {
    return null;
  }
}
