/**
 * Team game modes for the arena: Search & Destroy and Capture the Flag. Pure and server-authoritative:
 * ArenaWorld owns one TeamMode while a team mode is running and calls into it from join/leave/damage/tick.
 * Deathmatch has no TeamMode (world.modes === null) and behaves exactly as before.
 */
import type { ArenaMap } from '../shared/arenaMaps.js';
import { canStand, groundAt, openSpots, spawnClear, type Fighter } from '../shared/fps.js';
import {
  BOMB_BLAST_R, BOMB_PICKUP_R, CTF_MS, CTF_WIN_CAPS, DEFUSE_R, FLAG_R, FLAG_RETURN_MS, HOLD_SLIP, SITE_R, SND_BOMB_MS, SND_DEFUSE_MS,
  SND_JOIN_GRACE_MS, SND_MAX_ROUNDS, SND_PLANT_MS, SND_POST_MS, SND_ROUND_MS, SND_START_GRACE_MS, SND_WIN_ROUNDS, TEAM_NAMES,
  type ModeId, type ModeView, type TeamId,
} from '../shared/arenaModes.js';

type Ev = { ev: string; data: Record<string, unknown>; to?: string };
type P3 = { x: number; y: number; z: number };
export type ModeFighter = Fighter & { shotAt?: number };

export interface ModeHost {
  fighters: Map<string, ModeFighter>;
  map: ArenaMap;
  isBot(id: string): boolean;
  /** Deal damage through the world's normal damage path (kill feed, bounties, killcam). */
  hurt(byId: string | null, targetId: string, amount: number, now: number, cause: string): Ev[];
  /** A survivor carried into the next round: back to spawn with full health/ammo, same paid life. */
  refresh(f: ModeFighter, now: number, at: [number, number, number]): void;
}

const d2 = (a: P3, b: P3) => Math.hypot(a.x - b.x, a.y - b.y);
const d3 = (a: P3, b: P3) => Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.6);

/** Nearest open standing spot to (x,y) (objectives are always placed where a player can stand). */
export function snapSpot(map: ArenaMap, x: number, y: number, spots = openSpots(map)): P3 {
  const z0 = groundAt(x, y, 0.5, map);
  if (canStand(x, y, z0, map) && z0 < 0.5) return { x, y, z: z0 };
  let best = spots[0] ?? [map.w / 2, map.d / 2, 0];
  let bd = Infinity;
  for (const s of spots) {
    const d = Math.hypot(s[0] - x, s[1] - y) + s[2] * 3; // prefer ground level
    if (d < bd) { bd = d; best = s; }
  }
  return { x: best[0], y: best[1], z: best[2] };
}

export interface ModeLayout {
  /** Spawn pools: [0] = west half (x < w/2), [1] = east half. */
  sides: [Array<[number, number, number]>, Array<[number, number, number]>];
  /** Flag bases: [0] west, [1] east. */
  bases: [P3, P3];
  /** Bomb sites on the east (defender) side. */
  sites: Array<P3 & { id: 'A' | 'B' }>;
}

/** Objective placement derived from any map's geometry, so every map (and future ones) supports every mode. */
export function layoutFor(map: ArenaMap): ModeLayout {
  const spots = openSpots(map);
  const mid = map.w / 2;
  const west = map.spawns.filter((s) => s[0] < mid);
  const east = map.spawns.filter((s) => s[0] >= mid);
  const fill = (pool: Array<[number, number, number]>, lo: number, hi: number) => (pool.length >= 2 ? pool : [...pool, ...spots.filter((s) => s[0] >= lo && s[0] <= hi && s[2] < 0.5)].slice(0, 8));
  const sides: ModeLayout['sides'] = [fill(west, 0, map.w * 0.25), fill(east, map.w * 0.75, map.w)];
  const cent = (pool: Array<[number, number, number]>, fx: number) => pool.length ? snapSpot(map, pool.reduce((a, s) => a + s[0], 0) / pool.length, pool.reduce((a, s) => a + s[1], 0) / pool.length, spots) : snapSpot(map, map.w * fx, map.d / 2, spots);
  const bases: ModeLayout['bases'] = [cent(sides[0], 0.1), cent(sides[1], 0.9)];
  const sites = [
    { id: 'A' as const, ...snapSpot(map, map.w * 0.68, map.d * 0.22, spots) },
    { id: 'B' as const, ...snapSpot(map, map.w * 0.68, map.d * 0.78, spots) },
  ];
  return { sides, bases, sites };
}

interface Bomb { state: 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded' | 'none'; x: number; y: number; z: number; carrier?: string; site?: 'A' | 'B'; plantedAt?: number; planter?: string }
interface Hold { id: string; kind: 'plant' | 'defuse'; since: number; x: number; y: number; site?: 'A' | 'B' }
interface Flag { team: TeamId; state: 'home' | 'carried' | 'dropped'; x: number; y: number; z: number; carrier?: string; droppedAt?: number }

export class TeamMode {
  readonly team = new Map<string, TeamId>();
  score: [number, number] = [0, 0];
  readonly obj = new Map<string, number>();
  layout: ModeLayout;
  over: { winner: TeamId | null } | null = null;
  // S&D
  round = 0;
  attackers: TeamId = 0;
  roundPhase: 'live' | 'planted' | 'post' = 'live';
  roundStart = 0;
  roundEndsAt = 0;
  postUntil = 0;
  bomb: Bomb = { state: 'none', x: 0, y: 0, z: 0 };
  hold: Hold | null = null;
  lastWinner?: TeamId;
  lastReason?: string;
  /** Fighters allowed one (paid) spawn this round. */
  readonly spawnOk = new Set<string>();
  // CTF
  flags: [Flag, Flag];
  endsAt = 0;

  constructor(readonly mode: Exclude<ModeId, 'dm'>, map: ArenaMap, private rand: () => number = Math.random) {
    this.layout = layoutFor(map);
    this.flags = [this.homeFlag(0), this.homeFlag(1)];
  }

  private homeFlag(t: TeamId): Flag { const b = this.layout.bases[t]; return { team: t, state: 'home', x: b.x, y: b.y, z: b.z }; }
  teamOf(id: string): TeamId | undefined { return this.team.get(id); }
  enemies(a: string, b: string): boolean { const ta = this.team.get(a); const tb = this.team.get(b); return ta === undefined || tb === undefined || ta !== tb; }
  friendly(a: string | null, b: string): boolean { return !!a && a !== b && !this.enemies(a, b); }
  private credit(id: string | undefined) { if (id) this.obj.set(id, (this.obj.get(id) ?? 0) + 1); }
  size(t: TeamId): number { let n = 0; for (const v of this.team.values()) if (v === t) n++; return n; }

  /** Puts a newcomer on the smaller team (fewer humans breaks ties, then random). */
  assign(id: string, host: ModeHost): TeamId {
    const have = this.team.get(id);
    if (have !== undefined) return have;
    const humans = (t: TeamId) => [...this.team].filter(([k, v]) => v === t && !host.isBot(k)).length;
    const s0 = this.size(0); const s1 = this.size(1);
    let t: TeamId = s0 < s1 ? 0 : s1 < s0 ? 1 : humans(0) < humans(1) ? 0 : humans(1) < humans(0) ? 1 : this.rand() < 0.5 ? 0 : 1;
    if (!host.isBot(id) && humans(t) > humans(t === 0 ? 1 : 0)) t = t === 0 ? 1 : 0; // never stack humans while a bot can move over
    this.team.set(id, t);
    if (this.mode === 'snd' && this.roundPhase !== 'post') this.spawnOk.add(id);
    return t;
  }

  /** Fresh, balanced teams: humans alternate, then bots fill whichever side is short. */
  balance(host: ModeHost): void {
    this.team.clear();
    const ids = [...host.fighters.keys()];
    const humans = ids.filter((i) => !host.isBot(i));
    const bots = ids.filter((i) => host.isBot(i));
    const start: TeamId = this.rand() < 0.5 ? 0 : 1;
    humans.forEach((h, i) => this.team.set(h, ((i + start) % 2) as TeamId));
    for (const b of bots) this.team.set(b, this.size(0) <= this.size(1) ? 0 : 1);
  }

  leave(id: string, host: ModeHost): void {
    const f = host.fighters.get(id);
    if (f) this.dropAll(f, 0);
    this.team.delete(id);
    this.spawnOk.delete(id);
    if (this.hold?.id === id) this.hold = null;
  }

  /** Spawn side: CTF teams keep their half; in S&D the attackers spawn west, defenders east (sides swap at halftime). */
  sideOf(t: TeamId): 0 | 1 { return this.mode === 'snd' ? (t === this.attackers ? 0 : 1) : t; }
  spawnPoint(f: ModeFighter, host: ModeHost): [number, number, number] {
    const t = this.team.get(f.id) ?? 0;
    const pool = this.layout.sides[this.sideOf(t)];
    const others = [...host.fighters.values()].filter((o) => o.id !== f.id);
    const enemies = others.filter((o) => o.alive && this.enemies(f.id, o.id));
    const clear = pool.filter((s) => spawnClear(s[0], s[1], others, host.map, s[2]));
    const list = clear.length ? clear : pool;
    let best = list[Math.floor(this.rand() * list.length)] ?? [host.map.w / 2, host.map.d / 2, 0];
    if (enemies.length && clear.length > 1) {
      let bd = -1;
      for (const s of clear) { const d = Math.min(...enemies.map((e) => Math.hypot(e.x - s[0], e.y - s[1]))) + this.rand(); if (d > bd) { bd = d; best = s; } }
    }
    return [best[0], best[1], best[2]];
  }

  /** May this dead fighter (re)spawn now? CTF: always. S&D: once per round, early in the round. */
  mayRespawn(f: ModeFighter, now: number): boolean {
    if (this.over) return false;
    if (this.mode === 'ctf') return true;
    return this.roundPhase === 'live' && this.spawnOk.has(f.id) && now < this.roundStart + SND_JOIN_GRACE_MS;
  }
  spawned(f: ModeFighter): void { this.spawnOk.delete(f.id); }

  /** Called when someone dies (or leaves): they drop whatever objective they carry. */
  onDeath(f: ModeFighter, now: number): void { this.dropAll(f, now); if (this.hold?.id === f.id) this.hold = null; }
  private dropAll(f: ModeFighter, now: number): void {
    if (this.bomb.state === 'carried' && this.bomb.carrier === f.id) Object.assign(this.bomb, { state: 'dropped', carrier: undefined, x: f.x, y: f.y, z: f.z });
    for (const fl of this.flags) if (fl.state === 'carried' && fl.carrier === f.id) Object.assign(fl, { state: 'dropped', carrier: undefined, x: f.x, y: f.y, z: f.z, droppedAt: now });
  }

  start(now: number, host: ModeHost): Ev[] {
    this.score = [0, 0];
    this.obj.clear();
    this.over = null;
    this.balance(host);
    if (this.mode === 'ctf') {
      this.endsAt = now + CTF_MS;
      this.flags = [this.homeFlag(0), this.homeFlag(1)];
      for (const f of host.fighters.values()) if (f.alive) host.refresh(f, now, this.spawnPoint(f, host));
      return [];
    }
    this.round = 0;
    this.attackers = this.rand() < 0.5 ? 0 : 1;
    return this.startRound(now, host);
  }

  private startRound(now: number, host: ModeHost): Ev[] {
    this.round += 1;
    if (this.round === SND_WIN_ROUNDS) this.attackers = this.attackers === 0 ? 1 : 0; // halftime (after round 3): swap sides
    this.roundPhase = 'live';
    this.roundStart = now;
    this.roundEndsAt = now + SND_ROUND_MS;
    this.hold = null;
    this.bomb = { state: 'none', x: 0, y: 0, z: 0 };
    this.spawnOk.clear();
    const placed: ModeFighter[] = [];
    for (const f of host.fighters.values()) {
      if (!this.team.has(f.id)) this.assign(f.id, host);
      if (f.alive) { const at = this.spawnPoint(f, host); host.refresh(f, now, at); placed.push(f); }
      else { this.spawnOk.add(f.id); f.respawnAt = Math.min(f.respawnAt, now); }
    }
    this.giveBomb(host);
    return [{ ev: 'fps_mode', data: { kind: 'round', round: this.round, attackers: this.attackers, score: this.score } }];
  }

  private giveBomb(host: ModeHost): void {
    if (this.bomb.state !== 'none') return;
    const att = [...host.fighters.values()].filter((f) => f.alive && this.team.get(f.id) === this.attackers);
    if (!att.length) return;
    const c = att.find((f) => !host.isBot(f.id)) ?? att[0]; // a human attacker carries if there is one
    this.bomb = { state: 'carried', carrier: c.id, x: c.x, y: c.y, z: c.z };
  }

  private alive(t: TeamId, host: ModeHost): number { let n = 0; for (const f of host.fighters.values()) if (f.alive && this.team.get(f.id) === t) n++; return n; }
  private pending(t: TeamId, now: number, host: ModeHost): number {
    if (now >= this.roundStart + SND_JOIN_GRACE_MS) return 0;
    let n = 0;
    for (const f of host.fighters.values()) if (!f.alive && this.spawnOk.has(f.id) && this.team.get(f.id) === t && (host.isBot(f.id) || now < this.roundStart + SND_START_GRACE_MS)) n++;
    return n;
  }

  private endRound(winner: TeamId, reason: string, now: number): Ev[] {
    this.score[winner] += 1;
    this.roundPhase = 'post';
    this.postUntil = now + SND_POST_MS;
    this.hold = null;
    this.lastWinner = winner;
    this.lastReason = reason;
    if (this.score[winner] >= SND_WIN_ROUNDS || this.round >= SND_MAX_ROUNDS) this.over = { winner: this.score[0] === this.score[1] ? null : this.score[0] > this.score[1] ? 0 : 1 };
    return [{ ev: 'fps_mode', data: { kind: 'round_end', winner, team: TEAM_NAMES[winner], reason, score: this.score, round: this.round } }];
  }

  /** Is this fighter currently standing still inside its hold zone? */
  private holding(f: ModeFighter, h: Hold): boolean { return f.alive && Math.hypot(f.x - h.x, f.y - h.y) <= HOLD_SLIP && (f.shotAt ?? 0) <= h.since; }

  step(now: number, host: ModeHost): Ev[] {
    if (this.over) return [];
    return this.mode === 'snd' ? this.stepSnd(now, host) : this.stepCtf(now, host);
  }

  private stepSnd(now: number, host: ModeHost): Ev[] {
    const out: Ev[] = [];
    if (this.roundPhase === 'post') return now >= this.postUntil ? this.startRound(now, host) : [];
    const fs = [...host.fighters.values()];
    if (this.bomb.state === 'none') this.giveBomb(host);
    const b = this.bomb;
    if (b.state === 'carried') {
      const c = b.carrier ? host.fighters.get(b.carrier) : undefined;
      if (!c || !c.alive) Object.assign(b, { state: 'dropped', carrier: undefined });
      else Object.assign(b, { x: c.x, y: c.y, z: c.z });
    }
    if (b.state === 'dropped') {
      const p = fs.find((f) => f.alive && this.team.get(f.id) === this.attackers && d3(f, b) <= BOMB_PICKUP_R);
      if (p) Object.assign(b, { state: 'carried', carrier: p.id });
    }
    // Plant / defuse: stand still in the zone for the hold time. Moving away or shooting cancels.
    if (this.hold) {
      const f = host.fighters.get(this.hold.id);
      const valid = f && this.holding(f, this.hold) && (this.hold.kind === 'plant' ? b.state === 'carried' && b.carrier === f.id : b.state === 'planted');
      if (!valid) this.hold = null;
    }
    if (!this.hold) {
      if (b.state === 'carried' && this.roundPhase === 'live') {
        const c = host.fighters.get(b.carrier!)!;
        const site = this.layout.sites.find((s) => d2(c, s) <= SITE_R && Math.abs(c.z - s.z) < 1.2);
        if (site && c.grounded) this.hold = { id: c.id, kind: 'plant', since: now, x: c.x, y: c.y, site: site.id };
      } else if (b.state === 'planted') {
        const d = fs.find((f) => f.alive && f.grounded && this.team.get(f.id) !== this.attackers && d3(f, b) <= DEFUSE_R);
        if (d) this.hold = { id: d.id, kind: 'defuse', since: now, x: d.x, y: d.y };
      }
    }
    if (this.hold?.kind === 'plant' && now - this.hold.since >= SND_PLANT_MS) {
      const c = host.fighters.get(this.hold.id)!;
      Object.assign(b, { state: 'planted', carrier: undefined, x: c.x, y: c.y, z: c.z, site: this.hold.site, plantedAt: now, planter: c.id });
      this.credit(c.id);
      this.roundPhase = 'planted';
      out.push({ ev: 'fps_mode', data: { kind: 'planted', site: this.hold.site, by: c.name, ms: SND_BOMB_MS } });
      this.hold = null;
    } else if (this.hold?.kind === 'defuse' && now - this.hold.since >= SND_DEFUSE_MS) {
      const d = host.fighters.get(this.hold.id)!;
      b.state = 'defused';
      this.credit(d.id);
      out.push({ ev: 'fps_mode', data: { kind: 'defused', by: d.name } });
      return [...out, ...this.endRound(this.attackers === 0 ? 1 : 0, 'defused', now)];
    }
    const defenders: TeamId = this.attackers === 0 ? 1 : 0;
    if (b.state === 'planted' && now >= (b.plantedAt ?? now) + SND_BOMB_MS) {
      b.state = 'exploded';
      out.push({ ev: 'fps_boom', data: { x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2), r: BOMB_BLAST_R, cause: 'bomb' } });
      for (const f of fs) {
        if (!f.alive) continue;
        const dist = Math.hypot(f.x - b.x, f.y - b.y, f.z - b.z);
        if (dist < BOMB_BLAST_R) out.push(...host.hurt(host.fighters.has(b.planter ?? '') && this.enemies(b.planter!, f.id) ? b.planter! : null, f.id, 9999, now, 'bomb'));
      }
      return [...out, ...this.endRound(this.attackers, 'detonated', now)];
    }
    if (now < this.roundStart + SND_START_GRACE_MS) return out;
    const aAlive = this.alive(this.attackers, host) + this.pending(this.attackers, now, host);
    const dAlive = this.alive(defenders, host) + this.pending(defenders, now, host);
    if (b.state !== 'planted' && aAlive === 0 && this.size(this.attackers) > 0) return [...out, ...this.endRound(defenders, 'eliminated', now)];
    if (dAlive === 0 && this.size(defenders) > 0) return [...out, ...this.endRound(this.attackers, 'eliminated', now)];
    if (b.state !== 'planted' && now >= this.roundEndsAt) return [...out, ...this.endRound(defenders, 'time', now)];
    return out;
  }

  private stepCtf(now: number, host: ModeHost): Ev[] {
    const out: Ev[] = [];
    const fs = [...host.fighters.values()];
    for (const fl of this.flags) {
      if (fl.state === 'carried') {
        const c = fl.carrier ? host.fighters.get(fl.carrier) : undefined;
        if (!c || !c.alive) Object.assign(fl, { state: 'dropped', carrier: undefined, droppedAt: now });
        else Object.assign(fl, { x: c.x, y: c.y, z: c.z });
      }
      if (fl.state === 'dropped' && now >= (fl.droppedAt ?? now) + FLAG_RETURN_MS) {
        Object.assign(fl, this.homeFlag(fl.team));
        out.push({ ev: 'fps_mode', data: { kind: 'flag_return', team: fl.team, auto: true } });
      }
    }
    for (const f of fs) {
      if (!f.alive) continue;
      const t = this.team.get(f.id);
      if (t === undefined) continue;
      const mine = this.flags[t];
      const theirs = this.flags[t === 0 ? 1 : 0];
      if (mine.state === 'dropped' && d3(f, mine) <= FLAG_R) {
        Object.assign(mine, this.homeFlag(t));
        this.credit(f.id);
        out.push({ ev: 'fps_mode', data: { kind: 'flag_return', team: t, by: f.name } });
      }
      if (theirs.state !== 'carried' && d3(f, theirs) <= FLAG_R) {
        Object.assign(theirs, { state: 'carried', carrier: f.id, droppedAt: undefined });
        out.push({ ev: 'fps_mode', data: { kind: 'flag_take', team: theirs.team, by: f.name } });
      }
      if (theirs.state === 'carried' && theirs.carrier === f.id && mine.state === 'home' && d3(f, this.layout.bases[t]) <= FLAG_R) {
        Object.assign(theirs, this.homeFlag(theirs.team));
        this.score[t] += 1;
        this.credit(f.id);
        out.push({ ev: 'fps_mode', data: { kind: 'capture', team: t, by: f.name, score: this.score } });
        if (this.score[t] >= CTF_WIN_CAPS) { this.over = { winner: t }; return out; }
      }
    }
    if (now >= this.endsAt) this.over = { winner: this.score[0] === this.score[1] ? null : this.score[0] > this.score[1] ? 0 : 1 };
    return out;
  }

  /** Where a bot on this team should head when no enemy is in sight (null = roam). */
  botGoal(f: ModeFighter): P3 | null {
    const t = this.team.get(f.id);
    if (t === undefined) return null;
    if (this.mode === 'ctf') {
      const mine = this.flags[t];
      const theirs = this.flags[t === 0 ? 1 : 0];
      if (theirs.carrier === f.id) return this.layout.bases[t];
      if (mine.state === 'dropped') return mine;
      if (mine.state === 'carried') return mine; // chase our flag carrier
      return theirs.state === 'carried' ? this.layout.bases[t] : theirs;
    }
    if (this.roundPhase === 'post') return null;
    const b = this.bomb;
    const site = this.layout.sites[f.id.charCodeAt(f.id.length - 1) % 2];
    if (t === this.attackers) {
      if (b.state === 'carried' && b.carrier === f.id) return this.layout.sites.find((s) => s.id === (b.site ?? site.id)) ?? site;
      if (b.state === 'dropped') return b;
      if (b.state === 'planted') return b;
      return site;
    }
    return b.state === 'planted' ? b : site;
  }
  /** True while this fighter must stand still (planting/defusing) — bots stop moving. */
  isHolding(id: string): boolean { return this.hold?.id === id; }

  view(now: number, host: ModeHost): ModeView {
    const tm: Record<string, TeamId> = {};
    for (const [k, v] of this.team) tm[k] = v;
    const alive: [number, number] = [this.alive(0, host), this.alive(1, host)];
    const base: ModeView = { mode: this.mode, tm, teams: { score: [...this.score] as [number, number], size: [this.size(0), this.size(1)], alive } };
    const r = (n: number) => +n.toFixed(2);
    if (this.mode === 'ctf') {
      return { ...base, ctf: {
        left: Math.max(0, this.endsAt - now),
        flags: this.flags.map((fl) => ({ team: fl.team, state: fl.state, x: r(fl.x), y: r(fl.y), z: r(fl.z), ...(fl.carrier ? { carrier: fl.carrier } : {}), ...(fl.state === 'dropped' ? { returnIn: Math.max(0, (fl.droppedAt ?? now) + FLAG_RETURN_MS - now) } : {}) })),
        bases: this.layout.bases.map((b) => ({ x: r(b.x), y: r(b.y), z: r(b.z) })),
      } };
    }
    const b = this.bomb;
    const left = this.roundPhase === 'post' ? Math.max(0, this.postUntil - now) : b.state === 'planted' ? Math.max(0, (b.plantedAt ?? now) + SND_BOMB_MS - now) : Math.max(0, this.roundEndsAt - now);
    return { ...base, snd: {
      round: this.round, attackers: this.attackers, phase: this.roundPhase, left,
      sites: this.layout.sites.map((s) => ({ id: s.id, x: r(s.x), y: r(s.y), z: r(s.z), r: SITE_R })),
      bomb: { state: b.state, x: r(b.x), y: r(b.y), z: r(b.z), ...(b.carrier ? { carrier: b.carrier } : {}), ...(b.site ? { site: b.site } : {}), ...(b.state === 'planted' ? { left: Math.max(0, (b.plantedAt ?? now) + SND_BOMB_MS - now) } : {}) },
      ...(this.hold ? { hold: { id: this.hold.id, kind: this.hold.kind, pct: Math.min(1, (now - this.hold.since) / (this.hold.kind === 'plant' ? SND_PLANT_MS : SND_DEFUSE_MS)) } } : {}),
      ...(this.lastWinner !== undefined ? { lastWinner: this.lastWinner, lastReason: this.lastReason } : {}),
    } };
  }
}
