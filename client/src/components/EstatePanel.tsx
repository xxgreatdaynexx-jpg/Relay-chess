import { useEffect, useState } from 'react';
import { usePanelDrag } from '@/lib/panelDrag';
import { request } from '@/lib/net';
import { DEMOLISH_RULES, ESTATE_BUILD_ORDER, ESTATE_BUILDS, type EstateBuildId } from '../../../shared/estateProjects';
import { PLASTICS_RECIPES } from '../../../shared/plasticsPlant';
import { RIG_STAGES } from '../../../shared/offshoreRig';
import { HYPER_STAGES } from '../../../shared/hyperFarm';

type SiteView = {
  lotId: string; build: EstateBuildId | null; stage: number; complete: boolean; gear: number; kind: string;
  was?: { type: string; label: string };
  plan?: { name: string; icon: string; blurb: string; total: number };
  stages?: Array<{ id: string; name: string; chips: number; goods: Array<{ id: string; name: string; qty: number }>; done: Record<string, number>; pct: number }>;
  gearDef?: { name: string; icon: string; price: number; mw: number; chipsPerHour: number; max: number; install?: Array<{ id: string; qty: number; name: string }> };
};

type PowerView = {
  gridMw: number; gridPrice: number; plantMw: number; demand: number; supply: number; throttle: number;
  cap: number; paidToday: number; gridOff?: boolean; gridBill?: number; coalPerDay?: number; fuelUntil?: number; fuelDay?: number;
};

const chips = (n: number) => n.toLocaleString('en-US');

export function EstatePanel({ lotId, me, mine = false, kind, onClose }: { lotId?: string; me: string | null; mine?: boolean; kind?: 'estate' | 'plastics' | 'rigdock' | 'hyper'; onClose: () => void }) {
  const [view, setView] = useState<Record<string, unknown> | null>(null);
  const [msg, setMsg] = useState('');
  const drag = usePanelDrag('estate');
  const load = () => { void request('estate_view', {}).then((r) => { if (r && (r as { ok?: boolean }).ok !== false) setView(r as unknown as Record<string, unknown>); }); };
  useEffect(() => { load(); }, []);
  const call = async (ev: string, body: Record<string, unknown>) => {
    const r = await request(ev, body) as { ok?: boolean; error?: string };
    if (r && r.ok === false) { setMsg(r.error ?? 'That did not work.'); return; }
    setMsg(''); load();
  };
  const sites = (view?.sites as SiteView[] | undefined) ?? [];
  const site = lotId ? sites.find((s) => s.lotId === lotId) : sites[0];
  const power = view?.power as PowerView | undefined;
  const canBuild = !!me && mine;
  const heading = kind === 'plastics' ? '🧴 Plastics Plant' : kind === 'rigdock' ? '🛢️ Shore Construction Dock' : kind === 'hyper' ? '🌿 Hyper farm' : site?.plan ? `${site.plan.icon} ${site.plan.name}` : '🏗️ Private works';
  const gearRate = site?.complete && site.gearDef ? site.gear * site.gearDef.chipsPerHour : 0;
  return (
    <div className="hub-win sol-panel estate-panel" data-testid="estate-panel" data-drag-panel="estate" ref={drag.ref} style={drag.style()} onPointerDown={drag.onPointerDown}>
      <div className="hub-win-bar">{drag.handle}<b>{heading}</b><button type="button" onClick={onClose} aria-label="Close">✕</button></div>
      <div className="estate-sticky" data-testid="estate-sticky">
        {site?.plan && (
          <p className="estate-sticky-line">
            Stage {Math.min(site.stage + (site.complete ? 0 : 1), site.stages?.length ?? 4)} of {site.stages?.length ?? 4}{site.complete ? ' · complete' : ''}
            {site.complete && site.gearDef ? ` · ${site.gear} / ${site.gearDef.max} ${site.gearDef.name}s · 🪙 ${chips(gearRate)}/h` : ''}
          </p>
        )}
        {power?.gridOff && (
          <div className="estate-grid-off" data-testid="estate-grid-off" role="alert">
            <p>⚠️ Utility power is shut off. Unpaid bill: 🪙 {chips(power.gridBill ?? 0)}. Data centers and bitcoin farms have no grid power — and no digital income from the grid — until this is paid. A fueled power plant still runs.</p>
            {canBuild && <button type="button" data-testid="estate-grid-restore" onClick={() => void call('estate_grid_restore', {})}>Pay bill & restore power</button>}
          </div>
        )}
        {msg && <p className="estate-msg" data-testid="estate-msg">{msg}</p>}
        {!mine && (!kind || kind === 'estate') && <p className="estate-msg">Only the owner can build on this lot.</p>}
      </div>
      <div className="hub-win-body">
        {kind === 'plastics' && (
          <div>
            <p>Import Fort McChud naphtha, ethylene or plastics, then make resin, computers and graphics cards for private works and furniture. Recipes consume and produce real warehouse items.</p>
            <ul className="prestige-list">
              {PLASTICS_RECIPES.map((r) => (
                <li key={r.id}><div><b>{r.name}</b><small>{r.in.map(([id, n]) => `${n} ${id}`).join(' · ')} → {r.out[1]} {r.out[0]}</small></div>
                  <button type="button" disabled={!me} onClick={() => void call('plastics_craft', { recipe: r.id, qty: 1 })}>Craft</button></li>
              ))}
            </ul>
          </div>
        )}
        {kind === 'rigdock' && (
          <div>
            <p>Build a rig on the dock in four stages, then launch it. Launched rigs pump crude to your Fort McChud tanks.</p>
            <ol>{RIG_STAGES.map((s) => <li key={s.id}>{s.name} · 🪙 {chips(s.chips)}</li>)}</ol>
            <button type="button" disabled={!me} onClick={() => void call('estate_rig_start', {})}>Start a new rig</button>
            <ul className="prestige-list">
              {((view?.rigs as Array<{ id: string; label: string; status: string }>) ?? []).map((r) => (
                <li key={r.id}><div><b>{r.label}</b><small>{r.status}</small></div>
                  {r.status === 'ready' && <button type="button" onClick={() => void call('estate_rig_launch', { id: r.id })}>Launch</button>}
                  {r.status === 'building' && <button type="button" onClick={() => void call('estate_rig_contribute', { id: r.id, part: 'chips', qty: 10_000 })}>Add 10,000 chips</button>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {kind === 'hyper' && lotId && (
          <div>
            <p>Convert this farm into a Dutch glasshouse. Flowers and other difficult crops unlock when it is finished.</p>
            <ol>{HYPER_STAGES.map((s) => <li key={s.id}>{s.name} · 🪙 {chips(s.chips)}</li>)}</ol>
            <button type="button" disabled={!canBuild} onClick={() => void call('estate_hyper_start', { plotId: lotId })}>Start conversion</button>
            <button type="button" disabled={!canBuild} onClick={() => void call('estate_hyper_contribute', { plotId: lotId, part: 'chips', qty: 10_000 })}>Add 10,000 chips</button>
          </div>
        )}
        {lotId?.startsWith('winery:') && (
          <div className="estate-power" data-testid="estate-wine-press">
            <h3>🍷 Winery press</h3>
            <p>Grapes from your warehouse or pantry press to wine 1:1. The city cannery still needs two grapes per bottle.</p>
            <button type="button" disabled={!canBuild} onClick={() => void call('estate_wine_press', { qty: 1 })}>Press 1 grape</button>
          </div>
        )}
        {(!kind || kind === 'estate') && (
          <div>
            {site?.was && <p>This lot was {site.was.label}. It is now a private construction site.</p>}
            {!site?.build && (
              <div>
                <p>Choose what to build. Each project has four stages, with a model at every step.</p>
                <ul className="prestige-list" data-testid="estate-build-list">
                  {ESTATE_BUILD_ORDER.map((id) => {
                    const b = ESTATE_BUILDS[id];
                    return <li key={id}><div><b>{b.icon} {b.name}</b><small>{b.blurb} · 🪙 {chips(b.total)}</small></div>
                      <button type="button" disabled={!canBuild || !lotId} data-testid={`estate-build-${id}`} onClick={() => void call('estate_choose', { lotId, build: id })}>Build</button></li>;
                  })}
                </ul>
              </div>
            )}
            {site?.plan && (
              <div>
                <p>{site.plan.blurb}</p>
                <p>Catalog total 🪙 {chips(site.plan.total)}.</p>
                <ul>{(site.stages ?? []).map((s, i) => (
                  <li key={s.id}><b>{s.name}</b> — {Math.round((s.pct ?? 0) * 100)}%
                    {canBuild && i === site.stage && !site.complete && <button type="button" onClick={() => void call('estate_contribute', { lotId: site.lotId, part: 'chips', qty: 10_000 })}>Add 10,000 chips</button>}
                  </li>
                ))}</ul>
                {site.complete && site.gearDef && (
                  <p>
                    {site.gearDef.icon} {site.gear} / {site.gearDef.max} {site.gearDef.name}s · {site.gearDef.mw} MW each · 🪙 {chips(site.gearDef.chipsPerHour)}/h each · 🪙 {chips(site.gearDef.price)}
                    {site.gearDef.install && site.gearDef.install.length > 0 && (
                      <small> Install uses {site.gearDef.install.map((g) => `${g.qty} ${g.name}`).join(' + ')} from the warehouse.</small>
                    )}
                    {canBuild && <button type="button" onClick={() => void call('estate_gear', { lotId: site.lotId, qty: 1 })}>Install one</button>}
                  </p>
                )}
              </div>
            )}
            {power && (
              <div className="estate-power" data-testid="estate-power">
                <h3>⚡ Power</h3>
                {power.gridOff && <p data-testid="estate-power-cut"><strong>Grid is off.</strong> Digital output that needs the utility has stopped until the bill is paid.</p>}
                <p>Utility contract {power.gridMw} MW at 🪙 {chips(power.gridPrice)}/MW/day{power.gridOff ? ' (shut off)' : ''}. Plant {power.plantMw} MW{power.plantMw > 0 ? ` · ${chips(power.coalPerDay ?? 0)} coal/day or 🪙 ${chips(power.fuelDay ?? 0)} fuel contract` : ''}. Demand {power.demand} MW. Supply {power.supply} MW. Throttle {Math.round(power.throttle * 100)}%.</p>
                <p>Digital income today 🪙 {chips(power.paidToday)} / {chips(power.cap)} cap{gearRate ? ` · this site 🪙 ${chips(gearRate)}/h at full power` : ''}.</p>
                {canBuild && <button type="button" onClick={() => void call('estate_grid', { mw: (power.gridMw || 0) + 10 })}>Buy +10 MW utility</button>}
              </div>
            )}
            {lotId && canBuild && (
              <div className="estate-demolish">
                <h3>Demolish</h3>
                <p>{DEMOLISH_RULES}</p>
                <button type="button" data-testid="estate-demolish" onClick={() => { if (confirm('Demolish this structure and turn the lot into a construction site?\n\n' + DEMOLISH_RULES)) void call('estate_demolish', { id: lotId, confirm: true }); }}>Demolish…</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
