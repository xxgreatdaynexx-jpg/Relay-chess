import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TopTab } from './TopTabs';
import { request, socket } from '@/lib/net';
import { useAccount } from '@/lib/auth';
import { paintSkin } from '@/lib/skinRender';
import { CASE_NAME, CASE_ODDS, KEY_NAME, RARITY_COLOR, RARITY_NAME, SKIN_BY_ID, WEAPON_NAME, wearOf, type Rarity, type SkinItem } from '../../../shared/skins';

const RANK: Record<Rarity, number> = { common: 0, rare: 1, ultra: 2 };

/** Canvas swatch of a skin's pattern (same painter the 3D guns use). */
function Swatch({ item, size }: { item: SkinItem; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const skin = SKIN_BY_ID.get(item.skin);
  useEffect(() => { const c = ref.current; if (c && skin) paintSkin(c.getContext('2d')!, size, skin, item.seed, item.float); }, [skin, item.seed, item.float, size]);
  if (item.kind === 'case') return <div className="inv-icon" style={{ width: size, height: size }}>📦</div>;
  if (item.kind === 'key') return <div className="inv-icon" style={{ width: size, height: size }}>🔑</div>;
  return <canvas ref={ref} width={size} height={size} className={`inv-swatch ${skin?.fx ? `fx-${skin.fx}` : ''}`} />;
}

const label = (i: SkinItem) => (i.kind === 'case' ? CASE_NAME : i.kind === 'key' ? KEY_NAME : SKIN_BY_ID.get(i.skin)?.name ?? i.skin);
const rarityOf = (i: SkinItem): Rarity | null => (i.kind === 'skin' ? SKIN_BY_ID.get(i.skin)?.rarity ?? null : null);

export function SkinsPanel() {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    const o = () => setOpen(true);
    const drop = (it: SkinItem) => { setToast(`Match drop: ${label(it)}!`); window.setTimeout(() => setToast(null), 6000); };
    window.addEventListener('open-inventory', o); socket.on('inv_drop', drop);
    return () => { window.removeEventListener('open-inventory', o); socket.off('inv_drop', drop); };
  }, []);
  return (
    <>
      <TopTab id="skins"><button type="button" className="sol-tab" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="skins-tab">🎒 Skins</button></TopTab>
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
  const cur = items.find((i) => i.id === sel) ?? shown[0] ?? null;
  const cases = items.filter((i) => i.kind === 'case' && !i.locked).length, keys = items.filter((i) => i.kind === 'key' && !i.locked).length;

  const act = async (ev: string, body: object) => { setErr(''); const r = await request(ev, body) as unknown as { ok: boolean; error?: string; [k: string]: unknown }; if (!r.ok) setErr(r.error ?? 'Failed'); return r; };
  const open = async (caseId?: string) => { const r = await act('inv_open', { caseId }); if (r.ok) setUnbox({ reel: r.reel as string[], win: r.win as number, item: r.item as SkinItem }); };
  const def = cur?.kind === 'skin' ? SKIN_BY_ID.get(cur.skin) : undefined;

  return (
    <div className="inv-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="inventory">
      <div className="inv-win" role="dialog" aria-label="Inventory">
        <header className="inv-head">
          <strong>🎒 Inventory</strong><span className="inv-count">{items.length} items · 📦 {cases} · 🔑 {keys}</span>
          <button type="button" className="inv-open-btn" disabled={!cases || !keys} onClick={() => void open()} data-testid="inv-open">Open {CASE_NAME}</button>
          <button type="button" aria-label="Close inventory" onClick={onClose}>✕</button>
        </header>
        {!signedIn && <p className="inv-note">Sign in to collect skins. Every Arena match you finish drops a {CASE_NAME} or a {KEY_NAME} (50/50).</p>}
        <div className="inv-filters">
          <select value={weapon} onChange={(e) => setWeapon(e.target.value)} data-testid="inv-weapon"><option value="all">All weapons</option><option value="items">Cases &amp; keys</option>{['pistol', 'smg', 'shotgun', 'sniper', 'rocket', 'knife'].map((w) => <option key={w} value={w}>{WEAPON_NAME[w]}</option>)}</select>
          <select value={rarity} onChange={(e) => setRarity(e.target.value)} data-testid="inv-rarity"><option value="all">All rarities</option>{(['common', 'rare', 'ultra'] as const).map((r) => <option key={r} value={r}>{RARITY_NAME[r]}</option>)}</select>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} data-testid="inv-sort"><option value="new">Newest</option><option value="rarity">Rarity</option><option value="name">Name</option><option value="wear">Best wear</option></select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" data-testid="inv-search" />
        </div>
        <div className="inv-body">
          <div className="inv-grid" data-testid="inv-grid">
            {shown.map((i) => { const r = rarityOf(i); return (
              <button type="button" key={i.id} className={`inv-cell ${cur?.id === i.id ? 'sel' : ''} ${r ? `r-${r}` : 'r-item'}`} style={{ '--rc': r ? RARITY_COLOR[r] : '#8a8f98' } as React.CSSProperties} onClick={() => setSel(i.id)} title={label(i)} data-testid="inv-cell">
                <Swatch item={i} size={72} />
                <span className="inv-name">{label(i)}</span>
                {i.equipped && <span className="inv-badge">E</span>}
                {i.locked && <span className="inv-badge lock">🔒</span>}
              </button>); })}
            {!shown.length && <p className="inv-note">{items.length ? 'Nothing matches those filters.' : 'Empty. Play an Arena match to get a drop.'}</p>}
          </div>
          <aside className="inv-detail" data-testid="inv-detail">
            {cur ? <>
              <div className="inv-preview" style={{ '--rc': rarityOf(cur) ? RARITY_COLOR[rarityOf(cur)!] : '#8a8f98' } as React.CSSProperties}><Swatch item={cur} size={180} /></div>
              <h3>{label(cur)}</h3>
              {def ? <>
                <p style={{ color: RARITY_COLOR[def.rarity] }}>{RARITY_NAME[def.rarity]} {WEAPON_NAME[def.weapon]}{def.fx ? ` · ✨ ${def.fx}` : ''}</p>
                <p>{wearOf(cur.float).name} · float {cur.float.toFixed(5)} · pattern #{cur.seed}</p>
                <div className="inv-actions">
                  <button type="button" onClick={() => void act('inv_equip', { id: cur.id })} disabled={!!cur.locked} data-testid="inv-equip">{cur.equipped ? 'Unequip' : 'Equip'}</button>
                  <button type="button" disabled title="Market opens in the next update">Sell</button>
                  <button type="button" disabled title="Trading opens in the next update">Trade</button>
                </div>
              </> : cur.kind === 'case' ? <>
                <p>Holds 1 of 55 skins: Common {Math.round(CASE_ODDS.common * 100)}% · Rare {Math.round(CASE_ODDS.rare * 100)}% · Ultra {Math.round(CASE_ODDS.ultra * 100)}%. Needs a {KEY_NAME}.</p>
                <div className="inv-actions"><button type="button" disabled={!keys || !!cur.locked} onClick={() => void open(cur.id)}>Open</button><button type="button" disabled>Sell</button></div>
              </> : <><p>Opens one {CASE_NAME}.</p><div className="inv-actions"><button type="button" disabled>Sell</button></div></>}
            </> : <p className="inv-note">Select an item.</p>}
            {err && <p className="inv-err">{err}</p>}
          </aside>
        </div>
      </div>
      {unbox && <Unbox {...unbox} onDone={() => { setSel(unbox.item.id); setUnbox(null); load(); }} />}
    </div>
  );
}

function Unbox({ reel, win, item, onDone }: { reel: string[]; win: number; item: SkinItem; onDone: () => void }) {
  const [x, setX] = useState(0);
  const [done, setDone] = useState(false);
  const CELL = 120;
  useEffect(() => {
    const jitter = Math.random() * 80 - 40;
    const t1 = window.setTimeout(() => setX(-(win * CELL) + 300 - CELL / 2 + jitter), 50);
    const t2 = window.setTimeout(() => setDone(true), 5200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [win]);
  const s = SKIN_BY_ID.get(item.skin)!;
  return (
    <div className="unbox" data-testid="unbox">
      <div className="unbox-window"><div className="unbox-marker" />
        <div className="unbox-reel" style={{ transform: `translateX(${x}px)` }}>
          {reel.map((id, i) => { const d = SKIN_BY_ID.get(id)!; return (
            <div key={i} className="unbox-cell" style={{ '--rc': RARITY_COLOR[d.rarity] } as React.CSSProperties}>
              <Swatch item={{ ...item, id: `r${i}`, skin: id, seed: i * 37, float: 0.1 }} size={90} /><span>{d.name}</span>
            </div>); })}
        </div>
      </div>
      {done && <div className="unbox-result" style={{ color: RARITY_COLOR[s.rarity] }} data-testid="unbox-result">
        <strong>{s.name}</strong> — {RARITY_NAME[s.rarity]} {WEAPON_NAME[s.weapon]} · {wearOf(item.float).name}
        <button type="button" onClick={onDone}>Nice</button>
      </div>}
      {!done && <button type="button" className="unbox-skip" onClick={() => setDone(true)}>Skip</button>}
    </div>
  );
}
