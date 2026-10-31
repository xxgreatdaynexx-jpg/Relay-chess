import { TopTab } from '@/components/TopTabs';
import { useWalletChips } from '@/lib/wallet';
import { useWindowDrag } from '@/lib/windowDrag';
import { useEffect, useRef, useState } from 'react';
import { socket } from '@/lib/net';
import { mouseLook, readLook, LOCK_KEYS, arenaKey, crouchHeld, shouldBlockShortcut } from '@/lib/arenaInput';
import { playPickaxe, unlockSounds } from '@/lib/sounds';
import type { Mines3D, MinerView } from '@/lib/mines3d';
import { BACKPACK_CAP, MINE_MAP, MINE_NODES, NODE_R, ORES, ORE_ORDER, REACH, SWING_MS, isOre, inExit, priceOf, type Stack } from '../../../shared/mines';
import { canStand, clampPitch, eyeHeightOf, moveHorizontal, speedOf, stepVertical, tryJump, type Body } from '../../../shared/fps';

const OPEN_KEY = 'relay-mines-open';
type Quote = { gross: number; paid: number; already: number } | null;
interface PackMsg { pack: Stack[]; load: number; cap: number; quote: Quote }

/** Shared mine: walk the cave, swing at ore, sell your backpack to the house. Same movement as the Arena. */
export function MinesPanel() {
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1');
  useEffect(() => localStorage.setItem(OPEN_KEY, open ? '1' : '0'), [open]);
  return (
    <div className={`mines-wrap ${open ? 'mines-open' : ''}`} data-testid="mines">
      <TopTab id="mines"><button type="button" className="sol-tab fps-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="mines-tab">
        {open ? '▴ Mines' : '⛏️ Mines'}
      </button></TopTab>
      {open && <MinesGame onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Nearest node the crosshair is on, within reach (ray vs sphere). */
function aimNode(x: number, y: number, ez: number, a: number, p: number, hp: number[]): number {
  const d = [Math.cos(p) * Math.cos(a), Math.cos(p) * Math.sin(a), Math.sin(p)];
  let best = -1, bt = REACH + NODE_R;
  MINE_NODES.forEach((n, i) => {
    if (hp[i] === -1) return;
    const o = [n.x - x, n.y - y, n.z - ez];
    const t = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
    if (t < 0) return;
    const miss = Math.hypot(o[0] - d[0] * t, o[1] - d[1] * t, o[2] - d[2] * t);
    if (miss < NODE_R + 0.1 && t < bt) { bt = t; best = i; }
  });
  return best;
}

function MinesGame({ onClose }: { onClose: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const win = useWindowDrag('mines', wrapRef);
  const wallet = useWalletChips();
  const [status, setStatus] = useState('Heading down the shaft…');
  const [pack, setPack] = useState<PackMsg>({ pack: [], load: 0, cap: BACKPACK_CAP, quote: null });
  const [guest, setGuest] = useState(true);
  const [online, setOnline] = useState(0);
  const [aim, setAim] = useState(-1);
  const [toast, setToast] = useState('');
  const [focused, setFocused] = useState(false);
  const [glError, setGlError] = useState('');
  const exiting = useRef(0);
  const packRef = useRef(pack); packRef.current = pack;
  const keys = useRef(new Set<string>());
  const look = useRef(readLook());
  const hp = useRef<number[]>(MINE_NODES.map((n) => ORES[n.ore].hits));
  const me = useRef({ id: '', x: MINE_MAP.spawns[0][0], y: MINE_MAP.spawns[0][1], z: 0, vz: 0, grounded: true, crouch: false, sprint: false, a: 0, p: 0, walk: 0, lastSwing: 0, joined: false });
  const three = useRef<Mines3D | null>(null);
  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast((c) => (c === t ? '' : c)), 2200); };

  useEffect(() => {
    let dead = false;
    const m = me.current;
    const join = () => socket.timeout(8000).emit('mines_join', {}, (err: Error | null, r?: { ok: boolean; error?: string; id: string; guest: boolean; x: number; y: number; z: number; a: number; nodes: number[] } & PackMsg) => {
      if (dead) return;
      if (err || !r?.ok) { setStatus(r?.error ?? 'Could not reach the mine.'); return; }
      Object.assign(m, { id: r.id, x: r.x, y: r.y, z: r.z, a: r.a, joined: true });
      hp.current = r.nodes; three.current?.setNodes(r.nodes);
      setGuest(r.guest); setPack({ pack: r.pack, load: r.load, cap: r.cap, quote: r.quote });
      setStatus(r.guest ? 'Guest: you can mine, sign in to sell.' : 'Click the view to play. Left click swings.');
      (window as unknown as { __minesQA?: unknown }).__minesQA = { me: m, hp, sock: socket, swing: () => three.current?.swing(), aim: () => aimNode(m.x, m.y, m.z + eyeHeightOf(m), m.a, m.p, hp.current) };
    });
    const onState = (s: { players: MinerView[]; nodes: number[] }) => { hp.current = s.nodes; three.current?.setNodes(s.nodes); three.current?.setOthers(s.players, m.id); setOnline(s.players.length); };
    const onFx = (f: { node: number; broke: boolean }) => { three.current?.burstAt(f.node, f.broke); };
    const onCorrect = (c: { x: number; y: number; z: number }) => { Object.assign(m, c); m.vz = 0; };
    socket.on('mines_state', onState); socket.on('mines_fx', onFx); socket.on('mines_correct', onCorrect); socket.on('connect', join);
    if (socket.connected) join(); else socket.connect();
    // 3D scene
    import('@/lib/mines3d').then(({ Mines3D }) => {
      if (dead || !glRef.current) return;
      try { three.current = new Mines3D(glRef.current); three.current.setNodes(hp.current); socket.timeout(3000).emit('inv_loadout', {}, (err: Error | null, r?: { ok: boolean; loadout?: Record<string, string | null> }) => { if (!err && r?.ok) three.current?.setPickSkin(r.loadout?.pickaxe ?? null); }); } catch (e) { setGlError('3D is unavailable here: ' + (e as Error).message); }
    });
    let raf = 0, last = performance.now(), sendAcc = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      const k = keys.current;
      if (m.joined) {
        const want = crouchHeld(k, false);
        if (!want && m.crouch) { if (canStand(m.x, m.y, m.z, MINE_MAP)) m.crouch = false; } else m.crouch = want;
        let f = 0, s = 0;
        if (k.has('w')) f++; if (k.has('s')) f--; if (k.has('d')) s++; if (k.has('a')) s--;
        m.sprint = k.has('shift') && f > 0 && !m.crouch;
        if (f || s) {
          const sp = speedOf(m) * dt, len = Math.hypot(f, s);
          const dx = (Math.cos(m.a) * f + Math.cos(m.a - Math.PI / 2) * -s) / len * sp, dy = (Math.sin(m.a) * f + Math.sin(m.a - Math.PI / 2) * -s) / len * sp;
          moveHorizontal(m as Body, dx, dy, MINE_MAP); m.walk += dt;
        }
        if (k.has(' ')) tryJump(m as Body);
        stepVertical(m as Body, dt, MINE_MAP);
        sendAcc += dt;
        if (sendAcc >= 1 / 15) { sendAcc = 0; socket.volatile.emit('mines_move', { x: m.x, y: m.y, z: m.z, a: m.a, p: m.p, c: m.crouch, s: m.sprint }); }
        if (inExit(m.x, m.y) && packRef.current.pack.length && performance.now() - exiting.current > 1500) { exiting.current = performance.now(); bankHaul(); }
        const ai = aimNode(m.x, m.y, m.z + eyeHeightOf(m), m.a, m.p, hp.current);
        setAim((o) => (o === ai ? o : ai));
      }
      three.current?.render({ x: m.x, y: m.y, z: m.z + eyeHeightOf(m), a: m.a, p: m.p }, dt, m.walk);
    };
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(() => { const c = glRef.current; if (c && three.current) three.current.resize(c.clientWidth, c.clientHeight); });
    if (glRef.current) ro.observe(glRef.current);
    const resizeT = window.setInterval(() => { const c = glRef.current; if (c && three.current && (c.width !== Math.round(c.clientWidth * three.current.renderer.getPixelRatio()))) three.current.resize(c.clientWidth, c.clientHeight); }, 500);
    return () => {
      dead = true; cancelAnimationFrame(raf); ro.disconnect(); window.clearInterval(resizeT);
      socket.off('mines_state', onState); socket.off('mines_fx', onFx); socket.off('mines_correct', onCorrect); socket.off('connect', join);
      socket.emit('mines_leave');
      three.current?.dispose(); three.current = null;
      if (document.pointerLockElement) document.exitPointerLock?.();
    };
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== glRef.current) return;
      const [da, dp] = mouseLook(look.current, false, e.movementX, e.movementY);
      const m = me.current; m.a += da; m.p = clampPitch(m.p + dp) ?? m.p;
    };
    const onLock = () => { if (document.pointerLockElement !== glRef.current) keys.current.clear(); };
    document.addEventListener('mousemove', onMove); document.addEventListener('pointerlockchange', onLock);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('pointerlockchange', onLock); };
  }, []);

  function swing() {
    const m = me.current, now = performance.now();
    if (!m.joined || now - m.lastSwing < SWING_MS) return;
    m.lastSwing = now;
    three.current?.swing();
    const node = aimNode(m.x, m.y, m.z + eyeHeightOf(m), m.a, m.p, hp.current);
    if (node < 0) { playPickaxe('swing'); return; }
    socket.timeout(3000).emit('mines_hit', { node }, (err: Error | null, r?: { ok: boolean; error?: string; hp: number; broke: boolean; full?: boolean; ore?: string } & Partial<PackMsg>) => {
      if (err || !r) return;
      if (!r.ok) { playPickaxe('swing'); if (r.error && !/fast/.test(r.error)) flash(r.error); return; }
      if (r.full) { flash('Pack full! Head back to the EXIT lift to bank your haul.'); return; }
      playPickaxe(r.broke ? 'break' : 'hit');
      three.current?.burstAt(node, r.broke);
      hp.current[node] = r.broke ? -1 : r.hp; three.current?.setNodes(hp.current);
      if (r.broke && r.pack) { setPack({ pack: r.pack, load: r.load ?? 0, cap: r.cap ?? BACKPACK_CAP, quote: r.quote ?? null }); if (r.ore && isOre(r.ore)) flash(`+1 ${ORES[r.ore].name}`); }
    });
  }
  function bankHaul() {
    socket.timeout(5000).emit('mines_exit', {}, (err: Error | null, r?: { ok: boolean; error?: string; banked: Stack[]; worth: number } & PackMsg) => {
      if (err || !r?.ok) return;
      setPack({ pack: r.pack, load: r.load, cap: r.cap, quote: null });
      if (r.banked.length) { const n = r.banked.reduce((t, s) => t + s.qty, 0); flash(`Banked ${n} ore worth ~🪙 ${Math.floor(r.worth)}. Sell or smelt it in the Factory tab.`); playPickaxe('break'); }
    });
  }
  function onKey(e: React.KeyboardEvent, down: boolean) {
    const k = arenaKey(e);
    if (shouldBlockShortcut(e, true)) e.preventDefault();
    if (['w', 'a', 's', 'd', ' ', 'shift', 'control', 'c'].includes(k)) { e.preventDefault(); if (down) keys.current.add(k); else keys.current.delete(k); }
  }
  const lock = () => { unlockSounds?.(); const c = glRef.current; if (c && document.pointerLockElement !== c) { try { (c.requestPointerLock as unknown as (o?: object) => unknown)?.call(c, { unadjustedMovement: false }); } catch { /* ignore */ } (navigator as unknown as { keyboard?: { lock?: (k: string[]) => Promise<void> } }).keyboard?.lock?.(LOCK_KEYS).catch?.(() => {}); } };
  const carriedWorth = Math.floor(pack.pack.reduce((t, s) => t + s.qty * priceOf(s), 0));
  const aimed = aim >= 0 ? MINE_NODES[aim] : null;
  return (
    <div
      ref={wrapRef}
      className={`sol-panel fps-panel mines-panel ${focused ? 'fps-focused' : ''}${win.className}`}
      style={win.style}
      onPointerDownCapture={win.front}
      onPointerMove={win.onPanelMove}
      role="dialog" aria-label="Mines" tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!wrapRef.current?.contains(e.relatedTarget as Node)) { setFocused(false); keys.current.clear(); } }}
      onKeyDown={(e) => onKey(e, true)} onKeyUp={(e) => onKey(e, false)}
    >
      {win.grips}
      <div {...win.bar}>
        <span className="font-semibold">⛏️ Mines</span>
        <span className="opacity-70">{online} mining · {focused ? 'controls on' : 'click to play'}</span>
        {win.moved && <button type="button" className="win-reset" aria-label="Reset window position" title="Reset position" onClick={win.reset}>⟲</button>}
        {wallet !== null && <span className="ml-auto text-xs font-semibold" data-testid="mines-wallet">🪙 {wallet.toLocaleString()}</span>}
        <button type="button" className={wallet === null ? 'ml-auto' : ''} aria-label="Close mines" onClick={onClose}>✕</button>
      </div>
      <div className="mines-body">
        <div className="mines-view">
          <canvas ref={glRef} className="mines-gl" data-testid="mines-canvas" onMouseDown={(e) => { if (e.button !== 0) return; const wasActive = focused; if (document.pointerLockElement !== glRef.current) lock(); if (wasActive || document.pointerLockElement === glRef.current) swing(); }} />
          <div className="mines-cross" aria-hidden="true">{aimed ? '⊕' : '+'}</div>
          {aimed && <div className="mines-aim" style={{ color: ORES[aimed.ore].color }}>{ORES[aimed.ore].name} · {Math.max(0, hp.current[aim])}/{ORES[aimed.ore].hits}</div>}
          {toast && <div className="mines-toast" data-testid="mines-toast">{toast}</div>}
          {glError && <div className="mines-toast">{glError}</div>}
          <div className="mines-haul" data-testid="mines-haul">🎒 {pack.pack.reduce((t, s) => t + s.qty, 0)} carried · ~🪙{carriedWorth}{inExit(me.current.x, me.current.y) ? ' · at EXIT' : ''}</div>
          <div className="mines-hint">{status} · WASD move · Shift sprint · Ctrl/C crouch · Space jump · Esc release</div>
        </div>
        <aside className="mines-side" data-testid="mines-pack">
          <div className="mines-load">⛏️ Carried {pack.load}/{pack.cap}<div className="mines-bar"><i style={{ width: `${Math.min(100, (pack.load / pack.cap) * 100)}%` }} /></div></div>
          <ul>
            {ORE_ORDER.map((id) => { const s = pack.pack.find((p) => p.type === 'ore' && p.id === id); if (!s) return null; return (
              <li key={id}><span className="mines-dot" style={{ background: ORES[id].color }} />{ORES[id].name}<b>×{s.qty}</b></li>
            ); })}
            {pack.pack.length === 0 && <li className="opacity-60">Nothing carried. Go swing at some rock.</li>}
          </ul>
          <button type="button" className="mines-sell" disabled title="Leave the mine to sell" data-testid="mines-sell">Leave the mine to sell</button>
          <p className="mines-note">Walk back to the glowing <b>EXIT</b> lift at the entrance to bank your haul. Drop out without it and you lose what you carry (60s to reconnect).{guest ? ' Guests can mine but not sell.' : ' Sell and smelt banked ore in the 🏭 Factory tab.'}</p>
          <details className="mines-prices"><summary>Prices</summary>{ORE_ORDER.map((id) => <div key={id}><span className="mines-dot" style={{ background: ORES[id].color }} />{ORES[id].name}: {ORES[id].price} · {ORES[id].hits} hits</div>)}</details>
        </aside>
      </div>
    </div>
  );
}
