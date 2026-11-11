// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeFrontBuildingWindow, focusBuildingWindow, listBuildingWindows, registerBuildingWindow,
  resetBuildingWindowsForTest, frontBuildingWindow,
} from '../client/src/lib/buildingWindows';
import { changelogEntry } from './helpers/changelog';

afterEach(() => resetBuildingWindowsForTest());

function el(id: string) {
  const n = document.createElement('div');
  n.id = id;
  document.body.appendChild(n);
  return n;
}

describe('building window stack', () => {
  it('registers several windows and focuses an already-open one', () => {
    const k = el('k'); const g = el('g');
    const ck = { n: 0 }, cg = { n: 0 };
    const uk = registerBuildingWindow('kitchen', k, () => { ck.n++; });
    const ug = registerBuildingWindow('grocery', g, () => { cg.n++; });
    expect(listBuildingWindows().map((e) => e.id)).toEqual(['kitchen', 'grocery']);
    expect(frontBuildingWindow()?.id).toBe('grocery');
    expect(focusBuildingWindow('kitchen')).toBe(true);
    expect(frontBuildingWindow()?.id).toBe('kitchen');
    expect(focusBuildingWindow('factory')).toBe(false);
    uk(); ug();
    k.remove(); g.remove();
  });

  it('closes only the front window', () => {
    const k = el('k'); const g = el('g');
    const closed: string[] = [];
    registerBuildingWindow('kitchen', k, () => { closed.push('kitchen'); });
    registerBuildingWindow('grocery', g, () => { closed.push('grocery'); });
    expect(closeFrontBuildingWindow()).toBe(true);
    expect(closed).toEqual(['grocery']);
    expect(closeFrontBuildingWindow()).toBe(true);
    expect(closed).toEqual(['grocery', 'kitchen']);
    k.remove(); g.remove();
  });

  it('is described in the changelog', () => {
    const { entry } = changelogEntry(/You can now keep several building menus open at once/);
    expect(entry.bullets.join(' ')).toMatch(/Kitchen/);
    expect(entry.bullets.join(' ')).toMatch(/Grocery/);
    expect(entry.bullets.join(' ')).toMatch(/tab strip/);
  });
});
