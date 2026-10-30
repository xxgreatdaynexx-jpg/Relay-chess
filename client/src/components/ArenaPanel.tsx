import { useWindowDrag } from '@/lib/windowDrag';
import { useEffect, useRef, useState } from 'react';
import { socket } from '@/lib/net';
import { ArenaRenderer, type Cam } from '@/lib/arenaRender';
import { playExplosion, playHit, playStreakCall, playWeaponShot, unlockSounds } from '@/lib/sounds';
import {
  canJump, canStand, jumpHeight, MAX_HP, MOVE_SPEED, STREAKS, SWITCH_MS, TICK_HZ, WEAPON_ORDER, WEAPONS, type WeaponId,
} from '../../../shared/fps';

const OPEN_KEY = 'relay-fps-open';
const QUALITY_KEY = 'relay-fps-quality';
const INTERP_MS = (1000 / TICK_HZ) * 1.5;
const COLORS = ['#5f6a48', '#7d7158', '#596066', '#6b6248', '#4f5a4c', '#73705f', '#565246', '#666e5a'];
const SCOPE_ZOOM = 3.5;

interface NetPlayer { id: string; name: string; x: number; y: number; a: number; hp: number; k: number; d: number; alive: boolean; w: WeaponId; ammo: number; rl: number; j: number; st: number; uav: number }
interface NetState { t: number; players: NetPlayer[]; drones: Array<{ ownerId: string; x: number; y: number }>; strikes: Array<{ x: number; y: number; inMs: number }>; nuke: { by: string; inMs: number } | null }
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
      <button type="button" className="sol-tab fps-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="arena-tab">
        {open ? '▴ Arena' : '🎯 Arena'}
      </button>
      {open && <ArenaGame onClose={() => setOpen(false)} />}
    </div>
  );
}

function ArenaGame({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const win = useWindowDrag('arena', wrapRef);
  const [status, setStatus] = useState('Joining the arena…');
  const [feed, setFeed] = useState<Array<{ key: number; killer: string; victim: string; cause: string; self: boolean; mine: boolean }>>([]);
  const [showBoard, setShowBoard] = useState(false);
  const [board, setBoard] = useState<NetPlayer[]>([]);
  const [focused, setFocused] = useState(false);
  const [isTouch] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches);
  const [quality, setQuality] = useState<Quality>(() => (localStorage.getItem(QUALITY_KEY) as Quality) || (isTouch ? 'lo' : 'hd'));
  const qualityRef = useRef(quality);
  useEffect(() => { qualityRef.current = quality; localStorage.setItem(QUALITY_KEY, quality); }, [quality]);
  const keys = useRef(new Set<string>());
  const me = useRef({
    id: '', x: 1.5, y: 1.5, a: 0, alive: true, hp: MAX_HP, joined: false, weapon: 'pistol' as WeaponId,
    ammo: WEAPONS.pistol.mag, reloadUntil: 0, switchedAt: -1e9, lastShot: {} as Partial<Record<WeaponId, number>>,
    jumpAt: -1e9, scoped: false, firing: false, streak: 0, uavUntil: 0, walk: 0,
  });
  const snaps = useRef<Snap[]>([]);
  const fx = useRef({ muzzle: 0, hurt: 0, hitmark: 0, killmark: 0, nukeFlash: 0, dmgDirs: [] as Array<{ a: number; at: number }>, deaths: new Map<string, { at: number; x: number; y: number; a: number; name: string }>(), booms: [] as Array<{ x: number; y: number; at: number; big: boolean }>, hitAt: new Map<string, number>() });
  const banner = useRef<{ text: string; sub: string; at: number } | null>(null);
  const touch = useRef({ up: false, down: false, left: false, right: false });

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
    if (!m.joined || !m.alive || !canJump(m.jumpAt, now)) return;
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
    socket.emit('fps_shoot', { a: m.a });
  }

  // Networking
  useEffect(() => {
    const join = () => {
      socket.timeout(8000).emit('fps_join', {}, (err: Error | null, ack?: { ok: boolean; id?: string; x?: number; y?: number; a?: number; error?: string }) => {
        if (err || !ack?.ok) return setStatus(ack?.error || 'Could not reach the arena.');
        Object.assign(me.current, { id: ack.id, x: ack.x, y: ack.y, a: ack.a, joined: true, alive: true });
        setStatus('');
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
      if (mine) {
        if (!mine.alive && m.alive) m.alive = false;
        if (mine.alive && !m.alive) Object.assign(m, { alive: true, x: mine.x, y: mine.y, ammo: WEAPONS[m.weapon].mag, reloadUntil: 0 });
        m.hp = mine.hp;
        m.streak = mine.st;
        m.uavUntil = mine.uav ? performance.now() + mine.uav : 0;
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
    const onShot = (s: { id: string; w: WeaponId; impact?: { x: number; y: number } }) => {
      if (s.id !== me.current.id) playWeaponShot(s.w, 0.35);
      if (s.impact) { fx.current.booms.push({ ...s.impact, at: performance.now(), big: false }); playExplosion(0.5); }
    };
    const onKill = (k: { killer: string; victim: string; killerId: string | null; victimId: string; cause: string }) => {
      const self = k.killerId === k.victimId || !k.killerId;
      if (k.killerId === me.current.id && !self) fx.current.killmark = performance.now();
      const v = snaps.current[snaps.current.length - 1]?.players.find((p) => p.id === k.victimId);
      if (v) fx.current.deaths.set(k.victimId, { at: performance.now(), x: v.x, y: v.y, a: v.a, name: v.name });
      pushFeed({ killer: k.killer, victim: k.victim, cause: k.cause, self, mine: k.killerId === me.current.id || k.victimId === me.current.id });
    };
    const onStreak = (s: { id: string; name: string; kind: string; title: string; streak: number }) => {
      const info = STREAKS.find((x) => x.kind === s.kind);
      const mine = s.id === me.current.id;
      const radio: Record<string, string> = { uav: mine ? 'UAV online.' : 'Enemy UAV spotted.', airstrike: mine ? 'Airstrike inbound. Danger close.' : 'Enemy airstrike inbound!', drone: mine ? 'Attack drone on station.' : 'Enemy drone overhead!', nuke: mine ? 'Tactical nuke inbound.' : 'TACTICAL NUKE INCOMING!' };
      banner.current = { text: mine ? s.title : `${s.name.toUpperCase()} · ${s.title}`, sub: `"${radio[s.kind] ?? ''}" · ${s.streak} kill streak${mine && info ? ` · ${info.blurb}` : ''}`, at: performance.now() };
      playStreakCall(s.kind === 'nuke' ? 'alarm' : 'reward');
    };
    const onBoom = (b: { x: number; y: number }) => { fx.current.booms.push({ x: b.x, y: b.y, at: performance.now(), big: true }); playExplosion(0.8); };
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
    socket.on('fps_nuke', onNuke);
    socket.on('connect', join);
    if (socket.connected) join();
    else socket.connect();
    return () => {
      socket.emit('fps_leave');
      for (const [e, h] of [['fps_state', onState], ['fps_hit', onHit], ['fps_shot', onShot], ['fps_kill', onKill], ['fps_streak', onStreak], ['fps_boom', onBoom], ['fps_nuke', onNuke], ['connect', join]] as const) socket.off(e, h as never);
    };
  }, []);

  // Game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const r = new ArenaRenderer();
    const useMoveRef = { current: new Map<string, { x: number; y: number }>() };
    let raf = 0;
    let last = performance.now();
    let lastSend = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // Size: internal resolution follows the CSS size × devicePixelRatio (capped), or half-res in LO.
      const cssW = canvas.clientWidth || 480;
      const scale = qualityRef.current === 'hd' ? Math.min(window.devicePixelRatio || 1, 2) : 0.6;
      const W = Math.round(Math.min(cssW * scale, 1100));
      const H = Math.round((W * 5) / 8);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      r.resize(W, H);
      const m = me.current;
      const k = keys.current;
      const t = touch.current;
      let moving = false;
      if (m.joined && m.alive) {
        let fwd = 0, side = 0, turn = 0;
        if (k.has('w') || k.has('arrowup') || t.up) fwd += 1;
        if (k.has('s') || k.has('arrowdown') || t.down) fwd -= 1;
        if (k.has('a')) side -= 1;
        if (k.has('d')) side += 1;
        if (k.has('arrowleft') || k.has('q') || t.left) turn -= 1;
        if (k.has('arrowright') || k.has('e') || t.right) turn += 1;
        m.a += turn * (m.scoped ? 0.8 : 2.6) * dt;
        const len = Math.hypot(fwd, side) || 1;
        const sp = (MOVE_SPEED * 0.95 * dt) / len * (m.scoped ? 0.5 : 1);
        const dx = (Math.cos(m.a) * fwd - Math.sin(m.a) * side) * sp;
        const dy = (Math.sin(m.a) * fwd + Math.cos(m.a) * side) * sp;
        if (canStand(m.x + dx, m.y)) m.x += dx;
        if (canStand(m.x, m.y + dy)) m.y += dy;
        moving = fwd !== 0 || side !== 0;
        if (now - lastSend > 50) { lastSend = now; socket.emit('fps_move', { x: m.x, y: m.y, a: m.a }); }
        if (m.firing || k.has('f') || k.has('control')) shoot();
      }
      if (m.reloadUntil && now >= m.reloadUntil) { m.reloadUntil = 0; m.ammo = WEAPONS[m.weapon].mag; }
      const z = jumpHeight(now - m.jumpAt);
      if (moving && z === 0) m.walk += dt * 9;
      const bob = moving && z === 0 ? Math.sin(m.walk * 2) * 0.012 : 0;
      const zoom = m.scoped && m.weapon === 'sniper' && m.alive ? SCOPE_ZOOM : 1;
      const cam: Cam = { x: m.x, y: m.y, a: m.a, eye: 0.5 + z + bob, zoom };
      const mf = Math.max(0, 1 - (now - fx.current.muzzle) / 70);
      r.world(ctx, cam, m.alive ? mf : 0);
      // Sprites: blobs, drones, strike markers, explosions — far to near.
      const snap = snaps.current[snaps.current.length - 1];
      const renderAt = now - INTERP_MS;
      const others = interpolate(snaps.current, renderAt).filter((p) => p.id !== m.id && p.alive);
      type Thing = { d: number; draw: () => void };
      const prevPos = useMoveRef.current;
      const things: Thing[] = others.map((p) => {
        const pp = prevPos.get(p.id);
        const moving = !!pp && Math.hypot(pp.x - p.x, pp.y - p.y) > 0.002;
        prevPos.set(p.id, { x: p.x, y: p.y });
        return {
          d: Math.hypot(p.x - m.x, p.y - m.y),
          draw: () => r.soldier(ctx, cam, { ...p, z: jumpHeight(p.j + (now - (snap?.recv ?? now))), color: colorFor(p.id), flash: now - (fx.current.hitAt.get(p.id) ?? -1e9) < 160, moving, t: now }),
        };
      });
      for (const [id, dd] of fx.current.deaths) {
        const age = (now - dd.at) / 1000;
        if (age > 1.2) { fx.current.deaths.delete(id); continue; }
        if (id === m.id) continue;
        things.push({ d: Math.hypot(dd.x - m.x, dd.y - m.y), draw: () => r.soldier(ctx, cam, { id, name: dd.name, x: dd.x, y: dd.y, a: dd.a, hp: 0, z: 0, color: colorFor(id), flash: false, dead: age }) });
      }
      for (const d of snap?.drones ?? []) things.push({ d: Math.hypot(d.x - m.x, d.y - m.y), draw: () => r.thing(ctx, cam, d.x, d.y, 0.75 + Math.sin(now / 200) * 0.03, 0.3, drawDrone(colorFor(d.ownerId))) });
      for (const s of snap?.strikes ?? []) things.push({ d: Math.hypot(s.x - m.x, s.y - m.y), draw: () => r.thing(ctx, cam, s.x, s.y, 0, 0.9, drawMarker(now)) });
      fx.current.booms = fx.current.booms.filter((b) => now - b.at < 600);
      for (const b of fx.current.booms) things.push({ d: Math.hypot(b.x - m.x, b.y - m.y), draw: () => r.thing(ctx, cam, b.x, b.y, -0.1, b.big ? 2.4 : 1.4, drawBoom((now - b.at) / 600)) });
      things.sort((a, b) => b.d - a.d);
      for (const th of things) th.draw();
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
        const spread = WEAPONS[m.weapon].spread * r.focal(cam) * 0.6;
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
      const u = H2 / 200;
      const mono = 'ui-monospace, Menlo, Consolas, monospace';
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
        const x = W2 / 2 + (i - 2) * 22 * u;
        ctx.fillStyle = w === m.weapon ? 'rgba(220,224,210,.9)' : 'rgba(0,0,0,.45)';
        ctx.fillRect(x - 10 * u, 4 * u, 20 * u, 10 * u);
        ctx.fillStyle = w === m.weapon ? '#15170f' : '#d9dccf';
        ctx.fillText(`${i + 1}`, x, 11.5 * u);
      });
      // Radar (UAV)
      if (m.uavUntil > now) r.minimap(ctx, m, others, snap?.strikes ?? []);
      // Nuke countdown and flash
      if (snap?.nuke) {
        const left = Math.max(0, snap.nuke.inMs - (now - snap.recv));
        ctx.fillStyle = Math.floor(now / 400) % 2 ? 'rgba(230,60,50,.95)' : 'rgba(255,255,255,.95)';
        ctx.font = `800 ${(13 * u) | 0}px ${mono}`;
        ctx.fillText(`TACTICAL NUKE INCOMING  ${(left / 1000).toFixed(1)}`, W2 / 2, H2 * 0.32);
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
        const bw = Math.min(W2 * 0.8, 230 * u);
        ctx.fillStyle = 'rgba(8,10,8,.72)'; ctx.fillRect(W2 / 2 - bw / 2, H2 * 0.16, bw, 34 * u);
        ctx.fillStyle = 'rgba(220,224,210,.8)'; ctx.fillRect(W2 / 2 - bw / 2, H2 * 0.16, bw, 1.5 * u); ctx.fillRect(W2 / 2 - bw / 2, H2 * 0.16 + 32.5 * u, bw, 1.5 * u);
        for (let i = 0; i < 40; i++) { ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(W2 / 2 - bw / 2 + ((i * 37 + now / 4) % bw), H2 * 0.16 + ((i * 13) % 34) * u, 6 * u, 0.6 * u); }
        ctx.fillStyle = '#e6e9df'; ctx.font = `800 ${(14 * u) | 0}px ${mono}`;
        ctx.fillText(b.text, W2 / 2, H2 * 0.16 + 16 * u);
        ctx.fillStyle = '#b5ba9f'; ctx.font = `italic 600 ${(7 * u) | 0}px ${mono}`;
        ctx.fillText(b.sub, W2 / 2, H2 * 0.16 + 28 * u);
        ctx.globalAlpha = 1;
      }
      if (m.joined && !m.alive) {
        ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, H2 / 2 - 16 * u, W2, 32 * u);
        ctx.fillStyle = '#e6e9df'; ctx.font = `700 ${(12 * u) | 0}px ${mono}`;
        ctx.fillText('KILLED IN ACTION · REDEPLOYING…', W2 / 2, H2 / 2 + 5 * u);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Pointer-lock mouse look, mouse buttons (left fire, right scope) and wheel weapon switch.
  useEffect(() => {
    const canvas = canvasRef.current;
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement === canvas) me.current.a += e.movementX * (me.current.scoped ? 0.0011 : 0.0035);
    };
    const onUp = (e: MouseEvent) => { if (e.button === 0) me.current.firing = false; if (e.button === 2) setScope(false); };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); cycleWeapon(e.deltaY > 0 ? 1 : -1); };
    document.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas?.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      document.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas?.removeEventListener('wheel', onWheel);
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    };
  }, []);

  const GAME_KEYS = new Set(['tab', 'w', 'a', 's', 'd', 'q', 'e', 'f', 'r', 'control', ' ', '1', '2', '3', '4', '5', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
  function onKey(e: React.KeyboardEvent, down: boolean) {
    const key = e.key.toLowerCase();
    if (key === 'escape') return;
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

  const hold = (dir: 'up' | 'down' | 'left' | 'right') => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); touch.current[dir] = true; },
    onPointerUp: () => { touch.current[dir] = false; },
    onPointerLeave: () => { touch.current[dir] = false; },
    onPointerCancel: () => { touch.current[dir] = false; },
  });

  return (
    <div
      ref={wrapRef}
      className={`sol-panel fps-panel ${focused ? 'fps-focused' : ''}`}
      style={win.style}
      onPointerDownCapture={win.front}
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
      <div {...win.bar}>
        <span className="font-semibold">Arena</span>
        <span className="opacity-70">{board.length} online · {focused ? 'controls on' : 'click to play'}</span>
        <button type="button" className="fps-quality" data-testid="arena-quality" title="Graphics quality" onClick={() => setQuality((q) => (q === 'hd' ? 'lo' : 'hd'))}>{quality === 'hd' ? 'HD' : 'LO'}</button>
        {win.moved && <button type="button" className="win-reset" aria-label="Reset window position" title="Reset position" onClick={win.reset}>⟲</button>}
        <button type="button" className="ml-auto" aria-label="Close arena" onClick={onClose}>✕</button>
      </div>
      <div className="fps-stage">
        <canvas
          ref={canvasRef}
          className="fps-canvas"
          data-testid="arena-canvas"
          onContextMenu={(e) => e.preventDefault()}
          onMouseDown={(e) => {
            unlockSounds();
            wrapRef.current?.focus();
            if (document.pointerLockElement !== canvasRef.current) canvasRef.current?.requestPointerLock?.();
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
        {status && <div className="fps-status">{status}</div>}
      </div>
      {isTouch ? (
        <div className="fps-touch">
          <div className="fps-dpad">
            <button type="button" aria-label="Turn left" {...hold('left')}>◀</button>
            <button type="button" aria-label="Forward" {...hold('up')}>▲</button>
            <button type="button" aria-label="Back" {...hold('down')}>▼</button>
            <button type="button" aria-label="Turn right" {...hold('right')}>▶</button>
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
        <div className="fps-help">WASD move · mouse or Q/E turn · click, F or Ctrl shoot · Space jump · 1–5 / wheel guns · R reload · right-click scope · Tab scores · Esc frees mouse</div>
      )}
    </div>
  );
}

function drawDrone(_color: string) {
  return (g: CanvasRenderingContext2D) => {
    g.fillStyle = '#2a2d2e';
    g.fillRect(14, 74, 132, 6); // wings
    g.beginPath(); g.moveTo(40, 84); g.lineTo(120, 84); g.lineTo(110, 98); g.lineTo(50, 98); g.fill(); // body
    g.fillStyle = '#3c4043'; g.fillRect(70, 60, 20, 16); // tail
    g.fillStyle = '#151718'; g.beginPath(); g.arc(80, 102, 7, 0, 7); g.fill(); // sensor ball
    g.fillStyle = 'rgba(230,60,50,.9)'; g.fillRect(16, 72, 4, 3); g.fillStyle = 'rgba(90,230,90,.9)'; g.fillRect(140, 72, 4, 3);
  };
}
function drawMarker(now: number) {
  return (g: CanvasRenderingContext2D) => {
    const pulse = 0.5 + 0.5 * Math.sin(now / 80);
    g.strokeStyle = `rgba(230,60,50,${0.4 + 0.5 * pulse})`;
    g.lineWidth = 5;
    g.beginPath(); g.arc(80, 80, 62, 0, 7); g.stroke();
    g.setLineDash([10, 8]); g.beginPath(); g.arc(80, 80, 36, 0, 7); g.stroke(); g.setLineDash([]);
    g.beginPath(); g.moveTo(80, 10); g.lineTo(80, 150); g.moveTo(10, 80); g.lineTo(150, 80); g.stroke();
  };
}
function drawBoom(t: number) {
  return (g: CanvasRenderingContext2D) => {
    const r = 18 + t * 62;
    g.globalAlpha = Math.max(0, 1 - t);
    const fire = g.createRadialGradient(80, 90, 2, 80, 90, r);
    fire.addColorStop(0, '#fff4d0'); fire.addColorStop(0.3, '#ffb347'); fire.addColorStop(0.6, '#b8481e'); fire.addColorStop(1, 'rgba(60,50,40,0)');
    g.fillStyle = fire; g.beginPath(); g.arc(80, 90, r, 0, 7); g.fill();
    g.fillStyle = `rgba(70,64,56,${0.7 * t})`;
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.beginPath(); g.arc(80 + Math.cos(a) * r * 0.55, 80 + Math.sin(a) * r * 0.4 - t * 20, r * 0.4, 0, 7); g.fill(); }
    g.globalAlpha = 1;
  };
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
