import { describe, expect, it } from 'vitest';
import { NONE, closePanel, openPanel, panelId, togglePanel, type WorldPanel } from '../client/src/lib/worldPanels';

describe('QA r8: one Chud Hub map panel at a time', () => {
  it('opening the farm from a deed opened via the Real estate list does not bring the list back', () => {
    let p: WorldPanel = openPanel(NONE, { k: 'deeds' });
    p = openPanel(p, { k: 'deed', id: 'f:3' });
    p = openPanel(p, { k: 'farm', id: 'f:3' });
    expect(p).toEqual({ k: 'farm', id: 'f:3' });
    expect(p.k === 'deeds').toBe(false);
    expect(panelId(p, 'deed')).toBeNull();
    // a late purchase/close callback for the deed must not close (or replace) the farm
    expect(closePanel(p, 'deed')).toBe(p);
    expect(closePanel(p, 'farm')).toEqual(NONE);
  });
  it('venue replaces deed; Real estate button toggles', () => {
    const p = openPanel({ k: 'deed', id: 'x' }, { k: 'venue', id: 'airport' });
    expect(panelId(p, 'deed')).toBeNull(); expect(panelId(p, 'venue')).toBe('airport');
    expect(togglePanel({ k: 'deeds' }, { k: 'deeds' })).toEqual(NONE);
    expect(togglePanel(p, { k: 'deeds' })).toEqual({ k: 'deeds' });
  });
});
