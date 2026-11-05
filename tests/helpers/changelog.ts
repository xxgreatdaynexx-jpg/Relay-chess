import { expect } from 'vitest';
import { CHANGELOG, type ChangelogEntry } from '../../shared/changelog';

// Asserts on changelog entries by identity, ordering and time window rather than a fixed
// "top-N" position, so new entries at the top don't break older features' tests.

/** The window launch-batch entries must fall in: after the original Millionaire Update entry, before launch. */
export const LAUNCH_WINDOW = { from: '2026-11-03T17:30:00-06:00', to: '2026-11-07T00:00:00-06:00' } as const;

/** Find exactly one entry whose title matches; fails if missing or duplicated. */
export function changelogEntry(re: RegExp): { entry: ChangelogEntry; index: number } {
  const hits = CHANGELOG.map((e, i) => ({ entry: e, index: i })).filter((h) => re.test(h.entry.title));
  expect(hits.map((h) => h.entry.title), `changelog entries matching ${re}`).toHaveLength(1);
  return hits[0]!;
}

/** Entry present once, has bullets, dated inside the window, and the list is newest-first. */
export function expectChangelogEntry(re: RegExp, window: { from: string; to: string } = LAUNCH_WINDOW) {
  const { entry, index } = changelogEntry(re);
  expect(entry.bullets.length).toBeGreaterThan(0);
  const t = Date.parse(entry.at);
  expect(Number.isFinite(t), `valid 'at' for ${entry.title}`).toBe(true);
  expect(t).toBeGreaterThanOrEqual(Date.parse(window.from));
  expect(t).toBeLessThan(Date.parse(window.to));
  const times = CHANGELOG.map((e) => Date.parse(e.at));
  for (let i = 1; i < times.length; i++) expect(times[i - 1]!, `changelog newest-first at ${i}`).toBeGreaterThanOrEqual(times[i]!);
  return { entry, index };
}

/** Each regex's entry appears above (newer than or same time as) the next one. */
export function expectChangelogOrder(...res: RegExp[]) {
  const idx = res.map((re) => changelogEntry(re).index);
  for (let i = 1; i < idx.length; i++) expect(idx[i - 1]!, `${res[i - 1]} above ${res[i]}`).toBeLessThan(idx[i]!);
}
