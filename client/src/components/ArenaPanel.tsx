import { useWindowDrag } from '@/lib/windowDrag';
import { useEffect, useRef, useState } from 'react';
import { socket } from '@/lib/net';
import { loadSession } from '@/lib/session';
import { cleanName, loadName } from '@/lib/playerName';
import { playGunshot, playHit, unlockSounds } from '@/lib/sounds';
import { canStand, castRay, guestName, MAX_HP, MOVE_SPEED, SHOT_COOLDOWN_MS, TICK_HZ } from '../../../shared/fps';

const OPEN_KEY = 'relay-fps-open';
/** Guest arena name only; a real chess name always wins. */
const NAME_KEY = 'relay-fps-guest';
const W = 320;
const H = 200;
const FOV = Math.PI / 3;
const INTERP_MS = 1000 / TICK_HZ * 1.5;
const COLORS = ['#e8c26a', '#6ad1e8', '#e86a9a', '#8de86a', '#b28dff', '#ff9d5c', '#5cffc8', '#ff5c5c'];

interface NetPlayer { id: string; name: string; x: number; y: number; a: number; hp: number; k: number; d: number; alive: boolean }
interface Snap { t: number; recv: number; players: NetPlayer[] }

function arenaName(): string {
  const saved = loadName() || cleanName(loadSession()?.name);
  if (saved) return saved;
  let n = localStorage.getItem(NAME_KEY);
  if (!n) {
    n = guestName();
    localStorage.setItem(NAME_KEY, n);
  }
  return n;
}

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
  const keys = useRef(new Set<string>());
  const me = useRef({ id: '', x: 1.5, y: 1.5, a: 0, alive: true, hp: MAX_HP, joined: false });
  const snaps = useRef<Snap[]>([]);
  const flash = useRef({ muzzle: 0, hurt: 0, hitmark: 0 });
  const lastShot = useRef(0);
  const touch = useMemoTouch();
  const [isTouch] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches);

  function shoot() {
    const now = performance.now();
    if (!me.current.joined || !me.current.alive || now - lastShot.current < SHOT_COOLDOWN_MS) return;
    lastShot.current = now;
    flash.current.muzzle = now;
    playGunshot();
    socket.emit('fps_shoot', { a: me.current.a });
  }

  // Networking
  useEffect(() => {
    const join = () => {
      socket.timeout(8000).emit('fps_join', { name: arenaName() }, (err: Error | null, ack?: { ok: boolean; id?: string; x?: number; y?: number; a?: number; error?: string }) => {
        if (err || !ack?.ok) {
          setStatus(ack?.error || 'Could not reach the arena.');
          return;
        }
        Object.assign(me.current, { id: ack.id, x: ack.x, y: ack.y, a: ack.a, joined: true, alive: true });
        setStatus('');
      });
    };
    let feedKey = 0;
    const onState = (s: { t: number; players: NetPlayer[] }) => {
      snaps.current.push({ ...s, recv: performance.now() });
      if (snaps.current.length > 6) snaps.current.shift();
      const mine = s.players.find((p) => p.id === me.current.id);
      if (mine) {
        if (!mine.alive && me.current.alive) me.current.alive = false;
        if (mine.alive && !me.current.alive) Object.assign(me.current, { alive: true, x: mine.x, y: mine.y });
        me.current.hp = mine.hp;
      }
      setBoard([...s.players].sort((a, b) => b.k - a.k || a.d - b.d));
    };
    const onHit = (h: { by: string; target: string }) => {
      if (h.by === me.current.id) {
        flash.current.hitmark = performance.now();
        playHit();
      } else if (h.target === me.current.id) {
        flash.current.hurt = performance.now();
        playHit();
      }
    };
    const onShot = (s: { id: string }) => {
      if (s.id !== me.current.id) playGunshot(0.35);
    };
    const onKill = (k: { killer: string; victim: string }) => {
      const key = ++feedKey;
      setFeed((f) => [...f.slice(-3), { key, text: `${k.killer} bonked ${k.victim}` }]);
      window.setTimeout(() => setFeed((f) => f.filter((x) => x.key !== key)), 5000);
    };
    socket.on('fps_state', onState);
    socket.on('fps_hit', onHit);
    socket.on('fps_shot', onShot);
    socket.on('fps_kill', onKill);
    socket.on('connect', join);
    if (socket.connected) join();
    else socket.connect();
    return () => {
      socket.emit('fps_leave');
      socket.off('fps_state', onState);
      socket.off('fps_hit', onHit);
      socket.off('fps_shot', onShot);
      socket.off('fps_kill', onKill);
      socket.off('connect', join);
    };
  }, []);

  // Game loop
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    let lastSend = 0;
    const zbuf = new Float32Array(W);
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const m = me.current;
      const k = keys.current;
      const t = touch.current;
      if (m.joined && m.alive) {
        let fwd = 0, side = 0, turn = 0;
        if (k.has('w') || k.has('arrowup') || t.up) fwd += 1;
        if (k.has('s') || k.has('arrowdown') || t.down) fwd -= 1;
        if (k.has('a')) side -= 1;
        if (k.has('d')) side += 1;
        if (k.has('arrowleft') || k.has('q') || t.left) turn -= 1;
        if (k.has('arrowright') || k.has('e') || t.right) turn += 1;
        m.a += turn * 2.6 * dt;
        const len = Math.hypot(fwd, side) || 1;
        const sp = MOVE_SPEED * 0.95 * dt / len;
        const dx = (Math.cos(m.a) * fwd - Math.sin(m.a) * side) * sp;
        const dy = (Math.sin(m.a) * fwd + Math.cos(m.a) * side) * sp;
        if (canStand(m.x + dx, m.y)) m.x += dx;
        if (canStand(m.x, m.y + dy)) m.y += dy;
        if (now - lastSend > 50) {
          lastSend = now;
          socket.emit('fps_move', { x: m.x, y: m.y, a: m.a });
        }
      }
      // Sky / floor
      ctx.fillStyle = '#3b5f8a';
      ctx.fillRect(0, 0, W, H / 2);
      ctx.fillStyle = '#5a4a36';
      ctx.fillRect(0, H / 2, W, H / 2);
      // Walls
      for (let col = 0; col < W; col++) {
        const ra = m.a + (col / W - 0.5) * FOV;
        const hit = castRay(m.x, m.y, ra);
        const d = hit.dist * Math.cos(ra - m.a);
        zbuf[col] = d;
        const h = Math.min(H * 2, H / Math.max(d, 0.05));
        const checker = (hit.cellX + hit.cellY) % 2 === 0;
        const base = hit.side ? (checker ? [150, 90, 70] : [140, 80, 120]) : (checker ? [200, 120, 90] : [180, 110, 160]);
        const shade = Math.max(0.25, 1 - d / 14);
        ctx.fillStyle = `rgb(${base[0] * shade | 0},${base[1] * shade | 0},${base[2] * shade | 0})`;
        ctx.fillRect(col, (H - h) / 2, 1, h);
      }
      // Other players (interpolated)
      const others = interpolate(snaps.current, now - INTERP_MS).filter((p) => p.id !== m.id && p.alive);
      others.sort((a, b) => Math.hypot(b.x - m.x, b.y - m.y) - Math.hypot(a.x - m.x, a.y - m.y));
      for (const p of others) drawSprite(ctx, m, p, zbuf);
      // Crosshair + weapon
      const nowP = performance.now();
      ctx.strokeStyle = nowP - flash.current.hitmark < 150 ? '#ff4040' : '#fff6d8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 5, H / 2); ctx.lineTo(W / 2 + 5, H / 2);
      ctx.moveTo(W / 2, H / 2 - 5); ctx.lineTo(W / 2, H / 2 + 5);
      ctx.stroke();
      const kick = nowP - flash.current.muzzle < 80 ? 6 : 0;
      ctx.fillStyle = '#e8c26a';
      ctx.fillRect(W / 2 - 8, H - 34 + kick, 16, 34);
      ctx.fillStyle = '#2f7a5a';
      ctx.fillRect(W / 2 - 4, H - 46 + kick, 8, 14);
      if (kick) {
        ctx.fillStyle = '#fff3a0';
        ctx.beginPath(); ctx.arc(W / 2, H - 50, 7, 0, Math.PI * 2); ctx.fill();
      }
      if (nowP - flash.current.hurt < 200) {
        ctx.fillStyle = 'rgba(255,60,60,0.3)';
        ctx.fillRect(0, 0, W, H);
      }
      // HUD
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(4, H - 16, 64, 12);
      ctx.fillStyle = m.hp > 34 ? '#5cd17a' : '#ff6060';
      ctx.fillRect(6, H - 14, (60 * m.hp) / MAX_HP, 8);
      if (m.joined && !m.alive) {
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.fillRect(0, H / 2 - 16, W, 32);
        ctx.fillStyle = '#fff6d8';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Bonked! Respawning…', W / 2, H / 2 + 5);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [touch]);

  // Pointer-lock mouse look (desktop)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement === canvasRef.current) me.current.a += e.movementX * 0.0035;
    };
    document.addEventListener('mousemove', onMove);
    return () => {
      document.removeEventListener('mousemove', onMove);
      if (document.pointerLockElement === canvasRef.current) document.exitPointerLock?.();
    };
  }, []);

  const GAME_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
  function onKey(e: React.KeyboardEvent, down: boolean) {
    const key = e.key.toLowerCase();
    if (key === 'escape') return;
    e.stopPropagation();
    if (!GAME_KEYS.has(key)) return;
    e.preventDefault();
    if (down) {
      keys.current.add(key);
      if (key === ' ' && !e.repeat) shoot();
    } else keys.current.delete(key);
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
        }
      }}
      onKeyDown={(e) => onKey(e, true)}
      onKeyUp={(e) => onKey(e, false)}
    >
      <div {...win.bar}>
        <span className="font-semibold">🎯 Arena</span>
        <span className="opacity-70">{board.length} online · {focused ? 'controls on' : 'click to play'}</span>
        {win.moved && <button type="button" className="win-reset" aria-label="Reset window position" title="Reset position" onClick={win.reset}>⟲</button>}
            <button type="button" className="ml-auto" aria-label="Close arena" onClick={onClose}>✕</button>
      </div>
      <div className="fps-stage">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="fps-canvas"
          data-testid="arena-canvas"
          onPointerDown={(e) => {
            unlockSounds();
            wrapRef.current?.focus();
            if (e.pointerType === 'mouse' && document.pointerLockElement !== canvasRef.current) {
              canvasRef.current?.requestPointerLock?.();
            }
            shoot();
          }}
        />
        <div className="fps-feed">{feed.map((f) => <div key={f.key}>💥 {f.text}</div>)}</div>
        <div className="fps-board" data-testid="arena-board">
          {board.slice(0, 6).map((p) => (
            <div key={p.id} className={p.id === me.current.id ? 'fps-me' : ''}>
              <span style={{ color: colorFor(p.id) }}>●</span> {p.name} <b>{p.k}</b>
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
          <button type="button" className="fps-fire" onPointerDown={(e) => { e.preventDefault(); unlockSounds(); shoot(); }}>FIRE</button>
        </div>
      ) : (
        <div className="fps-help">WASD / arrows move · mouse or Q/E turn · click or Space to shoot · Esc frees the mouse</div>
      )}
    </div>
  );
}

function useMemoTouch() {
  return useRef({ up: false, down: false, left: false, right: false });
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
    return { ...p, x: q.x + (p.x - q.x) * t, y: q.y + (p.y - q.y) * t };
  });
}

function drawSprite(ctx: CanvasRenderingContext2D, m: { x: number; y: number; a: number }, p: NetPlayer, zbuf: Float32Array) {
  const dx = p.x - m.x;
  const dy = p.y - m.y;
  const dist = Math.hypot(dx, dy);
  let rel = Math.atan2(dy, dx) - m.a;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  if (Math.abs(rel) > FOV / 2 + 0.3 || dist < 0.2) return;
  const perp = dist * Math.cos(rel);
  const sx = (rel / FOV + 0.5) * W;
  const size = Math.min(H * 1.5, (H / perp) * 0.7);
  const left = Math.floor(sx - size / 2);
  const top = H / 2 - size * 0.35;
  const color = colorFor(p.id);
  for (let col = Math.max(0, left); col < Math.min(W, left + size); col++) {
    if (zbuf[col] < perp) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(col, 0, 1, H);
    ctx.clip();
    // body: round cartoon blob with goggly eyes
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(sx, top + size * 0.55, size * 0.32, size * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(sx - size * 0.11, top + size * 0.38, size * 0.08, 0, Math.PI * 2);
    ctx.arc(sx + size * 0.11, top + size * 0.38, size * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(sx - size * 0.1, top + size * 0.39, size * 0.035, 0, Math.PI * 2);
    ctx.arc(sx + size * 0.12, top + size * 0.39, size * 0.035, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  const centerCol = Math.max(0, Math.min(W - 1, Math.round(sx)));
  if (zbuf[centerCol] >= perp) {
    ctx.font = `bold ${Math.max(8, Math.min(13, size * 0.18))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    const label = p.name;
    const tw = ctx.measureText(label).width;
    ctx.fillRect(sx - tw / 2 - 2, top - 2, tw + 4, 12);
    ctx.fillStyle = '#fff6d8';
    ctx.fillText(label, sx, top + 8);
    ctx.fillStyle = '#ff6060';
    ctx.fillRect(sx - 12, top + 11, 24, 2);
    ctx.fillStyle = '#5cd17a';
    ctx.fillRect(sx - 12, top + 11, (24 * p.hp) / MAX_HP, 2);
  }
}

