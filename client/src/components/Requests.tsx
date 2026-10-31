import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadAuth } from '../lib/auth';
import { DETAILS_MAX, REQUEST_CATEGORIES, REQUEST_STATUSES, STATUS_LABEL, TITLE_MAX, similarTitles, validateRequest, type PublicRequest, type RequestStatus } from '../../../shared/requests';

const authHeaders = (): Record<string, string> => { const t = loadAuth()?.token; return t ? { 'X-Relay-Session': t } : {}; };
const isGuest = (n?: string) => !n || /^guest/i.test(n.trim());

/** 💡 Requests: players suggest changes, upvote (one per account, toggle), admins move status. */
export function RequestsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="chat-clog-btn chat-req-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="requests-btn" title="Change requests">💡<span> Requests</span></button>
      {open && <RequestsPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function RequestsPanel({ onClose }: { onClose: () => void }) {
  const me = loadAuth()?.name;
  const canPost = !!loadAuth()?.token && !isGuest(me);
  const [sort, setSort] = useState<'top' | 'new' | 'status'>('top');
  const [status, setStatus] = useState<RequestStatus | ''>('');
  const [list, setList] = useState<PublicRequest[] | null>(null);
  const [all, setAll] = useState<PublicRequest[]>([]);
  const [form, setForm] = useState(false);
  const [title, setTitle] = useState(''); const [details, setDetails] = useState(''); const [category, setCategory] = useState<string>('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ sort, ...(status ? { status } : {}) });
      const j = await (await fetch(`/api/requests?${q}`, { headers: authHeaders() })).json();
      setList(j.requests ?? []);
      if (!status) setAll(j.requests ?? []);
    } catch { setList([]); }
  }, [sort, status]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (status) void fetch('/api/requests', { headers: authHeaders() }).then((r) => r.json()).then((j) => setAll(j.requests ?? [])).catch(() => {}); }, [status]);

  const similar = useMemo(() => (title.trim().length >= 4 ? similarTitles(title, all) : []), [title, all]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateRequest({ title, details, category });
    if (!v.ok) return setErr(v.error);
    setBusy(true);
    try {
      const j = await (await fetch('/api/requests', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ title, details, category }) })).json();
      if (!j.ok) setErr(j.error || 'Could not post.'); else { setErr(''); setTitle(''); setDetails(''); setCategory(''); setForm(false); setSort('new'); void load(); }
    } catch { setErr('No response from the server.'); } finally { setBusy(false); }
  }
  async function vote(id: number) {
    const j = await (await fetch(`/api/requests/${id}/vote`, { method: 'POST', headers: authHeaders() })).json().catch(() => null);
    if (j?.ok) setList((l) => l?.map((r) => (r.id === id ? { ...r, votes: j.votes, voted: j.voted } : r)) ?? l);
  }

  return (
    <div className="chat-clog chat-req" data-testid="requests" role="dialog" aria-label="Change requests">
      <div className="chat-head"><b>💡 Change requests</b><button type="button" className="acct-close" aria-label="Close requests" onClick={onClose}>✕</button></div>
      <div className="req-bar">
        {(['top', 'new', 'status'] as const).map((s) => <button key={s} type="button" className={sort === s ? 'on' : ''} onClick={() => setSort(s)} data-testid={`requests-sort-${s}`}>{s === 'top' ? 'Top' : s === 'new' ? 'New' : 'Status'}</button>)}
        <select value={status} onChange={(e) => setStatus(e.target.value as RequestStatus | '')} aria-label="Filter by status" data-testid="requests-filter">
          <option value="">All statuses</option>
          {REQUEST_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        {canPost ? <button type="button" className="req-new" onClick={() => setForm((f) => !f)} data-testid="requests-new">{form ? 'Cancel' : '+ New'}</button> : <span className="chat-dim">Sign in to post</span>}
      </div>
      {form && (
        <form className="req-form" onSubmit={submit} data-testid="requests-form">
          <input value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} placeholder="Short title" data-testid="requests-title" />
          <small className="chat-dim">{title.length}/{TITLE_MAX}</small>
          {similar.length > 0 && <div className="req-similar" data-testid="requests-similar">Similar: {similar.map((s) => <span key={s.id}>“{s.title}” ({s.votes}▲)</span>)} — upvote instead?</div>}
          <textarea value={details} maxLength={DETAILS_MAX} rows={3} onChange={(e) => setDetails(e.target.value)} placeholder="Details (optional)" data-testid="requests-details" />
          <small className="chat-dim">{details.length}/{DETAILS_MAX}</small>
          <select value={category} onChange={(e) => setCategory(e.target.value)} data-testid="requests-category"><option value="">Category…</option>{REQUEST_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          {err && <div className="chat-err" data-testid="requests-error">{err}</div>}
          <button type="submit" disabled={busy} data-testid="requests-submit">Post request</button>
          <small className="chat-dim">Up to 3 a day.</small>
        </form>
      )}
      <ol className="chat-clog-list req-list">
        {list === null && <li className="chat-dim">Loading…</li>}
        {list?.length === 0 && <li className="chat-dim">No requests yet.</li>}
        {list?.map((r) => (
          <li key={r.id} data-testid="requests-item">
            <button type="button" className={`req-vote${r.voted ? ' on' : ''}`} disabled={!canPost || r.status === 'shipped' || r.status === 'declined'} onClick={() => vote(r.id)} aria-pressed={!!r.voted} aria-label={`Upvote, ${r.votes} votes`} data-testid="requests-vote">▲<b>{r.votes}</b></button>
            <div>
              <div className="chat-clog-meta"><span className={`req-st req-st-${r.status}`}>{STATUS_LABEL[r.status]}</span><span>{r.category} · {r.author}</span></div>
              <b>{r.title}</b>
              {r.details && <p>{r.details}</p>}
              {r.note && <p className="req-note">Dev note: {r.note}</p>}
              {r.changelog && <p className="req-note">Shipped in 📜 {r.changelog}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
