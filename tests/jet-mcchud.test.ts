import { beforeEach, describe, expect, it } from 'vitest';
import { getBank, resetBank } from '../server/casino-store';
import { Fleet, setFleet } from '../server/fleet';
import { Travel, isAtFortMc, setTravel } from '../server/travel';
import { setPriceIndexForTest } from '../server/price-index';
import { fleetModel } from '../shared/fleet';
import { DESTINATIONS } from '../shared/resort';
import { LAUNCH } from '../shared/launchPopup';

const fund = (n: string, amt: number) => getBank().transferConfirmed(n, amt, { key: `test_fund:${n}:${Math.random()}`, game: 'admin' });
const DAY = 86_400_000; const T0 = Date.parse('2026-11-01T12:00:00Z');

describe('Fly my jet to Fort McChud (mu-jet-mcchud)', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); });
  it('a jet owner flies to Fort McChud with no ticket charged, and the return flight works', async () => {
    let now = T0; const f = new Fleet(null, () => now); setFleet(f); const t = new Travel(null, () => now); setTravel(t);
    const price = fleetModel('citation', 'jet')!.price; await fund('QA-JetMc', price + 10_000); await f.buy('QA-JetMc', 'jet', 'citation');
    const before = getBank().account('QA-JetMc').chips;
    const r = await t.fly('QA-JetMc', 'fortmc');
    expect(r.fee).toBe(0); expect(r.jet).toBe(fleetModel('citation')!.name); expect(r.loc).toBe('fortmc'); expect(isAtFortMc('QA-JetMc')).toBe(true);
    expect(getBank().account('QA-JetMc').chips).toBe(before);
    const h = await t.home('QA-JetMc'); expect(h.loc).toBe('city'); expect(t.where('QA-JetMc')).toBe('city'); expect(getBank().account('QA-JetMc').chips).toBe(before);
    expect((await t.fly('QA-JetMc', 'fortmc')).fee).toBe(0); await t.home('QA-JetMc'); // fly again: still free
    setFleet(null);
  });
  it('the normal jet upkeep still applies after flying to Fort McChud', async () => {
    let now = T0; const f = new Fleet(null, () => now); setFleet(f); const t = new Travel(null, () => now);
    const price = fleetModel('citation', 'jet')!.price; await fund('QA-JetUp', price + 10_000); await f.buy('QA-JetUp', 'jet', 'citation');
    await t.fly('QA-JetUp', 'fortmc'); const c = getBank().account('QA-JetUp').chips;
    now += DAY; expect(await f.runUpkeep()).toMatchObject({ paid: 1, charged: 6_000 }); expect(getBank().account('QA-JetUp').chips).toBe(c - 6_000);
    setFleet(null);
  });
  it('a non-owner cannot fly a jet: they buy the normal Fort McChud ticket exactly as before', async () => {
    const f = new Fleet(null); setFleet(f); const t = new Travel(null); await fund('QA-NoJetMc', 5_000); const c0 = getBank().account('QA-NoJetMc').chips;
    const r = await t.fly('QA-NoJetMc', 'fortmc');
    expect(r.jet).toBeUndefined(); expect(r.fee).toBe(DESTINATIONS.fortmc.ticket); expect(getBank().account('QA-NoJetMc').chips).toBe(c0 - r.fee);
    await t.home('QA-NoJetMc'); expect(t.where('QA-NoJetMc')).toBe('city');
    setFleet(null);
  });
  it('a sold jet stops waiving the ticket', async () => {
    const f = new Fleet(null); setFleet(f); const t = new Travel(null);
    await fund('QA-Sold', fleetModel('citation', 'jet')!.price + 5_000); const j = await f.buy('QA-Sold', 'jet', 'citation'); await f.sell('QA-Sold', j.id);
    expect((await t.fly('QA-Sold', 'fortmc')).fee).toBe(DESTINATIONS.fortmc.ticket);
    setFleet(null);
  });
  it('the launch popup announces it', () => {
    expect(LAUNCH.items.some((i) => /Fort McChud/.test(i.title) && /Fly my jet/.test(i.text) && /upkeep/.test(i.text))).toBe(true);
    expect(LAUNCH.items.some((i) => /Fort McChud still needs a ticket/.test(i.text))).toBe(false);
  });
});
