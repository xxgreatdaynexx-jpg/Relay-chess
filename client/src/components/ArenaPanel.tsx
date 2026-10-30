import { TopTab } from '@/components/TopTabs';
import { useWindowDrag } from '@/lib/windowDrag';
import { useEffect, useRef, useState } from 'react';
import { socket } from '@/lib/net';
import { FPS_KEY, fpsFrom, hotkeyFor, isLockedTo, readFpsPref } from '@/lib/arenaInput';
import { ArenaRenderer, minimapSize } from '@/lib/arenaRender';
import type { Arena3D, Fx3D, Soldier3D } from '@/lib/arena3d';
import { playExplosion, playHit, playStreakCall, playWeaponShot, unlockSounds } from '@/lib/sounds';
import {
  AIRSTRIKE_RADIUS, clampPitch, EYE_HEIGHT, mapById, MAP, MAPS, MAX_HP, MAX_PITCH, MOVE_SPEED, moveHorizontal, stepVertical, STREAKS, tryJump, SWITCH_MS, TICK_HZ, WEAPON_ORDER, WEAPONS, type WeaponId,
} from '../../../shared/fps';

const OPEN_KEY = 'relay-fps-open';
const QUALITY_KEY = 'relay-fps-quality';
const MAP_KEY = 'relay-fps-map';
const MAP_LIST = Object.values(MAPS);
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const INTERP_MS = (1000 / TICK_HZ) * 1.5;
const COLORS = ['#5f6a48', '#7d7158', '#596066', '#6b6248', '#4f5a4c', '#73705f', '#565246', '#666e5a'];
const SCOPE_ZOOM = 3.5;
const FOV = 68; // vertical, degrees

interface NetPlayer { id: string; name: string; x: number; y: number; z: number; a: number; p: number; hp: number; k: number; d: number; alive: boolean; w: WeaponId; ammo: number; rl: number; g: boolean; st: number; uav: number }
interface NetState { t: number; map?: string; next?: string; picked?: boolean; left?: number; players: NetPlayer[]; drones: Array<{ ownerId: string; x: number; y: number; z: number }>; strikes: Array<{ x: number; y: number; z: number; inMs: number; r?: number; locked?: boolean }>; nuke: { by: string; inMs: number } | null }
interface Snap extends NetState { recv: number }
type Quality = 'hd' | 'lo';

function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** Pull-down shared arena shooter, fixed top-right on every screen. */
export function ArenaPanel() {
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1');
  useEffect(() => localStorage.setItem(OPEN_KEY, open ? '1' : '0'), [open]);
  return (
    <div className={`fps-wrap ${open ? 'fps-open' : ''}`} data-testid="arena">
      <TopTab id="arena"><button type="button" className="sol-tab fps-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="arena-tab">
        {open ? '▴ Arena' : '🎯 Arena'}
      </button></TopTab>
      {open && <ArenaGame onClose={() => setOpen(false)} />}
    </div>
  );
}

function ArenaGame({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef(MAP);
  const [glError, setGlError] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const win = useWindowDrag('arena', wrapRef);
  const [status, setStatus] = useState('Joining the arena…');
  const [feed, setFeed] = useState<Array<{ key: number; killer: string; victim: string; cause: string; self: boolean; mine: boolean }>>([]);
  const [showBoard, setShowBoard] = useState(false);
  const [board, setBoard] = useState<NetPlayer[]>([]);
  const [focused, setFocused] = useState(false);
  const [locked, setLocked] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showFps, setShowFps] = useState(() => readFpsPref(typeof localStorage !== 'undefined' ? localStorage : undefined));
  const fpsRef = useRef<HTMLDivElement>(null);
  const pickRef = useRef<HTMLSpanElement>(null);
  useEffect(() => { try { localStorage.setItem(FPS_KEY, showFps ? '1' : '0'); } catch { /* ignore */ } }, [showFps]);
  const [isTouch] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches);
  const [quality, setQuality] = useState<Quality>(() => (localStorage.getItem(QUALITY_KEY) as Quality) || (isTouch ? 'lo' : 'hd'));
  const qualityRef = useRef(quality);
  useEffect(() => { qualityRef.current = quality; localStorage.setItem(QUALITY_KEY, quality); }, [quality]);
  const keys = useRef(new Set<string>());
  const me = useRef({
    id: '', x: 1.5, y: 1.5, z: 0, vz: 0, grounded: true, p: 0, a: 0, alive: true, hp: MAX_HP, joined: false, weapon: 'pistol' as WeaponId,
    ammo: WEAPONS.pistol.mag, reloadUntil: 0, switchedAt: -1e9, lastShot: {} as Partial<Record<WeaponId, number>>,
    jumpAt: -1e9, scoped: false, firing: false, streak: 0, uavUntil: 0, walk: 0,
  });
  const snaps = useRef<Snap[]>([]);
  const fx = useRef({ muzzle: 0, hurt: 0, hitmark: 0, killmark: 0, nukeFlash: 0, dmgDirs: [] as Array<{ a: number; at: number }>, deaths: new Map<string, { at: number; x: number; y: number; z: number; a: number; name: string }>(), booms: [] as Array<{ x: number; y: number; z: number; at: number; big: boolean }>, tracers: [] as Array<{ o: [number, number, number]; e: [number, number, number]; at: number }>, hitAt: new Map<string, number>(), shake: 0, jetAt: 0 });
  const banner = useRef<{ text: string; sub: string; at: number } | null>(null);
  const touch = useRef({ up: false, down: false, left: false, right: false, lookUp: false, lookDown: false });
  const [mapInfo, setMapInfo] = useState<{ map: string; next: string; picked: boolean; secs: number }>({ map: MAP.id, next: '', picked: false, secs: 0 });

  function setWeapon(w: WeaponId) {
    const m = me.current;
    if (m.weapon === w) return;
    m.weapon = w;
    m.switchedAt = performance.now();
    m.reloadUntil = 0;
    m.scoped = false;
    socket.emit('fps_weapon', { w });
  }
  function cycleWeapon(dir: number) {
    const i = WEAPON_ORDER.indexOf(me.current.weapon);
    setWeapon(WEAPON_ORDER[(i + dir + WEAPON_ORDER.length) % WEAPON_ORDER.length]);
  }
  function reload() {
    const m = me.current;
    const spec = WEAPONS[m.weapon];
    if (m.reloadUntil || m.ammo >= spec.mag) return;
    m.reloadUntil = performance.now() + spec.reloadMs;
    socket.emit('fps_reload');
  }
  function jump() {
    const m = me.current;
    const now = performance.now();
    if (!m.joined || !m.alive || !tryJump(m)) return;
    m.jumpAt = now;
    socket.emit('fps_jump');
  }
  function setScope(on: boolean) {
    const m = me.current;
    const next = on && m.weapon === 'sniper';
    if (next === m.scoped) return;
    m.scoped = next;
    socket.emit('fps_scope', { on: next });
  }
  function shoot() {
    const m = me.current;
    const now = performance.now();
    const spec = WEAPONS[m.weapon];
    if (!m.joined || !m.alive) return;
    if (m.reloadUntil && now < m.reloadUntil) return;
    if (now - m.switchedAt < SWITCH_MS) return;
    if (now - (m.lastShot[m.weapon] ?? -1e9) < spec.cooldownMs) return;
    if (m.ammo <= 0) return reload();
    m.lastShot[m.weapon] = now;
    m.ammo -= 1;
    if (m.ammo === 0) m.reloadUntil = now + spec.reloadMs;
    fx.current.muzzle = now;
    playWeaponShot(m.weapon);
    socket.emit('fps_shoot', { a: m.a, p: m.p });
  }

  // Networking
  useEffect(() => {
    const join = () => {
      const qaBots = Number(new URLSearchParams(window.location.search).get('arenaBots')) || 0;
      const want = localStorage.getItem(MAP_KEY);
      socket.timeout(8000).emit('fps_join', { ...(qaBots ? { qaBots } : {}), ...(want && MAPS[want] ? { map: want } : {}) }, (err: Error | null, ack?: { ok: boolean; id?: string; x?: number; y?: number; z?: number; a?: number; map?: string; error?: string }) => {
        if (err || !ack?.ok) return setStatus(ack?.error || 'Could not reach the arena.');
        if (ack.map) mapRef.current = mapById(ack.map);
        Object.assign(me.current, { id: ack.id, x: ack.x, y: ack.y, z: ack.z ?? 0, vz: 0, grounded: true, p: 0, a: ack.a, joined: true, alive: true });
        setStatus('');
        // Local QA only (?arenaBots=N needs ARENA_QA_BOTS=1 on the server): read-only handle for play-test scripts.
        if (qaBots) (window as unknown as { __arenaQA?: unknown }).__arenaQA = { me: me.current, snaps: snaps.current, banner };
      });
    };
    let feedKey = 0;
    const pushFeed = (e: { killer: string; victim: string; cause: string; self: boolean; mine: boolean }) => {
      const key = ++feedKey;
      setFeed((f) => [...f.slice(-4), { key, ...e }]);
      window.setTimeout(() => setFeed((f) => f.filter((x) => x.key !== key)), 5000);
    };
    const onState = (s: NetState) => {
      snaps.current.push({ ...s, recv: performance.now() });
      if (snaps.current.length > 6) snaps.current.shift();
      const m = me.current;
      const mine = s.players.find((p) => p.id === m.id);
      const mapChanged = !!s.map && s.map !== mapRef.current.id;
      if (mapChanged) {
        mapRef.current = mapById(s.map);
        banner.current = { text: mapRef.current.name.toUpperCase(), sub: 'New map · scores reset', at: performance.now() };
      }
      if (s.map) {
        const info = { map: s.map, next: s.next ?? '', picked: !!s.picked, secs: Math.ceil((s.left ?? 0) / 1000) };
        setMapInfo((o) => (o.map === info.map && o.next === info.next && o.picked === info.picked && o.secs === info.secs ? o : info));
      }
      if (mine && mapChanged) Object.assign(m, { x: mine.x, y: mine.y, z: mine.z, vz: 0, grounded: true, p: 0 });
      if (mine) {
        if (!mine.alive && m.alive) m.alive = false;
        if (mine.alive && !m.alive) Object.assign(m, { alive: true, x: mine.x, y: mine.y, z: mine.z, vz: 0, grounded: true, p: 0, ammo: WEAPONS[m.weapon].mag, reloadUntil: 0 });
        // The server owns position (and height): if prediction drifts too far, snap to its authoritative spot.
        else if (mine.alive && (Math.hypot(m.x - mine.x, m.y - mine.y) > 1.5 || Math.abs(m.z - mine.z) > 0.8)) Object.assign(m, { x: mine.x, y: mine.y, z: mine.z, vz: 0, grounded: mine.g });
        m.hp = mine.hp;
        m.streak = mine.st;
        m.uavUntil = mine.uav ? performance.now() + mine.uav : 0;
        // The server owns the loadout: if our weapon disagrees for longer than a switch takes, adopt the server's.
        if (mine.w !== m.weapon && performance.now() - m.switchedAt > 1000) { m.weapon = mine.w; m.scoped = false; }
        if (mine.w === m.weapon) {
          m.ammo = mine.ammo;
          m.reloadUntil = mine.rl ? performance.now() + mine.rl : 0;
        }
      }
      setBoard([...s.players].sort((a, b) => b.k - a.k || a.d - b.d));
    };
    const onHit = (h: { by: string | null; target: string; cause: string }) => {
      const now = performance.now();
      fx.current.hitAt.set(h.target, now);
      if (h.by === me.current.id && h.target !== me.current.id) { fx.current.hitmark = now; playHit(); }
      else if (h.target === me.current.id) {
        fx.current.hurt = now;
        playHit(true);
        const src = snaps.current[snaps.current.length - 1]?.players.find((p) => p.id === h.by);
        if (src && h.by !== me.current.id) fx.current.dmgDirs.push({ a: Math.atan2(src.y - me.current.y, src.x - me.current.x), at: now });
      }
    };
    const onShot = (s: { id: string; w: WeaponId; o?: [number, number, number]; rays?: Array<[number, number, number]>; impact?: { x: number; y: number; z: number } }) => {
      const now = performance.now();
      if (s.id !== me.current.id) playWeaponShot(s.w, 0.35);
      if (s.o && s.rays) {
        // Tracers start a little below and ahead of the eye so your own don't sit on the crosshair.
        const [ox, oy, oz] = s.o;
        for (const [a, p, d] of s.rays.slice(0, 4)) {
          const c = Math.cos(p);
          const start: [number, number, number] = [ox + Math.cos(a) * c * 0.6, oy + Math.sin(a) * c * 0.6, oz + 1.25];
          fx.current.tracers.push({ o: start, e: [ox + Math.cos(a) * c * d, oy + Math.sin(a) * c * d, oz + EYE_HEIGHT + Math.sin(p) * d], at: now });
        }
      }
      if (s.impact) { fx.current.booms.push({ ...s.impact, at: now, big: false }); playExplosion(0.5); }
    };
    const onKill = (k: { killer: string; victim: string; killerId: string | null; victimId: string; cause: string }) => {
      const self = k.killerId === k.victimId || !k.killerId;
      if (k.killerId === me.current.id && !self) fx.current.killmark = performance.now();
      const v = snaps.current[snaps.current.length - 1]?.players.find((p) => p.id === k.victimId);
      if (v) fx.current.deaths.set(k.victimId, { at: performance.now(), x: v.x, y: v.y, z: v.z, a: v.a, name: v.name });
      pushFeed({ killer: k.killer, victim: k.victim, cause: k.cause, self, mine: k.killerId === me.current.id || k.victimId === me.current.id });
    };
    const onStreak = (s: { id: string; name: string; kind: string; title: string; streak: number }) => {
      const info = STREAKS.find((x) => x.kind === s.kind);
      const mine = s.id === me.current.id;
      const radio: Record<string, string> = { uav: mine ? 'UAV online.' : 'Enemy UAV spotted.', airstrike: mine ? 'Airstrike inbound. Danger close.' : 'Enemy airstrike inbound!', drone: mine ? 'Attack drone on station.' : 'Enemy drone overhead!', nuke: mine ? 'Tactical nuke inbound.' : 'TACTICAL NUKE INCOMING!' };
      banner.current = { text: mine ? s.title : `${s.name.toUpperCase()} · ${s.title}`, sub: `"${radio[s.kind] ?? ''}" · ${s.streak} kill streak${mine && info ? ` · ${info.blurb}` : ''}`, at: performance.now() };
      playStreakCall(s.kind === 'nuke' ? 'alarm' : 'reward');
    };
    const onBoom = (b: { x: number; y: number; z?: number; cause?: string }) => {
      const t = performance.now();
      fx.current.booms.push({ x: b.x, y: b.y, z: b.z ?? 0, at: t, big: true });
      const d = Math.hypot(b.x - me.current.x, b.y - me.current.y);
      if (d < 8) fx.current.shake = t;
      if (b.cause === 'airstrike' && t - fx.current.jetAt > 1500) fx.current.jetAt = t;
      playExplosion(Math.max(0.35, 0.9 - d / 25));
    };
    const onNuke = (n: { phase: string; by: string }) => {
      if (n.phase === 'boom') {
        fx.current.nukeFlash = performance.now();
        playExplosion(1, true);
        banner.current = { text: 'TACTICAL NUKE', sub: `"Detonation confirmed." · ${n.by} ended the round · scores reset`, at: performance.now() };
      }
    };
    socket.on('fps_state', onState);
    socket.on('fps_hit', onHit);
    socket.on('fps_shot', onShot);
    socket.on('fps_kill', onKill);
    socket.on('fps_streak', onStreak);
    socket.on('fps_boom', onBoom);
    const onDrone = () => playWeaponShot('smg', 0.3);
    socket.on('fps_drone_shot', onDrone);
    socket.on('fps_nuke', onNuke);
    socket.on('connect', join);
    if (socket.connected) join();
    else socket.connect();
    return () => {
      socket.emit('fps_leave');
      for (const [e, h] of [['fps_state', onState], ['fps_hit', onHit], ['fps_shot', onShot], ['fps_kill', onKill], ['fps_streak', onStreak], ['fps_boom', onBoom], ['fps_drone_shot', onDrone], ['fps_nuke', onNuke], ['connect', join]] as const) socket.off(e, h as never);
    };
  }, []);

  // Game loop: three.js world underneath, 2D HUD overlay on top.
  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = glRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !gl || !ctx) return;
    let g3: Arena3D | null = null;
    let cancelled = false;
    // three.js is loaded on demand so it never weighs down the rest of the site.
    import('@/lib/arena3d').then(({ Arena3D: A }) => {
      if (cancelled) return;
      try { g3 = new A(gl); raf = requestAnimationFrame(frame); } catch { setGlError('This browser could not start 3D graphics (WebGL).'); }
    }).catch(() => setGlError('Could not load the 3D engine. Refresh to try again.'));
    const r = new ArenaRenderer();
    const prevPos = new Map<string, { x: number; y: number }>();
    let raf = 0;
    let last = performance.now();
    let lastSend = 0;
    const frameTimes: number[] = [];
    let fpsShownAt = 0;
    const frame = (now: number) => {
      frameTimes.push(now); if (frameTimes.length > 30) frameTimes.shift();
      if (fpsRef.current && now - fpsShownAt > 250) { fpsShownAt = now; fpsRef.current.textContent = `${fpsFrom(frameTimes)} FPS`; }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const map = mapRef.current;
      if (!g3) return;
      g3.setMap(map);
      // Size: internal resolution follows the CSS size × devicePixelRatio (capped), or reduced in LO.
      const cssW = canvas.clientWidth || 480;
      const cssH = canvas.clientHeight || (cssW * 5) / 8;
      const scale = qualityRef.current === 'hd' ? Math.min(window.devicePixelRatio || 1, 2) : 0.6;
      const W = Math.round(Math.min(cssW * scale, 1600));
      const H = Math.round((W * cssH) / cssW);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      g3.resize(W, H);
      r.resize(W, H);
      ctx.clearRect(0, 0, W, H);
      const m = me.current;
      const k = keys.current;
      const t = touch.current;
      let moving = false;
      if (m.joined && m.alive) {
        let fwd = 0, side = 0, turn = 0, look = 0;
        if (k.has('w') || k.has('arrowup') || t.up) fwd += 1;
        if (k.has('s') || k.has('arrowdown') || t.down) fwd -= 1;
        if (k.has('a')) side -= 1;
        if (k.has('d')) side += 1;
        if (k.has('arrowleft') || k.has('q') || t.left) turn -= 1;
        if (k.has('arrowright') || k.has('e') || t.right) turn += 1;
        if (k.has('pageup')) look += 1;
        if (k.has('pagedown')) look -= 1;
        if (t.lookUp) look += 1;
        if (t.lookDown) look -= 1;
        m.a += turn * (m.scoped ? 0.8 : 2.6) * dt;
        m.p = clampPitch(m.p + look * 1.6 * dt) ?? m.p;
        const len = Math.hypot(fwd, side) || 1;
        const sp = (MOVE_SPEED * 0.95 * dt) / len * (m.scoped ? 0.5 : 1);
        // a turns from +x toward +y; "right" is +90°.
        const dx = (Math.cos(m.a) * fwd - Math.sin(m.a) * side) * sp;
        const dy = (Math.sin(m.a) * fwd + Math.cos(m.a) * side) * sp;
        // Local prediction with the exact same physics the server runs.
        moveHorizontal(m, dx, dy, map);
        stepVertical(m, dt, map);
        moving = fwd !== 0 || side !== 0;
        if (now - lastSend > 50) { lastSend = now; socket.emit('fps_move', { x: m.x, y: m.y, a: m.a, p: m.p }); }
        if (m.firing || k.has('f') || k.has('control')) shoot();
      }
      if (m.reloadUntil && now >= m.reloadUntil) { m.reloadUntil = 0; m.ammo = WEAPONS[m.weapon].mag; }
      if (moving && m.grounded) m.walk += dt * 9;
      const bob = moving && m.grounded ? Math.sin(m.walk * 2) * 0.03 : 0;
      const zoom = m.scoped && m.weapon === 'sniper' && m.alive ? SCOPE_ZOOM : 1;
      const snap = snaps.current[snaps.current.length - 1];
      const renderAt = now - INTERP_MS;
      const others = interpolate(snaps.current, renderAt).filter((p) => p.id !== m.id && p.alive);
      const soldiers: Soldier3D[] = others.map((p) => {
        const pp = prevPos.get(p.id);
        const mv = !!pp && Math.hypot(pp.x - p.x, pp.y - p.y) > 0.002;
        prevPos.set(p.id, { x: p.x, y: p.y });
        return { id: p.id, x: p.x, y: p.y, z: p.z, a: p.a, p: p.p, color: colorFor(p.id), flash: now - (fx.current.hitAt.get(p.id) ?? -1e9) < 160, moving: mv, t: now };
      });
      for (const [id, dd] of fx.current.deaths) {
        const age = (now - dd.at) / 1000;
        if (age > 1.2) { fx.current.deaths.delete(id); continue; }
        if (id === m.id || others.some((o) => o.id === id)) continue;
        soldiers.push({ id, x: dd.x, y: dd.y, z: dd.z, a: dd.a, p: 0, color: colorFor(id), flash: false, moving: false, dead: age, t: now });
      }
      fx.current.booms = fx.current.booms.filter((b) => now - b.at < 600);
      fx.current.tracers = fx.current.tracers.filter((tr) => now - tr.at < 90);
      const fx3: Fx3D = {
        drones: (snap?.drones ?? []).map((d) => ({ x: d.x, y: d.y, z: (d.z ?? 8) + Math.sin(now / 200) * 0.1 })),
        strikes: (snap?.strikes ?? []).filter((q) => q.inMs >= 0).map((q) => ({ x: q.x, y: q.y, z: q.z ?? 0, r: q.r ?? AIRSTRIKE_RADIUS })),
        booms: fx.current.booms.map((b) => ({ x: b.x, y: b.y, z: b.z, t: (now - b.at) / 600, big: b.big })),
        tracers: fx.current.tracers.map((tr) => ({ o: tr.o, e: tr.e, t: (now - tr.at) / 90 })),
      };
      const shake = now - fx.current.shake < 450 ? (1 - (now - fx.current.shake) / 450) * 0.04 : 0;
      g3.render({ x: m.x, y: m.y, z: m.z + EYE_HEIGHT + bob + (Math.random() - 0.5) * shake, a: m.a, p: m.p, zoom }, soldiers, fx3);
      // Health bars over nearby enemies you can see.
      for (const p of others) {
        const s = g3.project(p.x, p.y, p.z + 2, W, H);
        if (!s || s.dist > 18) continue;
        const bw = Math.max(16, 40 / Math.max(1, s.dist / 3)) * (H / 400);
        ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(s.sx - bw / 2, s.sy, bw, 3);
        ctx.fillStyle = p.hp > 40 ? '#cfd4c4' : '#d9473a'; ctx.fillRect(s.sx - bw / 2, s.sy, (bw * p.hp) / MAX_HP, 3);
      }
      const W2 = r.W, H2 = r.H;
      // Dust haze over the scene for a darker, grittier grade.
      const vg = ctx.createRadialGradient(W2 / 2, H2 / 2, H2 * 0.3, W2 / 2, H2 / 2, W2 * 0.7);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W2, H2);
      // Viewmodel + scope
      const muzzle = now - fx.current.muzzle < 60;
      const switching = Math.max(0, 1 - (now - m.switchedAt) / SWITCH_MS);
      const reloading = m.reloadUntil && now < m.reloadUntil ? 0.6 : 0;
      if (zoom > 1) {
        const g = ctx.createRadialGradient(W2 / 2, H2 / 2, H2 * 0.36, W2 / 2, H2 / 2, H2 * 0.4);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W2, H2);
        ctx.strokeStyle = '#000'; ctx.lineWidth = Math.max(1, H2 / 300);
        ctx.beginPath(); ctx.moveTo(0, H2 / 2); ctx.lineTo(W2, H2 / 2); ctx.moveTo(W2 / 2, 0); ctx.lineTo(W2 / 2, H2); ctx.stroke();
      } else if (m.alive) {
        r.viewmodel(ctx, m.weapon, m.walk, muzzle ? 1 : 0, Math.max(switching, reloading), muzzle);
        const cs = H2 / 40;
        const spread = (WEAPONS[m.weapon].spread * (H2 / 2)) / Math.tan(((FOV / zoom) * Math.PI) / 360) * 0.6;
        ctx.strokeStyle = 'rgba(235,240,230,.9)';
        ctx.lineWidth = Math.max(1, H2 / 300);
        ctx.beginPath();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(W2 / 2 + dx * (spread + cs * 0.4), H2 / 2 + dy * (spread + cs * 0.4)); ctx.lineTo(W2 / 2 + dx * (spread + cs), H2 / 2 + dy * (spread + cs)); }
        ctx.stroke();
        const hm = now - fx.current.hitmark;
        if (hm < 220) {
          const kill = now - fx.current.killmark < 300;
          ctx.strokeStyle = kill ? 'rgba(230,60,50,.95)' : `rgba(255,255,255,${(1 - hm / 220).toFixed(2)})`;
          ctx.lineWidth = Math.max(1.5, H2 / 180);
          const a0 = cs * 0.35, a1 = cs * 0.85;
          ctx.beginPath();
          for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { ctx.moveTo(W2 / 2 + dx * a0, H2 / 2 + dy * a0); ctx.lineTo(W2 / 2 + dx * a1, H2 / 2 + dy * a1); }
          ctx.stroke();
        }
      }
      // Red screen-edge vignette: brief on hit, persistent when low.
      const hurtK = Math.max(now - fx.current.hurt < 300 ? 1 - (now - fx.current.hurt) / 300 : 0, m.alive && m.hp <= 40 ? 0.55 + 0.15 * Math.sin(now / 250) : 0);
      if (hurtK > 0) {
        const rg = ctx.createRadialGradient(W2 / 2, H2 / 2, H2 * 0.35, W2 / 2, H2 / 2, W2 * 0.65);
        rg.addColorStop(0, 'rgba(150,0,0,0)'); rg.addColorStop(1, `rgba(150,0,0,${(0.65 * hurtK).toFixed(2)})`);
        ctx.fillStyle = rg; ctx.fillRect(0, 0, W2, H2);
      }
      // Damage direction arcs.
      fx.current.dmgDirs = fx.current.dmgDirs.filter((d) => now - d.at < 1200);
      for (const d of fx.current.dmgDirs) {
        const rel = d.a - m.a - Math.PI / 2;
        const rad = H2 * 0.22;
        ctx.strokeStyle = `rgba(220,40,30,${(0.85 * (1 - (now - d.at) / 1200)).toFixed(2)})`;
        ctx.lineWidth = Math.max(3, H2 / 70);
        ctx.beginPath(); ctx.arc(W2 / 2, H2 / 2, rad, rel - 0.35, rel + 0.35); ctx.stroke();
      }
      // HUD (military style)
      // One HUD unit: follows height, but never lets the HUD outgrow a narrow (portrait / half-screen) window.
      const u = Math.min(H2 / 200, W2 / 300);
      const mono = 'ui-monospace, Menlo, Consolas, monospace';
      /** Sets a font that makes `text` fit in maxW (shrinking from `size` units), so banners never clip. */
      const fit = (text: string, weight: string, size: number, maxW: number) => {
        let px = Math.max(8, (size * u) | 0);
        ctx.font = `${weight} ${px}px ${mono}`;
        const w = ctx.measureText(text).width;
        if (w > maxW) { px = Math.max(7, Math.floor((px * maxW) / w)); ctx.font = `${weight} ${px}px ${mono}`; }
        return px;
      };
      // Layout bands: minimap top-left, scoreboard top-right, banners below the minimap, weapon slots bottom-centre.
      const mapSize = minimapSize(W2, H2);
      const bannerTop = Math.max(H2 * 0.16, mapSize + 18);
      const spec = WEAPONS[m.weapon];
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(W2 - 92 * u, H2 - 30 * u, 88 * u, 26 * u);
      ctx.fillStyle = '#e6e9df'; ctx.font = `700 ${(14 * u) | 0}px ${mono}`;
      ctx.fillText(reloading ? 'RELOAD' : `${m.ammo}`, W2 - 30 * u, H2 - 12 * u);
      ctx.font = `600 ${(7 * u) | 0}px ${mono}`; ctx.fillStyle = '#a9ae9e';
      if (!reloading) ctx.fillText(`/${spec.mag}`, W2 - 8 * u, H2 - 12 * u);
      ctx.fillText(spec.name.toUpperCase(), W2 - 8 * u, H2 - 22 * u);
      for (let i = 0; i < Math.min(spec.mag, 30); i++) { ctx.fillStyle = i < m.ammo ? '#d9dccf' : 'rgba(255,255,255,.15)'; ctx.fillRect(W2 - 8 * u - (i + 1) * 2.6 * u, H2 - 8 * u, 1.6 * u, 3 * u); }
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(4 * u, H2 - 16 * u, 70 * u, 12 * u);
      ctx.fillStyle = m.hp > 40 ? '#cfd4c4' : '#d9473a'; ctx.fillRect(6 * u, H2 - 14 * u, (52 * u * m.hp) / MAX_HP, 8 * u);
      ctx.fillStyle = '#e6e9df'; ctx.font = `700 ${(7 * u) | 0}px ${mono}`; ctx.fillText(`${Math.max(0, Math.round(m.hp))}`, 60 * u, H2 - 7.5 * u);
      // Streak pips
      const next = STREAKS.find((s) => s.kills > m.streak);
      for (let i = 0; i < 11; i++) {
        const isReward = STREAKS.some((s) => s.kills === i + 1);
        ctx.fillStyle = i < m.streak ? '#e6e9df' : isReward ? 'rgba(230,200,120,.45)' : 'rgba(255,255,255,.18)';
        ctx.fillRect(6 * u + i * 6 * u, H2 - 22 * u, 4.5 * u, isReward ? 4 * u : 3 * u);
      }
      ctx.font = `600 ${(6 * u) | 0}px ${mono}`; ctx.fillStyle = '#a9ae9e';
      ctx.fillText(next ? `${next.name} IN ${next.kills - m.streak}` : 'ALL STREAKS EARNED', 6 * u, H2 - 25 * u);
      ctx.font = `700 ${(7 * u) | 0}px ${mono}`;
      // Weapon slots
      ctx.textAlign = 'center';
      WEAPON_ORDER.forEach((w, i) => {
        // Bottom centre, between the health block (left) and the ammo block (right), so nothing at the top covers them.
        const x = W2 / 2 - 8 * u + (i - 2) * 18 * u;
        const y = H2 - 16 * u;
        ctx.fillStyle = w === m.weapon ? 'rgba(220,224,210,.9)' : 'rgba(0,0,0,.45)';
        ctx.fillRect(x - 8 * u, y, 16 * u, 10 * u);
        ctx.fillStyle = w === m.weapon ? '#15170f' : '#d9dccf';
        ctx.fillText(`${i + 1}`, x, y + 7.5 * u);
      });
      // Radar (UAV)
      const live = (snap?.strikes ?? []).filter((s) => s.inMs >= 0);
      r.minimap(ctx, map, m, m.uavUntil > now ? others : [], live);
      // Airstrike warning: countdown, danger-close when you're in the zone, jets overhead just before impact.
      for (const s of live) {
        const left = Math.max(0, s.inMs - (now - (snap?.recv ?? now)));
        const inside = Math.hypot(s.x - m.x, s.y - m.y) < (s.r ?? 3) + 2.2;
        ctx.textAlign = 'center';
        const msg = inside ? `⚠ DANGER CLOSE — AIRSTRIKE ${(left / 1000).toFixed(1)}s — MOVE!` : `AIRSTRIKE ${s.locked ? 'LOCKED' : 'TRACKING'} ${(left / 1000).toFixed(1)}s`;
        fit(msg, '800', 10, W2 - 16);
        ctx.fillStyle = inside ? (Math.floor(now / 200) % 2 ? 'rgba(240,60,40,.95)' : 'rgba(255,230,120,.95)') : 'rgba(255,200,80,.9)';
        // Sits under the streak banner's box, never on top of it.
        ctx.fillText(msg, W2 / 2, bannerTop + 48 * u);
        if (left < 900 && now - fx.current.jetAt > 1500) fx.current.jetAt = now;
      }
      const jt = (now - fx.current.jetAt) / 1400;
      if (jt < 1) {
        for (let k = 0; k < 2; k++) {
          const jx = -40 * u + (W2 + 80 * u) * (jt - k * 0.08), jy = H2 * (0.08 + k * 0.05);
          ctx.fillStyle = 'rgba(20,24,20,.9)';
          ctx.beginPath(); ctx.moveTo(jx + 22 * u, jy); ctx.lineTo(jx - 10 * u, jy - 3 * u); ctx.lineTo(jx - 14 * u, jy - 12 * u); ctx.lineTo(jx - 18 * u, jy - 2 * u); ctx.lineTo(jx - 24 * u, jy - 1 * u); ctx.lineTo(jx - 24 * u, jy + 3 * u); ctx.lineTo(jx - 10 * u, jy + 3 * u); ctx.lineTo(jx - 14 * u, jy + 12 * u); ctx.lineTo(jx - 6 * u, jy + 3 * u); ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(255,170,60,.8)'; ctx.fillRect(jx - 30 * u, jy - 0.5 * u, 6 * u, 2 * u);
        }
      }
      const sk = (now - fx.current.shake) / 450;
      if (sk < 1) { ctx.fillStyle = `rgba(255,140,40,${(0.25 * (1 - sk)).toFixed(2)})`; ctx.fillRect(0, 0, W2, H2); }
      // Nuke countdown and flash
      if (snap?.nuke) {
        const left = Math.max(0, snap.nuke.inMs - (now - snap.recv));
        ctx.fillStyle = Math.floor(now / 400) % 2 ? 'rgba(230,60,50,.95)' : 'rgba(255,255,255,.95)';
        const msg = `TACTICAL NUKE INCOMING  ${(left / 1000).toFixed(1)}`;
        fit(msg, '800', 13, W2 - 16);
        ctx.textAlign = 'center';
        ctx.fillText(msg, W2 / 2, bannerTop + 64 * u);
      }
      const nf = (now - fx.current.nukeFlash) / 3000;
      if (nf < 1) {
        // White-out, then an expanding shockwave ring and a dusty orange fade.
        ctx.fillStyle = `rgba(255,255,250,${Math.max(0, 1 - nf * 2).toFixed(2)})`; ctx.fillRect(0, 0, W2, H2);
        ctx.fillStyle = `rgba(170,90,40,${(0.45 * (1 - nf)).toFixed(2)})`; ctx.fillRect(0, 0, W2, H2);
        ctx.strokeStyle = `rgba(255,240,220,${(0.8 * (1 - nf)).toFixed(2)})`;
        ctx.lineWidth = 10 * u * (1 - nf) + 1;
        ctx.beginPath(); ctx.arc(W2 / 2, H2 * 0.6, nf * W2 * 0.9, 0, Math.PI * 2); ctx.stroke();
      }
      const b = banner.current;
      if (b && now - b.at < 3000) {
        const fade = Math.min(1, (3000 - (now - b.at)) / 400);
        ctx.globalAlpha = fade;
        const bw = Math.min(W2 - 12, 260 * u);
        const by = bannerTop;
        const inner = bw - 12;
        // The subtitle wraps onto two lines when it is long; both lines and the title shrink to fit the box.
        const subLines = wrapLines(ctx, b.sub, inner, `italic 600 ${Math.max(8, (7 * u) | 0)}px ${mono}`);
        const bh = (subLines.length > 1 ? 42 : 34) * u;
        ctx.fillStyle = 'rgba(8,10,8,.72)'; ctx.fillRect(W2 / 2 - bw / 2, by, bw, bh);
        ctx.fillStyle = 'rgba(220,224,210,.8)'; ctx.fillRect(W2 / 2 - bw / 2, by, bw, 1.5 * u); ctx.fillRect(W2 / 2 - bw / 2, by + bh - 1.5 * u, bw, 1.5 * u);
        for (let i = 0; i < 40; i++) { ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(W2 / 2 - bw / 2 + ((i * 37 + now / 4) % bw), by + ((i * 13) % 34) * u, 6 * u, 0.6 * u); }
        ctx.textAlign = 'center';
        ctx.fillStyle = '#e6e9df'; fit(b.text, '800', 14, inner);
        ctx.fillText(b.text, W2 / 2, by + 16 * u);
        ctx.fillStyle = '#b5ba9f';
        subLines.forEach((line, i) => { fit(line, 'italic 600', 7, inner); ctx.fillText(line, W2 / 2, by + (28 + i * 8) * u); });
        ctx.globalAlpha = 1;
      }
      if (m.joined && !m.alive) {
        ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, H2 / 2 - 16 * u, W2, 32 * u);
        ctx.fillStyle = '#e6e9df';
        const kia = 'KILLED IN ACTION · REDEPLOYING…';
        if (fit(kia, '700', 12, W2 - 16) < 11) {
          // Very narrow: split onto two lines rather than clip.
          fit('KILLED IN ACTION', '700', 12, W2 - 16); ctx.fillText('KILLED IN ACTION', W2 / 2, H2 / 2 - 2 * u);
          ctx.fillText('REDEPLOYING…', W2 / 2, H2 / 2 + 11 * u);
        } else ctx.fillText(kia, W2 / 2, H2 / 2 + 5 * u);
      }
      raf = requestAnimationFrame(frame);
    };
    return () => { cancelled = true; cancelAnimationFrame(raf); g3?.dispose(); };
  }, []);

  // Pointer-lock mouse look, mouse buttons (left fire, right scope) and wheel weapon switch.
  useEffect(() => {
    const canvas = canvasRef.current;
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      const sens = me.current.scoped ? 0.0011 : 0.0035;
      me.current.a += e.movementX * sens;
      me.current.p = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, me.current.p - e.movementY * sens));
    };
    const onUp = (e: MouseEvent) => { if (e.button === 0) me.current.firing = false; if (e.button === 2) setScope(false); };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); cycleWeapon(e.deltaY > 0 ? 1 : -1); };
    // Always resync to what the browser actually holds; never trust our own idea of "locked".
    const sync = () => {
      const on = isLockedTo(document.pointerLockElement, canvas);
      setLocked(on);
      if (!on) { me.current.firing = false; setScope(false); }
    };
    document.addEventListener('pointerlockchange', sync);
    document.addEventListener('pointerlockerror', sync);
    window.addEventListener('blur', sync);
    document.addEventListener('visibilitychange', sync);
    document.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas?.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      document.removeEventListener('pointerlockchange', sync);
      document.removeEventListener('pointerlockerror', sync);
      window.removeEventListener('blur', sync);
      document.removeEventListener('visibilitychange', sync);
      document.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas?.removeEventListener('wheel', onWheel);
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    };
  }, []);

  const GAME_KEYS = new Set(['tab', 'w', 'a', 's', 'd', 'q', 'e', 'f', 'r', 'control', ' ', '1', '2', '3', '4', '5', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'pageup', 'pagedown']);
  function onKey(e: React.KeyboardEvent, down: boolean) {
    const key = e.key.toLowerCase();
    if (down) {
      const hk = hotkeyFor(e.key, e.repeat);
      if (hk === 'release') { releaseLock(); setPickerOpen(false); return; }
      if (hk === 'picker') { e.preventDefault(); e.stopPropagation(); openPicker(); return; }
      if (hk === 'fps') { e.preventDefault(); e.stopPropagation(); setShowFps((v) => !v); return; }
    }
    if (key === 'escape' || key === 'm' || key === 'f3') return;
    e.stopPropagation();
    if (!GAME_KEYS.has(key)) return;
    e.preventDefault();
    if (key === 'tab') { setShowBoard(down); return; }
    if (!down) { keys.current.delete(key); return; }
    keys.current.add(key);
    if (e.repeat) return;
    if (key === ' ') jump();
    else if (key === 'r') reload();
    else if (/^[1-5]$/.test(key)) setWeapon(WEAPON_ORDER[Number(key) - 1]);
    else if (key === 'f' || key === 'control') shoot();
  }

  function releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock?.();
    setLocked(false);
    keys.current.clear();
    me.current.firing = false;
  }
  function openPicker() {
    releaseLock();
    setPickerOpen((o) => {
      if (!o) setTimeout(() => pickRef.current?.querySelector<HTMLButtonElement>('button:not(.is-on)')?.focus(), 0);
      return !o;
    });
  }
  const pickMap = (id: string) => {
    setPickerOpen(false);
    localStorage.setItem(MAP_KEY, id);
    socket.emit('fps_map', { map: id });
  };
  const hold = (dir: 'up' | 'down' | 'left' | 'right' | 'lookUp' | 'lookDown') => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); touch.current[dir] = true; },
    onPointerUp: () => { touch.current[dir] = false; },
    onPointerLeave: () => { touch.current[dir] = false; },
    onPointerCancel: () => { touch.current[dir] = false; },
  });

  return (
    <div
      ref={wrapRef}
      className={`sol-panel fps-panel ${focused ? 'fps-focused' : ''}${win.className}`}
      style={win.style}
      onPointerDownCapture={win.front}
      onPointerMove={win.onPanelMove}
      role="dialog"
      aria-label="Arena shooter"
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node)) {
          setFocused(false);
          keys.current.clear();
          me.current.firing = false;
          setScope(false);
        }
      }}
      onKeyDown={(e) => onKey(e, true)}
      onKeyUp={(e) => onKey(e, false)}
    >
      {win.grips}
      <div {...win.bar}>
        <span className="font-semibold">Arena</span>
        <span className="opacity-70">{board.length} online · {focused ? 'controls on' : 'click to play'}</span>
        <button type="button" className="fps-quality" data-testid="arena-quality" title="Graphics quality" onClick={() => setQuality((q) => (q === 'hd' ? 'lo' : 'hd'))}>{quality === 'hd' ? 'HD' : 'LO'}</button>
        {win.moved && <button type="button" className="win-reset" aria-label="Reset window position" title="Reset position" onClick={win.reset}>⟲</button>}
        <button type="button" className="ml-auto" aria-label="Close arena" onClick={onClose}>✕</button>
      </div>
      <div className="fps-maps" data-testid="arena-maps">
        <span className="fps-maps-now">{mapById(mapInfo.map).name}{mapInfo.secs > 0 && <span className="opacity-70"> · {clock(mapInfo.secs * 1000)}</span>}</span>
        {mapInfo.next && <span className="opacity-70">next: {mapById(mapInfo.next).name}{mapInfo.picked ? ' (picked)' : ''}</span>}
        <span ref={pickRef} className={`fps-maps-pick${pickerOpen ? ' is-open' : ''}`} data-testid="arena-map-picker" data-open={pickerOpen ? '1' : '0'} role="group" aria-label="Pick a map">
          {MAP_LIST.map((m) => (
            <button
              key={m.id}
              type="button"
              data-testid={`arena-map-${m.id}`}
              aria-pressed={m.id === mapInfo.map}
              className={m.id === mapInfo.map ? 'is-on' : m.id === mapInfo.next && mapInfo.picked ? 'is-next' : ''}
              title={m.id === mapInfo.map ? 'Playing now' : 'Vote for this map (loads now if you are alone)'}
              onClick={() => pickMap(m.id)}
            >
              {m.name}
            </button>
          ))}
        </span>
      </div>
      <div className={`fps-stage${locked ? ' fps-locked' : ''}`} data-locked={locked ? '1' : '0'}>
        <canvas ref={glRef} className="fps-gl" aria-hidden="true" />
        <canvas
          ref={canvasRef}
          className="fps-canvas"
          data-testid="arena-canvas"
          onContextMenu={(e) => e.preventDefault()}
          onMouseDown={(e) => {
            unlockSounds();
            wrapRef.current?.focus();
            setPickerOpen(false);
            if (document.pointerLockElement !== canvasRef.current) {
              try {
                const p = canvasRef.current?.requestPointerLock?.() as unknown as Promise<void> | undefined;
                p?.catch?.(() => setLocked(isLockedTo(document.pointerLockElement, canvasRef.current)));
              } catch { /* pointerlockerror resyncs */ }
            }
            if (e.button === 0) { me.current.firing = true; shoot(); }
            if (e.button === 2) setScope(true);
          }}
          onTouchStart={() => { unlockSounds(); wrapRef.current?.focus(); }}
        />
        <div className="fps-feed" data-testid="arena-feed">
          {feed.map((f) => (
            <div key={f.key} className={f.mine ? 'fps-feed-me' : ''}>
              {f.self ? <><WeaponIcon cause={f.cause} /> <span>{f.victim}</span></> : <><span className="fps-k">{f.killer}</span> <WeaponIcon cause={f.cause} /> <span>{f.victim}</span></>}
            </div>
          ))}
        </div>
        {showBoard && (
          <div className="fps-scoreboard" data-testid="arena-scoreboard">
            <table>
              <thead><tr><th>Player</th><th>K</th><th>D</th><th>Streak</th></tr></thead>
              <tbody>{board.map((p) => <tr key={p.id} className={p.id === me.current.id ? 'fps-me' : ''}><td>{p.name}</td><td>{p.k}</td><td>{p.d}</td><td>{p.st}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        <div className="fps-board" data-testid="arena-board">
          {board.slice(0, 6).map((p) => (
            <div key={p.id} className={p.id === me.current.id ? 'fps-me' : ''}>
              {p.name} <b>{p.k}</b>
            </div>
          ))}
        </div>
        {showFps && <div ref={fpsRef} className="fps-fps" data-testid="arena-fps" aria-live="off">… FPS</div>}
        {(status || glError) && <div className="fps-status">{glError || status}</div>}
      </div>
      {isTouch ? (
        <div className="fps-touch">
          <div className="fps-dpad">
            <button type="button" aria-label="Turn left" {...hold('left')}>◀</button>
            <button type="button" aria-label="Forward" {...hold('up')}>▲</button>
            <button type="button" aria-label="Back" {...hold('down')}>▼</button>
            <button type="button" aria-label="Turn right" {...hold('right')}>▶</button>
            <button type="button" aria-label="Look up" data-testid="arena-look-up" {...hold('lookUp')}>⤒</button>
            <button type="button" aria-label="Look down" data-testid="arena-look-down" {...hold('lookDown')}>⤓</button>
          </div>
          <button type="button" className="fps-jump" data-testid="arena-jump" onPointerDown={(e) => { e.preventDefault(); jump(); }}>JUMP</button>
          <button type="button" className="fps-swap" data-testid="arena-swap" onPointerDown={(e) => { e.preventDefault(); cycleWeapon(1); }}>SWAP</button>
          <button
            type="button"
            className="fps-fire"
            onPointerDown={(e) => { e.preventDefault(); unlockSounds(); me.current.firing = true; shoot(); }}
            onPointerUp={() => { me.current.firing = false; }}
            onPointerLeave={() => { me.current.firing = false; }}
            onPointerCancel={() => { me.current.firing = false; }}
          >FIRE</button>
        </div>
      ) : (
        <div className="fps-help" data-testid="arena-help">
          <span className="fps-help-full">WASD move · mouse look · Q/E turn · PgUp/PgDn look · click, F or Ctrl shoot · Space jump · 1–5 / wheel guns · R reload · right-click scope · Tab scores · M maps · F3 fps · Esc frees mouse</span>
          <span className="fps-help-short">WASD move · click shoot · Space jump · 1–5 guns · R reload · Tab scores · M maps · F3 fps · Esc frees mouse</span>
        </div>
      )}
    </div>
  );
}

/** Small weapon silhouettes for the kill feed. */
function WeaponIcon({ cause }: { cause: string }) {
  const paths: Record<string, string> = {
    pistol: 'M2 3h14v3H8l-1 5H4l1-5H2z',
    smg: 'M1 3h20v3h-6v2h-3l-1 4H8l1-4H5V6H1z',
    shotgun: 'M0 3h26v2H12l-2 2H4L2 9H0z',
    sniper: 'M0 4h30v1.5H16l-2 1.5H6l-3 3H0zM10 1h7v2h-7z',
    rocket: 'M0 3h22l4 1.5L22 6H0zM8 6h4v4H8z',
    airstrike: 'M2 5l10-1 4-4h3l-2 4 8 0v2l-8 0 2 4h-3l-4-4-10-1z',
    drone: 'M0 4h28v1.5H0zM9 5.5h10l-2 3h-6z',
    nuke: 'M14 0a7 7 0 1 1 0 14 7 7 0 1 1 0-14zm0 5a2 2 0 1 0 0 4 2 2 0 1 0 0-4z',
  };
  const d = paths[cause] ?? paths.pistol;
  return <svg className="fps-wicon" viewBox="0 0 30 14" width="30" height="14" aria-label={cause} role="img"><path d={d} fill="currentColor" /></svg>;
}

function interpolate(snaps: Snap[], renderAt: number): NetPlayer[] {
  if (!snaps.length) return [];
  let i = snaps.length - 1;
  while (i > 0 && snaps[i - 1].recv > renderAt) i--;
  const b = snaps[i];
  const a = snaps[i - 1];
  if (!a || renderAt >= b.recv) return b.players;
  const span = b.recv - a.recv || 1;
  const t = Math.min(1, Math.max(0, (renderAt - a.recv) / span));
  return b.players.map((p) => {
    const q = a.players.find((o) => o.id === p.id);
    if (!q || !q.alive || !p.alive) return p;
    let da = p.a - q.a;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    return { ...p, x: q.x + (p.x - q.x) * t, y: q.y + (p.y - q.y) * t, a: q.a + da * t };
  });
}

/** Greedy word-wrap of `text` into at most two lines no wider than maxW (the second line is shrunk to fit if needed). */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, font: string): string[] {
  ctx.font = font;
  if (ctx.measureText(text).width <= maxW) return [text];
  const words = text.split(' ');
  let first = '';
  for (let i = 0; i < words.length; i++) {
    const next = first ? `${first} ${words[i]}` : words[i];
    if (ctx.measureText(next).width > maxW && first) return [first, words.slice(i).join(' ')];
    first = next;
  }
  return [first];
}
