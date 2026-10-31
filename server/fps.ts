import type { Server, Socket } from 'socket.io';
import { affordableLoadout, isKnifeOnly, guestName, MOVE_SPEED, spawnCost, TICK_HZ, WEAPONS } from '../shared/fps.js';
import { randomUUID } from 'node:crypto';
import { getBank } from './casino-store.js';
import { ArenaWorld, type ArenaEvent, type ArenaFighter, type MatchResult } from './arena-world.js';
import { getVault, playerKey } from './skins.js';
import { getArenaLedger } from './arena-store.js';
import { ArenaBots, isArenaBot, warmNavGraphs } from './arena-bots.js';
import { MAPS } from '../shared/arenaMaps.js';
import { ArenaAntiCheat, perksFor, recordFlag, type ArenaFlag } from './arena-anticheat.js';
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) warmNavGraphs(Object.values(MAPS));

/** socket id -> claimed account name; guests are absent and never recorded. */
const claimed = new Map<string, string>();

const ROOM = '__fps_arena';
const MAX_PLAYERS = 24;
let world = newWorld();

// ---- Paid spawns. Every spawn of a signed-in player costs spawnCost(loadout) chips from the shared wallet; the stake
// rides on that life and goes to whoever kills you (bounty). Suicides, falls, bots and guests' kills send it to the house.
// Guests play free (no chips move, their kills earn nothing); bots never pay or earn.
/** A paid life whose player dropped (reconnect) is resumed without charging again for this long. */
export const RESUME_MS = 120_000;
const resumable = new Map<string, { lifeId: string; stake: number; loadout: ArenaFighter['loadout']; until: number }>();
const acct = (name: string) => name.trim().toLowerCase();

/** Charge one spawn. Returns false (stay dead) when the player can't afford even the cheapest loadout. */
export function chargeSpawn(f: ArenaFighter, now: number): boolean {
  const name = isBot(f.id) ? undefined : claimed.get(f.id);
  if (!name) { f.stake = 0; f.lifeId = ''; return true; }
  const held = resumable.get(acct(name));
  if (held) {
    resumable.delete(acct(name));
    if (held.until > now) { Object.assign(f, { lifeId: held.lifeId, stake: held.stake, loadout: held.loadout }); return true; }
  }
  const bank = getBank();
  const w = affordableLoadout(f.loadout, bank.account(name).chips);
  if (!w) return false;
  f.loadout = w;
  if (isKnifeOnly(w)) { f.lifeId = ''; f.stake = 0; return true; } // free, knife only, 0 bounty
  const cost = spawnCost(w);
  const lifeId = randomUUID();
  bank.transfer(name, -cost, { key: `arena-spawn:${lifeId}`, game: 'arena', memo: `Spawn · ${WEAPONS[w].name}` });
  f.lifeId = lifeId;
  f.stake = cost;
  return true;
}

/** Pay a dead fighter's stake to their killer (once per life, ledger key per kill) or burn it to the house. Returns the bounty paid. */
export function settleBounty(killerId: string | null, victimId: string, w: ArenaWorld = world): number {
  const v = w.fighters.get(victimId);
  if (!v || !v.stake || !v.lifeId) return 0;
  const stake = v.stake;
  const victimName = claimed.get(victimId);
  v.stake = 0;
  const k = killerId && killerId !== victimId && !isBot(killerId) ? claimed.get(killerId) : undefined;
  const bank = getBank();
  if (k && acct(k) !== acct(victimName ?? '')) {
    if (bank.transfer(k, stake, { key: `arena-bounty:${v.lifeId}`, game: 'arena', memo: `Bounty · ${v.name}` })) {
      const kf = w.fighters.get(killerId!);
      if (kf) kf.earned = (kf.earned ?? 0) + stake;
    }
    return stake;
  }
  if (victimName) bank.transfer(victimName, 0, { key: `arena-burn:${v.lifeId}`, game: 'arena', memo: `Stake ${stake} to the house` });
  return 0;
}

/** A signed-in player leaving mid-life keeps that paid life (stake + loadout) for RESUME_MS so a reconnect isn't charged twice. */
export function holdPaidLife(id: string, now = Date.now()): void {
  const f = world.fighters.get(id), name = claimed.get(id);
  if (f && name && f.alive && f.stake && f.lifeId) resumable.set(acct(name), { lifeId: f.lifeId, stake: f.stake, loadout: f.loadout, until: now + RESUME_MS });
}

/** Chips the match winner gets from the house. */
export const MATCH_PRIZE = 300;
/** The prize only pays when at least this many signed-in humans took part (no solo farming of bots). */
export const PRIZE_MIN_HUMANS = 2;
const matchEndHooks = new Set<(r: MatchResult) => void>();
/** Subscribe to arena match ends (e.g. case/key drops). Rows carry id, name, kills, deaths, earned, alive, bot, participationMs; `account` is added for signed-in players. Returns an unsubscribe. */
export function onArenaMatchEnd(fn: (r: MatchResult & { players: Array<MatchResult['players'][number] & { account?: string }> }) => void): () => void {
  matchEndHooks.add(fn as (r: MatchResult) => void);
  return () => { matchEndHooks.delete(fn as (r: MatchResult) => void); };
}

/** Runs once per finished match: winner prize (house -> winner, keyed per match), then the external hooks. */
export function finishMatch(r: MatchResult): void {
  for (const p of r.players as Array<MatchResult['players'][number] & { account?: string }>) {
    const name = !p.bot && !isBot(p.id) ? claimed.get(p.id) : undefined;
    if (name) p.account = name;
  }
  const humans = new Set(r.players.flatMap((p) => ((p as { account?: string }).account ? [acct((p as { account?: string }).account!)] : [])));
  const winner = r.players.find((p) => p.id === r.winnerId) as { account?: string } | undefined;
  if (winner?.account && humans.size >= PRIZE_MIN_HUMANS) {
    getBank().transfer(winner.account, MATCH_PRIZE, { key: `arena-win:${r.matchId}`, game: 'arena', memo: 'WINNER' });
    r.prize = { name: winner.account, amount: MATCH_PRIZE };
  }
  for (const fn of matchEndHooks) { try { fn(r); } catch (e) { console.error('arena match-end hook', e); } }
}

function newWorld(): ArenaWorld {
  const w = new ArenaWorld();
  w.spawnGate = chargeSpawn;
  w.onMatchEnd = finishMatch;
  return w;
}
let flagSink: (f: ArenaFlag) => void = recordFlag;
/** Test hook: capture anti-cheat flags instead of writing them. */
export function setFlagSink(fn: ((f: ArenaFlag) => void) | null): void { flagSink = fn ?? recordFlag; }
const newAudit = () => new ArenaAntiCheat((f) => flagSink(f), (id, name) => (isBot(id) || perksFor(claimed.get(id)).size ? null : claimed.get(id)?.toLowerCase() ?? `guest:${name}`));
world.audit = newAudit();
  wireWorld(world);
/** Match-end drops + equipped skins for signed-in players. */
let dropIo: Server | null = null;
function wireWorld(_w: ArenaWorld): void { /* match end runs through finishMatch -> onArenaMatchEnd hooks */ }
/** A signed-in fighter's equipped skins (weapon -> token). Self-heals the cache from the vault, so a new match, respawn,
 * reconnect or restart never shows stock guns while the inventory says equipped. */
export function mySkins(id: string, w: ArenaWorld = world): Record<string, string> | undefined {
  const n = claimed.get(id);
  if (!n) return undefined;
  let sk = w.skins.get(id);
  if (!sk) { sk = getVault().loadout(n); w.skins.set(id, sk); }
  return Object.keys(sk).length ? sk : undefined;
}
onArenaMatchEnd(({ matchId, players }) => {
  for (const [id, n] of claimed) if (world.fighters.has(id)) world.skins.set(id, getVault().loadout(n));
  const humans = players.filter((p) => p.account && !isBot(p.id)).map((p) => ({ sock: p.id, name: p.account!, ms: p.participationMs, kills: p.kills, deaths: p.deaths }));
  const got = getVault().dropForMatch(matchId, humans);
  for (const g of got) for (const h of humans) if (h.name === g.name) dropIo?.to(h.sock).emit('inv_drop', g.item);
});
getVault().listeners.add((k) => {
  for (const [id, n] of claimed) if (playerKey(n) === k && world.fighters.has(id)) world.skins.set(id, getVault().loadout(n));
});
/** Test hook. */
export const getArenaWorld = () => world;
let ticker: ReturnType<typeof setInterval> | null = null;

// ---- QA bots (test hook). Disabled unless ARENA_QA_BOTS=1 is set on the server; never set it in production.
export const QA_BOT_PREFIX = 'qa-bot-';
const MAX_QA_BOTS = 6;
const botHeading = new Map<string, number>();
export const qaBotsEnabled = () => process.env.ARENA_QA_BOTS === '1';
const isBot = (id: string) => id.startsWith(QA_BOT_PREFIX) || isArenaBot(id);
const isHuman = (id: string) => !isBot(id);
/** Fill-in bots: 3 join when exactly one human plays, they leave when a second human arrives, none run with nobody. */
let arenaBots = new ArenaBots();
const syncBots = (now: number) => arenaBots.sync(world, now, isHuman);

/** Adds up to `n` wandering, non-shooting bots so QA can chain kills (killstreaks, UAV, airstrike, drone, nuke). */
export function addQaBots(n: unknown, now = Date.now()): number {
  if (!qaBotsEnabled()) return 0;
  const want = Math.max(0, Math.min(MAX_QA_BOTS, Math.floor(Number(n) || 0)));
  let have = [...world.fighters.keys()].filter(isBot).length;
  let added = 0;
  for (let i = 1; have < want && i <= MAX_QA_BOTS; i++) {
    const id = `${QA_BOT_PREFIX}${i}`;
    if (world.fighters.has(id)) continue;
    world.join(id, `QA Bot ${i}`, now);
    botHeading.set(id, Math.random() * Math.PI * 2);
    have++;
    added++;
  }
  return added;
}

/** Slow random walk with the odd jump (so QA can shoot at targets at different heights); bots turn when they bump a wall. */
function driveBots(now: number): void {
  for (const f of world.fighters.values()) {
    if (!f.id.startsWith(QA_BOT_PREFIX) || !f.alive) continue;
    let a = botHeading.get(f.id) ?? 0;
    const step = (MOVE_SPEED * 0.4) / TICK_HZ;
    const bx = f.x, by = f.y;
    world.move(f.id, f.x + Math.cos(a) * step, f.y + Math.sin(a) * step, a, now, 0);
    if (Math.hypot(f.x - bx, f.y - by) < step * 0.3 || Math.random() < 0.02) {
      a = Math.random() * Math.PI * 2;
      botHeading.set(f.id, a);
    }
    if (Math.random() < 0.015) world.jump(f.id, now);
  }
}

function dropBotsIfAlone(): void {
  if ([...world.fighters.keys()].some(isHuman)) return;
  for (const id of [...world.fighters.keys()]) { world.leave(id); botHeading.delete(id); }
  arenaBots = new ArenaBots();
}

export function resetArena(): void {
  world = newWorld();
  resumable.clear();
  world.audit = newAudit();
  wireWorld(world);
  botHeading.clear();
  arenaBots = new ArenaBots();
  claimed.clear();
  if (ticker) clearInterval(ticker);
  ticker = null;
}

/** Folds arena events into lifetime stats (server-side only). */
export function recordArena(events: ArenaEvent[], w: ArenaWorld = world): void {
  const ledger = getArenaLedger();
  for (const e of events) {
    const d = e.data as Record<string, unknown>;
    if (e.ev === 'fps_kill') {
      const killerId = d.killerId as string | null, victimId = d.victimId as string;
      const bounty = settleBounty(killerId, victimId, w);
      if (bounty) d.bounty = bounty;
      // Arena bot kills and deaths never touch lifetime stats (match scoreboard only).
      if ((killerId && isArenaBot(killerId)) || isArenaBot(victimId)) continue;
      const v = claimed.get(victimId);
      if (v) ledger.death(v);
      const k = killerId ? claimed.get(killerId) : undefined;
      if (k && killerId !== victimId && d.cause !== 'nuke' && !victimId.startsWith(QA_BOT_PREFIX)) ledger.kill(k, w.fighters.get(killerId!)?.streak ?? 1);
    } else if (e.ev === 'fps_streak' && d.kind === 'nuke') {
      const n = claimed.get(d.id as string);
      if (n) ledger.nuke(n);
    } else if (e.ev === 'fps_nuke' && d.phase === 'boom') {
      for (const id of w.fighters.keys()) { const n = claimed.get(id); if (n) ledger.round(n); }
    }
  }
}

/** Test hook: mark a fighter id as a claimed name. */
export function claimArenaName(id: string, name: string | null): void {
  if (name) claimed.set(id, name); else claimed.delete(id);
}

/** Humans in the arena (fighter id = socket id). Bots get nothing. */
const viewers = () => [...world.fighters.keys()].filter(isHuman);

function emit(io: Server, events: ArenaEvent[]): void {
  recordArena(events);
  const now = Date.now();
  for (const e of events) {
    // Shots carry the shooter's position: hidden shooters only give away a coarse origin.
    if (e.ev === 'fps_shot') for (const id of viewers()) io.to(id).emit(e.ev, world.shotFor(id, e.data, now));
    else if (e.to) io.to(e.to).emit(e.ev, e.data);
    else io.to(ROOM).emit(e.ev, e.data);
  }
}

/** Interest management: each client only gets positions/health of enemies it can plausibly see. */
function broadcastState(io: Server, now = Date.now()): void {
  const full = world.snapshot(now);
  for (const id of viewers()) {
    const snap = world.snapshotFor(id, now, full);
    const mysk = mySkins(id);
    io.to(id).emit('fps_state', mysk ? { ...snap, mysk } : snap);
  }
}

function ensureTicker(io: Server): void {
  if (ticker) return;
  ticker = setInterval(() => {
    if (!world.fighters.size) {
      if (ticker) clearInterval(ticker);
      ticker = null;
      return;
    }
    const now = Date.now();
    driveBots(now);
    syncBots(now);
    emit(io, arenaBots.drive(world, now));
    emit(io, world.tick(now));
    broadcastState(io, now);
  }, Math.round(1000 / TICK_HZ));
  (ticker as unknown as { unref?: () => void }).unref?.();
}

function leave(io: Server, socket: Socket): void {
  holdPaidLife(socket.id);
  if (!world.leave(socket.id)) return;
  claimed.delete(socket.id);
  world.skins.delete(socket.id);
  dropBotsIfAlone();
  syncBots(Date.now());
  socket.leave(ROOM);
  broadcastState(io);
}

const body = (p: unknown) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {});

export function registerFps(io: Server, socket: Socket): void {
  socket.on('fps_join', (payload: unknown, ack?: (res: unknown) => void) => {
    if (!world.fighters.has(socket.id)) {
      if (world.fighters.size >= MAX_PLAYERS) {
        ack?.({ ok: false, error: 'Arena is full, try again in a bit.' });
        return;
      }
      const account = (socket.data.account as { name?: string } | undefined)?.name;
      claimArenaName(socket.id, account ?? null);
      const perks = perksFor(account);
      if (perks.size) world.perks.set(socket.id, perks); // before join, so detection skips them
      world.join(socket.id, account ?? guestName(), Date.now(), body(payload).w);
      dropIo = io;
      if (account) world.skins.set(socket.id, getVault().loadout(account)); else world.skins.delete(socket.id);
      // The first human in can choose the map straight away.
      const want = body(payload).map;
      if (want !== undefined) { const ev = world.pickMap(want, socket.id, Date.now(), isHuman); if (ev) emit(io, ev); }
      claimArenaName(socket.id, account ?? null);
      if (account) getArenaLedger().match(account);
      socket.join(ROOM);
    }
    syncBots(Date.now());
    const bots = addQaBots(body(payload).qaBots);
    if (bots) broadcastState(io);
    const f = world.fighters.get(socket.id)!;
    ack?.({ ok: true, id: socket.id, x: f.x, y: f.y, z: f.z, a: f.a, map: world.map.id, alive: f.alive, broke: f.broke, paid: !!claimed.get(socket.id) });
    ensureTicker(io);
  });
  socket.on('fps_move', (p: unknown) => {
    const b = body(p);
    world.move(socket.id, b.x, b.y, b.a, Date.now(), b.p, b.c, b.s, b.q);
  });
  socket.on('fps_shoot', (p: unknown) => emit(io, world.shoot(socket.id, body(p).a, Date.now(), body(p).p, body(p).vt, body(p).h)));
  socket.on('fps_crouch', (p: unknown) => world.crouch(socket.id, body(p).on));
  socket.on('fps_jump', () => emit(io, world.jump(socket.id, Date.now())));
  socket.on('fps_respawn', (p: unknown) => { if (world.requestRespawn(socket.id, body(p).w, Date.now())) broadcastState(io); });
  socket.on('fps_loadout', (p: unknown) => world.setLoadout(socket.id, body(p).w, Date.now()));
  socket.on('fps_weapon', (p: unknown) => world.switchWeapon(socket.id, body(p).w, Date.now()));
  socket.on('fps_reload', () => world.reload(socket.id, Date.now()));
  socket.on('fps_scope', (p: unknown) => world.setScope(socket.id, body(p).on, Date.now()));
  socket.on('fps_map', (p: unknown, ack?: (res: unknown) => void) => {
    const ev = world.pickMap(body(p).map, socket.id, Date.now(), isHuman);
    if (ev) { emit(io, ev); broadcastState(io); }
    if (typeof ack === 'function') ack({ ok: !!ev, map: world.map.id, next: world.upcomingMapId });
  });
  socket.on('fps_ping', (ack?: unknown) => { if (typeof ack === 'function') ack(Date.now()); });
  socket.on('fps_leave', () => leave(io, socket));
  socket.on('disconnect', () => leave(io, socket));
}
