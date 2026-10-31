import { describe, it, expect } from 'vitest';
import { CHANGELOG, changelogBullets } from '../shared/changelog';
import { announceBuild, buildNote, BUILD_MIGRATION } from '../server/build';

describe('changelog', () => {
  it('is newest first with bullets', () => {
    for (let i = 1; i < CHANGELOG.length; i++) expect(Date.parse(CHANGELOG[i - 1].at)).toBeGreaterThanOrEqual(Date.parse(CHANGELOG[i].at));
    for (const e of CHANGELOG) expect(e.bullets.length).toBeGreaterThan(0);
    expect(changelogBullets(3)).toHaveLength(3);
  });
  it('build note fits chat', () => {
    const n = buildNote('abc1234');
    expect(n.startsWith('New build abc1234 is live:')).toBe(true);
    expect(n.length).toBeLessThanOrEqual(300);
  });
  it('announces once per sha', async () => {
    const seen = new Set<string>();
    const db = { query: async (q: string, p?: unknown[]) => {
      if (q === BUILD_MIGRATION) return { rows: [] };
      const s = String(p![0]); if (seen.has(s)) return { rows: [] }; seen.add(s); return { rows: [{ sha: s }] };
    } };
    expect(await announceBuild(db, 'aaa1111')).toBe(true);
    expect(await announceBuild(db, 'aaa1111')).toBe(false);
    expect(await announceBuild(db, 'dev')).toBe(false);
  });
});
