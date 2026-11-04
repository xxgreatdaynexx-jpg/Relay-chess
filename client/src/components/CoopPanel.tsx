import { useEffect, useState } from 'react';
import { backdropDismiss } from '@/lib/backdrop';
import { request, socket } from '@/lib/net';
import { usePanelDrag } from '@/lib/panelDrag';
import { useDoing } from '@/lib/doing';
import { SELL_BONUS_MAX, sellBonusPct, DONOR_REWARD_CAP, DONOR_REWARD_RATE, CONTRACT_BONUS, CONTRACT_UNIT_MUL, partKey, type CoopView, type ContractView, type ProjectView } from '../../../shared/coop';

type View = CoopView & { contracts: { current: ContractView; past: ContractView[] }; have: Record<string, number>; chips: number | null };
const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');
const pct = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0)}%`;
const nonce = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
const left = (t: number) => { const s = Math.max(0, Math.floor((t - Date.now()) / 1000)); return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`; };

function Bar({ v, testid }: { v: number; testid?: string }) {
  return <div className="coop-bar" data-testid={testid}><div style={{ width: `${Math.min(100, v * 100)}%` }} /><span>{pct(v)}</span></div>;
}

/** Co-op: server megaprojects (Hockey Stadium, then the Fort McChud Bridge) + the Warehouse group-contract board. */
export function CoopPanel({ onClose, me, tab0 = 'project', onChanged, onViewSite }: { onClose: () => void; me: string | null; tab0?: 'project' | 'contracts'; onChanged?: () => void; onViewSite?: () => void }) {
  useDoing('city');
  const drag = usePanelDrag('coop');
  const [v, setV] = useState<View | null>(null); const [tab, setTab] = useState(tab0);
  const [part, setPart] = useState('chips'); const [qty, setQty] = useState(1000); const [dq, setDq] = useState(1000);
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const load = () => { void request('coop_view').then((a) => { if (a.ok) setV(a as unknown as View); }); };
  useEffect(() => { load(); const r = window.setInterval(load, 20_000); socket.on('coop_changed', load); return () => { window.clearInterval(r); socket.off('coop_changed', load); }; }, []);
  const act = async (ev: string, data: unknown, ok: (a: Record<string, unknown>) => string) => {
    setBusy(true); setMsg(null); const a = await request(ev, data); setBusy(false);
    if (a.ok) { setV(a as unknown as View); onChanged?.(); setMsg(ok(a as unknown as Record<string, unknown>)); } else setMsg(`⚠️ ${a.error ?? 'Something went wrong.'}`);
  };
  const p: ProjectView | undefined = v?.projects.find((x) => x.id === v.active) ?? v?.projects[v.projects.length - 1];
  const stage = p && p.state === 'active' ? p.stages[p.stage] : undefined;
  const c = v?.contracts.current;
  return (
    <div className="dealer coop" data-testid="coop-panel" {...backdropDismiss(() => onClose())}>
      <div className="dealer-box" data-drag-panel="coop" onPointerDown={drag.onPointerDown} style={drag.style()} ref={drag.ref}>{drag.handle}
        <header><h3>🤝 Co-op</h3>{v?.chips != null && <span className="dealer-chips">{fmt(v.chips)} chips</span>}<button type="button" onClick={onClose} aria-label="Close" data-testid="coop-close">✕</button></header>
        <nav className="freight-tabs">
          <button type="button" className={tab === 'project' ? 'on' : ''} onClick={() => { setTab('project'); setMsg(null); }} data-testid="coop-tab-project">🏗️ Megaprojects</button>
          <button type="button" className={tab === 'contracts' ? 'on' : ''} onClick={() => { setTab('contracts'); setMsg(null); }} data-testid="coop-tab-contracts">📋 Contract board</button>
        </nav>
        <div className="freight-body coop-body">
          {!v && <p>Loading…</p>}
          {v && tab === 'project' && p && <section data-testid="coop-project">
            <h4>{p.icon} {p.name} {p.state === 'complete' && <span className="coop-done">✅ Built</span>}</h4>
            <Bar v={p.pct} testid="coop-progress" />
            <ol className="coop-stages">{p.stages.map((s, i) => <li key={s.id} className={i < p.stage ? 'done' : i === p.stage && p.state === 'active' ? 'now' : ''}>
              <b>{i < p.stage ? '✅' : i === p.stage && p.state === 'active' ? '🚧' : '🔒'} {s.name}</b> <Bar v={s.pct} />
              {i === p.stage && p.state === 'active' && <ul className="coop-needs">
                <li>🪙 Chips: {fmt(Math.min(s.chips, s.done.chips ?? 0))} / {fmt(s.chips)}</li>
                {s.goods.map((g) => <li key={g.id}>{g.name}: {fmt(Math.min(g.qty, s.done[partKey(g)] ?? 0))} / {fmt(g.qty)}</li>)}
              </ul>}
            </li>)}</ol>
            <p className="coop-perk">🎁 When built: {p.perk}</p>
            {onViewSite && <button type="button" onClick={onViewSite} data-testid="coop-view-site">📍 View the Stadium on the map</button>}
            {p.id === 'stadium' && me && <p className="coop-sellbonus" data-testid="coop-sell-bonus">🏦 Your sell-cap bonus: <b>+{sellBonusPct(v.sellBonus ?? 0)}%</b> <small>(you’ve given {fmt(v.stadiumDonated ?? 0)} 🪙 worth; every Stadium donation permanently raises your daily sell-to-house cap, with diminishing returns up to +{Math.round(SELL_BONUS_MAX * 100)}%)</small></p>}
            {stage && me && <div className="coop-donate" data-testid="coop-donate">
              <select value={part} onChange={(e) => setPart(e.target.value)} data-testid="coop-part">
                <option value="chips">🪙 Chips</option>
                {stage.goods.map((g) => <option key={g.id} value={partKey(g)}>{g.name} (you have {fmt(v.have[partKey(g)] ?? 0)})</option>)}
              </select>
              <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} data-testid="coop-qty" />
              <button type="button" disabled={busy} data-testid="coop-donate-btn" onClick={() => void act('coop_donate', { project: p.id, part, qty, nonce: nonce() }, (a) => { const r = (a as { result: { qty: number; reward: number } }).result; return `🙌 Donated ${fmt(r.qty)}${part === 'chips' ? ' chips' : ''}.${r.reward ? ` Donor reward: +${fmt(r.reward)} 🪙.` : ''}`; })}>Donate</button>
              <small>Donor reward: {Math.round(DONOR_REWARD_RATE * 100)}% of what you give back as chips, up to {fmt(DONOR_REWARD_CAP)} per project{v.me ? ` (you: ${fmt(v.me.rewarded)} so far)` : ''}. Goods count at house price.</small>
            </div>}
            <h4>🏆 Top donors</h4>
            <ol className="coop-board" data-testid="coop-donors">{p.top.length ? p.top.map((d, i) => <li key={d.name}><span>{i + 1}. {d.name}</span><b>{fmt(d.value)} 🪙</b></li>) : <li>No donations yet. Be the first!</li>}</ol>
            <p className="coop-next">{v.projects.map((x) => `${x.icon} ${x.name}: ${x.state === 'complete' ? 'built' : x.state === 'active' ? pct(x.pct) : 'next'}`).join(' · ')}</p>
          </section>}
          {v && tab === 'contracts' && c && <section data-testid="coop-contract">
            <h4>📋 Order {c.id}: {fmt(c.qty)} {c.name}</h4>
            <p>{c.filled ? '✅ Filled! Claim your pay below.' : `⏱ ${left(c.deadline)} left`} · pays {CONTRACT_UNIT_MUL}× house price per unit, +{Math.round(CONTRACT_BONUS * 100)}% bonus if filled in time</p>
            <Bar v={c.delivered / c.qty} testid="coop-contract-progress" />
            <p>{fmt(c.delivered)} / {fmt(c.qty)} delivered · you: {fmt(c.myDelivered)} / {fmt(c.myCap)} (your cap)</p>
            {me && !c.filled && <div className="coop-donate">
              <span>In your Warehouse: {fmt(v.have[`${c.type}:${c.item}`] ?? 0)} {c.name}</span>
              <input type="number" min={1} value={dq} onChange={(e) => setDq(Math.max(1, Math.floor(Number(e.target.value) || 1)))} data-testid="coop-deliver-qty" />
              <button type="button" disabled={busy} data-testid="coop-deliver-btn" onClick={() => void act('coop_deliver', { contract: c.id, qty: dq, nonce: nonce() }, (a) => `🚚 Warehouse truck dispatched with ${fmt((a as { result: { qty: number } }).result.qty)} ${c.name}. Counted toward the order.`)}>🚚 Deliver</button>
            </div>}
            {[c, ...v.contracts.past].filter((x) => x.claimable).map((x) => <div key={x.id} className="coop-claim">
              {x.id}: {fmt(x.claimable!.total)} 🪙{x.claimable!.bonus ? ` (incl. ${fmt(x.claimable!.bonus)} bonus)` : ''}
              <button type="button" disabled={busy || x.claimable!.claimed} data-testid={`coop-claim-${x.id}`} onClick={() => void act('coop_claim', { contract: x.id }, (a) => `💰 Paid ${fmt((a as { result: { total: number } }).result.total)} chips.`)}>{x.claimable!.claimed ? 'Claimed' : 'Claim'}</button>
            </div>)}
            <h4>🚚 Top haulers</h4>
            <ol className="coop-board" data-testid="coop-haulers">{c.top.length ? c.top.map((d, i) => <li key={d.name}><span>{i + 1}. {d.name}</span><b>{fmt(d.qty)}</b></li>) : <li>Nobody has delivered yet.</li>}</ol>
            <small>Each player can deliver up to 25% of an order. Accounts need to be 3+ days old with 2+ hours played. QA, bot and jailed accounts can’t take part.</small>
          </section>}
          {msg && <p className="freight-msg" data-testid="coop-msg">{msg}</p>}
        </div>
      </div>
    </div>
  );
}
