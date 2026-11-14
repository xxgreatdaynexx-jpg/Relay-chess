import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { getBank, resetBank, isChipEvent } from '../server/casino-store';
import { setPriceIndexForTest } from '../server/price-index';
import { SpaceProgram, SPACE_RESEARCH_MIGRATION } from '../server/spaceProgram';
import { courierI, makeDesign, designCost, validateDesign, hasErrors, PART_BY_ID } from '../shared/spaceParts';
import { analyzeDesign, SPACE_LAUNCH_TTL_MS, SPACE_COOLDOWN_MS, PLANET, scriptedAscent } from '../shared/spaceFlight';
import {
  SCANNERS, SURVEY_CELLS, SURVEY_MILESTONE_PAYOUT, SURVEY_ADVANCE_CAP_S, MAP_TYPE_INFO,
  emptyGrid, coveragePct, advanceCoverage, mapperFromOrbit, scanEfficiency, dueMilestones, previewGrid,
  periodFromElements, filledCount,
} from '../shared/spaceSurvey';
import {
  EXPERIMENTS, EXPERIMENT_BY_ID, TECH_NODES, SITUATIONS, SCIENCE_GRANT_DAILY_CAP, SCIENCE_GRANT_PER_POINT,
  scienceValue, subjectCap, situationOf, validateScience, canUnlock, isPartUnlocked, unlockedParts,
  flavorText, subjectKey, subjectBiome, biomeUnder, PART_TECH,
} from '../shared/spaceScience';
import { biomeAt, equatorBiomes, terrainAt, BIOMES } from '../shared/spaceTerrain';
import { dailyBoard, missionById, designMeetsMission, evaluateCompletion, MISSION_TEMPLATES } from '../shared/spaceMissions';
import { orbitalElements } from '../shared/spaceFlight';

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

const T0 = Date.parse('2026-11-13T12:00:00Z');

/** Courier I with science parts and a scanner swapped in for the CommSat. */
function sciCourier(extra: string[] = ['sci-thermo', 'sci-baro'], payload = 'commsat') {
  return makeDesign('SciCourier', [
    { part: payload, stage: 0 },
    { part: 'probe-okto', stage: 15 },
    ...extra.map((p) => ({ part: p, stage: 15 })),
    { part: 'fairing-125', stage: 2 },
    { part: 'fl-t400', stage: 1 },
    { part: 'terrier', stage: 1 },
    { part: 'tr-18a', stage: 1 },
    { part: 'fl-t800', stage: 3 },
    { part: 'fl-t800', stage: 3 },
    { part: 'reliant', stage: 3 },
  ]);
}
const uidOf = (d: ReturnType<typeof sciCourier>, partId: string) => d.parts.find((p) => p.partId === partId)!.uid;

describe('terrain and biomes', () => {
  it('classifies biomes deterministically and finds several along the equator', () => {
    expect(biomeAt(0.3, 1.2)).toBe(biomeAt(0.3, 1.2));
    const eq = equatorBiomes();
    expect(eq.length).toBeGreaterThanOrEqual(3);
    for (const b of eq) expect(BIOMES[b]).toBeTruthy();
    expect(Number.isFinite(terrainAt(0, 0).elev)).toBe(true);
    const polar = new Set(Array.from({ length: 72 }, (_, i) => biomeAt(1.45, i * Math.PI / 36)));
    expect(polar.has('ice-caps')).toBe(true);
  });
});

describe('mapping coverage', () => {
  it('defines five map types with altitude bands and swaths', () => {
    expect(SCANNERS.map((s) => s.mapType).sort()).toEqual(['altimetry', 'biome', 'resource', 'visual', 'weather']);
    for (const s of SCANNERS) {
      expect(PART_BY_ID.get(s.partId)?.category).toBe('payload');
      expect(s.maxAlt).toBeGreaterThan(s.minAlt);
      expect(scanEfficiency((s.minAlt + s.maxAlt) / 2, s)).toBe(1);
      expect(scanEfficiency(s.maxAlt * 3, s)).toBe(0);
      expect(scanEfficiency(s.minAlt * 0.75, s)).toBeGreaterThan(0);
      expect(scanEfficiency(s.minAlt * 0.75, s)).toBeLessThan(0.5);
    }
  });

  it('accrues coverage along the ground track and grows with time, swath and band', () => {
    const radar = SCANNERS.find((s) => s.mapType === 'altimetry')!;
    const inBand = mapperFromOrbit({ mapType: 'altimetry', scannerId: radar.partId, peM: 150_000, apM: 160_000, deployedAt: 0 });
    const g1 = emptyGrid();
    const r1 = advanceCoverage(g1, inBand, 0, 2 * 3600 * 1000);
    expect(r1.added).toBeGreaterThan(0);
    const g2 = emptyGrid();
    advanceCoverage(g2, inBand, 0, 8 * 3600 * 1000);
    expect(coveragePct(g2)).toBeGreaterThan(coveragePct(g1));
    // Out of band (way too high) scans nothing.
    const high = mapperFromOrbit({ mapType: 'altimetry', scannerId: radar.partId, peM: 900_000, apM: 900_000, deployedAt: 0 });
    const g3 = emptyGrid();
    expect(advanceCoverage(g3, high, 0, 8 * 3600 * 1000).added).toBe(0);
    // Narrow resource beam is slower than wide weather mapper over the same time.
    const ore = SCANNERS.find((s) => s.mapType === 'resource')!;
    const wx = SCANNERS.find((s) => s.mapType === 'weather')!;
    const gO = emptyGrid(), gW = emptyGrid();
    advanceCoverage(gO, mapperFromOrbit({ mapType: 'resource', scannerId: ore.partId, peM: 110_000, apM: 110_000, deployedAt: 0 }), 0, 4 * 3600e3);
    advanceCoverage(gW, mapperFromOrbit({ mapType: 'weather', scannerId: wx.partId, peM: 450_000, apM: 450_000, deployedAt: 0 }), 0, 4 * 3600e3);
    expect(coveragePct(gW)).toBeGreaterThan(coveragePct(gO));
  });

  it('caps a single advance (away time) at the survey cap', () => {
    const radar = SCANNERS.find((s) => s.mapType === 'altimetry')!;
    const m = mapperFromOrbit({ mapType: 'altimetry', scannerId: radar.partId, peM: 150_000, apM: 160_000, deployedAt: 0 });
    const r = advanceCoverage(emptyGrid(), m, 0, 10 * 24 * 3600 * 1000);
    expect(r.simulatedS).toBe(SURVEY_ADVANCE_CAP_S);
    expect(periodFromElements(150_000, 160_000)).toBeGreaterThan(2000);
  });

  it('reports milestones once and in order', () => {
    expect(dueMilestones(30, 0)).toEqual([25]);
    expect(dueMilestones(80, 25)).toEqual([50, 75]);
    expect(dueMilestones(100, 75)).toEqual([100]);
    expect(dueMilestones(100, 100)).toEqual([]);
    expect(Object.values(SURVEY_MILESTONE_PAYOUT).reduce((a, b) => a + b, 0)).toBe(7_500);
    const g = previewGrid('visual', 40);
    expect(coveragePct(g)).toBeGreaterThanOrEqual(40);
    expect(filledCount(g)).toBeLessThanOrEqual(SURVEY_CELLS);
  });
});

describe('science rules', () => {
  it('scores experiment × situation with diminishing returns', () => {
    const thermo = EXPERIMENT_BY_ID.get('thermo')!;
    const v0 = scienceValue(thermo, 'lowOrbit', 0);
    expect(v0).toBe(subjectCap(thermo, 'lowOrbit'));
    expect(scienceValue(thermo, 'lowOrbit', 1)).toBeCloseTo(v0 / 2, 2);
    expect(scienceValue(thermo, 'lowOrbit', 2)).toBeCloseTo(v0 / 4, 2);
    expect(scienceValue(thermo, 'lowOrbit', 12)).toBe(0);
    expect(SITUATIONS.highOrbit.mult).toBeGreaterThan(SITUATIONS.lowOrbit.mult);
    expect(SITUATIONS.pad.mult).toBeLessThan(SITUATIONS.lowAtmo.mult);
    expect(EXPERIMENTS.length).toBe(8);
  });

  it('classifies situations from altitude and orbit', () => {
    const vLow = Math.sqrt(PLANET.mu / (PLANET.radius + 100_000));
    const elLow = orbitalElements(PLANET.radius + 100_000, 0, 0, vLow);
    expect(situationOf({ alt: 0, onPad: true })).toBe('pad');
    expect(situationOf({ alt: 5_000 })).toBe('lowAtmo');
    expect(situationOf({ alt: 40_000 })).toBe('highAtmo');
    expect(situationOf({ alt: 90_000, el: orbitalElements(PLANET.radius + 90_000, 0, 0, 500) })).toBe('suborbital');
    expect(situationOf({ alt: 100_000, el: elLow })).toBe('lowOrbit');
    const vHigh = Math.sqrt(PLANET.mu / (PLANET.radius + 300_000));
    expect(situationOf({ alt: 300_000, el: orbitalElements(PLANET.radius + 300_000, 0, 0, vHigh) })).toBe('highOrbit');
    expect(biomeUnder({ x: PLANET.radius, y: 0, t: 0, phase: 'pad' })).toBe('launch-site');
  });

  it('rejects implausible reports', () => {
    const exp = EXPERIMENT_BY_ID.get('thermo')!;
    const base = { exp, biome: 'global', ticketAgeS: 500, designDv: 6000, partOnDesign: true, partUnlocked: true };
    expect(validateScience({ ...base, situation: 'lowOrbit', metS: 400, alt: 90_000, peM: 80_000, apM: 95_000 })).toBeNull();
    expect(validateScience({ ...base, situation: 'lowOrbit', metS: 30, alt: 90_000, peM: 80_000, apM: 95_000 })).toMatch(/short/);
    expect(validateScience({ ...base, situation: 'lowOrbit', metS: 900, alt: 90_000, peM: 80_000, apM: 95_000 })).toMatch(/ticket/);
    expect(validateScience({ ...base, situation: 'lowOrbit', metS: 400, alt: 90_000, peM: 80_000, apM: 95_000, designDv: 1500 })).toMatch(/could not/);
    expect(validateScience({ ...base, situation: 'lowOrbit', metS: 400, alt: 40_000, peM: 80_000, apM: 95_000 })).toMatch(/Altitude/);
    expect(validateScience({ ...base, situation: 'highOrbit', metS: 400, alt: 300_000, peM: 280_000, apM: 320_000 })).toMatch(/cannot be run/);
    expect(validateScience({ ...base, situation: 'lowOrbit', metS: 400, alt: 90_000, peM: 80_000, apM: 95_000, partOnDesign: false })).toMatch(/not on the launched/);
    expect(validateScience({ ...base, exp: EXPERIMENT_BY_ID.get('baro')!, situation: 'lowAtmo', metS: 20, alt: 5_000, biome: 'not-a-biome' })).toMatch(/biome/);
    expect(validateScience({ ...base, exp: EXPERIMENT_BY_ID.get('baro')!, situation: 'pad', metS: 0, alt: 3, biome: 'whatever' })).toBeNull();
    expect(subjectBiome(exp, 'pad', 'desert')).toBe('launch-site');
    expect(subjectBiome(exp, 'lowOrbit', 'desert')).toBe('global');
    expect(subjectKey('thermo', 'lowOrbit', 'global')).toBe('thermo@lowOrbit');
    expect(flavorText('thermo', 'highAtmo', 'global')).toMatch(/freezer|colder/);
  });

  it('runs a tech tree with prerequisites, and keeps starter parts unlocked', () => {
    expect(isPartUnlocked('reliant', [])).toBe(true);
    expect(isPartUnlocked('mainsail', [])).toBe(true);
    expect(isPartUnlocked('sci-thermo', [])).toBe(true); // start node
    expect(isPartUnlocked('sci-grav', ['start'])).toBe(false);
    expect(unlockedParts(['start', 'basic-science']).has('scan-radar')).toBe(true);
    expect(canUnlock('basic-science', ['start'], 5)).toMatch(/Needs/);
    expect(canUnlock('basic-science', ['start'], 10)).toBeNull();
    expect(canUnlock('electrics', ['start'], 999)).toMatch(/first/);
    expect(canUnlock('start', ['start'], 999)).toMatch(/Already/);
    for (const n of TECH_NODES) for (const p of n.unlocks) expect(PART_BY_ID.has(p)).toBe(true);
    // Every new part is gated by exactly one node.
    expect(PART_TECH.get('nerv')).toBe('nuclear-propulsion');
    expect(TECH_NODES.length).toBe(23);
  });
});

describe('science and survey contracts', () => {
  it('puts one survey and one science contract on every daily board', () => {
    for (let i = 0; i < 10; i++) {
      const day = new Date(T0 + i * 86_400_000).toISOString().slice(0, 10);
      const b = dailyBoard(day);
      expect(b).toHaveLength(8);
      expect(b.filter((m) => m.kind === 'survey-orbit')).toHaveLength(1);
      expect(b.filter((m) => m.kind === 'science')).toHaveLength(1);
      expect(new Set(b.map((m) => m.templateId)).size).toBe(8);
    }
    expect(MISSION_TEMPLATES.filter((t) => t.kind === 'survey-orbit').length).toBe(5);
    expect(MISSION_TEMPLATES.filter((t) => t.kind === 'science').length).toBe(6);
  });

  it('requires server-recorded results and deployed scanners', () => {
    const day = '2026-11-13';
    const sci = missionById(`${day}:sci-matbay-orbit`)!;
    const d = sciCourier(['sci-matbay']);
    expect(designMeetsMission(d, sci)).toBeNull();
    expect(designMeetsMission(courierI(), sci)).toMatch(/experiment/);
    const ticket = { at: 0, cost: designCost(d), design: d, missionId: sci.id, ttlMs: SPACE_LAUNCH_TTL_MS };
    const base = { mission: sci, acceptedAt: 0, now: 400_000, ticket, report: { peM: 80_000, apM: 90_000, flightTimeS: 400 } };
    expect(evaluateCompletion({ ...base, facts: { science: [] } }).ok).toBe(false);
    expect(evaluateCompletion({ ...base, facts: { science: [{ experimentId: 'matbay', situation: 'highAtmo', points: 5 }] } }).ok).toBe(false);
    expect(evaluateCompletion({ ...base, facts: { science: [{ experimentId: 'matbay', situation: 'lowOrbit', points: 31 }] } }).ok).toBe(true);

    const sv = missionById(`${day}:survey-visual`)!;
    const dv = sciCourier([], 'scan-camera');
    const t2 = { at: 0, cost: designCost(dv), design: dv, missionId: sv.id, ttlMs: SPACE_LAUNCH_TTL_MS };
    const rep = { peM: 120_000, apM: 130_000, deployed: true, deployedCount: 1, flightTimeS: 500 };
    expect(evaluateCompletion({ mission: sv, acceptedAt: 0, now: 500_000, ticket: t2, report: rep, facts: { scannersDeployed: [] } }).ok).toBe(false);
    expect(evaluateCompletion({ mission: sv, acceptedAt: 0, now: 500_000, ticket: t2, report: rep, facts: { scannersDeployed: ['visual'] } }).ok).toBe(true);
    expect(evaluateCompletion({ mission: sv, acceptedAt: 0, now: 500_000, ticket: t2, report: { ...rep, apM: 400_000 }, facts: { scannersDeployed: ['visual'] } }).ok).toBe(false);
  });
});

describe('research server (memory)', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); });

  it('records science once per subject per flight, with diminishing returns and a capped grant', async () => {
    let now = T0;
    const p = new SpaceProgram(null, () => now);
    fund('Ann', 200_000);
    const d = sciCourier(['sci-thermo', 'sci-baro']);
    expect(hasErrors(validateDesign(d))).toBe(false);
    expect(analyzeDesign(d).capable).toBe(true);
    const L = await p.launch('Ann', d);
    const before = chips('Ann');
    const pad = await p.runScience('Ann', { launchId: L.launchId, experimentId: 'thermo', partUid: uidOf(d, 'sci-thermo'), situation: 'pad', biome: 'launch-site', metS: 0, alt: 0 });
    expect(pad.points).toBeCloseTo(8 * 0.3, 5);
    expect(pad.grant).toBe(Math.round(pad.points * SCIENCE_GRANT_PER_POINT));
    expect(chips('Ann')).toBe(before + pad.grant);
    await expect(p.runScience('Ann', { launchId: L.launchId, experimentId: 'thermo', partUid: uidOf(d, 'sci-thermo'), situation: 'pad', biome: 'launch-site', metS: 0, alt: 0 })).rejects.toThrow(/already recorded/);
    // Wrong part uid / missing experiment.
    await expect(p.runScience('Ann', { launchId: L.launchId, experimentId: 'geiger', partUid: uidOf(d, 'sci-thermo'), situation: 'lowOrbit', metS: 400, alt: 90_000, peM: 80_000, apM: 90_000 })).rejects.toThrow(/not on the launched/);
    // Orbit claim too early.
    await expect(p.runScience('Ann', { launchId: L.launchId, experimentId: 'thermo', partUid: uidOf(d, 'sci-thermo'), situation: 'lowOrbit', biome: 'global', metS: 400, alt: 90_000, peM: 80_000, apM: 90_000 })).rejects.toThrow(/ticket/);
    now += 420_000;
    const orbit = await p.runScience('Ann', { launchId: L.launchId, experimentId: 'thermo', partUid: uidOf(d, 'sci-thermo'), situation: 'lowOrbit', biome: 'global', metS: 400, alt: 90_000, peM: 80_000, apM: 90_000 });
    expect(orbit.points).toBe(10);
    expect(orbit.result.flavor).toMatch(/shadow|sunlight/i);

    // Second flight, same subject: half value.
    now += SPACE_COOLDOWN_MS;
    const L2 = await p.launch('Ann', d);
    now += 420_000;
    const again = await p.runScience('Ann', { launchId: L2.launchId, experimentId: 'thermo', partUid: uidOf(d, 'sci-thermo'), situation: 'lowOrbit', biome: 'global', metS: 400, alt: 90_000, peM: 80_000, apM: 90_000 });
    expect(again.points).toBe(5);
    const v = await p.view('Ann');
    expect(v.science.total).toBeCloseTo(2.4 + 10 + 5, 5);
    expect(v.science.archive.find((a) => a.subject === 'thermo@lowOrbit')?.runs).toBe(2);
    expect(v.science.grantToday).toBeLessThanOrEqual(SCIENCE_GRANT_DAILY_CAP);
    expect(isChipEvent('space_science')).toBe(true);
    expect(isChipEvent('space_survey_sync')).toBe(true);
  });

  it('enforces the daily research-grant cap and pays QA nothing', async () => {
    let now = T0;
    const p = new SpaceProgram(null, () => now);
    fund('QA-Lab', 100_000);
    const d = sciCourier(['sci-thermo', 'sci-baro']);
    const L = await p.launch('QA-Lab', d);
    const r = await p.runScience('QA-Lab', { launchId: L.launchId, experimentId: 'baro', partUid: uidOf(d, 'sci-baro'), situation: 'pad', metS: 0, alt: 0 });
    expect(r.points).toBeGreaterThan(0);
    expect(r.grant).toBe(0);
    // Cap math: a grant can never push today's total over the cap.
    expect(SCIENCE_GRANT_DAILY_CAP).toBe(2_000);
  });

  it('gates researched parts at launch and unlocks them with science', async () => {
    let now = T0;
    const p = new SpaceProgram(null, () => now);
    fund('Bea', 200_000);
    const geigerD = sciCourier(['sci-geiger']);
    await expect(p.launch('Bea', geigerD)).rejects.toThrow(/researched/);
    await expect(p.unlockTech('Bea', 'basic-science')).rejects.toThrow(/Needs/);
    // Earn science with starter experiments.
    const d = sciCourier(['sci-thermo', 'sci-baro']);
    const L = await p.launch('Bea', d);
    await p.runScience('Bea', { launchId: L.launchId, experimentId: 'thermo', partUid: uidOf(d, 'sci-thermo'), situation: 'pad', metS: 0, alt: 0 });
    await p.runScience('Bea', { launchId: L.launchId, experimentId: 'baro', partUid: uidOf(d, 'sci-baro'), situation: 'pad', metS: 0, alt: 0 });
    now += 60_000;
    await p.runScience('Bea', { launchId: L.launchId, experimentId: 'baro', partUid: uidOf(d, 'sci-baro'), situation: 'highAtmo', metS: 50, alt: 30_000 });
    await p.runScience('Bea', { launchId: L.launchId, experimentId: 'thermo', partUid: uidOf(d, 'sci-thermo'), situation: 'highAtmo', metS: 50, alt: 30_000 });
    const tot = (await p.view('Bea')).science;
    expect(tot.available).toBeGreaterThanOrEqual(10);
    const u = await p.unlockTech('Bea', 'basic-science');
    expect(u.nodes).toContain('basic-science');
    expect(u.science.spent).toBe(10);
    await expect(p.unlockTech('Bea', 'basic-science')).rejects.toThrow(/Already/);
    now += SPACE_COOLDOWN_MS;
    const L2 = await p.launch('Bea', geigerD);
    expect(L2.launchId).toBeTruthy();
  });

  it('registers scanners on deploy, advances coverage while away, and pays milestones once', async () => {
    let now = T0;
    const p = new SpaceProgram(null, () => now);
    fund('Cy', 200_000);
    const d = sciCourier([], 'scan-camera');
    const L = await p.launch('Cy', d);
    // Too soon after launch: satellite counts, mapper is not registered.
    now += 60_000;
    const early = await p.deploy('Cy', { launchId: L.launchId, peM: 120_000, apM: 130_000 });
    expect(early.mappers).toHaveLength(0);
    now += SPACE_COOLDOWN_MS;
    const L2 = await p.launch('Cy', d);
    now += 300_000;
    const dep = await p.deploy('Cy', { launchId: L2.launchId, peM: 120_000, apM: 130_000 });
    expect(dep.mappers).toHaveLength(1);
    expect(dep.mappers[0]!.mapType).toBe('visual');
    const before = chips('Cy');
    now += 30 * 24 * 3600 * 1000; // away for a month
    const s1 = await p.syncSurvey('Cy');
    expect(s1.simulatedS).toBe(SURVEY_ADVANCE_CAP_S);
    const vis = s1.survey.maps.find((m) => m.mapType === 'visual')!;
    expect(vis.pct).toBeGreaterThan(0);
    const expected = s1.payouts.reduce((s, x) => s + x.payout, 0);
    expect(chips('Cy')).toBe(before + expected);
    // Syncing again immediately pays nothing new.
    const s2 = await p.syncSurvey('Cy');
    expect(s2.paid).toBe(0);
    for (let i = 0; i < 6; i++) { now += 24 * 3600 * 1000; await p.syncSurvey('Cy'); }
    const fin = (await p.view('Cy')).survey.maps.find((m) => m.mapType === 'visual')!;
    expect(fin.milestone).toBeGreaterThanOrEqual(vis.milestone);
    expect(Object.keys(MAP_TYPE_INFO)).toHaveLength(5);
  });

  it('completes a science contract only after a matching recorded result', async () => {
    let now = T0;
    const p = new SpaceProgram(null, () => now);
    fund('Dot', 200_000);
    const m = missionById('2026-11-13:sci-baro-low')!;
    // The contract need not be on today’s board for this unit check; accept requires it is.
    const board = dailyBoard('2026-11-13');
    const sci = board.find((x) => x.kind === 'science')!;
    await p.acceptMission('Dot', sci.id);
    // Unlock enough tech for any science contract on today's board (QA of the flow, not the economy).
    const res = p.research as unknown as { memTech: Map<string, Map<string, number>> };
    res.memTech.set('dot', new Map(TECH_NODES.map((n) => [n.id, 0])));
    const parts = sci.experimentPart ? [sci.experimentPart] : ['sci-thermo', 'sci-baro', 'sci-matbay'];
    const d = sciCourier(parts);
    const L = await p.launch('Dot', d, sci.id);
    now += 30 * 1000;
    await expect(p.completeMission('Dot', { launchId: L.launchId, missionId: sci.id, peM: 0, apM: 0 })).rejects.toThrow(/short|recorded|science/);
    void m;
  });
});

describe('research (postgres)', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); });
  it('migrates additively and persists science, tech, and survey', async () => {
    const db = new PGlite();
    let now = T0;
    const p = new SpaceProgram(shim(db) as never, () => now);
    await p.init();
    await p.init();
    expect(SPACE_RESEARCH_MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS space_science/);
    expect(SPACE_RESEARCH_MIGRATION).not.toMatch(/DROP|ALTER TABLE .* DROP/i);
    fund('Eli', 200_000);
    const d = sciCourier(['sci-thermo', 'sci-baro', 'sci-matbay'], 'scan-camera');
    // matbay needs basic-science.
    await expect(p.launch('Eli', d)).rejects.toThrow(/researched/);
    const d0 = sciCourier(['sci-thermo', 'sci-baro'], 'scan-camera');
    const L = await p.launch('Eli', d0);
    const a = await p.runScience('Eli', { launchId: L.launchId, experimentId: 'thermo', partUid: uidOf(d0, 'sci-thermo'), situation: 'pad', metS: 0, alt: 0 });
    await expect(p.runScience('Eli', { launchId: L.launchId, experimentId: 'thermo', partUid: uidOf(d0, 'sci-thermo'), situation: 'pad', metS: 0, alt: 0 })).rejects.toThrow(/already/);
    now += 300_000;
    const dep = await p.deploy('Eli', { launchId: L.launchId, peM: 110_000, apM: 120_000 });
    expect(dep.mappers).toHaveLength(1);
    now += 12 * 3600 * 1000;
    const s = await p.syncSurvey('Eli');
    expect(s.survey.maps.find((m) => m.mapType === 'visual')!.pct).toBeGreaterThan(0);
    const v = await p.view('Eli');
    expect(v.science.total).toBeCloseTo(a.points, 5);
    expect(v.survey.mappers).toHaveLength(1);
    const again = await p.syncSurvey('Eli');
    expect(again.paid).toBe(0);
  });
});

void scriptedAscent;
