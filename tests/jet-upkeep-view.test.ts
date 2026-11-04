import { beforeEach, describe, expect, it } from 'vitest';
import { resetBank } from '../server/casino-store';
import { setPriceIndexForTest } from '../server/price-index';
import { jetUpkeepInfo, jetUpkeep } from '../server/fleet';
import { GRACE_DAYS } from '../shared/realEstate';

describe('jet upkeep is surfaced (Tess QA #4)', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); });
  it('per-day, next UTC-midnight charge, arrears in chips, paid so far', () => {
    const now = Date.parse('2026-11-03T15:30:00Z'); const i = jetUpkeepInfo({ model: 'citation', arrears: 2, upkeepPaid: 12_000 }, now);
    expect(i.perDay).toBe(jetUpkeep('citation')); expect(i.perDay).toBe(6000); expect(i.nextChargeAt).toBe(Date.parse('2026-11-04T00:00:00Z'));
    expect(i.arrearsChips).toBe(12_000); expect(i.paidTotal).toBe(12_000); expect(i.graceDays).toBe(GRACE_DAYS);
  });
});
