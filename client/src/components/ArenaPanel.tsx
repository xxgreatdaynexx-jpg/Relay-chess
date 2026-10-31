import { TopTab } from '@/components/TopTabs';
import { useWalletChips } from '@/lib/wallet';
import { useWindowDrag } from '@/lib/windowDrag';
import { useEffect, useRef, useState } from 'react';
import { socket } from '@/lib/net';
import { LOOK_KEY, SENS_MAX, SENS_MIN, mouseLook, readLook, type LookPrefs, FPS_KEY, fpsFrom, hotkeyFor, isLockedTo, readFpsPref, stepFovKick, viewZoom, ARENA_GAME_KEYS, LOCK_KEYS, arenaKey, crouchHeld, shouldBlockShortcut } from '@/lib/arenaInput';
import { ArenaRenderer, minimapSize } from '@/lib/arenaRender';
import type { Arena3D, Fx3D, Soldier3D, Viewmodel3D } from '@/lib/arena3d';
import { prefersReducedMotion } from '@/lib/motion';
import { predictShot, ShotPredictor, adoptServerAmmo } from '../../../shared/arenaPredict';
import { INTERP_DELAY_MS, LOCAL_STEP_S, SnapBuffer, samplePlayers } from '../../../shared/netInterp';
import { TagVisibility, tagVisible } from '@/lib/arenaTags';
import type { ArenaMap } from '../../../shared/arenaMaps';
import { getExplosionVolume, setExplosionVolume, playArenaExplosion, playHit, playStreakCall, playWeaponShot, playKnife, playHeadshotDing, playLockBeep, playPickup, play360NoScope, playMultiKill, shotFalloff, unlockSounds } from '@/lib/sounds';
import { isTypingTarget, spaceRespawns } from '@/lib/respawnKey';
import { DEATH_HOLD_MS, fitSpeed, killCardText, sampleKillCam, shotsBetween, type CamFrame, type CamShot, type KillCard } from '@/lib/killcam';
import { arenaLiveHud, kiaCanvasStrip } from '@/lib/arenaHud';
import { feedParts, popupScale, POPUP_MS, type FeedItem } from '@/lib/arenaFeed';
import {
  AIRSTRIKE_RADIUS, RESPAWN_PICK_MS, canHold, isKnifeOnly, knifeOnlyAvailable, cheapestSpawn, isWeapon, spawnCost, applyCrouch, canSprint, SPRINT_FIRE_DELAY_MS, clampPitch, CROUCH_LERP_SPEED, CROUCH_SPREAD_MULT, EYE_HEIGHT, eyeHeightOf, mapById, speedOf, MAP, MAPS, MAX_HP, MAX_PITCH, MOVE_SPEED, moveHorizontal, weaponSpread, MoveHistory, reconcileMove, ROCKET_GRAVITY, ROCKET_LIFE_MS, stepVertical, surfaceNormal, STREAKS, tryJump, SWITCH_MS, TICK_HZ, WEAPON_ORDER, WEAPONS, type WeaponId,
  GRENADE_FUSE_MS, GRENADE_THROW_MS, GRENADES_PER_LIFE, stepGrenade, throwGrenade, type Grenade,
} from '../../../shared/fps';

const OPEN_KEY = 'relay-fps-open';
const QUALITY_KEY = 'relay-fps-quality';
const MAP_KEY = 'relay-fps-map';
const MAP_LIST = Object.values(MAPS);
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const COLORS = ['#5f6a48', '#7d7158', '#596066', '#6b6248', '#4f5a4c', '#73705f', '#565246', '#666e5a'];
const SCOPE_ZOOM = 3.5;
const FOV = 68; // vertical, degrees

interface NetPlayer { id: string; name: string; x: number; y: number; z: number; a: number; p: number; hp: number; k: number; d: number; alive: boolean; w: WeaponId; ammo: number; rl: number; g: boolean; st: number; uav: number; bot?: boolean; c?: boolean; s?: boolean; lo?: WeaponId; stk?: number; bk?: boolean; rs?: number; sk?: string; q?: number; ex?: WeaponId[]; gn?: number }
interface MatchEnd { matchId: string; winnerId: string | null; reason: string; players: Array<{ id: string; name: string; kills: number; deaths: number; earned: number; alive: boolean; bot: boolean }>; prize?: { name: string; amount: number }; inMs: number }
interface NetState { phase?: 'play' | 'sudden' | 'ended'; alive?: number; sd?: number; end?: MatchEnd; t: number; map?: string; next?: string; picked?: boolean; left?: number; players: NetPlayer[]; drones: Array<{ ownerId: string; x: number; y: number; z: number }>; strikes: Array<{ x: number; y: number; z: number; inMs: number; r?: number; locked?: boolean }>; nuke: { by: string; inMs: number } | null; wh?: boolean; mysk?: Record<string, string>; roster?: Array<Pick<NetPlayer, 'id' | 'name' | 'k' | 'd' | 'st' | 'bot'>>; radar?: Array<{ x: number; y: number }>; rockets?: Array<{ id: number; ownerId: string; x: number; y: number; z: number; vx: number; vy: number; vz: number; seek?: number; lock?: string | null }>; drops?: Array<{ id: number; w: WeaponId; x: number; y: number; z: number; left: number; sk?: string }>; nades?: Array<{ id: number; ownerId: string; x: number; y: number; z: number; vx: number; vy: number; vz: number; left: number }> }
interface Snap extends NetState { recv: number }
type Quality = 'hd' | 'lo';

/** Same as arena3d's TRACER_SPEED (that module is lazy-loaded, so it isn't imported here). */
const TRACER_SPEED = 160;
/** Material of the box (if any) at a world point, for spark/dust colours. */
function materialAt(map: ArenaMap, x: number, y: number, z: number): string | undefined {
  for (const s of map.solids) if (x >= s.x0 - 0.02 && x <= s.x1 + 0.02 && y >= s.y0 - 0.02 && y <= s.y1 + 0.02 && z >= s.z0 - 0.02 && z <= s.z1 + 0.02) return s.mat;
  return z < 0.05 ? map.ground : undefined;
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
  const wallet = useWalletChips();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [multiPop, setMultiPop] = useState<{ key: number; title: string; level: number } | null>(null);
  // Paid spawns: the loadout you pick on the death screen (saved), what's staked on this life, and +/- chip toasts.
  const [loadout, setLoadoutState] = useState<WeaponId>(() => { const v = typeof localStorage !== 'undefined' ? localStorage.getItem('arena-loadout') : null; return v && isWeapon(v) ? v : 'pistol'; });
  const loadoutRef = useRef(loadout);
  const [life, setLife] = useState<{ alive: boolean; stake: number; broke: boolean; lo: WeaponId; paid: boolean; rs: number }>({ alive: true, stake: 0, broke: false, lo: 'pistol', paid: false, rs: 0 });
  const [matchUi, setMatchUi] = useState<{ phase: 'play' | 'sudden' | 'ended'; alive: number; sd: number; end: MatchEnd | null }>({ phase: 'play', alive: 0, sd: 0, end: null });
  const [chipToasts, setChipToasts] = useState<Array<{ key: number; amount: number; memo: string }>>([]);
  useEffect(() => {
    let n = 0;
    const onWallet = (p: { tx?: { game?: string; amount?: number; memo?: string } }) => {
      const t = p?.tx;
      if (!t || t.game !== 'arena' || !t.amount) return;
      const key = ++n + Date.now();
      setChipToasts((o) => [...o.slice(-2), { key, amount: t.amount!, memo: t.memo ?? '' }]);
      setTimeout(() => setChipToasts((o) => o.filter((x) => x.key !== key)), 2600);
    };
    socket.on('wallet', onWallet);
    return () => { socket.off('wallet', onWallet); };
  }, []);
  function pickLoadout(w: WeaponId) {
    setLoadoutState(w); loadoutRef.current = w;
    try { localStorage.setItem('arena-loadout', w); } catch { /* private mode */ }
    socket.emit('fps_loadout', { w });
  }
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
  const net = useRef({ buf: new SnapBuffer<NetState>(), corr: null as null | { x: number; y: number; left: number }, ping: 0, acc: 0, prev: null as null | { x: number; y: number; z: number }, sentCrouch: false, hist: new MoveHistory(), seq: 0 }).current;
  const [look, setLookState] = useState<LookPrefs>(() => readLook());
  const lookRef = useRef(look);
  const fsSupported = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const [isFs, setIsFs] = useState(false);
  const [fsDismissed, setFsDismissed] = useState(() => { try { return sessionStorage.getItem('relay-arena-fs-dismissed') === '1'; } catch { return false; } });
  const [lookOpen, setLookOpen] = useState(false);
  const [boomVol, setBoomVol] = useState(getExplosionVolume);
  const setLook = (patch: Partial<LookPrefs>) => setLookState((cur) => {
    const next = { ...cur, ...patch }; lookRef.current = next;
    try { localStorage.setItem(LOOK_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  });
  const [quality, setQuality] = useState<Quality>(() => (localStorage.getItem(QUALITY_KEY) as Quality) || (isTouch ? 'lo' : 'hd'));
  const qualityRef = useRef(quality);
  useEffect(() => { qualityRef.current = quality; localStorage.setItem(QUALITY_KEY, quality); }, [quality]);
  const keys = useRef(new Set<string>());
  const me = useRef({
    id: '', x: 1.5, y: 1.5, z: 0, vz: 0, grounded: true, p: 0, a: 0, alive: true, hp: MAX_HP, joined: false, weapon: 'pistol' as WeaponId,
    ammo: WEAPONS.pistol.mag, reloadUntil: 0, switchedAt: -1e9, lastShot: {} as Partial<Record<WeaponId, number>>,
    jumpAt: -1e9, scoped: false, firing: false, semiPending: false, streak: 0, uavUntil: 0, walk: 0, crouch: false, eyeH: EYE_HEIGHT, sprint: false, sprintEndAt: -1e9, fovKick: 0, meleeReadyAt: 0, localActAt: -1e9,
  });
  const snaps = useRef<Snap[]>([]);
  const lifeLoRef = useRef<WeaponId | null>(null);
  /** Guns picked up from drops this life (server's list). */
  const extraRef = useRef<WeaponId[]>([]);
  const [pickToast, setPickToast] = useState<{ key: number; text: string } | null>(null);
  const phaseRef = useRef<'play' | 'sudden' | 'ended'>('play');
  const specRef = useRef<string | null>(null);
  // Kill cam: fetched on request from the respawn screen, played until done or until we respawn (never delays it).
  const deathAtRef = useRef(0);
  const kcRef = useRef<{ track: CamFrame[]; card: KillCard; start: number; speed: number; shots?: CamShot[]; ct: number; fireAt: number; hitAt: number; walk: number } | null>(null);
  const [killCam, setKillCam] = useState<{ card: KillCard | null; playing: boolean; note?: string } | null>(null);
  function watchKillCam() {
    if (me.current.alive || phaseRef.current !== 'play' || kcRef.current) return;
    socket.timeout(4000).emit('fps_killcam', {}, (err: Error | null, r?: unknown) => {
      if (err || !r) return;
      const res = r as unknown as { ok: boolean; card?: KillCard; track?: CamFrame[] | null; shots?: CamShot[] };
      if (me.current.alive) return;
      startKillCam(res);
    });
  }
  /** Start playback of a kill cam response (also the QA hook's entry point). */
  function startKillCam(res: { ok: boolean; card?: KillCard; track?: CamFrame[] | null; shots?: CamShot[] }) {
    {
      if (!res.ok || !res.card) { setKillCam({ card: null, playing: false, note: 'No kill cam for this death.' }); return; }
      const tr = res.track;
      if (!tr || tr.length < 2 || !res.card.killerId) { setKillCam({ card: res.card, playing: false, note: res.card.bot ? undefined : 'No replay data.' }); return; }
      const now = performance.now();
      const speed = fitSpeed(tr[tr.length - 1].t - tr[0].t, deathAtRef.current + RESPAWN_PICK_MS - now - 150 - DEATH_HOLD_MS);
      if (!Number.isFinite(speed) || speed > 6) { setKillCam({ card: res.card, playing: false, note: 'Respawning, no time for the replay.' }); return; }
      kcRef.current = { track: tr, card: res.card, start: now, speed, shots: res.shots, ct: -1, fireAt: -1e9, hitAt: -1e9, walk: 0 };
      setKillCam({ card: res.card, playing: true });
    }
  }
  // Headless QA hook (only with ?arenaKC=1): play a given kill cam response and seek it, for before/after screenshots.
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('arenaKC')) {
    const w = window as unknown as { __arenaKC?: unknown; __arenaKCSeek?: unknown };
    w.__arenaKC = (res: { ok: boolean; card?: KillCard; track?: CamFrame[] | null; shots?: CamShot[] }) => { kcRef.current = null; deathAtRef.current = performance.now() + 60_000; startKillCam(res); };
    w.__arenaKCSeek = (ms: number) => { const kc = kcRef.current; if (kc) { kc.start = performance.now() - ms; kc.ct = -1; } return 1; };
  }
  const pred = useRef(new ShotPredictor()).current;
  const fx = useRef({ muzzle: 0, hurt: 0, hitmark: 0, hitDeny: 0, dmgNums: [] as Array<{ v: number; head: boolean; at: number; denied?: number }>, killmark: 0, headmark: 0, melee: { at: -1e9, heavy: false }, meleeAt: new Map<string, { at: number; heavy: boolean }>(), nukeFlash: 0, dmgDirs: [] as Array<{ a: number; at: number }>, deaths: new Map<string, { at: number; x: number; y: number; z: number; a: number; name: string; fall: number }>(), booms: [] as Array<{ x: number; y: number; z: number; at: number; big: boolean }>, tracers: [] as Array<{ o: [number, number, number]; e: [number, number, number]; at: number; sniper?: boolean }>, impacts: [] as Array<{ x: number; y: number; z: number; player: boolean; at: number }>, blasts: [] as Array<{ x: number; y: number; z: number; big: boolean }>, shells: 0, rockets: new Map<number, { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; at: number; seek?: number }>(), lockAt: 0, lockBeep: 0, weaponAt: new Map<string, { w: string; at: number }>(), hitAt: new Map<string, number>(), shotAt: new Map<string, number>(), shake: 0, jetAt: 0, nades: new Map<number, Grenade>(), nadeSeq: 0, nadeAt: -1e9, nadesLeft: GRENADES_PER_LIFE });
  const banner = useRef<{ text: string; sub: string; at: number } | null>(null);
  const touch = useRef({ up: false, down: false, left: false, right: false, lookUp: false, lookDown: false });
  const [touchCrouch, setTouchCrouch] = useState(false);
  const touchCrouchRef = useRef(false);
  useEffect(() => { touchCrouchRef.current = touchCrouch; }, [touchCrouch]);
  const [touchSprint, setTouchSprint] = useState(false);
  const touchSprintRef = useRef(false);
  useEffect(() => { touchSprintRef.current = touchSprint; }, [touchSprint]);
  const [mapInfo, setMapInfo] = useState<{ map: string; next: string; picked: boolean; secs: number }>({ map: MAP.id, next: '', picked: false, secs: 0 });

  function setWeapon(w: WeaponId) {
    const m = me.current;
    if (m.weapon === w || (lifeLoRef.current !== null && !canHold(lifeLoRef.current, w) && !extraRef.current.includes(w))) return;
    m.weapon = w;
    m.switchedAt = performance.now();
    m.localActAt = m.switchedAt;
    m.reloadUntil = 0;
    m.scoped = false;
    socket.emit('fps_weapon', { w });
  }
  function cycleWeapon(dir: number) {
    const held = WEAPON_ORDER.filter((w) => lifeLoRef.current === null || canHold(lifeLoRef.current, w) || extraRef.current.includes(w));
    const i = held.indexOf(me.current.weapon);
    setWeapon(held[(i + dir + held.length) % held.length]);
  }
  /** G: throw a frag. Predicted locally right away; the server owns the count, fuse and damage. */
  function throwNade() {
    const m = me.current;
    const t = performance.now();
    if (!m.alive || !m.joined || fx.current.nadesLeft <= 0 || t - fx.current.nadeAt < GRENADE_THROW_MS) return;
    fx.current.nadeAt = t;
    fx.current.nadesLeft -= 1;
    const g = throwGrenade(-(++fx.current.nadeSeq), { id: m.id, x: m.x, y: m.y, z: m.z, a: m.a, p: m.p, crouch: m.crouch }, t);
    fx.current.nades.set(g.id, g);
    socket.emit('fps_nade', { a: m.a, p: m.p });
  }
  function reload() {
    const m = me.current;
    const spec = WEAPONS[m.weapon];
    if (m.reloadUntil || m.ammo >= spec.mag) return;
    m.reloadUntil = performance.now() + spec.reloadMs;
    m.localActAt = performance.now();
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
    const next = on && (m.weapon === 'sniper' || !!WEAPONS[m.weapon].adsZoom);
    if (next === m.scoped) return;
    m.scoped = next;
    socket.emit('fps_scope', { on: next });
  }
  function shoot(heavy = false) {
    const m = me.current;
    const now = performance.now();
    const spec = WEAPONS[m.weapon];
    if (!m.joined || !m.alive) return;
    if (spec.melee) {
      if (now - m.switchedAt < SWITCH_MS || now < m.meleeReadyAt) return;
      if (m.sprint) { m.sprint = false; m.sprintEndAt = now; }
      m.meleeReadyAt = now + (heavy ? spec.heavyCooldownMs! : spec.cooldownMs);
      m.lastShot[m.weapon] = now;
      fx.current.melee = { at: now, heavy };
      playKnife('swing');
      socket.emit('fps_shoot', { a: m.a, p: m.p, vt: Math.round(net.buf.renderTime(performance.now())), ...(heavy ? { h: true } : {}) });
      return;
    }
    if (m.reloadUntil && now < m.reloadUntil) return;
    if (now - m.switchedAt < SWITCH_MS) return;
    if (now - (m.lastShot[m.weapon] ?? -1e9) < spec.cooldownMs) return;
    // Sprint-to-fire: pulling the trigger ends the sprint, the gun comes up, then it fires (held trigger keeps trying).
    if (m.sprint) { m.sprint = false; m.sprintEndAt = now; return; }
    if (now - m.sprintEndAt < SPRINT_FIRE_DELAY_MS) return;
    if (m.ammo <= 0) return reload();
    m.lastShot[m.weapon] = now;
    m.semiPending = false;
    m.localActAt = now;
    m.ammo -= 1;
    if (m.ammo === 0) m.reloadUntil = now + spec.reloadMs;
    fx.current.muzzle = now;
    fx.current.shells++;
    playWeaponShot(m.weapon);
    const vt = Math.round(net.buf.renderTime(now));
    // Recoil kicks the camera AFTER the shot leaves: the bullet goes where the crosshair was (f3bbb4b kicked first, so AR-15 head shots sailed high).
    const kick = () => { if (spec.recoil) m.p = Math.min(MAX_PITCH, m.p + spec.recoil); };
    if (spec.splash) { socket.emit('fps_shoot', { a: m.a, p: m.p, vt }); kick(); return; }
    // Predicted shot: raycast against the interpolated players we're displaying right now; tracer, impact,
    // hit marker, damage number and headshot ding show instantly. The server (lag-compensated to vt) confirms
    // or denies by echoing sid; kills, feed and chips only ever come from the server.
    const sid = pred.newSid();
    const targets = samplePlayers(net.buf.snaps, net.buf.renderTime(now)).players.filter((p) => p.id !== m.id && p.alive).map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z, alive: true, crouch: !!p.c }));
    const ps = predictShot({ id: m.id, x: m.x, y: m.y, z: m.z, a: m.a, p: m.p, crouch: m.crouch }, spec, targets, mapRef.current, m.scoped);
    pushRays(m.weapon, [m.x, m.y, m.z], ps.rays.map((r) => [r.a, r.p, r.dist, r.hit ? 1 : 0]), now);
    pred.add(sid, ps.hits.size > 0, ps.head, now);
    if (ps.hits.size) {
      fx.current.hitmark = now; fx.current.hitDeny = 0;
      playHit();
      if (ps.head) playHeadshotDing();
      fx.current.dmgNums.push({ v: Math.round(ps.dmg), head: ps.head, at: now });
      if (fx.current.dmgNums.length > 8) fx.current.dmgNums.shift();
    }
    socket.emit('fps_shoot', { a: m.a, p: m.p, vt, sid });
    kick();
  }
  /** Server said our predicted hit missed: quietly fade the marker and damage number (rare). */
  function denyPrediction(now: number) {
    fx.current.hitDeny = now;
    const d = fx.current.dmgNums[fx.current.dmgNums.length - 1];
    if (d && !d.denied) d.denied = now;
  }
  /** Tracers + impact decals for a set of rays from origin o (shared by predicted and server-echoed shots). */
  function pushRays(w: WeaponId, o: [number, number, number], rays: Array<[number, number, number, number?]>, now: number) {
    // Tracers start a little below and ahead of the eye so your own don't sit on the crosshair.
    const [ox, oy, oz] = o;
    // Every shotgun pellet gets its own streak (they're cheap pooled lines).
    for (const [a, p, d, hit] of rays.slice(0, 12)) {
      const c = Math.cos(p);
      const start: [number, number, number] = [ox + Math.cos(a) * c * 0.6, oy + Math.sin(a) * c * 0.6, oz + 1.25];
      const e: [number, number, number] = [ox + Math.cos(a) * c * d, oy + Math.sin(a) * c * d, oz + EYE_HEIGHT + Math.sin(p) * d];
      fx.current.tracers.push({ o: start, e, at: now, sniper: w === 'sniper' });
      // The hole / puff appears when the streak gets there.
      if (d < WEAPONS[w].range - 0.05) fx.current.impacts.push({ x: e[0], y: e[1], z: e[2], player: !!hit, at: now + (d / TRACER_SPEED) * 1000 });
    }
  }

  // Networking
  useEffect(() => {
    const join = () => {
      const qaBots = Number(new URLSearchParams(window.location.search).get('arenaBots')) || 0;
      const want = localStorage.getItem(MAP_KEY);
      socket.timeout(8000).emit('fps_join', { ...(qaBots ? { qaBots } : {}), ...(want && MAPS[want] ? { map: want } : {}), w: loadoutRef.current }, (err: Error | null, ack?: { ok: boolean; id?: string; x?: number; y?: number; z?: number; a?: number; map?: string; error?: string; alive?: boolean; broke?: boolean }) => {
        if (err || !ack?.ok) return setStatus(ack?.error || 'Could not reach the arena.');
        if (ack.map) mapRef.current = mapById(ack.map);
        Object.assign(me.current, { id: ack.id, x: ack.x, y: ack.y, z: ack.z ?? 0, vz: 0, grounded: true, p: 0, a: ack.a, joined: true, alive: ack.alive !== false });
        setStatus('');
        // Local QA only (?arenaBots=N needs ARENA_QA_BOTS=1 on the server): read-only handle for play-test scripts.
        if (qaBots) (window as unknown as { __arenaQA?: unknown }).__arenaQA = { me: me.current, snaps: snaps.current, banner, sock: socket };
      });
    };
    const pingT = window.setInterval(() => { const t0 = performance.now(); socket.timeout(2000).emit('fps_ping', (err: Error | null) => { if (!err) net.ping = Math.round(performance.now() - t0); }); }, 2000);
    let feedKey = 0;
    const pushFeed = (e: Omit<FeedItem, 'key'>) => {
      const key = ++feedKey;
      setFeed((f) => [...f.slice(-4), { key, ...e }]);
      window.setTimeout(() => setFeed((f) => f.filter((x) => x.key !== key)), 5000);
    };
    const onState = (s: NetState) => {
      snaps.current.push({ ...s, recv: performance.now() });
      net.buf.push(s, performance.now());
      if (snaps.current.length > 6) snaps.current.shift();
      const m = me.current;
      const mine = s.players.find((p) => p.id === m.id);
      if ((s.rockets ?? []).some((r) => r.seek && r.lock === m.id)) {
        fx.current.lockAt = performance.now();
        if (performance.now() - fx.current.lockBeep > 280) { fx.current.lockBeep = performance.now(); playLockBeep(); }
      }
      const mapChanged = !!s.map && s.map !== mapRef.current.id;
      if (mapChanged) {
        mapRef.current = mapById(s.map);
        banner.current = { text: mapRef.current.name.toUpperCase(), sub: 'New map · scores reset', at: performance.now() };
      }
      {
        const ph = s.phase ?? 'play';
        if (ph === 'sudden' && phaseRef.current === 'play') banner.current = { text: 'SUDDEN DEATH — NO RESPAWNS', sub: `${s.alive ?? 0} alive · last one standing wins`, at: performance.now() };
        phaseRef.current = ph;
        const mu = { phase: ph, alive: s.alive ?? 0, sd: Math.ceil((s.sd ?? 0) / 1000), end: s.end ?? null };
        setMatchUi((o) => (o.phase === mu.phase && o.alive === mu.alive && o.sd === mu.sd && (o.end?.matchId ?? '') === (mu.end?.matchId ?? '') ? o : mu));
      }
      if (s.map) {
        const info = { map: s.map, next: s.next ?? '', picked: !!s.picked, secs: Math.ceil((s.left ?? 0) / 1000) };
        setMapInfo((o) => (o.map === info.map && o.next === info.next && o.picked === info.picked && o.secs === info.secs ? o : info));
      }
      if (mine && (window as unknown as { __arenaKCDead?: boolean }).__arenaKCDead) { mine.alive = false; mine.rs = 7000; }
      if (mine && mapChanged) Object.assign(m, { x: mine.x, y: mine.y, z: mine.z, vz: 0, grounded: true, p: 0 });
      if (mine) {
        // Died: free the mouse so the loadout picker / Respawn button can be clicked.
        if (!mine.alive && m.alive) { m.alive = false; if (performance.now() - deathAtRef.current > 2000) deathAtRef.current = performance.now(); releaseOnDeath(); }
        if (mine.alive && !m.alive) { Object.assign(m, { alive: true, x: mine.x, y: mine.y, z: mine.z, vz: 0, grounded: true, p: 0, ammo: WEAPONS[m.weapon].mag, reloadUntil: 0 }); syncOnRespawn(); }
        // The server owns position (and height): if prediction drifts too far, snap to its authoritative spot.
        else if (mine.alive && Math.abs(m.z - mine.z) > 0.8) { Object.assign(m, { x: mine.x, y: mine.y, z: mine.z, vz: 0, grounded: mine.g }); net.corr = null; net.hist.clear(); }
        else if (mine.alive && mine.q !== undefined) {
          // Compare the server's result for our last acked move with where we were when we sent it (not "now" vs a
          // stale snapshot): tiny errors are ignored, small ones blend in over ~150 ms, only big ones snap.
          const r = reconcileMove(net.hist, mine, m);
          if (r.kind === 'snap') { Object.assign(m, { x: m.x + r.dx, y: m.y + r.dy }); net.corr = null; }
          else if (r.kind === 'blend') net.corr = { x: r.dx, y: r.dy, left: 0.15 };
        }
        else if (mine.alive && Math.hypot(m.x - mine.x, m.y - mine.y) > 1.5) { Object.assign(m, { x: mine.x, y: mine.y, z: mine.z, vz: 0, grounded: mine.g }); net.corr = null; }
        else if (mine.alive && Math.hypot(m.x - mine.x, m.y - mine.y) > 0.6) net.corr = { x: mine.x - m.x, y: mine.y - m.y, left: 0.15 };
        m.hp = mine.hp;
        m.streak = mine.st;
        lifeLoRef.current = mine.lo ?? null;
        extraRef.current = mine.ex ?? [];
        const nl = { alive: mine.alive, stake: mine.stk ?? 0, broke: !!mine.bk, lo: mine.lo ?? 'pistol', paid: false, rs: mine.alive ? 0 : Math.ceil((mine.rs ?? 0) / 1000) };
        setLife((o) => (o.alive === nl.alive && o.stake === nl.stake && o.broke === nl.broke && o.lo === nl.lo && o.paid === nl.paid && o.rs === nl.rs ? o : nl));
        m.uavUntil = mine.uav ? performance.now() + mine.uav : 0;
        // The server owns the loadout: if our weapon disagrees for longer than a switch takes, adopt the server's.
        if (mine.w !== m.weapon && performance.now() - m.switchedAt > 1000) { m.weapon = mine.w; m.scoped = false; }
        if (mine.w === m.weapon && adoptServerAmmo(performance.now(), m.localActAt, net.ping)) {
          m.ammo = mine.ammo;
          if (typeof mine.gn === 'number') fx.current.nadesLeft = mine.gn;
          m.reloadUntil = mine.rl ? performance.now() + mine.rl : 0;
        }
      }
      setBoard([...s.players, ...((s.roster ?? []) as NetPlayer[])].sort((a, b) => b.k - a.k || a.d - b.d));
    };
    const onHit = (h: { by: string | null; target: string; cause: string }) => {
      const now = performance.now();
      fx.current.hitAt.set(h.target, now);
      if (h.by === me.current.id && h.target !== me.current.id) {
        // Already shown by the prediction? Don't double up; otherwise (spread luck, splash) show it now.
        if (now - fx.current.hitmark > 600 || fx.current.hitDeny) { fx.current.hitmark = now; fx.current.hitDeny = 0; playHit(); }
      }
      else if (h.target === me.current.id) {
        fx.current.hurt = now;
        playHit(true);
        const src = snaps.current[snaps.current.length - 1]?.players.find((p) => p.id === h.by);
        if (src && h.by !== me.current.id) fx.current.dmgDirs.push({ a: Math.atan2(src.y - me.current.y, src.x - me.current.x), at: now });
      }
    };
    const onShot = (s: { id: string; w: WeaponId; melee?: 'slash' | 'stab'; hit?: number; o?: [number, number, number]; rays?: Array<[number, number, number, number?]>; sid?: number; impact?: { x: number; y: number; z: number }; rocket?: { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number } }) => {
      const now = performance.now();
      if (s.melee) {
        if (s.id === me.current.id) playKnife(s.hit ? 'hit' : 'miss');
        else { fx.current.meleeAt.set(s.id, { at: now, heavy: s.melee === 'stab' }); playKnife(s.hit ? 'hit' : 'swing', 0.35); }
        return;
      }
      if (s.id !== me.current.id) { playWeaponShot(s.w, 0.35 * shotFalloff(s.o ? Math.hypot(s.o[0] - me.current.x, s.o[1] - me.current.y) : 0)); fx.current.shotAt.set(s.id, now); }
      if (s.id === me.current.id && pred.has(s.sid)) {
        // Our own predicted shot: tracers already drawn; only settle the verdict.
        const v = pred.resolve(s.sid, !!s.rays?.some((r) => r[3]));
        if (v === 'deny') denyPrediction(now);
      } else if (s.o && s.rays) pushRays(s.w, s.o, s.rays, now);
      if (s.impact) { fx.current.booms.push({ ...s.impact, at: now, big: false }); playArenaExplosion(Math.hypot(s.impact.x - me.current.x, s.impact.y - me.current.y) + 4); }
      if (s.rocket) fx.current.rockets.set(s.rocket.id, { ...s.rocket, at: now });
    };
    const onKill = (k: { killer: string; victim: string; killerId: string | null; victimId: string; cause: string; headshot?: boolean; noscope?: boolean }) => {
      const self = k.killerId === k.victimId || !k.killerId;
      if (k.victimId === me.current.id) { releaseOnDeath(); deathAtRef.current = performance.now(); kcRef.current = null; setKillCam(null); }
      if (k.killerId === me.current.id && !self) { fx.current.killmark = performance.now(); if (k.headshot) fx.current.headmark = performance.now(); }
      const v = snaps.current[snaps.current.length - 1]?.players.find((p) => p.id === k.victimId);
      if (v) {
        // Fall away from the killer (or backwards when we can't tell).
        const by = snaps.current[snaps.current.length - 1]?.players.find((p) => p.id === k.killerId);
        const fall = by && by.id !== v.id ? Math.atan2(v.y - by.y, v.x - by.x) - v.a : Math.PI;
        fx.current.deaths.set(k.victimId, { at: performance.now(), x: v.x, y: v.y, z: v.z, a: v.a, name: v.name, fall });
      }
      pushFeed({ killer: k.killer, victim: k.victim, cause: k.cause, self, mine: k.killerId === me.current.id || k.victimId === me.current.id, head: !!k.headshot && !self, noscope: !!k.noscope && !self });
    };
    let popKey = 0;
    // Everyone gets the feed line; only the killer gets the pop-up (fps_multi_me is sent to the killer's socket alone).
    const onMulti = (x: { id: string; name: string; title: string }) => {
      pushFeed({ killer: x.name, victim: '', cause: '', self: false, mine: x.id === me.current.id, multi: x.title });
    };
    const onMultiMe = (x: { title: string; level: number; sound: string }) => {
      const key = ++popKey;
      setMultiPop({ key, title: x.title, level: x.level });
      window.setTimeout(() => setMultiPop((p) => (p?.key === key ? null : p)), POPUP_MS);
      playMultiKill(x.sound);
    };
    const onStreak = (s: { id: string; name: string; kind: string; title: string; streak: number }) => {
      const info = STREAKS.find((x) => x.kind === s.kind);
      const mine = s.id === me.current.id;
      const radio: Record<string, string> = { uav: mine ? 'UAV online.' : 'Enemy UAV spotted.', airstrike: mine ? 'Airstrike inbound. Danger close.' : 'Enemy airstrike inbound!', drone: mine ? 'Attack drone on station.' : 'Enemy drone overhead!', nuke: mine ? 'Tactical nuke inbound.' : 'TACTICAL NUKE INCOMING!' };
      banner.current = { text: mine ? s.title : `${s.name.toUpperCase()} · ${s.title}`, sub: `"${radio[s.kind] ?? ''}" · ${s.streak} kill streak${mine && info ? ` · ${info.blurb}` : ''}`, at: performance.now() };
      playStreakCall(s.kind === 'nuke' ? 'alarm' : 'reward');
    };
    const onBoom = (b: { x: number; y: number; z?: number; cause?: string; rocket?: number; nade?: number }) => {
      const t = performance.now();
      fx.current.booms.push({ x: b.x, y: b.y, z: b.z ?? 0, at: t, big: true });
      fx.current.blasts.push({ x: b.x, y: b.y, z: b.z ?? 0, big: b.cause !== 'rocket' });
      if (b.rocket !== undefined) fx.current.rockets.delete(b.rocket);
      if (b.nade !== undefined) fx.current.nades.delete(b.nade);
      const d = Math.hypot(b.x - me.current.x, b.y - me.current.y);
      if (d < 8) fx.current.shake = t;
      if (b.cause === 'airstrike' && t - fx.current.jetAt > 1500) fx.current.jetAt = t;
      // Rockets use Dayne's chess explosion recording; airstrikes keep the long synth rumble.
      playArenaExplosion(d, b.cause === 'rocket' || b.cause === 'grenade' ? 'rocket' : 'synth'); // frags share the explosion bus (-21 dBFS ceiling, Explosions slider)
    };
    const onNuke = (n: { phase: string; by: string }) => {
      if (n.phase === 'boom') {
        fx.current.nukeFlash = performance.now();
        playArenaExplosion(0, 'synth', true);
        banner.current = { text: 'TACTICAL NUKE', sub: `"Detonation confirmed." · ${n.by} ended the round · scores reset`, at: performance.now() };
      }
    };
    socket.on('fps_state', onState);
    socket.on('fps_hit', onHit);
    socket.on('fps_shot', onShot);
    socket.on('fps_kill', onKill);
    socket.on('fps_streak', onStreak);
    socket.on('fps_multi', onMulti);
    socket.on('fps_multi_me', onMultiMe);
    const onPickup = (p: { w: WeaponId; name?: string }) => {
      if (!extraRef.current.includes(p.w)) extraRef.current = [...extraRef.current, p.w];
      playPickup();
      const key = performance.now();
      setPickToast({ key, text: `Picked up ${p.name ?? WEAPONS[p.w]?.name ?? p.w}` });
      setTimeout(() => setPickToast((o) => (o && o.key === key ? null : o)), 1800);
    };
    socket.on('fps_pickup', onPickup);
    const onNoScope = (x: { id: string }) => {
      play360NoScope();
      if (x.id === me.current.id) {
        const key = ++popKey;
        setMultiPop({ key, title: '360 NO-SCOPE!', level: 5 });
        window.setTimeout(() => setMultiPop((p) => (p?.key === key ? null : p)), 2500);
      }
    };
    socket.on('fps_noscope', onNoScope);
    socket.on('fps_boom', onBoom);
    const onDrone = () => playWeaponShot('smg', 0.3);
    socket.on('fps_drone_shot', onDrone);
    socket.on('fps_nuke', onNuke);
    socket.on('connect', join);
    if (socket.connected) join();
    else socket.connect();
    return () => {
      window.clearInterval(pingT);
      socket.emit('fps_leave');
      for (const [e, h] of [['fps_state', onState], ['fps_hit', onHit], ['fps_shot', onShot], ['fps_kill', onKill], ['fps_streak', onStreak], ['fps_multi', onMulti], ['fps_multi_me', onMultiMe], ['fps_pickup', onPickup], ['fps_noscope', onNoScope], ['fps_boom', onBoom], ['fps_drone_shot', onDrone], ['fps_nuke', onNuke], ['connect', join]] as const) socket.off(e, h as never);
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
    const prevPos = new Map<string, { x: number; y: number; t: number }>();
    const tags = new TagVisibility();
    let raf = 0;
    let last = performance.now();
    let lastSend = 0;
    const frameTimes: number[] = [];
    let fpsShownAt = 0;
    const frame = (now: number) => {
      frameTimes.push(now); if (frameTimes.length > 30) frameTimes.shift();
      if (fpsRef.current && now - fpsShownAt > 250) { fpsShownAt = now; fpsRef.current.textContent = `${fpsFrom(frameTimes)} FPS · ping ${net.ping} ms · interp ${INTERP_DELAY_MS} ms · buf ${Math.round(net.buf.bufferedMs(now))} ms`; }
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
        // Touch pads / turn keys use the touch sensitivity (and the scoped multiplier when zoomed).
        const lp = lookRef.current, tk = lp.touch * (m.scoped ? lp.scope / 0.31 : 1);
        if (lp.invertY && (t.lookUp || t.lookDown)) look = -look;
        m.a += turn * (m.scoped ? 0.8 : 2.6) * tk * dt;
        m.p = clampPitch(m.p + look * 1.6 * tk * dt) ?? m.p;
        const len = Math.hypot(fwd, side) || 1;
        // Crouch: hold Ctrl or C (or the touch toggle). Standing back up waits for headroom, same rule as the server.
        const wantCrouch = crouchHeld(k, touchCrouchRef.current);
        const wasCrouched = m.crouch;
        applyCrouch(m, wantCrouch, map);
        if (wantCrouch !== net.sentCrouch) { net.sentCrouch = wantCrouch; socket.emit('fps_crouch', { on: wantCrouch }); }
        if (wasCrouched !== m.crouch) lastSend = 0;
        // Sprint: hold Shift (or the touch toggle), forward / diagonal-forward only, never crouched, scoped or while firing.
        if (wantCrouch && touchSprintRef.current) { touchSprintRef.current = false; setTouchSprint(false); }
        const firing = m.firing || k.has('f');
        const wantSprint = (k.has('shift') || touchSprintRef.current) && fwd > 0 && !firing
          && canSprint(m, Math.cos(m.a) * fwd - Math.sin(m.a) * side, Math.sin(m.a) * fwd + Math.cos(m.a) * side, m.scoped);
        if (m.sprint && !wantSprint) m.sprintEndAt = now;
        if (m.sprint !== wantSprint) lastSend = 0;
        m.sprint = wantSprint;
        const sp = (speedOf(m) * 0.95 * dt) / len; // speedOf includes the ADS/scope slowdown
        // a turns from +x toward +y; "right" is +90°.
        const dx = (Math.cos(m.a) * fwd - Math.sin(m.a) * side) * sp;
        const dy = (Math.sin(m.a) * fwd + Math.cos(m.a) * side) * sp;
        // Local prediction with the exact same physics the server runs.
        // Fixed-timestep simulation (120 Hz) decoupled from the render rate; rendered position is interpolated below.
        net.acc = Math.min(0.1, net.acc + dt);
        const steps = Math.floor(net.acc / LOCAL_STEP_S);
        for (let i = 0; i < steps; i++) {
          net.prev = { x: m.x, y: m.y, z: m.z };
          moveHorizontal(m, dt > 0 ? (dx / dt) * LOCAL_STEP_S : 0, dt > 0 ? (dy / dt) * LOCAL_STEP_S : 0, map);
          stepVertical(m, LOCAL_STEP_S, map);
          if (net.corr && net.corr.left > 0) {
            const f = Math.min(1, LOCAL_STEP_S / net.corr.left);
            moveHorizontal(m, net.corr.x * f, net.corr.y * f, map);
            net.corr = { x: net.corr.x * (1 - f), y: net.corr.y * (1 - f), left: net.corr.left - LOCAL_STEP_S };
          }
        }
        net.acc -= steps * LOCAL_STEP_S;
        moving = fwd !== 0 || side !== 0;
        if (now - lastSend > 50) { lastSend = now; net.seq += 1; net.hist.push(net.seq, m.x, m.y); socket.emit('fps_move', { x: m.x, y: m.y, a: m.a, p: m.p, c: wantCrouch, s: m.sprint, q: net.seq }); }
        if ((m.firing || k.has('f')) && (!WEAPONS[m.weapon].semi || m.semiPending)) shoot(); // semi-auto: one shot per pull
      }
      if (m.reloadUntil && now >= m.reloadUntil) { m.reloadUntil = 0; m.ammo = WEAPONS[m.weapon].mag; }
      if (moving && m.grounded) m.walk += dt * 9 * (m.sprint ? 1.6 : 1);
      m.fovKick = stepFovKick(m.fovKick, m.sprint && moving && m.alive, dt);
      const bob = moving && m.grounded ? Math.sin(m.walk * 2) * (m.sprint ? 0.045 : 0.03) : 0;
      { const target = m.alive ? eyeHeightOf(m) : EYE_HEIGHT; const st = CROUCH_LERP_SPEED * dt; m.eyeH += Math.max(-st, Math.min(st, target - m.eyeH)); }
      const ads = m.scoped && m.alive && m.weapon !== 'sniper' ? WEAPONS[m.weapon].adsZoom ?? 0 : 0;
      const { zoom, showGun } = viewZoom(m.scoped && m.weapon === 'sniper' && m.alive ? SCOPE_ZOOM : ads || 1, m.fovKick, ads > 0);
      const snap = snaps.current[snaps.current.length - 1];
      const sampled = samplePlayers(net.buf.snaps, net.buf.renderTime(now));
      const others = sampled.players.filter((p) => p.id !== m.id && p.alive);
      // Render-time interpolation of our own fixed-step position.
      const al = net.prev && m.alive ? net.acc / LOCAL_STEP_S : 1;
      const eye = net.prev && Math.hypot(net.prev.x - m.x, net.prev.y - m.y) < 1 ? { x: net.prev.x + (m.x - net.prev.x) * al, y: net.prev.y + (m.y - net.prev.y) * al, z: net.prev.z + (m.z - net.prev.z) * al } : { x: m.x, y: m.y, z: m.z };
      // Spectator cam: eliminated in sudden death (or on the end screen) -> ride along with someone still alive.
      let specCam: { x: number; y: number; z: number; a: number; p: number } | null = null;
      if (!kcRef.current && !m.alive && phaseRef.current !== 'play') {
        const alive = sampled.players.filter((p) => p.alive && p.id !== m.id);
        const t = alive.find((p) => p.id === specRef.current) ?? alive[0];
        if (t) { specRef.current = t.id; specCam = { x: t.x, y: t.y, z: t.z, a: t.a, p: t.p }; }
      }
      // Kill cam playback: the killer's eyes (real yaw / pitch / crouch, scope zoom, viewmodel), the victim from the track;
      // shots replay with flash, tracers, sound and hit marker; then a short hold on the victim going down. Stops on respawn.
      let kcVictim: Soldier3D | null = null;
      let kcView: { zoom: number; vm: Viewmodel3D | null; scoped: boolean; w: WeaponId; slow: boolean; hold: number } | null = null;
      if (kcRef.current && (m.alive || phaseRef.current !== 'play')) { kcRef.current = null; setKillCam(null); }
      if (kcRef.current) {
        const kc = kcRef.current;
        const smp = sampleKillCam(kc.track, kc.card.killerId!, kc.card.victimId, now - kc.start, kc.speed);
        if (smp.done || !smp.killer) { kcRef.current = null; setKillCam((o) => (o ? { ...o, playing: false } : o)); }
        else {
          const k = smp.killer;
          const kw = (isWeapon(k[7]) ? k[7] : 'pistol') as WeaponId;
          for (const s of shotsBetween(kc.track, kc.shots, kc.ct, smp.t)) {
            kc.fireAt = now;
            playWeaponShot(isWeapon(s.w) ? s.w : kw, 0.5);
            if (s.hit) { kc.hitAt = now; playHit(); }
            const [ox, oy, oz] = s.o;
            for (const [ra, rp, d, hit] of s.rays) {
              const c = Math.cos(rp);
              const start: [number, number, number] = [ox + Math.cos(ra) * c * 0.6, oy + Math.sin(ra) * c * 0.6, oz + 1.25];
              const e: [number, number, number] = [ox + Math.cos(ra) * c * d, oy + Math.sin(ra) * c * d, oz + EYE_HEIGHT + Math.sin(rp) * d];
              fx.current.tracers.push({ o: start, e, at: now, sniper: s.w === 'sniper' });
              if (isWeapon(s.w) && d < WEAPONS[s.w].range - 0.05) fx.current.impacts.push({ x: e[0], y: e[1], z: e[2], player: !!hit, at: now + (d / TRACER_SPEED) * 1000 });
            }
          }
          // Old tracks (no shot list): fall back to the per-sample fired flag.
          if (!kc.shots && k[6] && now - kc.fireAt > 60) { kc.fireAt = now; playWeaponShot(kw, 0.5); }
          kc.ct = smp.t;
          const crouchDrop = k[5] ? EYE_HEIGHT - eyeHeightOf({ crouch: true } as never) : 0;
          specCam = { x: k[0], y: k[1], z: k[2] - crouchDrop, a: k[3], p: k[4] };
          const scoped = kw === 'sniper' && !!k[8];
          const vz = viewZoom(scoped ? SCOPE_ZOOM : 1, 0);
          const sinceFire = now - kc.fireAt;
          kc.walk += dt * 6;
          kcView = {
            zoom: vz.zoom, scoped, w: kw, slow: smp.slow, hold: smp.hold,
            vm: vz.showGun ? { swing: -1, heavy: false, w: kw, kick: Math.max(0, 1 - sinceFire / 140), lower: 0, reload: -1, bob: kc.walk, muzzle: sinceFire < 50, sk: null } : null,
          };
          const v = smp.victim;
          if (v) {
            const vw = (isWeapon(v[7]) ? v[7] : 'pistol') as WeaponId;
            const sinceHit = now - kc.hitAt;
            const dead = smp.hold >= 0 ? smp.hold / 1000 : undefined;
            kcVictim = { id: kc.card.victimId, x: v[0], y: v[1], z: v[2], a: v[3], p: v[4], color: colorFor(kc.card.victimId), flash: sinceHit < 120, flinch: sinceHit < 260 ? 1 - sinceHit / 260 : 0, moving: dead === undefined, t: now, w: vw, crouch: !!v[5], fire: !!v[6], ...(dead !== undefined ? { dead, fall: Math.atan2(v[1] - k[1], v[0] - k[0]) - v[3] } : {}) };
          }
        }
      }
      const soldiers: Soldier3D[] = kcRef.current ? (kcVictim ? [kcVictim] : []) : others.filter((p) => !specCam || p.id !== specRef.current).map((p) => {
        const pp = prevPos.get(p.id);
        const mv = !!pp && Math.hypot(pp.x - p.x, pp.y - p.y) > 0.002;
        const sp = pp ? Math.hypot(pp.x - p.x, pp.y - p.y) / Math.max(1e-3, (now - pp.t) / 1000) : 0;
        prevPos.set(p.id, { x: p.x, y: p.y, t: now });
        const wa = fx.current.weaponAt.get(p.id);
        if (!wa || wa.w !== p.w) fx.current.weaponAt.set(p.id, { w: p.w, at: wa ? now : -1e9 });
        const sinceSw = now - (fx.current.weaponAt.get(p.id)?.at ?? -1e9);
        const sinceShot = now - (fx.current.shotAt.get(p.id) ?? -1e9);
        const sinceHit = now - (fx.current.hitAt.get(p.id) ?? -1e9);
        return {
          id: p.id, x: p.x, y: p.y, z: p.z, a: p.a, p: p.p, color: colorFor(p.id), flash: sinceHit < 120, moving: mv, t: now, w: p.w, sk: p.sk ?? null, fire: sinceShot < 60,
          air: !p.g, crouch: !!p.c, sprint: !!p.s, speed: Math.min(8, sp), recoil: sinceShot < 160 ? 1 - sinceShot / 160 : 0, ...meleePose(fx.current.meleeAt.get(p.id), now), flinch: sinceHit < 260 ? 1 - sinceHit / 260 : 0,
          sw: sinceSw < SWITCH_MS ? 1 - Math.abs(sinceSw / SWITCH_MS - 0.5) * 2 : 0,
          reload: p.rl > 0 ? Math.max(0, Math.min(1, 1 - p.rl / WEAPONS[p.w].reloadMs)) : undefined,
        };
      });
      for (const [id, dd] of fx.current.deaths) {
        const age = (now - dd.at) / 1000;
        if (age > 2) { fx.current.deaths.delete(id); continue; }
        if (id === m.id || others.some((o) => o.id === id)) continue;
        soldiers.push({ id, x: dd.x, y: dd.y, z: dd.z, a: dd.a, p: 0, color: colorFor(id), flash: false, moving: false, dead: age, t: now, fall: dd.fall, w: snap?.players.find((q) => q.id === id)?.w });
      }
      fx.current.booms = fx.current.booms.filter((b) => now - b.at < 600);
      fx.current.tracers = fx.current.tracers.filter((tr) => now - tr.at < 700);
      // Drain queued effects into the renderer.
      g3.calm = prefersReducedMotion();
      fx.current.impacts = fx.current.impacts.filter((h) => {
        if (h.at > now) return true;
        const nv = surfaceNormal(h, map);
        g3!.impact(h.x, h.y, h.z, [nv.x, nv.y, nv.z], h.player, materialAt(map, h.x, h.y, h.z));
        return false;
      });
      for (const b of fx.current.blasts.splice(0)) g3.explode(b.x, b.y, b.z, b.big);
      for (; fx.current.shells > 0; fx.current.shells--) g3.ejectShell(m.weapon);
      // Rockets: the server snapshot is the truth; extrapolate it (and brand-new launches) to now.
      const rockets = new Map<number, { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; at: number; seek?: number }>();
      for (const r of fx.current.rockets.values()) if (now - r.at < ROCKET_LIFE_MS) rockets.set(r.id, r);
      if (snap) for (const r of snap.rockets ?? []) rockets.set(r.id, { ...r, at: snap.recv });
      fx.current.rockets = new Map([...rockets].filter(([id, r]) => now - r.at < ROCKET_LIFE_MS && (!snap || (snap.rockets ?? []).some((q) => q.id === id) || snap.recv < r.at)));
      // Frags: simulate locally with the shared physics; the thrower's own frag is predicted instantly (negative id)
      // and handed over to the server's once it shows up in a snapshot.
      if (snap) for (const n of snap.nades ?? []) {
        if (fx.current.nades.has(n.id)) continue;
        if (n.ownerId === m.id) for (const id of [...fx.current.nades.keys()]) if (id < 0) { fx.current.nades.delete(id); break; }
        fx.current.nades.set(n.id, { ...n, born: snap.recv - (GRENADE_FUSE_MS - n.left), at: snap.recv });
      }
      for (const [id, g] of fx.current.nades) if (stepGrenade(g, now, mapRef.current) || now - g.born > GRENADE_FUSE_MS + 400) fx.current.nades.delete(id);
      const fx3: Fx3D = {
        nades: [...fx.current.nades.values()].map((g) => ({ id: g.id, x: g.x, y: g.y, z: g.z })),
        drones: (snap?.drones ?? []).map((d) => ({ x: d.x, y: d.y, z: (d.z ?? 8) + Math.sin(now / 200) * 0.1 })),
        strikes: (snap?.strikes ?? []).filter((q) => q.inMs >= 0).map((q) => ({ x: q.x, y: q.y, z: q.z ?? 0, r: q.r ?? AIRSTRIKE_RADIUS })),
        booms: fx.current.booms.map((b) => ({ x: b.x, y: b.y, z: b.z, t: (now - b.at) / 600, big: b.big })),
        tracers: fx.current.tracers.map((tr) => ({ o: tr.o, e: tr.e, t: (now - tr.at) / 1000, sniper: tr.sniper })),
        rockets: [...fx.current.rockets.values()].map((r) => {
          const t = Math.min(0.25, (now - r.at) / 1000);
          return { seek: !!r.seek, id: r.id, x: r.x + r.vx * t, y: r.y + r.vy * t, z: r.z + r.vz * t - 0.5 * ROCKET_GRAVITY * t * t, vx: r.vx, vy: r.vy, vz: r.vz - ROCKET_GRAVITY * t };
        }),
        drops: (snap?.drops ?? []).map((d) => ({ ...d, left: d.left - (now - snap!.recv) })).filter((d) => d.left > 0),
      };
      const shake = now - fx.current.shake < 450 ? (1 - (now - fx.current.shake) / 450) * 0.04 : 0;
      const vmSwitch = Math.max(0, 1 - (now - m.switchedAt) / SWITCH_MS);
      const vmReload = m.reloadUntil && now < m.reloadUntil ? 1 - (m.reloadUntil - now) / WEAPONS[m.weapon].reloadMs : -1;
      const swingT = (now - fx.current.melee.at) / (fx.current.melee.heavy ? 420 : 220);
      const vm = showGun && m.alive && m.joined ? { ads: ads > 0, swing: m.weapon === 'knife' && swingT < 1 ? swingT : -1, heavy: fx.current.melee.heavy, w: m.weapon, kick: Math.max(0, 1 - (now - fx.current.muzzle) / 140), lower: vmSwitch, reload: vmReload, bob: m.walk, muzzle: now - fx.current.muzzle < 50, sk: snap?.mysk?.[m.weapon] ?? (() => { const me = snap?.players.find((q) => q.id === m.id); return me && me.w === m.weapon ? me.sk ?? null : null; })() } : null;
      const qa = (window as unknown as { __arenaQA?: { vm?: unknown } }).__arenaQA; if (qa) qa.vm = vm;
      g3.render(specCam ? { x: specCam.x, y: specCam.y, z: specCam.z + EYE_HEIGHT, a: specCam.a, p: specCam.p, zoom: kcView?.zoom ?? 1, vm: kcView?.vm ?? null } : { x: eye.x, y: eye.y, z: eye.z + m.eyeH + bob + (Math.random() - 0.5) * shake, a: m.a, p: m.p, zoom, vm }, soldiers, fx3);
      // Health bars over nearby enemies you can see.
      // The 2D overlay always draws on top of the 3D scene, so gate each bar on line of sight (throttled, faded).
      tags.prune(new Set(others.map((o) => o.id)));
      const camEye = { x: eye.x, y: eye.y, z: eye.z + m.eyeH };
      for (const p of others) {
        const s = g3.project(p.x, p.y, p.z + 2, W, H);
        if (!s || s.dist > 18) continue;
        const alpha = tags.alpha(p.id, now, () => tagVisible(camEye, p, map));
        if (alpha <= 0) continue;
        ctx.globalAlpha = alpha;
        const bw = Math.max(16, 40 / Math.max(1, s.dist / 3)) * (H / 400);
        ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(s.sx - bw / 2, s.sy, bw, 3);
        ctx.fillStyle = p.hp > 40 ? '#cfd4c4' : '#d9473a'; ctx.fillRect(s.sx - bw / 2, s.sy, (bw * p.hp) / MAX_HP, 3);
        ctx.globalAlpha = 1;
      }
      // Owner-granted wallhack (the server only sends hidden enemies to that account): outlines + health through walls.
      if (snap?.wh) for (const p of others) {
        const top = g3.project(p.x, p.y, p.z + 1.85, W, H), foot = g3.project(p.x, p.y, p.z, W, H);
        if (!top || !foot) continue;
        const hgt = Math.max(6, foot.sy - top.sy), wid = hgt * 0.42;
        ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 1.5; ctx.strokeRect(top.sx - wid / 2, top.sy, wid, hgt);
        ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(top.sx - wid / 2, top.sy - 5, wid, 3);
        ctx.fillStyle = p.hp > 40 ? '#5fe36b' : '#d9473a'; ctx.fillRect(top.sx - wid / 2, top.sy - 5, (wid * p.hp) / MAX_HP, 3);
      }
      const W2 = r.W, H2 = r.H;
      if (now - fx.current.lockAt < 400 && Math.floor(now / 200) % 2 === 0) {
        ctx.fillStyle = '#ff2b2b'; ctx.font = `800 ${Math.round(H2 / 22)}px ui-monospace, Menlo, monospace`; ctx.textAlign = 'center';
        ctx.fillText('⚠ MISSILE LOCK', W2 / 2, H2 * 0.3); ctx.textAlign = 'left';
      }
      // Dust haze over the scene for a darker, grittier grade.
      const vg = ctx.createRadialGradient(W2 / 2, H2 / 2, H2 * 0.3, W2 / 2, H2 / 2, W2 * 0.7);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W2, H2);
      // Viewmodel + scope
      const reloading = m.reloadUntil && now < m.reloadUntil ? 0.6 : 0;
      if (kcView ? kcView.zoom > 1 : zoom > 1 && !ads) {
        const g = ctx.createRadialGradient(W2 / 2, H2 / 2, H2 * 0.36, W2 / 2, H2 / 2, H2 * 0.4);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W2, H2);
        ctx.strokeStyle = '#000'; ctx.lineWidth = Math.max(1, H2 / 300);
        ctx.beginPath(); ctx.moveTo(0, H2 / 2); ctx.lineTo(W2, H2 / 2); ctx.moveTo(W2 / 2, 0); ctx.lineTo(W2 / 2, H2); ctx.stroke();
      } else if (m.alive && ads) {
        // AR-15 red-dot sight while aiming down sights.
        ctx.fillStyle = 'rgba(255,40,40,.95)'; ctx.shadowColor = 'rgba(255,0,0,.9)'; ctx.shadowBlur = H2 / 120;
        ctx.beginPath(); ctx.arc(W2 / 2, H2 / 2, Math.max(1.5, H2 / 260), 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      } else if (m.alive) {
        const cs = H2 / 40;
        const spread = (weaponSpread(WEAPONS[m.weapon], { scoped: m.scoped, crouch: m.crouch, speed: m.sprint ? 0 : Math.hypot(m.x - (net.prev?.x ?? m.x), m.y - (net.prev?.y ?? m.y)) * 120, sprinting: m.sprint }) * (H2 / 2)) / Math.tan(((FOV / zoom) * Math.PI) / 360) * 0.6;
        ctx.strokeStyle = 'rgba(235,240,230,.9)';
        ctx.lineWidth = Math.max(1, H2 / 300);
        ctx.beginPath();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(W2 / 2 + dx * (spread + cs * 0.4), H2 / 2 + dy * (spread + cs * 0.4)); ctx.lineTo(W2 / 2 + dx * (spread + cs), H2 / 2 + dy * (spread + cs)); }
        ctx.stroke();
      }
      if (kcView) {
        // Kill cam HUD: the killer's crosshair + hit marker, letterbox, label, card; none of the live / death HUD.
        const cs = H2 / 40;
        const kc = kcRef.current;
        if (!kcView.scoped && kcView.vm) {
          ctx.strokeStyle = 'rgba(235,240,230,.85)'; ctx.lineWidth = Math.max(1, H2 / 300);
          ctx.beginPath();
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(W2 / 2 + dx * cs * 0.4, H2 / 2 + dy * cs * 0.4); ctx.lineTo(W2 / 2 + dx * cs, H2 / 2 + dy * cs); }
          ctx.stroke();
        }
        const hm = kc ? now - kc.hitAt : 1e9;
        const fatal = kcView.hold >= 0;
        if (hm < 260 || (fatal && kcView.hold < 500)) {
          const head = fatal && !!kc?.card.head;
          ctx.strokeStyle = head ? 'rgba(255,200,60,.98)' : fatal ? 'rgba(230,60,50,.95)' : `rgba(255,255,255,${(1 - hm / 260).toFixed(2)})`;
          ctx.lineWidth = Math.max(1.5, H2 / 180);
          const a0 = cs * 0.35, a1 = cs * 0.85;
          ctx.beginPath();
          for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { ctx.moveTo(W2 / 2 + dx * a0, H2 / 2 + dy * a0); ctx.lineTo(W2 / 2 + dx * a1, H2 / 2 + dy * a1); }
          ctx.stroke();
        }
        const bar = Math.round(H2 * 0.09);
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W2, bar); ctx.fillRect(0, H2 - bar, W2, bar);
        const lu = Math.max(1, Math.min(H2 / 400, W2 / 600));
        ctx.textBaseline = 'middle';
        ctx.font = `900 ${Math.round(14 * lu)}px ui-monospace, Menlo, monospace`; ctx.textAlign = 'left';
        ctx.fillStyle = Math.floor(now / 500) % 2 ? '#ff4b3a' : '#c8302a'; ctx.beginPath(); ctx.arc(18 * lu, bar / 2, 5 * lu, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#f2f2ea'; ctx.fillText('KILL CAM', 30 * lu, bar / 2);
        if (kcView.slow) { ctx.textAlign = 'left'; ctx.fillStyle = '#ffb4a8'; ctx.font = `800 ${Math.round(11 * lu)}px ui-monospace, Menlo, monospace`; ctx.fillText('SLOW-MO', 118 * lu, bar / 2); }
        if (kc) {
          ctx.textAlign = 'center'; ctx.fillStyle = '#f2f2ea'; ctx.font = `800 ${Math.round(13 * lu)}px ui-monospace, Menlo, monospace`;
          ctx.fillText(killCardText(kc.card, (w) => (isWeapon(w) ? WEAPONS[w].name : w)), W2 / 2, H2 - bar / 2 - 7 * lu);
          ctx.font = `600 ${Math.round(10 * lu)}px ui-monospace, Menlo, monospace`; ctx.fillStyle = '#a9ae9e';
          ctx.fillText('SPACE  RESPAWN NOW', W2 / 2, H2 - bar / 2 + 9 * lu);
        }
        ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
        raf = requestAnimationFrame(frame);
        return;
      }
      // Hit marker (white, red on kill) drawn after the scope overlay so it also shows while scoped.
      if (m.alive) {
        const cs = H2 / 40;
        for (const sid of pred.expire(now)) { void sid; denyPrediction(now); }
        const hm = now - fx.current.hitmark;
        const denyK = fx.current.hitDeny ? Math.max(0, 1 - (now - fx.current.hitDeny) / 120) : 1;
        // Floating damage numbers (predicted; fade fast if the server denies).
        fx.current.dmgNums = fx.current.dmgNums.filter((d) => now - d.at < 700 && (!d.denied || now - d.denied < 120));
        for (const d of fx.current.dmgNums) {
          const t = (now - d.at) / 700, u = Math.max(1, H2 / 500);
          const k = (1 - t) * (d.denied ? Math.max(0, 1 - (now - d.denied) / 120) : 1);
          ctx.font = `700 ${Math.round((d.head ? 14 : 12) * u)}px ui-monospace, Menlo, monospace`; ctx.textAlign = 'center';
          ctx.fillStyle = d.head ? `rgba(255,200,60,${k.toFixed(2)})` : `rgba(255,255,255,${k.toFixed(2)})`;
          ctx.fillText(String(d.v), W2 / 2 + cs * 1.4, H2 / 2 - cs * (0.8 + t * 1.5));
        }
        ctx.textAlign = 'left';
        if (hm < 220 && denyK > 0) {
          const kill = now - fx.current.killmark < 300;
          const headK = kill && now - fx.current.headmark < 300;
          ctx.strokeStyle = headK ? 'rgba(255,200,60,.98)' : kill ? 'rgba(230,60,50,.95)' : `rgba(255,255,255,${((1 - hm / 220) * denyK).toFixed(2)})`;
          ctx.lineWidth = Math.max(1.5, H2 / 180);
          const a0 = cs * 0.35, a1 = cs * 0.85;
          ctx.beginPath();
          for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { ctx.moveTo(W2 / 2 + dx * a0, H2 / 2 + dy * a0); ctx.lineTo(W2 / 2 + dx * a1, H2 / 2 + dy * a1); }
          ctx.stroke();
          if (headK) {
            // HEADSHOT variant: gold marker plus a small label under the crosshair.
            const u = Math.max(1, H2 / 500);
            ctx.font = `700 ${Math.round(11 * u)}px ui-monospace, Menlo, monospace`; ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(255,200,60,.95)'; ctx.fillText('HEADSHOT', W2 / 2, H2 / 2 + cs * 1.6 + 6 * u);
          }
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
      // Dead / spectating: the live-play HUD (ammo box, streak pips, UAV countdown) is hidden.
      const liveHud = arenaLiveHud(m.joined, m.alive);
      ctx.textAlign = 'right';
      if (liveHud) {
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(W2 - 92 * u, H2 - 30 * u, 88 * u, 26 * u);
      ctx.fillStyle = '#e6e9df'; ctx.font = `700 ${(14 * u) | 0}px ${mono}`;
      ctx.fillText(WEAPONS[m.weapon].melee ? '∞' : reloading ? 'RELOAD' : `${m.ammo}`, W2 - 30 * u, H2 - 12 * u);
      ctx.font = `600 ${(7 * u) | 0}px ${mono}`; ctx.fillStyle = '#a9ae9e';
      if (!reloading && !spec.melee) ctx.fillText(`/${spec.mag}`, W2 - 8 * u, H2 - 12 * u);
      ctx.fillText(spec.name.toUpperCase(), W2 - 8 * u, H2 - 22 * u);
      // Frag count (G), just above the ammo box.
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(W2 - 34 * u, H2 - 60 * u, 30 * u, 26 * u);
      ctx.textAlign = 'center'; ctx.font = `700 ${(11 * u) | 0}px ${mono}`;
      ctx.fillStyle = fx.current.nadesLeft > 0 ? '#e6e9df' : 'rgba(255,255,255,.3)';
      ctx.fillText(`${fx.current.nadesLeft}`, W2 - 19 * u, H2 - 44 * u);
      ctx.font = `600 ${(6 * u) | 0}px ${mono}`; ctx.fillStyle = '#a9ae9e'; ctx.fillText('G·FRAG', W2 - 19 * u, H2 - 36 * u); ctx.textAlign = 'right';
      for (let i = 0; i < (spec.melee ? 0 : Math.min(spec.mag, 30)); i++) { ctx.fillStyle = i < m.ammo ? '#d9dccf' : 'rgba(255,255,255,.15)'; ctx.fillRect(W2 - 8 * u - (i + 1) * 2.6 * u, H2 - 8 * u, 1.6 * u, 3 * u); }
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(4 * u, H2 - 16 * u, 70 * u, 12 * u);
      ctx.fillStyle = m.hp > 40 ? '#cfd4c4' : '#d9473a'; ctx.fillRect(6 * u, H2 - 14 * u, (52 * u * m.hp) / MAX_HP, 8 * u);
      ctx.fillStyle = '#e6e9df'; ctx.font = `700 ${(7 * u) | 0}px ${mono}`; ctx.fillText(`${Math.max(0, Math.round(m.hp))}`, 60 * u, H2 - 7.5 * u);
      // Streak pips
      if (liveHud) {
      const next = STREAKS.find((s) => s.kills > m.streak);
      for (let i = 0; i < 11; i++) {
        const isReward = STREAKS.some((s) => s.kills === i + 1);
        ctx.fillStyle = i < m.streak ? '#e6e9df' : isReward ? 'rgba(230,200,120,.45)' : 'rgba(255,255,255,.18)';
        ctx.fillRect(6 * u + i * 6 * u, H2 - 22 * u, 4.5 * u, isReward ? 4 * u : 3 * u);
      }
      ctx.font = `600 ${(6 * u) | 0}px ${mono}`; ctx.fillStyle = '#a9ae9e';
      ctx.fillText(next ? `${next.name} IN ${next.kills - m.streak}` : 'ALL STREAKS EARNED', 6 * u, H2 - 25 * u);
      }
      ctx.font = `700 ${(7 * u) | 0}px ${mono}`;
      // Weapon slots
      ctx.textAlign = 'center';
      WEAPON_ORDER.forEach((w, i) => {
        // Bottom centre, between the health block (left) and the ammo block (right), so nothing at the top covers them.
        const x = W2 / 2 - 8 * u + (i - 2) * 18 * u;
        const y = H2 - 16 * u;
        if ((lifeLoRef.current !== null && !canHold(lifeLoRef.current, w) && !extraRef.current.includes(w))) ctx.globalAlpha = 0.25;
        ctx.fillStyle = w === m.weapon ? 'rgba(220,224,210,.9)' : 'rgba(0,0,0,.45)';
        ctx.fillRect(x - 8 * u, y, 16 * u, 10 * u);
        ctx.fillStyle = w === m.weapon ? '#15170f' : '#d9dccf';
        ctx.fillText(`${i + 1}`, x, y + 7.5 * u);
        ctx.globalAlpha = 1;
      });
      // Radar (UAV)
      const live = (snap?.strikes ?? []).filter((s) => s.inMs >= 0);
      r.minimap(ctx, map, m, m.uavUntil > now ? [...others, ...(snap?.radar ?? [])] : [], live);
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
      if (m.joined && !m.alive && kiaCanvasStrip(phaseRef.current)) {
        // During play the KIA text lives in the loadout box header (DOM), so the canvas strip is only for spectating.
        const cy = H2 / 2;
        ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, cy - 16 * u, W2, 32 * u);
        ctx.fillStyle = '#e6e9df';
        const kia = phaseRef.current === 'play' ? 'KILLED IN ACTION · PICK YOUR LOADOUT' : 'ELIMINATED · SPECTATING';
        if (fit(kia, '700', 12, W2 - 16) < 11) {
          // Very narrow: split onto two lines rather than clip.
          fit('KILLED IN ACTION', '700', 12, W2 - 16); ctx.fillText('KILLED IN ACTION', W2 / 2, cy - 2 * u);
          ctx.fillText('PICK YOUR LOADOUT', W2 / 2, cy + 11 * u);
        } else ctx.fillText(kia, W2 / 2, cy + 5 * u);
      }
      raf = requestAnimationFrame(frame);
    };
    return () => { cancelled = true; cancelAnimationFrame(raf); g3?.dispose(); };
  }, []);

  // Browser-shortcut guard (Ctrl+S/D/A/R/Q… with a game key) and a leave confirm during a live match.
  useEffect(() => {
    const active = () => document.pointerLockElement === canvasRef.current || !!wrapRef.current?.contains(document.activeElement);
    const onKeyGuard = (e: KeyboardEvent) => { if (shouldBlockShortcut(e, active())) e.preventDefault(); };
    const onLeave = (e: BeforeUnloadEvent) => { if (me.current.joined && phaseRef.current !== 'ended') { e.preventDefault(); e.returnValue = ''; } };
    const onFs = () => { setIsFs(!!document.fullscreenElement); if (!document.fullscreenElement) { try { (navigator as Navigator & { keyboard?: { unlock?: () => void } }).keyboard?.unlock?.(); } catch { /* ok */ } wrapRef.current?.focus({ preventScroll: true }); } };
    window.addEventListener('keydown', onKeyGuard, true);
    window.addEventListener('beforeunload', onLeave);
    document.addEventListener('fullscreenchange', onFs);
    return () => { window.removeEventListener('keydown', onKeyGuard, true); window.removeEventListener('beforeunload', onLeave); document.removeEventListener('fullscreenchange', onFs); };
  }, []);

  // Pointer-lock mouse look, mouse buttons (left fire, right scope) and wheel weapon switch.
  useEffect(() => {
    const canvas = canvasRef.current;
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      const [da, dp] = mouseLook(lookRef.current, me.current.scoped, e.movementX, e.movementY);
      me.current.a += da;
      me.current.p = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, me.current.p + dp));
    };
    const onUp = (e: MouseEvent) => { if (e.button === 0) me.current.firing = false; if (e.button === 2) setScope(false); };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); cycleWeapon(e.deltaY > 0 ? 1 : -1); };
    // Always resync to what the browser actually holds; never trust our own idea of "locked".
    const sync = () => {
      const on = isLockedTo(document.pointerLockElement, canvas);
      setLocked(on);
      // Locked to the canvas means the player is playing: keys must reach the panel's key handler.
      if (on) refocusArena();
      // Losing the lock / focus drops held keys we'll never see the keyup for (Shift would keep sprinting).
      if (!on) { me.current.firing = false; setScope(false); keys.current.delete('shift'); me.current.sprint = false; }
      if (!document.hasFocus() || document.hidden) keys.current.clear();
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

  const GAME_KEYS = ARENA_GAME_KEYS;
  /** Respawn button / Space: respawn now with the selected loadout, stop any kill cam, refocus + re-lock the mouse. */
  function respawnNow() {
    socket.emit('fps_respawn', { w: loadoutRef.current });
    kcRef.current = null; setKillCam(null);
    wrapRef.current?.focus({ preventScroll: true });
    const p = canvasRef.current?.requestPointerLock?.() as unknown as Promise<void> | undefined;
    p?.catch?.(() => { /* lock refused */ });
  }
  function onKey(e: React.KeyboardEvent, down: boolean) {
    // Shift turns 1–5 into !@#…; read the physical key so guns still switch mid-sprint.
    const key = arenaKey(e);
    if (down) {
      const hk = hotkeyFor(e.key, e.repeat);
      if (hk === 'release') { releaseLock(); setPickerOpen(false); return; }
      if (hk === 'picker') { e.preventDefault(); e.stopPropagation(); openPicker(); return; }
      if (hk === 'fps') { e.preventDefault(); e.stopPropagation(); setShowFps((v) => !v); return; }
    }
    if (key === 'escape' || key === 'm' || key === 'f3') return;
    if (down && key === ' ' && spaceRespawns({ repeat: e.repeat, alive: me.current.alive, phase: phaseRef.current, broke: life.broke, sinceDeathMs: performance.now() - deathAtRef.current, typing: isTypingTarget(e.target) })) { e.preventDefault(); e.stopPropagation(); respawnNow(); return; }
    if (down && key === 'k' && !e.repeat && !me.current.alive && phaseRef.current === 'play') { e.preventDefault(); e.stopPropagation(); watchKillCam(); return; }
    e.stopPropagation();
    if (!GAME_KEYS.has(key)) return;
    e.preventDefault();
    if (key === 'tab') { setShowBoard(down); return; }
    if (!down) { keys.current.delete(key); return; }
    if (e.repeat) return; // key-repeat: already held, nothing to do
    keys.current.add(key);
    if (key === ' ') jump();
    else if (key === 'r') reload();
    else if (key === 'g') throwNade();
    else if (/^[1-7]$/.test(key)) setWeapon(WEAPON_ORDER[Number(key) - 1]);
    else if (key === 'v') setWeapon('knife');
    else if (key === 'f') { me.current.semiPending = true; shoot(); }
  }

  function refocusArena() {
    const w = wrapRef.current;
    if (w && !w.contains(document.activeElement)) w.focus({ preventScroll: true });
  }
  /** Respawned: drop stale move history/corrections and put keyboard focus back on the game (the Respawn button that
   *  had focus just unmounted, which left WASD going nowhere until something refocused the panel). */
  function syncOnRespawn() {
    keys.current.clear(); net.hist.clear(); net.corr = null;
    const w = wrapRef.current;
    if (w && !w.contains(document.activeElement)) w.focus({ preventScroll: true });
  }
  function releaseOnDeath() { keys.current.clear(); if (document.pointerLockElement) document.exitPointerLock?.(); }

  function toggleFullscreen() {
    // Never let fullscreen break the game: every step is feature-detected and failures just leave you windowed.
    const el = wrapRef.current;
    const kb = (navigator as Navigator & { keyboard?: { lock?: (k: string[]) => Promise<void>; unlock?: () => void } }).keyboard;
    try {
      if (document.fullscreenElement) { try { kb?.unlock?.(); } catch { /* ok */ } void document.exitFullscreen?.()?.catch?.(() => {}); return; }
      if (!el?.requestFullscreen) return;
      // Called straight from the click (user gesture). Keyboard lock (Chromium only) only once we're fullscreen.
      el.requestFullscreen({ navigationUI: 'hide' }).then(() => {
        try { void kb?.lock?.(LOCK_KEYS)?.catch?.(() => {}); } catch { /* Firefox / Safari: no Keyboard Lock */ }
        el.focus({ preventScroll: true });
        // Re-take the mouse right away when the browser still counts the click; otherwise the next click on the canvas does.
        try { const p = canvasRef.current?.requestPointerLock?.() as unknown as Promise<void> | undefined; p?.catch?.(() => {}); } catch { /* click to play */ }
      }).catch(() => {});
    } catch { /* unsupported */ }
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
        <button type="button" className="fps-quality" data-testid="arena-look-btn" title="Look sensitivity" aria-expanded={lookOpen} onClick={() => setLookOpen((o) => !o)}>⚙ Sens</button>
        {win.moved && <button type="button" className="win-reset" aria-label="Reset window position" title="Reset position" onClick={win.reset}>⟲</button>}
        {wallet !== null && <span className="ml-auto text-xs font-semibold" title="Your chip wallet (shared by every game)" data-testid="arena-wallet">🪙 {wallet.toLocaleString()}</span>}
        <button type="button" className={`text-xs ${wallet === null ? 'ml-auto' : ''}`} title="Skins, cases and keys" onClick={() => window.dispatchEvent(new Event('open-inventory'))} data-testid="arena-inventory">🎒 Inventory</button>
        <button type="button" aria-label="Close arena" onClick={onClose}>✕</button>
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
      {lookOpen && (
        <div className="fps-look" data-testid="arena-look">
          <label>Mouse <input type="range" min={SENS_MIN} max={SENS_MAX} step={0.05} value={look.sens} data-testid="arena-sens" onChange={(e) => setLook({ sens: +e.target.value })} /><input type="number" min={SENS_MIN} max={SENS_MAX} step={0.05} value={look.sens} aria-label="Mouse sensitivity value" onChange={(e) => { const v = +e.target.value; if (v >= SENS_MIN && v <= SENS_MAX) setLook({ sens: v }); }} /></label>
          <label>Scoped × <input type="range" min={0.05} max={2} step={0.01} value={look.scope} data-testid="arena-scope-sens" onChange={(e) => setLook({ scope: +e.target.value })} /><span>{look.scope.toFixed(2)}</span></label>
          <label>Touch <input type="range" min={SENS_MIN} max={SENS_MAX} step={0.05} value={look.touch} data-testid="arena-touch-sens" onChange={(e) => setLook({ touch: +e.target.value })} /><span>{look.touch.toFixed(2)}</span></label>
          <label>Explosions <input type="range" min={0} max={1} step={0.05} value={boomVol} data-testid="arena-explosion-vol" onChange={(e) => { setExplosionVolume(+e.target.value); setBoomVol(+e.target.value); }} /><span>{Math.round(boomVol * 100)}%</span></label>
          <label><input type="checkbox" checked={look.invertY} data-testid="arena-invert-y" onChange={(e) => setLook({ invertY: e.target.checked })} /> Invert Y</label>
          <button type="button" data-testid="arena-fullscreen" onClick={toggleFullscreen}>Fullscreen (protects Ctrl+W)</button>
          <button type="button" onClick={() => setLook({ sens: 1, scope: 0.31, touch: 1, invertY: false })}>Reset</button>
        </div>
      )}
      <div className={`fps-stage${locked ? ' fps-locked' : ''}`} data-locked={locked ? '1' : '0'}>
        {pickToast && (
          <div data-testid="arena-pickup-toast" style={{ position: 'absolute', top: '62%', left: '50%', transform: 'translateX(-50%)', zIndex: 5, pointerEvents: 'none', color: '#ffd36a', fontWeight: 800, textShadow: '0 1px 3px #000' }}>{pickToast.text}</div>
        )}
        {chipToasts.length > 0 && (
          <div className="fps-chip-toasts" data-testid="arena-chip-toasts" style={{ position: 'absolute', top: '18%', left: '50%', transform: 'translateX(-50%)', zIndex: 5, pointerEvents: 'none', textAlign: 'center', fontWeight: 800 }}>
            {chipToasts.map((t) => <div key={t.key} style={{ color: t.amount > 0 ? '#9be37a' : '#ff8a7a', textShadow: '0 1px 3px #000' }}>{t.amount > 0 ? '+' : '−'}{Math.abs(t.amount)} 🪙 <span style={{ fontWeight: 500, opacity: 0.8 }}>{t.memo}</span></div>)}
          </div>
        )}
        {matchUi.phase === 'sudden' && (
          <div data-testid="arena-sudden" style={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', zIndex: 5, pointerEvents: 'none', background: 'rgba(120,0,0,.75)', color: '#fff', padding: '3px 10px', borderRadius: 4, fontWeight: 800, fontSize: 12 }}>
            SUDDEN DEATH · {matchUi.alive} alive · {clock(matchUi.sd * 1000)}{!life.alive ? ' · spectating' : ''}
          </div>
        )}
        {matchUi.phase === 'ended' && matchUi.end && (
          <div data-testid="arena-match-end" style={{ position: 'absolute', inset: '10% 15%', zIndex: 6, background: 'rgba(0,0,0,.82)', color: '#e6e9df', padding: 12, borderRadius: 8, overflow: 'auto', fontSize: 12 }} onMouseDown={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 800, textAlign: 'center' }}>MATCH OVER</div>
            <div style={{ textAlign: 'center', marginBottom: 8 }}>
              Winner: <b>{matchUi.end.players.find((p) => p.id === matchUi.end!.winnerId)?.name ?? 'nobody'}</b>
              {matchUi.end.prize && <span style={{ color: '#9be37a' }}> · +{matchUi.end.prize.amount} 🪙 WINNER</span>}
              <span className="opacity-70"> · next match in {Math.ceil(matchUi.end.inMs / 1000)}s</span>
            </div>
            <table style={{ width: '100%' }}><thead><tr><th style={{ textAlign: 'left' }}>Player</th><th>K</th><th>D</th><th>🪙 won</th></tr></thead>
              <tbody>{matchUi.end.players.map((p) => <tr key={p.id} style={{ fontWeight: p.id === me.current.id ? 800 : 400 }}><td>{p.id === matchUi.end!.winnerId ? '🏆 ' : ''}{p.name}</td><td style={{ textAlign: 'center' }}>{p.kills}</td><td style={{ textAlign: 'center' }}>{p.deaths}</td><td style={{ textAlign: 'center' }}>{p.earned ? `+${p.earned}` : '—'}{p.id === matchUi.end!.winnerId && matchUi.end!.prize ? ` +${matchUi.end!.prize.amount}` : ''}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {killCam?.playing && (
          <div data-testid="arena-killcam-on" aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', pointerEvents: 'none' }}>Kill cam playing</div>
        )}
        {!life.alive && me.current.joined && matchUi.phase === 'play' && (
          <div className="fps-respawn" data-testid="arena-respawn" data-killcam={killCam?.playing ? '1' : '0'} style={{ display: killCam?.playing ? 'none' : undefined, position: 'absolute', left: '50%', bottom: '14%', transform: 'translateX(-50%)', zIndex: 5, background: 'rgba(0,0,0,.72)', color: '#e6e9df', padding: '8px 10px', borderRadius: 6, textAlign: 'center', fontSize: 12 }}
            onMouseDown={(e) => e.stopPropagation()}>
            <div data-testid="arena-kia-header" style={{ marginBottom: 6, fontWeight: 800, letterSpacing: '.12em', fontFamily: 'monospace', fontSize: 13 }}>KILLED IN ACTION · PICK YOUR LOADOUT</div>
            {killCam?.card && <div data-testid="arena-killcard" style={{ marginBottom: 6, fontWeight: 800, letterSpacing: '.04em', color: '#ffb4a8' }}>{killCardText(killCam.card, (w) => (isWeapon(w) ? WEAPONS[w].name : w))}</div>}
            {killCam?.note && <div style={{ marginBottom: 6, opacity: 0.75 }}>{killCam.note}</div>}
            {!killCam && <div style={{ marginBottom: 6 }}><button type="button" data-testid="arena-killcam" style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid #ffb4a8', color: '#ffb4a8' }} onClick={() => watchKillCam()}>🎥 Watch kill cam <kbd>K</kbd></button></div>}
            <div style={{ marginBottom: 6 }}>
              {wallet !== null ? <>Wallet <b data-testid="arena-respawn-wallet">🪙 {wallet.toLocaleString()}</b> · next spawn <b data-testid="arena-respawn-price">{spawnCost(loadout)} 🪙</b> (your killer gets it)</> : <>Guest: spawns are free, kills pay no bounty. Sign in to play for chips.</>}
            </div>
            <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
              {[...WEAPON_ORDER.filter((w) => isKnifeOnly(w)), ...WEAPON_ORDER.filter((w) => !isKnifeOnly(w))].map((w) => (
                <button key={w} type="button" data-testid={`arena-loadout-${w}`} aria-pressed={w === loadout || (life.broke && isKnifeOnly(w))} disabled={wallet !== null && spawnCost(w) > wallet}
                  style={{ padding: '3px 6px', borderRadius: 4, border: '1px solid #888', background: w === loadout ? '#e6e9df' : 'transparent', color: w === loadout ? '#15170f' : 'inherit', opacity: wallet !== null && spawnCost(w) > wallet ? 0.4 : 1 }}
                  onClick={() => pickLoadout(w)}>{isKnifeOnly(w) ? 'Knife only · 0 🪙 (free)' : `${WEAPONS[w].name}${wallet !== null ? ` · ${spawnCost(w)}` : ''}`}</button>
              ))}
            </div>
            {!life.broke && (
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
                <span data-testid="arena-respawn-countdown">Auto-respawn in <b>{life.rs}s</b></span>
                <button type="button" data-testid="arena-respawn-now" style={{ padding: '4px 12px', borderRadius: 4, border: 0, background: '#e6e9df', color: '#15170f', fontWeight: 800 }}
                  onClick={() => respawnNow()}>Respawn <kbd>SPACE</kbd></button>
              </div>
            )}
            {life.broke && wallet !== null && (
              <div style={{ marginTop: 6 }} data-testid="arena-broke">
                {knifeOnlyAvailable() ? <>Not enough for a gun (cheapest {cheapestSpawn()} 🪙): you respawn with Knife only, free.{' '}</> : <>Out of chips (cheapest spawn {cheapestSpawn()} 🪙).{' '}</>}
                {knifeOnlyAvailable() ? '' : 'Keep spectating.'}
              </div>
            )}
          </div>
        )}
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
            if (e.button === 0) { me.current.firing = true; me.current.semiPending = true; shoot(); }
            if (e.button === 2) { if (WEAPONS[me.current.weapon].melee) shoot(true); else setScope(true); }
          }}
          onTouchStart={() => { unlockSounds(); wrapRef.current?.focus(); }}
        />
        <div className="fps-feed" data-testid="arena-feed">
          {feed.map((f) => (
            <div key={f.key} className={`${f.mine ? 'fps-feed-me' : ''}${f.head ? ' fps-feed-head' : ''}${f.multi ? ' fps-feed-multi' : ''}`}>
              {feedParts(f).map((p, i) => p.t === 'weapon' ? <WeaponIcon key={i} cause={p.cause} /> : p.t === 'head' ? <HeadshotIcon key={i} /> : p.t === 'noscope' ? <span key={i} className="fps-360" aria-label="360 no-scope">360</span> : <span key={i} className={p.t === 'killer' ? 'fps-k' : p.t === 'multi' ? 'fps-multi-t' : ''}>{p.text}</span>)}
            </div>
          ))}
        </div>
        {multiPop && (
          <div key={multiPop.key} className={`fps-multipop fps-multipop-l${multiPop.level}`} data-testid="arena-multipop" style={{ ['--ms' as string]: popupScale(multiPop.level) }} aria-live="polite">{multiPop.title}</div>
        )}
        {showBoard && (
          <div className="fps-scoreboard" data-testid="arena-scoreboard">
            <table>
              <thead><tr><th>Player</th><th>K</th><th>D</th><th>Streak</th></tr></thead>
              <tbody>{board.map((p) => <tr key={p.id} className={p.id === me.current.id ? 'fps-me' : ''}><td>{p.name}{p.bot && <span className="fps-bot-badge" title="Fill-in bot: its kills don't count toward lifetime stats">BOT</span>}</td><td>{p.k}</td><td>{p.d}</td><td>{p.st}</td></tr>)}</tbody>
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
          <button type="button" className={`fps-crouch${touchCrouch ? ' is-on' : ''}`} data-testid="arena-crouch" aria-pressed={touchCrouch} onPointerDown={(e) => { e.preventDefault(); setTouchCrouch((v) => !v); }}>CROUCH</button>
          <button type="button" className={`fps-sprint${touchSprint ? ' is-on' : ''}`} data-testid="arena-sprint" aria-pressed={touchSprint} onPointerDown={(e) => { e.preventDefault(); setTouchSprint((v) => !v); if (!touchSprint) setTouchCrouch(false); }}>SPRINT</button>
          <button type="button" className="fps-swap" data-testid="arena-swap" onPointerDown={(e) => { e.preventDefault(); cycleWeapon(1); }}>SWAP</button>
          <button
            type="button"
            className="fps-fire"
            onPointerDown={(e) => { e.preventDefault(); unlockSounds(); me.current.firing = true; me.current.semiPending = true; shoot(); }}
            onPointerUp={() => { me.current.firing = false; }}
            onPointerLeave={() => { me.current.firing = false; }}
            onPointerCancel={() => { me.current.firing = false; }}
          >FIRE</button>
        </div>
      ) : (
        <>
        {fsSupported && !isFs && !fsDismissed && (
          <div className="fps-fs-offer" data-testid="arena-fs-offer">
            <button type="button" onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}>⛶ Play fullscreen <small>(recommended: protects Ctrl+W)</small></button>
            <button type="button" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); setFsDismissed(true); try { sessionStorage.setItem('relay-arena-fs-dismissed', '1'); } catch { /* ok */ } }}>×</button>
          </div>
        )}
        <div className="fps-help" data-testid="arena-help">
          <span className="fps-help-full">WASD move · mouse look · Q/E turn · PgUp/PgDn look · click or F shoot · Space jump · Shift sprint · Ctrl/C crouch (play fullscreen so Ctrl+W can't close the tab) · 1–6 / wheel guns · 7/V knife (click slash, right-click stab) · R reload · G frag grenade · right-click scope/aim · Tab scores · M maps · F3 fps · Esc frees mouse</span>
          <span className="fps-help-short">WASD move · click shoot · Space jump · Shift sprint · Ctrl/C crouch · 1–6 guns · 7/V knife · R reload · G frag · Tab scores · M maps · F3 fps · Esc frees mouse</span>
        </div>
        </>
      )}
    </div>
  );
}

/** 3P knife animation progress for a soldier (slash 260 ms, stab 420 ms). */
function meleePose(m: { at: number; heavy: boolean } | undefined, now: number): { melee?: number; heavy?: boolean } {
  if (!m) return {};
  const t = (now - m.at) / (m.heavy ? 420 : 260);
  return t >= 0 && t < 1 ? { melee: t, heavy: m.heavy } : {};
}

/** Small weapon silhouettes for the kill feed. */
/** Original headshot mark: a crosshair ring around a dot, in gold. */
function HeadshotIcon() {
  return (
    <svg className="fps-hsicon" width="13" height="13" viewBox="0 0 16 16" aria-label="headshot" role="img">
      <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 0.5v4M8 11.5v4M0.5 8h4M11.5 8h4" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8" cy="8" r="1.6" fill="currentColor" />
    </svg>
  );
}

function WeaponIcon({ cause }: { cause: string }) {
  const paths: Record<string, string> = {
    pistol: 'M2 3h14v3H8l-1 5H4l1-5H2z',
    smg: 'M1 3h20v3h-6v2h-3l-1 4H8l1-4H5V6H1z',
    shotgun: 'M0 3h26v2H12l-2 2H4L2 9H0z',
    sniper: 'M0 4h30v1.5H16l-2 1.5H6l-3 3H0zM10 1h7v2h-7z',
    rocket: 'M0 3h22l4 1.5L22 6H0zM8 6h4v4H8z',
    grenade: 'M6 2h6v2h2v1h-2v1a5 5 0 1 1-6 0V4h0zM12 2l4-2v2z',
    ar15: 'M0 3h25v2h-9v2h-3l-1 4H9l1-4H6V5H3L1 8H0z',
    knife: 'M0 6h8V4h2v6H8V8H0zM10 5h12l6 1-6 2H10z',
    airstrike: 'M2 5l10-1 4-4h3l-2 4 8 0v2l-8 0 2 4h-3l-4-4-10-1z',
    drone: 'M0 4h28v1.5H0zM9 5.5h10l-2 3h-6z',
    nuke: 'M14 0a7 7 0 1 1 0 14 7 7 0 1 1 0-14zm0 5a2 2 0 1 0 0 4 2 2 0 1 0 0-4z',
  };
  const d = paths[cause] ?? paths.pistol;
  return <svg className="fps-wicon" viewBox="0 0 30 14" width="30" height="14" aria-label={cause} role="img"><path d={d} fill="currentColor" /></svg>;
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
