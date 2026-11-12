import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadAuth } from '../lib/auth';
import { chatTimeFull, chatTimeLabel } from '../../../shared/chatTime';
import { DETAILS_MAX, PER_DAY, REQUEST_CATEGORIES, REQUEST_STATUSES, STATUS_LABEL, TITLE_MAX, statusBadge, similarTitles, validateRequest, type PublicRequest, type RequestStatus } from '../../../shared/requests';

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
  const [sort, setSort] = useState<'new' | 'old' | 'top' | 'status'>('new');
  const [status, setStatus] = useState<RequestStatus | ''>('');
  const [list, setList] = useState<PublicRequest[] | null>(null);
  const [all, setAll] = useState<PublicRequest[]>([]);
  const [form, setForm] = useState(false);
  const [title, setTitle] = useState(''); const [details, setDetails] = useState(''); const [category, setCategory] = useState<string>('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [office, setOffice] = useState<'mayor' | 'vice' | null>(null);
  useEffect(() => { void fetch('/api/city-hall').then((r) => r.json()).then((j: { view?: { me?: { isMayor?: boolean; isVice?: boolean }; mayor?: { name: string }; vice?: { name: string } } }) => {
    const v = j.view; if (!v || !me) return;
    if (v.me?.isMayor || (v.mayor?.name && v.mayor.name.toLowerCase() === me.toLowerCase())) setOffice('mayor');
    else if (v.me?.isVice || (v.vice?.name && v.vice.name.toLowerCase() === me.toLowerCase())) setOffice('vice');
  }).catch(() => {}); }, [me]);

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
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort requests" data-testid="requests-sort">
          <option value="new">Newest</option><option value="old">Oldest</option><option value="top">Most votes</option><option value="status">By status</option>
        </select>
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
          <small className="chat-dim">Up to {PER_DAY} a day.</small>
        </form>
      )}
      <ol className="chat-clog-list req-list">
        {list === null && <li className="chat-dim">Loading…</li>}
        {list?.length === 0 && <li className="chat-dim">No requests yet.</li>}
        {list?.map((r) => (
          <li key={r.id} data-testid="requests-item">
            <button type="button" className={`req-vote${r.voted ? ' on' : ''}`} disabled={!canPost || r.status === 'shipped' || r.status === 'declined'} onClick={() => vote(r.id)} aria-pressed={!!r.voted} aria-label={`Upvote, ${r.votes} votes`} data-testid="requests-vote">▲<b>{r.votes}</b></button>
            <div>
              <div className="chat-clog-meta"><span className={`req-st req-st-${r.status}`} data-testid="requests-status">{statusBadge(r)}</span><span>{r.category} · {r.author}</span><time className="chat-dim" dateTime={new Date(r.createdAt).toISOString()} title={chatTimeFull(r.createdAt)} data-testid="requests-date">{chatTimeLabel(r.createdAt)}</time></div>
              <b>{r.title}</b>
              {r.details && <p>{r.details}</p>}
              {r.note && <p className="req-note">Dev note: {r.note}</p>}
              {r.changelog && <p className="req-note">Shipped in 📜 {r.changelog}</p>}
              {r.endorsements && r.endorsements.length > 0 && <p className="req-note" data-testid="requests-endorsements">Endorsed by {r.endorsements.map((e) => `${e.role === 'mayor' ? 'mayor' : 'vice mayor'} ${e.name}`).join(' and ')}{r.endorsements.length === 2 ? ' — civic agreement' : ''}.</p>}
              {office && (r.status === 'open' || r.status === 'scheduled') && (
                <button type="button" className="req-new" data-testid="requests-endorse" onClick={() => {
                  const has = r.endorsements?.some((e) => e.role === office);
                  void fetch(`/api/requests/${r.id}/endorse${has ? '?withdraw=1' : ''}`, { method: 'POST', headers: authHeaders() }).then((x) => x.json()).then((j: { ok?: boolean; request?: PublicRequest; error?: string }) => { if (j.ok && j.request) setList((l) => l?.map((x) => (x.id === r.id ? { ...x, ...j.request } : x)) ?? l); });
                }}>{r.endorsements?.some((e) => e.role === office) ? 'Withdraw endorsement' : office === 'mayor' ? 'Endorse as mayor' : 'Endorse as vice mayor'}</button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
