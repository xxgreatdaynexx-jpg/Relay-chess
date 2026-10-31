import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Slot order in the top bar. */
export const TOP_TAB_ORDER = ['blackjack', 'roulette', 'poker', 'slots', 'solitaire', 'arena', 'mines', 'factory', 'market', 'stocks'] as const;
export type TopTabId = (typeof TOP_TAB_ORDER)[number] | 'account' | 'chat' | 'wallet' | 'inventory';

/**
 * Pure layout for the priority+ bar: given each game tab's width (in order) and the room left for them,
 * return how many fit in the bar. When not all fit, room for the "More" button is reserved first.
 */
export function fitTabs(widths: number[], avail: number, gap: number, moreWidth: number): number {
  const total = widths.reduce((sum, w, i) => sum + w + (i ? gap : 0), 0);
  if (total <= avail) return widths.length;
  const room = avail - moreWidth - gap;
  let used = 0;
  let n = 0;
  for (const w of widths) {
    const next = used + (n ? gap : 0) + w;
    if (next > room) break;
    used = next;
    n += 1;
  }
  return n;
}

type Overflow = { id: string; label: string; active: boolean };

/**
 * The single top tab bar. Panels portal their tab buttons into its slots, so order is fixed here.
 * Wide screens: as many tabs as fit stay in the bar; the rest are listed under "More ▾" (works for any number of tabs).
 * Phones (<=520px): all tabs fold into the ☰ menu.
 */
export function TopTabs() {
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [overflow, setOverflow] = useState<Overflow[]>([]);
  const navRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const slotsBox = nav.querySelector<HTMLElement>('.top-tabs-slots');
    if (!slotsBox) return;
    const phone = window.matchMedia('(max-width: 520px)');
    let last = '';
    const measure = () => {
      const slots = [...slotsBox.querySelectorAll<HTMLElement>(':scope > .top-tab-slot')];
      slots.forEach((s) => s.removeAttribute('data-overflow')); // measure the full row, then decide (same frame, no flicker)
      const filled = slots.filter((s) => s.childElementCount > 0);
      let hidden: HTMLElement[] = [];
      if (!phone.matches && filled.length) {
        const cs = getComputedStyle(nav);
        const gap = parseFloat(cs.columnGap) || 6;
        slotsBox.style.display = 'none'; // measure the right-hand pills at their natural size, not squeezed by the tabs
        const others = [...nav.children].filter((el) => el !== slotsBox && !el.classList.contains('top-more') && !el.classList.contains('top-menu-btn'))
          .map((el) => (el as HTMLElement).getBoundingClientRect().width).filter((w) => w > 0);
        slotsBox.style.display = '';
        const fixed = others.reduce((a, w) => a + w + gap, 0);
        const avail = nav.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - fixed - 8;
        const moreW = Math.max(moreRef.current?.getBoundingClientRect().width || 0, 84);
        const n = fitTabs(filled.map((s) => s.getBoundingClientRect().width), avail, gap, moreW);
        hidden = filled.slice(n);
      }
      hidden.forEach((s) => s.setAttribute('data-overflow', ''));
      const next = hidden.map((s) => {
        const btn = s.querySelector<HTMLElement>('button');
        return { id: s.id.replace('top-tab-', ''), label: (btn?.textContent || s.textContent || '').trim(), active: btn?.getAttribute('aria-expanded') === 'true' };
      });
      const key = JSON.stringify(next);
      if (key !== last) { last = key; setOverflow(next); if (!next.length) setMoreOpen(false); }
      if (!phone.matches) setOpen(false);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    const observeSlots = () => slotsBox.querySelectorAll('.top-tab-slot, .top-tab-slot > *').forEach((el) => ro.observe(el));
    observeSlots();
    nav.querySelectorAll(':scope > .top-tab-slot').forEach((el) => ro.observe(el));
    const mo = new MutationObserver(() => { observeSlots(); measure(); });
    mo.observe(nav, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-expanded'] });
    window.addEventListener('resize', measure);
    phone.addEventListener?.('change', measure);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => { ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', measure); phone.removeEventListener?.('change', measure); };
  }, []);
  useEffect(() => {
    // Close the menus after picking a tab, or on an outside click / Escape.
    const close = (e: Event) => {
      const t = e.target as HTMLElement;
      if (t.closest?.('.top-tabs-slots .sol-tab')) setOpen(false);
      if (!t.closest?.('.top-more')) setMoreOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMoreOpen(false); setOpen(false); } };
    document.addEventListener('click', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', esc); };
  }, []);
  const pick = (id: string) => {
    setMoreOpen(false);
    document.getElementById(`top-tab-${id}`)?.querySelector<HTMLElement>('button')?.click();
  };
  return (
    <nav ref={navRef} className={`top-tabs ${open ? 'menu-open' : ''} ${overflow.length ? 'has-more' : ''}`} data-testid="top-tabs" aria-label="Games">
      <button type="button" className="top-menu-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="top-menu">☰ Games</button>
      <div className="top-tabs-slots">
        {TOP_TAB_ORDER.map((id) => <div key={id} id={`top-tab-${id}`} className="top-tab-slot" />)}
      </div>
      <div ref={moreRef} className="top-more" hidden={!overflow.length}>
        <button type="button" className={`sol-tab top-more-btn ${overflow.some((o) => o.active) ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)} data-testid="top-more">More ▾</button>
        {moreOpen && (
          <div className="top-more-menu" role="menu" data-testid="top-more-menu">
            {overflow.map((o) => (
              <button key={o.id} type="button" role="menuitem" className={`top-more-item ${o.active ? 'on' : ''}`} onClick={() => pick(o.id)} data-testid={`top-more-${o.id}`}>{o.label}</button>
            ))}
          </div>
        )}
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
