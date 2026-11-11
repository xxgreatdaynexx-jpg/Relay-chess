import { describe, expect, it } from 'vitest';
import { TOP_TAB_GROUPS, TOP_TAB_ORDER, fitTabs } from '../client/src/components/TopTabs';
import { changelogEntry } from './helpers/changelog';

describe('top tab bar', () => {
  it('orders the game tabs Blackjack, Roulette, Poker, Slots, Solitaire, Loot Match, Arena, Hockey, Mines, Factory, Market, Stocks, Skills (no Conquest); Inventory sits on the right', () => {
    expect([...TOP_TAB_ORDER]).toEqual(['blackjack', 'roulette', 'poker', 'slots', 'solitaire', 'lootmatch', 'arena', 'hockey', 'mines', 'factory', 'market', 'stocks', 'skills']);
  });

  it('groups every game tab into Casino, Play, Work, or Money exactly once', () => {
    expect(TOP_TAB_GROUPS.map((g) => g.id)).toEqual(['casino', 'play', 'work', 'money']);
    expect([...TOP_TAB_GROUPS[0].items]).toEqual(['blackjack', 'roulette', 'poker', 'slots', 'solitaire', 'lootmatch', 'mines']);
    expect([...TOP_TAB_GROUPS[1].items]).toEqual(['arena', 'hockey']);
    expect([...TOP_TAB_GROUPS[2].items]).toEqual(['factory', 'market', 'skills']);
    expect([...TOP_TAB_GROUPS[3].items]).toEqual(['stocks']);
    const grouped = TOP_TAB_GROUPS.flatMap((g) => [...g.items]);
    expect(grouped.sort()).toEqual([...TOP_TAB_ORDER].sort());
    expect(new Set(grouped).size).toBe(TOP_TAB_ORDER.length);
  });

  it('adds a player-facing changelog entry for the grouped menus', () => {
    const { entry } = changelogEntry(/Top bar redesigned with grouped menus/);
    expect(entry.bullets.length).toBeGreaterThan(0);
    expect(entry.bullets.join(' ')).toMatch(/Casino/i);
    expect(entry.bullets.join(' ')).toMatch(/chips/i);
  });
});

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
