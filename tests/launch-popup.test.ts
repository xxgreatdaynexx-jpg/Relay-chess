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
