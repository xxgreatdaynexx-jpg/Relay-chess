import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TopTab } from './TopTabs';
import { MarketView, MaterialsView, SellForm, TradesView } from './MarketPanel';
import { request, socket } from '@/lib/net';
import { useAccount } from '@/lib/auth';
import { paintSkin } from '@/lib/skinRender';
import { skinThumb, mountInspect } from '../lib/skinThumbs';
import { skinToken, CASE_ODDS_TABLE, KNIFE_IN_CASES, isKnife, skinName, CASE_NAME, KEY_NAME, RARITY_COLOR, RARITY_NAME, SKIN_BY_ID, WEAPON_NAME, wearOf, type Rarity, type SkinItem } from '../../../shared/skins';

const RANK: Record<Rarity, number> = { common: 0, rare: 1, ultra: 2 };

/** Canvas swatch of a skin's pattern (same painter the 3D guns use). */
/** Flat pattern swatch (fallback while the 3D thumbnail renders, or without WebGL). */
function FlatSwatch({ item, size }: { item: SkinItem; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const skin = SKIN_BY_ID.get(item.skin);
  useEffect(() => { const c = ref.current; if (c && skin) paintSkin(c.getContext('2d')!, size, skin, item.seed, item.float); }, [skin, item.seed, item.float, size]);
  return <canvas ref={ref} width={size} height={size} className={`inv-swatch ${skin?.fx ? `fx-${skin.fx}` : ''}`} />;
}
/** The skin on the real Arena weapon model: rendered lazily when scrolled into view, cached per item. */
export function Swatch({ item, size }: { item: SkinItem; size: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const skin = SKIN_BY_ID.get(item.skin);
  useEffect(() => {
    if (item.kind !== 'skin' || !skin) return;
    const el = box.current; if (!el) return;
    let live = true; const token = skinToken(item);
    const go = () => void skinThumb(token, size * 2).then((u) => { if (!live) return; if (u) setUrl(u); else setFailed(true); });
    if (typeof IntersectionObserver === 'undefined') { go(); return () => { live = false; }; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => { live = false; io.disconnect(); };
  }, [item.kind, item.skin, item.seed, item.float, size, skin]);
  if (item.kind === 'case') return <div className="inv-icon" style={{ width: size, height: size }}>📦</div>;
  if (item.kind === 'key') return <div className="inv-icon" style={{ width: size, height: size }}>🔑</div>;
  return (
    <div ref={box} className={`inv-thumb ${skin?.fx ? `fx-${skin.fx}` : ''}`} style={{ width: size, height: size }}>
      {url ? <img src={url} width={size} height={size} alt="" draggable={false} data-testid="inv-thumb" /> : <FlatSwatch item={item} size={failed ? size : Math.round(size * 0.6)} />}
    </div>
  );
}
/** Drag-to-rotate 3D inspect of the selected skin. */
function Inspect({ item }: { item: SkinItem }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const c = ref.current; if (!c || item.kind !== 'skin') return; return mountInspect(c, skinToken(item)); }, [item.id, item.kind, item.skin, item.seed, item.float]);
  if (item.kind !== 'skin') return <Swatch item={item} size={180} />;
  return <canvas ref={ref} className="inv-inspect" title="Drag to rotate" data-testid="inv-inspect" />;
}

export const label = (i: SkinItem) => (i.kind === 'case' ? CASE_NAME : i.kind === 'key' ? KEY_NAME : (SKIN_BY_ID.has(i.skin) ? skinName(SKIN_BY_ID.get(i.skin)!) : i.skin));
export const rarityOf = (i: SkinItem): Rarity | null => (i.kind === 'skin' ? SKIN_BY_ID.get(i.skin)?.rarity ?? null : null);

type InvTab = 'inv' | 'market' | 'mats' | 'trades';
let pendingInvTab: InvTab | null = null;

export function SkinsPanel() {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    const o = (e: Event) => { const t = (e as CustomEvent<{ tab?: InvTab }>).detail?.tab; if (t) pendingInvTab = t; setOpen(true); };
    const drop = (it: SkinItem) => { setToast(`Match drop: ${label(it)}!`); window.setTimeout(() => setToast(null), 6000); };
    const ann = (a: { text: string }) => { setToast(`🔪 ${a.text}`); window.setTimeout(() => setToast(null), 8000); };
    window.addEventListener('open-inventory', o); socket.on('inv_drop', drop); socket.on('inv_announce', ann);
    return () => { window.removeEventListener('open-inventory', o); socket.off('inv_drop', drop); socket.off('inv_announce', ann); };
  }, []);
  return (
    <>
      <TopTab id="inventory"><button type="button" className="sol-tab inv-tab" aria-label="Inventory" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="skins-tab">🎒<span className="inv-tab-label"> Inventory</span></button></TopTab>
      {toast && createPortal(<div className="inv-toast" data-testid="inv-drop-toast" onClick={() => { setOpen(true); setToast(null); }}>🎁 {toast}</div>, document.body)}
      {open && createPortal(<Inventory onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function Inventory({ onClose }: { onClose: () => void }) {
  const account = useAccount();
  const [items, setItems] = useState<SkinItem[]>([]);
  const [signedIn, setSignedIn] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const [weapon, setWeapon] = useState('all');
  const [rarity, setRarity] = useState('all');
  const [sort, setSort] = useState<'new' | 'rarity' | 'name' | 'wear'>('new');
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [unbox, setUnbox] = useState<{ reel: string[]; win: number; item: SkinItem } | null>(null);
  const [tab, setTab] = useState<InvTab>(() => { const t = pendingInvTab ?? 'inv'; pendingInvTab = null; return t; });
  useEffect(() => { const f = (e: Event) => { const t = (e as CustomEvent<{ tab?: InvTab }>).detail?.tab; if (t) { setTab(t); pendingInvTab = null; } }; window.addEventListener('open-inventory', f); return () => window.removeEventListener('open-inventory', f); }, []);
  const [selling, setSelling] = useState<string | null>(null);
  const [tradeSeed, setTradeSeed] = useState<string | null>(null);

  const load = useCallback(() => {
    void request('inv_get', {}).then((r) => { const a = r as unknown as { ok: boolean; signedIn?: boolean; items?: SkinItem[] }; if (a.ok) { setSignedIn(!!a.signedIn); setItems(a.items ?? []); } });
  }, []);
  useEffect(() => { load(); socket.on('inv_changed', load); socket.on('connect', load); return () => { socket.off('inv_changed', load); socket.off('connect', load); }; }, [load, account]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => {
      const def = SKIN_BY_ID.get(i.skin);
      if (weapon !== 'all' && (weapon === 'items' ? i.kind === 'skin' : def?.weapon !== weapon)) return false;
      if (rarity !== 'all' && rarityOf(i) !== rarity) return false;
      return !s || label(i).toLowerCase().includes(s) || (def && WEAPON_NAME[def.weapon]?.toLowerCase().includes(s));
    }).sort((a, b) => sort === 'rarity' ? (RANK[rarityOf(b) ?? 'common'] - RANK[rarityOf(a) ?? 'common']) || b.at - a.at
      : sort === 'name' ? label(a).localeCompare(label(b)) : sort === 'wear' ? a.float - b.float : b.at - a.at);
  }, [items, weapon, rarity, sort, q]);
  const [odds, setOdds] = useState(false);
  const PAGE = 120;
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [weapon, rarity, sort, q]);
  const more = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = more.current; if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setLimit((l) => l + PAGE); }, { rootMargin: '300px' });
    io.observe(el); return () => io.disconnect();
  }, [limit, shown.length]);
  const cur = items.find((i) => i.id === sel) ?? shown[0] ?? null;
  const cases = items.filter((i) => i.kind === 'case' && !i.locked).length, keys = items.filter((i) => i.kind === 'key' && !i.locked).length;

  const act = async (ev: string, body: object) => { setErr(''); const r = await request(ev, body) as unknown as { ok: boolean; error?: string; [k: string]: unknown }; if (!r.ok) setErr(r.error ?? 'Failed'); return r; };
  const open = async (caseId?: string) => { const r = await act('inv_open', { caseId }); if (r.ok) setUnbox({ reel: r.reel as string[], win: r.win as number, item: r.item as SkinItem }); };
  const def = cur?.kind === 'skin' ? SKIN_BY_ID.get(cur.skin) : undefined;

  return (
    <div className="inv-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="inventory">
      <div className="inv-win" role="dialog" aria-label="Inventory">
        <header className="inv-head">
          <nav className="inv-tabs" role="tablist">{([['inv', '🎒 Inventory'], ['market', '🏪 Market'], ['mats', '⛏ Materials'], ['trades', '🤝 Trades']] as const).map(([k, t]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} data-testid={`inv-tab-${k}`}>{t}</button>)}</nav><span className="inv-count">{items.length} items · 📦 {cases} · 🔑 {keys}</span>
          <button type="button" className="inv-open-btn" disabled={!cases || !keys} onClick={() => void open()} data-testid="inv-open">Open {CASE_NAME}</button>
          <button type="button" aria-label="Close inventory" onClick={onClose}>✕</button>
        </header>
        {!signedIn && <p className="inv-note">Sign in to collect skins. Every Arena match you finish drops a {CASE_NAME} or a {KEY_NAME} (50/50).</p>}
        {tab === 'market' && <MarketView />}
        {tab === 'mats' && <MaterialsView />}
        {tab === 'trades' && <TradesView seed={tradeSeed} />}
        {tab === 'inv' && <>
        <div className="inv-slots" data-testid="inv-slots">{['pistol', 'smg', 'shotgun', 'sniper', 'rocket', 'ar15', 'knife', 'pickaxe'].map((w) => { const e = items.find((i) => i.equipped && i.kind === 'skin' && SKIN_BY_ID.get(i.skin)?.weapon === w); return (
          <button type="button" key={w} className={`inv-slot${e ? ' on' : ''}`} data-testid={`inv-slot-${w}`} onClick={() => setWeapon(w)} title={e ? SKIN_BY_ID.get(e.skin)?.name : 'Stock'}>{w === 'pickaxe' ? '⛏ ' : ''}{WEAPON_NAME[w]}: {e ? SKIN_BY_ID.get(e.skin)?.name : 'Stock'}</button>); })}</div>
        <div className="inv-filters">
          <select value={weapon} onChange={(e) => setWeapon(e.target.value)} data-testid="inv-weapon"><option value="all">All weapons</option><option value="items">Cases &amp; keys</option>{['pistol', 'smg', 'shotgun', 'sniper', 'rocket', 'ar15', 'knife', 'pickaxe'].map((w) => <option key={w} value={w}>{WEAPON_NAME[w]}</option>)}</select>
          <select value={rarity} onChange={(e) => setRarity(e.target.value)} data-testid="inv-rarity"><option value="all">All rarities</option>{(['common', 'rare', 'ultra'] as const).map((r) => <option key={r} value={r}>{RARITY_NAME[r]}</option>)}</select>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} data-testid="inv-sort"><option value="new">Newest</option><option value="rarity">Rarity</option><option value="name">Name</option><option value="wear">Best wear</option></select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" data-testid="inv-search" />
        </div>
        <div className="inv-body">
          <div className="inv-grid" data-testid="inv-grid">
            {shown.slice(0, limit).map((i) => { const r = rarityOf(i); return (
              <button type="button" key={i.id} className={`inv-cell ${cur?.id === i.id ? 'sel' : ''} ${r ? `r-${r}` : 'r-item'} ${isKnife(SKIN_BY_ID.get(i.skin)) ? 'knife' : ''}`} style={{ '--rc': r ? RARITY_COLOR[r] : '#8a8f98' } as React.CSSProperties} onClick={() => setSel(i.id)} title={label(i)} data-testid="inv-cell">
                <Swatch item={i} size={72} />
                <span className="inv-name">{label(i)}</span>
                {i.equipped && <span className="inv-badge">E</span>}
                {i.locked && <span className="inv-badge lock">🔒</span>}
              </button>); })}
            {shown.length > limit && <div ref={more} className="inv-more"><button type="button" onClick={() => setLimit((l) => l + PAGE)}>Show more ({shown.length - limit})</button></div>}
            {!shown.length && <p className="inv-note">{items.length ? 'Nothing matches those filters.' : 'Empty. Play an Arena match to get a drop.'}</p>}
          </div>
          <aside className="inv-detail" data-testid="inv-detail">
            {cur ? <>
              <div className="inv-preview" style={{ '--rc': rarityOf(cur) ? RARITY_COLOR[rarityOf(cur)!] : '#8a8f98' } as React.CSSProperties}><Inspect item={cur} /></div>
              <h3>{label(cur)}</h3>
              {def ? <>
                <p style={{ color: RARITY_COLOR[def.rarity] }}>{RARITY_NAME[def.rarity]} {WEAPON_NAME[def.weapon]}{def.fx ? ` · ✨ ${def.fx}` : ''}</p>
                <p>{wearOf(cur.float).name} · float {cur.float.toFixed(5)} · pattern #{cur.seed}</p>
                <div className="inv-actions">
                  <button type="button" onClick={() => void act('inv_equip', { id: cur.id })} disabled={!!cur.locked} data-testid="inv-equip">{cur.equipped ? 'Unequip' : 'Equip'}</button>
                  <button type="button" disabled={!!cur.locked || !signedIn} onClick={() => setSelling(selling === cur.id ? null : cur.id)} data-testid="inv-sell">Sell</button>
                  <button type="button" disabled={!!cur.locked || !signedIn} onClick={() => { setTradeSeed(cur.id); setTab('trades'); }} data-testid="inv-trade">Trade</button>
                </div>
              </> : cur.kind === 'case' ? <>
                <p>Needs a {KEY_NAME}. <button type="button" className="inv-odds-btn" onClick={() => setOdds((o) => !o)} data-testid="inv-odds">Odds</button></p>
                {odds && <table className="inv-odds" data-testid="inv-odds-table"><tbody>{CASE_ODDS_TABLE.map((o) => (
                  <tr key={o.group + o.rarity} className={o.group === 'knife' ? 'knife' : ''}><td>{o.group === 'knife' ? '★ Knife' : 'Gun'} {RARITY_NAME[o.rarity]}</td><td>{(o.p * 100).toFixed(o.p < 0.01 ? 2 : 1)}%</td></tr>))}</tbody></table>}
                {odds && !KNIFE_IN_CASES && <p className="inv-note">★ Knives join cases when the knife ships; until then the knife roll rerolls into the gun tiers.</p>}
                <div className="inv-actions"><button type="button" disabled={!keys || !!cur.locked} onClick={() => void open(cur.id)}>Open</button><button type="button" disabled={!!cur.locked || !signedIn} onClick={() => setSelling(selling === cur.id ? null : cur.id)} data-testid="inv-sell">Sell</button><button type="button" disabled={!!cur.locked || !signedIn} onClick={() => { setTradeSeed(cur.id); setTab('trades'); }} data-testid="inv-trade">Trade</button></div>
              </> : <><p>Opens one {CASE_NAME}.</p><div className="inv-actions"><button type="button" disabled={!!cur.locked || !signedIn} onClick={() => setSelling(selling === cur.id ? null : cur.id)} data-testid="inv-sell">Sell</button><button type="button" disabled={!!cur.locked || !signedIn} onClick={() => { setTradeSeed(cur.id); setTab('trades'); }} data-testid="inv-trade">Trade</button></div></>}
              {selling === cur.id && <SellForm item={cur} onDone={() => { setSelling(null); load(); setTab('market'); }} />}
              {cur.locked && <p className="inv-note">🔒 Listed on the Market or held in a trade offer.</p>}
            </> : <p className="inv-note">Select an item.</p>}
            {err && <p className="inv-err">{err}</p>}
          </aside>
        </div>
        </>}
      </div>
      {unbox && <Unbox {...unbox} onDone={() => { setSel(unbox.item.id); setUnbox(null); load(); }} />}
    </div>
  );
}

function Unbox({ reel, win, item, onDone }: { reel: string[]; win: number; item: SkinItem; onDone: () => void }) {
  const [x, setX] = useState(0);
  const [done, setDone] = useState(false);
  const CELL = 120;
  const s = SKIN_BY_ID.get(item.skin)!;
  const knife = isKnife(s);
  useEffect(() => {
    const jitter = Math.random() * 80 - 40;
    const t1 = window.setTimeout(() => setX(-(win * CELL) + 300 - CELL / 2 + jitter), 50);
    const t2 = window.setTimeout(() => setDone(true), knife ? 8200 : 5200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [win, knife]);
  return (
    <div className={`unbox ${knife ? 'knife' : ''} ${knife && done ? 'flash' : ''}`} data-testid="unbox">
      <div className="unbox-window"><div className="unbox-marker" />
        <div className="unbox-reel" style={{ transform: `translateX(${x}px)`, ...(knife ? { transitionDuration: '8s', transitionTimingFunction: 'cubic-bezier(.05,.75,.1,1)' } : {}) }}>
          {reel.map((id, i) => { const d = SKIN_BY_ID.get(id)!; return (
            <div key={i} className={`unbox-cell ${isKnife(d) ? 'knife' : ''}`} style={{ '--rc': isKnife(d) ? '#ffd23f' : RARITY_COLOR[d.rarity] } as React.CSSProperties}>
              {isKnife(d) ? <><div className="unbox-star">★</div><span>Rare Special Item</span></> : <><Swatch item={{ ...item, id: `r${i}`, skin: id, seed: i * 37, float: 0.1 }} size={90} /><span>{d.name}</span></>}
            </div>); })}
        </div>
      </div>
      {done && <div className="unbox-result" style={{ color: knife ? '#ffd23f' : RARITY_COLOR[s.rarity] }} data-testid="unbox-result">
        <strong>{skinName(s)}</strong> — {RARITY_NAME[s.rarity]} {WEAPON_NAME[s.weapon]} · {wearOf(item.float).name}
        <button type="button" onClick={onDone}>Nice</button>
      </div>}
      {!done && <button type="button" className="unbox-skip" onClick={() => setDone(true)}>Skip</button>}
    </div>
  );
}
