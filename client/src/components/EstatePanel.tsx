import { useEffect, useState } from 'react';
import { MapSheet } from './MapSheet';
import { usePanelDrag } from '@/lib/panelDrag';
import { request } from '@/lib/net';
import { DEMOLISH_RULES, ESTATE_BUILD_ORDER, ESTATE_BUILDS, estateProjectCost, type EstateBuildId } from '../../../shared/estateProjects';
import { PLASTICS_RECIPES } from '../../../shared/plasticsPlant';
import { RIG_CHIP_STEP, RIG_CRUDE_PER_HOUR, RIG_HOLD_CAP, RIG_LAUNCH_FEE, RIG_MAX_PER_PLAYER, RIG_STAGES, rigPct, rigProjectCost, rigStagePct, type RigStatus } from '../../../shared/offshoreRig';
import { HYPER_STAGES, hyperProjectCost } from '../../../shared/hyperFarm';
import { GOODS } from '../../../shared/mines';
import { announceEstateChange } from '@/lib/estateSites';
import { usePriceIndex } from '@/lib/priceIndex';
import { buildCashCharge, type ProjectCashCost } from '../../../shared/buildCosts';

type SiteView = {
  lotId: string; build: EstateBuildId | null; stage: number; complete: boolean; gear: number; kind: string;
  was?: { type: string; label: string };
  plan?: { name: string; icon: string; blurb: string; total: number; cost?: ProjectCashCost };
  stages?: Array<{ id: string; name: string; chips: number; goods: Array<{ id: string; name: string; qty: number }>; done: Record<string, number>; pct: number; parts?: HyperPart[] }>;
  gearDef?: { name: string; icon: string; price: number; mw: number; chipsPerHour: number; max: number; install?: Array<{ id: string; qty: number; name: string }> };
};

type HyperPart = { part: string; name: string; need: number; done: number; price: number; basePrice?: number; have?: number };
type HyperView = { plotId: string; stage: number; complete: boolean; finished?: boolean; pct: number; total?: number; cost?: ProjectCashCost; stages: Array<{ id: string; name: string; pct: number; parts: HyperPart[] }> };
const pctLabel = (v: number) => `${Math.floor(Math.max(0, Math.min(1, v)) * 100)}%`;
const Bar = ({ v, testid }: { v: number; testid?: string }) => <div className="coop-bar" data-testid={testid}><div style={{ width: `${Math.min(100, Math.max(0, v) * 100)}%` }} /><span>{pctLabel(v)}</span></div>;
const priceOf = (id: string) => GOODS[id]?.price ?? 0;

type RigView = {
  id: string; label: string; status: RigStatus; stage: number;
  done?: Array<Record<string, number>>; hold?: number; launchFee?: number; total?: number; cost?: ProjectCashCost;
};
type EstateMsg = { text: string; ok: boolean };

function isRigPayload(r: unknown): r is RigView {
  if (!r || typeof r !== 'object') return false;
  const o = r as Partial<RigView>;
  return typeof o.id === 'string' && typeof o.status === 'string' && Array.isArray(o.done);
}

function patchRigs(v: Record<string, unknown> | null, rig: RigView): Record<string, unknown> {
  const list = [...((v?.rigs as RigView[] | undefined) ?? [])];
  const i = list.findIndex((x) => x.id === rig.id);
  if (i >= 0) list[i] = { ...list[i], ...rig };
  else list.push(rig);
  return { ...(v ?? {}), rigs: list };
}

function partMeta(part: string) {
  if (part === 'chips') return { key: 'chips', name: 'chips' };
  const gid = part.replace(/^good:/, '');
  return { key: `good:${gid}`, name: GOODS[gid]?.name ?? gid };
}

function addedForPart(before: RigView | undefined, after: RigView, key: string, fullNeed: number) {
  const idx = before?.stage ?? after.stage;
  const prev = before?.done?.[idx]?.[key] ?? 0;
  const next = after.done?.[idx]?.[key] ?? (after.stage > idx || after.status !== 'building' ? fullNeed : 0);
  return Math.max(0, next - prev);
}

function rigActionMessage(ev: string, body: Record<string, unknown>, before: RigView | undefined, after: RigView): string {
  if (ev === 'estate_rig_start') return `Started a new rig. First stage: ${RIG_STAGES[0]!.name}.`;
  if (ev === 'estate_rig_launch') return `Launched. The rig is on station and pumps ${RIG_CRUDE_PER_HOUR} crude an hour to your Fort McChud tanks.`;
  if (ev !== 'estate_rig_contribute') return 'Done.';
  const st = RIG_STAGES[Math.min(before?.stage ?? after.stage, RIG_STAGES.length - 1)]!;
  const part = String(body.part ?? 'chips');
  const meta = partMeta(part);
  const need = meta.key === 'chips' ? st.chips : (st.goods.find(([id]) => `good:${id}` === meta.key)?.[1] ?? 0);
  const added = addedForPart(before, after, meta.key, need);
  const lead = added > 0 ? `Added ${added.toLocaleString('en-US')} ${meta.name}` : 'Contribution landed';
  if (after.status === 'ready' && before?.status !== 'ready') return `${lead}. ${st.name} is finished — the rig is ready to launch.`;
  if (before && after.stage > before.stage) {
    const next = RIG_STAGES[after.stage]!;
    return `${lead}. ${st.name} is finished. Now building ${next.name} (${pctLabel(rigPct(after.stage, after.done ?? [], priceOf, after.status))} of the rig).`;
  }
  const cur = RIG_STAGES[after.stage]!;
  const row = after.done?.[after.stage] ?? {};
  return `${lead} to ${cur.name}. This stage is ${pctLabel(rigStagePct(cur, row, priceOf))} complete.`;
}

type PowerView = {
  gridMw: number; gridPrice: number; plantMw: number; demand: number; supply: number; throttle: number;
  cap: number; paidToday: number; gridOff?: boolean; gridBill?: number; coalPerDay?: number; fuelUntil?: number; fuelDay?: number;
};


const chips = (n: number) => n.toLocaleString('en-US');

/** Cash a contribute/fill will debit: chips are indexed; materials are indexed(unit * qty bought). */
function partCharge(p: Pick<HyperPart, 'part' | 'price' | 'basePrice' | 'have'>, qty: number, index: number) {
  if (p.part === 'chips') return buildCashCharge(qty, index);
  const buy = Math.max(0, qty - (p.have ?? 0));
  return buildCashCharge((p.basePrice ?? 0) * buy, index);
}

function costLine(cost: ProjectCashCost) {
  return `Total 🪙 ${chips(cost.total)} at today's prices — 🪙 ${chips(cost.chips)} chips + 🪙 ${chips(cost.materials)} materials if you buy them with chips. Warehouse stock is used first and costs nothing.`;
}


function plantFuelBadge(power: PowerView) {
  if (power.plantMw <= 0) return { label: 'None in service', kind: 'is-muted' };
  const ms = (power.fuelUntil ?? 0) - Date.now();
  if (ms <= 0) return { label: 'Unfueled', kind: 'is-off' };
  if (ms < 3_600_000) return { label: 'Fueled for under an hour', kind: 'is-on' };
  const h = Math.round(ms / 3_600_000);
  return { label: `Fueled for about ${h} hour${h === 1 ? '' : 's'}`, kind: 'is-on' };
}


export function EstatePanel({ lotId, me, mine = false, kind, onClose }: { lotId?: string; me: string | null; mine?: boolean; kind?: 'estate' | 'plastics' | 'rigdock' | 'hyper'; onClose: () => void }) {
  const [view, setView] = useState<Record<string, unknown> | null>(null);
  const [msg, setMsg] = useState<EstateMsg | null>(null);
  const pidx = usePriceIndex();
  const dragEstate = usePanelDrag('estate');
  const load = () => { void request('estate_view', {}).then((r) => { if (r && (r as { ok?: boolean }).ok !== false) setView(r as unknown as Record<string, unknown>); }); };
  useEffect(() => { load(); }, []);
  const call = async (ev: string, body: Record<string, unknown>) => {
    const beforeRigs = ((view?.rigs as RigView[] | undefined) ?? []);
    const r = await request(ev, body) as { ok?: boolean; error?: string };
    if (r && r.ok === false) { setMsg({ text: r.error ?? 'That did not work.', ok: false }); return; }
    if (isRigPayload(r)) {
      const before = beforeRigs.find((x) => x.id === r.id);
      setView((v) => patchRigs(v, r));
      setMsg({ text: rigActionMessage(ev, body, before, r), ok: true });
    } else {
      setMsg(null);
    }
    load();
    announceEstateChange(); // map + deed card pick up a demolish, a chosen project or a finished stage right away
  };
  const sites = (view?.sites as SiteView[] | undefined) ?? [];
  const site = lotId ? sites.find((s) => s.lotId === lotId) : sites[0];
  const worksCost = site?.plan && site.build ? (site.plan.cost ?? estateProjectCost(ESTATE_BUILDS[site.build], pidx)) : null;
  const power = view?.power as PowerView | undefined;
  const canBuild = !!me && mine;
  const heading = kind === 'plastics' ? '🧴 Plastics Plant' : kind === 'rigdock' ? '🛢️ Shore Construction Dock' : kind === 'hyper' ? '🌿 Hyper farm' : site?.plan ? `${site.plan.icon} ${site.plan.name}` : '🏗️ Private works';
  const gearRate = site?.complete && site.gearDef ? site.gear * site.gearDef.chipsPerHour : 0;
  return (
    <MapSheet className="world-deed estate-panel" data-testid="estate-panel" data-drag-panel="estate" ref={dragEstate.ref} style={dragEstate.style()} onPointerDown={dragEstate.onPointerDown}>
      {dragEstate.handle}
      <button type="button" className="world-deed-x" onClick={onClose} aria-label="Close">✕</button>
      <h3>{heading}</h3>
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
        {kind === 'rigdock' && (
          <p className="estate-sticky-line" data-testid="estate-dock-status">
            Rigs {((view?.rigs as RigView[] | undefined) ?? []).length} / {RIG_MAX_PER_PLAYER} · launched rigs pump {RIG_CRUDE_PER_HOUR} crude/h to Fort McChud
          </p>
        )}
        {msg && <p className={`estate-msg estate-toast${msg.ok ? ' ok' : ' err'}`} data-testid="estate-msg" data-estate-msg-kind={msg.ok ? 'ok' : 'err'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
        {!mine && (!kind || kind === 'estate') && <p className="estate-msg">Only the owner can build on this lot.</p>}
      </div>
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
        {kind === 'rigdock' && <RigDock me={!!me} chips={typeof view?.chips === 'number' ? (view.chips as number) : undefined} pidx={pidx} rigs={((view?.rigs as RigView[] | undefined) ?? [])} onCall={call} />}
        {kind === 'hyper' && lotId && (
          <div data-testid="estate-hyper">
            <p>Convert this farm into a Dutch glasshouse. Flowers and other difficult crops unlock when it is finished.</p>
            {(() => {
              const h = ((view?.hyper as HyperView[] | undefined) ?? []).find((x) => x.plotId === lotId);
              if (!h) {
                const hcost = hyperProjectCost(pidx);
                return <>
                <p className="estate-dock-blurb" data-testid="estate-hyper-total">{costLine(hcost)}</p>
                <ol>{hcost.stages.map((s) => <li key={s.id}>{s.name} · 🪙 {chips(s.total)} <small>chips 🪙 {chips(s.chips)} + materials 🪙 {chips(s.materials)}</small></li>)}</ol>
                <button type="button" disabled={!canBuild} data-testid="estate-hyper-start" onClick={() => void call('estate_hyper_start', { plotId: lotId })}>Start conversion</button>
              </>;
              }
              const hcost = h.cost ?? hyperProjectCost(pidx);
              return <>
                <p className="estate-dock-blurb" data-testid="estate-hyper-total">{costLine(hcost)}</p>
                <p className="estate-sticky-line">{h.complete ? 'Glasshouse finished' : `Stage ${Math.min(h.stage + 1, h.stages.length)} of ${h.stages.length}`} · {pctLabel(h.pct)} complete</p>
                <Bar v={h.pct} testid="estate-hyper-progress" />
                {h.complete && !h.finished && canBuild && <button type="button" className="estate-hyper-finish" data-testid="estate-hyper-finish" onClick={() => void call('estate_hyper_finish', { plotId: lotId })}>🌷 Finish glasshouse</button>}
                {h.complete && (h.finished || !canBuild) && <p className="estate-hyper-done" data-testid="estate-hyper-done">🌷 Glasshouse open: tulips, roses, orchids, saffron, wasabi and vanilla are in this farm's seed list, and every crop here grows 30% faster.</p>}
                <ul className="prestige-list">{h.stages.map((st, i) => (
                  <li key={st.id} data-testid={`estate-hyper-stage-${st.id}`}>
                    <div style={{ flex: 1 }}><b>{st.name}</b> — {pctLabel(st.pct)}
                      <Bar v={st.pct} />
                      {i === h.stage && !h.complete && st.parts.map((p) => {
                        const left = Math.max(0, p.need - p.done);
                        const step = p.part === 'chips' ? Math.min(left, 10_000) : Math.min(left, Math.max(1, Math.ceil(p.need / 10)));
                        const cost = (n: number) => partCharge(p, n, pidx);
                        return <div key={p.part} className="estate-hyper-part">
                          <small>{p.name}: {chips(p.done)} / {chips(p.need)}{p.part !== 'chips' ? ` · in warehouse ${chips(p.have ?? 0)} · 🪙 ${chips(p.price)} each otherwise` : ''}</small>
                          {canBuild && left > 0 && <>
                            <button type="button" data-testid={`estate-hyper-add-${p.part}`} onClick={() => void call('estate_hyper_contribute', { plotId: lotId, part: p.part, qty: step })}>Add {chips(step)}{cost(step) > 0 ? ` · 🪙 ${chips(cost(step))}` : ''}</button>
                            {left > step && <button type="button" onClick={() => void call('estate_hyper_contribute', { plotId: lotId, part: p.part, qty: left })}>Fill {chips(left)}{cost(left) > 0 ? ` · 🪙 ${chips(cost(left))}` : ''}</button>}
                          </>}
                        </div>;
                      })}
                    </div>
                  </li>
                ))}</ul>
              </>;
            })()}
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
            {site?.was && (site.complete && site.plan
              ? <p data-testid="estate-converted">This lot was {site.was.label}. The {site.plan.name.toLowerCase()} is finished and stands on the lot now.</p>
              : <p>This lot was {site.was.label}. It is now a private construction site.</p>)}
            {!site?.build && (
              <div>
                <p>Choose what to build. Each project has four stages, with a model at every step.</p>
                <ul className="prestige-list" data-testid="estate-build-list">
                  {ESTATE_BUILD_ORDER.map((id) => {
                    const b = ESTATE_BUILDS[id];
                    const cost = estateProjectCost(b, pidx);
                    return <li key={id} data-testid={`estate-build-row-${id}`}><div><b>{b.icon} {b.name}</b><small data-testid={`estate-build-cost-${id}`}>{b.blurb} · 🪙 {chips(cost.total)} at today's prices</small></div>
                      <button type="button" disabled={!canBuild || !lotId} data-testid={`estate-build-${id}`} onClick={() => void call('estate_choose', { lotId, build: id })}>Build</button></li>;
                  })}
                </ul>
              </div>
            )}
            {site?.plan && (
              <div className="estate-dock estate-works" data-testid="estate-works">
                <p className="estate-dock-blurb">{site.plan.blurb}</p>
                <p className="estate-dock-blurb" data-testid="estate-works-total">{costLine(worksCost ?? estateProjectCost(ESTATE_BUILDS[site.build!], pidx))}</p>
                <ul className="estate-dock-list">
                  <li className="estate-dock-card" data-testid="estate-works-build">
                    <div className="estate-dock-head">
                      <b>{site.complete ? `${site.plan.name} finished` : `Building · ${(site.stages ?? [])[site.stage]?.name ?? site.plan.name}`}</b>
                      <small className="estate-dock-badge">{site.complete ? 'Complete' : `Stage ${Math.min(site.stage + 1, site.stages?.length ?? 4)} of ${site.stages?.length ?? 4}`}</small>
                    </div>
                    <Bar v={site.complete ? 1 : ((site.stages ?? []).reduce((a, s) => a + (s.pct ?? 0), 0) / Math.max(1, site.stages?.length ?? 1))} testid="estate-works-progress" />
                    {site.complete ? (
                      <ul className="estate-works-done">
                        {(site.stages ?? []).map((s) => (
                          <li key={s.id} data-testid={`estate-works-stage-${s.id}`}><b>{s.name}</b><span>Done</span></li>
                        ))}
                      </ul>
                    ) : (site.stages ?? []).map((s, i) => {
                      const current = i === site.stage;
                      const done = i < site.stage;
                      const pct = done ? 1 : (s.pct ?? 0);
                      return (
                        <div key={s.id} className={`estate-dock-stage${current ? ' is-current' : done ? ' is-done' : ' is-upcoming'}`} data-testid={`estate-works-stage-${s.id}`}>
                          <div className="estate-dock-stage-head"><b>{s.name}</b> <span>{done ? 'Done' : pctLabel(pct)}{worksCost?.stages[i] ? ` · 🪙 ${chips(worksCost.stages[i]!.total)}` : ''}</span></div>
                          <Bar v={pct} />
                          {canBuild && current && !s.parts && (
                            <div className="estate-dock-actions">
                              <button type="button" className="estate-dock-btn" onClick={() => void call('estate_contribute', { lotId: site.lotId, part: 'chips', qty: 10_000 })}>Add 10,000 chips · 🪙 {chips(buildCashCharge(10_000, pidx))}</button>
                            </div>
                          )}
                          {current && (s.parts ?? []).map((p) => {
                            const left = Math.max(0, p.need - p.done);
                            const step = p.part === 'chips' ? Math.min(left, 10_000) : Math.min(left, Math.max(1, Math.ceil(p.need / 10)));
                            const cost = (n: number) => partCharge(p, n, pidx);
                            return (
                              <div key={p.part} className="estate-dock-part" data-testid={`estate-site-part-${p.part}`}>
                                <small>{p.name}: {chips(p.done)} / {chips(p.need)}{p.part !== 'chips' ? ` · in warehouse ${chips(p.have ?? 0)} · 🪙 ${chips(p.price)} each otherwise` : ''}</small>
                                {canBuild && left > 0 && (
                                  <div className="estate-dock-actions">
                                    <button type="button" className="estate-dock-btn" data-testid={`estate-site-add-${p.part}`} onClick={() => void call('estate_contribute', { lotId: site.lotId, part: p.part, qty: step })}>Add {chips(step)}{cost(step) > 0 ? ` · 🪙 ${chips(cost(step))}` : ''}</button>
                                    {left > step && <button type="button" className="estate-dock-btn estate-dock-fill" data-testid={`estate-site-fill-${p.part}`} onClick={() => void call('estate_contribute', { lotId: site.lotId, part: p.part, qty: left })}>Fill {chips(left)}{cost(left) > 0 ? ` · 🪙 ${chips(cost(left))}` : ''}</button>}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </li>
                  {site.complete && site.gearDef && (
                    <li className="estate-dock-card estate-gear" data-testid="estate-gear">
                      <div className="estate-dock-head">
                        <b>{site.gearDef.icon} {site.gearDef.name}s</b>
                        <small className="estate-dock-badge">{site.gear} / {site.gearDef.max}</small>
                      </div>
                      <Bar v={site.gearDef.max > 0 ? site.gear / site.gearDef.max : 0} testid="estate-gear-progress" />
                      <dl className="estate-stat">
                        <dt>Each</dt>
                        <dd>{site.gearDef.mw} MW · 🪙 {chips(site.gearDef.chipsPerHour)}/h · 🪙 {chips(site.gearDef.price)}</dd>
                        {site.gearDef.install && site.gearDef.install.length > 0 && (
                          <>
                            <dt>Install uses</dt>
                            <dd>{site.gearDef.install.map((g) => `${g.qty} ${g.name}`).join(' + ')} from the warehouse.</dd>
                          </>
                        )}
                        <dt>This site</dt>
                        <dd>🪙 {chips(gearRate)}/h at full power · {site.gear * site.gearDef.mw} MW draw</dd>
                      </dl>
                      {canBuild && (
                        <div className="estate-dock-actions">
                          <button type="button" className="estate-dock-btn" data-testid="estate-gear-install" onClick={() => void call('estate_gear', { lotId: site.lotId, qty: 1 })}>Install one · 🪙 {chips(site.gearDef.price)}</button>
                        </div>
                      )}
                    </li>
                  )}
                </ul>
              </div>
            )}
            {power && (
              <div className="estate-ops estate-power" data-testid="estate-power">
                <div className="estate-dock-head">
                  <h3>⚡ Power</h3>
                </div>
                {power.gridOff && <p data-testid="estate-power-cut" className="estate-ops-cut"><strong>Grid is off.</strong> Digital output that needs the utility has stopped until the bill is paid.</p>}
                <div className="estate-ops-grid">
                  <div className="estate-dock-card" data-testid="estate-power-utility">
                    <div className="estate-dock-head">
                      <b>Utility contract</b>
                      <small className={`estate-ops-badge ${power.gridOff ? 'is-off' : power.gridMw > 0 ? 'is-on' : 'is-muted'}`}>{power.gridOff ? 'Shut off' : power.gridMw > 0 ? 'On' : 'None'}</small>
                    </div>
                    <dl className="estate-stat">
                      <dt>Contract</dt><dd>{power.gridMw} MW</dd>
                      <dt>Rate</dt><dd>🪙 {chips(power.gridPrice)}/MW/day</dd>
                      {(power.gridBill ?? 0) > 0 && (<><dt>{power.gridOff ? 'Unpaid bill' : 'Bill'}</dt><dd>🪙 {chips(power.gridBill ?? 0)}</dd></>)}
                    </dl>
                    {canBuild && (
                      <div className="estate-dock-actions">
                        <button type="button" className="estate-dock-btn" data-testid="estate-grid-buy" onClick={() => void call('estate_grid', { mw: (power.gridMw || 0) + 10 })}>Buy +10 MW utility</button>
                      </div>
                    )}
                  </div>
                  <div className="estate-dock-card" data-testid="estate-power-plant">
                    <div className="estate-dock-head">
                      <b>Power plant</b>
                      <small className={`estate-ops-badge ${plantFuelBadge(power).kind}`}>{plantFuelBadge(power).label}</small>
                    </div>
                    <dl className="estate-stat">
                      <dt>Nameplate</dt><dd>{power.plantMw} MW</dd>
                      {power.plantMw > 0 && (<><dt>Fuel</dt><dd>{chips(power.coalPerDay ?? 0)} coal/day or 🪙 {chips(power.fuelDay ?? 0)} fuel contract</dd></>)}
                    </dl>
                  </div>
                  <div className="estate-dock-card" data-testid="estate-power-balance">
                    <div className="estate-dock-head">
                      <b>Balance</b>
                      <small className="estate-dock-badge">Throttle {Math.round(power.throttle * 100)}%</small>
                    </div>
                    <dl className="estate-stat">
                      <dt>Demand</dt><dd>{power.demand} MW</dd>
                      <dt>Supply</dt><dd>{power.supply} MW</dd>
                    </dl>
                    <Bar v={power.throttle} testid="estate-power-throttle" />
                  </div>
                  <div className="estate-dock-card" data-testid="estate-power-income">
                    <div className="estate-dock-head">
                      <b>Digital income</b>
                      <small className="estate-dock-badge">Today</small>
                    </div>
                    <p className="estate-dock-hold">🪙 {chips(power.paidToday)} / {chips(power.cap)} cap{gearRate ? ` · this site 🪙 ${chips(gearRate)}/h at full power` : ''}.</p>
                    <Bar v={power.cap > 0 ? Math.min(1, power.paidToday / power.cap) : 0} testid="estate-power-cap" />
                  </div>
                </div>
              </div>
            )}
            {lotId && canBuild && (
              <div className="estate-demolish estate-dock-card">
                <div className="estate-dock-head"><h3>Demolish</h3></div>
                <p>{DEMOLISH_RULES}</p>
                <div className="estate-dock-actions">
                  <button type="button" className="estate-dock-btn estate-demolish-btn" data-testid="estate-demolish" onClick={() => { if (confirm('Demolish this structure and turn the lot into a construction site?\n\n' + DEMOLISH_RULES)) void call('estate_demolish', { id: lotId, confirm: true }); }}>Demolish…</button>
                </div>
              </div>
            )}
          </div>
        )}
    </MapSheet>
  );
}

function RigDock({ me, chips: wallet, pidx, rigs, onCall }: { me: boolean; chips?: number; pidx: number; rigs: RigView[]; onCall: (ev: string, body: Record<string, unknown>) => Promise<void> }) {
  const atCap = rigs.length >= RIG_MAX_PER_PLAYER;
  const afford = wallet == null ? Number.POSITIVE_INFINITY : Math.max(0, wallet);
  return (
    <div className="estate-dock" data-testid="estate-dock">
      <p className="estate-dock-blurb">Build a rig on the dock in four stages, then launch it. Add chips and materials to the current stage — warehouse stock is used first, then the catalog price at today's index.</p>
      <p className="estate-dock-blurb" data-testid="estate-dock-total">{costLine((rigs[0]?.cost) ?? rigProjectCost(pidx))} Launch is a separate 🪙 {chips(rigs[0]?.launchFee ?? buildCashCharge(RIG_LAUNCH_FEE, pidx))} fee.</p>
      <ol className="estate-dock-plan">
        {((rigs[0]?.cost) ?? rigProjectCost(pidx)).stages.map((s) => <li key={s.id}>{s.name} · 🪙 {chips(s.total)}</li>)}
      </ol>
      <div className="estate-dock-toolbar">
        <button type="button" className="estate-dock-btn" data-testid="estate-dock-start" disabled={!me || atCap} onClick={() => void onCall('estate_rig_start', {})}>Start a new rig</button>
        {atCap && <small data-testid="estate-dock-cap">You can have at most {RIG_MAX_PER_PLAYER} rigs.</small>}
      </div>
      <ul className="estate-dock-list">
        {rigs.map((r) => {
          const overall = rigPct(r.stage, r.done ?? [], priceOf, r.status);
          const fee = r.launchFee ?? RIG_LAUNCH_FEE;
          return (
            <li key={r.id} className={`estate-dock-card is-${r.status}`} data-testid={`estate-dock-rig-${r.id}`}>
              <div className="estate-dock-head">
                <b>{r.label}</b>
                <small className="estate-dock-badge">{r.status === 'building' ? `Stage ${Math.min(r.stage + 1, RIG_STAGES.length)} of ${RIG_STAGES.length}` : r.status === 'ready' ? 'Ready to launch' : 'On station'}</small>
              </div>
              <Bar v={overall} testid={`estate-dock-progress-${r.id}`} />
              {r.status === 'launched' && <p className="estate-dock-hold">Hold {chips(r.hold ?? 0)} / {chips(RIG_HOLD_CAP)} crude · {RIG_CRUDE_PER_HOUR}/h to Fort McChud</p>}
              {r.status === 'ready' && (
                <div className="estate-dock-actions">
                  <button type="button" className="estate-dock-btn" data-testid={`estate-dock-launch-${r.id}`} disabled={!me} onClick={() => void onCall('estate_rig_launch', { id: r.id })}>Launch · 🪙 {chips(fee)}</button>
                </div>
              )}
              {r.status === 'building' && RIG_STAGES.map((st, i) => {
                const row = r.done?.[i] ?? {};
                const pct = i < r.stage ? 1 : i === r.stage ? rigStagePct(st, row, priceOf) : 0;
                const current = i === r.stage;
                return (
                  <div key={st.id} className={`estate-dock-stage${current ? ' is-current' : i < r.stage ? ' is-done' : ' is-upcoming'}`} data-testid={`estate-dock-stage-${r.id}-${st.id}`}>
                    <div className="estate-dock-stage-head"><b>{st.name}</b> <span>{i < r.stage ? 'Done' : pctLabel(pct)}{(r.cost ?? rigProjectCost(pidx)).stages[i] ? ` · 🪙 ${chips((r.cost ?? rigProjectCost(pidx)).stages[i]!.total)}` : ''}</span></div>
                    <Bar v={pct} />
                    {current && (
                      <>
                        {(() => {
                          const left = Math.max(0, st.chips - (row.chips ?? 0));
                          const add = Math.min(left, RIG_CHIP_STEP, afford);
                          const fill = Math.min(left, afford);
                          return (
                            <div className="estate-dock-part">
                              <small>Chips: {chips(row.chips ?? 0)} / {chips(st.chips)}</small>
                              {me && left > 0 && (
                                <div className="estate-dock-actions">
                                  <button type="button" className="estate-dock-btn" data-testid={`estate-dock-add-chips-${r.id}`} disabled={add < 1} onClick={() => void onCall('estate_rig_contribute', { id: r.id, part: 'chips', qty: add })}>Add {chips(add)}{add > 0 ? ` · 🪙 ${chips(buildCashCharge(add, pidx))}` : ''}</button>
                                  {fill > add && <button type="button" className="estate-dock-btn estate-dock-fill" data-testid={`estate-dock-fill-chips-${r.id}`} onClick={() => void onCall('estate_rig_contribute', { id: r.id, part: 'chips', qty: fill })}>Fill {chips(fill)} · 🪙 {chips(buildCashCharge(fill, pidx))}</button>}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        {st.goods.map(([id, need]) => {
                          const have = row[`good:${id}`] ?? 0;
                          const left = Math.max(0, need - have);
                          const step = Math.min(left, Math.max(1, Math.ceil(need / 10)));
                          const catalog = (n: number) => buildCashCharge(priceOf(id) * n, pidx);
                          const name = GOODS[id]?.name ?? id;
                          return (
                            <div key={id} className="estate-dock-part">
                              <small>{name}: {chips(have)} / {chips(need)} · 🪙 {chips(buildCashCharge(priceOf(id), pidx))} each if you need to buy</small>
                              {me && left > 0 && (
                                <div className="estate-dock-actions">
                                  <button type="button" className="estate-dock-btn" data-testid={`estate-dock-add-good:${id}-${r.id}`} onClick={() => void onCall('estate_rig_contribute', { id: r.id, part: id, qty: step })}>Add {chips(step)}{catalog(step) > 0 ? ` · 🪙 ${chips(catalog(step))}` : ''}</button>
                                  {left > step && <button type="button" className="estate-dock-btn estate-dock-fill" data-testid={`estate-dock-fill-good:${id}-${r.id}`} onClick={() => void onCall('estate_rig_contribute', { id: r.id, part: id, qty: left })}>Fill {chips(left)} · 🪙 {chips(catalog(left))}</button>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                );
              })}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
