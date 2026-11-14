import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { getBank, resetBank, isChipEvent } from '../server/casino-store';
import { setPriceIndexForTest } from '../server/price-index';
import { SpaceProgram, SpaceError, SPACE_MISSION_MIGRATION } from '../server/spaceProgram';
import { courierI, scoutI, makeDesign, designCost } from '../shared/spaceParts';
import { SPACE_LAUNCH_TTL_MS, SPACE_COOLDOWN_MS, SPACE_PAYOUT, analyzeDesign, LEO_DV_BUDGET } from '../shared/spaceFlight';
import {
  dailyBoard, missionById, utcDay, hashDay, evaluateCompletion, payoutAfterCap,
  designMeetsMission, minDvForTarget, maxApoapsisFromDv, hohmannDv, criteriaOnly,
  eccentricityOf, MISSION_MAX_ACTIVE, MISSION_DAILY_CAP, MISSION_BOARD_SIZE,
  MISSION_TEMPLATES, type MissionDef, type FlightReport,
} from '../shared/spaceMissions';

const fund = (name: string, n: number) => { const b = getBank(); b.transfer(name, n - b.account(name).chips, { game: 'admin' }); };
const chips = (n: string) => getBank().account(n).chips;

function shim(db: PGlite) {
  let chain = Promise.resolve();
  const q = async (sql: string, args?: unknown[]) => {
    const r = args?.length ? await db.query(sql, args as unknown[]) : (await db.exec(sql)).at(-1) ?? { rows: [], affectedRows: 0 };
    return { rows: r.rows as Record<string, unknown>[], rowCount: (r as { affectedRows?: number }).affectedRows ?? r.rows.length };
  };
  return { query: q, connect: async () => { let release!: () => void; const prev = chain; chain = new Promise<void>((r) => (release = r)); await prev; return { query: q, release }; } };
}

const DAY_A = '2026-11-13';
const T0 = Date.parse('2026-11-13T12:00:00Z');

function report(pe: number, ap: number, extra: Partial<FlightReport> = {}): FlightReport {
  return { peM: pe, apM: ap, eccentricity: eccentricityOf(pe, ap), deployed: true, deployedCount: 1, flightTimeS: 400, ...extra };
}

describe('mission generation', () => {
  it('builds a deterministic six-contract board for a UTC day, with no repeats', () => {
    const a = dailyBoard(DAY_A);
    const b = dailyBoard(DAY_A);
    expect(a).toHaveLength(MISSION_BOARD_SIZE);
    expect(b.map((m) => m.id)).toEqual(a.map((m) => m.id));
    const ids = new Set(a.map((m) => m.templateId));
    expect(ids.size).toBe(MISSION_BOARD_SIZE);
    for (const m of a) {
      expect(m.id).toBe(`${DAY_A}:${m.templateId}`);
      expect(m.day).toBe(DAY_A);
      expect(m.payout).toBeGreaterThan(0);
      expect(m.minDv).toBeGreaterThan(0);
      expect(missionById(m.id)?.title).toBe(m.title);
    }
  });

  it('rotates the board across days and never offers a polar contract', () => {
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.parse('2026-11-13T00:00:00Z') + i * 86_400_000);
      return d.toISOString().slice(0, 10);
    });
    const boards = days.map(dailyBoard);
    const signatures = boards.map((b) => b.map((m) => m.templateId).join(','));
    expect(new Set(signatures).size).toBeGreaterThan(4);
    expect(signatures[0]).not.toBe(signatures[1]);
    const kinds = new Set(boards.flat().map((m) => m.kind));
    for (const k of ['reach-space', 'reach-orbit', 'circular', 'deploy-orbit', 'multi-sat', 'budget-orbit'] as const) {
      expect(kinds.has(k)).toBe(true);
    }
    expect(boards.flat().some((m) => /polar|inclin/i.test(m.title + m.briefing + m.kind))).toBe(false);
    expect(utcDay(T0)).toBe(DAY_A);
    expect(hashDay(DAY_A)).not.toBe(hashDay('2026-11-14'));
  });

  it('sizes payouts to clear a typical launch cost with a conservative net of about 1k–15k', () => {
    const courier = designCost(courierI());
    const scout = designCost(scoutI());
    expect(courier).toBe(6850);
    expect(scout).toBeLessThan(courier);
    const byId = Object.fromEntries(MISSION_TEMPLATES.map((t) => [t.templateId, t]));
    // Sounding: a cheap vehicle, not Courier. Payout clearly above a 2–3k sounding stack.
    expect(byId.sounding!.payout).toBe(5_000);
    expect(byId.sounding!.payout - 2_500).toBeGreaterThanOrEqual(1_000);
    // Orbit-class: Scout and Courier both turn a profit.
    expect(byId['first-orbit']!.payout - scout).toBeGreaterThanOrEqual(1_000);
    expect(byId['first-orbit']!.payout - courier).toBeGreaterThanOrEqual(1_000);
    expect(byId['circular-leo']!.payout - courier).toBeGreaterThanOrEqual(3_000);
    expect(byId['deploy-250']!.payout - courier).toBeGreaterThanOrEqual(7_000);
    expect(byId['deploy-high']!.payout - courier).toBeGreaterThanOrEqual(10_000);
    expect(byId['deploy-loft']!.payout - courier).toBeGreaterThanOrEqual(14_000);
    expect(byId['deploy-loft']!.payout - courier).toBeLessThanOrEqual(16_000);
    expect(byId['twin-sat']!.payout).toBe(18_000);
    expect(byId['budget-scout']!.maxCost).toBe(5_500);
    expect(scout).toBeLessThan(5_500);
    expect(byId['budget-scout']!.payout - scout).toBeGreaterThanOrEqual(5_000);
    expect(MISSION_DAILY_CAP).toBe(30_000);
    expect(MISSION_MAX_ACTIVE).toBe(3);
    // Every advertised min Δv is at least the vis-viva / Hohmann estimate.
    // Science contracts carry no orbit target; their situations are checked by the science validator.
    for (const t of MISSION_TEMPLATES.filter((x) => x.kind !== 'science')) {
      const ap = t.maxAp ?? t.minAp ?? 80_000;
      const pe = t.minPe ?? (t.kind === 'reach-space' ? -PLANET_SURFACE() : 75_000);
      const est = minDvForTarget({ peM: pe, apM: ap, suborbital: t.kind === 'reach-space' });
      expect(t.minDv).toBeGreaterThanOrEqual(est * 0.85);
    }
  });
});

function PLANET_SURFACE() { return -1; }

describe('payout validation (pure)', () => {
  const board = dailyBoard(DAY_A);
  const first = board.find((m) => m.kind === 'reach-orbit') ?? missionById(`${DAY_A}:first-orbit`)!;
  const sound = missionById(`${DAY_A}:sounding`)!;
  const ticket = {
    at: 0, cost: designCost(courierI()), design: courierI(), missionId: first.id, ttlMs: SPACE_LAUNCH_TTL_MS,
  };

  it('accepts a plausible Courier I orbit claim and rejects a too-short flight', () => {
    const ok = evaluateCompletion({
      mission: first, acceptedAt: 0, now: 400_000, ticket, report: report(80_000, 95_000),
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.payout).toBe(first.payout);
    const early = evaluateCompletion({
      mission: first, acceptedAt: 0, now: 10_000, ticket, report: report(80_000, 95_000, { flightTimeS: 10 }),
    });
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.reason).toMatch(/too short/i);
  });

  it('rejects a claim without a matching ticket, a pre-accept launch, and an expired ticket', () => {
    expect(evaluateCompletion({
      mission: first, acceptedAt: 0, now: 400_000,
      ticket: { ...ticket, missionId: null }, report: report(80_000, 90_000),
    }).ok).toBe(false);
    expect(evaluateCompletion({
      mission: first, acceptedAt: 100_000, now: 500_000,
      ticket: { ...ticket, at: 50_000 }, report: report(80_000, 90_000),
    }).ok).toBe(false);
    expect(evaluateCompletion({
      mission: first, acceptedAt: 0, now: SPACE_LAUNCH_TTL_MS + 5_000,
      ticket, report: report(80_000, 90_000),
    }).ok).toBe(false);
  });

  it('rejects a design that cannot reach the claimed orbit (vis-viva) and a weak Δv stack', () => {
    const weak = makeDesign('Popgun', [
      { part: 'probe-okto', stage: 15 },
      { part: 'fl-t100', stage: 1 },
      { part: 'spark', stage: 1 },
    ]);
    expect(analyzeDesign(weak).totalDvVac).toBeLessThan(LEO_DV_BUDGET);
    const ev = evaluateCompletion({
      mission: first, acceptedAt: 0, now: 400_000,
      ticket: { at: 0, cost: 100, design: weak, missionId: first.id, ttlMs: SPACE_LAUNCH_TTL_MS },
      report: report(80_000, 90_000),
    });
    expect(ev.ok).toBe(false);
    if (!ev.ok) expect(ev.reason).toMatch(/Δv|dv/i);

    const overclaim = evaluateCompletion({
      mission: first, acceptedAt: 0, now: 400_000,
      ticket: { at: 0, cost: designCost(courierI()), design: courierI(), missionId: first.id, ttlMs: SPACE_LAUNCH_TTL_MS },
      report: report(80_000, 5_000_000),
      designDv: 3_600, // just over LEO; vis-viva cannot raise a 5,000 km apoapsis
    });
    expect(overclaim.ok).toBe(false);
    if (!overclaim.ok) expect(overclaim.reason).toMatch(/beyond|reach|Δv|dv/i);
    expect(maxApoapsisFromDv(3_600)).toBeGreaterThan(200_000);
    expect(maxApoapsisFromDv(3_600)).toBeLessThan(5_000_000);
    expect(maxApoapsisFromDv(10_000)).toBe(Infinity);
    expect(hohmannDv(680_000, 1_150_000)).toBeGreaterThan(400);
    expect(hohmannDv(680_000, 1_150_000)).toBeLessThan(800);
  });

  it('checks each contract kind against its success criteria', () => {
    expect(criteriaOnly(sound, report(-200_000, 80_000, { altitudeM: 80_000, deployed: false, deployedCount: 0 }))).toBe(true);
    expect(criteriaOnly(sound, report(-200_000, 40_000, { altitudeM: 40_000 }))).toBe(false);
    const circ = missionById(`${DAY_A}:circular-leo`)!;
    expect(criteriaOnly(circ, report(80_000, 90_000))).toBe(true);
    expect(criteriaOnly(circ, report(80_000, 200_000))).toBe(false); // e too high / ap out of band
    const twin = missionById(`${DAY_A}:twin-sat`)!;
    expect(criteriaOnly(twin, report(80_000, 100_000, { deployed: true, deployedCount: 1 }))).toBe(false);
    expect(criteriaOnly(twin, report(80_000, 100_000, { deployed: true, deployedCount: 2 }))).toBe(true);
    const budget = missionById(`${DAY_A}:budget-scout`)!;
    expect(designMeetsMission(scoutI(), budget)).toBeNull();
    expect(designMeetsMission(courierI(), budget)).toMatch(/budget|cost/i);
  });

  it('applies the daily cap, including a partial last payout', () => {
    expect(payoutAfterCap(10_000, 0, 30_000)).toBe(10_000);
    expect(payoutAfterCap(10_000, 25_000, 30_000)).toBe(5_000);
    expect(payoutAfterCap(10_000, 30_000, 30_000)).toBe(0);
    expect(payoutAfterCap(10_000, 40_000, 30_000)).toBe(0);
  });
});

describe('acceptance limits and payouts (memory)', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); });

  it('accepts up to three contracts, refuses a fourth and a same-day repeat', async () => {
    let now = T0;
    const p = new SpaceProgram(null, () => now);
    fund('Ann', 200_000);
    const board = dailyBoard(DAY_A);
    expect(board.length).toBeGreaterThanOrEqual(4);
    await p.acceptMission('Ann', board[0]!.id);
    await p.acceptMission('Ann', board[1]!.id);
    await p.acceptMission('Ann', board[2]!.id);
    await expect(p.acceptMission('Ann', board[3]!.id)).rejects.toThrow(/at most 3|open contracts/i);
    await expect(p.acceptMission('Ann', board[0]!.id)).rejects.toThrow(/already/i);
    await expect(p.acceptMission('Ann', `${DAY_A}:not-a-real-template`)).rejects.toThrow(/board/i);
    await expect(p.acceptMission('Ann', '2026-11-12:sounding')).rejects.toThrow(/board|expired/i);
    const v = await p.view('Ann');
    expect(v.missions.accepted).toHaveLength(3);
    expect(v.missions.dailyCap).toBe(MISSION_DAILY_CAP);
    expect(v.missions.board).toHaveLength(MISSION_BOARD_SIZE);
  });

  it('pays a completed contract against a valid ticket and rejects a bad claim', async () => {
    let now = T0;
    const p = new SpaceProgram(null, () => now);
    fund('Ann', 200_000);
    const first = missionById(`${DAY_A}:first-orbit`)!;
    // first-orbit may not be on today's generated board — accept only if it is, else pick reach-orbit or any orbit-class.
    const board = dailyBoard(DAY_A);
    const mission = board.find((m) => m.kind === 'reach-orbit') ?? board.find((m) => m.kind === 'circular') ?? board[0]!;
    await p.acceptMission('Ann', mission.id);
    // Launch before? No — ticket must be after accept (same clock is ok, at >= acceptedAt).
    const L = await p.launch('Ann', courierI(), mission.id);
    const before = chips('Ann');
    await expect(p.completeMission('Ann', {
      launchId: L.launchId, missionId: mission.id, peM: 80_000, apM: 95_000, flightTimeS: 400, deployed: true, deployedCount: 1,
    })).rejects.toThrow(/too short/i);

    now += Math.max(mission.minFlightSec, 200) * 1000 + 500;
    const badOrbit = mission.maxAp != null && mission.maxAp < 500_000;
    if (badOrbit) {
      // An out-of-band claim is refused.
      await expect(p.completeMission('Ann', {
        launchId: L.launchId, missionId: mission.id, peM: 80_000, apM: 900_000, flightTimeS: 400, deployed: true,
      })).rejects.toThrow(/orbit|band|eccentric/i);
    }
    const pe = mission.minPe ?? 80_000;
    const ap = Math.min(mission.maxAp ?? (pe + 10_000), (mission.maxPe ?? pe + 20_000) + 5_000);
    // Stay inside bands if they exist.
    const peC = mission.maxPe != null ? Math.min(Math.max(pe, mission.minPe ?? pe), mission.maxPe) : Math.max(pe, 80_000);
    const apC = mission.maxAp != null ? Math.min(Math.max(peC + 5_000, mission.minAp ?? peC), mission.maxAp) : Math.max(peC + 8_000, 90_000);
    const d = await p.completeMission('Ann', {
      launchId: L.launchId, missionId: mission.id,
      peM: peC, apM: apC, flightTimeS: 400,
      deployed: !!mission.requireDeploy, deployedCount: mission.satCount ?? (mission.requireDeploy ? 1 : 0),
    });
    expect(d.payout).toBe(mission.payout);
    expect(chips('Ann')).toBe(before + mission.payout);
    await expect(p.completeMission('Ann', {
      launchId: L.launchId, missionId: mission.id, peM: peC, apM: apC, flightTimeS: 400, deployed: true,
    })).rejects.toThrow(/already/i);
    // Same mission cannot be re-accepted today.
    await expect(p.acceptMission('Ann', mission.id)).rejects.toThrow(/already/i);
  });

  it('caps daily mission payouts (partial last payment) and keeps the 5×400 bounty independent', async () => {
    let now = T0;
    const p = new SpaceProgram(null, () => now);
    fund('Ann', 400_000);
    const board = dailyBoard(DAY_A);
    // Complete missions in payout-descending order until the cap binds.
    const sorted = [...board].sort((a, b) => b.payout - a.payout);
    let paid = 0;
    const results: number[] = [];
    for (const m of sorted) {
      const why = designMeetsMission(courierI(), m);
      if (why) continue; // skip budget / twin if Courier does not qualify
      const active = (await p.contractsOf('ann', DAY_A)).filter((c) => !c.completedAt);
      if (active.length >= MISSION_MAX_ACTIVE) {
        // Should not happen if we complete as we go.
      }
      await p.acceptMission('Ann', m.id);
      const L = await p.launch('Ann', courierI(), m.id);
      now += Math.max(m.minFlightSec, 200) * 1000 + 500;
      const peC = m.maxPe != null ? Math.min(Math.max(m.minPe ?? 80_000, 80_000), m.maxPe) : Math.max(m.minPe ?? 80_000, 80_000);
      const apC = m.maxAp != null ? Math.min(Math.max(peC + 2_000, m.minAp ?? peC), m.maxAp) : Math.max(peC + 8_000, m.minAp ?? 90_000);
      const d = await p.completeMission('Ann', {
        launchId: L.launchId, missionId: m.id,
        peM: peC, apM: apC, flightTimeS: 500,
        deployed: true, deployedCount: m.satCount ?? 1,
      });
      results.push(d.payout);
      paid += d.payout;
      now += SPACE_COOLDOWN_MS + 10;
      if (paid >= MISSION_DAILY_CAP) break;
    }
    expect(results.some((n) => n > 0)).toBe(true);
    expect(paid).toBeLessThanOrEqual(MISSION_DAILY_CAP);
    // If we still have a completable leftover mission and room was exhausted mid-payout, last is partial or 0.
    expect(paid).toBe(Math.min(MISSION_DAILY_CAP, results.reduce((s, n) => s + n, 0)));
    const v = await p.view('Ann');
    expect(v.missions.paidToday).toBe(paid);
    expect(v.missions.remainingCap).toBe(MISSION_DAILY_CAP - paid);

    // Lifetime 5×400 satellite bonus still pays on a (possibly already-claimed) later launch,
    // or on a fresh launch without a mission.
    const L2 = await p.launch('Ann', courierI());
    now += 1_000;
    const dep = await p.deploy('Ann', { launchId: L2.launchId, peM: 80_000, apM: 90_000 });
    expect(dep.payout).toBe(SPACE_PAYOUT);
    expect(isChipEvent('space_mission')).toBe(true);
  });

  it('pays QA accounts nothing for a completed contract', async () => {
    let now = T0;
    const p = new SpaceProgram(null, () => now);
    fund('QA-Pilot', 200_000);
    const board = dailyBoard(DAY_A);
    const m = board.find((x) => designMeetsMission(courierI(), x) === null)!;
    await p.acceptMission('QA-Pilot', m.id);
    const L = await p.launch('QA-Pilot', courierI(), m.id);
    now += Math.max(m.minFlightSec, 200) * 1000 + 500;
    const peC = m.maxPe != null ? Math.min(Math.max(m.minPe ?? 80_000, 80_000), m.maxPe) : Math.max(m.minPe ?? 80_000, 80_000);
    const apC = m.maxAp != null ? Math.min(Math.max(peC + 2_000, m.minAp ?? peC), m.maxAp) : Math.max(peC + 8_000, 90_000);
    const before = chips('QA-Pilot');
    const d = await p.completeMission('QA-Pilot', {
      launchId: L.launchId, missionId: m.id, peM: peC, apM: apC, flightTimeS: 500, deployed: true, deployedCount: 2,
    });
    expect(d.payout).toBe(0);
    expect(d.prestigeOnly).toBe(true);
    expect(chips('QA-Pilot')).toBe(before);
  });
});

describe('missions (postgres)', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); });
  it('migrates additively, accepts a contract, and pays it once', async () => {
    const db = new PGlite();
    let now = T0;
    const p = new SpaceProgram(shim(db) as never, () => now);
    await p.init();
    await p.init();
    fund('Fay', 200_000);
    const board = dailyBoard(DAY_A);
    const m = board.find((x) => designMeetsMission(courierI(), x) === null)!;
    await p.acceptMission('Fay', m.id);
    const L = await p.launch('Fay', courierI(), m.id);
    now += Math.max(m.minFlightSec, 200) * 1000 + 500;
    const peC = m.maxPe != null ? Math.min(Math.max(m.minPe ?? 80_000, 80_000), m.maxPe) : Math.max(m.minPe ?? 80_000, 80_000);
    const apC = m.maxAp != null ? Math.min(Math.max(peC + 2_000, m.minAp ?? peC), m.maxAp) : Math.max(peC + 8_000, 90_000);
    const before = chips('Fay');
    const d = await p.completeMission('Fay', {
      launchId: L.launchId, missionId: m.id, peM: peC, apM: apC, flightTimeS: 500, deployed: true, deployedCount: 2,
    });
    expect(d.payout).toBe(m.payout);
    expect(chips('Fay')).toBe(before + m.payout);
    const v = await p.view('Fay');
    expect(v.missions.completedIds).toContain(m.id);
    expect(v.missions.paidToday).toBe(m.payout);
    await expect(p.completeMission('Fay', {
      launchId: L.launchId, missionId: m.id, peM: peC, apM: apC, flightTimeS: 500, deployed: true,
    })).rejects.toThrow(/already/i);
    // Migration is exported and additive (rerun is a no-op).
    expect(SPACE_MISSION_MIGRATION).toMatch(/ADD COLUMN IF NOT EXISTS mission_id/);
  });
});
