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

describe('city never freezes behind drawers', () => {
  it('pauses only for full-screen game panels, not chat/wallet', () => {
    const pause = wm.slice(wm.indexOf('const run = '), wm.indexOf('if (run !== last)'));
    expect(pause).toContain('fullScreenGameOpen');
    expect(pause).not.toMatch(/\$="-tab"/);
    expect(pause).not.toContain('chat-tab');
    expect(pause).not.toContain('wallet-button');
    expect(wm).toMatch(/haulRef\.current\?\.setRunning\(run\)/);
    expect(wm).toMatch(/freightRef\.current\?\.setRunning\(run\)/);
  });
  it('hockey, arena, mines and factory tabs pause the city', () => {
    for (const [file, id] of [
      ['client/src/components/HockeyPanel.tsx', 'hockey-tab'],
      ['client/src/components/ArenaPanel.tsx', 'arena-tab'],
      ['client/src/components/MinesPanel.tsx', 'mines-tab'],
      ['client/src/components/FactoryPanel.tsx', 'factory-tab'],
    ] as const) {
      const src = readFileSync(file, 'utf8');
      expect(src, id).toMatch(new RegExp(`data-testid="${id}"[^>]*data-pause-city`));
    }
  });
});

describe('city camera after selecting a building', () => {
  it('re-enables orbit/zoom when the fly-to ends and lands within zoom limits', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../client/src/lib/world3d.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/fly = null; controls\.enabled = true; h\.onPick/);
    const min = Number(/controls\.minDistance = (\d+)/.exec(src)![1]);
    const m = /dir\.multiplyScalar\((\d+)\)\)\.setY\(tgt\.y \+ (\d+)\)/.exec(src)!;
    expect(Math.hypot(Number(m[1]), Number(m[2]))).toBeGreaterThanOrEqual(min);
  });
});
