import { describe, expect, it } from 'vitest';
import { PopupStore } from '../server/popups';
import { LAUNCH } from '../shared/launchPopup';

describe('Billionaire Update launch popup', () => {
  it('is data-driven and non-empty', () => { expect(LAUNCH.title).toBe('The Billionaire Update'); expect(LAUNCH.id).toBe('billionaire-update-launch'); expect(LAUNCH.items.length).toBeGreaterThan(5); for (const i of LAUNCH.items) expect(i.title && i.text && i.icon).toBeTruthy(); });
  it('is seen once per player (case-insensitive)', async () => {
    const s = new PopupStore();
    expect(await s.launchSeen('Bob', LAUNCH.id)).toBe(false);
    await s.markLaunch('bob', LAUNCH.id);
    expect(await s.launchSeen('BOB', LAUNCH.id)).toBe(true);
    expect(await s.launchSeen('Ann', LAUNCH.id)).toBe(false);
  });
});

describe('launch popup covers the Billionaire Update, paged', () => {
  const all = LAUNCH.items.map((i) => `${i.title} ${i.text}`).join('\n');
  it.each([
    'East Estates', 'Goldwood', 'Orchard Ridge', 'second runway', 'wineries',
    'data center', 'bitcoin', 'power plant', 'glasshouse', 'offshore rig', 'plastics',
    "Billionaire's Club", 'Private Island', 'Sovereign Megayacht', 'Nightshade',
    'real rooms', 'voyages', 'Monument royalties', 'no longer a royalty monument',
  ])('mentions %s', (k) => { expect(all.toLowerCase()).toContain(k.toLowerCase()); });
  it('groups every item into contiguous pages that fit', async () => {
    const { launchPages } = await import('../shared/launchPopup');
    const pages = launchPages(LAUNCH);
    expect(pages.length).toBeGreaterThanOrEqual(5);
    expect(new Set(pages.map((p) => p.section)).size).toBe(pages.length);
    expect(pages.reduce((a, p) => a + p.items.length, 0)).toBe(LAUNCH.items.length);
    for (const p of pages) expect(p.items.length).toBeLessThanOrEqual(8);
    expect(new Set(LAUNCH.items.map((i) => i.title)).size).toBe(LAUNCH.items.length);
  });
});
