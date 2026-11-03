import { openFactoryView } from './FactoryViewer';
import { useEffect, useState } from 'react';
import { VisitHomeButtons } from './Homes';
import { createPortal } from 'react-dom';
import { backdropDismiss } from '@/lib/backdrop';
import { SkillGrid, type SkillProfile } from './Skills';
import { usePanelDrag } from '@/lib/panelDrag';
import { NetWorthChart, type NetWorthHistory } from './NetWorthChart';

/** Open any player's public profile from anywhere: `openPlayer('Name')` or an element with `data-player="Name"`. */
export const openPlayer = (name: string) => window.dispatchEvent(new CustomEvent('open-player', { detail: name }));

interface Spot { x: number | null; z: number | null; map: string }
export interface PublicProfile {
  name: string; memberSince: string | null; online: boolean; where?: string | null;
  chips: number | null; assets: number; netWorth: number; history?: NetWorthHistory; dividends?: number; categories: Array<{ key: string; label: string; value: number }>;
  properties: Array<Spot & { id: string; label: string; type: string; value: number }>;
  farms: Array<Spot & { plot: string; label: string; crops: Array<{ crop: string; label: string; emoji: string; n: number; ready: number }> }>;
  cars: Array<{ carId: string; name: string; value: number }>; trailer: { lot: number } | null;
  stocks: Array<{ ticker: string; shares: number; price: number; value: number }>;
  funds: Array<{ fund: string; name: string; units: number; value: number }>;
  options: Array<{ ticker: string; kind: string; strike: number; qty: number; value: number }>;
  shorts: Array<{ ticker: string; shares: number; value: number }>;
  skins: { total: number; cases: number; keys: number; highlights: Array<{ name: string; weapon: string; rarity: string; color: string; equipped: boolean }> };
  skills: SkillProfile | null;
  houseRoom?: { cap: number; soldToday: number; refunded: number; left: number } | null;
  biggestFish: { label: string; emoji: string; grams: number; value: number; at: number } | null;
}

const n = (v: number) => Math.round(v).toLocaleString();
const RARITY: Record<string, string> = { ultra: '#e8c26a', rare: '#7fb2ff', common: '#9aa0b4' };

function Section({ title, children, testid }: { title: string; children: React.ReactNode; testid?: string }) {
  return <section className="mt-4" data-testid={testid}><h3 className="mb-1 text-xs uppercase tracking-wide opacity-70">{title}</h3>{children}</section>;
}
function Line({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 py-0.5 text-sm"><span className="min-w-0 truncate">{left}</span><span className="shrink-0 tabular-nums font-semibold">{right}</span></div>;
}
const None = ({ t }: { t: string }) => <p className="text-xs opacity-50">{t}</p>;

function focus(s: Spot, close: () => void) {
  if (s.x == null || s.z == null) return;
  close(); window.dispatchEvent(new CustomEvent('world-focus', { detail: { x: s.x, z: s.z } }));
}
const MapBtn = ({ s, close }: { s: Spot; close: () => void }) => s.map === 'resort'
  ? <span className="ml-1 text-[10px] opacity-60">🏝️ Resort</span>
  : s.x != null ? <button type="button" className="ml-1 rounded px-1 text-[11px] text-[#e8c26a] hover:underline" onClick={() => focus(s, close)} data-testid="profile-focus">📍 Show</button> : null;

export function PlayerProfileView({ p, close }: { p: PublicProfile; close: () => void }) {
  const since = p.memberSince ? new Date(p.memberSince).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : null;
  const holdings = p.stocks.length + p.funds.length + p.options.length + p.shorts.length;
  return <>
    <div className="flex items-start justify-between gap-2">
      <div>
        <h2 className="text-lg font-bold" data-testid="player-profile-name">{p.name}</h2>
        <div className="text-xs opacity-70">
          <span className={p.online ? 'text-emerald-300' : 'opacity-70'} data-testid="player-profile-status">{p.online ? `● Online${p.where ? ` · ${p.where}` : ''}` : '○ Offline'}</span>
          {since && <span> · Member since {since}</span>}
          {p.skills && <span> · 🧭 Total level {p.skills.total}</span>}
        </div>
        <button type="button" className="mt-1 rounded bg-white/10 px-2 py-0.5 text-xs hover:bg-white/20" onClick={() => openFactoryView(p.name)} data-testid="profile-view-factory">🏭 View factory</button>
        <VisitHomeButtons player={p.name} close={close} />
      </div>
      <button type="button" aria-label="Close" className="rounded-full px-2 text-lg opacity-70 hover:opacity-100" onClick={close} data-testid="player-profile-close">×</button>
    </div>
    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
      <div className="rounded-xl bg-white/5 p-2"><div className="text-[10px] uppercase opacity-60">Chips</div><div className="font-bold tabular-nums" data-testid="player-profile-chips">🪙 {p.chips == null ? '—' : n(p.chips)}</div></div>
      <div className="rounded-xl bg-white/5 p-2"><div className="text-[10px] uppercase opacity-60">Assets</div><div className="font-bold tabular-nums">{n(p.assets)}</div></div>
      <div className="rounded-xl bg-[#e8c26a]/15 p-2 text-[#e8c26a]"><div className="text-[10px] uppercase opacity-80">Net worth</div><div className="font-bold tabular-nums" data-testid="player-profile-networth">{n(p.netWorth)}</div></div>
    </div>
    {p.history && <Section title="📈 Net worth over time" testid="profile-networth-chart"><NetWorthChart h={p.history} now={Date.now()} current={p.netWorth} /></Section>}
    {p.dividends != null && p.dividends > 0 && <div className="mt-2 rounded-xl bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200" data-testid="profile-dividends">💰 Total dividends earned: <b className="tabular-nums">🪙 {n(p.dividends)}</b></div>}
    {p.houseRoom && <div className="mt-2 rounded-xl bg-white/5 px-2 py-1 text-xs" data-testid="profile-house-room"><span className="opacity-75">🏦 House sell room left today:</span> <b className="tabular-nums">🪙 {n(p.houseRoom.left)}</b> <span className="opacity-60">of {n(p.houseRoom.cap)} · sold today {n(p.houseRoom.soldToday)} · refunded room +{n(p.houseRoom.refunded)} · resets 6 PM CST</span></div>}
    {p.categories.length > 0 && <div className="mt-2">{p.categories.map((c) => <Line key={c.key} left={<span className="opacity-75">{c.label}</span>} right={n(c.value)} />)}</div>}
    <Section title={`🏠 Property & land (${p.properties.length})`} testid="profile-properties">
      {p.properties.length ? p.properties.map((x) => <Line key={x.id} left={<>{x.label}<MapBtn s={x} close={close} /></>} right={n(x.value)} />) : <None t="No property." />}
    </Section>
    <Section title="🌾 Farms" testid="profile-farms">
      {p.farms.length ? p.farms.map((f) => <div key={f.plot} className="py-0.5 text-sm"><div>{f.label}<MapBtn s={f} close={close} /></div>
        <div className="text-xs opacity-80">{f.crops.map((c) => <span key={c.crop} className="mr-2">{c.emoji} {c.label} ×{c.n}{c.ready ? <span className="text-emerald-300"> ({c.ready} ready)</span> : null}</span>)}</div></div>)
        : <None t="Nothing growing." />}
    </Section>
    <Section title="🚗 Garage" testid="profile-cars">
      {p.cars.length ? p.cars.map((c, i) => <Line key={c.carId + i} left={c.name} right={n(c.value)} />) : <None t="No cars." />}
      {p.trailer && <Line left={`🏕️ Trailer Park · lot #${p.trailer.lot}`} right="" />}
    </Section>
    <Section title="📈 Market holdings" testid="profile-holdings">
      {holdings ? <>
        {p.stocks.map((s) => <Line key={s.ticker} left={<><b>{s.ticker}</b> <span className="opacity-60">{n(s.shares)} sh @ {s.price.toFixed(2)}</span></>} right={n(s.value)} />)}
        {p.funds.map((f) => <Line key={f.fund} left={<>{f.name} <span className="opacity-60">{f.units.toFixed(2)} units</span></>} right={n(f.value)} />)}
        {p.options.map((o, i) => <Line key={`o${i}`} left={<>{o.ticker} {o.kind} {o.strike} <span className="opacity-60">×{o.qty}</span></>} right={n(o.value)} />)}
        {p.shorts.map((s, i) => <Line key={`s${i}`} left={<>Short {s.ticker} <span className="opacity-60">{n(s.shares)} sh</span></>} right={n(s.value)} />)}
      </> : <None t="No stocks, funds or options." />}
    </Section>
    <Section title={`🎨 Skins & inventory (${p.skins.total} skins · ${p.skins.cases} cases · ${p.skins.keys} keys)`} testid="profile-skins">
      {p.skins.highlights.length ? <div className="flex flex-wrap gap-1">{p.skins.highlights.map((s, i) => <span key={i} className="rounded-lg border px-2 py-0.5 text-xs" style={{ borderColor: RARITY[s.rarity] ?? '#666', background: `${s.color}22` }} title={`${s.rarity}${s.equipped ? ' · equipped' : ''}`}>{s.name} <span className="opacity-60">{s.weapon}</span></span>)}</div> : <None t="No skins yet." />}
    </Section>
    <Section title="🎣 Biggest fish" testid="profile-fish">
      {p.biggestFish ? <Line left={`${p.biggestFish.emoji} ${p.biggestFish.label}`} right={`${(p.biggestFish.grams / 1000).toFixed(2)} kg`} /> : <None t="No catches yet." />}
    </Section>
    {p.skills && <Section title={`🧭 Skills · total level ${p.skills.total} · ${p.skills.title}`} testid="profile-skills-grid"><SkillGrid profile={p.skills} compact /></Section>}
  </>;
}

/** Mounted once in App: opens on the `open-player` event or any click on a `[data-player]` element. Esc / backdrop close. */
export default function PlayerProfile() {
  const dragProfile = usePanelDrag('profile');
  const [name, setName] = useState<string | null>(null);
  const [p, setP] = useState<PublicProfile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<string>).detail; if (typeof d === 'string' && d.trim()) setName(d.trim()); };
    const click = (e: MouseEvent) => { const el = (e.target as HTMLElement | null)?.closest?.('[data-player]') as HTMLElement | null; const v = el?.dataset.player; if (v) { e.preventDefault(); e.stopPropagation(); setName(v); } };
    window.addEventListener('open-player', on); document.addEventListener('click', click, true);
    return () => { window.removeEventListener('open-player', on); document.removeEventListener('click', click, true); };
  }, []);
  useEffect(() => {
    if (!name) return;
    let dead = false; setP(null); setErr(null);
    let session: string | undefined; try { session = (JSON.parse(localStorage.getItem('relay-auth-v1') ?? 'null') as { token?: string } | null)?.token; } catch { /* none */ }
    fetch(`/api/player/${encodeURIComponent(name)}`, { headers: session ? { 'x-relay-session': session } : {} })
      .then(async (r) => { const j = await r.json().catch(() => ({})) as { profile?: PublicProfile; error?: string }; if (dead) return; if (r.ok && j.profile) setP(j.profile); else setErr(j.error ?? `Couldn't load ${name}.`); })
      .catch(() => { if (!dead) setErr('Network error — try again.'); });
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setName(null); } };
    window.addEventListener('keydown', key, true);
    return () => { dead = true; window.removeEventListener('keydown', key, true); };
  }, [name]);
  if (!name) return null;
  const close = () => setName(null);
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" {...backdropDismiss(close)} data-testid="player-profile">
      <div role="dialog" aria-label={`${name}'s profile`} className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/15 bg-[#1b1d2e] p-5 text-cream shadow-2xl" data-drag-panel="profile" onPointerDown={dragProfile.onPointerDown} style={dragProfile.style()} ref={dragProfile.ref}>{dragProfile.handle}
        {p ? <PlayerProfileView p={p} close={close} />
          : <div className="flex items-center justify-between"><span className="text-sm opacity-70">{err ?? `Loading ${name}…`}</span><button type="button" aria-label="Close" className="px-2 text-lg opacity-70" onClick={close}>×</button></div>}
      </div>
    </div>, document.body);
}
