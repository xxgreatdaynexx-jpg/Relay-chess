import { describe, expect, it, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { City, CITY_MIGRATION } from '../server/city';
import { BILL_REVIEW_MESSAGE, BILL_REVIEW_QUESTIONS, cleanBillAnswers } from '../shared/mayorQuestionnaire';

const EXACT = 'Mayor, the proposal needs these clarifications before it can move forward:\n\n- Existing owners keep all their properties, even if already above a cap. Limits block additional purchases, not force sales or confiscation.\n- Define the zoning for every property type, including barns, factories, plantations, resort plots and public landmarks.\n- Residential and commercial ownership are capped separately at five each. Farmland is capped at 1,500 total owned tiles, counting each plot\u2019s full dimensions. Purchases exceeding a cap are refused.\n- Address property surcharges already paid. My recommendation is to refund the surcharge actually paid on properties still owned\u2014not the base price or wealth tax\u2014and reduce the recorded purchase basis by the refund to prevent a double payout on resale.\n- Any refunds must come entirely from the city treasury. No new chips may be created. Specify how refunds will be handled if treasury funds are insufficient.\n\nPlease revise the bill to cover these points. No changes have been approved or implemented.';
const full = () => Object.fromEntries(BILL_REVIEW_QUESTIONS.map((q) => [q.id, q.options[q.options.length - 1]!.id]));

describe('pt2050u bill review: exact message and choices', () => {
  it('message is byte-identical to the owner text and rendered as plain text', () => {
    expect(BILL_REVIEW_MESSAGE).toBe(EXACT);
    expect(Buffer.from(BILL_REVIEW_MESSAGE).equals(Buffer.from(EXACT))).toBe(true);
    const ui = readFileSync('client/src/components/MayorBillReview.tsx', 'utf8'); expect(ui).toMatch(/\{review\.message\}/); expect(ui).not.toMatch(/dangerouslySetInnerHTML|defaultChecked/);
    expect(readFileSync('client/src/index.css', 'utf8')).toMatch(/\.bill-review-message \{ white-space: pre-wrap/);
  });
  it('every question has "Needs discussion"; no confiscation or chip-creation choices; zones cover the named types', () => {
    for (const q of BILL_REVIEW_QUESTIONS) expect(q.options.map((o) => o.id)).toContain('needs_discussion');
    const all = JSON.stringify(BILL_REVIEW_QUESTIONS).toLowerCase(); expect(all).not.toMatch(/confiscat|force|mint|new chips may|create chips/);
    for (const z of ['barns', 'factories', 'plantations', 'resort', 'landmarks']) expect(BILL_REVIEW_QUESTIONS.some((q) => q.id === `zone_${z}`)).toBe(true);
    expect(() => cleanBillAnswers({ grandfather: 'confiscate' })).toThrow(); expect(() => cleanBillAnswers({ bogus: 'confirm' })).toThrow(); expect(() => cleanBillAnswers([])).toThrow();
  });
  it('no changelog or launch-popup entry', () => {
    expect(readFileSync('shared/changelog.ts', 'utf8')).not.toMatch(/clarification questions|bill review/i);
    expect(readFileSync('shared/launchPopup.ts', 'utf8')).not.toMatch(/clarification questions|bill review/i);
  });
});

const url = process.env.MAYOR_LAWS_TEST_DATABASE_URL;
const drops: Array<() => Promise<void>> = []; afterAll(async () => { for (const d of drops) await d(); });
describe.skipIf(!url)('pt2050u bill review: server (real Postgres)', () => {
  async function world() {
    const root = new pg.Client({ connectionString: url }); await root.connect(); const db = `br_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`; await root.query(`CREATE DATABASE ${db}`);
    const u = new URL(url!); u.pathname = `/${db}`; const pool = new pg.Pool({ connectionString: u.toString(), max: 4 });
    drops.push(async () => { await pool.end(); await root.query(`DROP DATABASE ${db}`); await root.end(); });
    let mayor: { key: string; name: string } | null = { key: 'carter2', name: 'carter2' };
    const m = { settle: async () => {}, mayor: async () => mayor };
    const c = new City(pool, () => m as never); await pool.query(CITY_MIGRATION);
    const count = async () => Number((await pool.query('SELECT count(*) n FROM mayor_bill_review')).rows[0].n);
    const snapshot = async () => (await pool.query("SELECT (SELECT balance FROM city_treasury) t, (SELECT count(*) FROM city_treasury_ledger) l, (SELECT count(*) FROM city_levers) v, (SELECT count(*) FROM mayor_actions) a")).rows[0];
    return { c, pool, setMayor: (x: typeof mayor) => { mayor = x; }, count, snapshot };
  }
  it('only the sitting mayor sees, saves or submits; others get null/errors and write nothing', async () => {
    const w = await world();
    expect(await w.c.billReview(null)).toBeNull(); expect(await w.c.billReview('Bob')).toBeNull();
    await expect(w.c.billReviewSeen('Bob')).rejects.toThrow(/sitting mayor/); await expect(w.c.billReviewSave('Bob', { grandfather: 'confirm' }, false)).rejects.toThrow(/sitting mayor/);
    expect(await w.count()).toBe(0);
    const v = await w.c.billReview('Carter2'); expect(v!.message).toBe(EXACT); expect(v!.answers).toEqual({}); expect(v!.autoOpen).toBe(true); expect(v!.submittedAt).toBeNull();
    w.setMayor(null); expect(await w.c.billReview('carter2')).toBeNull();
  });
  it('auto-opens once; drafts persist across restarts; submit needs all; final + idempotent; advisory only', async () => {
    const w = await world(); const before = await w.snapshot();
    expect((await w.c.billReviewSeen('carter2')).review!.autoOpen).toBe(false); await w.c.billReviewSeen('carter2'); expect(await w.count()).toBe(1);
    await w.c.billReviewSave('carter2', { grandfather: 'confirm', zone_barns: 'farmland' }, false);
    const c2 = new City(w.pool, () => ({ settle: async () => {}, mayor: async () => ({ key: 'carter2', name: 'carter2' }) }) as never); // restart
    const v = await c2.billReview('carter2'); expect(v!.answers).toEqual({ grandfather: 'confirm', zone_barns: 'farmland' }); expect(v!.autoOpen).toBe(false);
    await expect(c2.billReviewSave('carter2', { grandfather: 'confirm' }, true)).rejects.toThrow(/every question/);
    await expect(c2.billReviewSave('carter2', { grandfather: 'nope' }, false)).rejects.toThrow(/not one of the choices/);
    const a = full(); const [x, y] = await Promise.allSettled([c2.billReviewSave('carter2', a, true), w.c.billReviewSave('carter2', a, true)]); // concurrent double submit
    expect(x.status).toBe('fulfilled'); expect(y.status).toBe('fulfilled');
    const done = (await c2.billReview('carter2'))!; expect(done.submittedAt).not.toBeNull(); expect(done.answers).toEqual(a);
    await expect(c2.billReviewSave('carter2', { ...a, grandfather: 'confirm' }, true)).rejects.toThrow(/already submitted/);
    await expect(c2.billReviewSave('carter2', { grandfather: 'confirm' }, false)).rejects.toThrow(/already submitted/);
    expect((await c2.billReview('carter2'))!.answers).toEqual(a); expect(await w.count()).toBe(1);
    expect(await w.snapshot()).toEqual(before); // no treasury / ledger / lever / public-action writes
  });
});
