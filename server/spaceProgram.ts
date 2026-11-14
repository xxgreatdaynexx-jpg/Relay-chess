/**
 * Chud Space Center program: saved designs, paid launches, and deployed satellites.
 *
 * The flight itself is simulated on the client. A deploy claim is accepted when the
 * paid design is orbit-capable (vacuum Δv ≥ 3,400 m/s, liftoff TWR ≥ 1.15, a satellite
 * on the stack) and a launch ticket is still valid. That is a reasonable anti-cheat
 * without re-simulating every manual flight on the server.
 *
 * Economy (conservative): launching costs the part list (price-indexed). A successful
 * deploy pays SPACE_PAYOUT chips, at most SPACE_MAX_PAID times per player (lifetime).
 * After the cap, satellites still count for prestige and the leaderboard, but pay nothing.
 * That bounty is independent of the daily contract board: mission payouts are a separate
 * purse, capped per UTC day, and a flight may collect both when it qualifies.
 * QA accounts can fly; they never receive either payout. Additive tables only.
 */
import { randomUUID } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { bootAttach, setBootState } from './boot-retry.js';
import { databaseUrl } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { px } from './price-index.js';
import {
  parseDesign, designHash, designCost, validateDesign, hasErrors, cloneDesign,
  STOCK_DESIGNS, SPACE_MAX_DESIGNS, type VesselDesign,
} from '../shared/spaceParts.js';
import {
  analyzeDesign, LEO_DV_BUDGET, MIN_LIFTOFF_TWR, PLANET,
  SPACE_PAYOUT, SPACE_MAX_PAID, SPACE_COOLDOWN_MS, SPACE_LAUNCH_TTL_MS,
  type DesignStats,
} from '../shared/spaceFlight.js';
import {
  dailyBoard, missionById, utcDay, evaluateCompletion, payoutAfterCap, designMeetsMission,
  MISSION_MAX_ACTIVE, MISSION_DAILY_CAP,
  type MissionDef, type FlightReport,
} from '../shared/spaceMissions.js';
import { SpaceResearch, ResearchError, SPACE_RESEARCH_MIGRATION } from './spaceResearch.js';
export { SPACE_RESEARCH_MIGRATION };

export class SpaceError extends Error {}
const keyOf = (n: string) => n.trim().toLowerCase();
const isQa = (k: string) => k.startsWith('qa-');

export const SPACE_MIGRATION = `
CREATE TABLE IF NOT EXISTS space_designs (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  name TEXT NOT NULL,
  design JSONB NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS space_designs_owner ON space_designs (owner_key);
CREATE TABLE IF NOT EXISTS space_launches (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  design_hash TEXT NOT NULL,
  design JSONB NOT NULL,
  cost BIGINT NOT NULL,
  at BIGINT NOT NULL,
  deployed BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS space_launches_owner ON space_launches (owner_key, at);
CREATE TABLE IF NOT EXISTS space_satellites (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  sat_id TEXT NOT NULL,
  sat_name TEXT NOT NULL,
  design_name TEXT NOT NULL,
  pe_m DOUBLE PRECISION NOT NULL,
  ap_m DOUBLE PRECISION NOT NULL,
  period_s DOUBLE PRECISION,
  paid BOOLEAN NOT NULL,
  payout BIGINT NOT NULL,
  deployed_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS space_satellites_owner ON space_satellites (owner_key);
CREATE INDEX IF NOT EXISTS space_satellites_board ON space_satellites (deployed_at);
`;

/** Additive: contract board, payout ledger, and a mission id on launch tickets. */
export const SPACE_MISSION_MIGRATION = `
ALTER TABLE space_launches ADD COLUMN IF NOT EXISTS mission_id TEXT;
CREATE TABLE IF NOT EXISTS space_contracts (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  day TEXT NOT NULL,
  accepted_at BIGINT NOT NULL,
  completed_at BIGINT,
  payout BIGINT NOT NULL DEFAULT 0,
  launch_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS space_contracts_owner_mission ON space_contracts (owner_key, mission_id);
CREATE INDEX IF NOT EXISTS space_contracts_owner_day ON space_contracts (owner_key, day);
CREATE TABLE IF NOT EXISTS space_contract_payouts (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  day TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  amount BIGINT NOT NULL,
  at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS space_contract_payouts_owner_day ON space_contract_payouts (owner_key, day);
`;

type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
type PoolLike = Q & { connect: () => Promise<Q & { release: () => void }> };

export interface SavedDesign { id: string; name: string; design: VesselDesign; updatedAt: number }
export interface SatRow {
  id: string; ownerKey: string; ownerName: string; satId: string; satName: string;
  designName: string; peM: number; apM: number; periodS: number | null;
  paid: boolean; payout: number; deployedAt: number;
}
export interface LaunchTicket { id: string; ownerKey: string; hash: string; design: VesselDesign; cost: number; at: number; deployed: boolean; missionId?: string | null }
export interface BoardRow { name: string; sats: number; lastAt: number }
export interface ContractRow {
  id: string; ownerKey: string; missionId: string; day: string;
  acceptedAt: number; completedAt: number | null; payout: number; launchId: string | null;
}


const asDesign = (r: Record<string, unknown>): SavedDesign | null => {
  const design = parseDesign(r.design);
  if (!design) return null;
  return { id: String(r.id), name: String(r.name), design, updatedAt: Number(r.updated_at) };
};
const asSat = (r: Record<string, unknown>): SatRow => ({
  id: String(r.id), ownerKey: String(r.owner_key), ownerName: String(r.owner_name),
  satId: String(r.sat_id), satName: String(r.sat_name), designName: String(r.design_name),
  peM: Number(r.pe_m), apM: Number(r.ap_m), periodS: r.period_s == null ? null : Number(r.period_s),
  paid: r.paid === true || r.paid === 't' || r.paid === 'true', payout: Number(r.payout), deployedAt: Number(r.deployed_at),
});
const asLaunch = (r: Record<string, unknown>): LaunchTicket | null => {
  const design = parseDesign(r.design);
  if (!design) return null;
  return {
    id: String(r.id), ownerKey: String(r.owner_key), hash: String(r.design_hash), design,
    cost: Number(r.cost), at: Number(r.at),
    deployed: r.deployed === true || r.deployed === 't' || r.deployed === 'true',
    missionId: r.mission_id ? String(r.mission_id) : null,
  };
};

export function requireCapable(design: VesselDesign): DesignStats {
  const issues = validateDesign(design);
  if (hasErrors(issues)) throw new SpaceError(issues.find((i) => i.level === 'error')!.text);
  const stats = analyzeDesign(design);
  if (stats.liftoffTwr < MIN_LIFTOFF_TWR) {
    throw new SpaceError(`Liftoff TWR is ${stats.liftoffTwr.toFixed(2)}. You need at least ${MIN_LIFTOFF_TWR} to climb out.`);
  }
  if (stats.totalDvVac < LEO_DV_BUDGET) {
    throw new SpaceError(`Vacuum Δv is ${Math.round(stats.totalDvVac)} m/s. About ${LEO_DV_BUDGET} m/s is needed to reach orbit.`);
  }
  if (!stats.payloads.length) throw new SpaceError('The rocket has no satellite to deploy.');
  return stats;
}

/** Any vehicle that can leave the pad — used for sounding flights and free practice. */
export function requireLaunchable(design: VesselDesign): DesignStats {
  const issues = validateDesign(design);
  if (hasErrors(issues)) throw new SpaceError(issues.find((i) => i.level === 'error')!.text);
  const stats = analyzeDesign(design);
  if (stats.liftoffTwr < MIN_LIFTOFF_TWR) {
    throw new SpaceError(`Liftoff TWR is ${stats.liftoffTwr.toFixed(2)}. You need at least ${MIN_LIFTOFF_TWR} to climb out.`);
  }
  return stats;
}

const asContract = (r: Record<string, unknown>): ContractRow => ({
  id: String(r.id), ownerKey: String(r.owner_key), missionId: String(r.mission_id),
  day: String(r.day), acceptedAt: Number(r.accepted_at),
  completedAt: r.completed_at == null ? null : Number(r.completed_at),
  payout: Number(r.payout ?? 0),
  launchId: r.launch_id == null ? null : String(r.launch_id),
});

export class SpaceProgram {
  private memDesigns = new Map<string, SavedDesign[]>(); // owner -> list
  private memLaunches = new Map<string, LaunchTicket>();
  private memSats: SatRow[] = [];
  private memContracts: ContractRow[] = [];
  private memMissionPayouts: Array<{ id: string; ownerKey: string; day: string; missionId: string; amount: number; at: number }> = [];
  readonly research: SpaceResearch;
  constructor(private readonly pool: PoolLike | null, private readonly clock = () => Date.now()) {
    this.research = new SpaceResearch(pool, clock);
  }
  async init() {
    if (this.pool) {
      await this.pool.query(SPACE_MIGRATION);
      await this.pool.query(SPACE_MISSION_MIGRATION);
    }
    await this.research.init();
  }

  private async wrapResearch<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (e) {
      if (e instanceof ResearchError) throw new SpaceError(e.message);
      throw e;
    }
  }

  async runScience(name: string, body: Record<string, unknown>) {
    if (typeof body.launchId !== 'string' || !body.launchId) throw new SpaceError('Missing launch ticket.');
    const k = keyOf(name);
    const L = await this.launchOf(body.launchId, k);
    return this.wrapResearch(() => this.research.runScience(name, k, L, body));
  }

  async unlockTech(name: string, nodeId: unknown) {
    return this.wrapResearch(() => this.research.unlock(keyOf(name), nodeId));
  }

  async syncSurvey(name: string) {
    return this.wrapResearch(() => this.research.syncSurvey(name, keyOf(name)));
  }

  async designsOf(name: string): Promise<SavedDesign[]> {
    const k = keyOf(name);
    if (this.pool) {
      const rows = (await this.pool.query('SELECT * FROM space_designs WHERE owner_key = $1 ORDER BY updated_at DESC', [k])).rows;
      return rows.map(asDesign).filter((d): d is SavedDesign => !!d);
    }
    return [...(this.memDesigns.get(k) ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async saveDesign(name: string, raw: unknown, id?: unknown): Promise<SavedDesign> {
    const design = parseDesign(raw);
    if (!design) throw new SpaceError('That design could not be read.');
    const issues = validateDesign(design);
    if (hasErrors(issues)) throw new SpaceError(issues.find((i) => i.level === 'error')!.text);
    const k = keyOf(name);
    const existing = await this.designsOf(name);
    let sid = typeof id === 'string' && id.trim() ? id.trim().slice(0, 40) : '';
    const found = sid ? existing.find((d) => d.id === sid) : undefined;
    if (sid && !found) throw new SpaceError('That saved design was not found.');
    if (!sid) {
      if (existing.length >= SPACE_MAX_DESIGNS) throw new SpaceError(`You can save at most ${SPACE_MAX_DESIGNS} designs. Delete one first.`);
      sid = randomUUID();
    }
    const row: SavedDesign = { id: sid, name: design.name, design: cloneDesign(design), updatedAt: this.clock() };
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO space_designs (id, owner_key, name, design, updated_at) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, design = EXCLUDED.design, updated_at = EXCLUDED.updated_at
         WHERE space_designs.owner_key = $2`,
        [row.id, k, row.name, row.design, row.updatedAt],
      );
    } else {
      const list = this.memDesigns.get(k) ?? [];
      const i = list.findIndex((d) => d.id === row.id);
      if (i >= 0) list[i] = row; else list.push(row);
      this.memDesigns.set(k, list);
    }
    return row;
  }

  async deleteDesign(name: string, id: unknown): Promise<void> {
    if (typeof id !== 'string' || !id) throw new SpaceError('Which design?');
    const k = keyOf(name);
    if (this.pool) {
      const r = await this.pool.query('DELETE FROM space_designs WHERE id = $1 AND owner_key = $2', [id, k]);
      if ((r.rowCount ?? 0) === 0) throw new SpaceError('That saved design was not found.');
    } else {
      const list = this.memDesigns.get(k) ?? [];
      const n = list.length;
      this.memDesigns.set(k, list.filter((d) => d.id !== id));
      if ((this.memDesigns.get(k) ?? []).length === n) throw new SpaceError('That saved design was not found.');
    }
  }

  async lastLaunchAt(k: string): Promise<number> {
    if (this.pool) {
      const r = (await this.pool.query('SELECT MAX(at) AS at FROM space_launches WHERE owner_key = $1', [k])).rows[0];
      return r && r.at != null ? Number(r.at) : 0;
    }
    let t = 0;
    for (const L of this.memLaunches.values()) if (L.ownerKey === k && L.at > t) t = L.at;
    return t;
  }

  async paidCount(k: string): Promise<number> {
    if (this.pool) {
      const r = (await this.pool.query('SELECT COUNT(*)::int AS n FROM space_satellites WHERE owner_key = $1 AND paid = true', [k])).rows[0];
      return Number(r?.n ?? 0);
    }
    return this.memSats.filter((s) => s.ownerKey === k && s.paid).length;
  }

  async satsOf(k?: string): Promise<SatRow[]> {
    if (this.pool) {
      const q = k
        ? await this.pool.query('SELECT * FROM space_satellites WHERE owner_key = $1 ORDER BY deployed_at DESC', [k])
        : await this.pool.query('SELECT * FROM space_satellites ORDER BY deployed_at DESC LIMIT 200');
      return q.rows.map(asSat);
    }
    const all = k ? this.memSats.filter((s) => s.ownerKey === k) : this.memSats;
    return [...all].sort((a, b) => b.deployedAt - a.deployedAt);
  }

  async board(): Promise<BoardRow[]> {
    const sats = await this.satsOf();
    const map = new Map<string, BoardRow>();
    for (const s of sats) {
      const cur = map.get(s.ownerKey) ?? { name: s.ownerName, sats: 0, lastAt: 0 };
      cur.sats += 1;
      if (s.deployedAt > cur.lastAt) cur.lastAt = s.deployedAt;
      cur.name = s.ownerName;
      map.set(s.ownerKey, cur);
    }
    return [...map.values()].sort((a, b) => b.sats - a.sats || b.lastAt - a.lastAt).slice(0, 50);
  }

  async view(name: string | null) {
    const k = name ? keyOf(name) : null;
    const bank = getBank();
    const chips = name && bank.ready ? bank.account(name).chips : null;
    const designs = name ? await this.designsOf(name) : [];
    const sats = k ? await this.satsOf(k) : [];
    const paid = k ? await this.paidCount(k) : 0;
    const last = k ? await this.lastLaunchAt(k) : 0;
    const now = this.clock();
    const cooldownLeft = k ? Math.max(0, SPACE_COOLDOWN_MS - (now - last)) : 0;
    const payout = px(SPACE_PAYOUT);
    const day = utcDay(now);
    const missions = await this.missionView(k, day, now);
    const science = await this.research.scienceView(k, now);
    const survey = await this.research.surveyView(k);
    return {
      signedIn: !!name, chips,
      designs, sats, board: await this.board(),
      stock: STOCK_DESIGNS.map((d) => ({ name: d.name, design: d, stats: analyzeDesign(d), cost: px(designCost(d)) })),
      planet: {
        name: PLANET.name, radius: PLANET.radius, g0: PLANET.g0, mu: PLANET.mu,
        atmHeight: PLANET.atmHeight, parkAltitude: PLANET.parkAltitude, day: PLANET.day,
      },
      rules: {
        leoDv: LEO_DV_BUDGET, minTwr: MIN_LIFTOFF_TWR,
        payout, maxPaid: SPACE_MAX_PAID, paid, remainingPaid: Math.max(0, SPACE_MAX_PAID - paid),
        cooldownMs: SPACE_COOLDOWN_MS, cooldownLeft, launchTtlMs: SPACE_LAUNCH_TTL_MS,
      },
      missions,
      science,
      survey,
      now,
    };
  }

  async launch(name: string, raw: unknown, missionId?: unknown) {
    const design = parseDesign(raw);
    if (!design) throw new SpaceError('That design could not be read.');
    requireLaunchable(design);
    const k = keyOf(name);
    await this.wrapResearch(() => this.research.requireUnlocked(k, design));
    const now = this.clock();
    const mid = typeof missionId === 'string' && missionId.trim() ? missionId.trim() : null;
    if (mid) {
      const m = missionById(mid);
      if (!m || m.day !== utcDay(now)) throw new SpaceError('That contract is not on today\'s board.');
      const accepted = (await this.contractsOf(k, m.day)).find((c) => c.missionId === mid);
      if (!accepted) throw new SpaceError('Accept the contract before rolling out.');
      if (accepted.completedAt) throw new SpaceError('You already completed that contract today.');
      const why = designMeetsMission(design, m);
      if (why) throw new SpaceError(why);
    }
    const last = await this.lastLaunchAt(k);
    const wait = SPACE_COOLDOWN_MS - (now - last);
    if (last > 0 && wait > 0) {
      const s = Math.ceil(wait / 1000);
      throw new SpaceError(`The pad is cooling down. Try again in ${s} second${s === 1 ? '' : 's'}.`);
    }
    const cost = px(designCost(design));
    if (cost < 1) throw new SpaceError('That rocket has no cost, which cannot be right.');
    const bank = getBank();
    if (!bank.canAfford(name, cost)) throw new SpaceError('Not enough chips.');
    const id = randomUUID();
    const hash = designHash(design);
    const ticket: LaunchTicket = { id, ownerKey: k, hash, design: cloneDesign(design), cost, at: now, deployed: false, missionId: mid };
    const w = bank.transferAtomic([{ name, amount: -cost, key: `space_launch:${id}`, game: 'space_launch', memo: `Space Center launch: ${design.name}` }]);
    const run = async () => {
      if (!this.pool) { this.memLaunches.set(id, ticket); return; }
      await w.after;
      const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        await cl.query(
          'INSERT INTO space_launches (id, owner_key, design_hash, design, cost, at, deployed, mission_id) VALUES ($1,$2,$3,$4,$5,$6,false,$7)',
          [id, k, hash, ticket.design, cost, now, mid],
        );
        for (const s of w.stmts) await cl.query(s.sql, s.args);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; }
      finally { cl.release(); }
    };
    const p = run(); w.bind(p);
    try { await p; } catch (e) {
      w.revert();
      console.error('[space] launch failed:', (e as Error).message);
      throw new SpaceError(/chips|balance/i.test((e as Error).message) ? 'Not enough chips.' : 'Launch checkout failed. Nothing was charged.');
    }
    return { launchId: id, cost, chips: bank.account(name).chips, hash, design: ticket.design, stats: analyzeDesign(design), ttlMs: SPACE_LAUNCH_TTL_MS };
  }

  private async launchOf(id: string, k: string): Promise<LaunchTicket> {
    if (this.pool) {
      const r = (await this.pool.query('SELECT * FROM space_launches WHERE id = $1 AND owner_key = $2', [id, k])).rows[0];
      const L = r ? asLaunch(r) : null;
      if (!L) throw new SpaceError('That launch ticket was not found.');
      return L;
    }
    const L = this.memLaunches.get(id);
    if (!L || L.ownerKey !== k) throw new SpaceError('That launch ticket was not found.');
    return L;
  }

  async deploy(name: string, body: { launchId?: unknown; peM?: unknown; apM?: unknown; periodS?: unknown; satId?: unknown }) {
    if (typeof body.launchId !== 'string' || !body.launchId) throw new SpaceError('Missing launch ticket.');
    const k = keyOf(name);
    const L = await this.launchOf(body.launchId, k);
    const now = this.clock();
    if (L.deployed) throw new SpaceError('That launch already deployed a satellite.');
    if (now - L.at > SPACE_LAUNCH_TTL_MS) throw new SpaceError('That launch ticket has expired. Roll out a new rocket.');
    const stats = requireCapable(L.design);
    // Recorded elements are informational; we do not trust them for the payout decision.
    const peM = typeof body.peM === 'number' && Number.isFinite(body.peM) ? body.peM : PLANET.parkAltitude;
    const apM = typeof body.apM === 'number' && Number.isFinite(body.apM) ? Math.max(body.apM, peM) : Math.max(peM, PLANET.parkAltitude);
    const periodS = typeof body.periodS === 'number' && Number.isFinite(body.periodS) && body.periodS > 0 ? body.periodS : null;
    const satName = stats.payloads[0] ?? 'Satellite';
    const satId = typeof body.satId === 'string' && body.satId ? body.satId.slice(0, 40) : (L.design.parts.find((p) => {
      // first payload id
      return true;
    }) ? (L.design.parts.find((p) => p.partId === 'commsat' || p.partId === 'scisat' || p.partId === 'weathersat')?.partId ?? 'commsat') : 'commsat');
    const paidSoFar = await this.paidCount(k);
    const qa = isQa(k);
    const canPay = !qa && paidSoFar < SPACE_MAX_PAID;
    const payout = canPay ? px(SPACE_PAYOUT) : 0;
    const sid = randomUUID();
    const row: SatRow = {
      id: sid, ownerKey: k, ownerName: name.trim(), satId, satName, designName: L.design.name,
      peM, apM, periodS, paid: payout > 0, payout, deployedAt: now,
    };
    const bank = getBank();
    const w = payout > 0
      ? bank.transferAtomic([{ name, amount: payout, key: `space_deploy:${sid}`, game: 'space_deploy', memo: `Satellite deploy: ${satName}` }])
      : null;
    const run = async () => {
      if (!this.pool) {
        L.deployed = true;
        this.memLaunches.set(L.id, L);
        this.memSats.push(row);
        return;
      }
      if (w) await w.after;
      const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        const up = await cl.query('UPDATE space_launches SET deployed = true WHERE id = $1 AND owner_key = $2 AND deployed = false', [L.id, k]);
        if ((up.rowCount ?? 0) === 0) throw new SpaceError('That launch already deployed a satellite.');
        await cl.query(
          `INSERT INTO space_satellites (id, owner_key, owner_name, sat_id, sat_name, design_name, pe_m, ap_m, period_s, paid, payout, deployed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [sid, k, name.trim(), satId, satName, L.design.name, peM, apM, periodS, payout > 0, payout, now],
        );
        if (w) for (const s of w.stmts) await cl.query(s.sql, s.args);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; }
      finally { cl.release(); }
    };
    const p = run(); w?.bind(p);
    try { await p; } catch (e) {
      w?.revert();
      if (e instanceof SpaceError) throw e;
      console.error('[space] deploy failed:', (e as Error).message);
      throw new SpaceError('Deploy could not be recorded. Try again.');
    }
    const mappers = await this.research.registerMappers(k, L, peM, apM, periodS);
    return {
      satellite: row, payout, chips: bank.ready ? bank.account(name).chips : null,
      paidCount: paidSoFar + (payout > 0 ? 1 : 0),
      prestigeOnly: payout === 0,
      mappers: mappers.map((m) => ({ id: m.id, mapType: m.mapType })),
    };
  }

  async contractsOf(k: string, day?: string): Promise<ContractRow[]> {
    if (this.pool) {
      const q = day
        ? await this.pool.query('SELECT * FROM space_contracts WHERE owner_key = $1 AND day = $2 ORDER BY accepted_at', [k, day])
        : await this.pool.query('SELECT * FROM space_contracts WHERE owner_key = $1 ORDER BY accepted_at', [k]);
      return q.rows.map(asContract);
    }
    return this.memContracts.filter((c) => c.ownerKey === k && (!day || c.day === day)).sort((a, b) => a.acceptedAt - b.acceptedAt);
  }

  async missionPaidToday(k: string, day: string): Promise<number> {
    if (this.pool) {
      const r = (await this.pool.query(
        'SELECT COALESCE(SUM(amount), 0)::bigint AS n FROM space_contract_payouts WHERE owner_key = $1 AND day = $2',
        [k, day],
      )).rows[0];
      return Number(r?.n ?? 0);
    }
    return this.memMissionPayouts.filter((p) => p.ownerKey === k && p.day === day).reduce((s, p) => s + p.amount, 0);
  }

  async missionView(k: string | null, day: string, now: number) {
    const board = dailyBoard(day).map((m) => ({ ...m, payout: px(m.payout) }));
    const cap = px(MISSION_DAILY_CAP);
    if (!k) {
      return {
        day, board, accepted: [] as ContractRow[], completedIds: [] as string[],
        paidToday: 0, dailyCap: cap, remainingCap: cap, maxActive: MISSION_MAX_ACTIVE,
      };
    }
    const mine = await this.contractsOf(k, day);
    const paidToday = await this.missionPaidToday(k, day);
    return {
      day, board, accepted: mine,
      completedIds: mine.filter((c) => c.completedAt).map((c) => c.missionId),
      paidToday, dailyCap: cap, remainingCap: Math.max(0, cap - paidToday),
      maxActive: MISSION_MAX_ACTIVE, now,
    };
  }

  async acceptMission(name: string, missionId: unknown) {
    const mid = typeof missionId === 'string' ? missionId.trim() : '';
    const m = missionById(mid);
    const now = this.clock();
    const day = utcDay(now);
    if (!m || m.day !== day) throw new SpaceError("That contract is not on today's board.");
    if (!dailyBoard(day).some((x) => x.id === m.id)) throw new SpaceError("That contract is not on today's board.");
    const k = keyOf(name);
    const mine = await this.contractsOf(k, day);
    const existing = mine.find((c) => c.missionId === m.id);
    if (existing) {
      if (existing.completedAt) throw new SpaceError('You already flew that contract today.');
      throw new SpaceError('You already accepted that contract.');
    }
    const active = mine.filter((c) => !c.completedAt);
    if (active.length >= MISSION_MAX_ACTIVE) {
      throw new SpaceError(`You can have at most ${MISSION_MAX_ACTIVE} open contracts. Complete or wait for tomorrow's board.`);
    }
    const row: ContractRow = {
      id: randomUUID(), ownerKey: k, missionId: m.id, day,
      acceptedAt: now, completedAt: null, payout: 0, launchId: null,
    };
    if (this.pool) {
      try {
        await this.pool.query(
          `INSERT INTO space_contracts (id, owner_key, mission_id, day, accepted_at, completed_at, payout, launch_id)
           VALUES ($1,$2,$3,$4,$5,NULL,0,NULL)`,
          [row.id, k, row.missionId, day, now],
        );
      } catch (e) {
        if (/unique|duplicate/i.test((e as Error).message)) throw new SpaceError('You already accepted that contract.');
        throw e;
      }
    } else {
      this.memContracts.push(row);
    }
    return { contract: row, mission: { ...m, payout: px(m.payout) } };
  }

  async completeMission(name: string, body: {
    launchId?: unknown; missionId?: unknown;
    peM?: unknown; apM?: unknown; periodS?: unknown;
    altitudeM?: unknown; eccentricity?: unknown;
    deployed?: unknown; deployedCount?: unknown; flightTimeS?: unknown;
  }) {
    if (typeof body.launchId !== 'string' || !body.launchId) throw new SpaceError('Missing launch ticket.');
    if (typeof body.missionId !== 'string' || !body.missionId) throw new SpaceError('Missing contract.');
    const k = keyOf(name);
    const now = this.clock();
    const day = utcDay(now);
    const m = missionById(body.missionId);
    if (!m || m.day !== day) throw new SpaceError('That contract has expired.');
    const accepted = (await this.contractsOf(k, day)).find((c) => c.missionId === m.id);
    if (!accepted) throw new SpaceError('Accept the contract before claiming it.');
    if (accepted.completedAt) throw new SpaceError('You already completed that contract today.');
    const L = await this.launchOf(body.launchId, k);
    const report: FlightReport = {
      peM: Number(body.peM),
      apM: Number(body.apM),
      periodS: body.periodS == null ? undefined : Number(body.periodS),
      altitudeM: body.altitudeM == null ? undefined : Number(body.altitudeM),
      eccentricity: body.eccentricity == null ? undefined : Number(body.eccentricity),
      deployed: body.deployed === true,
      deployedCount: body.deployedCount == null ? undefined : Number(body.deployedCount),
      flightTimeS: body.flightTimeS == null ? undefined : Number(body.flightTimeS),
    };
    const ev = evaluateCompletion({
      mission: m,
      acceptedAt: accepted.acceptedAt,
      now,
      ticket: { at: L.at, cost: L.cost, design: L.design, missionId: L.missionId ?? null, ttlMs: SPACE_LAUNCH_TTL_MS },
      report,
      facts: {
        scannersDeployed: await this.research.mapTypesOfLaunch(L.id),
        science: (await this.research.scienceOfLaunch(L.id)).map((r) => ({ experimentId: r.experimentId, situation: r.situation, points: r.points })),
      },
    });
    if (!ev.ok) throw new SpaceError(ev.reason);
    const want = px(ev.payout);
    const paidToday = await this.missionPaidToday(k, day);
    const cap = px(MISSION_DAILY_CAP);
    let payout = payoutAfterCap(want, paidToday, cap);
    if (isQa(k)) payout = 0;
    const bank = getBank();
    const pid = randomUUID();
    const w = payout > 0
      ? bank.transferAtomic([{ name, amount: payout, key: `space_mission:${pid}`, game: 'space_mission', memo: `Space contract: ${m.title}` }])
      : null;
    const run = async () => {
      if (!this.pool) {
        accepted.completedAt = now;
        accepted.payout = payout;
        accepted.launchId = L.id;
        if (payout > 0) this.memMissionPayouts.push({ id: pid, ownerKey: k, day, missionId: m.id, amount: payout, at: now });
        return;
      }
      if (w) await w.after;
      const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        const upd = await cl.query(
          `UPDATE space_contracts SET completed_at = $1, payout = $2, launch_id = $3
           WHERE id = $4 AND owner_key = $5 AND completed_at IS NULL`,
          [now, payout, L.id, accepted.id, k],
        );
        if (!upd.rowCount) throw new SpaceError('You already completed that contract today.');
        if (payout > 0) {
          await cl.query(
            `INSERT INTO space_contract_payouts (id, owner_key, day, mission_id, amount, at) VALUES ($1,$2,$3,$4,$5,$6)`,
            [pid, k, day, m.id, payout, now],
          );
        }
        if (w) for (const s of w.stmts) await cl.query(s.sql, s.args);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; }
      finally { cl.release(); }
    };
    const p = run(); w?.bind(p);
    try { await p; } catch (e) {
      w?.revert();
      if (e instanceof SpaceError) throw e;
      console.error('[space] mission payout failed:', (e as Error).message);
      throw new SpaceError('The contract could not be settled. Try again.');
    }
    const capped = payout < want && !isQa(k);
    return {
      mission: { ...m, payout: want },
      payout,
      want,
      capped,
      prestigeOnly: payout === 0,
      chips: bank.ready ? bank.account(name).chips : null,
      paidToday: paidToday + payout,
      remainingCap: Math.max(0, cap - paidToday - payout),
      dailyCap: cap,
    };
  }
}

let program: SpaceProgram | null = null;
export const getSpaceProgram = () => program;
export const setSpaceProgram = (p: SpaceProgram | null) => { program = p; };

export async function initSpaceProgram(): Promise<void> {
  const url = databaseUrl();
  if (!url) { setSpaceProgram(new SpaceProgram(null)); setBootState('space', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[space] pool error:', e.message));
  await bootAttach('space', async () => {
    try {
      const p = new SpaceProgram(pool as unknown as PoolLike);
      await p.init();
      setSpaceProgram(p);
      console.log('[space] ready');
      return true;
    } catch (e) {
      console.error('[space] init failed:', (e as Error).message);
      return false;
    }
  });
}

export function spaceRouter() {
  const r = express.Router();
  r.get('/api/space', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!program) return res.json({ ok: true, live: false, board: [], stock: STOCK_DESIGNS.map((d) => ({ name: d.name, design: d, stats: analyzeDesign(d), cost: px(designCost(d)) })) });
      const v = await program.view(null);
      res.json({ ok: true, live: true, ...v });
    } catch (e) {
      console.error('[space] view failed:', (e as Error).message);
      res.status(500).json({ ok: false, error: 'Space program is unavailable.' });
    }
  });
  return r;
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerSpaceProgram(_io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const need = () => { const n = nameOf(); if (!n) throw new SpaceError('Sign in to use the Space Center.'); return n; };
  const on = (ev: string, fn: (b: Record<string, unknown>, p: SpaceProgram) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try {
      if (!program) throw new SpaceError('The Space Center is opening up. Try again in a moment.');
      const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      ack?.({ ok: true, ...((await fn(b, program)) as object ?? {}) });
    } catch (e) {
      ack?.({ ok: false, error: e instanceof SpaceError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' });
    }
  });
  on('space_view', async (_b, p) => p.view(nameOf()));
  on('space_save', async (b, p) => ({ design: await p.saveDesign(need(), b.design, b.id) }));
  on('space_delete', async (b, p) => { await p.deleteDesign(need(), b.id); return {}; });
  on('space_launch', async (b, p) => p.launch(need(), b.design, b.missionId));
  on('space_deploy', async (b, p) => p.deploy(need(), b));
  on('space_mission_accept', async (b, p) => p.acceptMission(need(), b.missionId));
  on('space_mission_complete', async (b, p) => p.completeMission(need(), b));
  on('space_science', async (b, p) => p.runScience(need(), b));
  on('space_tech_unlock', async (b, p) => p.unlockTech(need(), b.nodeId));
  on('space_survey_sync', async (_b, p) => p.syncSurvey(need()));
}
