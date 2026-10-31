/**
 * Server-authoritative arena simulation: weapons, ammo, jumping, killstreaks.
 * Pure (time and randomness are passed in) so tests can drive it directly; server/fps.ts wires it to sockets.
 */
import {
  AIRSTRIKE_DAMAGE, AIRSTRIKE_DELAY_MS, AIRSTRIKE_LOCK_MS, AIRSTRIKE_RADIUS, AIRSTRIKE_RANGE, AIRSTRIKE_SPACING, AIRSTRIKE_WAIT_MS, applyDamage,
  chestOf, clampPitch, dirFrom, DRONE_COOLDOWN_MS, DRONE_DAMAGE, DRONE_MS, DRONE_RANGE, eyeOf, fireWeapon, isWeapon, KILL_Z, lineOfSight, MAP, MAX_HP, maybeRespawn,
  normAngle, launchRocket, rocketDamage, stepRocket, type Rocket, NUKE_DELAY_MS, NUKE_RESPAWN_MS, pickSpawn, rayWorld, roofAt, SCOPE_SETTLE_MS, splashTargets, stepVertical, STREAKS, streakReward,
  SWITCH_MS, tryJump, UAV_MS, validateMove, WEAPON_ORDER, WEAPONS, type ArenaMap, type Fighter, MAPS, type StreakKind, type WeaponId,
} from '../shared/fps.js';
import { isMapId, MAP_ROTATION } from '../shared/arenaMaps.js';
import { PoseHistory, rewindTime } from '../shared/netInterp.js';
import { ArenaAntiCheat, ASSIST_CONE, ASSIST_PULL, ASSIST_SPREAD, coarse, VisibilityTracker, type ArenaPerk } from './arena-anticheat.js';
import { MULTI_LEVEL, MULTI_TITLE, multiTier, nextChain, type MultiChain } from '../shared/arenaMulti.js';
import { applyCrouch, canSprint, headZOf, speedOf, SPRINT_FIRE_DELAY_MS, SPRINT_FIRE_SLACK_MS } from '../shared/fps.js';

/** Drones hover at least this high, and always above the map's tallest structure. */
export const DRONE_Z = 8;
export const droneZ = (map: ArenaMap): number =>
  Math.max(DRONE_Z, ...map.solids.filter((s) => s.x1 - s.x0 < map.w - 1 && s.y1 - s.y0 < map.d - 1).map((s) => s.z1 + 1.5)); // ignores the perimeter walls
/** A match lasts this long; then the next map (picked or in rotation) loads and scores reset. */
export const MATCH_MS = 8 * 60_000;
/** Map that follows `id` in the rotation. */
export const nextInRotation = (id: string): string => MAP_ROTATION[(MAP_ROTATION.indexOf(id) + 1) % MAP_ROTATION.length];

/** Allowance for network jitter when checking fire rate. */
export const FIRE_JITTER_MS = 25;

export interface ArenaFighter extends Fighter {
  weapon: WeaponId;
  ammo: Record<WeaponId, number>;
  lastShotAt: Record<WeaponId, number>;
  reloadUntil: number;
  switchedAt: number;
  scopedSince: number;
  jumpAt: number;
  streak: number;
  /** multi-kill chain (kills ≤3 s apart) */
  multi?: MultiChain;
  uavUntil: number;
  /** Server time the vertical physics was last advanced to. */
  physAt: number;
  headshots: number;
  /** Crouch key held (crouch itself is on Fighter via Body; it stays on under a low ceiling). */
  wantCrouch?: boolean;
  /** when the last sprint ended (sprint-to-fire delay) */
  sprintEndAt?: number;
}

/** `to` set: sent only to that socket (e.g. the killer's own multi-kill sound cue); otherwise broadcast. */
export interface ArenaEvent { ev: string; data: Record<string, unknown>; to?: string }
/** An airstrike run. It tracks its target (trackId) until lockAt, then the zone is fixed and the bombs fall at `at`. */
interface Strike { ownerId: string; x: number; y: number; at: number; trackId: string | null; lockAt: number; giveUpAt: number; bombs: Array<{ dx: number; dy: number; dt: number }> }
interface Drone { ownerId: string; until: number; lastShot: number }

const fullAmmo = () => Object.fromEntries(WEAPON_ORDER.map((w) => [w, WEAPONS[w].mag])) as Record<WeaponId, number>;
const zeroShots = () => Object.fromEntries(WEAPON_ORDER.map((w) => [w, -1e9])) as Record<WeaponId, number>;

export class ArenaWorld {
  readonly fighters = new Map<string, ArenaFighter>();
  strikes: Strike[] = [];
  drones = new Map<string, Drone>();
  /** RPG rockets in flight (server-simulated projectiles). */
  rockets: Rocket[] = [];
  private rocketSeq = 0;
  nuke: { ownerId: string; by: string; at: number } | null = null;

  /** Map picked by a player for the next match (validated), or null to follow the rotation. */
  nextMapId: string | null = null;
  /** When the current match ends (0 until someone joins). */
  matchEndsAt = 0;
  private droneHeight: number;
  /** Per-viewer line-of-sight memory (interest management). */
  vis = new VisibilityTracker();
  /** Optional cheat-detection stats (flag only). */
  audit: ArenaAntiCheat | null = null;
  /** Owner-granted perks by fighter id (set by the server from the account, never by the client). */
  perks = new Map<string, ReadonlySet<ArenaPerk>>();
  hasPerk = (id: string, k: ArenaPerk) => !!this.perks.get(id)?.has(k);

  constructor(public map: ArenaMap = MAP, private rand: () => number = Math.random) {
    this.droneHeight = droneZ(map);
  }

  /** The map the next match will be played on. */
  get upcomingMapId(): string {
    return this.nextMapId ?? nextInRotation(this.map.id);
  }

  /**
   * A player asks for a map. Unknown ids are rejected. The pick becomes the next map; if the picker is the only
   * human here (QA bots don't count) it loads straight away. Returns the events to broadcast, or null if rejected.
   */
  pickMap(id: unknown, pickerId: string, now: number, isHuman: (id: string) => boolean = () => true): ArenaEvent[] | null {
    if (!isMapId(id) || !this.fighters.has(pickerId)) return null;
    const humans = [...this.fighters.keys()].filter(isHuman);
    if (humans.length === 1 && humans[0] === pickerId) {
      return id === this.map.id ? [] : this.changeMap(MAPS[id], now, this.fighters.get(pickerId)!.name);
    }
    this.nextMapId = id;
    return [{ ev: 'fps_map', data: { phase: 'next', map: id, by: this.fighters.get(pickerId)!.name } }];
  }

  /** Loads a new map: fresh match, scores reset, streak rewards cleared, everyone redeploys at the new spawns. */
  /** Called once per finished match (timer ran out), before the next map loads. Used for item drops. */
  onMatchEnd?: (r: { matchId: string; players: Array<{ id: string; name: string; ms: number; kills: number; deaths: number }> }) => void;
  /** When each fighter entered the current match (for drop participation). */
  readonly matchJoinAt = new Map<string, number>();
  /** Equipped skin tokens per fighter id, by weapon (sent as \`sk\` for the held weapon). */
  readonly skins = new Map<string, Record<string, string>>();
  matchResult(now: number) {
    return {
      matchId: `${this.map.id}:${this.matchEndsAt}`,
      players: [...this.fighters.values()].map((f) => ({ id: f.id, name: f.name, ms: now - (this.matchJoinAt.get(f.id) ?? now), kills: f.kills, deaths: f.deaths })),
    };
  }
  changeMap(map: ArenaMap, now: number, by: string | null = null): ArenaEvent[] {
    this.map = map;
    for (const id of this.fighters.keys()) this.matchJoinAt.set(id, now);
    this.droneHeight = droneZ(map);
    this.nextMapId = null;
    this.matchEndsAt = now + MATCH_MS;
    this.strikes = [];
    this.rockets = [];
    this.drones.clear();
    this.nuke = null;
    const placed: ArenaFighter[] = [];
    for (const f of this.fighters.values()) {
      const [x, y, z] = pickSpawn(placed, this.rand, map);
      Object.assign(f, { x, y, z, vz: 0, grounded: true, crouch: false, wantCrouch: false, sprint: false, p: 0, physAt: now, lastMove: now, hp: MAX_HP, alive: true, respawnAt: 0, kills: 0, deaths: 0, streak: 0, uavUntil: 0, headshots: 0, ammo: fullAmmo(), reloadUntil: 0, lastShotAt: zeroShots() });
      placed.push(f);
    }
    return [{ ev: 'fps_map', data: { phase: 'load', map: map.id, by } }];
  }

  join(id: string, name: string, now: number): ArenaFighter {
    const existing = this.fighters.get(id);
    if (existing) return existing;
    if (!this.matchEndsAt) this.matchEndsAt = now + MATCH_MS;
    const [x, y, z] = pickSpawn([...this.fighters.values()], this.rand, this.map);
    const f: ArenaFighter = {
      id, name, x, y, z, vz: 0, grounded: true, p: 0, physAt: now, headshots: 0, a: this.rand() * Math.PI * 2, hp: MAX_HP, kills: 0, deaths: 0, alive: true, respawnAt: 0,
      lastShot: 0, lastMove: now, weapon: 'pistol', ammo: fullAmmo(), lastShotAt: zeroShots(), reloadUntil: 0,
      switchedAt: -1e9, scopedSince: 0, jumpAt: -1e9, streak: 0, uavUntil: 0,
    };
    this.fighters.set(id, f);
    this.matchJoinAt.set(id, now);
    this.audit?.join(id, name);
    return f;
  }

  leave(id: string): boolean {
    this.drones.delete(id);
    this.strikes = this.strikes.filter((s) => s.ownerId !== id);
    this.rockets = this.rockets.filter((r) => r.ownerId !== id);
    this.history.forget(id);
    this.vis.forget(id);
    this.perks.delete(id);
    this.audit?.leave(id);
    return this.fighters.delete(id);
  }

  /** Advances a fighter's server-side gravity/jump simulation to `now`. Height is never taken from clients. */
  advance(f: ArenaFighter, now: number): void {
    const dt = (now - f.physAt) / 1000;
    f.physAt = Math.max(f.physAt, now);
    if (!f.alive || dt <= 0) return;
    stepVertical(f, dt, this.map);
  }

  /** Client position report: x/y are speed-capped and collision-checked; z comes from the server's physics. */
  move(id: string, x: unknown, y: unknown, a: unknown, now: number, p?: unknown, crouch?: unknown, sprint?: unknown): void {
    const f = this.fighters.get(id);
    if (!f || !f.alive) return;
    if (typeof crouch === 'boolean') this.crouch(id, crouch);
    const na = normAngle(a);
    if (na !== null) f.a = na;
    const np = clampPitch(p);
    if (np !== null) f.p = np;
    if (this.audit && (na !== null || np !== null)) this.audit.aim(id, f.a, f.p, now);
    if (now - f.lastMove < 25) return; // ~40 Hz max
    this.advance(f, now);
    {
      const scoped = f.weapon === 'sniper' && f.scopedSince > 0;
      const ok = sprint === true && typeof x === 'number' && typeof y === 'number' && canSprint(f, x - f.x, y - f.y, scoped);
      this.setSprint(f, ok, now);
    }
    if (this.audit && typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) {
      const dtMs = Math.min(Math.max(now - f.lastMove, 0), 500);
      this.audit.move(id, Math.hypot(x - f.x, y - f.y), speedOf(f) * (dtMs / 1000) * 1.5 + 0.1, now);
    }
    validateMove(f, x, y, now - f.lastMove, this.map);
    f.lastMove = now;
    this.history.record(f.id, now, f.x, f.y, f.z, !!f.crouch);
  }

  setSprint(f: ArenaFighter, on: boolean, now: number): void {
    if (f.sprint && !on) f.sprintEndAt = now;
    f.sprint = on;
  }

  /** Crouch key held or released. Standing up waits for headroom (checked again every tick). */
  crouch(id: string, want: unknown): boolean {
    const f = this.fighters.get(id);
    if (!f || !f.alive || typeof want !== 'boolean') return false;
    f.wantCrouch = want;
    if (want) this.setSprint(f, false, Date.now());
    return applyCrouch(f, want, this.map);
  }

  /** Space bar. Only works while standing on something, so it can't be spammed mid-air. */
  jump(id: string, now: number): ArenaEvent[] {
    const f = this.fighters.get(id);
    if (!f || !f.alive) return [];
    this.advance(f, now);
    if (!tryJump(f)) return [];
    f.jumpAt = now;
    return [{ ev: 'fps_jump', data: { id } }];
  }

  switchWeapon(id: string, w: unknown, now: number): boolean {
    const f = this.fighters.get(id);
    if (!f || !isWeapon(w) || f.weapon === w) return false;
    f.weapon = w;
    f.switchedAt = now;
    f.reloadUntil = 0; // switching cancels a reload
    f.scopedSince = 0;
    return true;
  }

  setScope(id: string, on: unknown, now: number): void {
    const f = this.fighters.get(id);
    if (!f) return;
    f.scopedSince = on === true && f.weapon === 'sniper' ? f.scopedSince || now : 0;
    if (f.scopedSince) this.setSprint(f, false, now);
  }

  private settleReload(f: ArenaFighter, now: number): void {
    if (f.reloadUntil && now >= f.reloadUntil) {
      f.ammo[f.weapon] = WEAPONS[f.weapon].mag;
      f.reloadUntil = 0;
    }
  }

  reload(id: string, now: number): boolean {
    const f = this.fighters.get(id);
    if (!f || !f.alive) return false;
    this.settleReload(f, now);
    if (f.reloadUntil || f.ammo[f.weapon] >= WEAPONS[f.weapon].mag) return false;
    f.reloadUntil = now + WEAPONS[f.weapon].reloadMs;
    return true;
  }

  /** Lag compensation: where everyone was over the last second. */
  history = new PoseHistory();

  shoot(id: string, a: unknown, now: number, p?: unknown, viewT?: unknown): ArenaEvent[] {
    const f = this.fighters.get(id);
    if (!f || !f.alive) return [];
    const spec = WEAPONS[f.weapon];
    this.settleReload(f, now);
    if (f.reloadUntil) return [];
    if (now - f.switchedAt < SWITCH_MS) return [];
    // Firing ends a sprint; the shot only goes once the gun is back up.
    if (f.sprint) { this.setSprint(f, false, now); return []; }
    if (f.sprintEndAt !== undefined && now - f.sprintEndAt < SPRINT_FIRE_DELAY_MS - SPRINT_FIRE_SLACK_MS) return [];
    if (now - f.lastShotAt[f.weapon] < spec.cooldownMs - FIRE_JITTER_MS) return [];
    if (f.ammo[f.weapon] <= 0) {
      this.reload(id, now);
      return [];
    }
    const na = normAngle(a);
    if (na !== null) f.a = na;
    const np = clampPitch(p);
    if (np !== null) f.p = np;
    const flick = this.audit ? this.audit.aim(id, f.a, f.p, now) : 0;
    this.advance(f, now);
    f.lastShotAt[f.weapon] = now;
    f.lastShot = now;
    f.ammo[f.weapon] -= 1;
    if (f.ammo[f.weapon] === 0) f.reloadUntil = now + spec.reloadMs;
    const scoped = f.weapon === 'sniper' && f.scopedSince > 0 && now - f.scopedSince >= SCOPE_SETTLE_MS;
    if (f.weapon === 'rocket') {
      const r = launchRocket(++this.rocketSeq, f, now);
      this.rockets.push(r);
      return [{ ev: 'fps_shot', data: { id: f.id, w: f.weapon, o: [+f.x.toFixed(2), +f.y.toFixed(2), +f.z.toFixed(2)], rocket: this.rocketView(r) } }];
    }
    // Rewind other fighters to what the shooter saw (capped at LAG_COMP_MAX_MS), hit-test, then restore.
    const rt = rewindTime(now, viewT);
    const restore: Array<[Fighter, number, number, number, boolean | undefined]> = [];
    if (rt < now) for (const o of this.fighters.values()) {
      if (o.id === f.id || !o.alive) continue;
      const h = this.history.at(o.id, rt);
      if (h) { restore.push([o, o.x, o.y, o.z, o.crouch]); o.x = h.x; o.y = h.y; o.z = h.z; o.crouch = !!h.crouch; }
    }
    let shot: ReturnType<typeof fireWeapon>;
    let blocked = 0;
    try {
      if (this.hasPerk(f.id, 'aimassist')) this.assistAim(f);
      const useSpec = this.hasPerk(f.id, 'aimassist') ? { ...spec, spread: spec.spread * ASSIST_SPREAD } : spec;
      shot = fireWeapon(f, useSpec, [...this.fighters.values()], { scoped, rand: this.rand, map: this.map });
      // Defence in depth: a hit only counts if the target was in sight of the shooter's eye at lag-comp time.
      const eye = eyeOf(f);
      for (const tid of [...shot.hits.keys()]) {
        const t = this.fighters.get(tid);
        if (!t) continue;
        if (lineOfSight(eye, { x: t.x, y: t.y, z: t.z + headZOf(t) }, this.map) || lineOfSight(eye, chestOf(t), this.map) || lineOfSight(eye, { x: t.x, y: t.y, z: t.z + 0.35 }, this.map)) continue;
        shot.hits.delete(tid); shot.heads.delete(tid); blocked += 1;
      }
    }
    finally { for (const [o, x, y, z, c] of restore) { o.x = x; o.y = y; o.z = z; o.crouch = c; } }
    const events: ArenaEvent[] = [{
      ev: 'fps_shot',
      data: {
        id: f.id, w: f.weapon, o: [+f.x.toFixed(2), +f.y.toFixed(2), +f.z.toFixed(2)],
        rays: shot.rays.map((r) => [+r.a.toFixed(3), +r.p.toFixed(3), +r.dist.toFixed(2), r.hit ? 1 : 0]),
        impact: shot.impact && { x: +shot.impact.x.toFixed(2), y: +shot.impact.y.toFixed(2), z: +shot.impact.z.toFixed(2) },
      },
    }];
    this.audit?.shot(f.id, now, { precise: f.weapon !== 'shotgun', hit: shot.hits.size > 0, head: shot.heads.size > 0, flick, blocked, weapon: f.weapon });
    for (const [tid, dmg] of shot.hits) {
      const head = shot.heads.has(tid);
      if (head) f.headshots += 1;
      events.push(...this.damage(f.id, tid, dmg, now, f.weapon, head));
    }
    return events;
  }

  /** Owner perk: pulls the aim most of the way toward the nearest visible enemy head/chest inside the cone. */
  assistAim(f: ArenaFighter): void {
    const eye = eyeOf(f);
    let best: { a: number; p: number; off: number } | null = null;
    for (const t of this.fighters.values()) {
      if (t.id === f.id || !t.alive) continue;
      for (const pt of [{ x: t.x, y: t.y, z: t.z + headZOf(t) }, chestOf(t)]) {
        const dx = pt.x - eye.x, dy = pt.y - eye.y, dz = pt.z - eye.z;
        const h = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx), p = Math.atan2(dz, h);
        let da = a - f.a; da = Math.atan2(Math.sin(da), Math.cos(da));
        const off = Math.hypot(da * Math.cos(p), p - f.p);
        if (off > ASSIST_CONE || (best && off >= best.off) || !lineOfSight(eye, pt, this.map)) continue;
        best = { a: f.a + da, p, off };
      }
    }
    if (!best) return;
    f.a = normAngle(f.a + (best.a - f.a) * ASSIST_PULL) ?? f.a;
    f.p = f.p + (best.p - f.p) * ASSIST_PULL;
  }

  /** Applies damage from attacker (may be absent for the nuke) and handles kills and streaks. */
  private damage(byId: string | null, targetId: string, amount: number, now: number, cause: string, head = false): ArenaEvent[] {
    const t = this.fighters.get(targetId);
    if (!t || !t.alive) return [];
    const killed = applyDamage(t, now, amount);
    const out: ArenaEvent[] = [{ ev: 'fps_hit', data: { by: byId, target: targetId, hp: t.hp, dmg: amount, cause, ...(head ? { head: true } : {}) } }];
    if (!killed) return out;
    t.streak = 0;
    const killer = byId ? this.fighters.get(byId) : undefined;
    out.push({ ev: 'fps_kill', data: { killer: killer?.name ?? '☢', victim: t.name, killerId: byId, victimId: t.id, cause, ...(head ? { head: true, headshot: true } : {}) } });
    if (killer && killer.id !== t.id && cause !== 'nuke') {
      killer.kills += 1;
      killer.streak += 1;
      // Multi-kill chain: bot victims count here too (lifetime stats skip them in recordArena).
      killer.multi = nextChain(killer.multi, now);
      const tier = multiTier(killer.multi.n);
      if (tier) {
        const data = { id: killer.id, name: killer.name, n: killer.multi.n, tier, title: MULTI_TITLE[tier], level: MULTI_LEVEL[tier] };
        out.push({ ev: 'fps_multi', data });
        out.push({ ev: 'fps_multi_me', data: { ...data, sound: tier }, to: killer.id });
      }
      const reward = streakReward(killer.streak);
      if (reward) out.push(...this.activate(killer, reward, now));
    }
    return out;
  }

  private activate(f: ArenaFighter, kind: StreakKind, now: number): ArenaEvent[] {
    const info = STREAKS.find((s) => s.kind === kind)!;
    const out: ArenaEvent[] = [{ ev: 'fps_streak', data: { id: f.id, name: f.name, kind, streak: f.streak, title: info.name } }];
    if (kind === 'uav') f.uavUntil = now + UAV_MS;
    if (kind === 'airstrike') {
      const dir = dirFrom(f.a, f.p);
      const d = Math.max(0, rayWorld(eyeOf(f), dir, this.map, AIRSTRIKE_RANGE) - 0.3);
      const s: Strike = { ownerId: f.id, x: f.x + dir.x * d, y: f.y + dir.y * d, at: Infinity, trackId: null, lockAt: 0, giveUpAt: now + AIRSTRIKE_WAIT_MS, bombs: [] };
      this.strikes.push(s);
      this.aimStrike(s, now);
      out.push({ ev: 'fps_strike', data: { x: +s.x.toFixed(2), y: +s.y.toFixed(2), inMs: Number.isFinite(s.at) ? s.at - now : -1, ownerId: f.id, phase: 'called' } });
    }
    if (kind === 'drone') this.drones.set(f.id, { ownerId: f.id, until: now + DRONE_MS, lastShot: 0 });
    if (kind === 'nuke' && !this.nuke) {
      this.nuke = { ownerId: f.id, by: f.name, at: now + NUKE_DELAY_MS };
      out.push({ ev: 'fps_nuke', data: { phase: 'armed', by: f.name, inMs: NUKE_DELAY_MS } });
    }
    return out;
  }

  /** Picks the live enemy with the most other enemies around it; schedules the run once there is one. */
  private aimStrike(s: Strike, now: number): boolean {
    const enemies = [...this.fighters.values()].filter((t) => t.alive && t.id !== s.ownerId);
    if (!enemies.length) return false;
    let best = enemies[0], bestN = -1;
    for (const e of enemies) {
      const n = enemies.filter((o) => Math.hypot(o.x - e.x, o.y - e.y) < AIRSTRIKE_RADIUS * 1.5).length;
      if (n > bestN) { best = e; bestN = n; }
    }
    s.trackId = best.id;
    s.x = best.x;
    s.y = best.y;
    s.at = now + AIRSTRIKE_DELAY_MS;
    s.lockAt = s.at - AIRSTRIKE_LOCK_MS;
    // A short carpet: three bombs along a random heading through the target.
    const h = this.rand() * Math.PI;
    s.bombs = [-1, 0, 1].map((k, i) => ({ dx: Math.cos(h) * k * AIRSTRIKE_SPACING, dy: Math.sin(h) * k * AIRSTRIKE_SPACING, dt: i * 180 }));
    return true;
  }

  private rocketView(r: Rocket) {
    return { id: r.id, ownerId: r.ownerId, x: +r.x.toFixed(2), y: +r.y.toFixed(2), z: +r.z.toFixed(2), vx: +r.vx.toFixed(2), vy: +r.vy.toFixed(2), vz: +r.vz.toFixed(2) };
  }

  /** Flies every rocket to `now`; bursts on walls, floors, players or timeout with splash damage. */
  stepRockets(now: number): ArenaEvent[] {
    const out: ArenaEvent[] = [];
    if (!this.rockets.length) return out;
    const left: Rocket[] = [];
    for (const r of this.rockets) {
      const imp = stepRocket(r, now, [...this.fighters.values()], this.map);
      if (!imp) { left.push(r); continue; }
      out.push({ ev: 'fps_boom', data: { x: +imp.x.toFixed(2), y: +imp.y.toFixed(2), z: +imp.z.toFixed(2), r: WEAPONS.rocket.splash, cause: 'rocket', rocket: r.id, ownerId: r.ownerId } });
      const hits = rocketDamage(imp, imp.direct, r.ownerId, [...this.fighters.values()], this.map);
      for (const [tid, dmg] of hits) out.push(...this.damage(this.fighters.has(r.ownerId) ? r.ownerId : null, tid, dmg, now, 'rocket'));
    }
    this.rockets = left;
    return out;
  }

  dronePos(d: Drone, now: number): { x: number; y: number; z: number } | null {
    const o = this.fighters.get(d.ownerId);
    if (!o) return null;
    const t = now / 700;
    // Circles above its owner, high over the rooftops.
    const ox = Math.min(this.map.w - 0.5, Math.max(0.5, o.x + Math.cos(t) * 1.5));
    const oy = Math.min(this.map.d - 0.5, Math.max(0.5, o.y + Math.sin(t) * 1.5));
    return { x: ox, y: oy, z: this.droneHeight };
  }

  tick(now: number): ArenaEvent[] {
    const out: ArenaEvent[] = [];
    const all = [...this.fighters.values()];
    for (const f of all) {
      this.settleReload(f, now);
      this.advance(f, now);
      if (f.alive && f.crouch && !f.wantCrouch) applyCrouch(f, false, this.map); // stand up once there is headroom
      if (f.alive) this.history.record(f.id, now, f.x, f.y, f.z, !!f.crouch); else this.history.forget(f.id);
      if (f.alive && f.z <= KILL_Z) { f.alive = false; f.respawnAt = now; } // fell out of the world: never happens on valid maps
      if (maybeRespawn(f, now, all, this.rand, this.map)) {
        f.crouch = false;
        f.wantCrouch = false; f.sprint = false;
        f.ammo = fullAmmo();
        f.reloadUntil = 0;
        f.streak = 0;
      }
    }
    out.push(...this.stepRockets(now));
    // Airstrikes: wait for a live target, track it until lock-on, then the bombs fall in a short line.
    for (const st of this.strikes) {
      if (!Number.isFinite(st.at)) {
        if (!this.aimStrike(st, now) && now >= st.giveUpAt) {
          st.at = now; // nobody to hit: drop on the original aim point so the call isn't wasted silently
          st.bombs = [{ dx: 0, dy: 0, dt: 0 }];
        }
        continue;
      }
      if (st.trackId && now < st.lockAt) {
        const t = this.fighters.get(st.trackId);
        if (t?.alive) { st.x = t.x; st.y = t.y; }
      }
    }
    const done: Strike[] = [];
    for (const st of this.strikes) {
      if (!Number.isFinite(st.at) || now < st.at) continue;
      const left: Strike['bombs'] = [];
      for (const b of st.bombs) {
        if (now < st.at + b.dt) { left.push(b); continue; }
        const bx = Math.min(this.map.w - 0.6, Math.max(0.6, st.x + b.dx));
        const by = Math.min(this.map.d - 0.6, Math.max(0.6, st.y + b.dy));
        // Bombs fall from the sky, so they burst on the highest surface there (a roof or catwalk shields people under it).
        const bz = roofAt(bx, by, this.map);
        out.push({ ev: 'fps_boom', data: { x: +bx.toFixed(2), y: +by.toFixed(2), z: +bz.toFixed(2), r: AIRSTRIKE_RADIUS, cause: 'airstrike' } });
        const live = [...this.fighters.values()].filter((f) => f.id !== st.ownerId);
        for (const v of splashTargets({ x: bx, y: by, z: bz }, AIRSTRIKE_RADIUS, AIRSTRIKE_DAMAGE, live, this.map)) out.push(...this.damage(st.ownerId, v.id, v.damage, now, 'airstrike'));
      }
      st.bombs = left;
      if (!left.length) done.push(st);
    }
    if (done.length) this.strikes = this.strikes.filter((x) => !done.includes(x));
    // Drones shoot the nearest visible enemy.
    for (const [id, d] of this.drones) {
      if (now >= d.until || !this.fighters.has(id)) {
        this.drones.delete(id);
        continue;
      }
      if (now - d.lastShot < DRONE_COOLDOWN_MS) continue;
      const pos = this.dronePos(d, now);
      if (!pos) continue;
      let best: ArenaFighter | null = null;
      let bestD = DRONE_RANGE;
      for (const t of all) {
        if (t.id === id || !t.alive) continue;
        const dist = Math.hypot(t.x - pos.x, t.y - pos.y);
        if (dist >= bestD) continue;
        if (!lineOfSight(pos, chestOf(t), this.map)) continue;
        best = t;
        bestD = dist;
      }
      if (!best) continue;
      d.lastShot = now;
      out.push({ ev: 'fps_drone_shot', data: { ownerId: id, target: best.id } });
      out.push(...this.damage(id, best.id, DRONE_DAMAGE, now, 'drone'));
    }
    // The nuke ends the round.
    if (this.nuke && now >= this.nuke.at) {
      const by = this.nuke.by;
      this.nuke = null;
      for (const f of all) if (f.alive) out.push(...this.damage(null, f.id, 9999, now, 'nuke'));
      for (const f of all) {
        f.kills = 0;
        f.deaths = 0;
        f.streak = 0;
        f.uavUntil = 0;
        f.respawnAt = now + NUKE_RESPAWN_MS;
      }
      this.strikes = [];
      this.drones.clear();
      out.push({ ev: 'fps_nuke', data: { phase: 'boom', by } });
    }
    // Match over: load the picked map, or the next one in rotation.
    if (this.matchEndsAt && now >= this.matchEndsAt && !this.nuke) {
      try { this.onMatchEnd?.(this.matchResult(now)); } catch (e) { console.error('[arena] match-end hook failed:', (e as Error).message); }
      out.push(...this.changeMap(MAPS[this.upcomingMapId], now));
    }
    return out;
  }

  /**
   * What one client may know. Enemies out of sight (plus a short linger) lose position, aim, health and weapon:
   * they only appear in `roster` (name and score, for the scoreboard). While the viewer's UAV is up, hidden
   * enemies show on `radar` as coarse x/y only, which is what the UAV gives legitimately.
   */
  snapshotFor(viewerId: string, now: number, full = this.snapshot(now)) {
    const v = this.fighters.get(viewerId);
    if (!v) return { ...full, players: [], roster: full.players.map((p) => ({ id: p.id, name: p.name, k: p.k, d: p.d, st: p.st, ...(p.bot ? { bot: true } : {}) })) };
    const wh = this.hasPerk(viewerId, 'wallhack');
    if (wh) return { ...full, roster: [] as Array<{ id: string; name: string; k: number; d: number; st: number; bot?: boolean }>, radar: undefined as Array<{ x: number; y: number }> | undefined, wh: true };
    const seen = this.vis.visible(viewerId, v, [...this.fighters.values()], this.map, now);
    const players: typeof full.players = [];
    const roster: Array<{ id: string; name: string; k: number; d: number; st: number; bot?: boolean }> = [];
    const radar: Array<{ x: number; y: number }> = [];
    const uav = v.uavUntil > now;
    for (const p of full.players) {
      if (seen.has(p.id)) { players.push(p); continue; }
      roster.push({ id: p.id, name: p.name, k: p.k, d: p.d, st: p.st, ...(p.bot ? { bot: true } : {}) });
      if (uav && p.alive) radar.push({ x: Math.round(p.x), y: Math.round(p.y) });
    }
    return { ...full, players, roster, ...(uav ? { radar } : {}) };
  }

  /** A shot event as seen by `viewerId`: a hidden shooter only gives away a coarse origin (for sound), no tracer rays. */
  shotFor(viewerId: string, data: Record<string, unknown>, now: number): Record<string, unknown> {
    const sid = data.id as string;
    if (sid === viewerId || this.hasPerk(viewerId, 'wallhack')) return data;
    const v = this.fighters.get(viewerId);
    const s = this.fighters.get(sid);
    if (v && s && this.vis.visible(viewerId, v, [s], this.map, now).has(sid)) return data;
    const o = data.o as number[] | undefined;
    return { id: sid, w: data.w, coarse: true, ...(o ? { o: [coarse(o[0]), coarse(o[1]), coarse(o[2])] } : {}), ...(data.rocket ? { rocket: data.rocket } : {}) };
  }

  snapshot(now: number) {
    return {
      t: now,
      players: [...this.fighters.values()].map((f) => ({
        id: f.id, name: f.name, x: +f.x.toFixed(3), y: +f.y.toFixed(3), z: +f.z.toFixed(3), a: +f.a.toFixed(3), p: +f.p.toFixed(3),
        hp: f.hp, k: f.kills, d: f.deaths, alive: f.alive, ...(f.id.startsWith('arena-bot-') ? { bot: true } : {}), w: f.weapon, ammo: f.ammo[f.weapon],
        rl: f.reloadUntil ? Math.max(0, f.reloadUntil - now) : 0, g: f.grounded, ...(f.crouch ? { c: true } : {}), ...(f.sprint ? { s: true } : {}),
        st: f.streak, uav: Math.max(0, f.uavUntil - now), ...(this.skins.get(f.id)?.[f.weapon] ? { sk: this.skins.get(f.id)![f.weapon] } : {}),
      })),
      drones: [...this.drones.values()].flatMap((d) => {
        const p = this.dronePos(d, now);
        return p ? [{ ownerId: d.ownerId, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: p.z, left: d.until - now }] : [];
      }),
      map: this.map.id,
      next: this.upcomingMapId,
      picked: this.nextMapId !== null,
      left: this.matchEndsAt ? Math.max(0, this.matchEndsAt - now) : MATCH_MS,
      strikes: this.strikes.map((s) => ({ x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +roofAt(s.x, s.y, this.map).toFixed(2), inMs: Number.isFinite(s.at) ? Math.max(0, s.at - now) : -1, r: AIRSTRIKE_RADIUS, locked: now >= s.lockAt })),
      rockets: this.rockets.map((r) => this.rocketView(r)),
      nuke: this.nuke ? { by: this.nuke.by, inMs: this.nuke.at - now } : null,
    };
  }
}
