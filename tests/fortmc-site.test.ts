import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { getBank, resetBank } from '../server/casino-store';
import { setPriceIndexForTest } from '../server/price-index';
import { FortMc } from '../server/fortmc';
import { buildFortSite, auditFortOverlaps, ownerColor, plantOwnerOffset, newFort, tractInfo, TRACTS } from '../shared/fortmc';

function shim(db: PGlite) {
  let chain = Promise.resolve();
  const q = async (sql: string, args?: unknown[]) => { const r = args?.length ? await db.query(sql, args as unknown[]) : (await db.exec(sql)).at(-1) ?? { rows: [], affectedRows: 0 }; return { rows: r.rows as Record<string, unknown>[], rowCount: (r as { affectedRows?: number }).affectedRows ?? r.rows.length }; };
  return { query: q, connect: async () => { let release!: () => void; const prev = chain; chain = new Promise<void>((r) => (release = r)); await prev; return { query: q, release }; } };
}
const seed = (n: string, chips: number) => { const b = getBank(); b.transfer(n, chips - b.account(n).chips, { game: 'admin' }); };

describe('Fort McChud public site + exclusive leases', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); });

  it('ownerColor is stable and plant yards only offset later operators', () => {
    expect(ownerColor('ann')).toBe(ownerColor('ann'));
    expect(ownerColor('ann')).not.toBe(ownerColor('bob'));
    expect(plantOwnerOffset(0)).toEqual({ x: 0, z: 0 });
    expect(plantOwnerOffset(1).x !== 0 || plantOwnerOffset(1).z !== 0).toBe(true);
  });

  it('two players can see each other\'s wells and pipes; a second lease on the same tract is refused', async () => {
    const f = new FortMc(null, () => 1_000_000, () => ({ write: async () => {}, after: () => {} }), async () => {});
    seed('Ann', 500_000); seed('Bob', 500_000);
    await f.act('Ann', { op: 'survey', tract: 1 }); await f.act('Ann', { op: 'lease', tract: 1 });
    await f.act('Ann', { op: 'drill', tract: 1 }); await f.act('Ann', { op: 'pumpjack', tract: 1 }); await f.act('Ann', { op: 'pipe', tract: 1 });
    await f.act('Bob', { op: 'survey', tract: 1 });
    await expect(f.act('Bob', { op: 'lease', tract: 1 })).rejects.toThrow(/already holds the lease|already hold/);
    await expect(f.act('Bob', { op: 'drill', tract: 1 })).rejects.toThrow(/Only Ann|lease/i);
    await f.act('Bob', { op: 'survey', tract: 2 }); await f.act('Bob', { op: 'lease', tract: 2 });
    await f.act('Bob', { op: 'drill', tract: 2 }); await f.act('Bob', { op: 'pipe', tract: 2 });
    const a = await f.view('Ann'); const b = await f.view('Bob');
    expect(a.site.leases['1']?.name).toBe('Ann'); expect(a.site.leases['1']?.mine).toBe(true);
    expect(b.site.leases['1']?.mine).toBe(false); expect(b.site.leases['2']?.mine).toBe(true);
    const t1 = a.site.tracts.find((t) => t.n === 1)!;
    expect(t1.wells.some((w) => w.ownerName === 'Ann' && w.jack)).toBe(true);
    expect(t1.pipes.some((p) => p.ownerName === 'Ann' && p.pipe === 1)).toBe(true);
    const t2 = a.site.tracts.find((t) => t.n === 2)!;
    expect(t2.wells.some((w) => w.ownerName === 'Bob')).toBe(true);
    expect(t2.pipes.some((p) => p.ownerName === 'Bob')).toBe(true);
    expect(a.site.players.map((p) => p.name).sort()).toEqual(['Ann', 'Bob']);
  });

  it('grandfathered foreign wells are left in place, still produce, and are counted by the overlap audit', async () => {
    // Two personal leases on tract 1 exist in stored JSON; official backfill keeps the first lessor.
    const db = new PGlite(); const f0 = new FortMc(shim(db) as never, () => 2_000_000, () => ({ write: async () => {}, after: () => {} }), async () => {});
    await f0.init();
    seed('Ann', 500_000); seed('Bob', 500_000);
    await f0.act('Ann', { op: 'survey', tract: 3 }); await f0.act('Ann', { op: 'lease', tract: 3 });
    // Simulate a legacy overlap: write Bob's state with a leased tract 3 + a well directly into the table.
    const bob = newFort(2_000_000);
    bob.surveyed.push(3);
    bob.tracts['3'] = { leased: true, pipe: 1, wells: [{ jack: true, cond: 100 }] };
    await db.query('INSERT INTO fortmc_state (player_key, name, state, updated_at) VALUES ($1,$2,$3,$4) ON CONFLICT (player_key) DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at', ['bob', 'Bob', JSON.stringify(bob), 3_000_000]);
    const f = new FortMc(shim(db) as never, () => 2_000_000, () => ({ write: async () => {}, after: () => {} }), async () => {});
    await f.init();
    const o = f.overlaps();
    expect(o).toBeTruthy();
    expect(o!.tracts).toBeGreaterThanOrEqual(1);
    expect(o!.wells).toBeGreaterThanOrEqual(1);
    const v = await f.view('Ann');
    const t3 = v.site.tracts.find((t) => t.n === 3)!;
    expect(t3.lease?.name).toBe('Ann'); // Ann leased first via official table; Bob's later row does not steal it
    expect(t3.wells.some((w) => w.ownerName === 'Bob')).toBe(true); // grandfathered, not deleted
    await expect(f.act('Bob', { op: 'drill', tract: 3 })).rejects.toThrow(/Only Ann/);
    // Bob's existing well still sits on the site snapshot (private production stays in Bob's JSON).
    expect(t3.wells.filter((w) => w.ownerName === 'Bob').length).toBe(1);
  });

  it('auditFortOverlaps counts foreign wells/pipes and never implies deletion', () => {
    const ann = newFort(0); ann.tracts['1'] = { leased: true, pipe: 1, wells: [{ jack: true, cond: 100 }] };
    const bob = newFort(0); bob.tracts['1'] = { leased: true, pipe: 1, wells: [{ jack: false, cond: 100 }, { jack: true, cond: 80 }] };
    const r = auditFortOverlaps(
      [{ key: 'ann', name: 'Ann', state: ann }, { key: 'bob', name: 'Bob', state: bob }],
      { '1': { key: 'ann', name: 'Ann' } },
    );
    expect(r).toEqual({ tracts: 1, wells: 2, pipes: 1, details: [{ tract: 1, official: 'Ann', foreignWells: 2, foreignPipes: 1 }] });
    expect(bob.tracts['1']!.wells.length).toBe(2); // untouched
  });
});

void buildFortSite; void tractInfo; void TRACTS;
