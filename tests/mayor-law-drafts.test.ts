import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { MayorLaws } from '../server/mayorLaws';
import { MAYOR_MIGRATION } from '../server/mayor';
import { MAX_PENDING_LAW_DRAFTS } from '../shared/mayorLaws';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { MayorLaws as LawsPanel } from '../client/src/components/MayorLaws';

async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  await pool.query(MAYOR_MIGRATION);
  let now = Date.parse('2026-11-07T05:59:59Z');
  await pool.query(
    'INSERT INTO mayor_terms (week, player_key, name, votes, starts_at, ends_at, vice_key, vice_name, vice_votes, vice_settled) VALUES ($1,$2,$3,3,$4,$5,$6,$7,1,TRUE)',
    ['2026-11-02', 'carter2', 'carter2', now - 10000, now + 7 * 86400000, 'liam', 'Liam'],
  );
  const laws = new MayorLaws(pool, () => now); await laws.init();
  return { pool, laws, set: (n: number) => { now = n; }, now: () => now };
}

describe('vice mayor bill drafts', () => {
  it('authz: only the current vice mayor (from the persisted term) can draft; mayor and others cannot', async () => {
    const s = await setup();
    await expect(s.laws.submitDraft('carter2', 'A draft')).rejects.toThrow('Only the sitting vice mayor');
    await expect(s.laws.submitDraft('Bob', 'A draft')).rejects.toThrow('Only the sitting vice mayor');
    const { bill } = await s.laws.submitDraft('LIAM', 'Plant more trees');
    expect(bill).toMatchObject({ status: 'pending_approval', text: 'Plant more trees', draftedBy: 'Liam', by: 'Liam', title: 'Vice mayor draft' });
    expect(bill.number.startsWith('draft:')).toBe(true);
    const day = (await s.laws.history()).submittedToday;
    expect(day).toBe(false);
    expect(Number((await s.pool.query('SELECT value FROM mayor_bill_counter WHERE id=1')).rows[0].value)).toBe(0);
    expect(Number((await s.pool.query('SELECT count(*) AS n FROM mayor_bills')).rows[0].n)).toBe(0);
    await s.pool.end();
  });

  it('rate-limits to 3 pending drafts and does not occupy the day’s official bill', async () => {
    const s = await setup();
    for (let i = 1; i <= MAX_PENDING_LAW_DRAFTS; i++) await s.laws.submitDraft('Liam', `Draft ${i}`);
    await expect(s.laws.submitDraft('Liam', 'Draft 4')).rejects.toThrow('already have 3');
    const { bill } = await s.laws.submit('carter2', 'Official');
    expect(bill).toMatchObject({ number: '1', status: 'pending', by: 'carter2' });
    expect((await s.laws.history()).pendingDraftCount).toBe(3);
    expect((await s.laws.history()).submittedToday).toBe(true);
    await s.pool.end();
  });

  it('approve runs the normal mayor submit path and records drafter attribution; no effects before approval', async () => {
    const s = await setup();
    const { bill: draft } = await s.laws.submitDraft('Liam', 'Build a fountain');
    expect((await s.laws.history()).submittedToday).toBe(false);
    await expect(s.laws.approveDraft('Liam', draft.draftId)).rejects.toThrow('Only the sitting mayor');
    await expect(s.laws.approveDraft('Bob', draft.draftId)).rejects.toThrow('Only the sitting mayor');
    await expect(s.laws.veto('Liam', draft.number)).rejects.toThrow('Invalid bill number');
    const { bill } = await s.laws.approveDraft('CARTER2', draft.draftId);
    expect(bill).toMatchObject({ number: '1', title: 'Bill Chud 1', text: 'Build a fountain', by: 'carter2', status: 'pending', draftedBy: 'Liam', approvedBy: 'carter2' });
    expect((await s.laws.history()).submittedToday).toBe(true);
    expect((await s.laws.history()).pendingDraftCount).toBe(0);
    expect((await s.laws.history()).history[0]).toMatchObject({ number: '1', draftedBy: 'Liam', approvedBy: 'carter2', status: 'pending' });
    await expect(s.laws.approveDraft('carter2', draft.draftId)).rejects.toThrow('no longer waiting');
    await s.pool.end();
  });

  it('approve is blocked when the day’s official bill is already filed; the draft stays pending', async () => {
    const s = await setup();
    const { bill: draft } = await s.laws.submitDraft('Liam', 'Later');
    await s.laws.submit('carter2', 'Today first');
    await expect(s.laws.approveDraft('carter2', draft.draftId)).rejects.toThrow('already submitted');
    expect((await s.laws.history()).pendingDraftCount).toBe(1);
    expect((await s.pool.query("SELECT status FROM mayor_bill_drafts WHERE id = $1", [draft.draftId])).rows[0].status).toBe('pending_approval');
    await s.pool.end();
  });

  it('mayor can reject with an optional reason; others cannot; archived in history', async () => {
    const s = await setup();
    const a = (await s.laws.submitDraft('Liam', 'One')).bill;
    const b = (await s.laws.submitDraft('Liam', 'Two')).bill;
    await expect(s.laws.rejectDraft('Liam', a.draftId)).rejects.toThrow('Only the sitting mayor');
    await expect(s.laws.rejectDraft('Bob', a.draftId, 'nope')).rejects.toThrow('Only the sitting mayor');
    const r1 = await s.laws.rejectDraft('carter2', a.draftId);
    expect(r1.bill).toMatchObject({ status: 'rejected', rejectReason: null, draftedBy: 'Liam' });
    const r2 = await s.laws.rejectDraft('carter2', b.draftId, '  not workable  ');
    expect(r2.bill).toMatchObject({ status: 'rejected', rejectReason: 'not workable', draftedBy: 'Liam' });
    const hist = (await s.laws.history()).history;
    expect(hist.filter((x) => x.status === 'rejected').map((x) => [x.text, x.rejectReason])).toEqual([['Two', 'not workable'], ['One', null]]);
    expect((await s.laws.history()).pendingDraftCount).toBe(0);
    expect(Number((await s.pool.query('SELECT count(*) AS n FROM mayor_bills')).rows[0].n)).toBe(0);
    await s.pool.end();
  });

  it('a vice mayor who later becomes mayor still cannot approve or reject their own draft; leftovers expire at term end', async () => {
    const s = await setup();
    const { bill: draft } = await s.laws.submitDraft('Liam', 'My idea');
    await s.pool.query("UPDATE mayor_terms SET player_key = 'liam', name = 'Liam', vice_key = NULL, vice_name = NULL");
    await expect(s.laws.approveDraft('Liam', draft.draftId)).rejects.toThrow('own draft');
    await expect(s.laws.rejectDraft('Liam', draft.draftId, 'changed my mind')).rejects.toThrow('own draft');
    expect((await s.laws.history()).pendingDraftCount).toBe(1);
    s.set(s.now() + 7 * 86400000 + 1);
    const hist = await s.laws.history();
    expect(hist.pendingDraftCount).toBe(0);
    expect(hist.history.some((x) => x.status === 'expired' && x.text === 'My idea' && x.draftedBy === 'Liam')).toBe(true);
    await expect(s.laws.approveDraft('Liam', draft.draftId)).rejects.toThrow('no longer waiting');
    await s.pool.end();
  });

  it('renders pending / rejected / approved attribution and only shows Approve to the mayor', () => {
    const draft = { number: 'draft:1', title: 'Vice mayor draft', text: 't', by: 'Liam', at: 0, day: '2026-11-06', status: 'pending_approval' as const, draftedBy: 'Liam', draftId: '1', vetoedBy: null, vetoedAt: null, vetoedRole: null };
    const rejected = { ...draft, number: 'draft:2', draftId: '2', status: 'rejected' as const, approvedBy: 'carter2', rejectReason: 'too vague' };
    const official = { number: '1', title: 'Bill Chud 1', text: 'ok', by: 'carter2', at: 1, day: '2026-11-06', status: 'pending' as const, draftedBy: 'Liam', approvedBy: 'carter2', vetoedBy: null, vetoedAt: null, vetoedRole: null };
    const view = { nextBefore: null, submittedToday: false, history: [official, rejected], pendingDrafts: [draft], pendingDraftCount: 1 };
    const html = (isMayor: boolean, isVice: boolean) => renderToStaticMarkup(createElement(LawsPanel, { view, isMayor, isVice, today: '2026-11-06', busy: false, onPass: async () => {}, onApproveDraft: async () => {}, onRejectDraft: async () => {} }));
    const mayor = html(true, false);
    expect(mayor).toContain('Pending mayor approval');
    expect(mayor).toContain('Drafted by Vice Mayor Liam');
    expect(mayor).toContain('Drafted by vice mayor Liam, approved by mayor carter2');
    expect(mayor).toContain('Rejected');
    expect(mayor).toContain('Reason: too vague');
    expect((mayor.match(/mayor-law-draft-approve/g) ?? []).length).toBe(1);
    expect(html(false, true)).not.toContain('mayor-law-draft-approve');
    expect(html(false, false)).not.toContain('mayor-law-draft-approve');
    const viceForm = html(false, true);
    expect(viceForm).toContain('Submit for mayor approval');
    expect(viceForm).toMatch(/id="mayor-law-text"/);
    expect(viceForm).not.toMatch(/id="mayor-law-text"[^>]*disabled/);
  });
});
