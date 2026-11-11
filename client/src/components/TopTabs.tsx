import { swallowOutside } from '../lib/outsideSwallow';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Slot order for hidden portal targets. Every game/tool tab is listed once. */
export const TOP_TAB_ORDER = ['blackjack', 'roulette', 'poker', 'slots', 'solitaire', 'lootmatch', 'arena', 'hockey', 'mines', 'factory', 'market', 'stocks', 'skills'] as const;
export type GameTabId = (typeof TOP_TAB_ORDER)[number];
export type TopTabId = GameTabId | 'account' | 'chat' | 'wallet' | 'inventory' | 'resinv';

export const TOP_TAB_FALLBACK_LABELS: Record<GameTabId, string> = {
  blackjack: 'Blackjack',
  roulette: 'Roulette',
  poker: 'Poker',
  slots: 'Slots',
  solitaire: 'Solitaire',
  lootmatch: 'Loot Match',
  arena: 'Arena',
  hockey: 'Hockey',
  mines: 'Mines',
  factory: 'Factory',
  market: 'Market',
  stocks: 'Stocks',
  skills: 'Skills',
};

/** Visible category menus. Every TOP_TAB_ORDER id appears in exactly one group. */
export const TOP_TAB_GROUPS = [
  { id: 'casino', label: 'Casino', items: ['blackjack', 'roulette', 'poker', 'slots', 'solitaire', 'lootmatch', 'mines'] },
  { id: 'play', label: 'Play', items: ['arena', 'hockey'] },
  { id: 'work', label: 'Work', items: ['factory', 'market', 'skills'] },
  { id: 'money', label: 'Money', items: ['stocks'] },
] as const;
export type TopTabGroupId = (typeof TOP_TAB_GROUPS)[number]['id'];

/**
 * Pure layout for the priority+ bar: given each item's width (in order) and the room left for them,
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

type ItemState = { id: GameTabId; label: string; active: boolean; present: boolean };

function readItem(id: GameTabId): ItemState {
  const slot = document.getElementById(`top-tab-${id}`);
  const btn = slot?.querySelector<HTMLElement>('button');
  const raw = (btn?.textContent || TOP_TAB_FALLBACK_LABELS[id] || id).trim();
  return { id, label: raw || TOP_TAB_FALLBACK_LABELS[id], active: btn?.getAttribute('aria-expanded') === 'true', present: Boolean(btn) };
}

function readAllItems(): Record<GameTabId, ItemState> {
  return Object.fromEntries(TOP_TAB_ORDER.map((id) => [id, readItem(id)])) as Record<GameTabId, ItemState>;
}

/**
 * The single top tab bar. Panels portal their tab buttons into hidden slots; the bar shows category menus.
 * Wallet, chat, inventories, and account stay visible. Phones (<=520px): groups fold into the ☰ Menu.
 * On a narrower desktop, leftover groups move under "More ▾".
 */
export function TopTabs() {
  const [open, setOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [items, setItems] = useState<Record<GameTabId, ItemState>>(() =>
    Object.fromEntries(TOP_TAB_ORDER.map((id) => [id, { id, label: TOP_TAB_FALLBACK_LABELS[id], active: false, present: false }])) as Record<GameTabId, ItemState>,
  );
  const [overflowIds, setOverflowIds] = useState<TopTabGroupId[]>([]);
  const navRef = useRef<HTMLElement>(null);
  const groupsRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  const menuRef = useRef(openMenu);
  openRef.current = open;
  menuRef.current = openMenu;

  useLayoutEffect(() => {
    const nav = navRef.current;
    const groupsBox = groupsRef.current;
    if (!nav || !groupsBox) return;
    const phone = window.matchMedia?.('(max-width: 520px)') ?? { matches: false, addEventListener() {}, removeEventListener() {} };
    let last = '';
    const measure = () => {
      setItems(readAllItems());
      const groupEls = [...groupsBox.querySelectorAll<HTMLElement>(':scope > .top-group')];
      groupEls.forEach((s) => s.removeAttribute('data-overflow'));
      let hidden: HTMLElement[] = [];
      if (!phone.matches && groupEls.length) {
        const cs = getComputedStyle(nav);
        const gap = parseFloat(cs.columnGap) || 6;
        groupsBox.style.display = 'none';
        const others = [...nav.children]
          .filter((el) => el !== groupsBox && !el.classList.contains('top-more') && !el.classList.contains('top-menu-btn') && !el.classList.contains('top-tabs-portals'))
          .map((el) => (el as HTMLElement).getBoundingClientRect().width)
          .filter((w) => w > 0);
        groupsBox.style.display = '';
        const fixed = others.reduce((a, w) => a + w + gap, 0);
        const avail = nav.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - fixed - 8;
        const moreW = Math.max(moreRef.current?.getBoundingClientRect().width || 0, 84);
        const n = fitTabs(groupEls.map((s) => s.getBoundingClientRect().width), avail, gap, moreW);
        hidden = groupEls.slice(n);
      }
      hidden.forEach((s) => s.setAttribute('data-overflow', ''));
      const next = hidden.map((s) => (s.getAttribute('data-group') || '') as TopTabGroupId).filter(Boolean);
      const key = next.join(',');
      if (key !== last) {
        last = key;
        setOverflowIds(next);
        if (!next.length && menuRef.current === 'more') setOpenMenu(null);
      }
      if (!phone.matches) setOpen(false);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    groupElsSafe(groupsBox).forEach((el) => ro.observe(el));
    const portals = nav.querySelector('.top-tabs-portals');
    const mo = new MutationObserver(() => measure());
    if (portals) mo.observe(portals, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-expanded'] });
    mo.observe(groupsBox, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    phone.addEventListener?.('change', measure);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => { ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', measure); phone.removeEventListener?.('change', measure); };
  }, []);

  useEffect(() => {
    const close = (e: Event) => {
      const t = e.target as HTMLElement;
      if (t.closest?.('.top-group-menu .top-more-item, .top-more-menu .top-more-item')) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!openRef.current && !menuRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      setOpenMenu(null);
      setOpen(false);
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', esc, true); };
  }, []);

  useEffect(() => {
    // QA r11: an outside press while a menu is open only closes the menu; it never reaches the page underneath.
    if (!openMenu) return;
    const root = openMenu === 'more' ? moreRef.current : groupsRef.current?.querySelector(`[data-group="${openMenu}"]`) || null;
    return swallowOutside(document, (t) => Boolean(root && t instanceof Node && root.contains(t)), () => setOpenMenu(null));
  }, [openMenu]);

  const pick = (id: string) => {
    setOpenMenu(null);
    setOpen(false);
    document.getElementById(`top-tab-${id}`)?.querySelector<HTMLElement>('button')?.click();
  };
  const toggleMenu = (id: string) => setOpenMenu((cur) => (cur === id ? null : id));

  const overflowItems = overflowIds.flatMap((gid) => {
    const g = TOP_TAB_GROUPS.find((x) => x.id === gid);
    return (g?.items ?? []).map((id) => items[id]).filter((it) => it?.present);
  });

  return (
    <nav ref={navRef} className={`top-tabs ${open ? 'menu-open' : ''} ${overflowIds.length ? 'has-more' : ''}`} data-testid="top-tabs" aria-label="Game and tool menus">
      <button type="button" className="top-menu-btn" aria-expanded={open} onClick={() => { setOpen((o) => !o); setOpenMenu(null); }} data-testid="top-menu">☰ Menu</button>
      <div className="top-tabs-portals" aria-hidden="true">
        {TOP_TAB_ORDER.map((id) => <div key={id} id={`top-tab-${id}`} className="top-tab-slot" />)}
      </div>
      <div ref={groupsRef} className="top-tab-groups" data-testid="top-tab-groups">
        {TOP_TAB_GROUPS.map((g) => {
          const groupItems = g.items.map((id) => items[id]).filter((it) => it.present);
          const active = groupItems.some((it) => it.active);
          const isOpen = openMenu === g.id;
          return (
            <div key={g.id} className="top-group" data-group={g.id} data-testid={`top-group-${g.id}`}>
              <button
                type="button"
                className={`sol-tab top-group-btn ${active ? 'on' : ''}`}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                onClick={() => toggleMenu(g.id)}
                data-testid={`top-group-btn-${g.id}`}
              >
                {g.label} ▾
              </button>
              {isOpen && (
                <div className="top-more-menu top-group-menu" role="menu" data-testid={`top-group-menu-${g.id}`}>
                  {groupItems.map((it) => (
                    <button key={it.id} type="button" role="menuitem" className={`top-more-item ${it.active ? 'on' : ''}`} onClick={() => pick(it.id)} data-testid={`top-group-item-${it.id}`}>{it.label}</button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div ref={moreRef} className="top-more" hidden={!overflowIds.length}>
        <button type="button" className={`sol-tab top-more-btn ${overflowItems.some((o) => o.active) ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={openMenu === 'more'} onClick={() => toggleMenu('more')} data-testid="top-more">More ▾</button>
        {openMenu === 'more' && (
          <div className="top-more-menu" role="menu" data-testid="top-more-menu">
            {overflowItems.map((o) => (
              <button key={o.id} type="button" role="menuitem" className={`top-more-item ${o.active ? 'on' : ''}`} onClick={() => pick(o.id)} data-testid={`top-more-${o.id}`}>{o.label}</button>
            ))}
          </div>
        )}
      </div>
      <div id="top-tab-wallet" className="top-tab-slot top-tab-wallet" />
      <div id="top-tab-chat" className="top-tab-slot top-tab-chat" />
      <div id="top-tab-inventory" className="top-tab-slot top-tab-inventory" />
      <div id="top-tab-resinv" className="top-tab-slot top-tab-inventory top-tab-resinv" />
      <div id="top-tab-account" className="top-tab-slot top-tab-account" />
    </nav>
  );
}

function groupElsSafe(box: HTMLElement) {
  return [...box.querySelectorAll<HTMLElement>(':scope > .top-group')];
}

/** Renders a panel's tab button into its slot in the top bar. */
export function TopTab({ id, children }: { id: TopTabId; children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => { setEl(document.getElementById(`top-tab-${id}`)); }, [id]);
  return el ? createPortal(children, el) : null;
}
