import { useMemo, useState } from 'react';
import { ItemIcon } from './ItemIcon';
import { KINDS, nameOfKey, type FRecipe, type Kind } from '../../../shared/factory';
import { recipesOfItem, searchItems } from '../../../shared/factorySearch';

/** Search box on the Recipes tab: type an item, see what it's used in and what makes it. Clicking a recipe opens its chain. */
export function FactoryRecipeSearch({ icons, pick }: { icons: Record<Kind, string>; pick: (out: string) => void }) {
  const [q, setQ] = useState('');
  const [item, setItem] = useState<string | null>(null);
  const hits = useMemo(() => searchItems(q), [q]);
  const shown = item ?? (hits.length ? hits[0] : null);
  const res = shown && q.trim() ? recipesOfItem(shown) : null;
  const Row = ({ r }: { r: FRecipe }) => (
    <button type="button" className="frs-rec" onClick={() => pick(r.out[0])} title="Show this chain" data-testid="frs-rec">
      <span className="frs-mach">{icons[r.machine]} {KINDS[r.machine].name}</span>
      <span>{r.in.map(([k, n]) => <i key={k} className={k === shown ? 'frs-hit' : ''}><ItemIcon k={k} size={16} />{n} {nameOfKey(k)}</i>)}</span>
      <span>→ <i className={r.out[0] === shown ? 'frs-hit' : ''}><ItemIcon k={r.out[0]} size={16} />{r.out[1]} {nameOfKey(r.out[0])}</i> <small>{r.secs}s</small></span>
    </button>
  );
  return (
    <div className="frs" data-testid="frs">
      <input className="frs-input" type="search" placeholder="🔎 Search an item or ingredient (e.g. copper, gear)" value={q}
        onChange={(e) => { setQ(e.target.value); setItem(null); }} data-testid="frs-input" />
      {q.trim() && !hits.length && <p className="mines-note" data-testid="frs-none">No item matches "{q}".</p>}
      {hits.length > 1 && <div className="frs-chips">{hits.map((k) => (
        <button type="button" key={k} className={k === shown ? 'on' : ''} onClick={() => setItem(k)} data-testid="frs-item"><ItemIcon k={k} size={16} />{nameOfKey(k)}</button>
      ))}</div>}
      {res && <div className="frs-res" data-testid="frs-results">
        <h4><ItemIcon k={res.key} size={18} /> {nameOfKey(res.key)}</h4>
        <h5>Used in ({res.usedIn.length})</h5>
        {res.usedIn.length ? res.usedIn.map((r) => <Row key={r.id} r={r} />) : <p className="mines-note">Not an input to any recipe: an end product.</p>}
        <h5>Made by ({res.madeBy.length})</h5>
        {res.madeBy.length ? res.madeBy.map((r) => <Row key={r.id} r={r} />) : <p className="mines-note">Raw input: mine, farm or fish it.</p>}
      </div>}
    </div>
  );
}
