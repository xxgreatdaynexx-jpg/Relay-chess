import { useMemo, useState } from 'react';
import { buildWiki, filterWiki } from '../../../shared/wiki';

/** 📘 Wiki button in the chat head — opens the auto-generated guide. */
export function WikiButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="chat-clog-btn chat-wiki-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="wiki-btn" title="Game wiki / guide">
        📘<span> Wiki</span>
      </button>
      {open && <WikiPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function WikiPanel({ onClose }: { onClose: () => void }) {
  const all = useMemo(() => buildWiki(), []);
  const [q, setQ] = useState('');
  const sections = useMemo(() => filterWiki(q, all), [q, all]);
  return (
    <div className="chat-clog chat-wiki" data-testid="wiki" role="dialog" aria-label="Chud Hub wiki">
      <div className="chat-head">
        <b>📘 Wiki</b>
        <button type="button" className="acct-close" aria-label="Close wiki" onClick={onClose}>✕</button>
      </div>
      <div className="wiki-search">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search crops, ores, wages, taxes…"
          data-testid="wiki-search"
          aria-label="Search wiki"
          autoFocus
        />
        <small className="chat-dim">{sections.length} section{sections.length === 1 ? '' : 's'}</small>
      </div>
      <ol className="chat-clog-list wiki-list">
        {sections.length === 0 && <li className="chat-dim">No sections match “{q}”.</li>}
        {sections.map((s) => (
          <li key={s.id} data-testid={`wiki-section-${s.id}`}>
            <b>{s.icon} {s.title}</b>
            <p className="wiki-intro">{s.intro}</p>
            {!!s.bullets?.length && <ul>{s.bullets.map((b) => <li key={b.slice(0, 48)}>{b}</li>)}</ul>}
            {s.headers && s.rows && (
              <div className="wiki-table-wrap">
                <table className="wiki-table" data-testid={`wiki-table-${s.id}`}>
                  <thead><tr>{s.headers.map((h) => <th key={h || 'x'}>{h}</th>)}</tr></thead>
                  <tbody>{s.rows.map((r, i) => <tr key={i}>{r.cells.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
