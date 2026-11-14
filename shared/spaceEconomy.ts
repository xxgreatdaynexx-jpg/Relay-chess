/**
 * Cheapest orbit-capable stack search, used by tests to keep the parts economy sane:
 * no combination of catalog parts should put a satellite in orbit for much less than
 * the stock budget launcher. Conservative (it ignores adapter costs and always picks
 * the cheapest decoupler), and every hit is confirmed with analyzeDesign.
 */
import { G0, PART_BY_ID, SPACE_PARTS, makeDesign, designCost, type PartDef, type VesselDesign } from './spaceParts.js';
import { analyzeDesign, ispOf, thrustOf, LEO_DV_BUDGET, MIN_LIFTOFF_TWR, PLANET } from './spaceFlight.js';

interface Opt { cost: number; wet: number; dry: number; fuel: number; eng?: PartDef; tank?: PartDef; n: number }

const dvOf = (isp: number, m0: number, mf: number) => (isp > 0 && mf > 0 && m0 > mf ? isp * G0 * Math.log(m0 / mf) : 0);

export interface CheapestResult { cost: number; design: VesselDesign | null }

/** Cheapest capable design using only `allowed` part ids (default: the whole catalog). */
export function cheapestOrbit(allowed?: Set<string>, maxTanks = 4): CheapestResult {
  const ok = (p: PartDef) => !allowed || allowed.has(p.id);
  const parts = SPACE_PARTS.filter(ok);
  const payload = parts.filter((p) => p.category === 'payload').sort((a, b) => a.cost - b.cost)[0]!;
  const probes = parts.filter((p) => p.category === 'probe' || p.category === 'pod');
  const tanks = parts.filter((p) => p.category === 'tank' && p.fuelKind === 'liquid');
  const engines = parts.filter((p) => p.category === 'engine' && (p.fuelKind ?? 'liquid') === 'liquid' && !p.radial);
  const srbs = parts.filter((p) => p.category === 'srb');
  const dec = parts.filter((p) => p.category === 'decoupler' && !p.radial).sort((a, b) => a.cost - b.cost)[0]!;
  const radialDec = 0; // boosters fire with the core; no radial decoupler needed for the bound
  void radialDec;
  const stacks: Opt[] = [];
  for (const t of tanks) for (let n = 1; n <= maxTanks; n++) for (const e of engines) {
    stacks.push({ cost: t.cost * n + e.cost, wet: (t.dryMass + t.fuelMass) * n + e.dryMass, dry: t.dryMass * n + e.dryMass, fuel: t.fuelMass * n, eng: e, tank: t, n });
  }
  const boosterOpts: Array<{ cost: number; wet: number; dry: number; fuel: number; srb?: PartDef; k: number }> = [{ cost: 0, wet: 0, dry: 0, fuel: 0, k: 0 }];
  for (const b of srbs) for (const k of [2, 4]) boosterOpts.push({ cost: b.cost * k, wet: (b.dryMass + b.fuelMass) * k, dry: b.dryMass * k, fuel: b.fuelMass * k, srb: b, k });
  const vac = (d: PartDef) => ispOf(d, 0), asl = (d: PartDef) => ispOf(d, PLANET.p0);
  const isp2 = (a: PartDef, b: PartDef | undefined, k: number, p: number) => {
    const ta = thrustOf(a, p), tb = b ? thrustOf(b, p) * k : 0;
    const md = ta / (ispOf(a, p) * G0) + (b ? tb / (ispOf(b, p) * G0) : 0);
    return md > 0 ? (ta + tb) / (md * G0) : 0;
  };
  const cands: Array<{ cost: number; build: () => VesselDesign }> = [];
  let best = Infinity;
  const push = (cost: number, mk: () => VesselDesign) => {
    if (cost > best + 2_000) return;
    if (cost < best) best = cost;
    cands.push({ cost, build: mk });
    if (cands.length > 20_000) { const keep = cands.filter((c) => c.cost <= best + 2_000); cands.length = 0; cands.push(...keep); }
  };
  for (const pr of probes) {
    const top = payload.dryMass + pr.dryMass, topCost = payload.cost + pr.cost;
    // Single stage (+ boosters lit with the core).
    for (const s of stacks) for (const b of boosterOpts) {
      const cost = topCost + s.cost + b.cost;
      const m0 = top + s.wet + b.wet;
      const twr = (thrustOf(s.eng!, PLANET.p0) + (b.srb ? thrustOf(b.srb, PLANET.p0) * b.k : 0)) / (m0 * G0);
      if (twr < MIN_LIFTOFF_TWR) continue;
      const dv = dvOf(isp2(s.eng!, b.srb, b.k, 0), m0, m0 - s.fuel - b.fuel);
      if (dv >= LEO_DV_BUDGET) push(cost, () => build(payload, pr, null, s, b));
    }
    // Two stages: upper (s1) over a decoupler over lower (s2) + boosters lit with s2.
    const uppers = stacks.filter((u) => u.wet < 40_000);
    for (const u of uppers) {
      const upWet = top + u.wet + dec.dryMass;
      const dvU = dvOf(vac(u.eng!), upWet, upWet - u.fuel);
      if (dvU <= 0) continue;
      if (topCost + u.cost + dec.cost > best) continue;
      for (const s of stacks) for (const b of boosterOpts) {
        const cost = topCost + u.cost + dec.cost + s.cost + b.cost;
        if (cost > best + 2_000) continue;
        const m0 = upWet + s.wet + b.wet;
        const twr = (thrustOf(s.eng!, PLANET.p0) + (b.srb ? thrustOf(b.srb, PLANET.p0) * b.k : 0)) / (m0 * G0);
        if (twr < MIN_LIFTOFF_TWR) continue;
        const dvL = dvOf(isp2(s.eng!, b.srb, b.k, 0), m0, m0 - s.fuel - b.fuel);
        if (dvU + dvL >= LEO_DV_BUDGET) push(cost, () => build(payload, pr, { u, dec }, s, b));
      }
    }
  }
  cands.sort((a, b) => a.cost - b.cost);
  for (const c of cands.slice(0, 400)) {
    const d = c.build();
    if (analyzeDesign(d).capable) return { cost: designCost(d), design: d };
  }
  return { cost: Infinity, design: null };
}

function build(payload: PartDef, probe: PartDef, upper: { u: Opt; dec: PartDef } | null, s: Opt, b: { srb?: PartDef; k: number }): VesselDesign {
  const items: Array<{ part: string; stage: number; radial?: boolean; count?: number }> = [
    { part: payload.id, stage: 0 }, { part: probe.id, stage: 15 },
  ];
  if (upper) {
    for (let i = 0; i < upper.u.n; i++) items.push({ part: upper.u.tank!.id, stage: 1 });
    items.push({ part: upper.u.eng!.id, stage: 1 });
    items.push({ part: upper.dec.id, stage: 1 });
  }
  const st = upper ? 2 : 1;
  for (let i = 0; i < s.n; i++) {
    items.push({ part: s.tank!.id, stage: st });
    if (i === 0 && b.srb) items.push({ part: b.srb.id, stage: st, radial: true, count: b.k });
  }
  items.push({ part: s.eng!.id, stage: st });
  return makeDesign('Cheapest', items);
}

export function partIds(): Set<string> { return new Set(PART_BY_ID.keys()); }
