import { describe, expect, it } from 'vitest';
import { PopupStore } from '../server/popups';
import { LAUNCH } from '../shared/launchPopup';

describe('Millionaire Update launch popup', () => {
  it('is data-driven and non-empty', () => { expect(LAUNCH.title).toBe('The Millionaire Update'); expect(LAUNCH.items.length).toBeGreaterThan(5); for (const i of LAUNCH.items) expect(i.title && i.text && i.icon).toBeTruthy(); });
  it('is seen once per player (case-insensitive)', async () => {
    const s = new PopupStore();
    expect(await s.launchSeen('Bob', LAUNCH.id)).toBe(false);
    await s.markLaunch('bob', LAUNCH.id);
    expect(await s.launchSeen('BOB', LAUNCH.id)).toBe(true);
    expect(await s.launchSeen('Ann', LAUNCH.id)).toBe(false);
  });
});

describe('launch popup covers the whole Millionaire Update, paged', () => {
  const all = LAUNCH.items.map((i) => `${i.title} ${i.text}`).join('\n');
  it.each([
    'Fort McChud', 'Deep Ore Mine', 'Furniture Store', 'decorate', 'Visit', '40 floors', 'Elevator', 'Creatures', 'Weapon Store',
    'tractor', 'Fertilizer', 'candlestick', 'Marina', 'Deep-sea', 'Grotto', 'Banyan Bay', 'Private Jet', 'Logistics', 'Truck',
    'rod skins', 'Net worth', 'Farm on mobile', 'grow time', 'full-screen', '10x', 'Dividend', '+20% XP', 'Speedway', 'recipes',
    'Monument', 'buyout', 'ocean', 'lowgfx', 'price you actually paid',
    'Big Farms', 'weapon models', 'Fort McChud Mine', 'boss', 'Smarter monsters', 'twice what the pond', 'five times', 'Fly my jet',
    'passenger seats', 'cargo capacity', 'Co-op mine raids', 'Hockey Stadium', 'sell cap', 'Group contracts',
  ])('mentions %s', (k) => { expect(all.toLowerCase()).toContain(k.toLowerCase()); });
  it('groups every item into contiguous pages that fit', async () => {
    const { launchPages } = await import('../shared/launchPopup');
    const pages = launchPages(LAUNCH);
    expect(pages.length).toBeGreaterThanOrEqual(8);
    expect(new Set(pages.map((p) => p.section)).size).toBe(pages.length);
    expect(pages.reduce((a, p) => a + p.items.length, 0)).toBe(LAUNCH.items.length);
    for (const p of pages) expect(p.items.length).toBeLessThanOrEqual(8);
    expect(new Set(LAUNCH.items.map((i) => i.title)).size).toBe(LAUNCH.items.length);
  });
});

describe('live popup sync keeps the trailer seen id', () => {
  it('stays millionaire-update-launch-trailer', () => { expect(LAUNCH.id).toBe('millionaire-update-launch-trailer'); });
});
