// Chudbai city layout: every footprint is data (shared/chudbaiCity.ts) and the audit checks overlaps, roads, flow and frontage.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { auditFlow, auditFrontage, auditGulf, auditOverlaps, auditRoads } from '../shared/chudbaiAudit';
import {
  CHUDBAI_DEEDS, DOWNTOWN_CORE, GULF_BLOCKS, GULF_LANES, GULF_LOTS, GULF_PROPS, GULF_ROADS, MARINA_CORE, METRO_PILLARS, METRO_STATIONS, PALM_VILLAS,
  carX, chudbaiProperties, districtAt, isChudbaiDeedId, overlaps, rectOf, unitSlot, wellSlot, padRect, inside, spotRect, type District,
} from '../shared/chudbaiCity';
import { GULF_SPOTS, G_TRACTS, G_UNITS, G_WELLS_PER_TRACT, gulfSpot, type GUnitKind } from '../shared/chudbai';
import { propertyById } from '../shared/realEstate';
import { canDemolish } from '../shared/estateProjects';

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('Chudbai layout audit', () => {
  it('finds no overlaps, nothing on a road, a flowing road network and frontage for every building', () => {
    expect(auditOverlaps()).toEqual([]);
    expect(auditRoads()).toEqual([]);
    expect(auditFlow()).toEqual([]);
    expect(auditFrontage()).toEqual([]);
    expect(auditGulf()).toEqual([]);
  });
  it('catches a planted overlap (the audit is not vacuous)', () => {
    const a = GULF_LOTS[0]!.r; expect(overlaps(a, rectOf((a.x0 + a.x1) / 2, (a.z0 + a.z1) / 2, 2, 2))).toBe(true);
    const lot = GULF_LOTS.find((l) => l.kind === 'tower')!; const saved = lot.parts.slice();
    lot.parts.push({ s: 'box', x: (GULF_ROADS[0]!.x0 + GULF_ROADS[0]!.x1) / 2, z: GULF_ROADS[0]!.z0, w: 4, d: 4, y0: 0, h: 4, m: 'cream' });
    try { expect(auditOverlaps().length).toBeGreaterThan(0); } finally { lot.parts.splice(0, lot.parts.length, ...saved); }
    expect(auditOverlaps()).toEqual([]);
  });
  it('every oil slot is distinct and inside its pad / the plant', () => {
    const plant = spotRect(gulfSpot('g-plant'));
    for (const k of Object.keys(G_UNITS) as GUnitKind[]) for (let i = 0; i < G_UNITS[k].max; i++) expect(inside(unitSlot(k, i), plant)).toBe(true);
    for (let n = 1; n <= G_TRACTS; n++) for (let i = 0; i < G_WELLS_PER_TRACT; i++) { expect(inside(wellSlot(n, i), padRect(n))).toBe(true); for (let j = 0; j < i; j++) expect(overlaps(wellSlot(n, i), wellSlot(n, j))).toBe(false); }
  });
});

describe('Chudbai is a city, not lone towers', () => {
  const by = (d: District) => GULF_LOTS.filter((l) => l.district === d);
  it('has all five districts filled with mixed low/mid-rise blocks', () => {
    for (const d of ['downtown', 'marina', 'oldtown', 'residential', 'industrial'] as District[]) expect(by(d).length).toBeGreaterThan(4);
    const kinds = new Set(GULF_LOTS.map((l) => l.kind));
    for (const k of ['tower', 'hotel', 'parking', 'plaza', 'mosque', 'courtyard', 'shop', 'villa', 'apartment', 'park', 'warehouse', 'depot']) expect(kinds.has(k as never)).toBe(true);
    expect(GULF_LOTS.filter((l) => l.kind === 'mosque').length).toBeGreaterThanOrEqual(5);
    for (const m of GULF_LOTS.filter((l) => l.kind === 'mosque')) { expect(m.parts.some((p) => p.s === 'dome')).toBe(true); expect(m.parts.filter((p) => p.s === 'cyl').length).toBeGreaterThanOrEqual(2); } // dome + minarets
    expect(GULF_LOTS.length).toBeGreaterThan(120); expect(GULF_BLOCKS.length).toBeGreaterThan(30);
    for (const l of GULF_LOTS) expect(districtAt((l.r.x0 + l.r.x1) / 2, (l.r.z0 + l.r.z1) / 2)).toBe(l.district);
  });
  it('clusters towers in downtown and the marina, with density falling off outward', () => {
    const towers = GULF_LOTS.filter((l) => l.kind === 'tower'); expect(towers.length).toBeGreaterThan(15);
    for (const t of towers) expect(['downtown', 'marina']).toContain(t.district);
    const core = (l: (typeof GULF_LOTS)[number]) => Math.min(Math.hypot((l.r.x0 + l.r.x1) / 2 - DOWNTOWN_CORE.x, (l.r.z0 + l.r.z1) / 2 - DOWNTOWN_CORE.z), Math.hypot((l.r.x0 + l.r.x1) / 2 - MARINA_CORE.x, (l.r.z0 + l.r.z1) / 2 - MARINA_CORE.z));
    const near = GULF_LOTS.filter((l) => core(l) < 60), far = GULF_LOTS.filter((l) => core(l) > 150);
    const avg = (a: typeof GULF_LOTS) => a.reduce((s, l) => s + l.h, 0) / a.length;
    expect(avg(near)).toBeGreaterThan(3 * avg(far)); expect(Math.max(...far.map((l) => l.h))).toBeLessThan(30);
  });
  it('has boulevards with medians and sidewalks, street props, a metro line and traffic', () => {
    expect(GULF_ROADS.filter((r) => r.median > 0).length).toBeGreaterThanOrEqual(3); expect(GULF_ROADS.filter((r) => r.walk > 0).length).toBeGreaterThan(20);
    for (const k of ['lamp', 'palm', 'bench', 'shelter']) expect(GULF_PROPS.some((p) => p.k === k)).toBe(true);
    expect(GULF_PROPS.length).toBeGreaterThan(300);
    expect(METRO_STATIONS.length).toBe(5); expect(METRO_PILLARS.length).toBeGreaterThanOrEqual(15);
    expect(GULF_LANES.reduce((a, l) => a + l.n, 0)).toBeGreaterThan(60);
    for (const l of GULF_LANES) for (const t of [0, 5, 50]) for (let i = 0; i < l.n; i++) { const x = carX(l, i, t); expect(x).toBeGreaterThanOrEqual(l.x0 - 1e-6); expect(x).toBeLessThanOrEqual(l.x1 + 1e-6); }
  });
  it('the 3D map draws the shared layout (no private random tower loop or road list)', () => {
    const r = src('client/src/lib/chudbai3d.ts');
    for (const k of ['GULF_LOTS', 'GULF_ROADS', 'GULF_PROPS', 'METRO_PILLARS', 'GULF_LANES', 'unitSlot', 'wellSlot', 'PALM_FRONDS', 'qa()']) expect(r).toContain(k);
    expect(r).not.toMatch(/towers < 52|export const GULF_ROADS/);
  });
});

describe('Chudbai homes (deeds)', () => {
  it('seven penthouses and villas on their own map, normal deed rules, not demolishable', () => {
    expect(CHUDBAI_DEEDS.map((d) => [d.id, d.type, d.price])).toEqual([
      ['cb:1', 'penthouse', 4_500_000], ['cb:2', 'penthouse', 3_500_000], ['cb:3', 'penthouse', 6_000_000], ['cb:4', 'villa', 2_400_000],
      ['cb:5', 'villa', 7_000_000], ['cb:6', 'villa', 12_000_000], ['cb:7', 'villa', 3_000_000],
    ]);
    for (const d of CHUDBAI_DEEDS) { const p = propertyById(d.id)!; expect(p.map).toBe('chudbai'); expect(p.price).toBe(d.price); expect(canDemolish(p).ok).toBe(false); expect(isChudbaiDeedId(d.id)).toBe(true); }
    expect(chudbaiProperties().length).toBe(7); expect(isChudbaiDeedId('cb:99')).toBe(false);
    expect(PALM_VILLAS.filter((v) => v.deed).map((v) => v.deed)).toEqual(['cb:5', 'cb:6']);
    expect(GULF_LOTS.filter((l) => l.deed).length).toBe(5);
    expect(src('server/realEstate.ts')).toMatch(/\/\^cb:\/\.test\(b\.id\)\) await requireChudbai/);
  });
  it('every landmark sits on its own footprint', () => {
    for (const a of GULF_SPOTS) for (const b of GULF_SPOTS) if (a !== b) expect(overlaps(spotRect(a), spotRect(b))).toBe(false);
  });
});
