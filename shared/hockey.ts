/**
 * PvP Hockey (Millionaire Update). Pure, deterministic, server-authoritative simulation shared by the server
 * (authority) and the client (rendering constants). Units: metres, seconds. +x = rink length, team 0 attacks +x.
 *
 * One shared rink like the Arena: each human controls one skater (or the goalie if that spot is open) and bots fill
 * every empty slot, so a match always runs 4 v 4 (1 goalie + 3 skaters a side).
 */

export const HK_TICK_HZ = 30;
export const HK_DT = 1 / HK_TICK_HZ;
/** Rink: 60 x 26 with rounded corners (scaled-down NHL proportions so a 4v4 feels busy). */
export const RINK_HALF_L = 30;
export const RINK_HALF_W = 13;
export const CORNER_R = 7;
/** Goal line distance from centre, goal mouth half-width, net depth. */
export const GOAL_X = 26;
export const GOAL_HALF = 1.5;
export const NET_DEPTH = 1.1;
export const BLUE_X = 8.5;
export const CREASE_R = 1.8;

export const SKATER_R = 0.45;
export const GOALIE_R = 0.75;
export const PUCK_R = 0.12;
export const SKATE_ACCEL = 16;
export const SKATE_MAX = 8.5;
export const CARRY_MAX = 7.6;
export const GOALIE_MAX = 5;
/** Passive glide drag (per second), plus extra braking when input opposes motion. Ice keeps momentum. */
export const SKATE_DRAG = 0.55;
export const BRAKE_DRAG = 3.2;
export const PUCK_DRAG = 0.32;
export const BOARD_BOUNCE = 0.72;
export const SKATER_BOUNCE = 0.25;
export const PICKUP_DIST = 0.75;
/** A puck faster than this can't be picked up (it deflects instead), so hard shots beat skaters. */
export const PICKUP_MAX_SPEED = 19;
export const CARRY_OFFSET = 0.72;
export const SHOT_MIN = 13;
export const SHOT_MAX = 30;
export const PASS_SPEED = 14;
export const SHOOT_COOLDOWN_S = 0.35;
export const POKE_RANGE = 1.25;
export const POKE_COOLDOWN_S = 0.8;

export const PERIODS = 3;
export const PERIOD_S = 150;
export const OT_S = 60;
export const FACEOFF_S = 1.6;
export const GOAL_PAUSE_S = 3.2;
export const INTERMISSION_S = 4;
export const RESULT_S = 12;
export const LOBBY_S = 8;
export const TEAM_SIZE = 4; // 1 goalie + 3 skaters
export const MAX_HUMANS = TEAM_SIZE * 2;

export type HkTeam = 0 | 1;
export type HkRole = 'G' | 'S';
export type HkPhase = 'lobby' | 'faceoff' | 'play' | 'goal' | 'intermission' | 'ended';

export const HK_TEAM_NAMES = ['Chud City Chuds', 'Fort McChud Roughnecks'] as const;
export const HK_TEAM_COLORS = ['#d8202a', '#1f6fd1'] as const;

export interface HkInput { x: number; y: number; aim: number; shoot?: number; pass?: boolean; poke?: boolean }

export interface HkPlayer {
  id: string;
  name: string;
  team: HkTeam;
  role: HkRole;
  slot: number;
  bot: boolean;
  x: number; y: number; vx: number; vy: number; a: number;
  input: HkInput;
  shootCd: number; pokeCd: number; noPickup: number;
  goals: number; assists: number; shots: number; saves: number;
  joinedAt: number; playS: number;
}

export interface HkPuck { x: number; y: number; vx: number; vy: number; carrier: string | null; lastTouch: string | null; prevTouch: string | null; trail: number }

export interface HkEvent { ev: 'hk_goal' | 'hk_save' | 'hk_shot' | 'hk_pass' | 'hk_poke' | 'hk_faceoff' | 'hk_period' | 'hk_end' | 'hk_post'; data: Record<string, unknown> }

export interface HkResult {
  matchId: string;
  score: [number, number];
  winner: HkTeam | null;
  players: Array<{ id: string; name: string; team: HkTeam; role: HkRole; bot: boolean; goals: number; assists: number; shots: number; saves: number; playS: number; account?: string }>;
  stars: string[];
  prize?: { names: string[]; amount: number };
}

/** "2:05" from seconds left. */
export const hkClock = (s: number) => { const t = Math.max(0, Math.ceil(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
export const periodLabel = (p: number) => (p > PERIODS ? 'OT' : ['1st', '2nd', '3rd'][p - 1] ?? `${p}th`);

/** Small deterministic RNG (mulberry32) so a seeded match replays exactly in tests. */
export function hkRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Sanitise an untrusted client input (stick vector clamped to the unit circle, finite numbers only). */
export function cleanInput(raw: unknown): HkInput {
  const b = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  let x = clamp(num(b.x), -1, 1), y = clamp(num(b.y), -1, 1);
  const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
  return { x, y, aim: num(b.aim), shoot: b.shoot === undefined ? undefined : clamp(num(b.shoot), 0, 1), pass: b.pass === true, poke: b.poke === true };
}

/**
 * Keep a circle of radius r inside the rounded-rect rink. Returns the outward normal it hit (or null) and fixes position;
 * the caller reflects velocity.
 */
export function rinkContain(o: { x: number; y: number }, r: number): { nx: number; ny: number } | null {
  const hx = RINK_HALF_L - r, hy = RINK_HALF_W - r, cr = CORNER_R - r;
  const cx = hx - cr, cy = hy - cr;
  const ax = Math.abs(o.x), ay = Math.abs(o.y);
  if (ax > cx && ay > cy) {
    const dx = ax - cx, dy = ay - cy, d = Math.hypot(dx, dy);
    if (d <= cr) return null;
    const nx = (dx / d) * Math.sign(o.x || 1), ny = (dy / d) * Math.sign(o.y || 1);
    o.x = Math.sign(o.x || 1) * (cx + (dx / d) * cr); o.y = Math.sign(o.y || 1) * (cy + (dy / d) * cr);
    return { nx, ny };
  }
  if (ax > hx) { o.x = Math.sign(o.x) * hx; return { nx: Math.sign(o.x), ny: 0 }; }
  if (ay > hy) { o.y = Math.sign(o.y) * hy; return { nx: 0, ny: Math.sign(o.y) }; }
  return null;
}

function reflect(v: { vx: number; vy: number }, n: { nx: number; ny: number }, e: number): void {
  const d = v.vx * n.nx + v.vy * n.ny;
  if (d <= 0) return; // already moving away
  v.vx -= (1 + e) * d * n.nx; v.vy -= (1 + e) * d * n.ny;
}

/** Which goal does a team defend: team 0 defends -x. */
export const ownGoalX = (t: HkTeam) => (t === 0 ? -GOAL_X : GOAL_X);
export const attackGoalX = (t: HkTeam) => -ownGoalX(t);

/** Faceoff spots by slot (0 = goalie). Team 0 on the -x half facing +x. */
export function faceoffSpot(team: HkTeam, role: HkRole, slot: number): { x: number; y: number; a: number } {
  const s = team === 0 ? -1 : 1;
  const a = team === 0 ? 0 : Math.PI;
  if (role === 'G') return { x: s * (GOAL_X - 1.0), y: 0, a };
  const spots = [{ x: 1.1, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 }];
  const p = spots[(slot - 1) % 3] ?? spots[0];
  return { x: s * p.x, y: p.y, a };
}

/** Goalie crease box (x range, y range) for a team. */
export function creaseBox(t: HkTeam): { x0: number; x1: number; y: number } {
  const g = ownGoalX(t);
  return t === 0 ? { x0: g + 0.25, x1: g + 2.6, y: GOAL_HALF + 0.9 } : { x0: g - 2.6, x1: g - 0.25, y: GOAL_HALF + 0.9 };
}

export interface HkOptions { seed?: number; periodS?: number; periods?: number }

/** Server-authoritative match: owns players, the puck, the clock and the score. Bots are ordinary players driven by hockeyBot(). */
export class HockeyGame {
  players = new Map<string, HkPlayer>();
  puck: HkPuck = { x: 0, y: 0, vx: 0, vy: 0, carrier: null, lastTouch: null, prevTouch: null, trail: 0 };
  phase: HkPhase = 'lobby';
  phaseLeft = LOBBY_S;
  period = 1;
  clock: number;
  score: [number, number] = [0, 0];
  matchId = '';
  /** Players who left or were replaced mid-match; their goals/saves still show on the result (never paid). */
  gone: HkPlayer[] = [];
  lastGoal: { team: HkTeam; by: string; assist: string | null; at: number } | null = null;
  result: HkResult | null = null;
  shotsOn: [number, number] = [0, 0];
  readonly periodS: number;
  readonly periods: number;
  rnd: () => number;
  time = 0;
  private matchNo = 0;

  constructor(o: HkOptions = {}) {
    this.rnd = hkRng(o.seed ?? Date.now());
    this.periodS = o.periodS ?? PERIOD_S;
    this.periods = o.periods ?? PERIODS;
    this.clock = this.periodS;
  }

  humans(): HkPlayer[] { return [...this.players.values()].filter((p) => !p.bot); }
  slotOwner(team: HkTeam, slot: number): HkPlayer | undefined { for (const p of this.players.values()) if (p.team === team && p.slot === slot) return p; return undefined; }
  goalieOpen(team: HkTeam): boolean { const g = this.slotOwner(team, 0); return !g || g.bot; }

  private makePlayer(id: string, name: string, team: HkTeam, slot: number, bot: boolean): HkPlayer {
    const role: HkRole = slot === 0 ? 'G' : 'S';
    const s = faceoffSpot(team, role, slot);
    return { id, name, team, role, slot, bot, x: s.x, y: s.y, vx: 0, vy: 0, a: s.a, input: { x: 0, y: 0, aim: s.a }, shootCd: 0, pokeCd: 0, noPickup: 0, goals: 0, assists: 0, shots: 0, saves: 0, joinedAt: this.time, playS: 0 };
  }

  /**
   * A human joins: takes their preferred team if it has a human-free slot, else the team with fewer humans. Goalie only
   * when asked and that net has no human in it. The bot in that slot is replaced. Returns null when 8 humans are on.
   */
  join(id: string, name: string, want: { team?: HkTeam; goalie?: boolean } = {}): HkPlayer | null {
    const have = this.players.get(id);
    if (have && !have.bot) return have;
    if (this.humans().length >= MAX_HUMANS) return null;
    const humansOn = (t: HkTeam) => this.humans().filter((p) => p.team === t).length;
    const order: HkTeam[] = want.team === 0 || want.team === 1 ? [want.team, (1 - want.team) as HkTeam] : humansOn(0) <= humansOn(1) ? [0, 1] : [1, 0];
    for (const team of order) {
      const slots = want.goalie ? [0, 1, 2, 3] : [1, 2, 3, 0];
      for (const slot of slots) {
        const cur = this.slotOwner(team, slot);
        if (cur && !cur.bot) continue;
        if (slot === 0 && !want.goalie && slots.slice(0, 3).some((s) => { const c = this.slotOwner(team, s); return !c || c.bot; })) continue;
        if (cur) { this.players.delete(cur.id); if (this.phase !== 'lobby') this.gone.push(cur); }
        const p = this.makePlayer(id, name, team, slot, false);
        if (cur && this.phase !== 'lobby') { Object.assign(p, { x: cur.x, y: cur.y, vx: cur.vx, vy: cur.vy, a: cur.a }); if (this.puck.carrier === cur.id) this.puck.carrier = id; }
        this.players.set(id, p);
        return p;
      }
    }
    return null;
  }

  /** Switch to the goalie of your own team if that net has no human. */
  takeGoalie(id: string): boolean {
    const p = this.players.get(id);
    if (!p || p.bot || p.role === 'G' || !this.goalieOpen(p.team)) return false;
    const g = this.slotOwner(p.team, 0);
    if (g) { g.slot = p.slot; g.role = 'S'; }
    p.slot = 0; p.role = 'G';
    if (g) [g.x, g.y, p.x, p.y] = [p.x, p.y, g.x, g.y];
    if (this.puck.carrier === p.id) this.puck.carrier = null;
    return true;
  }

  leave(id: string): boolean {
    const p = this.players.get(id);
    if (!p || p.bot) return false;
    this.players.delete(id);
    if (this.phase !== 'lobby') this.gone.push(p);
    if (this.puck.carrier === id) this.puck.carrier = null;
    this.fillBots();
    if (!this.humans().length) this.resetToLobby();
    return true;
  }

  /** Every empty slot gets a bot; bots never take a slot from a human. */
  fillBots(): number {
    let added = 0;
    for (const team of [0, 1] as HkTeam[]) for (let slot = 0; slot < TEAM_SIZE; slot++) {
      if (this.slotOwner(team, slot)) continue;
      const id = `hk-bot-${team}-${slot}`;
      const p = this.makePlayer(id, slot === 0 ? `Bot Goalie ${team ? 'B' : 'A'}` : `Bot ${team ? 'B' : 'A'}${slot}`, team, slot, true);
      this.players.set(id, p); added++;
    }
    return added;
  }

  setInput(id: string, raw: unknown): void {
    const p = this.players.get(id);
    if (!p || p.bot) return;
    const i = cleanInput(raw);
    // One-shot actions latch until the next tick consumes them.
    p.input = { ...i, shoot: i.shoot ?? p.input.shoot, pass: i.pass || p.input.pass, poke: i.poke || p.input.poke };
  }

  resetToLobby(): void {
    this.phase = 'lobby'; this.phaseLeft = LOBBY_S; this.period = 1; this.clock = this.periodS; this.score = [0, 0]; this.shotsOn = [0, 0];
    this.result = null; this.lastGoal = null;
    for (const p of this.players.values()) { p.goals = p.assists = p.shots = p.saves = 0; p.playS = 0; }
    this.gone = [];
    this.placeFaceoff();
  }

  placeFaceoff(): void {
    for (const p of this.players.values()) { const s = faceoffSpot(p.team, p.role, p.slot); Object.assign(p, { x: s.x, y: s.y, vx: 0, vy: 0, a: s.a, shootCd: 0, pokeCd: 0, noPickup: 0 }); p.input = { x: 0, y: 0, aim: s.a }; }
    Object.assign(this.puck, { x: 0, y: 0, vx: 0, vy: 0, carrier: null, lastTouch: null, prevTouch: null });
  }

  private startMatch(): HkEvent[] {
    this.matchNo++;
    this.matchId = `hk-${Math.floor(this.rnd() * 1e9).toString(36)}-${this.matchNo}`;
    this.period = 1; this.clock = this.periodS; this.score = [0, 0]; this.shotsOn = [0, 0]; this.result = null;
    for (const p of this.players.values()) { p.goals = p.assists = p.shots = p.saves = 0; p.playS = 0; p.joinedAt = this.time; }
    this.gone = [];
    return this.faceoff();
  }

  private faceoff(): HkEvent[] {
    this.placeFaceoff();
    this.phase = 'faceoff'; this.phaseLeft = FACEOFF_S;
    return [{ ev: 'hk_faceoff', data: { period: this.period } }];
  }

  /** One fixed step. Returns events for the network layer. */
  tick(dt = HK_DT): HkEvent[] {
    this.time += dt;
    const ev: HkEvent[] = [];
    switch (this.phase) {
      case 'lobby':
        if (!this.humans().length) { this.phaseLeft = LOBBY_S; return ev; }
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) ev.push(...this.startMatch());
        return ev;
      case 'faceoff':
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) {
          this.phase = 'play';
          // Drop: a tiny random nudge so the draw is a scramble, not a stalemate.
          this.puck.vx = (this.rnd() - 0.5) * 2.4; this.puck.vy = (this.rnd() - 0.5) * 2.4;
        }
        return ev;
      case 'goal':
      case 'intermission':
        this.phaseLeft -= dt;
        this.stepPhysics(dt, ev, false); // players glide, nothing scores
        if (this.phaseLeft <= 0) ev.push(...this.faceoff());
        return ev;
      case 'ended':
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) { this.resetToLobby(); }
        return ev;
      case 'play':
        for (const p of this.players.values()) p.playS += dt;
        this.clock -= dt;
        this.stepPhysics(dt, ev, true);
        if (this.phase !== 'play') return ev; // a goal changed the phase
        if (this.clock <= 0) ev.push(...this.endPeriod());
        return ev;
    }
  }

  private endPeriod(): HkEvent[] {
    const tied = this.score[0] === this.score[1];
    if (this.period < this.periods || (this.period === this.periods && tied)) {
      this.period++;
      this.clock = this.period > this.periods ? OT_S : this.periodS;
      this.phase = 'intermission'; this.phaseLeft = INTERMISSION_S;
      return [{ ev: 'hk_period', data: { period: this.period } }];
    }
    return this.finish();
  }

  finish(): HkEvent[] {
    const winner: HkTeam | null = this.score[0] === this.score[1] ? null : this.score[0] > this.score[1] ? 0 : 1;
    const players = [...this.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team, role: p.role, bot: p.bot, goals: p.goals, assists: p.assists, shots: p.shots, saves: p.saves, playS: p.playS }));
    for (const q of this.gone) {
      if (!(q.goals + q.assists + q.shots + q.saves)) continue;
      const same = players.find((x) => x.id === q.id && x.team === q.team);
      if (same) { same.goals += q.goals; same.assists += q.assists; same.shots += q.shots; same.saves += q.saves; continue; }
      // Departed players keep their line on the sheet but playS 0, so they can never qualify for a prize.
      players.push({ id: `${q.id}~${players.length}`, name: q.name, team: q.team, role: q.role, bot: q.bot, goals: q.goals, assists: q.assists, shots: q.shots, saves: q.saves, playS: 0 });
    }
    players.sort((a, b) => a.team - b.team);
    const stars = [...players].sort((a, b) => (b.goals * 3 + b.assists * 2 + b.saves * 0.5 + b.shots * 0.2) - (a.goals * 3 + a.assists * 2 + a.saves * 0.5 + a.shots * 0.2)).slice(0, 3).map((p) => p.id);
    this.result = { matchId: this.matchId, score: [...this.score] as [number, number], winner, players, stars };
    this.phase = 'ended'; this.phaseLeft = RESULT_S;
    this.puck.carrier = null;
    return [{ ev: 'hk_end', data: { matchId: this.matchId } }];
  }

  private scoreGoal(team: HkTeam, ev: HkEvent[]): void {
    this.score[team]++;
    const by = this.puck.lastTouch ? this.players.get(this.puck.lastTouch) : undefined;
    const scorer = by && by.team === team ? by : undefined; // own goals credit nobody
    const prev = this.puck.prevTouch ? this.players.get(this.puck.prevTouch) : undefined;
    const assist = scorer && prev && prev.team === team && prev.id !== scorer.id ? prev : undefined;
    if (scorer) { scorer.goals++; scorer.shots++; }
    this.shotsOn[team]++; // shots on goal = saves faced + goals
    if (assist) assist.assists++;
    this.lastGoal = { team, by: scorer?.id ?? '', assist: assist?.id ?? null, at: this.time };
    ev.push({ ev: 'hk_goal', data: { team, by: scorer?.name ?? 'Own goal', byId: scorer?.id ?? null, assist: assist?.name ?? null, score: [...this.score], x: this.puck.x, y: this.puck.y } });
    this.puck.carrier = null;
    // Sudden death in overtime.
    if (this.period > this.periods) { ev.push(...this.finish()); return; }
    this.phase = 'goal'; this.phaseLeft = GOAL_PAUSE_S;
  }

  private stepPhysics(dt: number, ev: HkEvent[], live: boolean): void {
    const pk = this.puck;
    // ---- skaters
    for (const p of this.players.values()) {
      p.shootCd = Math.max(0, p.shootCd - dt); p.pokeCd = Math.max(0, p.pokeCd - dt); p.noPickup = Math.max(0, p.noPickup - dt);
      const i = live ? p.input : { x: 0, y: 0, aim: p.a };
      const max = p.role === 'G' ? GOALIE_MAX : pk.carrier === p.id ? CARRY_MAX : SKATE_MAX;
      const im = Math.hypot(i.x, i.y);
      if (im > 0.05) {
        p.vx += i.x * SKATE_ACCEL * dt; p.vy += i.y * SKATE_ACCEL * dt;
        const along = (p.vx * i.x + p.vy * i.y) / im;
        if (along < 0) { const k = Math.exp(-BRAKE_DRAG * dt); p.vx *= k; p.vy *= k; }
      }
      const k = Math.exp(-(p.role === 'G' ? SKATE_DRAG * 4 : SKATE_DRAG) * dt); p.vx *= k; p.vy *= k;
      const sp = Math.hypot(p.vx, p.vy); if (sp > max) { p.vx *= max / sp; p.vy *= max / sp; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (Number.isFinite(i.aim)) p.a = i.aim;
      const r = p.role === 'G' ? GOALIE_R : SKATER_R;
      if (p.role === 'G') {
        const c = creaseBox(p.team);
        if (p.x < c.x0) { p.x = c.x0; p.vx = Math.max(0, p.vx); }
        if (p.x > c.x1) { p.x = c.x1; p.vx = Math.min(0, p.vx); }
        if (Math.abs(p.y) > c.y) { p.y = Math.sign(p.y) * c.y; p.vy = 0; }
      } else {
        const n = rinkContain(p, r); if (n) reflect(p, n, SKATER_BOUNCE);
        // Skaters can't enter the nets.
        for (const gx of [-GOAL_X, GOAL_X]) {
          const s = Math.sign(gx), inX = s > 0 ? p.x > gx - r && p.x < gx + NET_DEPTH + r : p.x < gx + r && p.x > gx - NET_DEPTH - r;
          if (inX && Math.abs(p.y) < GOAL_HALF + r) {
            const dxBack = Math.abs(p.x - (gx + s * NET_DEPTH)), dxFront = Math.abs(p.x - gx), dy = GOAL_HALF + r - Math.abs(p.y);
            if (dy < Math.min(dxBack, dxFront)) { p.y = Math.sign(p.y || 1) * (GOAL_HALF + r); p.vy = 0; }
            else if (dxFront < dxBack) { p.x = gx - s * r; p.vx = s > 0 ? Math.min(0, p.vx) : Math.max(0, p.vx); }
            else { p.x = gx + s * (NET_DEPTH + r); p.vx = s > 0 ? Math.max(0, p.vx) : Math.min(0, p.vx); }
          }
        }
      }
    }
    // ---- body contact (simple elastic separation)
    const ps = [...this.players.values()];
    for (let a = 0; a < ps.length; a++) for (let b = a + 1; b < ps.length; b++) {
      const A = ps[a], B = ps[b];
      const rr = (A.role === 'G' ? GOALIE_R : SKATER_R) + (B.role === 'G' ? GOALIE_R : SKATER_R);
      const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy);
      if (d >= rr || d < 1e-6) continue;
      const nx = dx / d, ny = dy / d, push = (rr - d) / 2;
      const ma = A.role === 'G' ? 3 : 1, mb = B.role === 'G' ? 3 : 1;
      A.x -= nx * push * (2 * mb / (ma + mb)); A.y -= ny * push * (2 * mb / (ma + mb));
      B.x += nx * push * (2 * ma / (ma + mb)); B.y += ny * push * (2 * ma / (ma + mb));
      const rel = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
      if (rel < 0) {
        const j = (-(1 + SKATER_BOUNCE) * rel) / (1 / ma + 1 / mb);
        A.vx -= (j / ma) * nx; A.vy -= (j / ma) * ny; B.vx += (j / mb) * nx; B.vy += (j / mb) * ny;
        // A big hit knocks the puck loose.
        if (Math.abs(rel) > 6) for (const P of [A, B]) if (pk.carrier === P.id) { pk.carrier = null; P.noPickup = 0.5; pk.vx = P.vx; pk.vy = P.vy; }
      }
    }
    // ---- actions
    if (live) for (const p of this.players.values()) {
      const i = p.input;
      if (i.poke && p.pokeCd <= 0) {
        p.pokeCd = POKE_COOLDOWN_S;
        const c = pk.carrier ? this.players.get(pk.carrier) : undefined;
        const tx = c ? c.x : pk.x, ty = c ? c.y : pk.y;
        if ((!c || c.team !== p.team) && Math.hypot(tx - p.x, ty - p.y) <= POKE_RANGE && p.role !== 'G') {
          if (c) { pk.carrier = null; c.noPickup = 0.6; }
          const ang = p.a + (this.rnd() - 0.5) * 0.8;
          pk.x = p.x + Math.cos(p.a) * CARRY_OFFSET; pk.y = p.y + Math.sin(p.a) * CARRY_OFFSET;
          pk.vx = Math.cos(ang) * 6; pk.vy = Math.sin(ang) * 6;
          pk.prevTouch = pk.lastTouch; pk.lastTouch = p.id;
          ev.push({ ev: 'hk_poke', data: { id: p.id, stole: !!c } });
        }
      }
      if (pk.carrier === p.id && p.shootCd <= 0) {
        if (i.shoot !== undefined && i.shoot > 0) {
          const v = SHOT_MIN + (SHOT_MAX - SHOT_MIN) * clamp(i.shoot, 0, 1);
          this.release(p, p.a, v);
          ev.push({ ev: 'hk_shot', data: { id: p.id, v: Math.round(v) } });
        } else if (i.pass) {
          const mate = this.passTarget(p);
          const ang = mate ? Math.atan2(mate.y + mate.vy * 0.3 - p.y, mate.x + mate.vx * 0.3 - p.x) : p.a;
          this.release(p, ang, PASS_SPEED);
          ev.push({ ev: 'hk_pass', data: { id: p.id, to: mate?.id ?? null } });
        }
      }
      i.shoot = undefined; i.pass = false; i.poke = false;
    }
    // ---- puck
    if (pk.carrier) {
      const c = this.players.get(pk.carrier);
      if (!c) pk.carrier = null;
      else { pk.x = c.x + Math.cos(c.a) * CARRY_OFFSET; pk.y = c.y + Math.sin(c.a) * CARRY_OFFSET; pk.vx = c.vx; pk.vy = c.vy; rinkContain(pk, PUCK_R); }
    }
    if (!pk.carrier) {
      const steps = Math.max(1, Math.ceil((Math.hypot(pk.vx, pk.vy) * dt) / 0.25)); // sub-step fast shots (no tunnelling)
      const h = dt / steps;
      for (let s = 0; s < steps && !pk.carrier; s++) {
        const px0 = pk.x;
        pk.x += pk.vx * h; pk.y += pk.vy * h;
        // Goal: crossed a goal line between the posts, travelling into the net.
        for (const t of [0, 1] as HkTeam[]) {
          const gx = attackGoalX(t), sg = Math.sign(gx);
          const crossed = sg > 0 ? px0 < gx && pk.x >= gx : px0 > gx && pk.x <= gx;
          if (crossed && Math.abs(pk.y) < GOAL_HALF - PUCK_R) {
            if (live) { this.scoreGoal(t, ev); return; }
            pk.x = gx - sg * PUCK_R; pk.vx = -pk.vx * 0.3;
          } else if (crossed && Math.abs(pk.y) < GOAL_HALF + PUCK_R) {
            pk.x = gx - sg * PUCK_R; pk.vx = -pk.vx * 0.6; ev.push({ ev: 'hk_post', data: {} }); // ping, off the post
          }
          // Back/sides of the net are solid.
          const behind = sg > 0 ? pk.x > gx && pk.x < gx + NET_DEPTH + PUCK_R : pk.x < gx && pk.x > gx - NET_DEPTH - PUCK_R;
          if (behind && Math.abs(pk.y) < GOAL_HALF + PUCK_R && !crossed) {
            if (Math.abs(px0) >= Math.abs(gx) + NET_DEPTH) { pk.x = gx + sg * (NET_DEPTH + PUCK_R); pk.vx = -pk.vx * BOARD_BOUNCE; }
            else { pk.y = Math.sign(pk.y || 1) * (GOAL_HALF + PUCK_R); pk.vy = -pk.vy * BOARD_BOUNCE; }
          }
        }
        const n = rinkContain(pk, PUCK_R); if (n) reflect(pk, n, BOARD_BOUNCE);
        // Pickups and goalie saves.
        const speed = Math.hypot(pk.vx, pk.vy);
        for (const p of this.players.values()) {
          const r = p.role === 'G' ? GOALIE_R : PICKUP_DIST;
          const d = Math.hypot(pk.x - p.x, pk.y - p.y);
          if (d > r || p.noPickup > 0) continue;
          if (p.role === 'G') {
            const shooter = pk.lastTouch ? this.players.get(pk.lastTouch) : undefined;
            if (speed > 4 && shooter && shooter.team !== p.team && live) { p.saves++; shooter.shots++; this.shotsOn[shooter.team]++; ev.push({ ev: 'hk_save', data: { id: p.id, v: Math.round(speed) } }); }
            if (speed > 9) {
              // Rebound: reflect off the pad, lose energy, kick it wide of the net.
              const nx = (pk.x - p.x) / (d || 1), ny = (pk.y - p.y) / (d || 1);
              reflect(pk, { nx: -nx, ny: -ny }, 0.45);
              pk.vy += (pk.y >= p.y ? 1 : -1) * 3;
              pk.x = p.x + nx * (r + 0.01); pk.y = p.y + ny * (r + 0.01);
              pk.prevTouch = pk.lastTouch; pk.lastTouch = p.id; p.noPickup = 0.25;
              break;
            }
          } else if (speed > PICKUP_MAX_SPEED) continue;
          pk.carrier = p.id;
          if (pk.lastTouch !== p.id) { pk.prevTouch = pk.lastTouch; pk.lastTouch = p.id; }
          break;
        }
      }
      const k = Math.exp(-PUCK_DRAG * dt); pk.vx *= k; pk.vy *= k;
    }
    // A goalie holding the puck plays it up after a beat (no stalling): treat as an automatic outlet pass.
    const g = pk.carrier ? this.players.get(pk.carrier) : undefined;
    if (g && g.role === 'G' && live && g.bot) { const m = this.passTarget(g); this.release(g, m ? Math.atan2(m.y - g.y, m.x - g.x) : g.a, PASS_SPEED); }
    pk.trail = Math.hypot(pk.vx, pk.vy);
  }

  private release(p: HkPlayer, ang: number, v: number): void {
    const pk = this.puck;
    pk.carrier = null;
    pk.x = p.x + Math.cos(ang) * (p.role === 'G' ? GOALIE_R + 0.05 : CARRY_OFFSET); pk.y = p.y + Math.sin(ang) * (p.role === 'G' ? GOALIE_R + 0.05 : CARRY_OFFSET);
    pk.vx = Math.cos(ang) * v + p.vx * 0.3; pk.vy = Math.sin(ang) * v + p.vy * 0.3;
    p.shootCd = SHOOT_COOLDOWN_S; p.noPickup = SHOOT_COOLDOWN_S;
  }

  /** Best open teammate roughly in front (within ~70 degrees of aim), else the nearest teammate skater. */
  passTarget(p: HkPlayer): HkPlayer | undefined {
    let best: HkPlayer | undefined, bestS = -Infinity;
    for (const m of this.players.values()) {
      if (m.team !== p.team || m.id === p.id || m.role === 'G') continue;
      const dx = m.x - p.x, dy = m.y - p.y, d = Math.hypot(dx, dy);
      if (d < 1.5) continue;
      const cos = (dx * Math.cos(p.a) + dy * Math.sin(p.a)) / d;
      const s = cos * 2 - d / 20 + (p.role === 'G' ? 1 : 0);
      if (cos > 0.35 || p.role === 'G') { if (s > bestS) { bestS = s; best = m; } }
    }
    return best;
  }

  /** Compact network snapshot. */
  snapshot(): HkSnapshot {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return {
      ph: this.phase, pl: r2(this.phaseLeft), per: this.period, clk: r2(Math.max(0, this.clock)), sc: [...this.score] as [number, number], so: [...this.shotsOn] as [number, number], mid: this.matchId,
      pk: { x: r2(this.puck.x), y: r2(this.puck.y), vx: r2(this.puck.vx), vy: r2(this.puck.vy), c: this.puck.carrier },
      p: [...this.players.values()].map((p) => ({ id: p.id, n: p.name, t: p.team, r: p.role, s: p.slot, b: p.bot, x: r2(p.x), y: r2(p.y), vx: r2(p.vx), vy: r2(p.vy), a: r2(p.a), g: p.goals, as: p.assists, sh: p.shots, sv: p.saves })),
      lg: this.lastGoal ? { t: this.lastGoal.team, by: this.lastGoal.by, as: this.lastGoal.assist } : null,
      res: this.phase === 'ended' ? this.result : null,
    };
  }
}

export interface HkSnapshot {
  ph: HkPhase; pl: number; per: number; clk: number; sc: [number, number]; so: [number, number]; mid: string;
  pk: { x: number; y: number; vx: number; vy: number; c: string | null };
  p: Array<{ id: string; n: string; t: HkTeam; r: HkRole; s: number; b: boolean; x: number; y: number; vx: number; vy: number; a: number; g: number; as: number; sh: number; sv: number }>;
  lg: { t: HkTeam; by: string; as: string | null } | null;
  res: HkResult | null;
}

/**
 * Bot brain: returns the input a bot should send this tick. Pure (reads the game, no side effects) so it's testable.
 * Goalies shadow the puck along the crease; skaters chase loose pucks, carry to the net and shoot from the slot, pass
 * when pressured, support a carrying teammate, and the closest defender pokes at an opposing carrier.
 */
export function hockeyBot(g: HockeyGame, p: HkPlayer): HkInput {
  const pk = g.puck;
  const toward = (x: number, y: number, slow = 1): HkInput => { const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy) || 1; const k = Math.min(1, d / 1.5) * slow; return { x: (dx / d) * k, y: (dy / d) * k, aim: Math.atan2(dy, dx) }; };
  if (g.phase !== 'play') return { x: 0, y: 0, aim: p.a };
  const goalX = attackGoalX(p.team), ownX = ownGoalX(p.team);
  if (p.role === 'G') {
    const c = creaseBox(p.team);
    const ty = clamp(pk.y * 0.45, -c.y, c.y);
    const tx = p.team === 0 ? c.x0 + 0.5 : c.x1 - 0.5;
    const i = toward(tx, ty);
    i.aim = Math.atan2(pk.y - p.y, pk.x - p.x);
    return i;
  }
  const carrier = pk.carrier ? g.players.get(pk.carrier) : undefined;
  if (carrier?.id === p.id) {
    // Carriers move the puck by passing and shooting; they never skate it into the net. The carry target stops at the
    // top of the slot, so the only ways forward are a shot (in range) or a pass to an open teammate further up.
    const dir = Math.sign(goalX);
    const dGoal = Math.hypot(goalX - p.x, p.y);
    const inFront = dir * (goalX - p.x) > 1.5;
    const pressured = [...g.players.values()].some((o) => o.team !== p.team && o.role === 'S' && Math.hypot(o.x - p.x, o.y - p.y) < 1.8);
    if (inFront && (dGoal < 7 || (dGoal < 14 && (pressured || g.rnd() < 0.12)))) {
      const aimY = (g.rnd() < 0.5 ? -1 : 1) * GOAL_HALF * (0.45 + g.rnd() * 0.4);
      const i = toward(goalX, aimY, dGoal < 7 ? 0.2 : 0.6);
      return { ...i, aim: Math.atan2(aimY - p.y, goalX - p.x), shoot: 0.65 + g.rnd() * 0.35 };
    }
    const ahead = [...g.players.values()].filter((m) => m.team === p.team && m.id !== p.id && m.role === 'S' && dir * (m.x - p.x) > 2
      && ![...g.players.values()].some((o) => o.team !== p.team && Math.hypot(o.x - m.x, o.y - m.y) < 1.8));
    const mate = ahead.sort((a, b) => Math.hypot(goalX - a.x, a.y) - Math.hypot(goalX - b.x, b.y))[0];
    if (mate && (pressured || g.rnd() < 0.06)) {
      const i = toward(mate.x, mate.y, 0.5);
      return { ...i, aim: Math.atan2(mate.y + mate.vy * 0.3 - p.y, mate.x + mate.vx * 0.3 - p.x), pass: true };
    }
    if (pressured && g.rnd() < 0.3) return { ...toward(goalX, 0, 0.6), pass: true };
    // Drive to the top of the slot (never past it).
    const lane = Math.abs(p.y) > 4 ? Math.sign(p.y) * 3 : p.y;
    return toward(goalX - dir * 9, lane);
  }
  const mates = [...g.players.values()].filter((m) => m.team === p.team && m.role === 'S');
  const chaser = mates.reduce((b, m) => (Math.hypot(m.x - pk.x, m.y - pk.y) < Math.hypot(b.x - pk.x, b.y - pk.y) ? m : b), mates[0]);
  if (!carrier || carrier.team !== p.team) {
    if (chaser.id === p.id) {
      const i = toward(pk.x + pk.vx * 0.25, pk.y + pk.vy * 0.25);
      if (carrier && Math.hypot(carrier.x - p.x, carrier.y - p.y) < POKE_RANGE) i.poke = true;
      return i;
    }
    // Defend: sit between the puck and our net, spread by slot.
    const k = 0.45 + (p.slot % 2) * 0.15;
    return toward(ownX + (pk.x - ownX) * k, pk.y * 0.6 + (p.slot === 2 ? -3 : 3), 0.8);
  }
  // Teammate has it: get open ahead of the puck on our lane.
  const lane = p.slot === 2 ? -5 : 5;
  return toward(clamp(carrier.x + Math.sign(goalX) * 6, -GOAL_X + 4, GOAL_X - 4), lane, 0.9);
}

/** Drive every bot for one tick. */
export function driveBots(g: HockeyGame): void {
  for (const p of g.players.values()) if (p.bot) p.input = hockeyBot(g, p);
}

// ---- Prizes (conservative, mirrors the Arena's wallet+ledger rules but without its prize exploit)
/** Chips each signed-in human on the winning team gets (price-indexed on the server). Small on purpose. */
export const HK_WIN_CHIPS = 40;
/** Paid only when at least this many distinct signed-in humans played, with at least one on EACH team (no farming bots). */
export const HK_PRIZE_MIN_HUMANS = 2;
/** A human must have been on the ice for this share of the match's play time to count. */
export const HK_MIN_PLAY_SHARE = 0.6;
/** Paid wins per account per UTC day, so even colluding alts can't farm it. */
export const HK_DAILY_PAID_WINS = 5;

export interface HkPrizeInput { winner: HkTeam | null; players: Array<{ team: HkTeam; bot: boolean; playS: number; account?: string }>; totalPlayS: number }
/** Accounts that earn the win prize (before the daily cap). Pure, so the rules are testable. */
export function prizeWinners(r: HkPrizeInput): string[] {
  if (r.winner === null || r.totalPlayS <= 0) return [];
  const eligible = r.players.filter((p) => !p.bot && p.account && p.playS >= r.totalPlayS * HK_MIN_PLAY_SHARE);
  const accts = new Set(eligible.map((p) => p.account!.toLowerCase()));
  const teams = new Set(eligible.map((p) => p.team));
  if (accts.size < HK_PRIZE_MIN_HUMANS || teams.size < 2) return [];
  const out = new Map<string, string>();
  for (const p of eligible) if (p.team === r.winner) out.set(p.account!.toLowerCase(), p.account!);
  // Same account on both teams (two tabs) never earns.
  for (const p of eligible) if (p.team !== r.winner) out.delete(p.account!.toLowerCase());
  return [...out.values()];
}
