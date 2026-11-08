import { useEffect, useState } from 'react';
import { request } from '@/lib/net';
import { usePanelDrag } from '@/lib/panelDrag';
import type { BillAnswers, BillReviewView } from '../../../shared/mayorQuestionnaire';

export const OPEN_BILL_REVIEW = 'open-bill-review';
type R = { ok: boolean; error?: string; review?: BillReviewView | null };

/** pt2050u: the sitting mayor's questionnaire on the zoning/cap bill. The server decides who sees it; answers are advisory only. */
export function MayorBillReview({ review, onClose, onChange }: { review: BillReviewView; onClose: () => void; onChange: (r: BillReviewView | null) => void }) {
  const drag = usePanelDrag('billreview');
  const [draft, setDraft] = useState<BillAnswers>(review.answers); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const done = review.submittedAt != null; const all = review.questions.every((q) => draft[q.id]);
  const save = async (submit: boolean) => {
    if (busy) return; setBusy(true); setMsg(null);
    const r = await request('city_bill_review_save', { answers: draft, submit }) as R; setBusy(false);
    if (r.review !== undefined) onChange(r.review ?? null);
    setMsg(r.ok ? (submit ? 'Answers submitted. Thank you.' : 'Draft saved.') : r.error ?? 'Something went wrong.');
  };
  return (
    <div className="bill-review-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bill-review" role="dialog" aria-modal="true" aria-label="Bill clarifications" data-testid="bill-review" data-drag-panel="billreview" onPointerDown={drag.onPointerDown} style={drag.style()} ref={drag.ref}>{drag.handle}
        <button type="button" className="world-deed-x" onClick={onClose} aria-label="Close">✕</button>
        <h3>🏛️ Bill clarifications</h3>
        <div className="bill-review-message" data-testid="bill-review-message">{review.message}</div>
        <h4>Your answers {done ? '(submitted)' : ''}</h4>
        <small>Multiple choice. Answers are advisory only and change nothing in the game.</small>
        <ol className="bill-review-qs">
          {review.questions.map((q) => (
            <li key={q.id}><fieldset disabled={done || busy}><legend>{q.text}</legend>
              {q.options.map((o) => (
                <label key={o.id}><input type="radio" name={`bq-${q.id}`} value={o.id} checked={draft[q.id] === o.id} onChange={() => setDraft((d) => ({ ...d, [q.id]: o.id }))} /> {o.label}</label>))}
            </fieldset></li>))}
        </ol>
        {!done && <div className="bill-review-actions">
          <button type="button" disabled={busy} onClick={() => void save(false)}>Save draft</button>
          <button type="button" disabled={busy || !all} onClick={() => void save(true)} data-testid="bill-review-submit">Submit answers</button>
        </div>}
        {msg && <small role="status">{msg}</small>}
      </div>
    </div>
  );
}

/** Loads the review for the signed-in player (null unless sitting mayor); auto-opens once while unanswered, reopens on OPEN_BILL_REVIEW. */
export function MayorBillReviewHost() {
  const [review, setReview] = useState<BillReviewView | null>(null); const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void request('city_bill_review').then((a) => { const r = a as R; if (!live || !r.review) return; setReview(r.review);
      if (r.review.autoOpen) { setOpen(true); void request('city_bill_review_seen'); } });
    const h = () => { void request('city_bill_review').then((a) => { const r = a as R; if (r.review) { setReview(r.review); setOpen(true); } }); };
    window.addEventListener(OPEN_BILL_REVIEW, h); return () => { live = false; window.removeEventListener(OPEN_BILL_REVIEW, h); };
  }, []);
  return open && review ? <MayorBillReview review={review} onClose={() => setOpen(false)} onChange={(r) => { if (r) setReview(r); else setOpen(false); }} /> : null;
}
