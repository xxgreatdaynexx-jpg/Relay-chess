import { beforeEach, describe, expect, it } from 'vitest';
import { getBank, resetBank } from '../server/casino-store';
import { setPriceIndexForTest } from '../server/price-index';
import { Travel, setTravel, setTravelJetHook } from '../server/travel';

const seed = (n: string, c: number) => { const b = getBank(); b.transferConfirmed(n, c - b.account(n).chips, { key: 'seed-' + n, game: 'admin' }); };
describe('Fort McChud ticket (Tess QA #1)', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); setTravelJetHook(async () => null); });
  it('charges 1,500 without a jet, every flight', async () => {
    const t = new Travel(null); setTravel(t); seed('QA-NoJet', 5000);
    expect((await t.fly('QA-NoJet', 'fortmc')).fee).toBe(1500); await t.home('QA-NoJet'); expect((await t.fly('QA-NoJet', 'fortmc')).fee).toBe(1500);
    expect(getBank().account('QA-NoJet').chips).toBe(2000);
  });
  it('still charges 1,500 when the player owns a Citation; the resort stays free', async () => {
    setTravelJetHook(async () => 'citation'); const t = new Travel(null); setTravel(t); seed('QA-Jet', 5000);
    expect((await t.fly('QA-Jet', 'fortmc')).fee).toBe(1500); await t.home('QA-Jet'); expect((await t.fly('QA-Jet', 'fortmc')).fee).toBe(1500); await t.home('QA-Jet');
    expect((await t.fly('QA-Jet', 'resort')).fee).toBe(0); expect(getBank().account('QA-Jet').chips).toBe(2000);
  });
});
