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
    const html = renderToStaticMarkup(createElement(LawsPanel, { view: { history: [{ number:'1', title:'Bill Chud 1', text:'<img src=x onerror=alert(1)>', by:'<script>', status:'pending', at:0, day:'2026-11-06', vetoedBy:null, vetoedAt:null, vetoedRole:null }], nextBefore:null, submittedToday:false }, isMayor:true, busy:false, onPass: async () => {} }));
    expect(html).toContain('&lt;img'); expect(html).not.toContain('<img'); expect(html).not.toContain('<script>');
    expect(html.indexOf('mayor-law-info')).toBeGreaterThan(html.indexOf('mayor-law-text'));
    expect(LAW_RULES).toBe([
      'Only the sitting mayor can pass a bill—one per day, resetting at midnight UTC-6.',
      'The sitting vice mayor can draft a bill with the same form. A draft is marked Pending mayor approval: it is not the day’s bill, does not open a veto, and has no effect until the sitting mayor approves it (or rejects it, with an optional reason). At most three drafts can wait at once. Drafts expire at the end of the term. The record shows who drafted it and who approved or rejected it.',
      'Bills are publicly recorded and numbered forever, even when the mayor changes.',
      'Laws must be clear, possible to enforce, and limited to Chud Hub.',
      'No taking someone’s chips, property or items, banning players, or granting yourself rewards.',
      'The vice mayor (election runner-up) can veto a bill submitted today. The sitting mayor can veto bills from earlier days. Days reset at midnight UTC-6. Vetoed bills stay in the record marked ‘Vetoed.’ If the mayor is removed, the vice mayor becomes mayor.',
      'Laws can’t override core game rules.\n\nExamples: ‘Delete all’ or ‘Remove all.’ These are too broad—state exactly what the law would change.',
    ].join('\n\n'));
    expect(LAW_RULES.toLowerCase()).not.toMatch(/dayne/);
    const order = ['Only the sitting mayor', 'The sitting vice mayor', 'Bills are publicly', 'Laws must be clear', 'No taking someone', 'Laws can’t override', 'Examples: ‘Delete all’'].map((x) => html.indexOf(x.replace(/’/g, '’')));
    expect(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1]!))).toBe(true);
    expect(LAW_RULES).not.toContain('Dayne');
  });
});

describe('pending-only submission surface', () => {
  it('has no activation/approval operation or credentials', () => {
    const own = Object.getOwnPropertyNames(MayorLaws.prototype).sort();
    expect(own).toEqual(['approveDraft','constructor','deny','history','init','note','rejectDraft','submit','submitDraft','veto']);
    const source = readFileSync('server/mayor.ts', 'utf8');
    expect(source).not.toMatch(/(?:on|post)\(['"]mayor_law_approve['"]/);
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
      expect([...handlers.keys()].filter((k) => /law/.test(k)).sort()).toEqual(['mayor_law_draft_approve','mayor_law_draft_reject','mayor_law_history','mayor_law_submit','mayor_law_veto']);
    } finally { setMayorForTest(null); }
  });
});

describe('vetoes (status only; strict Regina day split)', () => {
  async function roles() {
    const s = await setup();
    await s.pool.query("UPDATE mayor_terms SET vice_key = 'vic', vice_name = 'Vic', vice_votes = 0, vice_settled = TRUE");
    return s;
  }
  it('vice: today only; mayor: earlier days only; others/removed denied; idempotent; text immutable', async () => {
    const s = await roles();
    const { bill } = await s.laws.submit('Alice', 'today bill');
    await expect(s.laws.veto('Bob', bill.number)).rejects.toThrow('Only the sitting mayor or vice mayor');
    await expect(s.laws.veto('Alice', bill.number)).rejects.toThrow('only be vetoed by the vice mayor');
    await expect(s.laws.veto('Vic', '1; DROP')).rejects.toThrow('Invalid bill number');
    await expect(s.laws.veto('Vic', '99')).rejects.toThrow('No such bill');
    s.set(Date.parse('2026-11-07T06:00:00Z')); // Regina midnight: yesterday's bill is now "earlier"
    await expect(s.laws.veto('Vic', '1')).rejects.toThrow('only be vetoed by the sitting mayor');
    const r = await s.laws.veto('ALICE', '1'); expect(r.already).toBe(false);
    expect(r.bill).toMatchObject({ status: 'vetoed', vetoedBy: 'Alice', vetoedRole: 'mayor', text: 'today bill', number: '1', by: 'Alice' });
    expect((await s.laws.veto('Alice', '1')).already).toBe(true);
    const nb = (await s.laws.submit('Alice', 'second')).bill;
    expect((await s.laws.veto('vic', nb.number)).bill).toMatchObject({ status: 'vetoed', vetoedRole: 'vice', vetoedBy: 'Vic' });
    expect((await s.laws.history()).history.map((b) => [b.number, b.status, b.text])).toEqual([['2','vetoed','second'],['1','vetoed','today bill']]);
    await s.pool.query('UPDATE mayor_terms SET removed_at = $1', [s.now()]);
    s.set(s.now() + 86400000); await s.laws.submit('Alice', 'x').catch(() => {});
    await expect(s.laws.veto('Alice', '2')).rejects.toThrow('Only the sitting mayor or vice mayor');
    await s.pool.end();
  });
  it('renders Vetoed status and only the right veto button', () => {
    const base = { title:'', text:'t', by:'Prev', at:0, vetoedBy:null, vetoedAt:null, vetoedRole:null } as const;
    const view = { nextBefore:null, submittedToday:true, history: [
      { ...base, number:'3', title:'Bill Chud 3', day:'2026-11-07', status:'pending' as const },
      { ...base, number:'2', title:'Bill Chud 2', day:'2026-11-06', status:'pending' as const },
      { ...base, number:'1', title:'Bill Chud 1', day:'2026-11-05', status:'vetoed' as const, vetoedBy:'Vic', vetoedRole:'vice' as const } ] };
    const r = (isMayor: boolean, isVice: boolean) => renderToStaticMarkup(createElement(LawsPanel, { view, isMayor, isVice, today:'2026-11-07', busy:false, onPass: async () => {}, onVeto: async () => {} }));
    const count = (h: string) => (h.match(/mayor-law-veto/g) ?? []).length;
    expect(count(r(true,false))).toBe(1); expect(count(r(false,true))).toBe(1); expect(count(r(false,false))).toBe(0);
    expect(r(false,false)).toContain('Vetoed by Vice Mayor Vic');
  });

  it('renders Denied status and the public denial reason, with no veto button', () => {
    const reason = '1. Only someone stockpiling at very large scale can actually use it.\n2. It wipes the cap out completely.';
    const view = { nextBefore:null, submittedToday:true, history: [
      { number:'2', title:'Bill Chud 2', text:'original text stays', by:'MayorName', at:0, day:'2026-11-09', status:'denied' as const, vetoedBy:null, vetoedAt:null, vetoedRole:null, denyReason: reason, deniedAt: 1 } ] };
    const html = renderToStaticMarkup(createElement(LawsPanel, { view, isMayor:true, isVice:true, today:'2026-11-09', busy:false, onPass: async () => {}, onVeto: async () => {} }));
    expect(html).toContain('Denied'); expect(html).toContain('mayor-law-deny-reason'); expect(html).toContain(reason.split('\n')[0]!);
    expect(html).toContain('original text stays'); expect(html).not.toMatch(/mayor-law-veto/);
    expect(html.toLowerCase()).not.toMatch(/dayne|conner/);
  });

  it('renders a public rule note under a vetoed bill without changing the veto line', () => {
    const note = '1. It benefits a single player. The cap applies to everyone, but only someone stockpiling at very large scale can actually use it, so the real winner is basically one player.\n2. It is a remove-all bill.\n3. The house cap is core gameplay, not a mayor lever.';
    const view = { nextBefore:null, submittedToday:true, history: [
      { number:'2', title:'Bill Chud 2', text:'Henceforth and heremore there shall be no house sell cap. Freedom to the workers!', by:'MayorName', at:0, day:'2026-11-09', status:'vetoed' as const, vetoedBy:'Vic', vetoedAt:1, vetoedRole:'vice' as const, ruleNote: note, ruleNotedAt: 2 } ] };
    const html = renderToStaticMarkup(createElement(LawsPanel, { view, isMayor:true, isVice:true, today:'2026-11-09', busy:false, onPass: async () => {}, onVeto: async () => {} }));
    expect(html).toContain('Vetoed');
    expect(html).toContain('Vetoed by Vice Mayor Vic');
    expect(html).toContain('Rules review: this bill would not be allowed because:');
    expect(html).toContain('mayor-law-rule-note');
    expect(html).toContain(note.split('\n')[0]!);
    expect(html).toContain('Henceforth and heremore there shall be no house sell cap. Freedom to the workers!');
    expect(html.indexOf('Vetoed by Vice Mayor Vic')).toBeLessThan(html.indexOf('Rules review: this bill would not be allowed because:'));
    expect(html).not.toMatch(/mayor-law-veto/);
    expect(html).not.toContain('Denied');
    expect(html.toLowerCase()).not.toMatch(/dayne|conner/);
    const noteBlock = html.slice(html.indexOf('mayor-law-rule-note'));
    expect(noteBlock.toLowerCase()).not.toMatch(/dayne|conner|requested by|\bper\b|\badmin\b/);
  });
});

