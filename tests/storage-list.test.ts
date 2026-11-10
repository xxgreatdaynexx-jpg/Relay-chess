import { describe, expect, it } from 'vitest';
import { arrangeStorageStacks, filterStorageStacks, isStorageFilter, isStorageSort, sortStorageStacks } from '../shared/storageList';
import type { Stack } from '../shared/mines';

const S = (type: Stack['type'], id: string, qty: number): Stack => ({ type, id, qty });
const unit = (s: Stack) => (s.id === 'copper' ? 2 : s.id === 'flour' ? 5 : s.id === 'lettuce' ? 1 : 10);

describe('storage list sort/filter', () => {
  const rows = [S('ore', 'copper', 866), S('food', 'flour', 12), S('food', 'lettuce', 4), S('bar', 'iron_bar', 3)];

  it('filters sellable vs pantry', () => {
    expect(filterStorageStacks(rows, 'pantry').map((s) => s.id).sort()).toEqual(['flour', 'lettuce']);
    expect(filterStorageStacks(rows, 'sellable').every((s) => s.type !== 'food' || s.id === 'x')).toBe(true);
    expect(isStorageSort('total') && isStorageFilter('all')).toBe(true);
  });

  it('sorts by name, qty, unit and total value', () => {
    expect(sortStorageStacks(rows, 'name', unit).map((s) => s.id)).toEqual(['copper', 'flour', 'iron_bar', 'lettuce']);
    expect(sortStorageStacks(rows, 'qty', unit)[0]!.id).toBe('copper');
    expect(sortStorageStacks(rows, 'unit', unit)[0]!.id).toBe('iron_bar'); // 10
    expect(arrangeStorageStacks(rows, 'total', 'all', unit)[0]!.id).toBe('copper'); // 866*2
    expect(arrangeStorageStacks(rows, 'name', 'pantry', unit).map((s) => s.id)).toEqual(['flour', 'lettuce']);
  });
});
