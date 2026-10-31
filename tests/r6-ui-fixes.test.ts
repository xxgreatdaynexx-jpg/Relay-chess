import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const src = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

describe('QA round 6 UI fixes', () => {
  it('Mines throttles its render loop when hidden or behind another window (unless pointer-locked)', () => {
    const m = src('client/src/components/MinesPanel.tsx');
    expect(m).toMatch(/if \(document\.hidden\) return;/);
    expect(m).toMatch(/pointerLockElement !== glRef\.current && !isFrontWindow\(wrapRef\.current\)/);
    expect(src('client/src/lib/windowDrag.ts')).toMatch(/export function isFrontWindow/);
  });
  it("untimed ('No clock') chess tables show no ticking think time", () => {
    const r = src('client/src/components/RoomScreen.tsx');
    expect(r).toMatch(/\{clock && \(\s*<span[^>]*data-testid=\{`think-\$\{seat\}`\}/);
    expect(r).toMatch(/\{clock && slowest === seat/);
  });
  it('solitaire board keeps a playable height and scrolls on very short viewports', () => {
    expect(src('client/src/index.css')).toMatch(/@media \(max-height: 560px\) \{ \.sol-panel \.sol-table \{ flex: 0 0 auto; min-height: 320px; overflow: visible; \} \}/);
  });
});
