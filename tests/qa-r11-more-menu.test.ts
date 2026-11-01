import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { swallowOutside } from '../client/src/lib/outsideSwallow';

type L = (e: Event) => void;
function fakeDoc() {
  const ls: { t: string; f: L }[] = [];
  return { ls, addEventListener: (t: string, f: L) => { ls.push({ t, f }); }, removeEventListener: (t: string, f: L) => { const i = ls.findIndex((x) => x.t === t && x.f === f); if (i >= 0) ls.splice(i, 1); },
    fire(t: string, target: unknown) { const e = { type: t, target, preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn() }; for (const x of [...ls]) if (x.t === t) x.f(e as unknown as Event); return e; } };
}
const INSIDE = { in: true }, OUT = { in: false };

describe('QA r11: More menu outside click is swallowed', () => {
  it('outside press is stopped at every phase and closes the menu once', () => {
    const q: (() => void)[] = []; vi.stubGlobal('window', { setTimeout: (f: () => void) => { q.push(f); return 0; } });
    const d = fakeDoc(); const close = vi.fn();
    swallowOutside(d as never, (t) => (t as unknown) === INSIDE, close);
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const e = d.fire(t, OUT);
      expect(e.stopPropagation, t).toHaveBeenCalled(); expect(e.preventDefault, t).toHaveBeenCalled();
    }
    q.forEach((f) => f()); // the release fallback does not double-close after a real click
    expect(close).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
  it('presses inside the menu pass through untouched', () => {
    const d = fakeDoc(); const close = vi.fn();
    swallowOutside(d as never, (t) => (t as unknown) === INSIDE, close);
    for (const t of ['pointerdown', 'mousedown', 'click']) expect(d.fire(t, INSIDE).stopPropagation).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
  it('cleanup removes every listener', () => {
    const d = fakeDoc(); const off = swallowOutside(d as never, () => false, () => {});
    expect(d.ls.length).toBeGreaterThan(0); off(); expect(d.ls.length).toBe(0);
  });
  it('TopTabs wires it while More is open', () => {
    const s = readFileSync(new URL('../client/src/components/TopTabs.tsx', import.meta.url), 'utf8');
    expect(s).toMatch(/if \(!moreOpen\) return;\s*return swallowOutside\(document/);
  });
});

describe('QA r11: press with no click still closes', () => {
  it('drag-off release closes via the fallback', () => {
    const q: (() => void)[] = []; vi.stubGlobal('window', { setTimeout: (f: () => void) => { q.push(f); return 0; } });
    const d = fakeDoc(); const close = vi.fn();
    swallowOutside(d as never, () => false, close);
    d.fire('pointerdown', {}); d.fire('pointerup', {}); q.forEach((f) => f());
    expect(close).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
