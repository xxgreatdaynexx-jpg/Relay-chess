import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { newDb } from 'pg-mem';
import { MayorLaws } from '../server/mayorLaws';
import { MAYOR_MIGRATION } from '../server/mayor';
import { lawDenyReason, LAW_DENY_REASON_MAX } from '../shared/mayorLaws';
import { HOUSE_DAILY_BASE } from '../shared/mines';

async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  await pool.query(MAYOR_MIGRATION);
  let now = Date.parse('2026-11-07T05:59:59Z');
  await pool.query('INSERT INTO mayor_terms (week, player_key, name, votes, starts_at, ends_at) VALUES ($1,$2,$3,1,$4,$5)', ['2026-11-02', 'alice', 'Alice', now - 10000, now + 86400000]);
  const laws = new MayorLaws(pool, () => now); await laws.init();
  return { pool, laws, set: (n: number) => { now = n; }, now: () => now };
}

const REASON = '1. Only someone stockpiling at very large scale can actually use it.\n2. It is a remove-all bill.\n3. The cap is core gameplay, not a mayor lever.';

describe('lawDenyReason', () => {
  it('requires trimmed public text within the cap', () => {
    expect(lawDenyReason(`  ${REASON}  `)).toBe(REASON);
    for (const x of [null, undefined, '', '  ', 1, {}]) expect(() => lawDenyReason(x)).toThrow(/public denial reason/i);
    expect(() => lawDenyReason('x'.repeat(LAW_DENY_REASON_MAX + 1))).toThrow(/at most/);
  });
});

describe('admin Denied status for official bills', () => {
  it('marks a pending bill Denied, keeps the original text, and is idempotent', async () => {
    const s = await setup();
    const { bill } = await s.laws.submit('Alice', 'Henceforth there shall be no house sell cap.');
    expect(bill.status).toBe('pending');
    const r = await s.laws.deny(bill.number, REASON);
    expect(r.already).toBe(false);
    expect(r.bill).toMatchObject({ number: '1', title: 'Bill Chud 1', status: 'denied', text: 'Henceforth there shall be no house sell cap.', denyReason: REASON, by: 'Alice', day: '2026-11-06' });
    expect(r.bill.deniedAt).toBe(s.now());
    const again = await s.laws.deny('1', 'a different reason would not apply');
    expect(again.already).toBe(true);
    expect(again.bill.denyReason).toBe(REASON);
    expect(again.bill.text).toBe('Henceforth there shall be no house sell cap.');
    const hist = await s.laws.history();
    expect(hist.submittedToday).toBe(true);
    expect(hist.history[0]).toMatchObject({ number: '1', status: 'denied', denyReason: REASON, text: 'Henceforth there shall be no house sell cap.' });
    await expect(s.laws.submit('Alice', 'another')).rejects.toThrow('already submitted');
    await s.pool.end();
  });

  it('refuses missing, vetoed, or invalid bills, and veto refuses a denied bill', async () => {
    const s = await setup();
    await s.pool.query("UPDATE mayor_terms SET vice_key = 'vic', vice_name = 'Vic', vice_votes = 0, vice_settled = TRUE");
    await s.laws.submit('Alice', 'today bill');
    await expect(s.laws.deny('99', REASON)).rejects.toThrow('No such bill');
    await expect(s.laws.deny('1; DROP', REASON)).rejects.toThrow('Invalid bill number');
    const v = await s.laws.veto('Vic', '1');
    expect(v.bill.status).toBe('vetoed');
    await expect(s.laws.deny('1', REASON)).rejects.toThrow('already been vetoed');
    s.set(Date.parse('2026-11-07T06:00:00Z'));
    const b2 = (await s.laws.submit('Alice', 'second')).bill;
    await s.laws.deny(b2.number, REASON);
    await expect(s.laws.veto('Vic', b2.number)).rejects.toThrow('already been denied');
    await s.pool.end();
  });

  it('does not change house-sell cap constants and has no economy side effects in the deny path', () => {
    expect(HOUSE_DAILY_BASE).toBe(100_000);
    const src = readFileSync('server/mayorLaws.ts', 'utf8');
    const start = src.indexOf('async deny(');
    const end = src.indexOf('async rejectDraft(') > start ? src.length : src.length;
    const fn = src.slice(start, src.indexOf('\n  }\n', start) + 6);
    expect(fn).toMatch(/status = 'denied'/);
    expect(fn).not.toMatch(/houseCap|HOUSE_DAILY|transfer\(|getBank|sellCap|payoutFor/);
    expect(src).not.toContain('adminAuthorized');
  });

  it('the deny route is admin-token only and is not a player socket event', () => {
    const mayor = readFileSync('server/mayor.ts', 'utf8');
    expect(mayor).toMatch(/\/api\/admin\/mayor\/deny-bill[\s\S]{0,400}adminAuthorized\(req\.get\('authorization'\)\)/);
    expect(mayor).not.toMatch(/on\(['"]mayor_law_deny['"]/);
    expect(HOUSE_DAILY_BASE).toBe(100_000);
  });
});
