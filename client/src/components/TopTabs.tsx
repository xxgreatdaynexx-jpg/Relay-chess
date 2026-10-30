import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Slot order in the top bar. */
export const TOP_TAB_ORDER = ['blackjack', 'roulette', 'poker', 'slots', 'solitaire', 'arena'] as const;
export type TopTabId = (typeof TOP_TAB_ORDER)[number] | 'account' | 'chat';

/** The single top tab bar. Panels portal their tab buttons into its slots, so order is fixed here. On phones it collapses to a menu button. */
export function TopTabs() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // Close the phone menu after picking a tab.
    const close = (e: Event) => { if ((e.target as HTMLElement).closest?.('.top-tabs-slots .sol-tab')) setOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  return (
    <nav className={`top-tabs ${open ? 'menu-open' : ''}`} data-testid="top-tabs" aria-label="Games">
      <button type="button" className="top-menu-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="top-menu">☰ Games</button>
      <div className="top-tabs-slots">
        {TOP_TAB_ORDER.map((id) => <div key={id} id={`top-tab-${id}`} className="top-tab-slot" />)}
      </div>
      <div id="top-tab-chat" className="top-tab-slot top-tab-chat" />
      <div id="top-tab-account" className="top-tab-slot top-tab-account" />
    </nav>
  );
}

/** Renders a panel's tab button into its slot in the top bar. */
export function TopTab({ id, children }: { id: TopTabId; children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => { setEl(document.getElementById(`top-tab-${id}`)); }, [id]);
  return el ? createPortal(children, el) : null;
}
