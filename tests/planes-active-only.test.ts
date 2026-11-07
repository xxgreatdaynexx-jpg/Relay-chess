import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getBank, resetBank } from '../server/casino-store';
import { getMines, resetMines } from '../server/mines';
import { setPriceIndexForTest } from '../server/price-index';
import { Logistics } from '../server/logistics';

const HOUR = 3_600_000;
const src = (f: string) => readFileSync(new URL(`../client/src/lib/${f}`, import.meta.url), 'utf8');

describe('only planes players are actually using are drawn', () => {
  it('no ambient / decorative / parked planes on the city, resort or Fort McChud maps', () => {
    const venues = src('worldVenues.ts');
    expect(venues).not.toMatch(/\[plane\(\), plane\(\)\]/); expect(venues).not.toMatch(/circuit\.getPointAt/);
    const resort = src('resort3d.ts');
    expect(resort).not.toMatch(/userData\.plane = true/); expect(resort).not.toMatch(/slow circuit over the island/);
    const fort = src('fortmc3d.ts');
    expect(fort).not.toMatch(/makePlane\(/);
    // the only remaining plane builders are driven by live player data
    expect(src('worldFreight.ts')).toMatch(/socket\.on\('freight_live', onLive\)/);
    expect(fort).toMatch(/jetShow\(model: FleetModel/);
  });

  let l: Logistics; let now = 0;
  beforeEach(() => { resetBank(); resetMines(); setPriceIndexForTest(1); now = 10 * HOUR + 60_000; l = new Logistics(null, () => now); });
  it('live traffic is empty with no shipments, shows a genuine player freight plane, and drops it on arrival', async () => {
    expect(l.live()).toEqual([]);
    getBank().transferConfirmed('QA-Pilot', 100_000, { key: 'fund:QA-Pilot', game: 'admin' }); getMines().adjustStack('QA-Pilot', 'bar', 'iron_bar', 30);
    const r = await l.ship('QA-Pilot', { mode: 'plane', to: 'resort', type: 'bar', id: 'iron_bar', qty: 30 });
    const v = l.live(); expect(v).toHaveLength(1); expect(v[0]).toMatchObject({ mode: 'plane', owner: 'QA-Pilot', units: 30 });
    now = r.shipment.arriveAt; l.tick(); expect(l.live()).toEqual([]);
    expect(getMines().stackQty('QA-Pilot', 'bar', 'iron_bar')).toBe(30); // cargo delivered, not lost
  });
});

describe('Fort McChud jet: drawn only for an actual flight', () => {
  const map = readFileSync(new URL('../client/src/components/FortMcMap.tsx', import.meta.url), 'utf8');
  it('owning a jet (reload / arrived as a passenger) never materialises a parked jet', () => {
    expect(map).not.toMatch(/jetShow\(jetModel, 'park'\)/);
  });
  it('a real own-jet arrival still lands, then the jet is removed; take-off home still animates', () => {
    expect(map).toMatch(/if \(tripNow\(\)\.arrivedBy\) \{ w\.jetShow\(jetModel, 'land', \(\) => w\.jetHide\(\)\)/);
    expect(map).toMatch(/w\.jetShow\(jetModel, 'takeoff', res\)/);
    expect(src('fortmc3d.ts')).toMatch(/jetHide\(\) \{ if \(jet\) \{ scene\.remove\(jet\)/);
  });
});
