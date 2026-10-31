import { useEffect, useState } from 'react';
import { CHANGELOG } from '../../../shared/changelog';

const SEEN_KEY = 'chud-changelog-seen';
export const fmtMdt = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Edmonton', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' MDT';

let buildCache: Promise<{ commit: string; builtAt: string } | null> | null = null;
export function useBuild() {
  const [b, setB] = useState<{ commit: string; builtAt: string } | null>(null);
  useEffect(() => {
    buildCache ??= fetch('/api/build').then((r) => r.json()).then((j) => (j?.ok ? { commit: String(j.commit), builtAt: String(j.builtAt) } : null)).catch(() => null);
    void buildCache.then(setB);
  }, []);
  return b;
}

const seen = () => { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } };
export const unseenCount = (since = seen()) => CHANGELOG.filter((e) => Date.parse(e.at) > since).length;

/** 📜 button with an unread badge, opening the changelog list. */
export function ChangelogButton() {
  const [open, setOpen] = useState(false);
  const [unseen, setUnseen] = useState(() => unseenCount());
  const build = useBuild();
  const toggle = () => {
    setOpen((o) => !o);
    const newest = Math.max(...CHANGELOG.map((e) => Date.parse(e.at)));
    try { localStorage.setItem(SEEN_KEY, String(newest)); } catch { /* ignore */ }
    setUnseen(0);
  };
  return (
    <>
      <button type="button" className="chat-clog-btn" onClick={toggle} aria-expanded={open} data-testid="changelog-btn" title="What’s new">
        📜<span> Changelog</span>{unseen > 0 && <span className="chat-badge" data-testid="changelog-unread">{unseen}</span>}
      </button>
      {open && (
        <div className="chat-clog" data-testid="changelog" role="dialog" aria-label="Changelog">
          <div className="chat-head"><b>📜 What’s new</b><button type="button" className="acct-close" aria-label="Close changelog" onClick={() => setOpen(false)}>✕</button></div>
          <div className="chat-dim chat-clog-build" data-testid="changelog-build">You’re on build {build?.commit ?? '…'}{build ? ` · live ${fmtMdt(build.builtAt)}` : ''}</div>
          <ol className="chat-clog-list">
            {CHANGELOG.map((e, i) => (
              <li key={`${e.commit}-${i}`} data-testid="changelog-entry">
                <div className="chat-clog-meta"><code>{e.commit || build?.commit || 'new'}</code><span>{fmtMdt(e.at)}</span></div>
                <b>{e.title}</b>
                <ul>{e.bullets.map((t) => <li key={t}>{t}</li>)}</ul>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}

export function BuildTag() {
  const b = useBuild();
  return b ? <span className="chat-build" data-testid="chat-build">Build {b.commit} · {fmtMdt(b.builtAt)}</span> : null;
}
