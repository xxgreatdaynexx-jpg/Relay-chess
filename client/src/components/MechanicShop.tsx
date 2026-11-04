import { useDoing } from '@/lib/doing';
import { backdropDismiss } from '@/lib/backdrop';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { request } from '@/lib/net';
import { buildCar } from '@/lib/carModels';
import { CAR_BY_ID, type CarModel } from '../../../shared/cars';
import { COSMETIC_SLOTS, GLOWS, KITS, MAX_TIER, PAINTS, PERF_PARTS, RIMS, moddedStats, normMods, type CarMods, type CosmeticSlot, type PerfPart } from '../../../shared/mechanic';
import { usePanelDrag } from '@/lib/panelDrag';

type Owned = { id: string; carId: string; color: number; active: boolean; value: number; mods: CarMods; prices: { perf: Record<PerfPart, number | null>; cosmetic: number } | null };
type Shop = { signedIn: boolean; cars: Owned[]; chips: number | null };
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const fmt = (n: number) => n.toLocaleString();

/** Garage bay preview: the car on a lift pad under shop lights, slowly turning, with the mods as they'd look. */
function Bay({ car, color, look }: { car: CarModel; color: number; look: CarMods }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    let r: THREE.WebGLRenderer; try { r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch { return; }
    const W = cv.clientWidth || 320, H = cv.clientHeight || 200; r.setPixelRatio(Math.min(2, devicePixelRatio)); r.setSize(W, H, false);
    const sc = new THREE.Scene(); sc.background = new THREE.Color(0x1b1e26);
    sc.add(new THREE.HemisphereLight(0xffffff, 0x2a2f3a, 1.3)); const key = new THREE.DirectionalLight(0xfff4e0, 2.2); key.position.set(4, 7, 3); sc.add(key);
    const rim = new THREE.PointLight(0xffa62b, 6, 12); rim.position.set(-3, 2.5, -3); sc.add(rim);
    const disp: Array<{ dispose: () => void }> = [];
    const mk = <T extends THREE.BufferGeometry>(g: T, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); sc.add(o); disp.push(g, m); return o; };
    const floor = mk(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.8 })); floor.rotation.x = -Math.PI / 2;
    const stripe = new THREE.MeshStandardMaterial({ color: 0xffc000, emissive: 0x332200 });
    for (const z of [-2.2, 2.2]) mk(new THREE.BoxGeometry(6, 0.01, 0.12), stripe, 0, 0.005, z);
    const lift = mk(new THREE.CylinderGeometry(2.1, 2.1, 0.12, 40), new THREE.MeshStandardMaterial({ color: 0x8b93a3, metalness: 0.7, roughness: 0.35 }), 0, 0.06, 0);
    mk(new THREE.BoxGeometry(14, 6, 0.2), new THREE.MeshStandardMaterial({ color: 0x2a2e38 }), 0, 3, -5);
    for (const x of [-3, 0, 3]) mk(new THREE.BoxGeometry(1.6, 0.08, 0.3), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.5 }), x, 4.5, -1);
    const cam = new THREE.PerspectiveCamera(35, W / H, 0.1, 100);
    const s = Math.max(...car.dims); cam.position.set(s * 1.35, s * 0.75, s * 1.35); cam.lookAt(0, car.dims[2] * 0.45, 0);
    const g = buildCar(car, color, 'near', look); g.position.y = 0.12; sc.add(g); let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); g.rotation.y += 0.007; lift.rotation.y = g.rotation.y; r.render(sc, cam); }; loop();
    return () => { cancelAnimationFrame(raf); disp.forEach((d) => d.dispose()); r.dispose(); };
  }, [car, color, look]);
  return <canvas ref={ref} className="dealer-preview" data-testid="mech-preview" />;
}

export function MechanicShop({ onClose, onDrive }: { onClose: () => void; onDrive: (carId: string, color: number) => void }) {
  useDoing('mechanic');
  const dragMechanic = usePanelDrag('mechanic');
  const [shop, setShop] = useState<Shop | null>(null); const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<'perf' | 'look'>('perf'); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false); useEffect(() => setMsg(null), [tab, sel]); // Tess QA #5
  const [tryLook, setTryLook] = useState<Partial<CarMods>>({});
  const load = () => request('mech_shop').then((a) => { if (a.ok) { const s = a as unknown as Shop; s.cars = (s.cars ?? []).map((c) => ({ ...c, mods: normMods(c.mods) })); setShop(s); setSel((cur) => cur && s.cars.some((c) => c.id === cur) ? cur : (s.cars.find((c) => c.active) ?? s.cars[0])?.id ?? null); } });
  useEffect(() => { void load(); }, []);
  const o = shop?.cars.find((c) => c.id === sel) ?? null; const model = o ? CAR_BY_ID.get(o.carId) : undefined;
  const buy = async (data: Record<string, unknown>, ok: string) => {
    if (!o || busy) return; setBusy(true); const a = await request('mech_buy', { id: o.id, ...data }); setBusy(false);
    setMsg(a.ok ? `${ok}${Number((a as unknown as Record<string, unknown>).price) ? ` (−${fmt(Number((a as unknown as Record<string, unknown>).price))} chips)` : ''}` : a.error ?? 'Something went wrong.'); setTryLook({}); await load();
  };
  const look: CarMods | null = o ? { ...o.mods, ...tryLook } : null;
  const before = o && model ? moddedStats(model, o.mods) : null; const after = o && model && look ? moddedStats(model, look) : null;
  const opts: Record<CosmeticSlot, ReadonlyArray<{ id: string; label: string; color?: number; metallic?: boolean }>> = { paint: PAINTS, rims: RIMS, kit: KITS, glow: GLOWS };
  return (
    <div className="dealer" data-testid="mechanic" {...backdropDismiss(() => onClose())}>
      <div className="dealer-box" data-drag-panel="mechanic" onPointerDown={dragMechanic.onPointerDown} style={dragMechanic.style()} ref={dragMechanic.ref}>{dragMechanic.handle}
        <header><h3>🔧 Chud Customs</h3>{shop?.chips != null && <span className="dealer-chips">{fmt(shop.chips)} chips</span>}<button type="button" onClick={onClose} aria-label="Close" data-testid="mech-close">✕</button></header>
        <div className="dealer-body" style={{ display: 'block' }}>
          {!shop && <p>Opening the garage…</p>}
          {shop && !shop.signedIn && <p>Sign in to bring your car into the shop.</p>}
          {shop?.signedIn && !shop.cars.length && <p data-testid="mech-empty">No cars yet. Buy one at the Car Dealership next door, then come back to tune it.</p>}
          {o && model && look && before && after && <section className="dealer-main">
            {shop!.cars.length > 1 && <div className="mech-cars">{shop!.cars.map((c) => <button key={c.id} type="button" className={c.id === sel ? 'on' : ''} onClick={() => { setSel(c.id); setTryLook({}); setMsg(null); }} data-testid={`mech-car-${c.carId}`}>{CAR_BY_ID.get(c.carId)?.name ?? c.carId}{c.active ? ' ★' : ''}</button>)}</div>}
            <Bay car={model} color={o.color} look={look} />
            <h3>{model.name}</h3>
            <div className="dealer-stats mech-stats">
              <span>Top <b className={after.topKmh > model.topKmh ? 'up' : ''}>{after.topKmh} km/h</b></span>
              <span>0–100 <b className={after.zeroTo100 < model.zeroTo100 ? 'up' : ''}>{after.zeroTo100}s</b></span>
              <span>Handling <b className={after.handling > model.handling ? 'up' : ''}>{after.handling}</b></span>
              {after.nitro > 0 && <span>Nitro <b className="up">{after.nitro}s</b></span>}
            </div>
            <div className="mech-tabs"><button type="button" className={tab === 'perf' ? 'on' : ''} onClick={() => setTab('perf')} data-testid="mech-tab-perf">⚡ Performance</button><button type="button" className={tab === 'look' ? 'on' : ''} onClick={() => setTab('look')} data-testid="mech-tab-look">🎨 Looks</button></div>
            {tab === 'perf' && PERF_PARTS.map((p) => { const t = o.mods[p.id]; const price = o.prices?.perf[p.id] ?? null; return (
              <div key={p.id} className="mech-row" data-testid={`mech-part-${p.id}`}>
                <div><h5>{p.icon} {p.label} <small>· {t ? p.tiers[t - 1] : 'Stock'}</small></h5><small>{p.what}</small><div className="mech-pips">{Array.from({ length: MAX_TIER }, (_, i) => <i key={i} className={i < t ? 'on' : ''} />)}</div></div>
                {t >= MAX_TIER || price == null ? <small>Maxed</small> : <button type="button" disabled={busy || (shop!.chips ?? 0) < price} onClick={() => void buy({ kind: 'perf', part: p.id, tier: t + 1 }, `Fitted ${p.tiers[t]}.`)} data-testid={`mech-buy-${p.id}`}>{p.tiers[t]} · {fmt(price)}</button>}
              </div>); })}
            {tab === 'look' && <>{COSMETIC_SLOTS.map((sl) => { const cur = look[sl.id]; const stockId = sl.id === 'paint' ? null : sl.id === 'rims' ? 'stock' : 'none'; return (
              <div key={sl.id}><h5>{sl.icon} {sl.label}</h5><div className="mech-opts">
                {sl.id === 'paint' && <button type="button" className={cur == null ? 'on' : ''} onClick={() => setTryLook((l) => ({ ...l, paint: null }))}>Factory</button>}
                {opts[sl.id].map((x) => <button key={x.id} type="button" title={x.label} className={`${cur === x.id ? 'on' : ''}${sl.id === 'paint' ? ' sw' : ''}${x.metallic ? ' met' : ''}`} style={sl.id === 'paint' && x.color != null ? { background: hex(x.color) } : undefined} onClick={() => setTryLook((l) => ({ ...l, [sl.id]: x.id }))} data-testid={`mech-opt-${sl.id}-${x.id}`}>{sl.id === 'paint' ? '' : x.label}</button>)}
              </div>
              {cur !== o.mods[sl.id] && <div className="mech-row"><small>{cur === stockId ? 'Back to stock: free' : `Apply for ${fmt(o.prices?.cosmetic ?? 0)} chips`}</small><button type="button" disabled={busy} onClick={() => void buy({ kind: 'look', slot: sl.id, value: cur }, 'Done. Looking sharp.')} data-testid={`mech-apply-${sl.id}`}>Apply</button></div>}
              </div>); })}</>}
            <small className="dealer-note">Upgrades are installed for good: no refunds, and they don't raise the car's sell-back price. Everyone sees your looks when you drive. Nitro: hold Shift or N.</small>
            {msg && <div className="dealer-msg" data-testid="mech-msg">{msg}</div>}
            {o.active && <button type="button" className="dealer-drive" onClick={() => onDrive(o.carId, o.color)} data-testid="mech-drive">🚗 Drive it out</button>}
          </section>}
        </div>
      </div>
    </div>
  );
}
