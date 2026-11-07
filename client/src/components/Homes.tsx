import { MapSheet } from './MapSheet';
/**
 * Homes (Millionaire Update, pt1459u): the Furniture Store, the enterable home interior with Sims-style build mode, live
 * visitors (avatars + chat over the existing socket), owner access controls, and the profile "Visit home" button.
 * Server: server/homes.ts. Rules: shared/homes.ts.
 */
import * as THREE from 'three';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request, socket } from '@/lib/net';
import { useAccount } from '@/lib/auth';
import { buildFurniture } from '@/lib/homeModels';
import { buildMiner, animateMiner, type MinerRig } from '@/lib/minerAvatar';
import { drawLabel, labelMaterial } from '@/lib/labelSprite';
import { propertyById } from '../../../shared/realEstate';
import {
  ACCESS_LABEL, FLOOR_BY_ID, FLOOR_STYLES, FURN_BY_ID, FURN_CATS, GRID_D, GRID_W, WALL_BY_ID, WALL_STYLES, fits, footprint, styleKey,
  type Furniture, type HomeAccess, type HomeLayout, type Placed, type FurnCat,
} from '../../../shared/homes';

export const OPEN_FURNITURE = 'open-furniture-store';
export const ENTER_HOME = 'enter-home';
export const openFurnitureStore = () => window.dispatchEvent(new Event(OPEN_FURNITURE));
export const enterHome = (id: string) => window.dispatchEvent(new CustomEvent(ENTER_HOME, { detail: id }));
const chips = (n: number) => n.toLocaleString('en-US');
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
type Locker = { items: { item: string; qty: number; placed: number }[]; chips: number | null };
type Priced = Furniture & { base: number };
type Catalog = { furniture: Priced[]; walls: { id: string; name: string; price: number; color: number }[]; floors: { id: string; name: string; price: number; color: number }[] };

/** Store showroom for one piece: a wood-plank plinth in a lit wall corner, camera framed to the piece's size. */
export function furnShowroom(f: Furniture, aspect: number) {
  const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xfff4e6, 0x3a3044, 1.5)); const dl = new THREE.DirectionalLight(0xffffff, 2); dl.position.set(3, 6, 4); sc.add(dl);
  const s = Math.max(f.w, f.d, f.h, 1), P = s * 1.5; const room = new THREE.Group(); room.userData.part = 'showroom';
  const plank = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.65 }), seam = new THREE.MeshStandardMaterial({ color: 0x5e4129, roughness: 0.8 });
  const fl = new THREE.Mesh(new THREE.BoxGeometry(P * 2, 0.08, P * 2), plank); fl.position.y = -0.04; room.add(fl);
  for (let i = 1; i < 8; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(P * 2, 0.005, 0.02), seam); l.position.set(0, 0.002, -P + (i / 8) * P * 2); room.add(l); }
  const wall = new THREE.MeshStandardMaterial({ color: 0xe9e1d4, roughness: 0.95 }), trim = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  const wb = new THREE.Mesh(new THREE.BoxGeometry(P * 2, s * 1.6, 0.06), wall); wb.position.set(0, s * 0.8, -P); const wl = new THREE.Mesh(new THREE.BoxGeometry(0.06, s * 1.6, P * 2), wall); wl.position.set(-P, s * 0.8, 0); room.add(wb, wl);
  const sb = new THREE.Mesh(new THREE.BoxGeometry(P * 2, 0.12, 0.03), trim); sb.position.set(0, 0.06, -P + 0.045); const sl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, P * 2), trim); sl.position.set(-P + 0.045, 0.06, 0); room.add(sb, sl); sc.add(room);
  const piece = buildFurniture(f); sc.add(piece);
  const cam = new THREE.PerspectiveCamera(35, aspect, 0.05, 100); const R = Math.hypot(f.w, f.d, f.h) * 0.5 + 0.2, dist = R / Math.sin((35 * Math.PI) / 360) * 1.05;
  const dir = new THREE.Vector3(1, 0.62, 1.1).normalize(); cam.position.copy(dir.multiplyScalar(dist)).add(new THREE.Vector3(0, f.h * 0.45, 0)); cam.lookAt(0, f.h * 0.45, 0);
  return { scene: sc, camera: cam, piece };
}

/** Rotating 3D preview of one furniture piece. */
function FurnPreview({ f }: { f: Furniture }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return; let r: THREE.WebGLRenderer; try { r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); } catch { return; }
    r.setPixelRatio(Math.min(2, devicePixelRatio)); r.toneMapping = THREE.ACESFilmicToneMapping;
    const { scene: sc, camera: cam, piece: g } = furnShowroom(f, (cv.clientWidth || 300) / (cv.clientHeight || 180));
    // Keep the renderer and camera in step with the canvas (the panel reflows on mobile; a fixed aspect squashed the piece).
    const fit = () => { const w = cv.clientWidth || 300, h = cv.clientHeight || 180; r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }; fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null; ro?.observe(cv);
    let raf = 0; const loop = () => { raf = requestAnimationFrame(loop); g.rotation.y += 0.01; r.render(sc, cam); }; loop();
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); r.dispose(); };
  }, [f]);
  return <canvas ref={ref} className="furn-preview" data-testid="furn-preview" />;
}

/** The Furniture Store (city landmark): categories, prices, 3D preview; purchases go to your furniture inventory. */
export function FurnitureStore({ onClose }: { onClose: () => void }) {
  const [cat, setCat] = useState<FurnCat | 'walls' | 'floors'>('seating'); const [cg, setCg] = useState<Catalog | null>(null); const [lk, setLk] = useState<Locker | null>(null);
  const [sel, setSel] = useState('sofa'); const [qty, setQty] = useState(1); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => { void request('furn_locker').then((a) => { if (a.ok) setLk(a as unknown as Locker); }); }, []);
  useEffect(() => { void request('furn_catalog').then((a) => { if (a.ok) setCg(a as unknown as Catalog); }); load(); }, [load]);
  const have = (k: string) => lk?.items.find((x) => x.item === k);
  const f = cg?.furniture.find((x) => x.id === sel) ?? (FURN_BY_ID.get(sel) as Priced | undefined);
  const buy = async (item: string, n: number) => { setBusy(true); setMsg(null); const a = await request('furn_buy', { item, qty: n }); setBusy(false); setMsg(a.ok ? `🛋️ Bought for 🪙 ${chips(Number((a as unknown as { price: number }).price))}. It's in your furniture inventory: enter a home and press Build to place it.` : a.error ?? 'Could not buy that.'); load(); };
  const styles = cat === 'walls' ? cg?.walls ?? [] : cat === 'floors' ? cg?.floors ?? [] : [];
  return (
    <div className="furn-store" data-testid="furniture-store" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <MapSheet className="furn-box">
        <header><h3>🛋️ Chud Home Furnishings</h3>{lk?.chips != null && <span className="dealer-chips">🪙 {chips(lk.chips)}</span>}<button type="button" onClick={onClose} aria-label="Close" data-testid="furn-close">✕</button></header>
        <nav className="furn-cats">{FURN_CATS.map((c) => <button key={c.id} type="button" className={cat === c.id ? 'on' : ''} onClick={() => { setCat(c.id); const first = cg?.furniture.find((x) => x.cat === c.id); if (first) setSel(first.id); }} data-testid={`furn-cat-${c.id}`}>{c.icon} {c.label}</button>)}
          <button type="button" className={cat === 'walls' ? 'on' : ''} onClick={() => setCat('walls')} data-testid="furn-cat-walls">🧱 Walls</button><button type="button" className={cat === 'floors' ? 'on' : ''} onClick={() => setCat('floors')} data-testid="furn-cat-floors">🟫 Floors</button></nav>
        {cat === 'walls' || cat === 'floors' ? <div className="furn-styles">{styles.map((s) => { const k = styleKey(cat === 'walls' ? 'wall' : 'floor', s.id); const own = s.price === 0 || !!have(k); return (
          <div key={s.id} className="furn-style"><span style={{ background: hex(s.color) }} /><b>{s.name}</b><small>{s.price ? `🪙 ${chips(s.price)}` : 'Free'}</small>
            {own ? <em>Owned</em> : <button type="button" disabled={busy} onClick={() => void buy(k, 1)} data-testid={`furn-buy-${k}`}>Buy</button>}</div>); })}</div>
          : <div className="furn-body">
            <ul className="furn-list">{(cg?.furniture ?? []).filter((x) => x.cat === cat).map((x) => <li key={x.id}><button type="button" className={x.id === sel ? 'on' : ''} onClick={() => { setSel(x.id); setMsg(null); }} data-testid={`furn-item-${x.id}`}><span>{x.icon} {x.name}</span><b>🪙 {chips(x.price)}</b><small>own {have(x.id)?.qty ?? 0}</small></button></li>)}</ul>
            {f && <div className="furn-detail"><FurnPreview f={f} /><h4>{f.icon} {f.name}</h4><small>{f.w}×{f.d} tiles · {have(f.id) ? `you own ${have(f.id)!.qty} (${have(f.id)!.placed} placed)` : 'not owned yet'}</small>
              <div className="furn-buy">Qty <select value={qty} onChange={(e) => setQty(+e.target.value)} data-testid="furn-qty">{[1, 2, 4, 6, 10].map((n) => <option key={n} value={n}>{n}</option>)}</select>
                <button type="button" disabled={busy} onClick={() => void buy(f.id, qty)} data-testid="furn-buy">{busy ? '…' : `Buy for 🪙 ${chips(f.price * qty)}`}</button></div></div>}
          </div>}
        {msg && <small role="status" className="furn-msg" data-testid="furn-msg">{msg}</small>}
        <small className="opacity-60">Furniture is final sale (no buy-back). Selling a house returns its furniture to your inventory.</small>
      </MapSheet>
    </div>
  );
}

type Peer = { sid: string; name: string; x: number; z: number; ry: number };
type HomeView = { id: string; owner: string; layout: HomeLayout; access: HomeAccess; invites: string[] };
type ChatLine = { sid: string; name: string; text: string; at: number };
let leftHome: string | null = null;
const uid = () => Math.random().toString(36).slice(2, 10);

function nameTag(name: string, color = '#e8c26a') { const t = drawLabel(name, { bg: 'rgba(10,8,22,0.82)', border: color, text: '#dcd8e6' }); const s = new THREE.Sprite(labelMaterial(t)); s.scale.set(1.6, 0.4, 1); s.position.y = 2.2; return s; }

/** The interior: a GRID_W × GRID_D room, avatars, chat, and (owner) build mode. */
export function HomeInterior({ me, enter, onClose }: { me: string; enter: { home: HomeView; owner: boolean; peers: Peer[]; me: string; locker?: Locker }; onClose: (why?: string) => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [home, setHome] = useState(enter.home); const [peers, setPeers] = useState<Peer[]>(enter.peers); const [chat, setChat] = useState<ChatLine[]>([]); const [say, setSay] = useState('');
  const [build, setBuild] = useState(false); const [locker, setLocker] = useState<Locker | undefined>(enter.locker); const [hold, setHold] = useState<Placed | null>(null); const [pick, setPick] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null); const [showAccess, setShowAccess] = useState(false); const [inv, setInv] = useState(enter.home.invites.join(', '));
  const label = propertyById(home.id)?.label ?? home.id; const owner = enter.owner;
  const st = useRef({ me: enter.me, layout: home.layout, peers: new Map<string, Peer>(enter.peers.map((p) => [p.sid, p])), hold: null as Placed | null, pick: null as string | null, build: false, ghostOk: true, target: null as THREE.Vector3 | null, dirty: 0 });
  st.current.layout = home.layout; st.current.hold = hold; st.current.pick = pick; st.current.build = build;
  const free = useMemo(() => { const m = new Map<string, number>(); for (const it of locker?.items ?? []) if (FURN_BY_ID.has(it.item)) m.set(it.item, it.qty - it.placed); for (const p of home.layout.items) m.set(p.f, (m.get(p.f) ?? 0)); return m; }, [locker, home.layout]);
  const save = useCallback(async (layout: HomeLayout) => {
    const prev = st.current.layout; setHome((h) => ({ ...h, layout }));
    const a = await request('home_save', { id: home.id, layout }); if (!a.ok) { setHome((h) => ({ ...h, layout: prev })); setMsg(a.error ?? 'Could not save.'); return false; }
    setLocker((a as unknown as { locker: Locker }).locker); setMsg(null); return true;
  }, [home.id]);
  const saveRef = useRef(save); saveRef.current = save;

  // socket wiring
  useEffect(() => {
    const onPeers = (d: { id: string; peers: Peer[] }) => { if (d.id !== home.id) return; st.current.peers = new Map(d.peers.map((p) => [p.sid, { ...(st.current.peers.get(p.sid) ?? p), name: p.name }])); setPeers(d.peers); };
    const onPos = (d: { sid: string; x: number; z: number; ry: number }) => { const p = st.current.peers.get(d.sid); if (p) Object.assign(p, d); };
    const onChat = (d: ChatLine) => setChat((c) => [...c.slice(-30), d]);
    const onLayout = (d: { id: string; layout: HomeLayout }) => { if (d.id === home.id) setHome((h) => ({ ...h, layout: d.layout })); };
    const onKick = (d: { id: string; why: string }) => { if (d.id === home.id) onClose(d.why); };
    // A dropped socket makes the server drop us from the room; on reconnect, walk back in (same access check) so peers stay in sync.
    const onReconnect = (delay = 400) => { setTimeout(() => { void request('home_enter', { id: home.id }).then((a) => { if (!a.ok) { onClose(a.error ?? 'You were disconnected.'); return; } const r = a as unknown as { peers: Peer[]; home: HomeView; me: string }; const old = st.current.peers.get(st.current.me); st.current.me = r.me; const mine = r.peers.find((p) => p.sid === r.me); if (old && mine) { mine.x = old.x; mine.z = old.z; } onPeers({ id: home.id, peers: r.peers }); setHome((h) => ({ ...h, layout: r.home.layout, access: r.home.access })); }); }, delay); };
    // React may tear this effect down and set it up again without leaving the room in the UI (StrictMode, fast refresh): rejoin then.
    if (leftHome === home.id) { leftHome = null; onReconnect(0); }
    const onConnect = () => onReconnect();
    socket.on('home_peers', onPeers); socket.on('home_pos', onPos); socket.on('home_chat', onChat); socket.on('home_layout', onLayout); socket.on('home_kicked', onKick); socket.on('connect', onConnect);
    return () => { socket.off('home_peers', onPeers); socket.off('home_pos', onPos); socket.off('home_chat', onChat); socket.off('home_layout', onLayout); socket.off('home_kicked', onKick); socket.off('connect', onConnect); leftHome = home.id; void request('home_leave'); };
  }, [home.id, onClose]);

  // three.js room
  const sceneApi = useRef<{ setLayout: (l: HomeLayout) => void } | null>(null);
  useEffect(() => {
    const c = cv.current; if (!c) return; let r: THREE.WebGLRenderer; try { r = new THREE.WebGLRenderer({ canvas: c, antialias: true }); } catch { return; }
    r.setPixelRatio(Math.min(2, devicePixelRatio)); r.shadowMap.enabled = true;
    const sc = new THREE.Scene(); sc.background = new THREE.Color(0x14121c);
    sc.add(new THREE.HemisphereLight(0xfff4e0, 0x404050, 1.3)); const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(4, 12, 9); sun.castShadow = true; sun.shadow.camera.left = -10; sun.shadow.camera.right = 10; sun.shadow.camera.top = 10; sun.shadow.camera.bottom = -10; sun.target.position.set(GRID_W / 2, 0, GRID_D / 2); sc.add(sun, sun.target);
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 200); cam.position.set(GRID_W / 2, 12, GRID_D + 8); cam.lookAt(GRID_W / 2, 0, GRID_D / 2 - 0.5);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.8 }); const wallMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.9, side: THREE.DoubleSide });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(GRID_W, GRID_D), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.set(GRID_W / 2, 0, GRID_D / 2); floor.receiveShadow = true; sc.add(floor);
    const grid = new THREE.GridHelper(Math.max(GRID_W, GRID_D), Math.max(GRID_W, GRID_D), 0xffffff, 0xffffff); (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.18; grid.position.set(Math.max(GRID_W, GRID_D) / 2, 0.01, Math.max(GRID_W, GRID_D) / 2); grid.visible = false; sc.add(grid);
    const wb = new THREE.Mesh(new THREE.PlaneGeometry(GRID_W, 3.2), wallMat); wb.position.set(GRID_W / 2, 1.6, 0); sc.add(wb);
    const wl = new THREE.Mesh(new THREE.PlaneGeometry(GRID_D, 3.2), wallMat); wl.rotation.y = Math.PI / 2; wl.position.set(0, 1.6, GRID_D / 2); sc.add(wl);
    const wr = new THREE.Mesh(new THREE.PlaneGeometry(GRID_D, 3.2), wallMat); wr.rotation.y = -Math.PI / 2; wr.position.set(GRID_W, 1.6, GRID_D / 2); sc.add(wr);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshStandardMaterial({ color: 0x9fd4ff, emissive: 0x4a7aa0, emissiveIntensity: 0.6 })); win.position.set(GRID_W / 2, 1.8, 0.02); sc.add(win);
    const furn = new THREE.Group(); sc.add(furn); const items = new Map<string, THREE.Group>();
    const place = (g: THREE.Object3D, p: Placed) => { const f = FURN_BY_ID.get(p.f)!; const { w, d } = footprint(f, p.r); g.position.set(p.x + w / 2, 0, p.z + d / 2); g.rotation.y = -p.r * Math.PI / 2; };
    const setLayout = (l: HomeLayout) => {
      floorMat.color.setHex(FLOOR_BY_ID.get(l.floor)?.color ?? 0xb08a5a); wallMat.color.setHex(WALL_BY_ID.get(l.wall)?.color ?? 0xe8e2d6);
      for (const [k, g] of items) if (!l.items.some((p) => p.uid === k)) { furn.remove(g); items.delete(k); }
      for (const p of l.items) { let g = items.get(p.uid); if (!g || g.userData.f !== p.f) { if (g) furn.remove(g); g = buildFurniture(FURN_BY_ID.get(p.f)!); g.userData.f = p.f; g.traverse((o) => { o.userData.uid = p.uid; }); items.set(p.uid, g); furn.add(g); } place(g, p); }
    };
    sceneApi.current = { setLayout }; setLayout(st.current.layout);
    // ghost for placement
    let ghost: THREE.Group | null = null; let ghostKey = '';
    const ghostMat = new THREE.MeshBasicMaterial({ color: 0x5aff8a, transparent: true, opacity: 0.45 });
    // avatars
    const rigs = new Map<string, { rig: MinerRig; tag: THREE.Sprite }>();
    const myPos = { x: enter.peers.find((p) => p.sid === enter.me)?.x ?? 1.5, z: enter.peers.find((p) => p.sid === enter.me)?.z ?? 8.5, ry: Math.PI };
    const keys = new Set<string>(); const kd = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.tagName === 'INPUT') return; keys.add(e.key.toLowerCase());
      if (e.key.toLowerCase() === 'r' && st.current.build) window.dispatchEvent(new Event('home-rotate')); if (e.key === 'Delete' || e.key === 'Backspace') window.dispatchEvent(new Event('home-delete')); };
    const ku = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase()); window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); const hit = new THREE.Vector3();
    const tileAt = (e: PointerEvent) => { const b = c.getBoundingClientRect(); ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1); ray.setFromCamera(ndc, cam); return ray.ray.intersectPlane(plane, hit) ? hit.clone() : null; };
    let hover: THREE.Vector3 | null = null;
    const pm = (e: PointerEvent) => { hover = tileAt(e); };
    const pd = (e: PointerEvent) => {
      const t = tileAt(e); if (!t) return;
      if (st.current.build && st.current.hold) { window.dispatchEvent(new CustomEvent('home-drop', { detail: { x: Math.floor(t.x - (footprint(FURN_BY_ID.get(st.current.hold.f)!, st.current.hold.r).w - 1) / 2), z: Math.floor(t.z - (footprint(FURN_BY_ID.get(st.current.hold.f)!, st.current.hold.r).d - 1) / 2) } })); return; }
      if (st.current.build) { ray.setFromCamera(ndc, cam); const h = ray.intersectObjects(furn.children, true)[0]; window.dispatchEvent(new CustomEvent('home-pick', { detail: h ? h.object.userData.uid : null })); return; }
      st.current.target = t;
    };
    c.addEventListener('pointermove', pm); c.addEventListener('pointerdown', pd);
    let raf = 0; let last = performance.now(); let sent = 0; let selBox: THREE.BoxHelper | null = null;
    const loop = () => {
      raf = requestAnimationFrame(loop); const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const W = c.clientWidth, H = c.clientHeight; if (r.domElement.width !== Math.floor(W * r.getPixelRatio())) { r.setSize(W, H, false); cam.aspect = W / Math.max(1, H); cam.updateProjectionMatrix(); }
      // my movement: WASD/arrows or click-to-walk
      let vx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0), vz = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
      if (vx || vz) st.current.target = null; else if (st.current.target) { const dx = st.current.target.x - myPos.x, dz = st.current.target.z - myPos.z; const dd = Math.hypot(dx, dz); if (dd < 0.1) st.current.target = null; else { vx = dx / dd; vz = dz / dd; } }
      if (vx || vz) { const n = Math.hypot(vx, vz); myPos.x = Math.min(GRID_W - 0.3, Math.max(0.3, myPos.x + (vx / n) * 3 * dt)); myPos.z = Math.min(GRID_D - 0.3, Math.max(0.3, myPos.z + (vz / n) * 3 * dt)); myPos.ry = Math.atan2(vx, vz); if (now - sent > 150) { sent = now; socket.emit('home_pos', myPos); } }
      const me2 = st.current.peers.get(st.current.me); if (me2) Object.assign(me2, myPos);
      for (const p of st.current.peers.values()) {
        let a = rigs.get(p.sid); if (!a) { const rig = buildMiner(null); rig.pick.visible = false; rig.root.scale.setScalar(0.55); const tag = nameTag(p.name, p.sid === st.current.me ? '#5affc8' : '#e8c26a'); tag.scale.set(1.6 / 0.55, 0.4 / 0.55, 1); tag.position.y = 2.2 / 0.55 * 0.75; rig.root.add(tag); sc.add(rig.root); rig.root.position.set(p.x, 0, p.z); a = { rig, tag }; rigs.set(p.sid, a); }
        const rp = a.rig.root.position; rp.x += (p.x - rp.x) * Math.min(1, dt * 10); rp.z += (p.z - rp.z) * Math.min(1, dt * 10); a.rig.root.rotation.y = p.ry - Math.PI / 2; animateMiner(a.rig, dt, 0);
      }
      for (const [sid, a] of rigs) if (!st.current.peers.has(sid)) { sc.remove(a.rig.root); rigs.delete(sid); }
      grid.visible = st.current.build;
      // placement ghost
      const h = st.current.build ? st.current.hold : null;
      if (h && hover) { const f = FURN_BY_ID.get(h.f)!; const k = h.f; if (ghostKey !== k) { if (ghost) sc.remove(ghost); ghost = buildFurniture(f); ghost.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = ghostMat; }); sc.add(ghost); ghostKey = k; }
        const { w, d } = footprint(f, h.r); const p = { ...h, x: Math.floor(hover.x - (w - 1) / 2), z: Math.floor(hover.z - (d - 1) / 2) }; place(ghost!, p); ghost!.visible = true; ghostMat.color.setHex(fits(st.current.layout.items, p, h.uid) ? 0x5aff8a : 0xff5a5a); }
      else if (ghost) ghost.visible = false;
      if (selBox) { sc.remove(selBox); selBox = null; } const sel = st.current.pick && items.get(st.current.pick); if (sel && st.current.build) { selBox = new THREE.BoxHelper(sel, 0x5affc8); sc.add(selBox); }
      for (const [k, g] of items) g.visible = !(h && h.uid === k);
      r.render(sc, cam);
    };
    loop();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); c.removeEventListener('pointermove', pm); c.removeEventListener('pointerdown', pd); r.dispose(); sceneApi.current = null; };
  }, [enter.me, enter.peers]);
  useEffect(() => { sceneApi.current?.setLayout(home.layout); }, [home.layout]);

  // build-mode actions (events from the canvas + buttons)
  useEffect(() => {
    const drop = (e: Event) => { const h = st.current.hold; if (!h) return; const { x, z } = (e as CustomEvent<{ x: number; z: number }>).detail; const p = { ...h, x, z };
      if (!fits(st.current.layout.items, p, h.uid)) { setMsg("That doesn't fit there."); return; }
      const items = [...st.current.layout.items.filter((i) => i.uid !== h.uid), p]; setHold(null); setPick(p.uid); void saveRef.current({ ...st.current.layout, items }); };
    const pk = (e: Event) => setPick((e as CustomEvent<string | null>).detail);
    const rot = () => { const h = st.current.hold; if (h) { setHold({ ...h, r: (h.r + 1) % 4 }); return; } const id = st.current.pick; const p = st.current.layout.items.find((i) => i.uid === id); if (!p) return; const q = { ...p, r: (p.r + 1) % 4 };
      if (!fits(st.current.layout.items, q, p.uid)) { setMsg('No room to rotate it here.'); return; } void saveRef.current({ ...st.current.layout, items: st.current.layout.items.map((i) => (i.uid === p.uid ? q : i)) }); };
    const del = () => { const id = st.current.pick; if (!id || !st.current.build) return; setPick(null); void saveRef.current({ ...st.current.layout, items: st.current.layout.items.filter((i) => i.uid !== id) }); };
    window.addEventListener('home-drop', drop); window.addEventListener('home-pick', pk); window.addEventListener('home-rotate', rot); window.addEventListener('home-delete', del);
    return () => { window.removeEventListener('home-drop', drop); window.removeEventListener('home-pick', pk); window.removeEventListener('home-rotate', rot); window.removeEventListener('home-delete', del); };
  }, []);

  const send = () => { const t = say.trim(); if (!t) return; socket.emit('home_chat', t); setSay(''); };
  const setAccess = async (access: HomeAccess) => { const a = await request('home_access', { id: home.id, access, invites: inv.split(/[,\s]+/).filter(Boolean) }); if (a.ok) { const h = (a as unknown as { home: HomeView }).home; setHome((x) => ({ ...x, access: h.access, invites: h.invites })); setMsg(`🔐 ${ACCESS_LABEL[h.access]}${h.access === 'invite' ? ` · ${h.invites.length} invited` : ''}`); } else setMsg(a.error ?? 'Could not change access.'); };
  const myStyles = (kind: 'wall' | 'floor') => (kind === 'wall' ? WALL_STYLES : FLOOR_STYLES).filter((s) => s.price === 0 || locker?.items.some((i) => i.item === styleKey(kind, s.id)));
  const picked = home.layout.items.find((i) => i.uid === pick);
  return (
    <div className="home-int" data-testid="home-interior">
      <canvas ref={cv} className="home-canvas" data-testid="home-canvas" />
      <header className="home-top"><b data-testid="home-title">🏠 {owner ? 'Your home' : `${home.owner}'s home`} · {label}</b>
        <span className="home-peers" data-testid="home-peers">👥 {peers.map((p) => p.name).join(', ')}</span>
        {owner && <button type="button" className={build ? 'on' : ''} onClick={() => { setBuild(!build); setHold(null); setPick(null); }} data-testid="home-build">{build ? '✓ Done building' : '🔨 Build'}</button>}
        {owner && <button type="button" onClick={() => setShowAccess(!showAccess)} data-testid="home-access-btn">🔐 {ACCESS_LABEL[home.access]}</button>}
        <button type="button" onClick={() => onClose()} data-testid="home-exit">🚪 Leave</button></header>
      {owner && showAccess && <div className="home-access" data-testid="home-access">
        {(['open', 'invite', 'locked'] as HomeAccess[]).map((a) => <label key={a}><input type="radio" checked={home.access === a} onChange={() => void setAccess(a)} data-testid={`home-access-${a}`} /> {ACCESS_LABEL[a]}</label>)}
        <input value={inv} onChange={(e) => setInv(e.target.value)} placeholder="Invite: names, comma separated" data-testid="home-invites" /><button type="button" onClick={() => void setAccess(home.access)} data-testid="home-invites-save">Save invites</button></div>}
      {build && <aside className="home-build" data-testid="home-build-panel">
        <h4>Your furniture</h4>
        <ul>{[...free].filter(([, n]) => n > 0).map(([f, n]) => { const x = FURN_BY_ID.get(f)!; return <li key={f}><button type="button" className={hold?.f === f && !st.current.layout.items.some((i) => i.uid === hold.uid) ? 'on' : ''} onClick={() => { setPick(null); setHold({ uid: uid(), f, x: 0, z: 0, r: 0 }); }} data-testid={`home-inv-${f}`}>{x.icon} {x.name} <small>×{n}</small></button></li>; })}
          {![...free].some(([, n]) => n > 0) && <li><small>Nothing left to place.</small></li>}</ul>
        <button type="button" onClick={openFurnitureStore} data-testid="home-shop">🛋️ Furniture Store</button>
        {picked && <div className="home-sel" data-testid="home-selected"><b>{FURN_BY_ID.get(picked.f)?.name}</b>
          <button type="button" onClick={() => { setHold(picked); }} data-testid="home-move">✥ Move</button><button type="button" onClick={() => window.dispatchEvent(new Event('home-rotate'))} data-testid="home-rotate">⟳ Rotate</button><button type="button" onClick={() => window.dispatchEvent(new Event('home-delete'))} data-testid="home-remove">🗑 Remove</button></div>}
        {hold && <div className="home-sel"><small>Click the floor to place. R rotates.</small><button type="button" onClick={() => window.dispatchEvent(new Event('home-rotate'))}>⟳ Rotate</button><button type="button" onClick={() => setHold(null)}>Cancel</button></div>}
        <h4>Walls</h4><div className="home-swatches">{myStyles('wall').map((s) => <button key={s.id} type="button" title={s.name} className={home.layout.wall === s.id ? 'on' : ''} style={{ background: hex(s.color) }} onClick={() => void save({ ...home.layout, wall: s.id })} data-testid={`home-wall-${s.id}`} />)}</div>
        <h4>Floors</h4><div className="home-swatches">{myStyles('floor').map((s) => <button key={s.id} type="button" title={s.name} className={home.layout.floor === s.id ? 'on' : ''} style={{ background: hex(s.color) }} onClick={() => void save({ ...home.layout, floor: s.id })} data-testid={`home-floor-${s.id}`} />)}</div>
        <small className="opacity-60">Buy more styles at the Furniture Store.</small>
      </aside>}
      <div className="home-chat" data-testid="home-chat">
        <ul>{chat.map((m) => <li key={m.at + m.sid}><b>{m.name}:</b> {m.text}</li>)}</ul>
        <form onSubmit={(e) => { e.preventDefault(); send(); }}><input value={say} onChange={(e) => setSay(e.target.value)} maxLength={160} placeholder={`Say something to ${peers.length > 1 ? 'everyone here' : 'the room'}…`} data-testid="home-chat-input" /><button type="submit" data-testid="home-chat-send">Send</button></form>
      </div>
      {msg && <div className="home-msg" role="status" data-testid="home-msg">{msg}</div>}
      <small className="home-help">{build ? 'Pick furniture, then click the floor. Click a piece to select it.' : 'WASD / arrows or click the floor to walk.'}{me ? '' : ''}</small>
    </div>
  );
}

/** Profile button(s): visit a player's home(s) if they allow it. */
export function VisitHomeButtons({ player, close }: { player: string; close: () => void }) {
  const [homes, setHomes] = useState<{ id: string; label: string; access: HomeAccess; canVisit: boolean }[]>([]);
  useEffect(() => { let dead = false; void request('home_of', { player }).then((a) => { if (!dead && a.ok) setHomes((a as unknown as { homes: typeof homes }).homes ?? []); }); return () => { dead = true; }; }, [player]);
  if (!homes.length) return null;
  return <>{homes.slice(0, 3).map((h) => <button key={h.id} type="button" disabled={!h.canVisit} title={h.canVisit ? undefined : ACCESS_LABEL[h.access]} className="ml-1 mt-1 rounded bg-white/10 px-2 py-0.5 text-xs hover:bg-white/20 disabled:opacity-40" onClick={() => { close(); enterHome(h.id); }} data-testid={`profile-visit-${h.id}`}>🚪 Visit {h.label}{h.canVisit ? '' : ' 🔒'}</button>)}</>;
}

/** Mounted once at the app root: opens the store / a home on OPEN_FURNITURE / ENTER_HOME. */
export function HomesHost() {
  const me = useAccount(); const [store, setStore] = useState(false); const [inside, setInside] = useState<null | Parameters<typeof HomeInterior>[0]['enter']>(null); const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    const s = () => setStore(true);
    const e = (ev: Event) => { const id = (ev as CustomEvent<string>).detail; void request('home_enter', { id }).then((a) => { if (a.ok) { setNote(null); setInside(a as never); } else setNote(a.error ?? 'Could not enter.'); }); };
    window.addEventListener(OPEN_FURNITURE, s); window.addEventListener(ENTER_HOME, e); return () => { window.removeEventListener(OPEN_FURNITURE, s); window.removeEventListener(ENTER_HOME, e); };
  }, []);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 4000); return () => clearTimeout(t); }, [note]);
  const leave = useCallback((why?: string) => { setInside(null); if (why) setNote(why); }, []);
  return <>
    {inside && me && <HomeInterior key={inside.home.id} me={me} enter={inside} onClose={leave} />}
    {store && <FurnitureStore onClose={() => setStore(false)} />}
    {note && <div className="home-note" role="alert" data-testid="home-note">{note}</div>}
  </>;
}
