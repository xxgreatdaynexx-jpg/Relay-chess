import { useCallback, useEffect, useState } from 'react';
import { request } from '@/lib/net';
import { backdropDismiss } from '@/lib/backdrop';
import { MapSheet } from './MapSheet';
import { GOODS, ORES } from '../../../shared/mines';
import {
  CAMP_PAY, FISH_CATCHES, FISH_COOLDOWN_MS, MARKET_PREMIUM, MILL_CREW_WAGE_X, MILL_RECIPES, PICK_FINDS, RODEO_TABLE, millBatchMs, westSpot,
  type MillRecipeId, type WestActState, type WestSpotId,
} from '../../../shared/westActivities';

const fmt = (n: number) => n.toLocaleString('en-US');
const itemName = (it: { type: string; id: string }) => (it.type === 'ore' ? ORES[it.id as keyof typeof ORES]?.name : GOODS[it.id]?.name) ?? it.id;
const dur = (ms: number) => { const s = Math.ceil(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`; };
type Res = { ok: boolean; error?: string; result?: Record<string, unknown>; state?: WestActState };

/** Live countdown from a server "ready in" value. */
function useCountdown(ms: number | undefined, stamp: unknown) {
  const [left, setLeft] = useState(0);
  useEffect(() => { const end = Date.now() + (ms ?? 0); setLeft(Math.max(0, ms ?? 0)); if (!ms) return; const t = setInterval(() => { const w = Math.max(0, end - Date.now()); setLeft(w); if (!w) clearInterval(t); }, 500); return () => clearInterval(t); }, [ms, stamp]);
  return left;
}
function useNow(on: boolean) { const [now, setNow] = useState(Date.now()); useEffect(() => { if (!on) return; const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, [on]); return now; }

/** One panel for every West Chud activity site (shared/westActivities.ts). */
export function WestChudPanel({ id, onClose }: { id: WestSpotId; onClose: () => void }) {
  const spot = westSpot(id)!;
  const [st, setSt] = useState<WestActState | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => void request('wc_state').then((a) => { const r = a as Res; if (r.state) setSt(r.state); else if (!r.ok) setMsg(r.error ?? 'Could not load.'); }), []);
  useEffect(() => { reload(); }, [reload]);
  const act = async (ev: string, data: unknown, ok: (r: Record<string, unknown>) => string) => {
    setBusy(true); const r = await request(ev, data) as Res; setBusy(false);
    if (r.state) setSt(r.state);
    setMsg(r.ok && r.result ? ok(r.result) : r.error ?? 'That did not work.');
    return r.ok;
  };
  const hex = '#' + spot.color.toString(16).padStart(6, '0');
  const away = st && !st.here ? <p className="west-away"><small>You are away from Chud City. Travel back to take part.</small></p> : null;
  return (
    <div className="world-west" {...backdropDismiss(onClose)} data-testid={`west-panel-${id}`} style={{ ['--c' as string]: hex }}>
      <MapSheet className="west-sheet"><h3>{spot.icon} {spot.label}</h3>
        <p className="west-blurb">{spot.blurb}</p>
        {id === 'w-mill' && <MillBody st={st} busy={busy} act={act} />}
        {id === 'w-pier' && <DrawBody st={st} busy={busy} kind="fish" onGo={() => act('wc_fish', {}, (r) => { const c = r.catch as { emoji: string; label: string; paid: number }; const left = Number(r.left); return `${c.emoji} You land a ${c.label}: 🪙 ${fmt(c.paid)}. ${left ? `${left} cast${left === 1 ? '' : 's'} left today.` : 'That was your last cast today.'}`; })} />}
        {id === 'w-upick' && <DrawBody st={st} busy={busy} kind="pick" onGo={() => act('wc_pick', {}, (r) => { const c = r.find as { emoji: string; label: string; paid: number }; const left = Number(r.left); return `${c.emoji} ${c.label}: 🪙 ${fmt(c.paid)}. ${left ? `${left} basket${left === 1 ? '' : 's'} left today.` : 'That was your last basket today.'}`; })} />}
        {id === 'w-rodeo' && <RodeoBody st={st} busy={busy} act={act} />}
        {id === 'w-camp' && <CampBody st={st} busy={busy} act={act} reload={reload} />}
        {id === 'w-market' && <MarketBody st={st} busy={busy} act={act} />}
        {away}
        {msg && <p className="west-msg" role="status">{msg}</p>}
        <button type="button" className="world-casino-x" onClick={onClose}>Back to the city</button>
      </MapSheet>
    </div>
  );
}
type Act = (ev: string, data: unknown, ok: (r: Record<string, unknown>) => string) => Promise<boolean>;

function MillBody({ st, busy, act }: { st: WestActState | null; busy: boolean; act: Act }) {
  const [rid, setRid] = useState<MillRecipeId>('steel');
  const [qty, setQty] = useState(10);
  const [crew, setCrew] = useState(false);
  const m = st?.mill; const now = useNow(!!m?.jobs.length);
  const r = MILL_RECIPES.find((x) => x.id === rid)!; const rv = m?.recipes.find((x) => x.id === rid);
  const cost = rv ? (rv.fee + (crew ? rv.wage : 0)) * qty : 0;
  const free = m ? m.furnaces - m.jobs.length : 0; const left = m ? m.dailyPours - m.poursToday : 0;
  const ready = m?.jobs.filter((j) => j.doneAt <= now).length ?? 0;
  return (
    <div className="west-mill" data-testid="west-mill">
      <div className="west-furnaces">
        {Array.from({ length: m?.furnaces ?? 2 }, (_, i) => { const j = m?.jobs[i]; const rr = j && MILL_RECIPES.find((x) => x.id === j.recipe);
          const pct = j ? Math.min(100, Math.round(((now - j.startAt) / Math.max(1, j.doneAt - j.startAt)) * 100)) : 0;
          return <div key={i} className={`west-furnace${j ? (j.doneAt <= now ? ' done' : ' hot') : ''}`} data-testid={`west-furnace-${i}`}>
            <b>🔥 Furnace {i + 1}</b>
            {j && rr ? <><span>{rr.icon} {j.qty}× {rr.label}{j.crew ? ' · crew' : ''}</span><div className="west-bar"><i style={{ width: `${pct}%` }} /></div><small>{j.doneAt <= now ? 'Ready to collect' : `${dur(j.doneAt - now)} left`}</small></> : <small>Cold. Load a batch below.</small>}
          </div>; })}
      </div>
      <button type="button" className="west-go" disabled={busy || !ready} onClick={() => void act('wc_mill_collect', {}, (x) => `Collected ${(x.collected as Array<{ type: string; id: string; qty: number }>).map((c) => `${fmt(c.qty)} ${itemName(c)}`).join(', ')} into your warehouse storage.`)} data-testid="west-mill-collect">📦 Collect finished batches{ready ? ` (${ready})` : ''}</button>
      <div className="west-recipes" role="radiogroup" aria-label="Recipe">
        {MILL_RECIPES.map((x) => { const v = m?.recipes.find((y) => y.id === x.id); return (
          <button key={x.id} type="button" role="radio" aria-checked={rid === x.id} className={rid === x.id ? 'on' : ''} onClick={() => setRid(x.id)} data-testid={`west-recipe-${x.id}`}>
            <b>{x.icon} {x.label}</b>
            <span>{x.inputs.map((it) => `${it.qty} ${itemName(it)}`).join(' + ')} → {x.output.qty} {itemName(x.output)}</span>
            <small>{x.secs}s a pour · fee 🪙 {fmt(v?.fee ?? x.fee)} · you can pour {fmt(v?.canPour ?? 0)}</small>
          </button>); })}
      </div>
      <p className="west-small">{r.blurb}</p>
      <label className="west-row">Pours <input type="range" min={1} max={m?.maxBatch ?? 50} value={qty} onChange={(e) => setQty(Number(e.target.value))} data-testid="west-mill-qty" /><b>{qty}</b></label>
      <label className="west-row"><input type="checkbox" checked={crew} onChange={(e) => setCrew(e.target.checked)} data-testid="west-mill-crew" /> Hire the shift crew (wage {MILL_CREW_WAGE_X}× the fee, half the time)</label>
      <p className="west-small">Uses {r.inputs.map((it) => `${fmt(it.qty * qty)} ${itemName(it)}`).join(' + ')} · makes {fmt(r.output.qty * qty)} {itemName(r.output)} · takes {dur(millBatchMs(r, qty, crew))} · costs 🪙 {fmt(cost)}</p>
      <button type="button" className="west-go" disabled={busy || !st?.here || free <= 0 || left < qty || (rv?.canPour ?? 0) < qty} onClick={() => void act('wc_mill_start', { recipe: rid, qty, crew }, (x) => `Furnace lit: ${qty}× ${r.label}, paid 🪙 ${fmt(Number(x.paid))}.`)} data-testid="west-mill-start">
        {free <= 0 ? 'Both furnaces busy' : left < qty ? `Only ${left} pours left today` : (rv?.canPour ?? 0) < qty ? 'Not enough ore in storage' : `🔥 Light the furnace (${qty} pours)`}
      </button>
      <p className="west-small">Today: {fmt(m?.poursToday ?? 0)} / {fmt(m?.dailyPours ?? 200)} pours · 2 furnaces · inputs come from and outputs go to your Chud City Warehouse storage. Sell steel through the warehouse (house daily cap applies) or the market.</p>
    </div>
  );
}

function DrawBody({ st, busy, kind, onGo }: { st: WestActState | null; busy: boolean; kind: 'fish' | 'pick'; onGo: () => void }) {
  const d = kind === 'fish' ? st?.fish : st?.pick; const list = kind === 'fish' ? FISH_CATCHES : PICK_FINDS;
  const wait = useCountdown(d?.readyIn, d); const left = d ? d.max - d.used : 0; const got = kind === 'fish' ? st?.fish.catches : st?.pick.finds;
  return (
    <div className="west-act" data-testid={`west-${kind}`}>
      <ul className="west-list">{list.map((f) => <li key={f.id}><span>{f.emoji} {f.label}</span><b>🪙 {fmt(f.pay)}</b><small>{f.odds}%</small></li>)}</ul>
      {got && got.length > 0 && <p className="west-small">Today: {got.map((f) => f.emoji).join(' ')} · 🪙 {fmt(got.reduce((a, f) => a + f.pay, 0))}</p>}
      <button type="button" className="west-go" disabled={busy || !st || left <= 0 || wait > 0 || !st.here} onClick={onGo} data-testid={`west-${kind}-go`}>
        {left <= 0 && st ? (kind === 'fish' ? 'All casts done today ✓' : 'All baskets picked today ✓') : wait > 0 ? `${kind === 'fish' ? 'Waiting for a bite' : 'Resting'}… ${Math.ceil(wait / 1000)}s` : kind === 'fish' ? `🎣 Cast a line (${left} left)` : `🧺 Pick a basket (${left} left)`}
      </button>
      <p className="west-small">{kind === 'fish' ? `${d?.max ?? 6} casts a day, ${FISH_COOLDOWN_MS / 1000}s apart.` : `${d?.max ?? 3} baskets a day, a minute apart.`} Resets 00:00 UTC.</p>
    </div>
  );
}

function RodeoBody({ st, busy, act }: { st: WestActState | null; busy: boolean; act: Act }) {
  const r = st?.rodeo; const wait = useCountdown(r?.readyIn, r); const left = r ? r.max - r.used : 0;
  return (
    <div className="west-act" data-testid="west-rodeo">
      <ul className="west-list">{RODEO_TABLE.map((t) => <li key={t.secs}><span>{t.secs === 8 ? '🏆 Full 8 seconds' : `⏱️ ${t.secs}s on the bull`}</span><b>🪙 {fmt(t.pay)}</b><small>{t.odds}%</small></li>)}</ul>
      {r && r.rides.length > 0 && <p className="west-small">Today: {r.rides.map((x) => `${x.secs}s`).join(', ')} · 🪙 {fmt(r.rides.reduce((a, x) => a + x.pay, 0))}</p>}
      <button type="button" className="west-go" disabled={busy || !st || left <= 0 || wait > 0 || !st.here} onClick={() => void act('wc_rodeo', {}, (x) => `🤠 ${x.secs} second${Number(x.secs) === 1 ? '' : 's'} on the bull${Number(x.secs) === 8 ? ' — a full ride!' : '.'} 🪙 ${fmt(Number(x.paid))}.`)} data-testid="west-rodeo-go">
        {left <= 0 && st ? 'All rides done today ✓' : wait > 0 ? `Bull's resting… ${Math.ceil(wait / 1000)}s` : `🐂 Climb on (${left} left)`}
      </button>
      <p className="west-small">{r?.max ?? 3} rides a day, 90s apart. Resets 00:00 UTC.</p>
    </div>
  );
}

function CampBody({ st, busy, act, reload }: { st: WestActState | null; busy: boolean; act: Act; reload: () => void }) {
  const c = st?.camp; const [t0, setT0] = useState<number | null>(null); const now = useNow(t0 != null);
  useEffect(() => { if (c?.restingFor != null && t0 == null) setT0(Date.now() - c.restingFor); }, [c, t0]);
  const ms = c?.ms ?? 45_000; const left = t0 != null ? Math.max(0, ms - (now - t0)) : ms;
  useEffect(() => { if (t0 != null && left <= 0) { setT0(null); void act('wc_camp_claim', {}, (x) => Number(x.paid) ? `🏕️ Well rested by the fire: 🪙 ${fmt(Number(x.paid))}.` : '🏕️ A good rest. (Today\'s bonus was already paid.)').then(reload); } }, [left, t0]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="west-act" data-testid="west-camp">
      <p>Pull up a log by the fire for {Math.round(ms / 1000)} seconds. The first rest each day pays 🪙 {fmt(c?.pay ?? CAMP_PAY)}.</p>
      {t0 != null && <div className="west-bar"><i style={{ width: `${Math.round(100 - (left / ms) * 100)}%` }} /></div>}
      <button type="button" className="west-go" disabled={busy || !st || !st.here || t0 != null} onClick={() => void act('wc_camp_start', {}, () => '🔥 You settle in by the campfire…').then((ok) => { if (ok) setT0(Date.now()); })} data-testid="west-camp-go">
        {t0 != null ? `Resting… ${Math.ceil(left / 1000)}s` : c?.claimed ? '🔥 Sit by the fire (bonus claimed today ✓)' : '🔥 Sit by the fire'}
      </button>
    </div>
  );
}

function MarketBody({ st, busy, act }: { st: WestActState | null; busy: boolean; act: Act }) {
  const mk = st?.market; const [sel, setSel] = useState<string>(''); const [qty, setQty] = useState(1);
  const crop = mk?.crops.find((c) => c.id === sel) ?? mk?.crops[0]; const max = Math.min(mk?.maxUnits ?? 10, crop?.have ?? 0); const q = Math.max(1, Math.min(qty, max));
  const left = mk ? mk.max - mk.used : 0;
  return (
    <div className="west-act" data-testid="west-market">
      <p>The stalls pay {Math.round(MARKET_PREMIUM * 100)}% of a crop's listed price for field and orchard crops in your warehouse storage (harvest them into the factory first). {mk?.max ?? 5} sales a day, up to {mk?.maxUnits ?? 10} units each.</p>
      {mk && !mk.crops.length && <p className="west-small">No field or orchard crops in your storage right now.</p>}
      {mk && mk.crops.length > 0 && <ul className="west-list">{mk.crops.map((c) => <li key={c.id} className={crop?.id === c.id ? 'on' : ''} onClick={() => setSel(c.id)}><span>{c.name} · you have {fmt(c.have)}</span><b>🪙 {fmt(c.each)} each</b></li>)}</ul>}
      {crop && <label className="west-row">Units <input type="range" min={1} max={Math.max(1, max)} value={q} onChange={(e) => setQty(Number(e.target.value))} /><b>{q}</b></label>}
      <button type="button" className="west-go" disabled={busy || !st || !st.here || !crop || left <= 0} onClick={() => crop && void act('wc_market_sell', { id: crop.id, qty: q }, (x) => `🧺 Sold ${x.qty} ${crop.name} for 🪙 ${fmt(Number(x.paid))}. ${Number(x.left)} sale${Number(x.left) === 1 ? '' : 's'} left today.`)} data-testid="west-market-sell">
        {left <= 0 && st ? 'All market sales done today ✓' : crop ? `🧺 Sell ${q} ${crop.name} for 🪙 ${fmt(crop.each * q)}` : 'Nothing to sell'}
      </button>
      <p className="west-small">Sales today: {mk?.used ?? 0} / {mk?.max ?? 5}. Resets 00:00 UTC.</p>
    </div>
  );
}
