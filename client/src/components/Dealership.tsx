import { backdropDismiss } from '@/lib/backdrop';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { request } from '@/lib/net';
import { buildCar } from '@/lib/carModels';
import { CARS, TIER_LABEL, type CarModel } from '../../../shared/cars';
import { usePanelDrag } from '@/lib/panelDrag';

type Owned = { id: string; carId: string; color: number; paid: number; boughtAt: number; active: boolean; value: number };
type Garage = { signedIn: boolean; cars: Owned[]; chips: number | null };
type Priced = CarModel & { basePrice?: number };
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const fmt = (n: number) => n.toLocaleString();

/** Rotating 3D preview of one car (its own tiny renderer, disposed on unmount). */
function Preview({ car, color }: { car: CarModel; color: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    let r: THREE.WebGLRenderer; try { r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); } catch { return; }
    r.setPixelRatio(Math.min(2, devicePixelRatio)); r.setSize(cv.clientWidth || 320, cv.clientHeight || 200, false);
    const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff, 0x334, 1.6)); const dl = new THREE.DirectionalLight(0xffffff, 2); dl.position.set(4, 6, 3); sc.add(dl);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 40), new THREE.MeshStandardMaterial({ color: 0x222633 })); floor.rotation.x = -Math.PI / 2; sc.add(floor);
    const cam = new THREE.PerspectiveCamera(35, (cv.clientWidth || 320) / (cv.clientHeight || 200), 0.1, 100);
    const s = Math.max(...car.dims); cam.position.set(s * 1.3, s * 0.7, s * 1.3); cam.lookAt(0, car.dims[2] * 0.4, 0);
    const g = buildCar(car, color, 'near'); sc.add(g); let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); g.rotation.y += 0.008; r.render(sc, cam); }; loop();
    return () => { cancelAnimationFrame(raf); floor.geometry.dispose(); (floor.material as THREE.Material).dispose(); r.dispose(); };
  }, [car, color]);
  return <canvas ref={ref} className="dealer-preview" data-testid="dealer-preview" />;
}

export function Dealership({ onClose, onDrive }: { onClose: () => void; onDrive: (carId: string, color: number) => void }) {
  const dragDealer = usePanelDrag('dealer');
  const [cars, setCars] = useState<Priced[]>(CARS);
  const [g, setG] = useState<Garage | null>(null);
  const [sel, setSel] = useState(CARS[0].id); const [col, setCol] = useState(0);
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const load = () => { void request('car_garage').then((a) => { if (a.ok) setG(a as unknown as Garage); }); };
  useEffect(() => { void request('car_catalog').then((a) => { if (a.ok && Array.isArray((a as unknown as { cars?: Priced[] }).cars)) setCars((a as unknown as { cars: Priced[] }).cars); }); load(); }, []);
  const car = cars.find((c) => c.id === sel) ?? cars[0]; const color = car.colors[col] ?? car.colors[0];
  const tiers = useMemo(() => [...new Set(cars.map((c) => c.tier))], [cars]);
  const act = async (ev: string, data: unknown, ok: (a: Record<string, unknown>) => string) => {
    setBusy(true); const a = await request(ev, data); setBusy(false);
    setMsg(a.ok ? ok(a as unknown as Record<string, unknown>) : a.error ?? 'Something went wrong.'); load();
  };
  const active = g?.cars.find((c) => c.active);
  return (
    <div className="dealer" data-testid="dealership" {...backdropDismiss(() => onClose())}>
      <div className="dealer-box" data-drag-panel="dealer" onPointerDown={dragDealer.onPointerDown} style={dragDealer.style()} ref={dragDealer.ref}>{dragDealer.handle}
        <header><h3>🚗 Chud Motors</h3>{g?.chips != null && <span className="dealer-chips">{fmt(g.chips)} chips</span>}<button type="button" onClick={onClose} aria-label="Close" data-testid="dealer-close">✕</button></header>
        <div className="dealer-body">
          <aside className="dealer-list">
            {tiers.map((t) => <div key={t}><h4>{TIER_LABEL[t]}</h4>
              {cars.filter((c) => c.tier === t).map((c) => <button key={c.id} type="button" className={c.id === sel ? 'on' : ''} onClick={() => { setSel(c.id); setCol(0); setMsg(null); }} data-testid={`dealer-car-${c.id}`}><span>{c.name}</span><b>{fmt(c.price)}</b></button>)}
            </div>)}
          </aside>
          <section className="dealer-main">
            <Preview car={car} color={color} />
            <h3>{car.name} <small>{TIER_LABEL[car.tier]}</small></h3>
            <p>{car.blurb}</p>
            <div className="dealer-stats"><span>Top <b>{car.topKmh} km/h</b></span><span>0–100 <b>{car.zeroTo100}s</b></span><span>Handling <b>{car.handling}/10</b></span></div>
            <div className="dealer-colors">{car.colors.map((c, i) => <button key={c} type="button" aria-label={`Colour ${i + 1}`} className={i === col ? 'on' : ''} style={{ background: hex(c) }} onClick={() => setCol(i)} data-testid={`dealer-color-${i}`} />)}</div>
            <div className="dealer-buy">
              <b>{fmt(car.price)} chips</b>
              <button type="button" disabled={busy || !g?.signedIn} onClick={() => void act('car_buy', { car: car.id, color }, (a) => `Bought the ${car.name} for ${fmt(Number(a.price))} chips.`)} data-testid="dealer-buy">{g?.signedIn ? 'Buy' : 'Sign in to buy'}</button>
            </div>
            <small className="dealer-note">Sell back any time for 60% of today's price (drops 0.5%/day, never under 40%). Owned cars count toward your Bank assets.</small>
            {msg && <div className="dealer-msg" data-testid="dealer-msg">{msg}</div>}
            {!!g?.cars.length && <div className="dealer-garage" data-testid="dealer-garage"><h4>Your garage</h4>
              {g.cars.map((o) => { const m = cars.find((c) => c.id === o.carId); return (
                <div key={o.id} className={o.active ? 'on' : ''}><i style={{ background: hex(o.color) }} /><span>{m?.name ?? o.carId}{o.active && ' (active)'}</span>
                  {!o.active && <button type="button" disabled={busy} onClick={() => void act('car_active', { id: o.id }, () => `${m?.name} is now your active car.`)}>Use</button>}
                  <button type="button" disabled={busy} onClick={() => { if (confirm(`Sell the ${m?.name} for ${fmt(o.value)} chips?`)) void act('car_sell', { id: o.id }, (a) => `Sold for ${fmt(Number(a.paid))} chips.`); }}>Sell {fmt(o.value)}</button>
                </div>); })}
            </div>}
            {active && <button type="button" className="dealer-drive" onClick={() => onDrive(active.carId, active.color)} data-testid="dealer-drive">🚗 Drive my {cars.find((c) => c.id === active.carId)?.name}</button>}
          </section>
        </div>
      </div>
    </div>
  );
}
