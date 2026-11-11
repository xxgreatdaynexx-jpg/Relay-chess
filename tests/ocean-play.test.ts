import { beforeEach, describe, expect, it } from 'vitest';
import { getBank, resetBank, START_CHIPS } from '../server/casino-store';
import { Fleet, setFleet, getFleet } from '../server/fleet';
import { Travel, setTravel, getTravel } from '../server/travel';
import { setPriceIndexForTest } from '../server/price-index';
import { OceanPlay, setOcean } from '../server/oceanPlay';
import { fleetModel } from '../shared/fleet';
import { VOYAGES, hullHp, canSailVoyage } from '../shared/voyages';
import { SINK_DEBIT_GAMES } from '../shared/sinkRoom';
import { isLocation, isDestination } from '../shared/resort';

const fund = (n: string, amt: number) => getBank().transferConfirmed(n, amt, { key: `test_fund:${n}:${Math.random()}`, game: 'admin' });
async function buyBoat(name: string, model: string) {
  const f = getFleet() ?? new Fleet(null); setFleet(f);
  const price = fleetModel(model, 'boat')!.price;
  await fund(name, price);
  await f.buy(name, 'boat', model);
  return f;
}

describe('ocean voyages, yacht boarding and opt-in ship combat', () => {
  let now = 0;
  let ocean: OceanPlay;
  beforeEach(() => {
    resetBank(); setPriceIndexForTest(1); setFleet(null);
    now = Date.parse('2026-11-10T20:00:00Z');
    ocean = new OceanPlay(() => now); setOcean(ocean);
    setTravel(new Travel(null, () => now));
  });

  it('voyage is a location, not a ticketed destination, and combat/repair are sinks', () => {
    expect(isLocation('voyage')).toBe(true);
    expect(isDestination('voyage')).toBe(false);
    expect(SINK_DEBIT_GAMES.has('ship_combat')).toBe(true);
    expect(SINK_DEBIT_GAMES.has('hull_repair')).toBe(true);
    expect(canSailVoyage(1, 'atoll')).toBe(true);
    expect(canSailVoyage(1, 'abyss')).toBe(false);
  });

  it('sails a voyage the boat can reach, carries boarded crew, and returns them to the city', async () => {
    await buyBoat('Cap', 'yacht');
    await buyBoat('Pal', 'skiff');
    await ocean.openBoard('Cap', 'atoll', 0);
    const list = ocean.listBoards();
    expect(list[0]!.dest).toBe('atoll');
    await ocean.requestSeat('Pal', list[0]!.id);
    await ocean.respondSeat('Cap', 'Pal', true);
    const d = await ocean.depart('Cap');
    expect(d.voyage!.phase).toBe('underway');
    expect(d.passengers).toContain('Pal');
    expect(getTravel().where('Cap')).toBe('voyage');
    expect(getTravel().where('Pal')).toBe('voyage');
    now = d.voyage!.arrivesAt;
    ocean.sweep();
    expect(ocean.voyageOf('Cap')!.phase).toBe('arrived');
    const home = await ocean.headHome('Cap');
    now = home.voyage!.arrivesAt;
    ocean.sweep();
    expect(ocean.voyageOf('Cap')).toBeNull();
    expect(getTravel().where('Cap')).toBe('city');
    expect(getTravel().where('Pal')).toBe('city');
  });

  it('refuses a deep voyage on a skiff and a departure with unpaid hull damage', async () => {
    await buyBoat('Kid', 'skiff');
    await expect(ocean.depart('Kid', 'abyss')).rejects.toThrow(/cannot reach/);
    await ocean.depart('Kid', 'atoll');
    now = ocean.voyageOf('Kid')!.arrivesAt; ocean.sweep();
    // Simulate damage
    (ocean as unknown as { damaged: Map<string, number> }).damaged.set('kid', 1_000);
    await ocean.headHome('Kid');
    now = ocean.voyageOf('Kid')!.arrivesAt; ocean.sweep();
    await expect(ocean.depart('Kid', 'atoll')).rejects.toThrow(/Repair your hull/);
    await fund('Kid', 1_000);
    const paid = await ocean.payRepair('Kid');
    expect(paid.paid).toBe(1_000);
    expect(paid.owed).toBe(0);
    await ocean.depart('Kid', 'atoll');
    expect(ocean.voyageOf('Kid')?.phase).toBe('underway');
  });

  it('only opted-in captains already arrived can fight, and the wallet never goes negative', async () => {
    await buyBoat('Ava', 'yacht');
    await buyBoat('Ben', 'yacht');
    await ocean.depart('Ava', 'atoll');
    await ocean.depart('Ben', 'atoll');
    await expect(ocean.challenge('Ava', 'Ben', 0)).rejects.toThrow(/arrived/);
    now = Math.max(ocean.voyageOf('Ava')!.arrivesAt, ocean.voyageOf('Ben')!.arrivesAt);
    ocean.sweep();
    await expect(ocean.challenge('Ava', 'Ben', 0)).rejects.toThrow(/opt in/);
    ocean.setOptIn('Ava', true); ocean.setOptIn('Ben', true);
    await ocean.challenge('Ava', 'Ben', 0);
    await ocean.answer('Ben', true);
    const hp = hullHp('yacht');
    // Fire until one hull is gone (deterministic max damage).
    let guard = 0;
    while (ocean.view('Ava').fight && guard++ < 30) {
      const to = ocean.view('Ava').fight!.toAct;
      const r = await ocean.fire(to, 20);
      if ('winner' in r && r.winner) {
        expect(['Ava', 'Ben']).toContain(r.winner);
        expect(r.repair).toBeGreaterThan(0);
        const loser = r.winner === 'Ava' ? 'Ben' : 'Ava';
        const before = getBank().account(loser).chips;
        expect(before).toBeGreaterThanOrEqual(START_CHIPS); // buy spent some, but not negative
        expect(getBank().account(loser).chips).toBeGreaterThanOrEqual(0);
        break;
      }
    }
    expect(guard).toBeLessThan(30);
  });

  it('escrows a fight stake, pays the winner the pot minus a rake, and never opts anyone in by default', async () => {
    await buyBoat('Ava', 'yacht');
    await buyBoat('Ben', 'yacht');
    await fund('Ava', 20_000); await fund('Ben', 20_000);
    const a0 = getBank().account('Ava').chips; const b0 = getBank().account('Ben').chips;
    await ocean.depart('Ava', 'atoll'); await ocean.depart('Ben', 'atoll');
    now = Math.max(ocean.voyageOf('Ava')!.arrivesAt, ocean.voyageOf('Ben')!.arrivesAt); ocean.sweep();
    ocean.setOptIn('Ava', true); ocean.setOptIn('Ben', true);
    await ocean.challenge('Ava', 'Ben', 10_000);
    await ocean.answer('Ben', true);
    expect(getBank().account('Ava').chips).toBe(a0 - 10_000);
    expect(getBank().account('Ben').chips).toBe(b0 - 10_000);
    let winner = ''; let prize = 0;
    for (let i = 0; i < 30; i++) {
      const to = ocean.view('Ava').fight?.toAct; if (!to) break;
      const r = await ocean.fire(to, 20);
      if ('winner' in r && r.winner) { winner = String(r.winner); prize = Number(r.prize ?? 0); break; }
    }
    expect(prize).toBe(19_000); // 20k pot, 5% rake
    expect(getBank().account(winner).chips).toBe((winner === 'Ava' ? a0 : b0) - 10_000 + 19_000);
    expect(ocean.view('Cy').opted).toBe(false);
  });
});

describe('yacht 3D models', () => {
  it('builds a distinct megayacht, not a scaled superyacht', async () => {
    const { buildBoat } = await import('../client/src/lib/fleetModels');
    const { BOATS } = await import('../shared/fleet');
    const THREE = await import('three');
    const box = (id: string) => { const g = buildBoat(BOATS.find((b) => b.id === id)!); const b = new THREE.Box3().setFromObject(g); const s = new THREE.Vector3(); b.getSize(s); return s; };
    const y = box('yacht'), s = box('superyacht'), m = box('megayacht');
    expect(m.z).toBeGreaterThan(s.z);
    expect(s.z).toBeGreaterThan(y.z * 0.9);
    expect(m.x).toBeGreaterThan(s.x);
  });
});
