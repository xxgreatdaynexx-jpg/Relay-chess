import { useState } from 'react';
import { LAW_CORE_RULES, LAW_RULE_LINES, LAW_TEXT_MAX, type MayorLawView } from '../../../shared/mayorLaws';
import { request } from '@/lib/net';

export function MayorLaws({ view, isMayor, busy, onPass }: { view: MayorLawView; isMayor: boolean; busy: boolean; onPass: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [older, setOlder] = useState<MayorLawView | null>(null);
  const [error, setError] = useState('');
  const shown = older ?? view;
  return <section data-testid="mayor-laws">
    <h4>City bills</h4>
    <label htmlFor="mayor-law-text">New bill text</label>
    <textarea id="mayor-law-text" data-testid="mayor-law-text" rows={5} maxLength={LAW_TEXT_MAX} value={text} disabled={!isMayor || view.submittedToday || busy} onChange={(e) => setText(e.target.value)} style={{ width: '100%', whiteSpace: 'pre-wrap' }} />
    <div className="cityhall-rules" role="note" data-testid="mayor-law-info" style={{ maxWidth: '100%', overflowWrap: 'anywhere', lineHeight: 1.45 }}>
      <ol style={{ margin: '0 0 .6em', paddingLeft: '1.4em', listStyle: 'decimal' }}>{LAW_RULE_LINES.map((r) => <li key={r} style={{ marginBottom: '.35em' }}>{r}</li>)}</ol>
      <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{LAW_CORE_RULES}</p>
    </div>
    <button type="button" disabled={!isMayor || view.submittedToday || busy || !text.trim()} onClick={() => { void onPass(text); }}>Submit bill</button>
    {view.submittedToday && <small>The city has already submitted a bill today (America/Regina).</small>}
    <h4>Bill history</h4>
    {!shown.history.length && <small>No bills passed yet.</small>}
    <ol data-testid="mayor-law-history">{shown.history.map((b) => <li key={b.number}>
      <b>{b.title}</b> <span>Pending</span><small> · Mayor {b.by} · {b.day} (America/Regina)</small>
      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{b.text}</p>
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
