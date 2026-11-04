import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
// recheck #9: the Skills ✕ press/click (and a quick follow-up click) must not fall through to the map tile beneath
// (it opened the Mines panel). Node env: a minimal window EventTarget stands in for the DOM.
class Win extends EventTarget {}
const g = globalThis as unknown as { window?: EventTarget };
const ev = (t: string) => { const e = new Event(t, { bubbles: true, cancelable: true }); return e; };
describe('recheck #9 close button does not click through', () => {
  beforeEach(() => { vi.useFakeTimers(); g.window = new Win(); });
  afterEach(() => { vi.useRealTimers(); delete g.window; vi.resetModules(); });
  it('closeButton stops the press and the click, closes once, then shields follow-up clicks briefly', async () => {
    const { closeButton } = await import('../client/src/lib/backdrop');
    const close = vi.fn(); const p = closeButton(close); const stopped: string[] = [];
    const fake = (t: string) => ({ type: t, stopPropagation: () => stopped.push(t), preventDefault: () => {} });
    p.onPointerDown(fake('pointerdown')); p.onMouseDown(fake('mousedown')); p.onPointerUp(fake('pointerup')); p.onClick(fake('click') as never);
    expect(stopped).toEqual(['pointerdown', 'mousedown', 'pointerup', 'click']); expect(close).toHaveBeenCalledTimes(1);
    const tile = vi.fn(); g.window!.addEventListener('click', tile); g.window!.addEventListener('pointerdown', tile);
    const c = ev('click'); g.window!.dispatchEvent(c); g.window!.dispatchEvent(ev('pointerdown'));
    expect(tile).not.toHaveBeenCalled(); expect(c.defaultPrevented).toBe(true);
    vi.advanceTimersByTime(450); vi.setSystemTime(Date.now() + 450);
    g.window!.dispatchEvent(ev('click')); expect(tile).toHaveBeenCalledTimes(1); // shield expires: the map works again
  });
  it('Skills uses it for ✕ (and Esc / backdrop arm the shield too)', () => {
    const s = readFileSync('client/src/components/Skills.tsx', 'utf8');
    expect(s).toMatch(/aria-label="Close skills"[^>]*\{\.\.\.closeButton\(/); expect(s).toMatch(/swallowClicksAfterClose\(\); setOpen\(false\)/);
    expect(readFileSync('client/src/lib/backdrop.ts', 'utf8')).toMatch(/swallowClicksAfterClose\(\); close\(\)/);
  });
});
