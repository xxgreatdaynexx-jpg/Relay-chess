/**
 * Space Center research: science results, the tech tree, and planetary survey
 * coverage. Composed into SpaceProgram (same pool, clock, and bank patterns).
 *
 * Economy:
 *  - Science points are earned per experiment × situation × biome with
 *    diminishing returns (×0.5 per repeat). They unlock tech nodes.
 *  - Each new result also pays a small research grant (20 chips / point),
 *    capped at SCIENCE_GRANT_DAILY_CAP per player per UTC day. This is a
 *    separate small purse; science and mapping contracts pay from the existing
 *    daily contract cap.
 *  - Survey milestones (25/50/75/100% per map type) pay once per player for
 *    life, 7,500 per map, 37,500 if all five maps are completed.
 *  - QA accounts earn science and coverage but no chips.
 * Additive tables only.
 */
import { randomUUID } from 'node:crypto';
import { getBank } from './casino-store.js';
import { px } from './price-index.js';
import type { VesselDesign } from '../shared/spaceParts.js';
import { analyzeDesign, PLANET, SPACE_LAUNCH_TTL_MS } from '../shared/spaceFlight.js';
import { maxApoapsisFromDv, utcDay } from '../shared/spaceMissions.js';
import {
  EXPERIMENT_BY_ID, TECH_BY_ID, TECH_NODES, SCIENCE_GRANT_PER_POINT, SCIENCE_GRANT_DAILY_CAP,
  scienceValue, subjectBiome, subjectKey, subjectCeiling, validateScience, isPartUnlocked,
  unlockedParts, canUnlock, flavorText, type Situation,
} from '../shared/spaceScience.js';
import {
  SCANNER_BY_PART, SURVEY_ADVANCE_CAP_S, SURVEY_MILESTONE_PAYOUT, MAP_TYPE_INFO,
  advanceCoverage, coveragePct, emptyGrid, gridFromBytes, mapperFromOrbit, dueMilestones,
  type MapType, type MapperState,
} from '../shared/spaceSurvey.js';

export class ResearchError extends Error {}
const isQa = (k: string) => k.startsWith('qa-');

export const SPACE_RESEARCH_MIGRATION = `
CREATE TABLE IF NOT EXISTS space_science (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  launch_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  experiment_id TEXT NOT NULL,
  situation TEXT NOT NULL,
  biome TEXT NOT NULL,
  part_uid TEXT NOT NULL,
  points DOUBLE PRECISION NOT NULL,
  grant_chips BIGINT NOT NULL DEFAULT 0,
  day TEXT NOT NULL,
  at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS space_science_launch_subject ON space_science (launch_id, subject);
CREATE INDEX IF NOT EXISTS space_science_owner ON space_science (owner_key, subject);
CREATE INDEX IF NOT EXISTS space_science_owner_day ON space_science (owner_key, day);
CREATE TABLE IF NOT EXISTS space_tech (
  owner_key TEXT NOT NULL,
  node_id TEXT NOT NULL,
  cost DOUBLE PRECISION NOT NULL,
  at BIGINT NOT NULL,
  PRIMARY KEY (owner_key, node_id)
);
CREATE TABLE IF NOT EXISTS space_survey (
  owner_key TEXT NOT NULL,
  map_type TEXT NOT NULL,
  grid TEXT NOT NULL,
  milestone INT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (owner_key, map_type)
);
CREATE TABLE IF NOT EXISTS space_mappers (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  launch_id TEXT NOT NULL,
  map_type TEXT NOT NULL,
  scanner_id TEXT NOT NULL,
  pe_m DOUBLE PRECISION NOT NULL,
  ap_m DOUBLE PRECISION NOT NULL,
  period_s DOUBLE PRECISION NOT NULL,
  inclination_deg DOUBLE PRECISION NOT NULL,
  raan DOUBLE PRECISION NOT NULL,
  arg0 DOUBLE PRECISION NOT NULL,
  deployed_at BIGINT NOT NULL,
  last_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS space_mappers_owner ON space_mappers (owner_key);
CREATE INDEX IF NOT EXISTS space_mappers_launch ON space_mappers (launch_id);
ALTER TABLE space_science ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE space_survey ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE space_survey ADD COLUMN IF NOT EXISTS pct DOUBLE PRECISION NOT NULL DEFAULT 0;
`;

type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
type PoolLike = Q & { connect: () => Promise<Q & { release: () => void }> };

export interface ScienceRow {
  id: string; ownerKey: string; launchId: string; subject: string;
  experimentId: string; situation: Situation; biome: string; partUid: string;
  points: number; grant: number; day: string; at: number; ownerName?: string;
}
export interface MapperRow extends MapperState { id: string; ownerKey: string; launchId: string; lastAt: number }
interface SurveyRow { grid: Uint8Array; milestone: number; updatedAt: number; ownerName?: string }

const b64 = (g: Uint8Array) => Buffer.from(g).toString('base64');
const unb64 = (s: string) => gridFromBytes(Buffer.from(s, 'base64'));

const asScience = (r: Record<string, unknown>): ScienceRow => ({
  id: String(r.id), ownerKey: String(r.owner_key), launchId: String(r.launch_id), subject: String(r.subject),
  experimentId: String(r.experiment_id), situation: String(r.situation) as Situation, biome: String(r.biome),
  partUid: String(r.part_uid), points: Number(r.points), grant: Number(r.grant_chips ?? 0),
  day: String(r.day), at: Number(r.at),
});
const asMapper = (r: Record<string, unknown>): MapperRow => ({
  id: String(r.id), ownerKey: String(r.owner_key), launchId: String(r.launch_id),
  mapType: String(r.map_type) as MapType, scannerId: String(r.scanner_id),
  peM: Number(r.pe_m), apM: Number(r.ap_m), periodS: Number(r.period_s),
  inclinationDeg: Number(r.inclination_deg), raan: Number(r.raan), arg0: Number(r.arg0),
  deployedAt: Number(r.deployed_at), lastAt: Number(r.last_at),
});

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100_000) / 100_000;
}

export interface LaunchLike { id: string; ownerKey: string; design: VesselDesign; at: number }

export class SpaceResearch {
  private memScience: ScienceRow[] = [];
  private memTech = new Map<string, Map<string, number>>();
  private memSurvey = new Map<string, SurveyRow>(); // `${owner}|${type}`
  private memMappers: MapperRow[] = [];
  constructor(private readonly pool: PoolLike | null, private readonly clock = () => Date.now()) {}

  async init() { if (this.pool) await this.pool.query(SPACE_RESEARCH_MIGRATION); }

  /* ── Tech ── */
  async nodesOf(k: string): Promise<string[]> {
    if (this.pool) {
      const r = await this.pool.query('SELECT node_id FROM space_tech WHERE owner_key = $1', [k]);
      return ['start', ...r.rows.map((x) => String(x.node_id)).filter((n) => n !== 'start')];
    }
    return ['start', ...[...(this.memTech.get(k)?.keys() ?? [])].filter((n) => n !== 'start')];
  }

  async scienceTotals(k: string): Promise<{ total: number; spent: number; available: number }> {
    let total = 0, spent = 0;
    if (this.pool) {
      const a = (await this.pool.query('SELECT COALESCE(SUM(points),0) AS n FROM space_science WHERE owner_key = $1', [k])).rows[0];
      const b = (await this.pool.query('SELECT COALESCE(SUM(cost),0) AS n FROM space_tech WHERE owner_key = $1', [k])).rows[0];
      total = Number(a?.n ?? 0); spent = Number(b?.n ?? 0);
    } else {
      total = this.memScience.filter((s) => s.ownerKey === k).reduce((s, r) => s + r.points, 0);
      spent = [...(this.memTech.get(k)?.values() ?? [])].reduce((s, c) => s + c, 0);
    }
    total = Math.round(total * 100) / 100;
    spent = Math.round(spent * 100) / 100;
    return { total, spent, available: Math.max(0, Math.round((total - spent) * 100) / 100) };
  }

  async requireUnlocked(k: string, design: VesselDesign): Promise<void> {
    const nodes = await this.nodesOf(k);
    for (const p of design.parts) {
      if (!isPartUnlocked(p.partId, nodes)) {
        throw new ResearchError('This design uses a part you have not researched yet.');
      }
    }
  }

  async unlock(k: string, nodeId: unknown) {
    const id = typeof nodeId === 'string' ? nodeId : '';
    const nodes = await this.nodesOf(k);
    const { available } = await this.scienceTotals(k);
    const why = canUnlock(id, nodes, available);
    if (why) throw new ResearchError(why);
    const node = TECH_BY_ID.get(id)!;
    const now = this.clock();
    if (this.pool) {
      const r = await this.pool.query(
        'INSERT INTO space_tech (owner_key, node_id, cost, at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [k, id, node.cost, now],
      );
      if ((r.rowCount ?? 0) === 0) throw new ResearchError('Already researched.');
    } else {
      const m = this.memTech.get(k) ?? new Map<string, number>();
      m.set(id, node.cost);
      this.memTech.set(k, m);
    }
    return { node, nodes: [...nodes, id], science: await this.scienceTotals(k) };
  }

  /* ── Science ── */
  async scienceOf(k: string): Promise<ScienceRow[]> {
    if (this.pool) {
      return (await this.pool.query('SELECT * FROM space_science WHERE owner_key = $1 ORDER BY at', [k])).rows.map(asScience);
    }
    return this.memScience.filter((s) => s.ownerKey === k).sort((a, b) => a.at - b.at);
  }

  async scienceOfLaunch(launchId: string): Promise<ScienceRow[]> {
    if (this.pool) {
      return (await this.pool.query('SELECT * FROM space_science WHERE launch_id = $1', [launchId])).rows.map(asScience);
    }
    return this.memScience.filter((s) => s.launchId === launchId);
  }

  async grantToday(k: string, day: string): Promise<number> {
    if (this.pool) {
      const r = (await this.pool.query('SELECT COALESCE(SUM(grant_chips),0)::bigint AS n FROM space_science WHERE owner_key = $1 AND day = $2', [k, day])).rows[0];
      return Number(r?.n ?? 0);
    }
    return this.memScience.filter((s) => s.ownerKey === k && s.day === day).reduce((s, r) => s + r.grant, 0);
  }

  async runScience(name: string, k: string, L: LaunchLike, body: Record<string, unknown>) {
    const now = this.clock();
    if (now - L.at > SPACE_LAUNCH_TTL_MS) throw new ResearchError('That launch ticket has expired.');
    const exp = EXPERIMENT_BY_ID.get(String(body.experimentId ?? ''));
    const partUid = typeof body.partUid === 'string' ? body.partUid.slice(0, 32) : '';
    const placed = L.design.parts.find((p) => p.uid === partUid);
    const partOnDesign = !!exp && !!placed && placed.partId === exp.partId;
    const nodes = await this.nodesOf(k);
    const situation = String(body.situation ?? '') as Situation;
    const rawBiome = typeof body.biome === 'string' ? body.biome.slice(0, 24) : 'global';
    const designDv = analyzeDesign(L.design).totalDvVac;
    const why = validateScience({
      exp, situation, biome: rawBiome,
      metS: Number(body.metS), ticketAgeS: (now - L.at) / 1000, designDv,
      alt: Number(body.alt), peM: Number(body.peM), apM: Number(body.apM),
      partOnDesign, partUnlocked: !!exp && isPartUnlocked(exp.partId, nodes),
    });
    if (why) throw new ResearchError(why);
    const biome = subjectBiome(exp!, situation, rawBiome);
    const subject = subjectKey(exp!.id, situation, biome);
    const already = (await this.scienceOfLaunch(L.id)).some((r) => r.subject === subject);
    if (already) throw new ResearchError('That result is already recorded on this flight.');
    const prior = (await this.scienceOf(k)).filter((r) => r.subject === subject).length;
    const points = scienceValue(exp!, situation, prior);
    const day = utcDay(now);
    const cap = px(SCIENCE_GRANT_DAILY_CAP);
    const used = await this.grantToday(k, day);
    let grant = Math.min(px(Math.round(points * SCIENCE_GRANT_PER_POINT)), Math.max(0, cap - used));
    if (isQa(k)) grant = 0;
    const row: ScienceRow = {
      id: randomUUID(), ownerKey: k, launchId: L.id, subject, experimentId: exp!.id, situation, biome,
      partUid, points, grant, day, at: now, ownerName: name.trim(),
    };
    const bank = getBank();
    const w = grant > 0
      ? bank.transferAtomic([{ name, amount: grant, key: `space_science:${row.id}`, game: 'space_science', memo: `Research grant: ${exp!.name}` }])
      : null;
    const run = async () => {
      if (!this.pool) { this.memScience.push(row); return; }
      if (w) await w.after;
      const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        await cl.query(
          `INSERT INTO space_science (id, owner_key, launch_id, subject, experiment_id, situation, biome, part_uid, points, grant_chips, day, at, owner_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [row.id, k, L.id, subject, row.experimentId, situation, biome, partUid, points, grant, day, now, name.trim()],
        );
        if (w) for (const s of w.stmts) await cl.query(s.sql, s.args);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; }
      finally { cl.release(); }
    };
    const p = run(); w?.bind(p);
    try { await p; } catch (e) {
      w?.revert();
      if (/unique|duplicate/i.test((e as Error).message)) throw new ResearchError('That result is already recorded on this flight.');
      throw e;
    }
    return {
      result: { ...row, flavor: flavorText(exp!.id, situation, biome), name: exp!.name },
      points, grant, prior,
      science: await this.scienceTotals(k),
      grantToday: used + grant, grantCap: cap,
      chips: bank.ready ? bank.account(name).chips : null,
    };
  }

  /* ── Survey ── */
  private async surveyRow(k: string, t: MapType): Promise<SurveyRow> {
    if (this.pool) {
      const r = (await this.pool.query('SELECT * FROM space_survey WHERE owner_key = $1 AND map_type = $2', [k, t])).rows[0];
      return r ? { grid: unb64(String(r.grid)), milestone: Number(r.milestone), updatedAt: Number(r.updated_at) } : { grid: emptyGrid(), milestone: 0, updatedAt: 0 };
    }
    const m = this.memSurvey.get(`${k}|${t}`);
    return m ? { grid: gridFromBytes(m.grid), milestone: m.milestone, updatedAt: m.updatedAt } : { grid: emptyGrid(), milestone: 0, updatedAt: 0 };
  }

  async mappersOf(k: string): Promise<MapperRow[]> {
    if (this.pool) return (await this.pool.query('SELECT * FROM space_mappers WHERE owner_key = $1 ORDER BY deployed_at', [k])).rows.map(asMapper);
    return this.memMappers.filter((m) => m.ownerKey === k);
  }

  async mapTypesOfLaunch(launchId: string): Promise<string[]> {
    if (this.pool) return (await this.pool.query('SELECT map_type FROM space_mappers WHERE launch_id = $1', [launchId])).rows.map((r) => String(r.map_type));
    return this.memMappers.filter((m) => m.launchId === launchId).map((m) => m.mapType);
  }

  /**
   * Register a scanner satellite for each scanner part on a deployed launch.
   * Orbits that the design could not reach, or that were claimed too soon after
   * launch, are not registered (the satellite still counts on the board).
   */
  async registerMappers(k: string, L: LaunchLike, peM: number, apM: number, periodS: number | null): Promise<MapperRow[]> {
    const now = this.clock();
    const scanners = L.design.parts.map((p) => SCANNER_BY_PART.get(p.partId)).filter((s): s is NonNullable<typeof s> => !!s);
    if (!scanners.length) return [];
    const dv = analyzeDesign(L.design).totalDvVac;
    const maxAp = maxApoapsisFromDv(dv);
    const ageS = (now - L.at) / 1000;
    if (!(peM > PLANET.atmHeight) || !(apM >= peM) || ageS < 150) return [];
    if (Number.isFinite(maxAp) && apM > maxAp * 1.2 + 50_000) return [];
    const out: MapperRow[] = [];
    for (const [i, sc] of scanners.entries()) {
      const m = mapperFromOrbit({
        mapType: sc.mapType, scannerId: sc.partId, peM, apM, periodS: periodS ?? undefined,
        deployedAt: now, raan: hash01(`${L.id}:${i}:r`) * 2 * Math.PI, arg0: hash01(`${L.id}:${i}:a`) * 2 * Math.PI,
      });
      const row: MapperRow = { ...m, id: randomUUID(), ownerKey: k, launchId: L.id, lastAt: now };
      if (this.pool) {
        await this.pool.query(
          `INSERT INTO space_mappers (id, owner_key, launch_id, map_type, scanner_id, pe_m, ap_m, period_s, inclination_deg, raan, arg0, deployed_at, last_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [row.id, k, L.id, row.mapType, row.scannerId, row.peM, row.apM, row.periodS, row.inclinationDeg, row.raan, row.arg0, row.deployedAt, row.lastAt],
        );
      } else {
        this.memMappers.push(row);
      }
      out.push(row);
    }
    return out;
  }

  /** Advance every mapper to now (capped per call) and pay due milestones once. */
  async syncSurvey(name: string, k: string) {
    const now = this.clock();
    const mappers = await this.mappersOf(k);
    const types = Object.keys(MAP_TYPE_INFO) as MapType[];
    const rows = new Map<MapType, SurveyRow>();
    for (const t of types) rows.set(t, await this.surveyRow(k, t));
    const touched = new Set<MapType>();
    let simulated = 0;
    for (const m of mappers) {
      const row = rows.get(m.mapType);
      if (!row) continue;
      const r = advanceCoverage(row.grid, m, m.lastAt, now, SURVEY_ADVANCE_CAP_S);
      simulated = Math.max(simulated, r.simulatedS);
      m.lastAt = now;
      touched.add(m.mapType);
    }
    const payouts: Array<{ mapType: MapType; at: number; payout: number }> = [];
    for (const t of types) {
      const row = rows.get(t)!;
      const pct = coveragePct(row.grid);
      const due = dueMilestones(pct, row.milestone);
      if (due.length) {
        for (const at of due) payouts.push({ mapType: t, at, payout: isQa(k) ? 0 : px(SURVEY_MILESTONE_PAYOUT[at] ?? 0) });
        row.milestone = Math.max(...due);
        touched.add(t);
      }
    }
    const total = payouts.reduce((s, p) => s + p.payout, 0);
    const bank = getBank();
    const w = total > 0
      ? bank.transferAtomic(payouts.filter((p) => p.payout > 0).map((p) => ({
          name, amount: p.payout, key: `space_survey:${k}:${p.mapType}:${p.at}`, game: 'space_survey',
          memo: `Survey milestone: ${MAP_TYPE_INFO[p.mapType].title} ${p.at}%`,
        })))
      : null;
    const run = async () => {
      if (!this.pool) {
        for (const t of touched) {
          const r = rows.get(t)!;
          this.memSurvey.set(`${k}|${t}`, { grid: r.grid, milestone: r.milestone, updatedAt: now, ownerName: name.trim() });
        }
        return;
      }
      if (w) await w.after;
      const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        for (const t of touched) {
          const r = rows.get(t)!;
          await cl.query(
            `INSERT INTO space_survey (owner_key, map_type, grid, milestone, updated_at, owner_name, pct) VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (owner_key, map_type) DO UPDATE SET grid = EXCLUDED.grid,
               milestone = GREATEST(space_survey.milestone, EXCLUDED.milestone), updated_at = EXCLUDED.updated_at,
               owner_name = EXCLUDED.owner_name, pct = EXCLUDED.pct`,
            [k, t, b64(r.grid), r.milestone, now, name.trim(), Math.round(coveragePct(r.grid) * 10) / 10],
          );
        }
        for (const m of mappers) await cl.query('UPDATE space_mappers SET last_at = $1 WHERE id = $2', [now, m.id]);
        if (w) for (const s of w.stmts) await cl.query(s.sql, s.args);
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; }
      finally { cl.release(); }
    };
    const p = run(); w?.bind(p);
    try { await p; } catch (e) { w?.revert(); throw e; }
    return { survey: await this.surveyView(k), payouts, paid: total, simulatedS: simulated, chips: bank.ready ? bank.account(name).chips : null };
  }

  /** Top science and mapping programs (QA accounts excluded). */
  async leaders(limit = 10): Promise<{ science: Array<{ name: string; points: number }>; survey: Array<{ name: string; pct: number }> }> {
    if (this.pool) {
      const sci = (await this.pool.query(
        `SELECT owner_key, MAX(owner_name) AS name, SUM(points) AS pts FROM space_science
         WHERE owner_key NOT LIKE 'qa-%' GROUP BY owner_key ORDER BY pts DESC LIMIT $1`, [limit])).rows;
      const sur = (await this.pool.query(
        `SELECT owner_key, MAX(owner_name) AS name, SUM(pct) / 5.0 AS pct FROM space_survey
         WHERE owner_key NOT LIKE 'qa-%' GROUP BY owner_key HAVING SUM(pct) > 0 ORDER BY pct DESC LIMIT $1`, [limit])).rows;
      return {
        science: sci.map((r) => ({ name: String(r.name ?? r.owner_key), points: Math.round(Number(r.pts) * 10) / 10 })),
        survey: sur.map((r) => ({ name: String(r.name ?? r.owner_key), pct: Math.round(Number(r.pct) * 10) / 10 })),
      };
    }
    const sci = new Map<string, { name: string; points: number }>();
    for (const r of this.memScience) {
      if (isQa(r.ownerKey)) continue;
      const c = sci.get(r.ownerKey) ?? { name: r.ownerName ?? r.ownerKey, points: 0 };
      c.points += r.points; sci.set(r.ownerKey, c);
    }
    const sur = new Map<string, { name: string; pct: number }>();
    for (const [key, r] of this.memSurvey) {
      const k = key.split('|')[0]!;
      if (isQa(k)) continue;
      const c = sur.get(k) ?? { name: r.ownerName ?? k, pct: 0 };
      c.pct += coveragePct(r.grid) / 5; sur.set(k, c);
    }
    return {
      science: [...sci.values()].sort((a, b) => b.points - a.points).slice(0, limit).map((x) => ({ ...x, points: Math.round(x.points * 10) / 10 })),
      survey: [...sur.values()].filter((x) => x.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, limit).map((x) => ({ ...x, pct: Math.round(x.pct * 10) / 10 })),
    };
  }

  async surveyView(k: string | null) {
    const types = Object.keys(MAP_TYPE_INFO) as MapType[];
    const mappers = k ? await this.mappersOf(k) : [];
    const maps = [] as Array<{ mapType: MapType; grid: string; pct: number; milestone: number; mappers: number; updatedAt: number }>;
    for (const t of types) {
      const r = k ? await this.surveyRow(k, t) : { grid: emptyGrid(), milestone: 0, updatedAt: 0 };
      maps.push({
        mapType: t, grid: b64(r.grid), pct: Math.round(coveragePct(r.grid) * 10) / 10,
        milestone: r.milestone, mappers: mappers.filter((m) => m.mapType === t).length, updatedAt: r.updatedAt,
      });
    }
    return {
      maps,
      milestonePayouts: Object.fromEntries(Object.entries(SURVEY_MILESTONE_PAYOUT).map(([a, v]) => [a, px(v)])),
      advanceCapS: SURVEY_ADVANCE_CAP_S,
      mappers: mappers.map((m) => ({ id: m.id, mapType: m.mapType, scannerId: m.scannerId, peM: m.peM, apM: m.apM, deployedAt: m.deployedAt })),
    };
  }

  async scienceView(k: string | null, now: number) {
    if (!k) {
      return {
        total: 0, spent: 0, available: 0, nodes: ['start'], unlockedParts: [...unlockedParts(['start'])],
        archive: [], grantToday: 0, grantCap: px(SCIENCE_GRANT_DAILY_CAP), grantPerPoint: SCIENCE_GRANT_PER_POINT,
      };
    }
    const rows = await this.scienceOf(k);
    const nodes = await this.nodesOf(k);
    const bySubject = new Map<string, { subject: string; experimentId: string; situation: Situation; biome: string; runs: number; points: number; ceiling: number; lastAt: number; flavor: string }>();
    for (const r of rows) {
      const exp = EXPERIMENT_BY_ID.get(r.experimentId);
      const cur = bySubject.get(r.subject) ?? {
        subject: r.subject, experimentId: r.experimentId, situation: r.situation, biome: r.biome,
        runs: 0, points: 0, ceiling: exp ? subjectCeiling(exp, r.situation) : 0, lastAt: 0,
        flavor: flavorText(r.experimentId, r.situation, r.biome),
      };
      cur.runs += 1;
      cur.points = Math.round((cur.points + r.points) * 100) / 100;
      cur.lastAt = Math.max(cur.lastAt, r.at);
      bySubject.set(r.subject, cur);
    }
    const totals = await this.scienceTotals(k);
    return {
      ...totals, nodes, unlockedParts: [...unlockedParts(nodes)],
      archive: [...bySubject.values()].sort((a, b) => b.lastAt - a.lastAt),
      grantToday: await this.grantToday(k, utcDay(now)), grantCap: px(SCIENCE_GRANT_DAILY_CAP),
      grantPerPoint: SCIENCE_GRANT_PER_POINT,
    };
  }
}

void TECH_NODES;
