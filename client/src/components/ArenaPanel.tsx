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
const COLORS = ['#e8c26a', '#6ad1e8', '#e86a9a', '#8de86a', '#b28dff', '#ff9d5c', '#5cffc8', '#ff5c5c'];
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
  const [feed, setFeed] = useState<Array<{ key: number; text: string }>>([]);
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
  const fx = useRef({ muzzle: 0, hurt: 0, hitmark: 0, nukeFlash: 0, booms: [] as Array<{ x: number; y: number; at: number; big: boolean }>, hitAt: new Map<string, number>() });
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
    const pushFeed = (text: string) => {
      const key = ++feedKey;
      setFeed((f) => [...f.slice(-3), { key, text }]);
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
      else if (h.target === me.current.id) { fx.current.hurt = now; playHit(); }
    };
    const onShot = (s: { id: string; w: WeaponId; impact?: { x: number; y: number } }) => {
      if (s.id !== me.current.id) playWeaponShot(s.w, 0.35);
      if (s.impact) { fx.current.booms.push({ ...s.impact, at: performance.now(), big: false }); playExplosion(0.5); }
    };
    const onKill = (k: { killer: string; victim: string; killerId: string | null; victimId: string; cause: string }) => {
      const how: Record<string, string> = { airstrike: '🥧', drone: '🛸', nuke: '🎊', rocket: '🚀', sniper: '🎯', shotgun: '🎉' };
      pushFeed(k.killerId === k.victimId ? `${k.victim} bonked themself` : `${k.killer} ${how[k.cause] ?? '💥'} ${k.victim}`);
    };
    const onStreak = (s: { id: string; name: string; kind: string; title: string; streak: number }) => {
      const info = STREAKS.find((x) => x.kind === s.kind);
      const mine = s.id === me.current.id;
      banner.current = { text: mine ? `${s.title}!` : `${s.name}: ${s.title}`, sub: mine ? `${s.streak} kill streak · ${info?.blurb ?? ''}` : `${s.streak} kill streak`, at: performance.now() };
      playStreakCall(s.kind === 'nuke' ? 'alarm' : 'reward');
    };
    const onBoom = (b: { x: number; y: number }) => { fx.current.booms.push({ x: b.x, y: b.y, at: performance.now(), big: true }); playExplosion(0.8); };
    const onNuke = (n: { phase: string; by: string }) => {
      if (n.phase === 'boom') {
        fx.current.nukeFlash = performance.now();
        playExplosion(1, true);
        banner.current = { text: 'CONFETTI NUKE', sub: `${n.by} ended the round · scores reset`, at: performance.now() };
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
      r.world(ctx, cam);
      // Sprites: blobs, drones, strike markers, explosions — far to near.
      const snap = snaps.current[snaps.current.length - 1];
      const renderAt = now - INTERP_MS;
      const others = interpolate(snaps.current, renderAt).filter((p) => p.id !== m.id && p.alive);
      type Thing = { d: number; draw: () => void };
      const things: Thing[] = others.map((p) => ({
        d: Math.hypot(p.x - m.x, p.y - m.y),
        draw: () => r.blob(ctx, cam, { ...p, z: jumpHeight(p.j + (now - (snap?.recv ?? now))), color: colorFor(p.id), flash: now - (fx.current.hitAt.get(p.id) ?? -1e9) < 120 }),
      }));
      for (const d of snap?.drones ?? []) things.push({ d: Math.hypot(d.x - m.x, d.y - m.y), draw: () => r.thing(ctx, cam, d.x, d.y, 0.75 + Math.sin(now / 200) * 0.03, 0.3, drawDrone(colorFor(d.ownerId))) });
      for (const s of snap?.strikes ?? []) things.push({ d: Math.hypot(s.x - m.x, s.y - m.y), draw: () => r.thing(ctx, cam, s.x, s.y, 0, 0.9, drawMarker(now)) });
      fx.current.booms = fx.current.booms.filter((b) => now - b.at < 600);
      for (const b of fx.current.booms) things.push({ d: Math.hypot(b.x - m.x, b.y - m.y), draw: () => r.thing(ctx, cam, b.x, b.y, -0.1, b.big ? 2.4 : 1.4, drawBoom((now - b.at) / 600)) });
      things.sort((a, b) => b.d - a.d);
      for (const th of things) th.draw();
      const W2 = r.W, H2 = r.H;
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
        ctx.strokeStyle = now - fx.current.hitmark < 150 ? '#ff4040' : '#fff6d8';
        ctx.lineWidth = Math.max(1, H2 / 250);
        ctx.beginPath();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(W2 / 2 + dx * (spread + cs * 0.4), H2 / 2 + dy * (spread + cs * 0.4)); ctx.lineTo(W2 / 2 + dx * (spread + cs), H2 / 2 + dy * (spread + cs)); }
        ctx.stroke();
      }
      if (now - fx.current.hurt < 200) { ctx.fillStyle = 'rgba(255,60,60,0.28)'; ctx.fillRect(0, 0, W2, H2); }
      // HUD
      const u = H2 / 200;
      ctx.font = `700 ${(9 * u) | 0}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(4 * u, H2 - 16 * u, 64 * u, 12 * u);
      ctx.fillStyle = m.hp > 34 ? '#5cd17a' : '#ff6060'; ctx.fillRect(6 * u, H2 - 14 * u, (60 * u * m.hp) / MAX_HP, 8 * u);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fff6d8';
      ctx.fillText(`${WEAPONS[m.weapon].name}  ${reloading ? 'RELOADING' : `${m.ammo}/${WEAPONS[m.weapon].mag}`}`, W2 - 6 * u, H2 - 7 * u);
      const next = STREAKS.find((s) => s.kills > m.streak);
      ctx.font = `600 ${(7 * u) | 0}px system-ui, sans-serif`;
      ctx.fillText(`Streak ${m.streak}${next ? ` · ${next.kills - m.streak} to ${next.name}` : ''}`, W2 - 6 * u, H2 - 18 * u);
      // Weapon slots
      ctx.textAlign = 'center';
      WEAPON_ORDER.forEach((w, i) => {
        const x = W2 / 2 + (i - 2) * 22 * u;
        ctx.fillStyle = w === m.weapon ? 'rgba(232,194,106,.9)' : 'rgba(0,0,0,.45)';
        ctx.fillRect(x - 10 * u, 4 * u, 20 * u, 10 * u);
        ctx.fillStyle = w === m.weapon ? '#1b1d2e' : '#fff6d8';
        ctx.fillText(`${i + 1}`, x, 11.5 * u);
      });
      // Radar (Sky Eye)
      if (m.uavUntil > now) r.minimap(ctx, m, others, snap?.strikes ?? []);
      // Nuke countdown and flash
      if (snap?.nuke) {
        const left = Math.max(0, snap.nuke.inMs - (now - snap.recv));
        ctx.fillStyle = 'rgba(255,80,80,.85)'; ctx.font = `800 ${(14 * u) | 0}px system-ui, sans-serif`;
        ctx.fillText(`🎊 CONFETTI NUKE INCOMING ${(left / 1000).toFixed(1)}s`, W2 / 2, H2 * 0.3);
      }
      const nf = (now - fx.current.nukeFlash) / 2500;
      if (nf < 1) {
        ctx.fillStyle = `rgba(255,252,235,${(1 - nf).toFixed(2)})`; ctx.fillRect(0, 0, W2, H2);
        for (let i = 0; i < 60 * (1 - nf); i++) { ctx.fillStyle = COLORS[i % COLORS.length]; ctx.fillRect(((i * 97 + now / 3) % W2), ((i * 53 + now / 2) % H2), 4 * u, 6 * u); }
      }
      const b = banner.current;
      if (b && now - b.at < 3000) {
        const fade = Math.min(1, (3000 - (now - b.at)) / 400);
        ctx.globalAlpha = fade;
        ctx.fillStyle = 'rgba(10,12,30,.7)'; ctx.fillRect(0, H2 * 0.16, W2, 34 * u);
        ctx.fillStyle = '#e8c26a'; ctx.font = `900 ${(16 * u) | 0}px system-ui, sans-serif`;
        ctx.fillText(b.text, W2 / 2, H2 * 0.16 + 17 * u);
        ctx.fillStyle = '#fff6d8'; ctx.font = `600 ${(7.5 * u) | 0}px system-ui, sans-serif`;
        ctx.fillText(b.sub, W2 / 2, H2 * 0.16 + 28 * u);
        ctx.globalAlpha = 1;
      }
      if (m.joined && !m.alive) {
        ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, H2 / 2 - 16 * u, W2, 32 * u);
        ctx.fillStyle = '#fff6d8'; ctx.font = `bold ${(14 * u) | 0}px system-ui, sans-serif`;
        ctx.fillText('Bonked! Respawning…', W2 / 2, H2 / 2 + 5 * u);
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

  const GAME_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', 'f', 'r', 'control', ' ', '1', '2', '3', '4', '5', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
  function onKey(e: React.KeyboardEvent, down: boolean) {
    const key = e.key.toLowerCase();
    if (key === 'escape') return;
    e.stopPropagation();
    if (!GAME_KEYS.has(key)) return;
    e.preventDefault();
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
        <span className="font-semibold">🎯 Arena</span>
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
        <div className="fps-feed">{feed.map((f) => <div key={f.key}>{f.text}</div>)}</div>
        <div className="fps-board" data-testid="arena-board">
          {board.slice(0, 6).map((p) => (
            <div key={p.id} className={p.id === me.current.id ? 'fps-me' : ''}>
              <span style={{ color: colorFor(p.id) }}>●</span> {p.name} <b>{p.k}</b>{p.st >= 3 ? ` 🔥${p.st}` : ''}
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
        <div className="fps-help">WASD move · mouse or Q/E turn · click, F or Ctrl shoot · Space jump · 1–5 / wheel guns · R reload · right-click scope · Esc frees mouse</div>
      )}
    </div>
  );
}

function drawDrone(color: string) {
  return (g: CanvasRenderingContext2D) => {
    g.fillStyle = '#556';
    g.fillRect(20, 76, 120, 8);
    for (const x of [24, 136]) { g.fillStyle = 'rgba(200,220,255,.5)'; g.beginPath(); g.ellipse(x, 70, 22, 5, 0, 0, 7); g.fill(); }
    g.fillStyle = color;
    g.beginPath(); g.ellipse(80, 92, 34, 26, 0, 0, 7); g.fill();
    g.strokeStyle = '#0007'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(80, 90, 13, 0, 7); g.fill();
    g.fillStyle = '#e8503a'; g.beginPath(); g.arc(80, 91, 6, 0, 7); g.fill();
  };
}
function drawMarker(now: number) {
  return (g: CanvasRenderingContext2D) => {
    const pulse = 0.6 + 0.4 * Math.sin(now / 90);
    g.strokeStyle = `rgba(255,120,60,${pulse})`;
    g.lineWidth = 8;
    g.beginPath(); g.arc(80, 80, 60, 0, 7); g.stroke();
    g.beginPath(); g.arc(80, 80, 28, 0, 7); g.stroke();
    g.fillStyle = `rgba(255,220,120,${pulse})`;
    g.font = '900 40px system-ui'; g.textAlign = 'center'; g.fillText('🥧', 80, 94);
  };
}
function drawBoom(t: number) {
  return (g: CanvasRenderingContext2D) => {
    const r = 20 + t * 60;
    g.globalAlpha = 1 - t;
    const cols = ['#ffe36a', '#ff9d5c', '#e86a9a', '#6ad1e8'];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      g.fillStyle = cols[i % cols.length];
      g.beginPath(); g.arc(80 + Math.cos(a) * r * 0.5, 80 + Math.sin(a) * r * 0.5, r * 0.45, 0, 7); g.fill();
    }
    g.fillStyle = '#fffbe0'; g.beginPath(); g.arc(80, 80, r * 0.4, 0, 7); g.fill();
    g.globalAlpha = 1;
  };
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
