import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const wm = readFileSync('client/src/components/WorldMap.tsx', 'utf8');
const app = readFileSync('client/src/App.tsx', 'utf8');

// Browser-level version: scripts/e2e-city.mjs (opens + closes every tab and checks the city is back).
describe('city is home', () => {
  it('only the Chess Club leaves the city', () => {
    const go = wm.slice(wm.indexOf('const go = '), wm.indexOf('const goRef'));
    expect(go.match(/onClose\(\)/g)).toHaveLength(1);
    expect(go).toMatch(/case 'chess': onClose\(\)/);
    expect(wm).not.toMatch(/onClick=\{\(\) => \{[^}]*openTab\(g\.tab\); onClose\(\)/);
  });
  it('has no skip-to-lobby button', () => { expect(wm).not.toContain('world-skip'); expect(wm).not.toContain('Lobby →'); });
  it('returning to / always reopens the city, and chess has a way back', () => {
    expect(app).toMatch(/if \(onHome && !wasHome\.current\) setWorld\(true\)/);
    expect(app).toContain('Back to city');
    expect(app).toContain('showWorld ? null : (');
  });
});
