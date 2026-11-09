import { useCallback, useEffect, useState } from 'react';
import { request } from '@/lib/net';
import { RIOT_STOP_COST, PROJECTS, LEVERS, LEVER_IDS, POLICIES, POLICY_IDS, BUILDINGS, MAX_STAGE, leverText, perkOf, stageAt, underConstruction, RECALL_FEE, type LeverId, type CityView } from '../../../shared/city';

import { abWhen } from './CityHallPanel';

const chips = (n: number) => Math.round(n).toLocaleString('en-US');
const left = (ms: number) => { const m = Math.max(0, Math.round(ms / 60_000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
const pctOf = (n: number) => `${Math.round(n * 100)}%`;

/** City Hall phase 2: treasury, mayor's levers / policies / buildings, approval, recall and the public action log. */
export function CityCivic({ initial }: { initial?: CityView }) {
  const [v, setV] = useState<CityView | null>(initial ?? null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Record<LeverId, number>>>({});
  const load = useCallback(() => { if (initial) return; void request('city_view').then((a) => { const r = a as { city?: CityView }; if (r.city) setV(r.city); }); }, [initial]);
  useEffect(() => { load(); const t = window.setInterval(load, 30_000); return () => window.clearInterval(t); }, [load]);
  const act = async (ev: string, data: object, ok: string) => {
    if (busy) return; setBusy(true); setMsg(null); const r = await request(ev, data) as { ok: boolean; error?: string; city?: CityView };
    setBusy(false); if (r.city) setV(r.city); setMsg(r.ok ? ok : r.error ?? 'Something went wrong.'); if (r.ok) window.dispatchEvent(new Event('city-changed'));
  };
  if (!v) return null;
  const me = v.me; const mayor = !!me?.isMayor; const now = v.now; const building = v.buildings.find((b) => underConstruction(b, now));
  const a = v.approval; const votes = a.up + a.down;
  return (
    <div className="cityhall-civic" data-testid="city-civic">
      <h4>🏦 City treasury</h4>
      <div className="cityhall-rates" data-testid="city-treasury">
        <div><small>Balance</small><b>🪙 {chips(v.treasury.balance)}</b><small>public funds</small></div>
        <div><small>In (7 days)</small><b>+{chips(v.treasury.in7d)}</b><small>25% of taxes & fees</small></div>
        <div><small>Spent (7 days)</small><b>−{chips(v.treasury.out7d)}</b><small>policies, projects & buildings</small></div>
      </div>
      <ul className="cityhall-log city-ledger" data-testid="city-ledger">
        {!v.treasury.ledger.length && <li><small>No treasury activity yet.</small></li>}
        {v.treasury.ledger.slice(0, 12).map((t) => <li key={t.id}><small>{abWhen(t.at)}</small> <b className={t.amount > 0 ? 'text-emerald-300' : 'text-amber-300'}>{t.amount > 0 ? '+' : '−'}{chips(Math.abs(t.amount))}</b> {t.memo} <small>(→ {chips(t.balance)})</small></li>)}
      </ul>
      <small className="cityhall-rules">Treasury money can only fund city policies, projects and buildings. It can never be paid out to a player, the mayor included.</small>

      <h4>🎚️ City levers</h4>
      <ul className="cityhall-list city-levers">
        {LEVER_IDS.map((id) => { const L = LEVERS[id]; const cur = v.levers[id]; const val = draft[id] ?? cur.value; const wait = cur.nextChangeAt > now;
          return (<li key={id} data-testid={`city-lever-${id}`}>
            <div><b>{L.label}: {leverText(id, cur.value)}</b><small>{L.blurb}</small>
              {mayor && <label className="cityhall-rate"><span>New: <b>{leverText(id, val)}</b> <small>({leverText(id, L.min)}–{leverText(id, L.max)})</small></span>
                <input type="range" min={L.min} max={L.max} step={L.step} value={val} disabled={busy || wait} onChange={(e) => setDraft((d) => ({ ...d, [id]: Number(e.target.value) }))} /></label>}
              {mayor && wait && <small className="text-amber-300">Can change again {abWhen(cur.nextChangeAt)}</small>}
            </div>
            {mayor && <button type="button" disabled={busy || wait || val === cur.value} onClick={() => act('city_lever', { lever: id, value: val }, `${L.label} set to ${leverText(id, val)}.`)}>Set</button>}
          </li>); })}
      </ul>
      {v.funding && <div className="city-funding" data-testid="city-funding">
        <h4>📊 City funding · {v.funding.label}</h4>
        <small>{v.funding.blurb}</small>
        <div className="cityhall-rates" data-testid="city-funding-muls">
          <div><small>Policy / project cost</small><b>{v.funding.costMul === 1 ? 'normal' : `${v.funding.costMul > 1 ? '+' : ''}${Math.round((v.funding.costMul - 1) * 100)}%`}</b></div>
          <div><small>Civic build time</small><b>{v.funding.buildMul === 1 ? 'normal' : `${v.funding.buildMul > 1 ? '+' : ''}${Math.round((v.funding.buildMul - 1) * 100)}%`}</b></div>
          <div><small>Festival / road repair</small><b>{v.funding.boostMul === 1 ? 'normal' : `${v.funding.boostMul > 1 ? '+' : ''}${Math.round((v.funding.boostMul - 1) * 100)}%`}</b></div>
        </div>
        <small className="cityhall-rules">Moves with the levers above (vs each default). Low taxes → thinner services; higher taxes → cheaper projects and stronger festivals. No retroactive charges. Freight still can’t go below the default.</small>
      </div>}

      <h4>📣 Policies</h4>
      {v.policy ? <small data-testid="city-policy-live">{POLICIES[v.policy.id].icon} <b>{POLICIES[v.policy.id].label}</b> is on until {abWhen(v.policy.endsAt)} ({left(v.policy.endsAt - now)} left)</small>
        : v.nextPolicyAt > now ? <small>Next policy possible {abWhen(v.nextPolicyAt)}</small> : <small>No policy running.</small>}
      <ul className="cityhall-list">
        {POLICY_IDS.map((id) => { const p = POLICIES[id]; const cost = Math.round(p.cost * v.index * (v.funding?.costMul ?? 1));
          return (<li key={id}><div><b>{p.icon} {p.label}</b><small>{p.blurb} · 🪙 {chips(cost)} from the treasury</small></div>
            {mayor && <button type="button" disabled={busy || !!v.policy || v.nextPolicyAt > now || v.treasury.balance < cost} onClick={() => act('city_policy', { policy: id }, `${p.label} is on for 24 h.`)}>Start</button>}</li>); })}
      </ul>

      {v.riot && <div data-testid="city-riot">
        <h4>🔥 City riot</h4>
        {v.riot.active ? <small>Protesters, signs, fires and riot police are out in the city (just for show). The mayor can end it for good for 🪙 {chips(RIOT_STOP_COST)} from the treasury.</small>
          : <small data-testid="city-riot-ended">The riot is over{v.riot.by ? `: Mayor ${v.riot.by} paid 🪙 ${chips(v.riot.cost)}` : ''}{v.riot.resolvedAt ? ` (${abWhen(v.riot.resolvedAt)})` : ''}. It stays over.</small>}
        {mayor && v.riot.active && <button type="button" data-testid="city-riot-stop" disabled={busy || v.treasury.balance < RIOT_STOP_COST}
          onClick={() => { if (window.confirm(`End the city riot?\n\nCost: 🪙 ${chips(RIOT_STOP_COST)} from the city treasury (no player is paid).\nProtesters, signs, fires and riot police leave for good.\n\nThis is shown in the public treasury ledger.`)) void act('city_riot_stop', { requestId: crypto.randomUUID() }, 'The riot is over.'); }}>Stop the riot 🪙 {chips(RIOT_STOP_COST)}</button>}
      </div>}

      <h4>🧰 Treasury projects</h4>
      <small>Short city-wide boosts paid from the treasury. Everyone gets the same effect; nothing is paid to any player, the mayor included.</small>
      <ul className="cityhall-list city-projects" data-testid="city-projects">
        {(v.projects ?? []).map((pr) => { const sp = PROJECTS[pr.id]; const cd = Math.round(sp.cooldownMs / 3_600_000); const wait = !pr.active && pr.nextAt > now;
          return (<li key={pr.id} data-testid={`city-project-${pr.id}`}><div><b>{sp.icon} {sp.label}</b>
            <small>{sp.blurb} · Cost 🪙 {chips(pr.cost)} · {Math.round(sp.durationMs / 3_600_000)} h · then {cd} h cooldown{pr.headroom < sp.boost ? ` · adds +${pctOf(pr.headroom)} now` : ''}</small>
            {pr.active && <small className="text-emerald-300">On until {abWhen(pr.active.endsAt)} ({left(pr.active.endsAt - now)} left) · started by {pr.active.by}</small>}
            {wait && <small>Can run again {abWhen(pr.nextAt)}</small>}</div>
            {mayor && <button type="button" data-testid={`city-project-start-${pr.id}`} disabled={busy || !!pr.active || wait || pr.headroom <= 0 || v.treasury.balance < pr.cost}
              onClick={() => { if (window.confirm(`Start ${sp.label}?\n\nCost: 🪙 ${chips(pr.cost)} from the city treasury\nEffect: +${pctOf(pr.headroom)} ${sp.perk === 'xp' ? 'skill XP' : 'truck speed'} for everyone\nDuration: ${Math.round(sp.durationMs / 3_600_000)} h, then ${cd} h cooldown\n\nThis is shown in the public treasury ledger.`)) void act('city_project', { project: pr.id, requestId: crypto.randomUUID() }, `${sp.label} started.`); }}>Start 🪙 {chips(pr.cost)}</button>}
          </li>); })}
      </ul>

      <h4>🏗️ City buildings</h4>
      <small>One project at a time. Each stage is visible in the civic district west of downtown.</small>
      <ul className="cityhall-list city-buildings" data-testid="city-buildings">
        {v.buildings.map((b) => { const sp = BUILDINGS[b.id]; const st = stageAt(b, now); const bu = underConstruction(b, now);
          return (<li key={b.id} data-testid={`city-building-${b.id}`}>
            <div><b>{sp.icon} {sp.label} <span className="city-stage">{'■'.repeat(st)}{'□'.repeat(MAX_STAGE - st)}</span></b>
              <small>{st ? `Now: −${pctOf(perkOf(b.id, st))} · ` : ''}{sp.perkText}{st < MAX_STAGE ? ` · next stage ${pctOf(perkOf(b.id, st + 1))}` : ' · fully built'}</small>
              {bu && b.building && <small className="text-amber-300">🚧 Stage {b.building.stage} ready {abWhen(b.building.doneAt)} ({left(b.building.doneAt - now)})</small>}</div>
            {mayor && b.nextCost != null && <button type="button" disabled={busy || !!building || v.treasury.balance < b.nextCost} onClick={() => act('city_build', { building: b.id }, `Construction started on ${sp.label}.`)}>Build 🪙 {chips(b.nextCost)}</button>}
          </li>); })}
      </ul>

      <h4>👍 Approval</h4>
      <div className="city-approval" data-testid="city-approval">
        <b>{a.rating == null ? `Not enough ratings yet (${votes}/10)` : `${pctOf(a.rating)} approve`}</b> <small>{a.up} 👍 · {a.down} 👎 this term</small>
        {me && !me.excluded && !mayor && <span>{me.ratedToday ? <small>You rated today.</small> : <>
          <button type="button" disabled={busy} onClick={() => act('city_rate', { up: 'up' }, 'Thanks — rating counted.')}>👍</button>
          <button type="button" disabled={busy} onClick={() => act('city_rate', { up: 'down' }, 'Thanks — rating counted.')}>👎</button></>}</span>}
      </div>

      <h4>🗳️ Recall</h4>
      {v.recall && !v.recall.result ? (
        <div className="city-recall" data-testid="city-recall">
          <b>Recall vote open · ends {abWhen(v.recall.endsAt)}</b><small>{v.recall.yes} yes · {v.recall.no} no · needs {v.recall.needed} votes and 60% yes. If it passes, the runner-up takes over.</small>
          {me && !me.excluded && !mayor && !me.votedRecall && <span>
            <button type="button" disabled={busy} onClick={() => act('city_recall_vote', { yes: 'yes' }, 'Vote counted.')}>Recall</button>
            <button type="button" disabled={busy} onClick={() => act('city_recall_vote', { yes: 'no' }, 'Vote counted.')}>Keep</button></span>}
        </div>
      ) : (<div className="city-recall">
        {v.recall?.result && <small>Last recall {v.recall.result} ({v.recall.yes} yes / {v.recall.no} no).</small>}
        <small>Any player can open one recall per term after 48 h if approval is under 35% from 20+ raters. Costs 🪙 {chips(RECALL_FEE)} (to the treasury).</small>
        {me && !me.excluded && !mayor && <button type="button" disabled={busy || !me.canRecall} onClick={() => act('city_recall', {}, 'Recall vote opened for 24 h.')}>Open recall</button>}
        {me?.recallReason && <small className="text-amber-300">{me.recallReason}</small>}
      </div>)}
      {me?.excluded && <small className="text-amber-300">Test, guest, bot and jailed accounts can't take part in city politics.</small>}

      <h4>📜 Mayor's public log</h4>
      <ul className="cityhall-log" data-testid="city-actions">
        {!v.actions.length && <li><small>No mayor actions yet.</small></li>}
        {v.actions.slice(0, 15).map((x) => <li key={x.id}><small>{abWhen(x.at)}</small> <b>{x.by}</b>: {x.text}</li>)}
      </ul>
      {msg && <small role="status" data-testid="city-msg">{msg}</small>}
    </div>
  );
}
