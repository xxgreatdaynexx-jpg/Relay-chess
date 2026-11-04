import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBank, resetBank } from '../server/casino-store';
import { getMines, resetMines } from '../server/mines';
import { setPriceIndexForTest } from '../server/price-index';
import { setJail, Jail } from '../server/jail';
import { SupplyContracts, resetSupply } from '../server/supplyContracts';
import { LinkRegistry } from '../server/linked';
import { getLogistics, setLogistics } from '../server/logistics';
import { priceOf } from '../shared/mines';
import { SC_GRACE_MS, scBand, scBond, scPenalty, scValue } from '../shared/coop3';
import { LAUNCH } from '../shared/launchPopup';

const HOUR = 3_600_000, DAY = 24 * HOUR;
let n = 0; const nonce = () => `nonce${++n}x${Math.random().toString(36).slice(2, 8)}`;
const fund = (who: string, amt: number) => getBank().transferConfirmed(who, amt, { key: `test_fund:${who}:${Math.random()}`, game: 'admin' });
const chips = (who: string) => getBank().account(who).chips;
const OLD = async () => ({ ageMs: 30 * DAY, playMs: 50 * HOUR, exists: true });
const REF = priceOf({ type: 'ore', id: 'iron' });
let now = 0; let s: SupplyContracts;
const offer = (o: Record<string, unknown> = {}) => s.propose('Sally', { buyer: 'Bob', type: 'ore', id: 'iron', qty: 100, unit: REF, intervalH: 12, n: 4, nonce: nonce(), ...o });

describe('supply contracts', () => {
  beforeEach(() => {
    resetBank(); resetMines(); setPriceIndexForTest(1); now = 1000 * DAY; s = resetSupply(new SupplyContracts(null, () => now));
    s.guard.accountInfo = OLD; s.guard.allowQa = false; s.guard.linked = () => false;
    s.trucksOf = (x) => (x === 'Sally' ? [{ id: 't1', truckId: 'pickup' }, { id: 't2', truckId: 'semi' }] : []); s.freightBusy = () => new Set();
    fund('Sally', 1_000_000); fund('Bob', 1_000_000); getMines().adjustStack('Sally', 'ore', 'iron', 10_000);
  });
  afterEach(() => { resetSupply(); setJail(new Jail(null)); });

  it('price band is ±30% of house price', () => {
    const b = scBand(1000); expect(b).toEqual({ lo: 700, hi: 1300 });
    return Promise.all([
      expect(offer({ unit: Math.floor(REF * 1.31) + 1 })).rejects.toThrow(/±30%/),
      expect(offer({ unit: Math.ceil(REF * 0.69) - 1 })).rejects.toThrow(/±30%/),
    ]);
  });

  it('full happy path: bond, escrow, 4 deliveries, bond back; replay is a no-op', async () => {
    const s0 = chips('Sally'), b0 = chips('Bob'); const nn = nonce();
    const c = await offer({ nonce: nn }); const bond = scBond(REF, 100, 4); const value = scValue(REF, 100, 4);
    expect(c.bond).toBe(bond); expect(chips('Sally')).toBe(s0 - bond);
    expect((await offer({ nonce: nn })).replay).toBe(true); expect(chips('Sally')).toBe(s0 - bond);
    await expect(s.accept('Sally', c.id)).rejects.toThrow(/buyer/);
    await s.accept('Bob', c.id); expect(chips('Bob')).toBe(b0 - value);
    await expect(s.accept('Bob', c.id)).rejects.toThrow(/no longer open/);
    for (let k = 0; k < 4; k++) {
      const d = await s.dispatch('Sally', c.id); expect(d.transit?.truck).toBe('t1');
      await expect(s.dispatch('Sally', c.id)).rejects.toThrow(/already on the road/);
      expect(s.contractTrucks('Sally')).toEqual(['t1']);
      now += HOUR; await s.tick(); now += 11 * HOUR;
    }
    const v = s.list('Bob')[0]!; expect(v.status).toBe('done'); expect(v.delivered).toBe(4); expect(v.escrow).toBe(0);
    expect(getMines().stackQty('Bob', 'ore', 'iron')).toBe(400); expect(getMines().stackQty('Sally', 'ore', 'iron')).toBe(9_600);
    expect(chips('Sally')).toBe(s0 + value); expect(chips('Bob')).toBe(b0 - value);
    expect(await s.tick()).toBe(0);
  });

  it('dispatch with no stock takes nothing', async () => {
    const c = await offer(); await s.accept('Bob', c.id);
    getMines().adjustStack('Sally', 'ore', 'iron', -10_000);
    await expect(s.dispatch('Sally', c.id)).rejects.toThrow(/don’t have/); expect(s.list('Sally')[0]!.transit).toBeNull();
  });

  it('a miss refunds that delivery + penalty; two misses breach (bond to buyer, escrow back)', async () => {
    const s0 = chips('Sally'), b0 = chips('Bob'); const c = await offer(); await s.accept('Bob', c.id);
    const bond = scBond(REF, 100, 4), pay = REF * 100, pen = scPenalty(bond, 4);
    now += 12 * HOUR + SC_GRACE_MS + 1; await s.tick();
    let v = s.list('Bob')[0]!; expect(v.missed).toBe(1); expect(v.k).toBe(1); expect(chips('Bob')).toBe(b0 - scValue(REF, 100, 4) + pay + pen);
    now += 12 * HOUR; await s.tick();
    v = s.list('Bob')[0]!; expect(v.status).toBe('breached');
    expect(chips('Bob')).toBe(b0 + bond); expect(chips('Sally')).toBe(s0 - bond);
    await expect(s.dispatch('Sally', c.id)).rejects.toThrow(/isn’t active/);
  });

  it('pending: decline/withdraw refund the bond; offers expire after 24h', async () => {
    const s0 = chips('Sally');
    const a = await offer(); await s.decline('Bob', a.id); expect(chips('Sally')).toBe(s0); expect(s.list('Bob')[0]!.status).toBe('declined');
    const b = await offer(); await s.decline('Sally', b.id); expect(s.list('Sally').find((x) => x.id === b.id)!.status).toBe('withdrawn');
    const c = await offer(); now += DAY + 1; await s.tick(); expect(s.list('Sally').find((x) => x.id === c.id)!.status).toBe('expired'); expect(chips('Sally')).toBe(s0);
  });

  it('cancel rules: mutual refunds both, seller walk-away = breach, buyer walk-away pays a fee', async () => {
    const s0 = chips('Sally'), b0 = chips('Bob');
    const a = await offer(); await s.accept('Bob', a.id); await s.cancel('Bob', a.id, true);
    expect(s.list('Bob')[0]!.cancelReq).toBe('buyer'); await s.cancel('Sally', a.id, true);
    expect(chips('Sally')).toBe(s0); expect(chips('Bob')).toBe(b0);
    const b = await offer(); await s.accept('Bob', b.id); await s.cancel('Sally', b.id, false);
    const bond = scBond(REF, 100, 4); expect(chips('Bob')).toBe(b0 + bond); expect(chips('Sally')).toBe(s0 - bond);
    const c = await offer(); await s.accept('Bob', c.id); const fee = Math.floor(scValue(REF, 100, 4) * 0.1); await s.cancel('Bob', c.id, false);
    expect(chips('Bob')).toBe(b0 + bond - fee); expect(chips('Sally')).toBe(s0 - bond + fee);
  });

  it('can’t cancel while a truck is on the road', async () => {
    const c = await offer(); await s.accept('Bob', c.id); await s.dispatch('Sally', c.id);
    await expect(s.cancel('Sally', c.id, false)).rejects.toThrow(/Wait for the truck/);
  });

  it('exclusions: QA, bots, jailed, young/new accounts, linked accounts, no truck, too many open', async () => {
    await expect(offer({ buyer: 'QA-Cole-Visit' })).rejects.toThrow(/QA or bot/);
    await expect(s.propose('QA-Cole-Visit', { buyer: 'Bob', type: 'ore', id: 'iron', qty: 100, unit: REF, intervalH: 12, n: 4, nonce: nonce() })).rejects.toThrow(/QA and bot/);
    await expect(offer({ buyer: 'bot-1' })).rejects.toThrow(/QA or bot/);
    setJail({ isJailed: (x: string | null | undefined) => x === 'Bob' } as unknown as Jail);
    await expect(offer()).rejects.toThrow(/Bob is in jail/); setJail(new Jail(null));
    s.guard.accountInfo = async (x) => ({ ageMs: x === 'Bob' ? HOUR : 30 * DAY, playMs: 50 * HOUR, exists: true });
    await expect(offer()).rejects.toThrow(/Bob’s account must be at least 3 days/); s.guard.accountInfo = OLD;
    const reg = new LinkRegistry(null, () => now); reg.record('Sally', '1.2.3.4', null); reg.record('Bob', '1.2.3.4', null);
    s.guard.linked = (a, b) => reg.linked(a, b); await expect(offer()).rejects.toThrow(/linked/); s.guard.linked = () => false;
    await expect(offer({ qty: 5_000 })).rejects.toThrow(/truck that carries/);
    await expect(offer({ buyer: 'Sally' })).rejects.toThrow(/yourself/);
    const before = chips('Sally'); for (let i = 0; i < 5; i++) await offer();
    await expect(offer()).rejects.toThrow(/5 open/);
    expect(chips('Sally')).toBe(before - 5 * scBond(REF, 100, 4));
  });

  it('not enough chips for the escrow leaves the offer pending and Bob untouched', async () => {
    const c = await offer({ qty: 1000, unit: REF }); getBank().transferConfirmed('Bob', -chips('Bob') + 10, { key: 'drain', game: 'admin' });
    await expect(s.accept('Bob', c.id)).rejects.toThrow(/escrow/); expect(chips('Bob')).toBe(10); expect(s.list('Bob')[0]!.status).toBe('pending');
  });

  it('contract trucks count as busy for freight', async () => {
    const prev = getLogistics(); try {
      const c = await offer(); await s.accept('Bob', c.id); await s.dispatch('Sally', c.id);
      const { Logistics } = await import('../server/logistics'); const l = new Logistics(null); setLogistics(l);
      expect(l.busyTrucks('Sally').has('t1')).toBe(true);
    } finally { setLogistics(prev); }
  });

  it('linked registry: shared ip/device within 30 days links, old sightings do not', () => {
    let t = 0; const r = new LinkRegistry(null, () => t);
    r.record('A', '9.9.9.9', 'device-aaaa'); r.record('B', '8.8.8.8', 'device-aaaa'); r.record('C', '7.7.7.7', 'device-cccc');
    expect(r.linked('A', 'B')).toBe(true); expect(r.linked('A', 'C')).toBe(false);
    t = 31 * DAY; expect(r.linked('A', 'B')).toBe(false);
  });

  it('launch popup lists supply contracts', () => { expect(LAUNCH.items.some((i) => /Supply contracts/i.test(i.title))).toBe(true); });
});
