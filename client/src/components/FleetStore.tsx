import { useDoing } from '@/lib/doing';
import { backdropDismiss } from '@/lib/backdrop';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { request } from '@/lib/net';
import { buildCraft, disposeTree } from '@/lib/fleetModels';
import { BOATS, DEEP_ZONES, JETS, type FleetKind, type FleetModel } from '../../../shared/fleet';
import { usePanelDrag } from '@/lib/panelDrag';

type Owned = { id: string; kind: FleetKind; model: string; paid: number; boughtAt: number; arrears: number; upkeepPaid: number; value: number; upkeep?: number };
type View = { signedIn: boolean; owned: Owned[]; chips: number | null; catalog: Array<FleetModel & { basePrice: number }>; deep?: { zone: number; name: string | null } };
const fmt = (n: number) => n.toLocaleString('en-US');

function Preview({ m }: { m: FleetModel }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    let r: THREE.WebGLRenderer; try { r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch { return; }
    r.setPixelRatio(Math.min(2, devicePixelRatio)); r.setSize(cv.clientWidth || 320, cv.clientHeight || 200, false); r.toneMapping = THREE.ACESFilmicToneMapping;
    const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xfff0e0, 0x335, 1.6)); const dl = new THREE.DirectionalLight(0xffd8a8, 2.4); dl.position.set(6, 9, 5); sc.add(dl);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshStandardMaterial({ color: m.kind === 'boat' ? 0x0a5a6a : 0x2a2e36, roughness: m.kind === 'boat' ? 0.15 : 0.8, metalness: m.kind === 'boat' ? 0.3 : 0 })); floor.rotation.x = -Math.PI / 2; sc.add(floor);
    const g = buildCraft(m); sc.add(g); const box = new THREE.Box3().setFromObject(g); const size = box.getSize(new THREE.Vector3()); const s = Math.max(size.x, size.y, size.z);
    const cam = new THREE.PerspectiveCamera(35, (cv.clientWidth || 320) / (cv.clientHeight || 200), 0.1, 500); cam.position.set(s * 0.95, s * 0.55, s * 0.95); cam.lookAt(0, size.y * 0.35, 0);
    let raf = 0; const loop = () => { raf = requestAnimationFrame(loop); g.rotation.y += 0.006; r.render(sc, cam); }; loop();
    return () => { cancelAnimationFrame(raf); disposeTree(sc); r.dispose(); };
  }, [m]);
  return <canvas ref={ref} className="dealer-preview" data-testid="fleet-preview" />;
}

/** Marina (boats) and Hangar (private jets): browse, buy, sell back. Chips move on the server only. */
export function FleetStore({ kind, onClose }: { kind: FleetKind; onClose: () => void }) {
  const boat = kind === 'boat'; useDoing(boat ? 'resort' : 'airport');
  const drag = usePanelDrag(boat ? 'marina' : 'hangar');
  const base = boat ? BOATS : JETS;
  const [v, setV] = useState<View | null>(null); const [sel, setSel] = useState(base[0]!.id);
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const load = () => { void request(boat ? 'marina_view' : 'hangar_view').then((a) => { if (a.ok) setV(a as unknown as View); }); };
  useEffect(load, [boat]);
  const cat = v?.catalog ?? base.map((m) => ({ ...m, basePrice: m.price }));
  const m = cat.find((x) => x.id === sel) ?? cat[0]!;
  const mine = (v?.owned ?? []).filter((o) => o.kind === kind);
  const act = async (ev: string, data: unknown, ok: (a: Record<string, unknown>) => string) => { setBusy(true); const a = await request(ev, data); setBusy(false); setMsg(a.ok ? ok(a as unknown as Record<string, unknown>) : a.error ?? 'Something went wrong.'); load(); };
  return (
    <div className="dealer fleet" data-testid={boat ? 'marina' : 'hangar'} {...backdropDismiss(() => onClose())}>
      <div className="dealer-box" data-drag-panel={boat ? 'marina' : 'hangar'} onPointerDown={drag.onPointerDown} style={drag.style()} ref={drag.ref}>{drag.handle}
        <header><h3>{boat ? '🛥 Chud Resort Marina' : '🛩 Chud Hub Private Hangar'}</h3>{v?.chips != null && <span className="dealer-chips">{fmt(v.chips)} chips</span>}<button type="button" onClick={onClose} aria-label="Close" data-testid="fleet-close">✕</button></header>
        <div className="dealer-body">
          <aside className="dealer-list">
            <div><h4>{boat ? 'Boats & yachts' : 'Private jets'}</h4>
              {cat.map((c) => <button key={c.id} type="button" className={c.id === sel ? 'on' : ''} onClick={() => { setSel(c.id); setMsg(null); }} data-testid={`fleet-model-${c.id}`}><span>{c.emoji} {c.name}</span><b>{fmt(c.price)}</b></button>)}
            </div>
            <div><h4>{boat ? 'My boats' : 'My jets'}</h4>
              {mine.length ? mine.map((o) => { const om = cat.find((x) => x.id === o.model); return <div key={o.id} className="fleet-owned" data-testid={`fleet-owned-${o.model}`}>
                <span>{om?.emoji} {om?.name ?? o.model}{o.arrears > 0 && <em className="fleet-arrears"> · {o.arrears} day{o.arrears > 1 ? 's' : ''} unpaid</em>}</span>
                <button type="button" disabled={busy} onClick={() => { if (confirm(`Sell the ${om?.name} for ${fmt(o.value)} chips?`)) void act('fleet_sell', { id: o.id }, (a) => `Sold for ${fmt(Number(a.paid))} chips.`); }}>Sell {fmt(o.value)}</button></div>; }) : <small>None yet.</small>}
            </div>
          </aside>
          <section className="dealer-main">
            <Preview m={m} />
            <h4>{m.emoji} {m.name}</h4>
            <p>{m.blurb}</p>
            <ul className="fleet-stats">
              <li>Price <b>{fmt(m.price)}</b> chips</li>
              {boat ? <><li>Deep-sea range <b>{DEEP_ZONES.slice(0, m.zone ?? 0).map((z) => z.name).join(' · ')}</b></li>{m.biteMul && m.biteMul < 1 && <li>Bites <b>{Math.round((1 - m.biteMul) * 100)}% faster</b> at sea</li>}</>
                : <><li>Daily upkeep <b>{fmt(m.upkeep ?? 0)}</b> chips (crew, fuel, hangar)</li><li>Free flights to Chud Resort, no ticket</li><li>3 unpaid days → repossessed</li></>}
              <li>Sell back <b>70%</b> of list · counts toward net worth</li>
            </ul>
            {boat && v?.deep && <small data-testid="fleet-deep">{v.deep.zone ? `Your best boat (${v.deep.name}) reaches ${DEEP_ZONES[v.deep.zone - 1]!.name}.` : 'Buy any boat to unlock deep-sea fishing from the Marina.'}</small>}
            <button type="button" className="fleet-buy" disabled={busy || !v?.signedIn} onClick={() => void act(boat ? 'marina_buy' : 'hangar_buy', { model: m.id }, (a) => `Bought the ${m.name} for ${fmt(Number(a.price))} chips.`)} data-testid="fleet-buy">{v?.signedIn ? `Buy for ${fmt(m.price)}` : 'Sign in to buy'}</button>
            {msg && <small className="fleet-msg" data-testid="fleet-msg">{msg}</small>}
          </section>
        </div>
      </div>
    </div>
  );
}
