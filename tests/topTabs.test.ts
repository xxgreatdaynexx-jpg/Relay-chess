import { describe, expect, it } from 'vitest';
import { TOP_TAB_ORDER } from '../client/src/components/TopTabs';

describe('top tab bar', () => {
  it('orders the game tabs Blackjack, Roulette, Poker, Slots, Solitaire, Arena, Skins (no Conquest)', () => {
    expect([...TOP_TAB_ORDER]).toEqual(['blackjack', 'roulette', 'poker', 'slots', 'solitaire', 'arena', 'skins']);
  });
});
