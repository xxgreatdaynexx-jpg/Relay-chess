import { gearLockReason } from '@/lib/gearLock';
import { useDoing } from '@/lib/doing';
import { restoreOpen } from '@/lib/restoreOpen';
import { ItemIcon } from './ItemIcon';
import { importWithReload, reloadOnceForChunkError } from '@/lib/chunkReload';
import { TopTab } from '@/components/TopTabs';
import { usePriceIndex } from '../lib/priceIndex';
import { MiningLeaderboard } from '@/components/MiningLeaderboard';
import { loadName } from '@/lib/playerName';
import { useWalletChips } from '@/lib/wallet';
import { isFrontWindow, useWindowDrag } from '@/lib/windowDrag';
/** Frame budget while the Mines window is behind another one. */
const BG_FRAME_MS = 250;
import { useEffect, useRef, useState } from 'react';
import { socket } from '@/lib/net';
import { mouseLook, readLook, LOCK_KEYS, arenaKey, crouchHeld, shouldBlockShortcut } from '@/lib/arenaInput';
import { playPickaxe, playPickup, unlockSounds } from '@/lib/sounds';
import type { Mines3D, MinerView, MobView } from '@/lib/mines3d';
import { levelOf, hasFloors, inLadder, MAX_FLOOR } from '../../../shared/mineFloors';
import { MOBS, WEAPONS, ARMORS, weaponDef, canBuyGear, type GearView } from '../../../shared/mineCombat';
import { MINE_CAVE_EVENT, CAVES, CAVE_DEFS, CAVE_MAIN_ORES, isCave, type CaveId, type MineNode, BACKPACK_CAP, NODE_R, ORES, ORE_ORDER, REACH, SWING_MS, isOre, inExit, priceOf, type Stack } from '../../../shared/mines';
import { MINE_TOOLS, canBuyTool, combinedSwingMul, type MineToolId, type MineToolsView } from '../../../shared/mineTools';
import { canStand, clampPitch, eyeHeightOf, moveHorizontal, speedOf, stepVertical, tryJump, type Body } from '../../../shared/fps';

const OPEN_KEY = 'relay-mines-open';
const CAVE_KEY = 'relay-mines-cave';

type Quote = { gross: number; paid: number; already: number } | null;
interface PackMsg { pack: Stack[]; load: number; cap: number; quote: Quote }

/** Shared mine: walk the cave, swing at ore, sell your backpack to the house. Same movement as the Arena. */
export function MinesPanel() {
  const [open, setOpen] = useState(() => restoreOpen(OPEN_KEY));
  
  const [cave, setCave] = useState<CaveId>(() => { const v = localStorage.getItem(CAVE_KEY); return isCave(v) ? v : 'mine'; });
  useEffect(() => localStorage.setItem(CAVE_KEY, cave), [cave]);
  // The city map's three mine buildings send you to a specific cave.
  useEffect(() => { const on = (e: Event) => { const c = (e as CustomEvent).detail; if (isCave(c)) { setCave(c); setOpen(true); } }; window.addEventListener(MINE_CAVE_EVENT, on); return () => window.removeEventListener(MINE_CAVE_EVENT, on); }, []);
  return (
    <div className={`mines-wrap ${open ? 'mines-open' : ''}`} data-testid="mines">
      <TopTab id="mines"><button type="button" className="sol-tab fps-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="mines-tab">
        {open ? '▴ Mines' : '⛏️ Mines'}
      </button></TopTab>
      {open && <MinesGame key={cave} cave={cave} onCave={setCave} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Nearest live creature on the crosshair within weapon reach (ray vs body sphere). */
function aimMob(mobs: MobView[], x: number, y: number, ez: number, a: number, p: number, reach: number): number {
  const d = [Math.cos(p) * Math.cos(a), Math.cos(p) * Math.sin(a), Math.sin(p)];
  let best = -1, bt = Infinity;
  for (const b of mobs) {
    if (b.hp <= 0) continue; const def = MOBS[b.k];
    const o = [b.x - x, b.y - y, def.z - ez]; const t = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
    if (t < 0 || t - def.radius > reach) continue;
    const miss = Math.hypot(o[0] - d[0] * t, o[1] - d[1] * t, o[2] - d[2] * t);
    if (miss < def.radius + 0.35 && t < bt) { bt = t; best = b.id; }
  }
  return best;
}
interface FloorMsg { floor: number; deepest: number; stops: number[]; hp: number; maxHp: number; nodes: number[]; x: number; y: number; z: number }

/** Nearest node the crosshair is on, within reach (ray vs sphere). */
function aimNode(nodes: MineNode[], x: number, y: number, ez: number, a: number, p: number, hp: number[]): number {
  const d = [Math.cos(p) * Math.cos(a), Math.cos(p) * Math.sin(a), Math.sin(p)];
  let best = -1, bt = REACH + NODE_R;
  nodes.forEach((n, i) => {
    if (hp[i] === -1) return;
    const o = [n.x - x, n.y - y, n.z - ez];
    const t = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
    if (t < 0) return;
    const miss = Math.hypot(o[0] - d[0] * t, o[1] - d[1] * t, o[2] - d[2] * t);
    if (miss < NODE_R + 0.1 && t < bt) { bt = t; best = i; }
  });
  return best;
}

function MinesGame({ cave, onCave, onClose }: { cave: CaveId; onCave: (c: CaveId) => void; onClose: () => void }) {
  useDoing('mining', CAVES[cave]?.name);
  const [floor, setFloorS] = useState(1);
  const lvl = useRef(levelOf(cave, 1));
  const MINE_MAP_ = () => lvl.current.map; const NODES_ = () => lvl.current.nodes;
  const [deepest, setDeepest] = useState(1);
  const [stops, setStops] = useState<number[]>([]);
  const [php, setPhp] = useState({ hp: 100, max: 100 });
  const [hurtT, setHurtT] = useState(0);
  const mobs = useRef<MobView[]>([]);
  const [mobAim, setMobAim] = useState(-1);
  const [gear, setGear] = useState<GearView | null>(null);
  const gearRef = useRef<GearView | null>(null); gearRef.current = gear;
  const [gearMsg, setGearMsg] = useState('');
  const [inLift, setInLift] = useState(false);
  const floorBusy = useRef(0);
  const gearEmit = (ev: string, body: object, done?: string) => socket.timeout(8000).emit(ev, body, (err: Error | null, r?: { ok: boolean; error?: string; gear?: GearView }) => {
    if (err || !r) { setGearMsg('The weapon store did not answer. Try again.'); return; }
    if (!r.ok) { setGearMsg(r.error ?? 'Weapon store error.'); return; }
    if (r.gear) setGear(r.gear); if (done) setGearMsg(done);
  });
  const applyFloor = (r: FloorMsg) => {
    const m = me.current;
    lvl.current = levelOf(cave, r.floor);
    hp.current = r.nodes; Object.assign(m, { x: r.x, y: r.y, z: r.z, vz: 0 }); mobs.current = [];
    setDeepest(r.deepest); setStops(r.stops); setPhp({ hp: r.hp, max: r.maxHp });
    setFloorS(r.floor);
  };
  const changeFloor = (ev: string, body: object) => {
    const now = performance.now(); if (now - floorBusy.current < 1000) return; floorBusy.current = now;
    socket.timeout(5000).emit(ev, body, (err: Error | null, r?: { ok: boolean; error?: string } & FloorMsg & PackMsg) => {
      if (err || !r) return; if (!r.ok) { flash(r.error ?? 'Could not move floors.'); return; }
      applyFloor(r); setPack({ pack: r.pack, load: r.load, cap: r.cap, quote: r.quote });
      flash(`Floor ${r.floor} · ${levelOf(cave, r.floor).band}`);
    });
  };
  const pidx = usePriceIndex();
  const wrapRef = useRef<HTMLDivElement>(null);
  const swingMs = useRef(SWING_MS); // server-sent, shorter with Mining level
  const glRef = useRef<HTMLCanvasElement>(null);
  const win = useWindowDrag('mines', wrapRef);
  const wallet = useWalletChips();
  const [status, setStatus] = useState('Heading down the shaft…');
  const [pack, setPack] = useState<PackMsg>({ pack: [], load: 0, cap: BACKPACK_CAP, quote: null });
  const [guest, setGuest] = useState(true);
  const [online, setOnline] = useState(0);
  // 🛠️ Tool Shop (request #16): owned/equipped tools + live prices; buying or equipping returns the new swing time.
  const [tools, setTools] = useState<MineToolsView | null>(null);
  const [toolMsg, setToolMsg] = useState('');
  const [swingShown, setSwingShown] = useState(SWING_MS);
  const applyTools = (r?: { ok: boolean; error?: string; tools?: MineToolsView; swingMs?: number }) => {
    if (!r) return; if (!r.ok) { setToolMsg(r.error ?? 'Tool shop error.'); return; }
    if (r.tools) { setTools(r.tools); three.current?.setTool(r.tools.equipped); }
    if (typeof r.swingMs === 'number' && r.swingMs > 0) { swingMs.current = r.swingMs; setSwingShown(r.swingMs); }
  };
  const toolEmit = (ev: string, body: object, done?: string) => socket.timeout(8000).emit(ev, body, (err: Error | null, r?: { ok: boolean; error?: string; tools?: MineToolsView; swingMs?: number }) => {
    if (err) { setToolMsg('The tool shop did not answer. Try again.'); return; } applyTools(r); if (r?.ok && done) setToolMsg(done);
  });
  const buyTool = (id: MineToolId) => toolEmit('mine_tools_buy', { tool: id }, `Bought the ${MINE_TOOLS.find((t) => t.id === id)?.name}. Equipped.`);
  const equipTool = (id: MineToolId) => toolEmit('mine_tools_equip', { tool: id });
  const [aim, setAim] = useState(-1);
  const [toast, setToast] = useState('');
  const [focused, setFocused] = useState(false);
  const [glError, setGlError] = useState('');
  const exiting = useRef(0);
  const packRef = useRef(pack); packRef.current = pack;
  const keys = useRef(new Set<string>());
  const look = useRef(readLook());
  const hp = useRef<number[]>(NODES_().map((n) => ORES[n.ore].hits));
  const me = useRef({ id: '', x: MINE_MAP_().spawns[0][0], y: MINE_MAP_().spawns[0][1], z: 0, vz: 0, grounded: true, crouch: false, sprint: false, a: 0, p: 0, walk: 0, lastSwing: 0, joined: false });
  const three = useRef<Mines3D | null>(null);
  const [loot, setLoot] = useState('');
  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast((c) => (c === t ? '' : c)), 2200); };

  useEffect(() => {
    let dead = false;
    const m = me.current;
    const join = () => socket.timeout(8000).emit('mines_join', { cave }, (err: Error | null, r?: { ok: boolean; error?: string; id: string; guest: boolean; x: number; y: number; z: number; a: number; nodes: number[]; swingMs?: number } & Partial<FloorMsg> & PackMsg) => {
      if (dead) return;
      if (err || !r?.ok) { setStatus(r?.error ?? 'Could not reach the mine.'); return; }
      if (typeof r.swingMs === 'number' && r.swingMs > 0) { swingMs.current = r.swingMs; setSwingShown(r.swingMs); }
      if (typeof r.floor === 'number') { lvl.current = levelOf(cave, r.floor); setFloorS(r.floor); setDeepest(r.deepest ?? 1); setStops(r.stops ?? []); setPhp({ hp: r.hp ?? 100, max: r.maxHp ?? 100 }); }
      const ok = canStand(r.x, r.y, r.z, MINE_MAP_()); const sp = MINE_MAP_().spawns[0]; // never start inside this cave's rock
      Object.assign(m, { id: r.id, x: ok ? r.x : sp[0], y: ok ? r.y : sp[1], z: ok ? r.z : 0, a: r.a, joined: true });
      hp.current = r.nodes; three.current?.setNodes(r.nodes); gearEmit('mine_gear_view', {});
      setGuest(r.guest); setPack({ pack: r.pack, load: r.load, cap: r.cap, quote: r.quote });
      setStatus(r.guest ? 'Guest: you can mine, sign in to sell.' : 'Click the view to play. Left click swings.');
      (window as unknown as { __minesQA?: unknown }).__minesQA = { me: m, hp, sock: socket, swing: () => three.current?.swing(), floor: () => lvl.current.floor, mobs, descend: () => changeFloor('mines_descend', {}), ride: (f: number) => changeFloor('mines_elevator', { floor: f }), attack: () => attackRef.current(), aim: () => aimNode(NODES_(), m.x, m.y, m.z + eyeHeightOf(m), m.a, m.p, hp.current) };
    });
    const onState = (s: { floor?: number; players: MinerView[]; nodes: number[]; mobs?: MobView[] }) => { if ((s.floor ?? 1) !== lvl.current.floor) return; mobs.current = s.mobs ?? []; three.current?.setMobs(mobs.current); hp.current = s.nodes; three.current?.setNodes(s.nodes); three.current?.setOthers(s.players, m.id); setOnline(s.players.length); };
    const onFx = (f: { node: number; broke: boolean }) => { three.current?.burstAt(f.node, f.broke); };
    const onHurt = (h: { hp: number; max: number; dmg: number }) => { setPhp({ hp: h.hp, max: h.max }); setHurtT(Date.now()); playPickaxe('hit'); };
    const onDied = (d: FloorMsg & PackMsg & { lost: Stack[] }) => {
      applyFloor(d); setPack({ pack: d.pack, load: d.load, cap: d.cap, quote: null });
      const n = d.lost.reduce((t, s) => t + s.qty, 0);
      flash(`💀 You blacked out! ${n ? `Dropped ${n} ore. ` : ''}Woke up on floor ${d.floor}.`);
    };
    const onMobFx = (f: { mob: number; killed: boolean }) => three.current?.mobHit(f.mob, f.killed);
    socket.on('mines_hurt', onHurt); socket.on('mines_died', onDied); socket.on('mines_mobfx', onMobFx);
    const onCorrect = (c: { x: number; y: number; z: number }) => { Object.assign(m, c); m.vz = 0; };
    socket.on('mines_state', onState); socket.on('mines_fx', onFx); socket.on('mines_correct', onCorrect); socket.on('connect', join);
    if (socket.connected) join(); else socket.connect();
    let raf = 0, last = performance.now(), sendAcc = 0, lastDraw = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      const k = keys.current;
      if (m.joined) {
        const want = crouchHeld(k, false);
        if (!want && m.crouch) { if (canStand(m.x, m.y, m.z, MINE_MAP_())) m.crouch = false; } else m.crouch = want;
        let f = 0, s = 0;
        if (k.has('w')) f++; if (k.has('s')) f--; if (k.has('d')) s++; if (k.has('a')) s--;
        m.sprint = k.has('shift') && f > 0 && !m.crouch;
        if (f || s) {
          const sp = speedOf(m) * dt, len = Math.hypot(f, s);
          const dx = (Math.cos(m.a) * f + Math.cos(m.a - Math.PI / 2) * -s) / len * sp, dy = (Math.sin(m.a) * f + Math.sin(m.a - Math.PI / 2) * -s) / len * sp;
          moveHorizontal(m as Body, dx, dy, MINE_MAP_()); m.walk += dt;
        }
        if (k.has(' ')) tryJump(m as Body);
        stepVertical(m as Body, dt, MINE_MAP_());
        sendAcc += dt;
        if (sendAcc >= 1 / 15) { sendAcc = 0; socket.volatile.emit('mines_move', { x: m.x, y: m.y, z: m.z, a: m.a, p: m.p, c: m.crouch, s: m.sprint }); }
        if (hasFloors(cave) && lvl.current.floor < MAX_FLOOR && inLadder(m.x, m.y)) changeFloorRef.current('mines_descend', {});
        { const il = inExit(m.x, m.y); setInLift((o) => (o === il ? o : il)); }
        if (inExit(m.x, m.y) && packRef.current.pack.length && performance.now() - exiting.current > 1500) { exiting.current = performance.now(); bankHaul(); }
        // Hold left click / long-press: keep swinging at the normal (Mining-perk) cadence; swing() gates the rate, the server stays authoritative.
        if (three.current) three.current.working = !!holding.current;
        if (holding.current) { if (document.hidden || !document.hasFocus()) holding.current = null; else swingRef.current(); }
        const ai = aimNode(NODES_(), m.x, m.y, m.z + eyeHeightOf(m), m.a, m.p, hp.current);
        setAim((o) => (o === ai ? o : ai));
        const mi = aimMob(mobs.current, m.x, m.y, m.z + eyeHeightOf(m), m.a, m.p, weaponDef(gearRef.current?.weapon).reach);
        setMobAim((o) => (o === mi ? o : mi));
      }
      // Hidden tab, or covered by another window without the pointer lock: draw at ~4 fps so other windows stay responsive.
      if (document.hidden) return;
      if (document.pointerLockElement !== glRef.current && !isFrontWindow(wrapRef.current)) { if (t - lastDraw < BG_FRAME_MS) return; }
      lastDraw = t;
      three.current?.render({ x: m.x, y: m.y, z: m.z + eyeHeightOf(m), a: m.a, p: m.p }, dt, m.walk);
    };
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(() => { const c = glRef.current; if (c && three.current) three.current.resize(c.clientWidth, c.clientHeight); });
    if (glRef.current) ro.observe(glRef.current);
    const resizeT = window.setInterval(() => { const c = glRef.current; if (c && three.current && (c.width !== Math.round(c.clientWidth * three.current.renderer.getPixelRatio()))) three.current.resize(c.clientWidth, c.clientHeight); }, 500);
    return () => {
      dead = true; cancelAnimationFrame(raf); ro.disconnect(); window.clearInterval(resizeT);
      socket.off('mines_state', onState); socket.off('mines_fx', onFx); socket.off('mines_correct', onCorrect); socket.off('connect', join); socket.off('mines_hurt', onHurt); socket.off('mines_died', onDied); socket.off('mines_mobfx', onMobFx);
      socket.emit('mines_leave');
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

  // 3D scene: rebuilt for each floor (the canvas is keyed by floor so each gets a fresh WebGL context).
  useEffect(() => {
    let dead = false;
    importWithReload(() => import('@/lib/mines3d')).then(({ Mines3D }) => {
      if (dead || !glRef.current) return;
      try {
        const t = new Mines3D(glRef.current, cave, floor); three.current = t;
        t.resize(glRef.current.clientWidth, glRef.current.clientHeight); t.setNodes(hp.current); t.setMobs(mobs.current);
        socket.timeout(3000).emit('inv_loadout', {}, (err: Error | null, r?: { ok: boolean; loadout?: Record<string, string | null> }) => { if (!err && r?.ok) three.current?.setPickSkin(r.loadout?.pickaxe ?? null); });
        toolEmit('mine_tools_view', {});
      } catch (e) { setGlError('3D is unavailable here: ' + (e as Error).message); }
    }).catch((e) => { if (!reloadOnceForChunkError(e)) setGlError('Could not load the 3D engine. Refresh to try again.'); });
    return () => { dead = true; const t = three.current; three.current = null; if (t) { t.renderer.forceContextLoss?.(); t.dispose(); } };
  }, [floor]);
  const changeFloorRef = useRef(changeFloor); changeFloorRef.current = changeFloor;
  const attackRef = useRef<() => boolean>(() => false);
  attackRef.current = attack;
  function attack(): boolean {
    const m = me.current; const w = weaponDef(gearRef.current?.weapon);
    const mob = aimMob(mobs.current, m.x, m.y, m.z + eyeHeightOf(m), m.a, m.p, w.reach);
    if (mob < 0) return false;
    const now = performance.now(); if (now - m.lastSwing < w.ms) return true;
    m.lastSwing = now; three.current?.swingSword(); playPickaxe('swing');
    socket.timeout(3000).emit('mines_attack', { mob }, (err: Error | null, r?: { ok: boolean; error?: string; hp: number; killed: boolean; dmg: number; loot?: Stack[] } & Partial<PackMsg>) => {
      if (err || !r) return;
      if (!r.ok) { if (r.error && !/fast/i.test(r.error)) flash(r.error); return; }
      three.current?.mobHit(mob, r.killed); playPickaxe(r.killed ? 'break' : 'hit');
      if (r.killed) { const n = (r.loot ?? []).reduce((t, s) => t + s.qty, 0); flash(n ? `Defeated! +${n} ore` : 'Defeated! (pack full)'); if (r.pack) setPack({ pack: r.pack, load: r.load ?? 0, cap: r.cap ?? BACKPACK_CAP, quote: r.quote ?? null }); }
    });
    return true;
  }
  const holding = useRef<null | 'mouse' | 'touch'>(null);
  const swingRef = useRef<() => void>(() => {});
  swingRef.current = swing;
  useEffect(() => {
    const stop = () => { holding.current = null; };
    const onUp = (e: MouseEvent) => { if (e.button === 0) stop(); };
    const onLock = () => { if (document.pointerLockElement !== glRef.current && holding.current === 'mouse') stop(); };
    document.addEventListener('mouseup', onUp); document.addEventListener('pointerlockchange', onLock); window.addEventListener('blur', stop); document.addEventListener('visibilitychange', stop);
    return () => { stop(); document.removeEventListener('mouseup', onUp); document.removeEventListener('pointerlockchange', onLock); window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', stop); };
  }, []);
  function swing() {
    const m = me.current, now = performance.now();
    if (!m.joined) return;
    if (attack()) return;
    if (now - m.lastSwing < swingMs.current) return;
    m.lastSwing = now;
    three.current?.swing();
    const node = aimNode(NODES_(), m.x, m.y, m.z + eyeHeightOf(m), m.a, m.p, hp.current);
    if (node < 0) { playPickaxe('swing'); return; }
    socket.timeout(3000).emit('mines_hit', { node }, (err: Error | null, r?: { ok: boolean; error?: string; hp: number; broke: boolean; full?: boolean; ore?: string; bonus?: number; swingMs?: number; drop?: { kind: string; id: string } } & Partial<PackMsg>) => {
      if (err || !r) return;
      if (typeof r.swingMs === 'number' && r.swingMs > 0) swingMs.current = r.swingMs;
      if (!r.ok) { playPickaxe('swing'); if (r.error && !/fast/.test(r.error)) flash(r.error); return; }
      if (r.full) { flash('Pack full! Head back to the EXIT lift to bank your haul.'); return; }
      playPickaxe(r.broke ? 'break' : 'hit');
      three.current?.burstAt(node, r.broke);
      hp.current[node] = r.broke ? -1 : r.hp; three.current?.setNodes(hp.current);
      if (r.broke && r.pack) { setPack({ pack: r.pack, load: r.load ?? 0, cap: r.cap ?? BACKPACK_CAP, quote: r.quote ?? null }); if (r.ore && isOre(r.ore)) flash(r.bonus ? `+${1 + r.bonus} ${ORES[r.ore].name} ⛏️ Mining bonus!` : `+1 ${ORES[r.ore].name}`); }
      if (r.drop) { setLoot(r.drop.kind === 'key' ? '🗝️ Found a Key!' : '🧰 Found a Chest!'); playPickup(); window.setTimeout(() => setLoot(''), 3200); }
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
    if (['w', 'a', 's', 'd', ' ', 'shift', 'c'].includes(k)) { e.preventDefault(); if (down) keys.current.add(k); else keys.current.delete(k); }
  }
  const lock = () => { unlockSounds?.(); const c = glRef.current; if (c && document.pointerLockElement !== c) { try { (c.requestPointerLock as unknown as (o?: object) => unknown)?.call(c, { unadjustedMovement: false }); } catch { /* ignore */ } (navigator as unknown as { keyboard?: { lock?: (k: string[]) => Promise<void> } }).keyboard?.lock?.(LOCK_KEYS).catch?.(() => {}); } };
  const carriedWorth = Math.floor(pack.pack.reduce((t, s) => t + s.qty * priceOf(s), 0) * pidx);
  const aimed = aim >= 0 ? NODES_()[aim] : null;
  const aimedMob = mobAim >= 0 ? mobs.current.find((b) => b.id === mobAim) ?? null : null;
  const floors = hasFloors(cave);
  const wNow = weaponDef(gear?.weapon);
  return (
    <div
      ref={wrapRef}
      className={`sol-panel fps-panel mines-panel ${focused ? 'fps-focused' : ''}${win.className}`}
      style={win.style}
      onPointerDownCapture={win.front}
      onPointerMove={win.onPanelMove}
      role="dialog" aria-label="Mines" tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!wrapRef.current?.contains(e.relatedTarget as Node)) { setFocused(false); keys.current.clear(); holding.current = null; } }}
      onKeyDown={(e) => onKey(e, true)} onKeyUp={(e) => onKey(e, false)}
    >
      {win.grips}
      <div {...win.bar}>
        <span className="font-semibold">⛏️</span>
        <select className="mines-cave" aria-label="Choose mine" data-testid="mines-cave" value={cave} onChange={(e) => { if (isCave(e.target.value)) onCave(e.target.value); }}>
          {CAVE_DEFS.filter((c) => c.id !== 'coral' || cave === 'coral').map((c) => <option key={c.id} value={c.id}>{c.name} · {CAVE_MAIN_ORES[c.id]}</option>)}
        </select>
        <span className="opacity-70">{online} mining · {focused ? 'controls on' : 'click to play'}</span>
        {win.moved && <button type="button" className="win-reset" aria-label="Reset window position" title="Reset position" onClick={win.reset}>⟲</button>}
        {wallet !== null && <span className="ml-auto text-xs font-semibold" data-testid="mines-wallet">🪙 {wallet.toLocaleString()}</span>}
        <button type="button" className={wallet === null ? 'ml-auto' : ''} aria-label="Close mines" onClick={onClose}>✕</button>
      </div>
      <div className="mines-body">
        <div className="mines-view">
          <canvas key={floor} ref={glRef} className="mines-gl" data-testid="mines-canvas" onMouseDown={(e) => { if (e.button !== 0) return; const wasActive = focused; if (document.pointerLockElement !== glRef.current) lock(); if (wasActive || document.pointerLockElement === glRef.current) { swing(); holding.current = 'mouse'; } }}
            onPointerDown={(e) => { if (e.pointerType !== 'touch') return; swing(); holding.current = 'touch'; }}
            onPointerUp={(e) => { if (e.pointerType === 'touch') holding.current = null; }} onPointerCancel={() => { holding.current = null; }} onContextMenu={(e) => e.preventDefault()} />
          <div className="mines-cross" aria-hidden="true" style={aimedMob ? { color: '#ff5050' } : undefined}>{aimedMob ? '⚔' : aimed ? '⊕' : '+'}</div>
          {aimedMob && <div className="mines-aim" style={{ color: '#ff8080', top: '56%' }} data-testid="mines-mob-aim">{MOBS[aimedMob.k].name} · {aimedMob.hp}/{aimedMob.max}</div>}
          {floors && <div className="mines-hud" data-testid="mines-hud" style={{ position: 'absolute', left: 10, top: 10, background: 'rgba(10,8,6,0.72)', color: '#fff4dc', padding: '6px 10px', borderRadius: 10, fontSize: 13, minWidth: 170, pointerEvents: 'none', boxShadow: Date.now() - hurtT < 400 ? '0 0 0 3px #ff3030' : undefined }}>
            <div><b>🪜 Floor {floor}</b> · {lvl.current.band}</div>
            <div style={{ marginTop: 4 }}>❤️ {php.hp}/{php.max}<div style={{ height: 7, background: '#3a1010', borderRadius: 4, marginTop: 2 }}><i style={{ display: 'block', height: '100%', borderRadius: 4, width: `${Math.max(0, Math.min(100, (php.hp / php.max) * 100))}%`, background: php.hp / php.max > 0.5 ? '#50d050' : php.hp / php.max > 0.25 ? '#ffc030' : '#ff4040' }} /></div></div>
            <div style={{ marginTop: 4, opacity: 0.85 }}>{wNow.icon} {wNow.name} · {wNow.dmg} dmg</div>
            <div className="mines-haul" data-testid="mines-haul" style={{ position: 'static', marginTop: 4, padding: 0, background: 'none' }}>🎒 {pack.pack.reduce((t, s) => t + s.qty, 0)} carried · ~🪙{carriedWorth}{inExit(me.current.x, me.current.y) ? ' · at EXIT' : ''}</div>
          </div>}
          {floors && inLift && stops.length > 1 && <div className="mines-elevator" data-testid="mines-elevator" style={{ position: 'absolute', right: 10, top: 10, background: 'rgba(6,35,18,0.88)', border: '2px solid #3dff8a', color: '#cfffe0', padding: '6px 8px', borderRadius: 10, fontSize: 13, maxWidth: 220 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>🛗 Elevator</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{stops.map((f) => <button type="button" key={f} disabled={f === floor} data-testid={`mines-elev-${f}`} onClick={() => changeFloor('mines_elevator', { floor: f })} style={{ padding: '2px 8px', borderRadius: 6, background: f === floor ? '#2a6a3a' : '#0f4a26', color: '#fff', border: '1px solid #3dff8a', opacity: f === floor ? 0.6 : 1 }}>{f}</button>)}</div>
          </div>}
          {aimed && <div className="mines-aim" style={{ color: ORES[aimed.ore].color }}>{ORES[aimed.ore].name} · {Math.max(0, hp.current[aim])}/{ORES[aimed.ore].hits}</div>}
          {toast && <div className="mines-toast" data-testid="mines-toast">{toast}</div>}
          {loot && <div className="mines-toast mines-loot" data-testid="mines-loot">{loot}</div>}
          {glError && <div className="mines-toast">{glError}</div>}
          {!floors && <div className="mines-haul" data-testid="mines-haul">🎒 {pack.pack.reduce((t, s) => t + s.qty, 0)} carried · ~🪙{carriedWorth}{inExit(me.current.x, me.current.y) ? ' · at EXIT' : ''}</div>}
          <div className="mines-hint">{floors ? `Deepest: floor ${deepest} · ` : ''}{status} · WASD move · Shift sprint · C crouch · Space jump · Esc release</div>
        </div>
        <aside className="mines-side" data-testid="mines-pack">
          <div className="mines-load">⛏️ Carried {pack.load}/{pack.cap}<div className="mines-bar"><i style={{ width: `${Math.min(100, (pack.load / pack.cap) * 100)}%` }} /></div></div>
          <ul>
            {ORE_ORDER.map((id) => { const s = pack.pack.find((p) => p.type === 'ore' && p.id === id); if (!s) return null; return (
              <li key={id}><ItemIcon type="ore" id={id} />{ORES[id].name}<b>×{s.qty}</b></li>
            ); })}
            {pack.pack.length === 0 && <li className="opacity-60">Nothing carried. Go swing at some rock.</li>}
          </ul>
          <button type="button" className="mines-sell" disabled title="Leave the mine to sell" data-testid="mines-sell">Leave the mine to sell</button>
          <p className="mines-note">Walk back to the glowing <b>EXIT</b> lift at the entrance to bank your haul. If you drop out without it, your haul is saved and waits in your backpack for next time.{guest ? ' Guests can mine but not sell.' : ' Sell and smelt banked ore in the 🏭 Factory tab.'}</p>
          {floors && <details className="mines-prices mines-tools" open data-testid="mines-weapon-store"><summary>⚔️ Weapon Store</summary>
            <div className="mines-tools-now">HP <b>{php.max}</b> · {wNow.name} <b>{wNow.dmg}</b> dmg</div>
            {WEAPONS.map((w) => { const owned = w.tier === 0 || !!gear?.owned.includes(w.id), on = (gear?.weapon ?? 'rusty_sword') === w.id, price = gear?.prices[w.id] ?? w.price, can = !!gear && !guest && canBuyGear('weapon', w.id, gear.owned);
              return (<div key={w.id} className={`mines-tool ${on ? 'on' : ''}`} data-testid={`mines-gear-${w.id}`}>
                <span style={{ fontSize: 20, width: 28, textAlign: 'center' }}>{w.icon}</span>
                <span className="mines-tool-name">{w.name}<small>{w.dmg} dmg · {(w.ms / 1000).toFixed(2)}s · reach {w.reach}</small></span>
                {on ? <em>Equipped</em> : owned ? <button type="button" onClick={() => gearEmit('mine_gear_equip', { item: w.id })}>Equip</button>
                  : <span className="mines-lock" title={gearLockReason(WEAPONS, w, can, guest, wallet, price) || undefined} data-testid={`mines-lock-${w.id}`}><button type="button" disabled={!can || (wallet != null && wallet < price)} onClick={() => gearEmit('mine_gear_buy', { item: w.id }, `Bought the ${w.name}. Equipped.`)}>{gearLockReason(WEAPONS, w, can, guest, wallet, price) ? '🔒 ' : ''}🪙{price.toLocaleString()}</button></span>}
              </div>); })}
            {ARMORS.filter((a) => a.tier > 0).map((a) => { const owned = !!gear?.owned.includes(a.id), on = gear?.armor === a.id, price = gear?.prices[a.id] ?? a.price, can = !!gear && !guest && canBuyGear('armor', a.id, gear.owned);
              return (<div key={a.id} className={`mines-tool ${on ? 'on' : ''}`} data-testid={`mines-gear-${a.id}`}>
                <span style={{ fontSize: 20, width: 28, textAlign: 'center' }}>{a.icon}</span>
                <span className="mines-tool-name">{a.name}<small>+{a.hp} HP · -{Math.round(a.def * 100)}% damage</small></span>
                {on ? <em>Equipped</em> : owned ? <button type="button" onClick={() => gearEmit('mine_gear_equip', { item: a.id })}>Equip</button>
                  : <span className="mines-lock" title={gearLockReason(ARMORS, a, can, guest, wallet, price) || undefined} data-testid={`mines-lock-${a.id}`}><button type="button" disabled={!can || (wallet != null && wallet < price)} onClick={() => gearEmit('mine_gear_buy', { item: a.id }, `Bought ${a.name}. Equipped.`)}>{gearLockReason(ARMORS, a, can, guest, wallet, price) ? '🔒 ' : ''}🪙{price.toLocaleString()}</button></span>}
              </div>); })}
            <p className="mines-note">Creatures appear from floor 3 and get tougher every floor. Aim at one and click to strike. Fall in battle and you drop half of what you carry, then wake at the last elevator stop. Gear is yours to keep.</p>
            {gearMsg && <p className="mines-note" data-testid="mines-gear-msg">{gearMsg}</p>}
          </details>}
          <details className="mines-prices mines-tools" open={!floors} data-testid="mines-tool-shop"><summary>🛠️ Tool Shop</summary>
            <div className="mines-tools-now">Swing: <b>{(swingShown / 1000).toFixed(2)}s</b>{tools ? ` · ${MINE_TOOLS.find((t) => t.id === tools.equipped)?.name}` : ''}</div>
            {MINE_TOOLS.map((t) => { const owned = t.tier === 0 || !!tools?.owned.includes(t.id), on = (tools?.equipped ?? 'pickaxe') === t.id, price = tools?.prices[t.id] ?? t.price, can = !!tools && !guest && canBuyTool(tools.owned, t.id);
              return (
                <div key={t.id} className={`mines-tool ${on ? 'on' : ''}`} data-testid={`mines-tool-${t.id}`} title={t.blurb}>
                  <ItemIcon type="tool" id={t.id} />
                  <span className="mines-tool-name">{t.name}<small>{t.tier ? `${+(1 / t.swingMul).toFixed(2)}× speed` : 'Starter'}{t.bonus ? ` · +${Math.round(t.bonus * 100)}% ore` : ''}</small></span>
                  {on ? <em>Equipped</em> : owned ? <button type="button" onClick={() => equipTool(t.id)}>Equip</button>
                    : <span className="mines-lock" title={gearLockReason(MINE_TOOLS, t, can, guest, wallet, price) || undefined} data-testid={`mines-lock-${t.id}`}><button type="button" disabled={!can || (wallet != null && wallet < price)} onClick={() => buyTool(t.id)}>{gearLockReason(MINE_TOOLS, t, can, guest, wallet, price) ? '🔒 ' : ''}🪙{price.toLocaleString()}</button></span>}
                </div>
              ); })}
            <p className="mines-note">Tools stack with your Mining level (up to {+(1 / combinedSwingMul(0, 'pickaxe')).toFixed(1)}× speed). Key/chest drops are unchanged.</p>
            {toolMsg && <p className="mines-note" data-testid="mines-tool-msg">{toolMsg}</p>}
          </details>
          <details className="mines-prices mines-board" data-testid="mines-board-panel"><summary>🏆 Leaderboard</summary><MiningLeaderboard compact you={guest ? '' : loadName()} /></details>
          <details className="mines-prices"><summary>Prices</summary>{ORE_ORDER.map((id) => <div key={id}><ItemIcon type="ore" id={id} />{ORES[id].name}: {ORES[id].price} · {ORES[id].hits} hits</div>)}</details>
        </aside>
      </div>
    </div>
  );
}
