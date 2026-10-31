import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Slot order in the top bar. */
export const TOP_TAB_ORDER = ['blackjack', 'roulette', 'poker', 'slots', 'solitaire', 'arena'] as const;
export type TopTabId = (typeof TOP_TAB_ORDER)[number] | 'account' | 'chat' | 'wallet' | 'inventory';

/** The single top tab bar. Panels portal their tab buttons into its slots, so order is fixed here. On phones it collapses to a menu button. */
export function TopTabs() {
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  // Any width where the tabs don't all fit in the bar: fold them into the ☰ menu so every tab stays reachable.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const had = nav.classList.contains('tabs-collapsed');
      nav.classList.remove('tabs-collapsed'); // measure the full row, then decide (same frame, no flicker)
      const slots = nav.querySelector<HTMLElement>('.top-tabs-slots');
      const over = !!slots && (slots.scrollWidth > slots.clientWidth + 1 || nav.scrollWidth > nav.clientWidth + 1);
      if (had) nav.classList.add('tabs-collapsed');
      setCollapsed(over);
      if (!over) setOpen(false);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    const mo = new MutationObserver(measure);
    mo.observe(nav, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  useEffect(() => {
    // Close the phone menu after picking a tab.
    const close = (e: Event) => { if ((e.target as HTMLElement).closest?.('.top-tabs-slots .sol-tab')) setOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  return (
    <nav ref={navRef} className={`top-tabs ${open ? 'menu-open' : ''} ${collapsed ? 'tabs-collapsed' : ''}`} data-testid="top-tabs" aria-label="Games">
      <button type="button" className="top-menu-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="top-menu">☰ Games</button>
      <div className="top-tabs-slots">
        {TOP_TAB_ORDER.map((id) => <div key={id} id={`top-tab-${id}`} className="top-tab-slot" />)}
      </div>
      <div id="top-tab-wallet" className="top-tab-slot top-tab-wallet" />
      <div id="top-tab-chat" className="top-tab-slot top-tab-chat" />
      <div id="top-tab-inventory" className="top-tab-slot top-tab-inventory" />
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
