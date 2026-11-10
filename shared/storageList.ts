/**
 * Sort / filter prefs for banked Storage-style lists (Factory Storage panel).
 * Pure helpers so the same order can be unit-tested without React.
 */
import { nameOf, sellable, type Stack } from './mines.js';

export type StorageSort = 'name' | 'qty' | 'unit' | 'total';
export type StorageFilter = 'all' | 'sellable' | 'pantry';

export const STORAGE_SORT_KEY = 'chud-storage-sort';
export const STORAGE_FILTER_KEY = 'chud-storage-filter';
export const STORAGE_SORTS: Array<{ id: StorageSort; label: string }> = [
  { id: 'name', label: 'Name A–Z' },
  { id: 'qty', label: 'Qty ↓' },
  { id: 'unit', label: 'Unit 🪙 ↓' },
  { id: 'total', label: 'Total 🪙 ↓' },
];
export const STORAGE_FILTERS: Array<{ id: StorageFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'sellable', label: 'Sellable' },
  { id: 'pantry', label: 'Pantry' },
];

export const isStorageSort = (v: unknown): v is StorageSort => v === 'name' || v === 'qty' || v === 'unit' || v === 'total';
export const isStorageFilter = (v: unknown): v is StorageFilter => v === 'all' || v === 'sellable' || v === 'pantry';

/** Pantry rows in Storage are food stacks (never sold to the house). */
export const isPantryStack = (s: Stack) => s.type === 'food';

export function filterStorageStacks(stacks: Stack[], filter: StorageFilter): Stack[] {
  if (filter === 'sellable') return stacks.filter((s) => sellable(s));
  if (filter === 'pantry') return stacks.filter(isPantryStack);
  return stacks.slice();
}

/** `unitPrice` is the displayed house unit price (already price-indexed if the UI indexes it). */
export function sortStorageStacks(stacks: Stack[], sort: StorageSort, unitPrice: (s: Stack) => number): Stack[] {
  const out = stacks.slice();
  const name = (s: Stack) => nameOf(s).toLowerCase();
  out.sort((a, b) => {
    if (sort === 'name') return name(a).localeCompare(name(b)) || b.qty - a.qty;
    if (sort === 'qty') return b.qty - a.qty || name(a).localeCompare(name(b));
    if (sort === 'unit') {
      const d = unitPrice(b) - unitPrice(a);
      return d !== 0 ? d : name(a).localeCompare(name(b));
    }
    // total
    const d = unitPrice(b) * b.qty - unitPrice(a) * a.qty;
    return d !== 0 ? d : name(a).localeCompare(name(b));
  });
  return out;
}

export function arrangeStorageStacks(stacks: Stack[], sort: StorageSort, filter: StorageFilter, unitPrice: (s: Stack) => number): Stack[] {
  return sortStorageStacks(filterStorageStacks(stacks, filter), sort, unitPrice);
}
