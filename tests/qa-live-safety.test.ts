import { describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { propertyPaidPlusUpgradesOf, propertySpend, RealEstate } from '../server/realEstate';
import { quotePurchaseTax, recipientsFor, resetPurchaseTaxCache } from '../server/purchase-tax';
import { setEconomyForTest, type Economy } from '../server/economy';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { properties, landPrice } from '../shared/realEstate';
import { CHANGELOG } from '../shared/changelog';

const reject = () => Promise.reject(new Error('database read failed'));

describe('QA live safety: failed reads never become zero', () => {
  it('property rows, upgrades and planted crops propagate read failures', async () => {
    await expect(propertyPaidPlusUpgradesOf({ query: reject }, 'Dayne')).rejects.toThrow('database read failed');
    const owned = { query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 'f:1', price: 100 }] }).mockRejectedValueOnce(new Error('upgrades read failed')) };
    await expect(propertyPaidPlusUpgradesOf(owned, 'Dayne')).rejects.toThrow('upgrades read failed');
    for (const [n, error] of [[1, 'upgrade ledger read failed'], [2, 'crop read failed']] as const) {
      const db = { query: vi.fn((sql: string) => {
        const call = db.query.mock.calls.length;
        if (call === n + 1) return Promise.reject(new Error(error));
        if (/FROM farm_upgrades/.test(sql)) return Promise.resolve({ rows: [{ plot_id: 'f:1', kind: 'sprinkler', level: 1 }] });
        return Promise.resolve({ rows: [] });
      }) };
      await expect(propertySpend(db, 'dayne')).rejects.toThrow(error);
    }
  });

  it('recipient list, chip balances and asset totals cannot silently waive purchase tax', async () => {
    resetPurchaseTaxCache();
    await expect(recipientsFor({ query: reject }, 'Buyer', Date.now())).rejects.toThrow('database read failed');
    resetPurchaseTaxCache();
    const noChips = { query: vi.fn().mockResolvedValueOnce({ rows: [{ player_key: 'ann', name: 'Ann' }] }).mockRejectedValueOnce(new Error('chip read failed')) };
    await expect(recipientsFor(noChips, 'Buyer', Date.now())).rejects.toThrow('chip read failed');
    resetPurchaseTaxCache();
    setEconomyForTest({ playerAssets: reject } as unknown as Economy);
    try {
      const noAssets = { query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ player_key: 'ann', name: 'Ann' }] })
        .mockResolvedValueOnce({ rows: [{ player_key: 'ann', chips: 10_000 }] }) };
      await expect(recipientsFor(noAssets, 'Buyer', Date.now())).rejects.toThrow('database read failed');
      const rich = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'house:1', price: 150_000 }] }) };
      await expect(quotePurchaseTax(rich, 'Buyer', 2_000, Date.now())).rejects.toThrow('database read failed');
    } finally { setEconomyForTest(null); resetPurchaseTaxCache(); }
  });
});

function pglitePool(db: PGlite) {
  let chain = Promise.resolve();
  const q = async (sql: string, args?: unknown[]) => { const r = args?.length ? await db.query(sql, args as unknown[]) : (await db.exec(sql)).at(-1) ?? { rows: [], affectedRows: 0 }; return { rows: r.rows as Record<string, unknown>[], rowCount: (r as { affectedRows?: number }).affectedRows ?? r.rows.length }; };
  return { query: q, on: () => {}, connect: async () => { let release!: () => void; const prev = chain; chain = new Promise<void>((r) => (release = r)); await prev; return { query: q, release }; } } as never;
}

describe('QA live safety: per-owner Postgres lock', () => {
  it('serializes two RealEstate instances at list price (Bill Chud 1) and preserves the stale max-price guard', async () => {
    const db = new PGlite(); const pool = pglitePool(db);
    const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
    const a = new RealEstate(pool, () => bank); const b = new RealEstate(pool, () => bank); await a.init();
    await db.exec('CREATE TABLE farm_tiles (plot_id TEXT, tile INT, owner_key TEXT, crop TEXT, planted_at BIGINT, nonce TEXT); CREATE TABLE farm_upgrades (plot_id TEXT, kind TEXT, owner_key TEXT, level INT); CREATE TABLE farm_fert (plot_id TEXT, tile INT, nonce TEXT, kind TEXT);');
    bank.transfer('Dayne', 10_000_000 - bank.account('Dayne').chips, { game: 'admin' }); await bank.flush();
    const ps = [...properties()].filter((p) => p.kind !== 'landmark' && p.kind !== 'farm').sort((x, y) => x.price - y.price).slice(0, 2);
    const [q1, q2] = await Promise.all([a.quote('Dayne', ps[0]!.id), b.quote('Dayne', ps[1]!.id)]);
    const r = await Promise.allSettled([a.buy('Dayne', ps[0]!.id, q1.price), b.buy('Dayne', ps[1]!.id, q2.price)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(2); // no surcharge: the second buy no longer reprices
    const bought = (await db.query<{ id: string; price: string }>('SELECT id, price FROM properties')).rows;
    expect(bought).toHaveLength(2); for (const x of bought) expect(Number(x.price)).toBe(ps.find((p) => p.id === x.id)!.price);
    expect(bank.account('Dayne').chips).toBe(10_000_000 - ps[0]!.price - ps[1]!.price - (r as PromiseFulfilledResult<{ wealthTax: number }>[]).reduce((s, x) => s + x.value.wealthTax, 0));
    const p3 = [...properties()].filter((p) => p.kind !== 'landmark' && p.kind !== 'farm' && !ps.includes(p)).sort((x, y) => x.price - y.price)[0]!;
    await expect(b.buy('Dayne', p3.id, p3.price - 1)).rejects.toThrow(/price changed/); // stale max guard kept
    await b.buy('Dayne', p3.id, p3.price); // also proves the earlier buys released the advisory lock
  });

  it('uses one connection from lock acquisition through commit and releases it on refusal', async () => {
    const queries: string[] = []; let released = false;
    const client = { query: vi.fn(async (sql: string) => { queries.push(sql); if (/pg_advisory_lock/.test(sql)) return { rows: [] }; throw new Error('read refused'); }), release: vi.fn(() => { released = true; }) };
    const pool = { connect: vi.fn(async () => client), query: vi.fn(async () => ({ rows: [] })) }; // pt2041u: tax preparation reads (pool.query) before the pinned connection
    const re = new RealEstate(pool as never, () => ({ refresh: vi.fn() }) as never);
    const p = [...properties()][0]!;
    await expect(re.buy('Dayne', p.id)).rejects.toThrow();
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(queries[0]).toMatch(/pg_advisory_lock/);
    expect(queries.at(-1)).toMatch(/pg_advisory_unlock/);
    expect(released).toBe(true);
    expect(queries.some((q) => /COMMIT/.test(q))).toBe(false);
  });
});

describe('QA live safety: player notes and cap rule', () => {
  it('records all 29 reversible disables and the 5,000 tax-recipient floor', () => {
    const entry = CHANGELOG.find((e) => e.title === 'Inactive accounts disabled and tax-sharing floor')!;
    const text = entry.bullets.join(' ');
    expect(text).toMatch(/Chessguy, carter and Jay’s 27 alternate accounts/);
    expect(text).toMatch(/disabled reversibly.*ledger history is retained/);
    expect(text).toMatch(/Purchase-tax and daily wealth-tax payouts.*5,000/);
  });
});
