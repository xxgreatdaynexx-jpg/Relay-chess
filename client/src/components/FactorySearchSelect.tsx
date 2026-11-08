import { useId, useState } from 'react';

export type SOpt = { value: string; label: string; search?: string };
/** Case-insensitive, trimmed substring match on label + extra search text (ingredients). The selected option always stays. */
export function filterOpts(opts: SOpt[], query: string, selected: string): SOpt[] {
  const q = query.trim().toLowerCase(); if (!q) return opts;
  return opts.filter((o) => o.value === selected || `${o.label} ${o.search ?? ''}`.toLowerCase().includes(q));
}

/**
 * A factory picker with type-to-filter (t1968u). Typing only narrows the list: the value changes ONLY when the player
 * picks an option from the select, so a query can never choose a recipe or start production by itself.
 */
export function FactorySearchSelect({ label, value, opts, placeholder, onPick, testid }: { label: string; value: string; opts: SOpt[]; placeholder?: SOpt; onPick: (v: string) => void; testid: string }) {
  const [q, setQ] = useState(''); const id = useId();
  const shown = filterOpts(opts, q, value); const matches = shown.filter((o) => o.value !== value || !q.trim() || `${o.label} ${o.search ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="fac-ssel" data-testid={`${testid}-wrap`}>
      <label htmlFor={id}>{label}</label>
      <div className="fac-ssearch">
        <input type="search" inputMode="search" enterKeyHint="search" placeholder="Search…" value={q} aria-label={`Search ${label.toLowerCase()}`}
          onChange={(ev) => setQ(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter') ev.preventDefault(); if (ev.key === 'Escape' && q) { ev.preventDefault(); ev.stopPropagation(); setQ(''); } }} data-testid={`${testid}-search`} />
        {q && <button type="button" onClick={() => setQ('')} aria-label="Clear search" data-testid={`${testid}-clear`}>✕</button>}
      </div>
      <select id={id} value={value} onChange={(ev) => onPick(ev.target.value)} data-testid={testid}>
        {placeholder && (!value || !q.trim()) && <option value={placeholder.value}>{placeholder.label}</option>}
        {shown.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {q.trim() && !matches.length && <p className="mines-note" data-testid={`${testid}-empty`}>No matches for “{q.trim()}”.{value ? ' Your current pick is kept.' : ''}</p>}
    </div>
  );
}
