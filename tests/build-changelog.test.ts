import { describe, it, expect } from 'vitest';
import { CHANGELOG, changelogBullets } from '../shared/changelog';
import { isBuildPost, SYSTEM_NAME } from '../server/build';
import { ChatLog } from '../server/chat';

describe('changelog', () => {
  it('is newest first with bullets', () => {
    for (let i = 1; i < CHANGELOG.length; i++) expect(Date.parse(CHANGELOG[i - 1].at)).toBeGreaterThanOrEqual(Date.parse(CHANGELOG[i].at));
    for (const e of CHANGELOG) expect(e.bullets.length).toBeGreaterThan(0);
    expect(changelogBullets(3)).toHaveLength(3);
  });
  it('old build notes are hidden from chat history (changelog lives only in the Changelog section)', () => {
    const log = new ChatLog();
    log.postSystem(SYSTEM_NAME, 'New build abc1234 is live:\n• x');
    expect(log.history(false)).toHaveLength(0);
    expect(isBuildPost({ name: 'Dayne', text: 'New build soon?' })).toBe(false);
  });
});
