import { describe, expect, it } from 'vitest';
import { gearLockReason } from '../client/src/lib/gearLock';
const L = [{ id: 'a', tier: 0, name: 'Rusty Sword' }, { id: 'b', tier: 1, name: 'Iron Sword' }];
describe('locked mine gear tooltip (Tess misc)', () => {
  it('names the reason', () => {
    expect(gearLockReason(L, L[1]!, false, true, 0, 10)).toMatch(/sign in/);
    expect(gearLockReason(L, L[1]!, false, false, 0, 10)).toMatch(/Rusty Sword first/);
    expect(gearLockReason(L, L[1]!, true, false, 4, 10)).toMatch(/6 more chips/);
    expect(gearLockReason(L, L[1]!, true, false, 40, 10)).toBe('');
  });
});
