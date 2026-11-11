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
  gearDef?: { name: string; icon: string; price: number; mw: number; chipsPerHour: number; max: number };
};

export function EstatePanel({ lotId, me, kind, onClose }: { lotId?: string; me: string | null; kind?: 'estate' | 'plastics' | 'rigdock' | 'hyper'; onClose: () => void }) {
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
  const power = view?.power as { gridMw: number; gridPrice: number; plantMw: number; demand: number; supply: number; throttle: number; cap: number; paidToday: number } | undefined;
  return (
    <div className="hub-win sol-panel estate-panel" data-testid="estate-panel" data-drag-panel="estate" ref={drag.ref} style={drag.style()} onPointerDown={drag.onPointerDown}>
      <div className="hub-win-bar">{drag.handle}<b>{kind === 'plastics' ? '🧴 Plastics Plant' : kind === 'rigdock' ? '🛢️ Shore Construction Dock' : kind === 'hyper' ? '🌿 Hyper farm' : '🏗️ Private works'}</b><button type="button" onClick={onClose} aria-label="Close">✕</button></div>
      <div className="hub-win-body">
        {msg && <p className="estate-msg" data-testid="estate-msg">{msg}</p>}
        {kind === 'plastics' && (
          <div>
            <p>Import Fort McChud naphtha, ethylene or plastics, then make resin, computers and graphics cards for private works and furniture.</p>
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
            <ol>{RIG_STAGES.map((s) => <li key={s.id}>{s.name} · 🪙 {s.chips.toLocaleString('en-US')}</li>)}</ol>
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
            <ol>{HYPER_STAGES.map((s) => <li key={s.id}>{s.name} · 🪙 {s.chips.toLocaleString('en-US')}</li>)}</ol>
            <button type="button" disabled={!me} onClick={() => void call('estate_hyper_start', { plotId: lotId })}>Start conversion</button>
            <button type="button" disabled={!me} onClick={() => void call('estate_hyper_contribute', { plotId: lotId, part: 'chips', qty: 10_000 })}>Add 10,000 chips</button>
          </div>
        )}
        {lotId?.startsWith('winery:') && (
          <div className="estate-power" data-testid="estate-wine-press">
            <h3>🍷 Winery press</h3>
            <p>Grapes grown here press to wine 1:1. The city cannery still needs two grapes per bottle.</p>
            <button type="button" disabled={!me} onClick={() => void call('estate_wine_press', { qty: 1 })}>Press 1 grape</button>
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
                    return <li key={id}><div><b>{b.icon} {b.name}</b><small>{b.blurb}</small></div>
                      <button type="button" disabled={!me || !lotId} onClick={() => void call('estate_choose', { lotId, build: id })}>Build</button></li>;
                  })}
                </ul>
              </div>
            )}
            {site?.plan && (
              <div>
                <h3>{site.plan.icon} {site.plan.name}</h3>
                <p>{site.plan.blurb}</p>
                <p>Stage {Math.min(site.stage + 1, site.stages?.length ?? 4)} of {site.stages?.length ?? 4}{site.complete ? ' · complete' : ''}</p>
                <ul>{(site.stages ?? []).map((s, i) => (
                  <li key={s.id}><b>{s.name}</b> — {Math.round((s.pct ?? 0) * 100)}%
                    {i === site.stage && !site.complete && <button type="button" onClick={() => void call('estate_contribute', { lotId: site.lotId, part: 'chips', qty: 10_000 })}>Add 10,000 chips</button>}
                  </li>
                ))}</ul>
                {site.complete && site.gearDef && (
                  <p>
                    {site.gearDef.icon} {site.gear} / {site.gearDef.max} {site.gearDef.name}s · {site.gearDef.mw} MW each · 🪙 {site.gearDef.price.toLocaleString('en-US')}
                    <button type="button" onClick={() => void call('estate_gear', { lotId: site.lotId, qty: 1 })}>Install one</button>
                  </p>
                )}
              </div>
            )}
            {power && (
              <div className="estate-power" data-testid="estate-power">
                <h3>⚡ Power</h3>
                <p>Utility contract {power.gridMw} MW at 🪙 {power.gridPrice.toLocaleString('en-US')}/MW/day. Plant {power.plantMw} MW. Demand {power.demand} MW. Throttle {Math.round(power.throttle * 100)}%.</p>
                <p>Digital income today 🪙 {power.paidToday.toLocaleString('en-US')} / {power.cap.toLocaleString('en-US')} cap.</p>
                <button type="button" disabled={!me} onClick={() => void call('estate_grid', { mw: (power.gridMw || 0) + 10 })}>Buy +10 MW utility</button>
              </div>
            )}
            {lotId && (
              <div className="estate-demolish">
                <h3>Demolish</h3>
                <p>{DEMOLISH_RULES}</p>
                <button type="button" data-testid="estate-demolish" disabled={!me} onClick={() => { if (confirm('Demolish this structure and turn the lot into a construction site?\n\n' + DEMOLISH_RULES)) void call('estate_demolish', { id: lotId, confirm: true }); }}>Demolish…</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
