import { describe, expect, it, vi } from 'vitest';
import { newDb } from 'pg-mem';
import { MayorLaws } from '../server/mayorLaws';
import { MAYOR_MIGRATION, registerMayor, setMayorForTest, type Mayor } from '../server/mayor';
import type { Socket, Server } from 'socket.io';
import { readFileSync } from 'node:fs';
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
    await expect(s.laws.submit('Bob', 'hello')).rejects.toThrow('Only the sitting mayor');
    const { bill } = await s.laws.submit('ALICE', 'hello');
    expect(bill).toMatchObject({ number: '1', title: 'Bill Chud 1', by: 'Alice', day: '2026-11-06', text: 'hello', status: 'pending' });
    await s.pool.end();
  });
  it('city-wide daily limit survives replacement and restart; Regina midnight resets it', async () => {
    const s = await setup(); await s.laws.submit('Alice', 'first');
    await s.pool.query('UPDATE mayor_terms SET player_key = $1, name = $2', ['bob', 'Bob']);
    const next = new MayorLaws(s.pool, s.now); await next.init();
    await expect(next.submit('Bob', 'second')).rejects.toThrow('already submitted');
    s.set(Date.parse('2026-11-07T06:00:00Z'));
    const { bill } = await next.submit('Bob', 'second'); expect(bill.number).toBe('2'); expect(bill.day).toBe('2026-11-07');
    expect((await next.history()).history.map((b) => b.number)).toEqual(['2','1']);
    expect((await next.history('2')).history.map((b) => b.number)).toEqual(['1']); await s.pool.end();
  });
  it('rejects removed mayor and malformed history cursor', async () => {
    const s = await setup(); await s.pool.query('UPDATE mayor_terms SET removed_at = $1', [s.now()]);
    await expect(s.laws.submit('Alice', 'hello')).rejects.toThrow('Only the sitting mayor');
    await expect(s.laws.history('1; DROP TABLE mayor_bills')).rejects.toThrow('Invalid');
    expect((await s.laws.history()).history).toHaveLength(0); await s.pool.end();
  });
  it('renders user text safely and exact approved rules beneath input', () => {
    const html = renderToStaticMarkup(createElement(LawsPanel, { view: { history: [{ number:'1', title:'Bill Chud 1', text:'<img src=x onerror=alert(1)>', by:'<script>', status:'pending', at:0, day:'2026-11-06' }], nextBefore:null, submittedToday:false }, isMayor:true, busy:false, onPass: async () => {} }));
    expect(html).toContain('&lt;img'); expect(html).not.toContain('<img'); expect(html).not.toContain('<script>');
    expect(html.indexOf('mayor-law-info')).toBeGreaterThan(html.indexOf('mayor-law-text'));
    expect(LAW_RULES).toBe('Laws can’t override core game rules.\n\nExamples: ‘Delete all’ or ‘Remove all.’ These are too broad—state exactly what the law would change.');
    expect(LAW_RULES).not.toContain('approval');
    expect(LAW_RULES).not.toContain('Dayne');
  });
});

describe('pending-only submission surface', () => {
  it('has no activation/approval operation or credentials', () => {
    const own = Object.getOwnPropertyNames(MayorLaws.prototype).sort();
    expect(own).toEqual(['constructor','history','init','submit']);
    const source = readFileSync('server/mayor.ts', 'utf8');
    expect(source).not.toMatch(/(?:on|post)\(['"][^'"]*law[^'"]*(?:approv|activat)/i);
    expect(readFileSync('server/mayorLaws.ts','utf8')).not.toContain('adminAuthorized');
  });
  it('uses authenticated socket identity, never payload mayor/admin/approval claims', async () => {
    const handlers = new Map<string, (b: unknown, ack: (r: Record<string, unknown>) => void) => Promise<void>>();
    const data: { account?: { name: string } } = {};
    const submitLaw = vi.fn(async (_name: string, _text: unknown) => ({ bill: { status:'pending' } }));
    setMayorForTest({ submitLaw, view: async () => ({}) } as unknown as Mayor);
    const socket = { data, on: (ev: string, fn: never) => { handlers.set(ev, fn); } } as unknown as Socket;
    registerMayor({} as Server, socket);
    const ask = () => new Promise<Record<string, unknown>>((resolve) => { void handlers.get('mayor_law_submit')!({ name:'Dayne', mayor:'Alice', approved:true, admin:true, text:'hello' }, resolve); });
    try {
      expect((await ask()).error).toMatch(/Sign in/); expect(submitLaw).not.toHaveBeenCalled();
      data.account = { name:'Alice' }; const r = await ask(); expect(r.ok).toBe(true);
      expect(submitLaw).toHaveBeenCalledWith('Alice', 'hello');
      expect(r.bill).toEqual({status:'pending'});
      expect(handlers.has('mayor_law_approve')).toBe(false);
    } finally { setMayorForTest(null); }
  });
});
