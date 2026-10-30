/**
 * Server-authoritative arena simulation: weapons, ammo, jumping, killstreaks.
 * Pure (time and randomness are passed in) so tests can drive it directly; server/fps.ts wires it to sockets.
 */
import {
  AIRSTRIKE_DAMAGE, AIRSTRIKE_DELAY_MS, AIRSTRIKE_LOCK_MS, AIRSTRIKE_RADIUS, AIRSTRIKE_RANGE, AIRSTRIKE_SPACING, AIRSTRIKE_WAIT_MS, applyDamage, canJump, castRay,
  DRONE_COOLDOWN_MS, DRONE_DAMAGE, DRONE_MS, DRONE_RANGE, fireWeapon, isWeapon, MAP, MAX_HP, maybeRespawn,
  normAngle, NUKE_DELAY_MS, NUKE_RESPAWN_MS, pickSpawn, SCOPE_SETTLE_MS, splashTargets, STREAKS, streakReward,
  SWITCH_MS, UAV_MS, validateMove, WEAPON_ORDER, WEAPONS, type Fighter, type StreakKind, type WeaponId,
} from '../shared/fps.js';

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
  uavUntil: number;
}

export interface ArenaEvent { ev: string; data: Record<string, unknown> }
/** An airstrike run. It tracks its target (trackId) until lockAt, then the zone is fixed and the bombs fall at `at`. */
interface Strike { ownerId: string; x: number; y: number; at: number; trackId: string | null; lockAt: number; giveUpAt: number; bombs: Array<{ dx: number; dy: number; dt: number }> }
interface Drone { ownerId: string; until: number; lastShot: number }

const fullAmmo = () => Object.fromEntries(WEAPON_ORDER.map((w) => [w, WEAPONS[w].mag])) as Record<WeaponId, number>;
const zeroShots = () => Object.fromEntries(WEAPON_ORDER.map((w) => [w, -1e9])) as Record<WeaponId, number>;

export class ArenaWorld {
  readonly fighters = new Map<string, ArenaFighter>();
  strikes: Strike[] = [];
  drones = new Map<string, Drone>();
  nuke: { ownerId: string; by: string; at: number } | null = null;

  constructor(private map: string[] = MAP, private rand: () => number = Math.random) {}

  join(id: string, name: string, now: number): ArenaFighter {
    const existing = this.fighters.get(id);
    if (existing) return existing;
    const [x, y] = pickSpawn([...this.fighters.values()], this.rand, this.map);
    const f: ArenaFighter = {
      id, name, x, y, a: this.rand() * Math.PI * 2, hp: MAX_HP, kills: 0, deaths: 0, alive: true, respawnAt: 0,
      lastShot: 0, lastMove: now, weapon: 'pistol', ammo: fullAmmo(), lastShotAt: zeroShots(), reloadUntil: 0,
      switchedAt: -1e9, scopedSince: 0, jumpAt: -1e9, streak: 0, uavUntil: 0,
    };
    this.fighters.set(id, f);
    return f;
  }

  leave(id: string): boolean {
    this.drones.delete(id);
    this.strikes = this.strikes.filter((s) => s.ownerId !== id);
    return this.fighters.delete(id);
  }

  move(id: string, x: unknown, y: unknown, a: unknown, now: number): void {
    const f = this.fighters.get(id);
    if (!f || !f.alive) return;
    if (now - f.lastMove < 25) return; // ~40 Hz max
    const pos = validateMove(f, x, y, now - f.lastMove, this.map);
    f.lastMove = now;
    f.x = pos.x;
    f.y = pos.y;
    const na = normAngle(a);
    if (na !== null) f.a = na;
  }

  /** Space bar. Rejected while airborne / landing so it can't be spammed. */
  jump(id: string, now: number): ArenaEvent[] {
    const f = this.fighters.get(id);
    if (!f || !f.alive || !canJump(f.jumpAt, now)) return [];
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

  shoot(id: string, a: unknown, now: number): ArenaEvent[] {
    const f = this.fighters.get(id);
    if (!f || !f.alive) return [];
    const spec = WEAPONS[f.weapon];
    this.settleReload(f, now);
    if (f.reloadUntil) return [];
    if (now - f.switchedAt < SWITCH_MS) return [];
    if (now - f.lastShotAt[f.weapon] < spec.cooldownMs - FIRE_JITTER_MS) return [];
    if (f.ammo[f.weapon] <= 0) {
      this.reload(id, now);
      return [];
    }
    const na = normAngle(a);
    if (na !== null) f.a = na;
    f.lastShotAt[f.weapon] = now;
    f.lastShot = now;
    f.ammo[f.weapon] -= 1;
    if (f.ammo[f.weapon] === 0) f.reloadUntil = now + spec.reloadMs;
    const scoped = f.weapon === 'sniper' && f.scopedSince > 0 && now - f.scopedSince >= SCOPE_SETTLE_MS;
    const shot = fireWeapon(f, spec, [...this.fighters.values()], { scoped, rand: this.rand, map: this.map });
    const events: ArenaEvent[] = [{
      ev: 'fps_shot',
      data: { id: f.id, w: f.weapon, rays: shot.rays.map((r) => [+r.a.toFixed(3), +r.dist.toFixed(2)]), impact: shot.impact },
    }];
    for (const [tid, dmg] of shot.hits) events.push(...this.damage(f.id, tid, dmg, now, f.weapon));
    return events;
  }

  /** Applies damage from attacker (may be absent for the nuke) and handles kills and streaks. */
  private damage(byId: string | null, targetId: string, amount: number, now: number, cause: string): ArenaEvent[] {
    const t = this.fighters.get(targetId);
    if (!t || !t.alive) return [];
    const killed = applyDamage(t, now, amount);
    const out: ArenaEvent[] = [{ ev: 'fps_hit', data: { by: byId, target: targetId, hp: t.hp, dmg: amount, cause } }];
    if (!killed) return out;
    t.streak = 0;
    const killer = byId ? this.fighters.get(byId) : undefined;
    out.push({ ev: 'fps_kill', data: { killer: killer?.name ?? '☢', victim: t.name, killerId: byId, victimId: t.id, cause } });
    if (killer && killer.id !== t.id && cause !== 'nuke') {
      killer.kills += 1;
      killer.streak += 1;
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
      const d = Math.max(0, castRay(f.x, f.y, f.a, this.map, AIRSTRIKE_RANGE).dist - 0.3);
      const s: Strike = { ownerId: f.id, x: f.x + Math.cos(f.a) * d, y: f.y + Math.sin(f.a) * d, at: Infinity, trackId: null, lockAt: 0, giveUpAt: now + AIRSTRIKE_WAIT_MS, bombs: [] };
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

  dronePos(d: Drone, now: number): { x: number; y: number } | null {
    const o = this.fighters.get(d.ownerId);
    if (!o) return null;
    const t = now / 700;
    const ox = o.x + Math.cos(t) * 0.55;
    const oy = o.y + Math.sin(t) * 0.55;
    return castRay(o.x, o.y, Math.atan2(oy - o.y, ox - o.x), this.map, 0.6).dist >= 0.55 ? { x: ox, y: oy } : { x: o.x, y: o.y };
  }

  tick(now: number): ArenaEvent[] {
    const out: ArenaEvent[] = [];
    const all = [...this.fighters.values()];
    for (const f of all) {
      this.settleReload(f, now);
      if (maybeRespawn(f, now, all, this.rand, this.map)) {
        f.ammo = fullAmmo();
        f.reloadUntil = 0;
        f.streak = 0;
      }
    }
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
        const bx = Math.min(this.map[0].length - 1.2, Math.max(1.2, st.x + b.dx));
        const by = Math.min(this.map.length - 1.2, Math.max(1.2, st.y + b.dy));
        out.push({ ev: 'fps_boom', data: { x: +bx.toFixed(2), y: +by.toFixed(2), r: AIRSTRIKE_RADIUS, cause: 'airstrike' } });
        const live = [...this.fighters.values()].filter((f) => f.id !== st.ownerId);
        for (const v of splashTargets(bx, by, AIRSTRIKE_RADIUS, AIRSTRIKE_DAMAGE, live, this.map)) out.push(...this.damage(st.ownerId, v.id, v.damage, now, 'airstrike'));
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
        if (castRay(pos.x, pos.y, Math.atan2(t.y - pos.y, t.x - pos.x), this.map, dist).dist < dist - 0.05) continue;
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
    return out;
  }

  snapshot(now: number) {
    return {
      t: now,
      players: [...this.fighters.values()].map((f) => ({
        id: f.id, name: f.name, x: +f.x.toFixed(3), y: +f.y.toFixed(3), a: +f.a.toFixed(3),
        hp: f.hp, k: f.kills, d: f.deaths, alive: f.alive, w: f.weapon, ammo: f.ammo[f.weapon],
        rl: f.reloadUntil ? Math.max(0, f.reloadUntil - now) : 0, j: Math.min(9999, now - f.jumpAt),
        st: f.streak, uav: Math.max(0, f.uavUntil - now),
      })),
      drones: [...this.drones.values()].flatMap((d) => {
        const p = this.dronePos(d, now);
        return p ? [{ ownerId: d.ownerId, x: +p.x.toFixed(2), y: +p.y.toFixed(2), left: d.until - now }] : [];
      }),
      strikes: this.strikes.map((s) => ({ x: +s.x.toFixed(2), y: +s.y.toFixed(2), inMs: Number.isFinite(s.at) ? Math.max(0, s.at - now) : -1, r: AIRSTRIKE_RADIUS, locked: now >= s.lockAt })),
      nuke: this.nuke ? { by: this.nuke.by, inMs: this.nuke.at - now } : null,
    };
  }
}
