import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const app = readFileSync('client/src/App.tsx', 'utf8');
const intro = readFileSync('client/src/components/ScrollIntro.tsx', 'utf8');
const cq = readFileSync('client/src/components/ConquestPanel.tsx', 'utf8');
const vol = readFileSync('client/src/components/VolumeControl.tsx', 'utf8');
describe('home QA round 5', () => {
  it('analyze-last toast can be closed and auto-dismisses, bottom-right', () => {
    expect(app).toMatch(/data-testid="analyze-last-close"/);
    expect(app).toMatch(/setTimeout\(\(\) => setAnalyzeHidden\(true\), 8000\)/);
    expect(app).toMatch(/fixed right-4 bottom-4[^"]*" data-testid="analyze-last-toast"/);
  });
  it('closing Conquest realigns the home intro', () => {
    expect(cq).toMatch(/chud:home-return/);
    expect(intro).toMatch(/addEventListener\('chud:home-return'/);
  });
  it('volume widget collapses to an icon below xl', () => {
    expect(vol).toMatch(/hidden h-1 w-20[^"]*xl:block/);
  });
});
