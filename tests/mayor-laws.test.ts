import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { MayorLaws } from '../server/mayorLaws';
import { MAYOR_MIGRATION } from '../server/mayor';
import { lawText, lawTitle, LAW_RULES } from '../shared/mayorLaws';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { MayorLaws as LawsPanel } from '../client/src/components/MayorLaws';
async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  await pool.query(MAYOR_MIGRATION);
  let now = Date.parse('2026-11-07T05:59:59Z');
  await pool.query('INSERT INTO mayor_terms (week, player_key, name, votes, starts_at, ends_at) VALUES ($1,$2,$3,1,$4,$5)', ['2026-11-02', 'alice', 'Alice', now - 10000, now + 86400000]);
  const laws = new MayorLaws(pool, () => now); await laws.init();
  return { pool, laws, set: (n: number) => { now = n; }, now: () => now };
}
describe('text-only mayor bills', () => {
  it('validates technical limits without interpreting powers', () => {
    expect(lawText('  No tax today  ')).toBe('No tax today');
    expect(lawText('<script>alert(1)</script>')).toContain('<script>');
    for (const x of [null, {}, '', '  ', 'x'.repeat(2001)]) expect(() => lawText(x)).toThrow();
    expect(lawTitle('999999999999999')).toBe('Bill Chud 999999999999999');
  });
  it('requires current mayor and records canonical identity', async () => {
    const s = await setup();
    await expect(s.laws.pass('Bob', 'hello')).rejects.toThrow('Only the sitting mayor');
    const { bill } = await s.laws.pass('ALICE', 'hello');
    expect(bill).toMatchObject({ number: '1', title: 'Bill Chud 1', by: 'Alice', day: '2026-11-06', text: 'hello', status: 'pending', approvedAt: null });
    await s.pool.end();
  });
  it('city-wide daily limit survives replacement and restart; Regina midnight resets it', async () => {
    const s = await setup(); await s.laws.pass('Alice', 'first');
    await s.pool.query('UPDATE mayor_terms SET player_key = $1, name = $2', ['bob', 'Bob']);
    const next = new MayorLaws(s.pool, s.now); await next.init();
    await expect(next.pass('Bob', 'second')).rejects.toThrow('already passed');
    s.set(Date.parse('2026-11-07T06:00:00Z'));
    const { bill } = await next.pass('Bob', 'second'); expect(bill.number).toBe('2'); expect(bill.day).toBe('2026-11-07');
    expect((await next.history()).history.map((b) => b.number)).toEqual(['2','1']);
    expect((await next.history('2')).history.map((b) => b.number)).toEqual(['1']); await s.pool.end();
  });
  it('rejects removed mayor and malformed history cursor', async () => {
    const s = await setup(); await s.pool.query('UPDATE mayor_terms SET removed_at = $1', [s.now()]);
    await expect(s.laws.pass('Alice', 'hello')).rejects.toThrow('Only the sitting mayor');
    await expect(s.laws.history('1; DROP TABLE mayor_bills')).rejects.toThrow('Invalid');
    expect((await s.laws.history()).history).toHaveLength(0); await s.pool.end();
  });
  it('renders user text safely and exact approved rules beneath input', () => {
    const html = renderToStaticMarkup(createElement(LawsPanel, { view: { history: [{ number:'1', title:'Bill Chud 1', text:'<img src=x onerror=alert(1)>', by:'<script>', status:'pending', approvedAt:null, at:0, day:'2026-11-06' }], nextBefore:null, passedToday:false }, isMayor:true, busy:false, onPass: async () => {} }));
    expect(html).toContain('&lt;img'); expect(html).not.toContain('<img'); expect(html).not.toContain('<script>');
    expect(html.indexOf('mayor-law-info')).toBeGreaterThan(html.indexOf('mayor-law-text'));
    expect(LAW_RULES).toBe('Laws can’t override core game rules.\n\nExamples: ‘Delete all’ or ‘Remove all.’ These are too broad—state exactly what the law would change.');
    expect(LAW_RULES).not.toContain('approval');
    expect(LAW_RULES).not.toContain('Dayne');
  });
});
