import { describe, expect, it } from 'vitest';
import { buildWiki, filterWiki } from '../shared/wiki';
import { DAILY_EVENT_TIERS_RETUNE as WEV_TIERS } from '../shared/coop3';
import { OFFLINE_CAP_MS as EMP_OFF, JOBS } from '../shared/employment';
import { CROPS } from '../shared/farm';
import { ORES } from '../shared/mines';
import { LEVER_IDS } from '../shared/city';
import { readFileSync } from 'node:fs';
import { expectChangelogEntry } from './helpers/changelog';

describe('in-game wiki (pt2100u)', () => {
  it('builds sections from live constants (crops, ores, jobs, levers, events, no 8h stop)', () => {
    const secs = buildWiki();
    const ids = secs.map((s) => s.id);
    for (const id of ['crops', 'factory', 'kitchen', 'ores', 'employees', 'fishing', 'fortmc', 'property', 'levers', 'events', 'mayor']) {
      expect(ids).toContain(id);
    }
    const crops = secs.find((s) => s.id === 'crops')!;
    expect(crops.rows!.length).toBeGreaterThanOrEqual(CROPS.length);
    expect(crops.text).toContain('fertilizer');
    const ores = secs.find((s) => s.id === 'ores')!;
    expect(ores.rows!.length).toBe(Object.keys(ORES).length);
    const emp = secs.find((s) => s.id === 'employees')!;
    expect(emp.rows!.length).toBe(JOBS.length);
    expect(EMP_OFF).toBe(0);
    expect(emp.bullets!.some((b) => /around the clock|no 8-hour/i.test(b))).toBe(true);
    const ev = secs.find((s) => s.id === 'event-tiers')!;
    expect(ev.rows!.map((r) => r.cells[2])).toEqual(WEV_TIERS.map((t) => t.chips.toLocaleString('en-US')));
    const levers = secs.find((s) => s.id === 'levers')!;
    expect(levers.rows!.length).toBe(LEVER_IDS.length);
    expect(levers.bullets!.some((b) => /funding|festival|road-repair/i.test(b))).toBe(true);
  });
  it('search filters sections', () => {
    expect(filterWiki('hockey').some((s) => s.id === 'events')).toBe(true);
    expect(filterWiki('zzzz-nope')).toEqual([]);
    expect(filterWiki('').length).toBe(buildWiki().length);
  });
  it('is linked from chat nav and announced', () => {
    const drawer = readFileSync('client/src/components/ChatDrawer.tsx', 'utf8');
    expect(drawer).toMatch(/WikiButton/);
    expectChangelogEntry(/In-game Wiki guide/i, { from: '2026-11-09T00:00:00-06:00', to: '2026-11-10T00:00:00-06:00' });
  });
});
