import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LAUNCH } from '../shared/launchPopup';
import { boostXp, XP_MULT } from '../shared/skills';
// recheck #8: the launch popup announces +20% XP and the XP drops show the boosted (actually awarded) amount.
describe('recheck #8 +20% XP', () => {
  it('launch popup lists the +20% XP boost', () => { expect(XP_MULT).toBe(1.2); expect(LAUNCH.items.some((i) => /\+20% XP/.test(i.title))).toBe(true); });
  it('XP drops display boostXp(base) like the server awards', () => {
    expect(boostXp(10)).toBe(12);
    for (const f of ['CookingPanels', 'FishPanPanel', 'Fishing3DGame', 'FishingPanel']) { const s = readFileSync(`client/src/components/${f}.tsx`, 'utf8');
      expect(s).toMatch(/boostXp\(/); expect(s).not.toMatch(/\+\$?\{(r|done|card)\.xp\}/); }
  });
});
