import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { getBank, resetBank, isChipEvent } from '../server/casino-store';
import { setPriceIndexForTest } from '../server/price-index';
import { SpaceProgram, SpaceError, SPACE_MIGRATION, requireCapable } from '../server/spaceProgram';
import { courierI, scoutI, makeDesign, designCost, parseDesign } from '../shared/spaceParts';
import { SPACE_PAYOUT, SPACE_MAX_PAID, SPACE_COOLDOWN_MS, LEO_DV_BUDGET, analyzeDesign } from '../shared/spaceFlight';

const fund = (name: string, n: number) => { const b = getBank(); b.transfer(name, n - b.account(name).chips, { game: 'admin' }); };
const chips = (n: string) => getBank().account(n).chips;

function shim(db: PGlite) {
  let chain = Promise.resolve();
  const q = async (sql: string, args?: unknown[]) => {
    const r = args?.length ? await db.query(sql, args as unknown[]) : (await db.exec(sql)).at(-1) ?? { rows: [], affectedRows: 0 };
    return { rows: r.rows as Record<string, unknown>[], rowCount: (r as { affectedRows?: number }).affectedRows ?? r.rows.length };
  };
  return { query: q, connect: async () => { let release!: () => void; const prev = chain; chain = new Promise<void>((r) => (release = r)); await prev; return { query: q, release }; } };
}

describe('space program (memory)', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); });

  it('charges for a capable Courier I launch and pays a capped deploy bounty', async () => {
    let now = Date.parse('2026-11-13T12:00:00Z');
    const p = new SpaceProgram(null, () => now);
    fund('Ann', 50_000);
    const before = chips('Ann');
    const cost = designCost(courierI());
    const L = await p.launch('Ann', courierI());
    expect(L.cost).toBe(cost);
    expect(L.cost).toBe(6850);
    expect(chips('Ann')).toBe(before - cost);
    expect(L.stats.capable).toBe(true);
    const d = await p.deploy('Ann', { launchId: L.launchId, peM: 80_000, apM: 90_000, periodS: 1900 });
    expect(d.payout).toBe(SPACE_PAYOUT);
    expect(d.prestigeOnly).toBe(false);
    expect(chips('Ann')).toBe(before - cost + SPACE_PAYOUT);
    expect(d.satellite.satName).toBe('CommSat');
    expect(d.paidCount).toBe(1);
    const v = await p.view('Ann');
    expect(v.sats).toHaveLength(1);
    expect(v.board[0]).toMatchObject({ name: 'Ann', sats: 1 });
    expect(v.rules.remainingPaid).toBe(SPACE_MAX_PAID - 1);
    await expect(p.deploy('Ann', { launchId: L.launchId })).rejects.toThrow(/already/);
  });

  it('rejects a weak rocket, a second launch inside the cooldown, and an expired ticket', async () => {
    let now = Date.parse('2026-11-13T12:00:00Z');
    const p = new SpaceProgram(null, () => now);
    fund('Bob', 50_000);
    const weak = makeDesign('Popgun', [
      { part: 'probe-okto', stage: 15 },
      { part: 'commsat', stage: 0 },
      { part: 'fl-t100', stage: 1 },
      { part: 'spark', stage: 1 },
    ]);
    expect(analyzeDesign(weak).capable).toBe(false);
    // Suborbital vehicles may roll out (sounding contracts), but cannot deploy.
    const weakStats = analyzeDesign(weak);
    if (weakStats.liftoffTwr < 1.15) {
      await expect(p.launch('Bob', weak)).rejects.toThrow(/TWR|thrust/i);
      expect(chips('Bob')).toBe(50_000);
    } else {
      const Lw = await p.launch('Bob', weak);
      expect(chips('Bob')).toBe(50_000 - designCost(weak));
      await expect(p.deploy('Bob', { launchId: Lw.launchId, peM: 80_000, apM: 80_000 })).rejects.toThrow(/Δv|dv|orbit|satellite/i);
      // Consume the cooldown so the rest of the test can launch Scout I.
      now += SPACE_COOLDOWN_MS + 10;
    }

    const L = await p.launch('Bob', scoutI());
    await expect(p.launch('Bob', scoutI())).rejects.toThrow(/cooling/);
    now += SPACE_COOLDOWN_MS + 10;
    // expire the first ticket, then a fresh launch
    now += 15 * 60_000;
    await expect(p.deploy('Bob', { launchId: L.launchId, peM: 80_000, apM: 80_000 })).rejects.toThrow(/expired/);
    const L2 = await p.launch('Bob', scoutI());
    const d = await p.deploy('Bob', { launchId: L2.launchId, peM: 80_000, apM: 85_000 });
    expect(d.payout).toBe(SPACE_PAYOUT);
  });

  it('stops paying after the lifetime cap; QA accounts never get the bounty', async () => {
    let now = Date.parse('2026-11-13T12:00:00Z');
    const p = new SpaceProgram(null, () => now);
    fund('Cat', 200_000);
    fund('QA-Pilot', 200_000);
    for (let i = 0; i < SPACE_MAX_PAID + 1; i++) {
      const L = await p.launch('Cat', courierI());
      const d = await p.deploy('Cat', { launchId: L.launchId, peM: 80_000, apM: 90_000 });
      if (i < SPACE_MAX_PAID) expect(d.payout).toBe(SPACE_PAYOUT);
      else { expect(d.payout).toBe(0); expect(d.prestigeOnly).toBe(true); }
      now += SPACE_COOLDOWN_MS + 1;
    }
    expect((await p.view('Cat')).sats).toHaveLength(SPACE_MAX_PAID + 1);
    expect((await p.paidCount('cat'))).toBe(SPACE_MAX_PAID);

    const Lq = await p.launch('QA-Pilot', courierI());
    const dq = await p.deploy('QA-Pilot', { launchId: Lq.launchId, peM: 80_000, apM: 90_000 });
    expect(dq.payout).toBe(0);
    expect(dq.prestigeOnly).toBe(true);
  });

  it('saves, lists and deletes designs, and refuses a bad payload', async () => {
    const p = new SpaceProgram(null);
    const s = await p.saveDesign('Dee', courierI());
    expect(s.name).toBe('Courier I');
    const list = await p.designsOf('Dee');
    expect(list).toHaveLength(1);
    const s2 = await p.saveDesign('Dee', { ...scoutI(), name: 'Scout I+' }, s.id);
    expect(s2.id).toBe(s.id);
    expect(s2.name).toBe('Scout I+');
    await p.deleteDesign('Dee', s.id);
    expect(await p.designsOf('Dee')).toHaveLength(0);
    expect(parseDesign({ name: 'x', parts: [{ uid: 'a', partId: 'nope', stage: 1 }] })).toBeNull();
    expect(() => requireCapable(makeDesign('NoSat', [
      { part: 'probe-okto', stage: 15 }, { part: 'fl-t800', stage: 1 }, { part: 'reliant', stage: 1 },
    ]))).toThrow(/satellite/);
  });

  it('does not launch without chips and treats launch and deploy as chip events', async () => {
    const p = new SpaceProgram(null);
    fund('Eve', 10);
    await expect(p.launch('Eve', courierI())).rejects.toThrow(/chips/);
    expect(chips('Eve')).toBe(10);
    expect(isChipEvent('space_launch')).toBe(true);
    expect(isChipEvent('space_deploy')).toBe(true);
    expect(isChipEvent('space_mission')).toBe(true);
    expect(LEO_DV_BUDGET).toBe(3400);
  });
});

describe('space program (postgres)', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); });
  it('migrates, charges once, and records a satellite', async () => {
    const db = new PGlite();
    let now = Date.parse('2026-11-13T12:00:00Z');
    const p = new SpaceProgram(shim(db) as never, () => now);
    await p.init();
    await p.init(); // idempotent
    fund('Fay', 50_000);
    const before = chips('Fay');
    const saved = await p.saveDesign('Fay', courierI());
    expect((await p.designsOf('Fay'))[0]!.id).toBe(saved.id);
    const L = await p.launch('Fay', courierI());
    expect(chips('Fay')).toBe(before - designCost(courierI()));
    const d = await p.deploy('Fay', { launchId: L.launchId, peM: 76_000, apM: 88_000, periodS: 1880 });
    expect(d.payout).toBe(SPACE_PAYOUT);
    expect(chips('Fay')).toBe(before - designCost(courierI()) + SPACE_PAYOUT);
    const v = await p.view('Fay');
    expect(v.sats[0]!.peM).toBe(76_000);
    expect(v.board[0]!.name).toBe('Fay');
    await expect(p.deploy('Fay', { launchId: L.launchId })).rejects.toThrow(/already/);
  });
});
