import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHANGELOG } from '../shared/changelog';
import { LAUNCH } from '../shared/launchPopup';

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('Billionaire Update coming-soon sign', () => {
  it('is gone from the 3D map, with no Coming Soon tip or Future Features hook', () => {
    const world = src('client/src/lib/world3d.ts');
    const map = src('client/src/components/WorldMap.tsx');
    expect(world).not.toMatch(/C O M I N G {3}S O O N/);
    expect(world).not.toMatch(/fillText\('Billionaire Update'/);
    expect(world).not.toContain('BILLIONAIRE_SIGN');
    expect(world).not.toMatch(/open-launch-popup/);
    expect(map).not.toMatch(/FutureFeaturesPopup/);
    expect(map).not.toMatch(/billionaire-sign/);
    expect(map).not.toMatch(/Coming soon/);
    expect(map).not.toMatch(/BILLIONAIRE_SIGN/);
  });

  it('keeps the historical coming-soon changelog entry and adds no Future Features entry', () => {
    const entry = CHANGELOG.find((e) => e.title === 'Billionaire Update coming soon');
    expect(entry).toBeTruthy();
    expect(CHANGELOG.some((e) => /future features/i.test(e.title + e.bullets.join(' ')))).toBe(false);
    expect(CHANGELOG.some((e) => e.title === 'The Billionaire Update is live')).toBe(true);
  });
});

describe('Billionaire Update launch popup', () => {
  it('uses a new seen id so players see it once at launch', () => {
    expect(LAUNCH.id).toBe('billionaire-update-launch');
    expect(LAUNCH.title).toMatch(/Billionaire Update/);
    expect(LAUNCH.items.length).toBeGreaterThan(0);
  });
});
