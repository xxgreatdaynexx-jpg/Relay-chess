import { describe, expect, it } from 'vitest';
import { TOP_TAB_ORDER } from '../client/src/components/TopTabs';

describe('top tab bar', () => {
  it('orders the game tabs Blackjack, Roulette, Poker, Slots, Solitaire, Arena, Mines, Factory, Market (no Conquest); Inventory sits on the right', () => {
    expect([...TOP_TAB_ORDER]).toEqual(['blackjack', 'roulette', 'poker', 'slots', 'solitaire', 'arena', 'mines', 'factory', 'market', 'stocks']);
  });
});

import { fitTabs } from '../client/src/components/TopTabs';

describe('top tab bar overflow (priority+ "More" menu)', () => {
  const w = Array(10).fill(90); // 10 tabs × 90px, 6px gaps = 954px
  it('keeps every tab in the bar when they all fit', () => {
    expect(fitTabs(w, 954, 6, 84)).toBe(10);
    expect(fitTabs(w, 2000, 6, 84)).toBe(10);
  });
  it('moves the tabs that do not fit into More, reserving room for the More button', () => {
    const n = fitTabs(w, 953, 6, 84);
    expect(n).toBeLessThan(10);
    expect(n * 90 + (n - 1) * 6 + 6 + 84).toBeLessThanOrEqual(953);
    expect(fitTabs(w, 600, 6, 84)).toBe(5);
  });
  it('still works as more tabs are added and when nothing fits', () => {
    const many = Array(40).fill(80);
    const n = fitTabs(many, 1280, 6, 84);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(40);
    expect(fitTabs(many, 50, 6, 84)).toBe(0);
  });
});
