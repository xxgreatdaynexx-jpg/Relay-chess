/**
 * City treasury, levers, policies, civic buildings, approval and recall (Mayor 2.0, rules in shared/city.ts).
 * Money rules (tests/city.test.ts proves them):
 *  - The treasury is credited ONLY by SQL statements appended to the SAME transaction as the wallet debit that funded
 *    it (treasuryStmts), so a credit can never exist without its debit. QA / guest / bot payers are burned instead.
 *  - The treasury is debited ONLY for a policy or a building stage (pure sinks), guarded by `balance >= cost` in SQL.
 *  - There is no code path from the treasury to any wallet (no bank import is used for payouts here at all).
 * Hot-path readers (citySalesTaxRate, cityWealthTaxRate, cityFreightMul, cityPolicyMul, cityPerk) read an in-memory
 * snapshot refreshed every 60 s and after each write; default = no effect when City Hall is offline.
 */
import { randomUUID } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { getBank, type CasinoBank } from './casino-store.js';
import { getMayor, pickWinner, type Mayor } from './mayor.js';
import { playerKey } from './skins.js';
import { isJailed } from './jail.js';
import { priceIndex } from './price-index.js';
import { setCityRates, treasuryCreditStmts, politicsExcluded } from './city-rates.js';
export * from './city-rates.js';
import {
  LEVERS, LEVER_IDS, clampLever, POLICIES, POLICY_IDS, POLICY_MS, POLICY_COOLDOWN_MS, BUILDINGS, BUILDING_IDS, MAX_STAGE, stageAt, underConstruction, perkOf,
  PERK_BUILDING, TREASURY_CAP, APPROVAL_WINDOW_MS, APPROVAL_MIN_VOTES, RECALL_MAX_APPROVAL, RECALL_MIN_RATERS, RECALL_FEE, RECALL_GRACE_MS, RECALL_VOTE_MS,
  recallNeeded, recallPasses, isExcludedName, leverText, DAY_MS, PROJECTS, PROJECT_IDS, combinedPerk, isRequestId, projectCap, type ProjectId, type ProjectRun,
  type LeverId, type PolicyId, type BuildingId, type BuildingState, type PerkId, type Sector, type CityView, type CityAction, type TreasuryRow, type ActionKind,
} from '../shared/city.js';
import { abDayStart } from '../shared/mayor.js';

export const CITY_MIGRATION = `
CREATE TABLE IF NOT EXISTS city_treasury (id TEXT PRIMARY KEY, balance BIGINT NOT NULL CHECK (balance >= 0));
INSERT INTO city_treasury (id, balance) VALUES ('main', 0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS city_treasury_ledger (id TEXT PRIMARY KEY, at BIGINT NOT NULL, kind TEXT NOT NULL, amount BIGINT NOT NULL, balance BIGINT NOT NULL, memo TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS city_levers (id TEXT PRIMARY KEY, lever TEXT NOT NULL, value DOUBLE PRECISION NOT NULL, at BIGINT NOT NULL, by_name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS city_policies (id TEXT PRIMARY KEY, policy TEXT NOT NULL, starts_at BIGINT NOT NULL, ends_at BIGINT NOT NULL, cost BIGINT NOT NULL, by_name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS city_buildings (id TEXT PRIMARY KEY, stage INTEGER NOT NULL, build_stage INTEGER, started_at BIGINT, done_at BIGINT);
CREATE TABLE IF NOT EXISTS city_approval (voter_key TEXT NOT NULL, day BIGINT NOT NULL, week TEXT NOT NULL, up BOOLEAN NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (voter_key, day));
CREATE TABLE IF NOT EXISTS city_recalls (id TEXT PRIMARY KEY, week TEXT NOT NULL UNIQUE, opened_by TEXT NOT NULL, opened_at BIGINT NOT NULL, ends_at BIGINT NOT NULL, result TEXT, yes INTEGER, no INTEGER);
CREATE TABLE IF NOT EXISTS city_recall_votes (recall_id TEXT NOT NULL, voter_key TEXT NOT NULL, yes BOOLEAN NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (recall_id, voter_key));
CREATE TABLE IF NOT EXISTS city_projects (id TEXT PRIMARY KEY, project TEXT NOT NULL, starts_at BIGINT NOT NULL, ends_at BIGINT NOT NULL, cost BIGINT NOT NULL, by_name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mayor_actions (id TEXT PRIMARY KEY, at BIGINT NOT NULL, by_name TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL);
`;
export class CityError extends Error {}
class ReplayProject extends Error {}
type Stmt = { sql: string; args: unknown[] };
type Snap = { levers: Array<{ lever: LeverId; value: number; at: number; by: string }>; policies: Array<{ id: string; policy: PolicyId; startsAt: number; endsAt: number; by: string }>; buildings: Map<BuildingId, BuildingState>; projects?: ProjectRun[] };

export class City {
  snap: Snap = { levers: [], policies: [], buildings: new Map(), projects: [] };
  actions: CityAction[] = [];
  constructor(readonly pool: pg.Pool, private readonly mayorOf: () => Mayor | null = getMayor, private readonly clock = () => Date.now(), private readonly bank: () => CasinoBank = getBank, private readonly index: () => number = priceIndex) {}
  async init() { await this.pool.query(CITY_MIGRATION); await this.reload(); }
  async reload() {
    const [l, p, b, a] = await Promise.all([
      this.pool.query('SELECT * FROM city_levers ORDER BY at ASC, id ASC'), this.pool.query('SELECT * FROM city_policies ORDER BY starts_at ASC'),
      this.pool.query('SELECT * FROM city_buildings'), this.pool.query('SELECT * FROM mayor_actions ORDER BY at DESC, id DESC LIMIT 50'),
    ]);
    const pr = await this.pool.query('SELECT * FROM city_projects ORDER BY starts_at ASC, id ASC');
    const buildings = new Map<BuildingId, BuildingState>(); for (const id of BUILDING_IDS) buildings.set(id, { id, stage: 0, building: null });
    for (const x of b.rows as any[]) if (BUILDINGS[x.id as BuildingId]) buildings.set(x.id, { id: x.id, stage: Number(x.stage), building: x.build_stage == null ? null : { stage: Number(x.build_stage), startedAt: Number(x.started_at), doneAt: Number(x.done_at) } });
    this.snap = {
      levers: (l.rows as any[]).filter((x) => LEVERS[x.lever as LeverId]).map((x) => ({ lever: x.lever, value: clampLever(x.lever, x.value), at: Number(x.at), by: String(x.by_name) })),
      projects: (pr.rows as any[]).filter((x) => PROJECTS[x.project as ProjectId]).map((x): ProjectRun => ({ id: String(x.id), project: x.project, startsAt: Number(x.starts_at), endsAt: Number(x.ends_at), cost: Number(x.cost), by: String(x.by_name) })),
      policies: (p.rows as any[]).filter((x) => POLICIES[x.policy as PolicyId]).map((x) => ({ id: String(x.id), policy: x.policy, startsAt: Number(x.starts_at), endsAt: Number(x.ends_at), by: String(x.by_name) })), buildings,
    };
    this.actions = (a.rows as any[]).map((x) => ({ id: String(x.id), at: Number(x.at), by: String(x.by_name), kind: x.kind, text: String(x.text) }));
  }
  // ---------- hot readers ----------
  lever(id: LeverId, t = this.clock()) { let v = LEVERS[id].base; for (const c of this.snap.levers) if (c.lever === id && c.at <= t) v = c.value; return v; }
  policy(t = this.clock()) { return this.snap.policies.find((p) => p.startsAt <= t && p.endsAt > t) ?? null; }
  policyMul(sector: Sector, t = this.clock()) { const p = this.policy(t); return p && POLICIES[p.policy].sector === sector ? POLICIES[p.policy].mul : 1; }
  /** Building perk plus any active treasury project on it (capped at the fully built perk, non-stacking). */
  perk(perk: PerkId, t = this.clock()) { const id = PERK_BUILDING[perk]; return combinedPerk(perk, perkOf(id, stageAt(this.snap.buildings.get(id), t)), this.snap.projects ?? [], t); }
  buildingPerk(perk: PerkId, t = this.clock()) { const id = PERK_BUILDING[perk]; return perkOf(id, stageAt(this.snap.buildings.get(id), t)); }
  activeProject(id: ProjectId, t = this.clock()) { return (this.snap.projects ?? []).find((r) => r.project === id && r.startsAt <= t && r.endsAt > t) ?? null; }
  nextProjectAt(id: ProjectId) { const last = [...(this.snap.projects ?? [])].reverse().find((r) => r.project === id); return last ? last.endsAt + PROJECTS[id].cooldownMs : 0; }
  /** Extra perk a new run would actually add right now (0 = the building already gives the max). */
  projectHeadroom(id: ProjectId, t = this.clock()) { const sp = PROJECTS[id]; return Math.max(0, Math.min(sp.boost, projectCap(id) - this.buildingPerk(sp.perk, t))); }

  // ---------- helpers ----------
  private async isMayor(name: string) { const m = this.mayorOf(); if (!m) throw new CityError('City Hall is closed right now.'); await m.settle(this.clock()); const t = await m.mayor(this.clock()); if (!t || t.key !== playerKey(name)) throw new CityError('Only the sitting mayor can do that.'); return t; }
  /** QA / guest / bot / jailed accounts never take part. Then the same anti-alt gate as voting. */
  async excluded(name: string): Promise<string | undefined> {
    if (politicsExcluded(name)) return 'Test, guest and bot accounts can’t take part in city politics.';
    if (isJailed(name)) return 'You can’t take part in city politics from City Jail.';
    return undefined;
  }
  private async gate(name: string) { const x = await this.excluded(name); if (x) throw new CityError(x); const why = await this.mayorOf()?.eligibility(name); if (why) throw new CityError(why); }
  private actionStmt(by: string, kind: ActionKind, text: string, at: number): Stmt { return { sql: 'INSERT INTO mayor_actions (id, at, by_name, kind, text) VALUES ($1,$2,$3,$4,$5)', args: [randomUUID(), at, by, kind, text] }; }
  private async run(stmts: Stmt[], body?: (cl: pg.PoolClient) => Promise<void>) {
    const cl = await this.pool.connect();
    try { await cl.query('BEGIN'); if (body) await body(cl); for (const s of stmts) await cl.query(s.sql, s.args); await cl.query('COMMIT'); }
    catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
  }
  /** Debit the treasury inside cl; throws when short. */
  private async spend(cl: pg.PoolClient, cost: number, kind: string, memo: string, at: number) {
    const u = await cl.query('UPDATE city_treasury SET balance = balance - $1::bigint WHERE id = \'main\' AND balance >= $1::bigint', [cost]);
    if (!u.rowCount) throw new CityError(`The treasury doesn't have 🪙 ${cost.toLocaleString('en-US')} yet.`);
    await cl.query('INSERT INTO city_treasury_ledger (id, at, kind, amount, balance, memo) SELECT $1::text, $2::bigint, $3::text, $4::bigint, balance, $5::text FROM city_treasury WHERE id = \'main\'', [randomUUID(), at, kind, -cost, memo]);
  }
  async balance() { return Number((await this.pool.query('SELECT balance FROM city_treasury WHERE id = \'main\'')).rows[0]?.balance ?? 0); }
  nextLeverAt(id: LeverId) { const last = [...this.snap.levers].reverse().find((c) => c.lever === id && c.by !== 'admin' && c.by !== 'recall'); return last ? last.at + LEVERS[id].cooldownMs : 0; }
  nextPolicyAt() { const last = this.snap.policies[this.snap.policies.length - 1]; return last ? last.endsAt + POLICY_COOLDOWN_MS : 0; }

  // ---------- mayor actions ----------
  async setLever(name: string, id: unknown, value: unknown) {
    if (typeof id !== 'string' || !LEVERS[id as LeverId]) throw new CityError('Unknown lever.'); const lv = id as LeverId;
    const m = await this.isMayor(name); const now = this.clock();
    if (this.nextLeverAt(lv) > now) throw new CityError(`${LEVERS[lv].label} can change again ${abTime(this.nextLeverAt(lv))}.`);
    if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) throw new CityError('Pick a value.');
    const v = clampLever(lv, value); const before = this.lever(lv, now); if (Math.abs(v - before) < 1e-9) throw new CityError('That is already the current value.');
    const text = `${LEVERS[lv].label}: ${leverText(lv, before)} → ${leverText(lv, v)}`;
    await this.run([{ sql: 'INSERT INTO city_levers (id, lever, value, at, by_name) VALUES ($1,$2,$3,$4,$5)', args: [randomUUID(), lv, v, now, m.name] }, this.actionStmt(m.name, 'lever', text, now)]);
    await this.reload(); return { lever: lv, value: v };
  }
  async startPolicy(name: string, id: unknown) {
    if (typeof id !== 'string' || !POLICIES[id as PolicyId]) throw new CityError('Unknown policy.'); const p = POLICIES[id as PolicyId];
    const m = await this.isMayor(name); const now = this.clock();
    if (this.policy(now)) throw new CityError('A policy is already running.');
    if (this.nextPolicyAt() > now) throw new CityError(`The next policy can start ${abTime(this.nextPolicyAt())}.`);
    const cost = Math.round(p.cost * this.index()); const pid = randomUUID();
    await this.run([{ sql: 'INSERT INTO city_policies (id, policy, starts_at, ends_at, cost, by_name) VALUES ($1,$2,$3,$4,$5,$6)', args: [pid, p.id, now, now + POLICY_MS, cost, m.name] }, this.actionStmt(m.name, 'policy', `${p.icon} ${p.label} for 24 h (🪙 ${cost.toLocaleString('en-US')} from the treasury)`, now)],
      (cl) => this.spend(cl, cost, 'policy', `${p.label} (policy ${pid.slice(0, 8)})`, now));
    await this.reload(); return { policy: p.id, cost };
  }
  /**
   * Start a treasury project (pt2027u). requestId makes retries idempotent: the same id never debits twice.
   * Under the treasury row lock (serialises every instance), it re-checks in the DB: one run of this project at a time,
   * its cooldown, and the balance. Debit + project row + treasury ledger + public mayor log commit together or not at all.
   */
  async startProject(name: string, id: unknown, requestId?: unknown): Promise<{ project: ProjectId; cost: number; endsAt: number; replay?: boolean }> {
    if (typeof id !== 'string' || !PROJECTS[id as ProjectId]) throw new CityError('Unknown project.'); const sp = PROJECTS[id as ProjectId];
    const rid = requestId === undefined ? randomUUID() : isRequestId(requestId) ? requestId : null; if (!rid) throw new CityError('Bad request id.');
    const prior = (await this.pool.query('SELECT * FROM city_projects WHERE id = $1', [rid])).rows[0];
    if (prior) { if (prior.project !== sp.id || playerKey(String(prior.by_name)) !== playerKey(name)) throw new CityError('That request was already used.'); return { project: sp.id, cost: Number(prior.cost), endsAt: Number(prior.ends_at), replay: true }; }
    const m = await this.isMayor(name); const now = this.clock();
    if (this.projectHeadroom(sp.id, now) <= 0) throw new CityError(`${sp.label} would add nothing: the city already has the maximum ${Math.round(projectCap(sp.id) * 100)}%.`);
    const cost = Math.round(sp.cost * this.index()); const endsAt = now + sp.durationMs;
    const text = `${sp.icon} ${sp.label}: +${Math.round(this.projectHeadroom(sp.id, now) * 100)}% ${sp.perk === 'xp' ? 'skill XP' : 'truck speed'} for everyone, ${abTime(now)} → ${abTime(endsAt)} (🪙 ${cost.toLocaleString('en-US')} from the treasury)`;
    try {
      await this.run([this.actionStmt(m.name, 'project', text, now)], async (cl) => {
        await cl.query("SELECT balance FROM city_treasury WHERE id = 'main' FOR UPDATE");
        if ((await cl.query('SELECT 1 FROM city_projects WHERE id = $1', [rid])).rows.length) throw new ReplayProject(); // same request committed elsewhere
        const last = (await cl.query('SELECT ends_at FROM city_projects WHERE project = $1 ORDER BY ends_at DESC LIMIT 1', [sp.id])).rows[0];
        if (last && Number(last.ends_at) > now) throw new CityError(`${sp.label} is already running.`);
        if (last && Number(last.ends_at) + sp.cooldownMs > now) throw new CityError(`${sp.label} can run again ${abTime(Number(last.ends_at) + sp.cooldownMs)}.`);
        await this.spend(cl, cost, 'project', `${sp.label} by Mayor ${m.name}: ${abTime(now)} → ${abTime(endsAt)} (project ${rid.slice(0, 8)})`, now);
        await cl.query('INSERT INTO city_projects (id, project, starts_at, ends_at, cost, by_name) VALUES ($1,$2,$3,$4,$5,$6)', [rid, sp.id, now, endsAt, cost, m.name]);
      });
    } catch (e) {
      if (e instanceof ReplayProject || (!(e instanceof CityError) && /duplicate|unique/i.test((e as Error).message))) { await this.reload(); return this.startProject(name, id, rid); }
      throw e;
    }
    await this.reload(); return { project: sp.id, cost, endsAt };
  }
  async build(name: string, id: unknown) {
    if (typeof id !== 'string' || !BUILDINGS[id as BuildingId]) throw new CityError('Unknown building.'); const spec = BUILDINGS[id as BuildingId];
    const m = await this.isMayor(name); const now = this.clock(); await this.finish(now);
    for (const b of this.snap.buildings.values()) if (underConstruction(b, now)) throw new CityError(`${BUILDINGS[b.id].label} is still under construction. One project at a time.`);
    const cur = this.snap.buildings.get(spec.id)!; const s = stageAt(cur, now); if (s >= MAX_STAGE) throw new CityError(`${spec.label} is fully built.`);
    const next = s + 1; const cost = Math.round(spec.stages[s]! * this.index()); const doneAt = now + spec.buildMs[s]!;
    await this.run([this.actionStmt(m.name, 'build', `${spec.icon} Started ${spec.label} stage ${next} (🪙 ${cost.toLocaleString('en-US')}, ready ${abTime(doneAt)})`, now)], async (cl) => {
      await this.spend(cl, cost, 'build', `${spec.label} stage ${next}`, now);
      await cl.query('INSERT INTO city_buildings (id, stage, build_stage, started_at, done_at) VALUES ($1,$2,NULL,NULL,NULL) ON CONFLICT (id) DO NOTHING', [spec.id, 0]);
      const u = await cl.query('UPDATE city_buildings SET build_stage = $2, started_at = $3, done_at = $4 WHERE id = $1 AND stage = $5 AND build_stage IS NULL', [spec.id, next, now, doneAt, s]);
      if (!u.rowCount) throw new CityError('That building just changed. Try again.');
    });
    await this.reload(); return { building: spec.id, stage: next, cost, doneAt };
  }
  /** A City notice (weekly events etc.). Idempotent by id: posting the same notice twice is a no-op. */
  async notice(id: string, text: string, at = this.clock()): Promise<boolean> {
    const r = await this.pool.query("INSERT INTO mayor_actions (id, at, by_name, kind, text) VALUES ($1,$2,'City','event',$3) ON CONFLICT (id) DO NOTHING", [id, at, text.slice(0, 300)]);
    if (r.rowCount) await this.reload(); return !!r.rowCount;
  }
  /** Write back finished construction (idempotent). */
  async finish(now = this.clock()) {
    let n = 0;
    for (const b of this.snap.buildings.values()) if (b.building && b.building.doneAt <= now) {
      const st = b.building.stage;
      const r = await this.pool.query('UPDATE city_buildings SET stage = build_stage, build_stage = NULL, started_at = NULL, done_at = NULL WHERE id = $1 AND build_stage = $2 AND done_at <= $3', [b.id, st, now]);
      if (r.rowCount) { n++; await this.pool.query('INSERT INTO mayor_actions (id, at, by_name, kind, text) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), b.building.doneAt, 'City', 'built', `${BUILDINGS[b.id].icon} ${BUILDINGS[b.id].label} stage ${st} is open: ${Math.round(perkOf(b.id, st) * 100)}% ${BUILDINGS[b.id].perkText}`]); }
    }
    if (n) await this.reload();
  }

  // ---------- approval ----------
  async rate(name: string, up: unknown) {
    await this.gate(name); const mayor = this.mayorOf(); const now = this.clock(); await mayor?.settle(now); const t = await mayor?.mayor(now);
    if (!t) throw new CityError('There is no sitting mayor to rate.'); if (t.key === playerKey(name)) throw new CityError('You can’t rate yourself.');
    const r = await this.pool.query('INSERT INTO city_approval (voter_key, day, week, up, at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [playerKey(name), abDayStart(now), t.week, up === true || up === 'up', now]);
    if (!r.rowCount) throw new CityError('You already rated the mayor today.'); return { up: up === true || up === 'up' };
  }
  async approval(week: string, now = this.clock()) {
    const r = await this.pool.query('SELECT up, voter_key FROM city_approval WHERE week = $1 AND at > $2', [week, now - APPROVAL_WINDOW_MS]);
    const up = r.rows.filter((x: any) => x.up).length, down = r.rows.length - up; const raters = new Set(r.rows.map((x: any) => x.voter_key)).size;
    return { up, down, raters, rating: up + down >= APPROVAL_MIN_VOTES ? up / (up + down) : null };
  }

  // ---------- recall ----------
  async recallBlock(name: string | null, now = this.clock()): Promise<string | undefined> {
    const t = await this.mayorOf()?.mayor(now); if (!t) return 'There is no sitting mayor.';
    if (now - t.startsAt < RECALL_GRACE_MS) return 'A recall can open 48 hours into a term.';
    if ((await this.pool.query('SELECT 1 FROM city_recalls WHERE week = $1', [t.week])).rows.length) return 'There has already been a recall this term.';
    const a = await this.approval(t.week, now); if (a.raters < RECALL_MIN_RATERS) return `A recall needs at least ${RECALL_MIN_RATERS} people rating the mayor this week.`;
    if ((a.rating ?? 1) >= RECALL_MAX_APPROVAL) return `A recall needs approval under ${Math.round(RECALL_MAX_APPROVAL * 100)}%.`;
    if (name && t.key === playerKey(name)) return 'You can’t recall yourself.';
    return undefined;
  }
  async openRecall(name: string) {
    await this.gate(name); const now = this.clock(); const why = await this.recallBlock(name, now); if (why) throw new CityError(why);
    const t = (await this.mayorOf()!.mayor(now))!; const id = randomUUID();
    let w: ReturnType<CasinoBank['transferAtomic']>;
    try { w = this.bank().transferAtomic([{ name, amount: -RECALL_FEE, key: `recall_fee:${t.week}`, game: 'recall_fee', memo: `Opened a recall vote against Mayor ${t.name}` }]); }
    catch (e) { throw new CityError(/chips|balance/i.test((e as Error).message) ? 'Not enough chips.' : 'Something went wrong. Nothing was charged.'); }
    const p = (async () => { await w.after; await this.run([
      { sql: 'INSERT INTO city_recalls (id, week, opened_by, opened_at, ends_at) VALUES ($1,$2,$3,$4,$5)', args: [id, t.week, name.trim(), now, now + RECALL_VOTE_MS] },
      { sql: 'INSERT INTO city_recall_votes (recall_id, voter_key, yes, at) VALUES ($1,$2,true,$3)', args: [id, playerKey(name), now] },
      ...treasuryCreditStmts('recall_fee', RECALL_FEE, `Recall fee from ${name.trim()}`, now), this.actionStmt(name.trim(), 'recall_open', `Recall vote opened against Mayor ${t.name} (24 h)`, now), ...w.stmts]); })();
    w.bind(p);
    try { await p; } catch (e) { w.revert(); if (e instanceof CityError) throw e; if (/duplicate|unique/i.test((e as Error).message)) throw new CityError('There has already been a recall this term.'); throw new CityError('Something went wrong. Nothing was charged.'); }
    await this.reload(); return { recall: id, fee: RECALL_FEE };
  }
  async voteRecall(name: string, yes: unknown) {
    await this.gate(name); const now = this.clock(); const r = await this.openRecallRow(now); if (!r) throw new CityError('There is no recall vote open.');
    const t = await this.mayorOf()?.mayor(now); if (t && t.key === playerKey(name)) throw new CityError('You can’t vote in your own recall.');
    const ins = await this.pool.query('INSERT INTO city_recall_votes (recall_id, voter_key, yes, at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [r.id, playerKey(name), yes === true || yes === 'yes', now]);
    if (!ins.rowCount) throw new CityError('You already voted in this recall.'); return { yes: yes === true || yes === 'yes' };
  }
  private async openRecallRow(now: number) { const r = (await this.pool.query('SELECT * FROM city_recalls WHERE result IS NULL AND ends_at > $1 ORDER BY opened_at DESC LIMIT 1', [now])).rows[0]; return r ? { id: String(r.id), week: String(r.week), endsAt: Number(r.ends_at) } : null; }
  /** Close finished recalls once (result IS NULL guard). Passed -> mayor removed, runner-up takes the rest of the term, levers reset, policy cancelled. */
  async settleRecalls(now = this.clock()) {
    const due = (await this.pool.query('SELECT * FROM city_recalls WHERE result IS NULL AND ends_at <= $1', [now])).rows as any[];
    for (const r of due) {
      const v = (await this.pool.query('SELECT yes FROM city_recall_votes WHERE recall_id = $1', [r.id])).rows as any[]; const yes = v.filter((x) => x.yes).length, no = v.length - yes;
      const week = String(r.week); const turnout = Number((await this.pool.query('SELECT count(*) AS n FROM mayor_votes WHERE week = $1', [week])).rows[0]?.n ?? 0);
      const pass = recallPasses(yes, no, turnout); const at = Number(r.ends_at);
      const term = (await this.pool.query('SELECT * FROM mayor_terms WHERE week = $1', [week])).rows[0] as any;
      const ru = pass && term ? pickWinner((await this.mayorOf()!.tallied(week)).filter((c) => c.key !== String(term.player_key))) : null;
      try {
        await this.run([], async (cl) => {
          const u = await cl.query('UPDATE city_recalls SET result = $2, yes = $3, no = $4 WHERE id = $1 AND result IS NULL', [r.id, pass ? 'passed' : 'failed', yes, no]); if (!u.rowCount) throw new CityError('settled');
          const text = pass ? `Recall PASSED (${yes}–${no}): Mayor ${term?.name ?? '?'} removed.${ru ? ` Runner-up ${ru.name} takes over.` : ' No runner-up: City Hall runs on defaults.'}` : `Recall failed (${yes}–${no}, needed ${recallNeeded(turnout)} votes and 60% yes).`;
          await cl.query('INSERT INTO mayor_actions (id, at, by_name, kind, text) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), at, 'City', 'recall_result', text]);
          if (!pass || !term) return;
          await cl.query('UPDATE mayor_terms SET removed_at = $2, note = $3 WHERE week = $1 AND removed_at IS NULL', [week, at, `Recalled (${yes}–${no})`]);
          if (ru && Number(term.ends_at) > at) await cl.query('INSERT INTO mayor_terms (week, player_key, name, votes, starts_at, ends_at, note) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING', [`${week}-r`, ru.key, ru.name, ru.votes, at, Number(term.ends_at), 'Runner-up after recall']);
          for (const id of LEVER_IDS) await cl.query('INSERT INTO city_levers (id, lever, value, at, by_name) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), id, LEVERS[id].base, at, 'recall']);
          await cl.query('UPDATE city_policies SET ends_at = $1 WHERE starts_at <= $1 AND ends_at > $1', [at]);
          await cl.query('INSERT INTO mayor_rates (id, at, effective_at, by_name, property, fee, note) VALUES ($1,$2,$2,$3,1,1,$4)', [randomUUID(), at, 'admin', `Rates reset: ${term.name} recalled`]);
        });
      } catch (e) { if ((e as Error).message !== 'settled') throw e; }
      await this.mayorOf()?.reload();
    }
    if (due.length) await this.reload();
  }

  async view(name: string | null): Promise<CityView> {
    const now = this.clock(); await this.finish(now); await this.settleRecalls(now); const m = this.mayorOf(); await m?.settle(now); const term = await m?.mayor(now);
    const idx = this.index(); const [bal, led, flows] = await Promise.all([
      this.balance(), this.pool.query('SELECT * FROM city_treasury_ledger ORDER BY at DESC, id DESC LIMIT 30'),
      this.pool.query('SELECT amount FROM city_treasury_ledger WHERE at > $1', [now - 7 * DAY_MS]),
    ]);
    const ap = term ? await this.approval(term.week, now) : { up: 0, down: 0, raters: 0, rating: null };
    const rr = (await this.pool.query('SELECT * FROM city_recalls ORDER BY opened_at DESC LIMIT 1')).rows[0] as any;
    let recall: CityView['recall'] = null;
    if (rr && (rr.result == null || now - Number(rr.ends_at) < DAY_MS)) {
      const v = (await this.pool.query('SELECT yes FROM city_recall_votes WHERE recall_id = $1', [rr.id])).rows as any[];
      const turnout = Number((await this.pool.query('SELECT count(*) AS n FROM mayor_votes WHERE week = $1', [rr.week])).rows[0]?.n ?? 0);
      recall = { id: String(rr.id), endsAt: Number(rr.ends_at), yes: v.filter((x) => x.yes).length, no: v.filter((x) => !x.yes).length, needed: recallNeeded(turnout), result: rr.result ?? null };
    }
    const p = this.policy(now);
    const v: CityView = {
      now, index: idx,
      levers: Object.fromEntries(LEVER_IDS.map((id) => [id, { value: this.lever(id, now), pending: null, nextChangeAt: this.nextLeverAt(id) }])) as CityView['levers'],
      policy: p ? { id: p.policy, startsAt: p.startsAt, endsAt: p.endsAt, by: p.by } : null, nextPolicyAt: this.nextPolicyAt(),
      projects: PROJECT_IDS.map((id) => ({ id, cost: Math.round(PROJECTS[id].cost * idx), active: this.activeProject(id, now), nextAt: this.nextProjectAt(id), headroom: this.projectHeadroom(id, now) })),
      projectLog: [...(this.snap.projects ?? [])].reverse().slice(0, 20),
      treasury: { balance: bal, in7d: (flows.rows as any[]).reduce((s, x) => s + Math.max(0, Number(x.amount)), 0), out7d: (flows.rows as any[]).reduce((s, x) => s + Math.max(0, -Number(x.amount)), 0),
        ledger: (led.rows as any[]).map((x): TreasuryRow => ({ id: String(x.id), at: Number(x.at), kind: String(x.kind), amount: Number(x.amount), balance: Number(x.balance), memo: String(x.memo) })) },
      buildings: BUILDING_IDS.map((id) => { const b = this.snap.buildings.get(id)!; const s = stageAt(b, now); return { ...b, building: underConstruction(b, now) ? b.building : null, stage: s, stageNow: s, nextCost: s >= MAX_STAGE ? null : Math.round(BUILDINGS[id].stages[s]! * idx) }; }),
      approval: { up: ap.up, down: ap.down, rating: ap.rating }, recall, actions: this.actions.slice(0, 40),
    };
    if (name) {
      const k = playerKey(name); const ex = await this.excluded(name);
      const rated = term ? (await this.pool.query('SELECT 1 FROM city_approval WHERE voter_key = $1 AND day = $2', [k, abDayStart(now)])).rows.length > 0 : null;
      const rb = ex ?? (await this.recallBlock(name, now)); const voted = recall && !recall.result ? (await this.pool.query('SELECT 1 FROM city_recall_votes WHERE recall_id = $1 AND voter_key = $2', [recall.id, k])).rows.length > 0 : false;
      v.me = { excluded: !!ex, isMayor: !!term && term.key === k, ratedToday: rated, canRecall: !rb, recallReason: rb, votedRecall: voted };
    }
    return v;
  }
}

let cityInst: City | null = null;
export const getCity = () => cityInst;
export const setCityForTest = (c: City | null) => { cityInst = c; setCityRates(c); };
export async function initCity(url: string | undefined): Promise<void> {
  if (!url) return;
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 }); pool.on('error', (e) => console.error('[city] pool error:', e.message));
  try { const c = new City(pool); await c.init(); cityInst = c; setCityRates(c); console.log('[city] ready'); } catch (e) { console.error('[city] init failed:', (e as Error).message); return; }
  setInterval(() => { void cityInst?.reload().then(() => cityInst?.finish()).catch(() => {}); }, 60_000).unref?.();
}
export function cityRouter() {
  const r = express.Router();
  r.get('/api/city', async (_req, res) => {
    res.set('Cache-Control', 'no-store'); if (!cityInst) return res.json({ ok: true, live: false });
    try { res.json({ ok: true, live: true, view: await cityInst.view(null) }); } catch { res.status(503).json({ ok: false, error: 'City Hall is closed right now.' }); }
  });
  r.get('/api/admin/city/treasury', async (req, res) => {
    const { adminAuthorized } = await import('./admin.js');
    if (!adminAuthorized(req.get('authorization'))) return res.status(401).json({ ok: false, error: 'Unauthorized.' });
    if (!cityInst) return res.status(503).json({ ok: false }); res.json({ ok: true, balance: await cityInst.balance() });
  });
  return r;
}
/** Alberta time, like the rest of the game's clocks. */
export function abTime(ms: number): string { return new Date(ms).toLocaleString('en-US', { timeZone: 'America/Edmonton', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' AB'; }
type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerCity(_io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const need = () => { const n = nameOf(); if (!n) throw new CityError('Sign in to take part.'); return n; };
  const on = (ev: string, fn: (b: Record<string, unknown>, c: City) => Promise<object>) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    try { if (!cityInst) throw new CityError('City Hall is closed right now.'); const r = await fn(b, cityInst); ack?.({ ok: true, ...r, city: await cityInst.view(nameOf()) }); }
    catch (e) { let city: CityView | undefined; try { city = cityInst ? await cityInst.view(nameOf()) : undefined; } catch { /* */ } ack?.({ ok: false, error: e instanceof CityError ? e.message : 'Something went wrong.', city }); if (!(e instanceof CityError)) console.error('[city]', e); }
  });
  on('city_view', async () => ({}));
  on('city_lever', async (b, c) => c.setLever(need(), b.lever, b.value));
  on('city_policy', async (b, c) => c.startPolicy(need(), b.policy));
  on('city_build', async (b, c) => c.build(need(), b.building));
  on('city_project', async (b, c) => c.startProject(need(), b.project, b.requestId));
  on('city_rate', async (b, c) => c.rate(need(), b.up));
  on('city_recall', async (_b, c) => c.openRecall(need()));
  on('city_recall_vote', async (b, c) => c.voteRecall(need(), b.yes));
}
