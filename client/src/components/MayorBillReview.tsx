import { useEffect, useRef, useState } from 'react';
import { request, socket } from '@/lib/net';
import { useAccount } from '@/lib/auth';
import type { BillAnswers, BillReviewView } from '../../../shared/mayorQuestionnaire';

export const OPEN_BILL_REVIEW = 'open-bill-review';
type R = { ok: boolean; error?: string; account?: string | null; review?: BillReviewView | null };
const same = (a: string | null | undefined, b: string) => !!a && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Bill clarifications: the bound mayor's questionnaire on the zoning/cap bill. Fixed modal (no drag): header + close, scrolling body, footer. */
export function MayorBillReview({ review, onClose, onChange }: { review: BillReviewView; onClose: () => void; onChange: (r: BillReviewView) => void }) {
  const [draft, setDraft] = useState<BillAnswers>(review.answers); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const done = review.submittedAt != null; const all = review.questions.every((q) => draft[q.id]);
  const save = async (submit: boolean) => {
    if (busy) return; setBusy(true); setMsg(null);
    const r = await request('city_bill_review_save', { answers: draft, submit }) as R; setBusy(false);
    if (r.review) onChange(r.review);
    setMsg(r.ok ? (submit ? 'Answers submitted. Thank you.' : 'Draft saved.') : r.error ?? 'Something went wrong.');
  };
  return (
    <div className="bill-review-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bill-review" role="dialog" aria-modal="true" aria-labelledby="bill-review-title" data-testid="bill-review">
        <header className="bill-review-head"><h3 id="bill-review-title">🏛️ Bill clarifications</h3>
          <button type="button" ref={closeRef} className="bill-review-x" onClick={onClose} aria-label="Close" data-testid="bill-review-close">✕</button></header>
        <div className="bill-review-body" data-testid="bill-review-body">
          <div className="bill-review-message" data-testid="bill-review-message">{review.message}</div>
          <h4>Your answers {done ? '(submitted)' : ''}</h4>
          <small>Multiple choice. Answers are advisory only and change nothing in the game.</small>
          <ol className="bill-review-qs">
            {review.questions.map((q) => (
              <li key={q.id}><fieldset disabled={done || busy}><legend>{q.text}</legend>
                {q.options.map((o) => (
                  <label key={o.id}><input type="radio" name={`bq-${q.id}`} value={o.id} checked={draft[q.id] === o.id} onChange={() => setDraft((d) => ({ ...d, [q.id]: o.id }))} /> <span>{o.label}</span></label>))}
              </fieldset></li>))}
          </ol>
        </div>
        <footer className="bill-review-foot">
          {msg && <small role="status">{msg}</small>}
          {!done ? <div className="bill-review-actions">
            <button type="button" disabled={busy} onClick={() => void save(false)} data-testid="bill-review-draft">Save draft</button>
            <button type="button" disabled={busy || !all} onClick={() => void save(true)} data-testid="bill-review-submit">Submit answers</button>
          </div> : <div className="bill-review-actions"><button type="button" onClick={onClose}>Close</button></div>}
        </footer>
      </div>
    </div>
  );
}

/**
 * Loads the review once the SERVER has authenticated this socket as the locally signed-in account (retries while auth_resume
 * is still in flight; re-checks on every reconnect). Clears immediately on logout/account change and drops late answers for
 * a previous account. Auto-opens once while unanswered (server-tracked); City Hall reopens it with OPEN_BILL_REVIEW.
 */
export function MayorBillReviewHost() {
  const account = useAccount();
  const [review, setReview] = useState<BillReviewView | null>(null); const [open, setOpen] = useState(false);
  const gen = useRef(0);
  useEffect(() => {
    const g = ++gen.current; setReview(null); setOpen(false); if (!account) return;
    let timer: number | undefined; let tries = 0;
    const load = (show: boolean) => void request('city_bill_review').then((a) => {
      const r = a as R; if (gen.current !== g) return;
      if (!r.ok || !same(r.account, account)) { if (tries++ < 8) timer = window.setTimeout(() => load(show), Math.min(15_000, 500 * 2 ** tries)); return; } // auth not ready yet
      tries = 0; setReview(r.review ?? null); if (!r.review) { setOpen(false); return; }
      if (show) setOpen(true);
      else if (r.review.autoOpen) { setOpen(true); void request('city_bill_review_seen'); }
    });
    const onConnect = () => { tries = 0; load(false); }; const onOpen = () => load(true);
    load(false); socket.on('connect', onConnect); window.addEventListener(OPEN_BILL_REVIEW, onOpen);
    return () => { gen.current++; window.clearTimeout(timer); socket.off('connect', onConnect); window.removeEventListener(OPEN_BILL_REVIEW, onOpen); };
  }, [account]);
  return open && review ? <MayorBillReview key={review.id + account} review={review} onClose={() => setOpen(false)} onChange={setReview} /> : null;
}
