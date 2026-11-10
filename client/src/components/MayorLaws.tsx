import { useState } from 'react';
import { draftApprovedNote, LAW_CORE_RULES, LAW_REJECT_REASON_MAX, LAW_RULE_LINES, LAW_TEXT_MAX, MAX_PENDING_LAW_DRAFTS, type MayorLaw, type MayorLawView } from '../../../shared/mayorLaws';
import { request } from '@/lib/net';

function statusLabel(b: MayorLaw): string {
  if (b.implementation) return 'Enacted — revised wording';
  if (b.status === 'vetoed') return 'Vetoed';
  if (b.status === 'denied') return 'Denied';
  if (b.status === 'pending_approval') return 'Pending mayor approval';
  if (b.status === 'rejected') return 'Rejected';
  if (b.status === 'expired') return 'Expired';
  return 'Pending';
}

function byline(b: MayorLaw): string {
  if (b.draftedBy && b.approvedBy && (b.status === 'pending' || b.status === 'vetoed' || !!b.implementation)) return draftApprovedNote(b.draftedBy, b.approvedBy);
  if (b.status === 'pending_approval') return `Drafted by Vice Mayor ${b.draftedBy ?? b.by}`;
  if (b.status === 'rejected') return `Drafted by Vice Mayor ${b.draftedBy ?? b.by}${b.approvedBy ? `, rejected by Mayor ${b.approvedBy}` : ''}`;
  if (b.status === 'expired') return `Drafted by Vice Mayor ${b.draftedBy ?? b.by}`;
  return `${b.implementation ? 'Submitted by Mayor' : 'Mayor'} ${b.by}`;
}

export function MayorLaws({ view, isMayor, isVice = false, today, busy, onPass, onVeto, onApproveDraft, onRejectDraft }: {
  view: MayorLawView; isMayor: boolean; isVice?: boolean; today?: string; busy: boolean;
  onPass: (text: string) => Promise<void>; onVeto?: (number: string) => Promise<void>;
  onApproveDraft?: (id: string) => Promise<void>;
  onRejectDraft?: (id: string, reason: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [older, setOlder] = useState<MayorLawView | null>(null);
  const [error, setError] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const shown = older ?? view;
  const pendingDrafts = view.pendingDrafts ?? [];
  const pendingDraftCount = view.pendingDraftCount ?? pendingDrafts.length;
  const canOfficial = isMayor && !view.submittedToday;
  const canDraft = isVice && !isMayor && pendingDraftCount < MAX_PENDING_LAW_DRAFTS;
  const canType = canOfficial || canDraft;
  const history = shown.history.filter((b) => b.status !== 'pending_approval');
  return <section data-testid="mayor-laws">
    <h4>City bills</h4>
    <label htmlFor="mayor-law-text">New bill text</label>
    <textarea id="mayor-law-text" data-testid="mayor-law-text" rows={5} maxLength={LAW_TEXT_MAX} value={text} disabled={!canType || busy} onChange={(e) => setText(e.target.value)} style={{ width: '100%', whiteSpace: 'pre-wrap' }} />
    <div className="cityhall-rules" role="note" data-testid="mayor-law-info" style={{ maxWidth: '100%', overflowWrap: 'anywhere', lineHeight: 1.45 }}>
      <ol style={{ margin: '0 0 .6em', paddingLeft: '1.4em', listStyle: 'decimal' }}>{LAW_RULE_LINES.map((r) => <li key={r} style={{ marginBottom: '.35em' }}>{r}</li>)}</ol>
      <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{LAW_CORE_RULES}</p>
    </div>
    <button type="button" disabled={!canType || busy || !text.trim()} onClick={() => { void onPass(text); }} data-testid="mayor-law-submit">{isVice && !isMayor ? 'Submit for mayor approval' : 'Submit bill'}</button>
    {view.submittedToday && isMayor && <small>The city has already submitted a bill today (America/Regina).</small>}
    {isVice && !isMayor && pendingDraftCount >= MAX_PENDING_LAW_DRAFTS && <small>You already have {MAX_PENDING_LAW_DRAFTS} bills waiting for the mayor’s approval.</small>}
    {pendingDrafts.length > 0 && <div className="mayor-law-drafts" data-testid="mayor-law-pending-drafts">
      <h4>Pending mayor approval</h4>
      <ol>{pendingDrafts.map((b) => <li key={b.draftId ?? b.number}>
        <b>{b.title}</b> <span data-testid="mayor-law-status">{statusLabel(b)}</span>
        <small> · {byline(b)} · {b.day} (America/Regina)</small>
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{b.text}</p>
        {isMayor && onApproveDraft && onRejectDraft && b.draftId && ((id) => <div className="mayor-law-draft-actions">
          <button type="button" disabled={busy} data-testid="mayor-law-draft-approve" onClick={() => { void onApproveDraft(id); }}>Approve</button>
          <input type="text" maxLength={LAW_REJECT_REASON_MAX} placeholder="Optional reason" aria-label="Optional rejection reason" value={reasons[id] ?? ''} onChange={(e) => setReasons((c) => ({ ...c, [id]: e.target.value }))} data-testid="mayor-law-draft-reason" />
          <button type="button" disabled={busy} data-testid="mayor-law-draft-reject" onClick={() => { void onRejectDraft(id, reasons[id] ?? ''); }}>Reject</button>
        </div>)(b.draftId)}
      </li>)}</ol>
    </div>}
    <h4>Bill history</h4>
    {!history.length && !pendingDrafts.length && <small>No bills passed yet.</small>}
    <ol data-testid="mayor-law-history">{history.map((b) => <li key={b.number}>
      <b>{b.title}</b> <span data-testid="mayor-law-status">{statusLabel(b)}</span><small> · {byline(b)} · {b.day} (America/Regina)</small>
      {b.status === 'vetoed' && b.vetoedBy && <small> · Vetoed by {b.vetoedRole === 'vice' ? 'Vice Mayor' : 'Mayor'} {b.vetoedBy}</small>}
      {b.status === 'rejected' && b.rejectReason && <small> · Reason: {b.rejectReason}</small>}
      {b.status === 'denied' && b.denyReason && <p data-testid="mayor-law-deny-reason" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{b.denyReason}</p>}
      <p data-testid={b.implementation ? 'mayor-law-active-wording' : undefined} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{b.implementation?.text ?? b.text}</p>
      {b.implementation && <>
        <small data-testid="mayor-law-implementation">Implemented {new Date(b.implementation.implementedAt).toLocaleString('en-CA', { timeZone: 'America/Regina' })} (America/Regina) · release <code>{b.implementation.release.slice(0, 7)}</code>. This implementation record is separate from the original submission, not an approval vote.</small>
        <details data-testid="mayor-law-original"><summary>Original submission (archived)</summary><small>Original recorded status: {b.status === 'vetoed' ? 'Vetoed' : b.status === 'denied' ? 'Denied' : 'Pending'}{b.draftedBy && b.approvedBy ? ` · ${draftApprovedNote(b.draftedBy, b.approvedBy)}` : ''}.</small><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{b.text}</p></details>
      </>}
      {onVeto && today && !b.implementation && b.status === 'pending' && (b.day === today ? isVice : isMayor) && <button type="button" disabled={busy} data-testid="mayor-law-veto" onClick={() => { if (window.confirm(`Veto ${b.title}? It stays in the record marked Vetoed and cannot be undone.`)) void onVeto(b.number).then(() => setOlder(null)); }}>Veto</button>}
    </li>)}</ol>
    {older && <button type="button" onClick={() => setOlder(null)}>Latest bills</button>}
    {shown.nextBefore && <button type="button" disabled={busy} onClick={() => {
      void request('mayor_law_history', { before: shown.nextBefore }).then((a) => {
        const r = a as { ok: boolean; laws?: MayorLawView; error?: string };
        if (r.ok && r.laws) setOlder(r.laws); else setError(r.error ?? 'Could not load bills.');
      });
    }}>Older bills</button>}
    {error && <small role="status">{error}</small>}
  </section>;
}
