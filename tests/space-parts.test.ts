import { describe, it, expect } from 'vitest';
import {
  SPACE_PARTS, PART_BY_ID, PART_CATEGORIES, PART_GROUPS, PART_SIZES, sizeClassesOf, makeDesign, designCost,
  validateDesign, hasErrors, parseDesign, designHash, clusterCounts, goliathHeavy, STOCK_DESIGNS, MAX_DESIGN_PARTS,
} from '../shared/spaceParts';
import { analyzeDesign, scriptedAscent, launchState, stepFlight, activateStage, dragCd, sampleAccel, PLANET } from '../shared/spaceFlight';
import { TECH_NODES, TECH_BY_ID, PART_TECH, TECH_TOTAL_COST, unlockedParts } from '../shared/spaceScience';
import { cheapestOrbit } from '../shared/spaceEconomy';
import { missionById, designMeetsMission, MISSION_TEMPLATES } from '../shared/spaceMissions';

/** The catalog before the expansion (the stock economy baseline). */
const ORIGINAL = new Set(['mk1-pod', 'probe-okto', 'fl-t100', 'fl-t200', 'fl-t400', 'fl-t800', 'jumbo-64', 'reliant', 'swivel', 'terrier', 'spark', 'mainsail', 'hammer', 'thumper', 'tr-18a', 'tt-38k', 'tr-25', 'fairing-125', 'fairing-25', 'commsat', 'scisat', 'weathersat', 'x200-16', 'x200-32', 'skipper', 'poodle', 'nerv', 'kickback', 'sci-thermo', 'sci-baro', 'sci-geiger', 'sci-mag', 'sci-atmo', 'sci-grav', 'sci-matbay', 'sci-seismic', 'scan-camera', 'scan-radar', 'scan-multispectral', 'scan-ore', 'scan-weather']);

describe('parts catalog integrity', () => {
  it('has unique ids and sane numbers on every part', () => {
    expect(new Set(SPACE_PARTS.map((p) => p.id)).size).toBe(SPACE_PARTS.length);
    expect(SPACE_PARTS.length - ORIGINAL.size).toBeGreaterThanOrEqual(30);
    for (const p of SPACE_PARTS) {
      expect(p.name.length, p.id).toBeGreaterThan(2);
      expect(p.description.length, p.id).toBeGreaterThan(10);
      expect(p.dryMass, p.id).toBeGreaterThan(0);
      expect(p.fuelMass, p.id).toBeGreaterThanOrEqual(0);
      expect(p.cost, p.id).toBeGreaterThan(0);
      expect(p.width, p.id).toBeGreaterThan(0);
      expect(p.height, p.id).toBeGreaterThan(0);
      expect(PART_CATEGORIES.some((c) => c.id === p.category), p.id).toBe(true);
      expect(Number.isFinite(p.dryMass + p.fuelMass + p.cost)).toBe(true);
    }
  });

  it('gives engines thrust and ISP that improve in vacuum', () => {
    for (const e of SPACE_PARTS.filter((p) => p.category === 'engine' || p.category === 'srb')) {
      expect(e.thrustVac, e.id).toBeGreaterThan(0);
      expect(e.thrustVac!, e.id).toBeGreaterThanOrEqual(e.thrustAsl ?? 0);
      expect(e.ispVac!, e.id).toBeGreaterThan(e.ispAsl ?? 0);
      expect(['liquid', 'solid', 'xenon']).toContain(e.fuelKind);
      if (e.category === 'srb') { expect(e.fuelKind).toBe('solid'); expect(e.fuelMass).toBeGreaterThan(0); }
      else expect(e.fuelMass, e.id).toBe(0);
    }
    // The aerospike keeps most of its ISP at sea level; the ion drive trades thrust for ISP.
    const wedge = PART_BY_ID.get('wedge')!, ion = PART_BY_ID.get('halo-ion')!;
    expect(wedge.ispAsl! / wedge.ispVac!).toBeGreaterThan(0.8);
    expect(ion.ispVac!).toBeGreaterThan(4000);
    expect(ion.thrustVac!).toBeLessThan(5000);
  });

  it('gives tanks a fuel kind and a plausible fuel fraction', () => {
    const kinds = new Set<string>();
    for (const t of SPACE_PARTS.filter((p) => p.category === 'tank')) {
      expect(t.fuelMass, t.id).toBeGreaterThan(0);
      expect(['liquid', 'xenon', 'mono']).toContain(t.fuelKind);
      kinds.add(t.fuelKind!);
      const ratio = t.fuelMass / t.dryMass;
      expect(ratio, t.id).toBeGreaterThan(1);
      expect(ratio, t.id).toBeLessThanOrEqual(8.5);
    }
    expect([...kinds].sort()).toEqual(['liquid', 'mono', 'xenon']);
  });

  it('covers every diameter with tanks, decouplers and adapters between sizes', () => {
    for (const size of PART_SIZES) {
      const fits = SPACE_PARTS.filter((p) => sizeClassesOf(p).includes(size));
      expect(fits.some((p) => p.category === 'tank'), `tank ${size}`).toBe(true);
      expect(fits.some((p) => p.category === 'decoupler'), `decoupler ${size}`).toBe(true);
      expect(fits.some((p) => p.category === 'engine'), `engine ${size}`).toBe(true);
    }
    const adapters = SPACE_PARTS.filter((p) => p.widthBottom != null && !p.mounts);
    const pairs = adapters.map((a) => `${a.width}->${a.widthBottom}`);
    expect(pairs).toEqual(expect.arrayContaining(['0.625->1.25', '1.25->2.5', '2.5->3.75']));
    for (const c of SPACE_PARTS.filter((p) => p.mounts)) expect([2, 3, 4]).toContain(c.mounts);
  });

  it('groups every category into exactly one catalog tab', () => {
    const seen = PART_GROUPS.flatMap((g) => g.categories);
    expect(new Set(seen).size).toBe(seen.length);
    expect(new Set(seen)).toEqual(new Set(PART_CATEGORIES.map((c) => c.id)));
  });

  it('places every new part in exactly one tech node, and the tree is well formed', () => {
    for (const p of SPACE_PARTS) {
      if (ORIGINAL.has(p.id)) continue;
      expect(PART_TECH.get(p.id), `${p.id} has no tech node`).toBeTruthy();
    }
    const listed = TECH_NODES.flatMap((n) => n.unlocks);
    expect(new Set(listed).size).toBe(listed.length);
    for (const id of listed) expect(PART_BY_ID.has(id), id).toBe(true);
    for (const n of TECH_NODES) {
      for (const r of n.requires) {
        const req = TECH_BY_ID.get(r)!;
        expect(req, `${n.id} requires ${r}`).toBeTruthy();
        expect(req.tier, `${n.id} after ${r}`).toBeLessThan(n.tier);
      }
      if (n.id !== 'start') expect(n.cost).toBeGreaterThan(0);
    }
    // Everything is reachable, and the whole tree stays within a few thousand science.
    expect(unlockedParts(TECH_NODES.map((n) => n.id)).size).toBe(listed.length);
    expect(TECH_TOTAL_COST).toBeGreaterThan(900);
    expect(TECH_TOTAL_COST).toBeLessThanOrEqual(3_500);
  });
});

describe('new part physics', () => {
  it('clusters the engine below a coupler: cost, mass and thrust scale with the mounts', () => {
    const single = makeDesign('One', [{ part: 'probe-okto', stage: 15 }, { part: 'jumbo-64', stage: 1 }, { part: 'reliant', stage: 1 }]);
    const quad = makeDesign('Four', [{ part: 'probe-okto', stage: 15 }, { part: 'jumbo-64', stage: 1 }, { part: 'coupler-4', stage: 15 }, { part: 'reliant', stage: 1 }]);
    expect([...clusterCounts(quad).values()]).toEqual([4]);
    const coupler = PART_BY_ID.get('coupler-4')!, rel = PART_BY_ID.get('reliant')!;
    expect(designCost(quad) - designCost(single)).toBe(coupler.cost + rel.cost * 3);
    const a = analyzeDesign(single), b = analyzeDesign(quad);
    expect(b.stages[0]!.thrustAsl).toBeCloseTo(a.stages[0]!.thrustAsl * 4, 0);
    expect(b.wetMass - a.wetMass).toBe(coupler.dryMass + rel.dryMass * 3);
    expect(b.stages[0]!.engines).toEqual(['4× Reliant']);
    const s = launchState(quad);
    activateStage(s);
    s.throttle = 1;
    const acc = sampleAccel(s, s.x, s.y, s.vx, s.vy, 1);
    const s1 = launchState(single); activateStage(s1);
    expect(acc.thrust).toBeCloseTo(sampleAccel(s1, s1.x, s1.y, s1.vx, s1.vy, 1).thrust * 4, 0);
  });

  it('applies the solid booster thrust limiter: less thrust, longer burn, same propellant', () => {
    const base = makeDesign('B', [{ part: 'probe-okto', stage: 15 }, { part: 'pounder', stage: 1, radial: true, count: 2 }]);
    const limited = { ...base, parts: base.parts.map((p) => (p.partId === 'pounder' ? { ...p, limit: 0.6 } : p)) };
    const a = analyzeDesign(base).stages[0]!, b = analyzeDesign(limited).stages[0]!;
    expect(b.thrustAsl).toBeCloseTo(a.thrustAsl * 0.6, 0);
    expect(b.burnTime).toBeCloseTo(a.burnTime / 0.6, 0);
    expect(b.fuelMass).toBe(a.fuelMass);
    // Round-trips through the server parser and changes the design hash; clamps silly values.
    const parsed = parseDesign(limited)!;
    expect(parsed.parts.find((p) => p.partId === 'pounder')!.limit).toBe(0.6);
    expect(designHash(parsed)).not.toBe(designHash(base));
    const silly = parseDesign({ ...base, parts: base.parts.map((p) => ({ ...p, limit: p.partId === 'pounder' ? 0.01 : 5 })) })!;
    expect(silly.parts.find((p) => p.partId === 'pounder')!.limit).toBe(0.3);
    expect(silly.parts.find((p) => p.partId === 'probe-okto')!.limit).toBeUndefined();
  });

  it('feeds the ion drive from xenon only, and requires a power source', () => {
    const noPower = makeDesign('Ion', [{ part: 'probe-pip', stage: 15 }, { part: 'xenon-300', stage: 1 }, { part: 'fl-t400', stage: 1 }, { part: 'halo-ion', stage: 1 }]);
    expect(hasErrors(validateDesign(noPower))).toBe(true);
    const ok = makeDesign('Ion', [{ part: 'probe-pip', stage: 15 }, { part: 'xenon-300', stage: 1 }, { part: 'battery-z', stage: 15, radial: true }, { part: 'fl-t400', stage: 1 }, { part: 'halo-ion', stage: 1 }]);
    expect(validateDesign(ok).filter((i) => i.level === 'error').map((i) => i.text).join()).not.toMatch(/battery/);
    const st = analyzeDesign(ok).stages[0]!;
    expect(st.fuelMass).toBe(300); // xenon only, not the liquid tank
    expect(st.dvVac).toBeGreaterThan(2_000);
    // In flight, a burn drains xenon and leaves liquid fuel alone.
    const s = launchState(ok);
    s.x = PLANET.radius + 200_000; s.y = 0; s.vx = 0; s.vy = 2_000;
    activateStage(s); s.throttle = 1;
    for (let i = 0; i < 200; i++) stepFlight(s, 0.5);
    const xe = s.parts.find((p) => p.partId === 'xenon-300')!, lf = s.parts.find((p) => p.partId === 'fl-t400')!;
    expect(xe.fuel).toBeLessThan(300);
    expect(lf.fuel).toBe(2000);
  });

  it('trims drag with a nose cone and adds a little with fins; 3.75 m stacks are draggier', () => {
    const bare = launchState(makeDesign('A', [{ part: 'probe-okto', stage: 15 }, { part: 'fl-t800', stage: 1 }, { part: 'reliant', stage: 1 }]));
    const nosed = launchState(makeDesign('B', [{ part: 'nose-125', stage: 15 }, { part: 'probe-okto', stage: 15 }, { part: 'fl-t800', stage: 1 }, { part: 'reliant', stage: 1 }]));
    const finned = launchState(makeDesign('C', [{ part: 'probe-okto', stage: 15 }, { part: 'fl-t800', stage: 1 }, { part: 'fin-delta', stage: 15, radial: true, count: 4 }, { part: 'reliant', stage: 1 }]));
    expect(dragCd(nosed)).toBeLessThan(dragCd(bare));
    expect(dragCd(finned)).toBeGreaterThan(dragCd(bare));
    const wide = launchState(makeDesign('D', [{ part: 'probe-okto', stage: 15 }, { part: 'kodiak-18', stage: 1 }, { part: 'skipper', stage: 1 }]));
    const v = 300;
    const dragAt = (s: typeof bare) => sampleAccel(s, s.x, s.y, s.vx + v, s.vy, 0).drag;
    expect(dragAt(wide)).toBeGreaterThan(dragAt(bare) * 5);
  });

  it('feeds radial Spur engines from the core tanks and throws spent boosters off with a radial decoupler', () => {
    const d = makeDesign('Spur', [
      { part: 'commsat', stage: 0 }, { part: 'probe-okto', stage: 15 },
      { part: 'x200-32', stage: 2 }, { part: 'spur', stage: 2, radial: true, count: 2 },
      { part: 'tt-38k', stage: 1, radial: true, count: 2 }, { part: 'hammer', stage: 2, radial: true, count: 2 },
      { part: 'skipper', stage: 2 },
    ]);
    const st = analyzeDesign(d).stages[0]!;
    expect(st.engines).toEqual(expect.arrayContaining(['2× Spur', '2× Hammer', 'Skipper']));
    const s = launchState(d);
    activateStage(s); s.throttle = 1;
    for (let i = 0; i < 400; i++) stepFlight(s, 0.1);
    const hammers = s.parts.filter((p) => p.partId === 'hammer');
    expect(hammers.every((h) => h.fuel <= 0)).toBe(true);
    activateStage(s);
    expect(hammers.every((h) => !h.attached)).toBe(true);
    expect(s.parts.filter((p) => p.partId === 'spur').every((p) => p.attached && p.ignited)).toBe(true);
  });

  it('caps designs at the part limit', () => {
    const many = { name: 'Big', parts: Array.from({ length: MAX_DESIGN_PARTS + 1 }, (_, i) => ({ uid: `u${i}`, partId: 'fl-t100', stage: 1 })) };
    expect(parseDesign(many)).toBeNull();
  });
});

describe('heavy lift reference', () => {
  it('Goliath Heavy (boosters + quad cluster + 3.75 m core) carries a station module to a high orbit', () => {
    const d = goliathHeavy();
    expect(STOCK_DESIGNS.map((x) => x.name)).toContain('Goliath Heavy');
    const st = analyzeDesign(d);
    expect(st.capable).toBe(true);
    expect(st.liftoffTwr).toBeGreaterThan(1.5);
    expect(st.totalDvVac).toBeGreaterThan(5_500);
    const r = scriptedAscent(d, { targetAp: 400_000, targetPe: 380_000, maxTime: 4_000, dt: 0.1 });
    expect(r.crashed).toBe(false);
    expect(r.reachedOrbit).toBe(true);
    expect(r.peAltitude).toBeGreaterThan(370_000);
    expect(r.apAltitude).toBeGreaterThan(390_000);
    expect(r.deployed).toBe(true);
    expect(r.state.parts.filter((p) => p.partId === 'colossus').every((p) => !p.attached)).toBe(true);
  });
});

describe('economy guard', () => {
  it('keeps the cheapest orbit-capable stack within 5% of the original catalog floor', () => {
    const before = cheapestOrbit(ORIGINAL);
    const after = cheapestOrbit();
    expect(before.design).not.toBeNull();
    expect(after.design).not.toBeNull();
    expect(analyzeDesign(after.design!).capable).toBe(true);
    expect(after.cost).toBeGreaterThanOrEqual(Math.floor(before.cost * 0.95));
  }, 60_000);

  it('prices propellant and thrust no cheaper than the old catalog', () => {
    const perTonne = (ids: (id: string) => boolean) => Math.min(...SPACE_PARTS.filter((p) => ids(p.id) && p.category === 'tank' && p.fuelKind === 'liquid').map((p) => p.cost / (p.fuelMass / 1000)));
    expect(perTonne(() => true)).toBeGreaterThanOrEqual(perTonne((id) => ORIGINAL.has(id)) * 0.98);
    const perKn = (ids: (id: string) => boolean, cat: string) => Math.min(...SPACE_PARTS.filter((p) => ids(p.id) && p.category === cat).map((p) => p.cost / (p.thrustAsl! / 1000)));
    expect(perKn(() => true, 'engine')).toBeGreaterThanOrEqual(perKn((id) => ORIGINAL.has(id), 'engine') * 0.9);
    expect(perKn(() => true, 'srb')).toBeGreaterThanOrEqual(perKn((id) => ORIGINAL.has(id), 'srb') * 0.9);
    // Contracts never pay more than the cheapest design that can attempt them by a wide margin.
    const cheapest = cheapestOrbit().cost;
    for (const t of MISSION_TEMPLATES) expect(t.payout / Math.max(cheapest, 1), t.templateId).toBeLessThan(8);
  });

  it('posts a relay contract that needs a relay dish or Meridian on the vehicle', () => {
    const m = missionById('2026-11-14:relay-uplink')!;
    expect(m.requireAnyPart).toContain('dish-ra80');
    expect(designMeetsMission(goliathHeavy(), m)).toMatch(/relay dish/);
    const withDish = goliathHeavy();
    withDish.parts.push({ uid: 'dish', partId: 'dish-ra80', stage: 15, radial: true, angle: 90, attachTo: withDish.parts[3]!.uid });
    expect(designMeetsMission(withDish, m)).toBeNull();
  });
});
