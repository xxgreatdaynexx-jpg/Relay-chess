import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBank, resetBank } from '../server/casino-store';
import { Fleet, setFleet } from '../server/fleet';
import { Travel, setTravel } from '../server/travel';
import { setJail, getJail, type Jail } from '../server/jail';
import { setPriceIndexForTest } from '../server/price-index';
import { JetSeats, setSeatExclusion } from '../server/jetSeats';
import { JET_SEATS, MAX_SEAT_PRICE, SEAT_REQUEST_TTL_MS, BOARDING_TTL_MS, jetSeats } from '../shared/jetSeats';
import { JETS, fleetModel } from '../shared/fleet';
import { LAUNCH } from '../shared/launchPopup';

const fund = (n: string, amt: number) => getBank().transferConfirmed(n, amt, { key: `f:${n}:${Math.random()}`, game: 'admin' });
const chips = (n: string) => getBank().account(n).chips;
const T0 = Date.parse('2026-11-04T18:00:00Z');

describe('jet passenger seats (mu-jet-seats)', () => {
  let now = T0; let s: JetSeats; let t: Travel; let f: Fleet; const jailed = new Set<string>(); const realJail = getJail();
  const owner = async (n: string, model = 'citation') => { await fund(n, fleetModel(model, 'jet')!.price + 50_000); await f.buy(n, 'jet', model); };
  beforeEach(() => {
    resetBank(); setPriceIndexForTest(1); now = T0; jailed.clear();
    f = new Fleet(null, () => now); setFleet(f); t = new Travel(null, () => now); setTravel(t); s = new JetSeats(() => now);
    setJail({ isJailed: (n: string | null | undefined) => !!n && jailed.has(n.toLowerCase()) } as unknown as Jail);
    setSeatExclusion((n) => /^bot/i.test(n)); // these tests use QA names as real players; the default excludes QA too (tested below)
  });
  afterEach(() => { setSeatExclusion(null); setJail(realJail); setFleet(null); setPriceIndexForTest(1); });

  it('seats scale with the jet tier and show in the store data', () => {
    expect(JET_SEATS).toEqual({ citation: 2, g700: 6, global: 8, chudone: 12 });
    for (let i = 1; i < JETS.length; i++) expect(jetSeats(JETS[i]!.id)).toBeGreaterThan(jetSeats(JETS[i - 1]!.id));
    expect(fleetModel('citation')!.blurb).toMatch(/Two passenger seats/);
  });
  it('free ride: request, accept, take off: owner and passenger arrive together; no chips move', async () => {
    await owner('QA-Own'); await fund('QA-Pax', 100);
    const { boarding } = await s.open('QA-Own', 'resort');
    expect(boarding.seats).toBe(2); expect(boarding.from).toBe('city');
    expect(s.visibleTo('QA-Pax').map((b) => b.id)).toEqual([boarding.id]);
    expect(s.request('QA-Pax', boarding.id).status).toBe('pending');
    expect(s.respond('QA-Own', 'QA-Pax', true).status).toBe('seated');
    const c = chips('QA-Pax'); const r = await s.depart('QA-Own');
    expect(r.passengers).toEqual(['QA-Pax']); expect(t.where('QA-Own')).toBe('resort'); expect(t.where('QA-Pax')).toBe('resort'); expect(chips('QA-Pax')).toBe(c);
    // the return flight works the same way
    const back = await s.open('QA-Own', 'city'); s.request('QA-Pax', back.boarding.id); s.respond('QA-Own', 'QA-Pax', true);
    await s.depart('QA-Own'); expect(t.where('QA-Own')).toBe('city'); expect(t.where('QA-Pax')).toBe('city');
  });
  it('paid seat: capped fare through the wallet, charged exactly once, refunded if the passenger leaves or boarding closes', async () => {
    await owner('QA-Own2'); await fund('QA-Fare', 10_000); const f0 = chips('QA-Fare');
    await expect(s.open('QA-Own2', 'fortmc', MAX_SEAT_PRICE + 1)).rejects.toThrow(/capped/);
    await expect(s.open('QA-Own2', 'fortmc', -5)).rejects.toThrow(/whole number/);
    const { boarding } = await s.open('QA-Own2', 'fortmc', 1_000); const o0 = chips('QA-Own2'), p0 = chips('QA-Fare');
    s.request('QA-Fare', boarding.id); s.respond('QA-Own2', 'QA-Fare', true);
    s.respond('QA-Own2', 'QA-Fare', true); s.request('QA-Fare', boarding.id); // double click / retry: idempotent
    expect(chips('QA-Fare')).toBe(p0 - 1_000); expect(chips('QA-Own2')).toBe(o0 + 1_000);
    s.leave('QA-Fare'); expect(chips('QA-Fare')).toBe(p0); expect(chips('QA-Own2')).toBe(o0);
    const b2 = await s.open('QA-Own2', 'fortmc', 1_000).catch(() => null); expect(b2).toBeNull(); // still open (one boarding per owner)
    s.request('QA-Fare', boarding.id); s.respond('QA-Own2', 'QA-Fare', true); expect(chips('QA-Fare')).toBe(p0 - 1_000);
    s.cancel('QA-Own2'); expect(chips('QA-Fare')).toBe(p0); expect(chips('QA-Own2')).toBe(o0);
    expect(chips('QA-Fare')).toBe(f0); await fund('QA-Broke', 10); getBank().transfer('QA-Broke', -chips('QA-Broke'), { game: 'admin' }); const b3 = await s.open('QA-Own2', 'fortmc', 1_000);
    expect(() => s.request('QA-Broke', b3.boarding.id)).toThrow(/Not enough chips/);
  });
  it('concurrent requests: never overbooked, nobody double-boards, every charge exactly once', async () => {
    await owner('QA-Big', 'g700'); await owner('QA-Other');
    const pax = Array.from({ length: 20 }, (_, i) => `QA-P${i}`); for (const p of pax) await fund(p, 5_000); const base = new Map(pax.map((p) => [p, chips(p)]));
    const a = (await s.open('QA-Big', 'resort', 500)).boarding; const b = (await s.open('QA-Other', 'resort', 500)).boarding;
    const got = await Promise.allSettled(pax.flatMap((p) => [Promise.resolve().then(() => s.request(p, a.id)), Promise.resolve().then(() => s.request(p, b.id))]));
    const ok = got.filter((g) => g.status === 'fulfilled').length; expect(ok).toBe(pax.length); // each player holds ONE request across all jets
    const accepts = await Promise.allSettled(pax.flatMap((p) => [0, 1, 2].map(() => Promise.resolve().then(() => s.respond('QA-Big', p, true)))));
    expect(accepts.filter((x) => x.status === 'fulfilled').length).toBeGreaterThan(0);
    const view = s.list().find((x) => x.id === a.id)!; expect(view.seated.length).toBeLessThanOrEqual(6);
    const seatedOnA = view.seated.length; const paid = pax.filter((p) => chips(p) === base.get(p)! - 500).length; expect(paid).toBe(seatedOnA);
    expect(pax.every((p) => chips(p) === base.get(p)! || chips(p) === base.get(p)! - 500)).toBe(true);
    const r = await s.depart('QA-Big'); expect(r.passengers.length).toBe(seatedOnA); expect(r.passengers.length).toBeLessThanOrEqual(6);
  });
  it('a full jet refuses more requests; a declined passenger can ask another jet', async () => {
    await owner('QA-Cit'); await owner('QA-Cit2'); for (const p of ['QA-A', 'QA-B', 'QA-C']) await fund(p, 100);
    const { boarding } = await s.open('QA-Cit', 'resort'); const b2 = (await s.open('QA-Cit2', 'resort')).boarding;
    s.request('QA-A', boarding.id); s.request('QA-C', boarding.id); s.respond('QA-Cit', 'QA-A', false); expect(s.request('QA-A', b2.id).status).toBe('pending');
    s.request('QA-B', boarding.id); s.respond('QA-Cit', 'QA-B', true); s.respond('QA-Cit', 'QA-C', true);
    s.leave('QA-A'); expect(() => s.request('QA-A', boarding.id)).toThrow(/full/);
  });
  it('requests time out; boarding expires and refunds', async () => {
    await owner('QA-T'); await fund('QA-Slow', 5_000); await fund('QA-Seat', 5_000); const s0 = chips('QA-Seat');
    const { boarding } = await s.open('QA-T', 'resort', 200); s.request('QA-Slow', boarding.id); s.request('QA-Seat', boarding.id); s.respond('QA-T', 'QA-Seat', true);
    now += SEAT_REQUEST_TTL_MS; expect(() => s.respond('QA-T', 'QA-Slow', true)).toThrow(/expired/);
    expect(s.list()[0]!.pending).toHaveLength(0);
    now = T0 + BOARDING_TTL_MS; expect(s.list()).toHaveLength(0); expect(chips('QA-Seat')).toBe(s0);
  });
  it('jailed players cannot request; QA and bots are excluded by default; passengers must be at the same airport', async () => {
    await owner('QA-J'); await fund('QA-Jailbird', 100); await fund('QA-Away', 100);
    const { boarding } = await s.open('QA-J', 'resort');
    jailed.add('qa-jailbird'); expect(() => s.request('QA-Jailbird', boarding.id)).toThrow(/jail/);
    await fund('QA-Away', 2_000); await t.fly('QA-Away', 'fortmc'); expect(() => s.request('QA-Away', boarding.id)).toThrow(/same airport/);
    expect(() => s.request('QA-J', boarding.id)).toThrow(/your jet/);
    setSeatExclusion(null);
    expect(() => s.request('QA-Away', boarding.id)).toThrow(/not available/); expect(() => s.request('Bot Larry', boarding.id)).toThrow(/not available/);
    await expect(s.open('QA-J', 'fortmc')).rejects.toThrow(/not available/);
  });
  it('a seated passenger who got jailed before take-off stays behind and is refunded', async () => {
    await owner('QA-Jo'); await fund('QA-Late', 5_000); const l0 = chips('QA-Late');
    const { boarding } = await s.open('QA-Jo', 'resort', 300); s.request('QA-Late', boarding.id); s.respond('QA-Jo', 'QA-Late', true);
    jailed.add('qa-late'); const r = await s.depart('QA-Jo');
    expect(r.passengers).toEqual([]); expect(r.stayed).toEqual(['QA-Late']); expect(t.where('QA-Late')).toBe('city'); expect(chips('QA-Late')).toBe(l0);
  });
  it('non-owners cannot open boarding', async () => { await fund('QA-NoJet', 100); await expect(s.open('QA-NoJet', 'resort')).rejects.toThrow(/private jet/); });
  it('is in the launch popup', () => { expect(LAUNCH.items.some((i) => i.title === 'Jet passenger seats' && /Request a seat/.test(i.text))).toBe(true); });
});
