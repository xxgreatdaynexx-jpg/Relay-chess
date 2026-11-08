/**
 * Mayor 2.0 (Dayne, Nov 4 2026): city treasury, economy levers, 24 h economic policies, civic construction, approval
 * and recall. Pure rules shared by server, client and tests (server/city.ts is the Postgres side).
 *  - Levers: every value is clamped + snapped to hard bounds, with a cooldown between changes of the same lever.
 *  - Treasury: funded ONLY by sales tax, 25% of property tax + trading fees, the freight modifier's surplus and recall
 *    fees. It pays ONLY for policies and civic building stages (both pure sinks). Nothing ever pays a wallet from it.
 *  - Casino odds / payouts are not a lever, a policy sector or a perk, by construction (see SECTORS / PERKS).
 */
export const H_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export type LeverId = 'sales_tax' | 'wealth_tax' | 'freight' | 'property_surcharge' | 'daily_wealth_tax';
export interface LeverSpec { id: LeverId; label: string; min: number; max: number; step: number; base: number; cooldownMs: number; unit: 'pct' | 'mul'; blurb: string; /** abolished by law: hidden, refused, and has no effect (history rows kept) */ abolished?: true }
export const LEVERS: Record<LeverId, LeverSpec> = {
  sales_tax: { id: 'sales_tax', label: 'Sales tax', min: 0, max: 0.05, step: 0.005, base: 0, cooldownMs: 48 * H_MS, unit: 'pct', blurb: 'On top of purchases at the game\'s own shops (cars, trucks, boats, jets, furniture). Never on trades between players. Goes to the treasury.' },
  wealth_tax: { id: 'wealth_tax', label: 'Purchase wealth tax', min: 0.03, max: 0.07, step: 0.01, base: 0.05, cooldownMs: 72 * H_MS, unit: 'pct', blurb: 'Rate paid by buyers holding 100K+ in property. 25% of what is collected goes to the city treasury; the other 75% is shared with players. The daily net-worth wealth tax is its own lever below.' },
  freight: { id: 'freight', label: 'Warehouse freight fees', min: 1, max: 1.2, step: 0.05, base: 1, cooldownMs: 48 * H_MS, unit: 'mul', blurb: 'Hired trucks, freight planes and cargo ships. Your own truck stays fuel-only. The default (0%) is the lowest setting; anything above it goes to the treasury.' },
  // pt2020u (Nov 8 2026): defaults = the live rules (SURCHARGE_PCT_PER_1K = 1, WEALTH_TAX_RATE = 0.01), so nothing changes until a mayor moves them.
  // Bill Chud 1 (Nov 8 2026): the purchase surcharge is abolished. Kept only so stored history parses; never shown, settable or applied.
  property_surcharge: { id: 'property_surcharge', label: 'Property surcharge (per 1,000 owned)', min: 0.005, max: 0.02, step: 0.0025, base: 0.01, cooldownMs: 72 * H_MS, unit: 'pct', blurb: 'Added to the price of your next property for every 1,000 chips of property you already own (price paid + upgrades). Applies to new purchases only; existing deeds, sell-back and property tax are unchanged. 25% of the surcharge collected goes to the city treasury.' , abolished: true },
  daily_wealth_tax: { id: 'daily_wealth_tax', label: 'Daily wealth tax', min: 0.005, max: 0.015, step: 0.0025, base: 0.01, cooldownMs: 72 * H_MS, unit: 'pct', blurb: 'Charged once per UTC day on net worth above 2× the median of active players (10K+), from chips only, and 25% of what is collected goes to the city treasury and 75% is shared with active players below the line.' },
};
export const LEVER_IDS = (Object.keys(LEVERS) as LeverId[]).filter((id) => !LEVERS[id].abolished);
const snap = (n: number, step: number) => Math.round(Math.round(n / step) * step * 10_000) / 10_000;
/** Clamp + snap to the lever's bounds; non-numbers -> the default. */
export function clampLever(id: LeverId, x: unknown): number {
  const s = LEVERS[id]; const n = Number(x); if (x === null || x === undefined || x === '' || !Number.isFinite(n)) return s.base;
  return Math.min(s.max, Math.max(s.min, snap(n, s.step)));
}

/** Share of property tax and Market / Stock Exchange fees routed to the treasury (the rest is still burned). */
export const TREASURY_SHARE = 0.25;
/** Hard cap on the treasury balance; credits above it are burned. */
export const TREASURY_CAP = 10_000_000;
export const SALES_TAX_MIN_PRICE = 100;
export const SALES_TAX_GAME = 'sales_tax';
export const salesTaxOf = (price: number, rate: number) => (price >= SALES_TAX_MIN_PRICE && rate > 0 ? Math.ceil(price * Math.min(LEVERS.sales_tax.max, rate)) : 0);
export const treasuryShareOf = (amount: number) => Math.floor(Math.max(0, amount) * TREASURY_SHARE);
/** pt2032u: split one collected tax into the treasury share (floor 25%) and the remainder; parts always sum to the whole. */
export const taxShareSplit = (collected: number) => { const total = Math.max(0, Math.floor(collected)); const treasury = treasuryShareOf(total); return { total, treasury, rest: total - treasury }; };

/** Economic policies: one at a time, 24 h, a small multiplier on ONE sector, paid from the treasury. */
export type Sector = 'farming' | 'mining' | 'trading' | 'tourism';
export const SECTORS: Sector[] = ['farming', 'mining', 'trading', 'tourism'];
export type PolicyId = 'farm_subsidy' | 'mining_boom' | 'trade_week' | 'tourism_push';
export interface PolicySpec { id: PolicyId; label: string; icon: string; sector: Sector; mul: number; cost: number; blurb: string }
export const POLICIES: Record<PolicyId, PolicySpec> = {
  farm_subsidy: { id: 'farm_subsidy', label: 'Farming subsidy', icon: '🌾', sector: 'farming', mul: 1.1, cost: 50_000, blurb: 'Crops sell for +10% for 24 h (daily farm caps still apply).' },
  mining_boom: { id: 'mining_boom', label: 'Mining boom', icon: '⛏️', sector: 'mining', mul: 1.1, cost: 50_000, blurb: 'Ore and goods sold to the house pay +10% for 24 h (daily caps still apply).' },
  trade_week: { id: 'trade_week', label: 'Trade week', icon: '📈', sector: 'trading', mul: 0.8, cost: 75_000, blurb: 'Market and Stock Exchange fees −20% for 24 h.' },
  tourism_push: { id: 'tourism_push', label: 'Tourism push', icon: '🏝️', sector: 'tourism', mul: 0.75, cost: 50_000, blurb: 'Resort and Fort McChud tickets −25% for 24 h.' },
};
export const POLICY_IDS = Object.keys(POLICIES) as PolicyId[];
export const POLICY_MS = DAY_MS;
export const POLICY_COOLDOWN_MS = 72 * H_MS; // after the previous policy ends

/** Civic buildings: 3 stages each, paid up front from the treasury (base chips x the price index), built over real time. */
export type BuildingId = 'highway' | 'park' | 'police' | 'transit' | 'lights' | 'hospital' | 'school';
export type PerkId = 'truck_speed' | 'xp' | 'property_upkeep' | 'ticket' | 'freight_fee' | 'vehicle_upkeep' | 'trade_fee';
export interface BuildingSpec { id: BuildingId; label: string; icon: string; perk: PerkId; stages: [number, number, number]; buildMs: [number, number, number]; perkBy: [number, number, number]; perkText: string }
export const BUILDINGS: Record<BuildingId, BuildingSpec> = {
  highway: { id: 'highway', label: 'Roads → Highway', icon: '🛣️', perk: 'truck_speed', stages: [250_000, 500_000, 1_000_000], buildMs: [12 * H_MS, 24 * H_MS, 48 * H_MS], perkBy: [0.1, 0.2, 0.3], perkText: 'trucks travel faster' },
  park: { id: 'park', label: 'City Park', icon: '🌳', perk: 'xp', stages: [150_000, 300_000, 600_000], buildMs: [12 * H_MS, 24 * H_MS, 24 * H_MS], perkBy: [0.03, 0.06, 0.1], perkText: 'more skill XP' },
  police: { id: 'police', label: 'Police Station', icon: '🚓', perk: 'property_upkeep', stages: [300_000, 600_000, 1_200_000], buildMs: [24 * H_MS, 24 * H_MS, 24 * H_MS], perkBy: [0.1, 0.2, 0.3], perkText: 'lower property tax (upkeep)' },
  transit: { id: 'transit', label: 'Transit Hub', icon: '🚉', perk: 'ticket', stages: [200_000, 400_000, 800_000], buildMs: [12 * H_MS, 24 * H_MS, 48 * H_MS], perkBy: [0.1, 0.2, 0.3], perkText: 'cheaper Resort & Fort McChud tickets' },
  lights: { id: 'lights', label: 'Street Lights', icon: '💡', perk: 'freight_fee', stages: [100_000, 200_000, 400_000], buildMs: [6 * H_MS, 12 * H_MS, 24 * H_MS], perkBy: [0.05, 0.1, 0.15], perkText: 'cheaper hired / plane / ship freight' },
  hospital: { id: 'hospital', label: 'Hospital upgrade', icon: '🏥', perk: 'vehicle_upkeep', stages: [200_000, 400_000, 800_000], buildMs: [24 * H_MS, 24 * H_MS, 24 * H_MS], perkBy: [0.1, 0.2, 0.3], perkText: 'lower truck, boat and jet upkeep (healthy crews)' },
  school: { id: 'school', label: 'School upgrade', icon: '🏫', perk: 'trade_fee', stages: [200_000, 400_000, 800_000], buildMs: [24 * H_MS, 24 * H_MS, 24 * H_MS], perkBy: [0.05, 0.1, 0.15], perkText: 'lower Market & Stock fees' },
};
export const BUILDING_IDS = Object.keys(BUILDINGS) as BuildingId[];
export const MAX_STAGE = 3;
export interface BuildingState { id: BuildingId; stage: number; /** stage under construction (stage + 1) and when it finishes */ building: { stage: number; doneAt: number; startedAt: number } | null }
/** Completed stage at t (a finished construction counts even before the server writes it back). */
export const stageAt = (b: BuildingState | undefined, t: number) => !b ? 0 : b.building && b.building.doneAt <= t ? b.building.stage : b.stage;
export const underConstruction = (b: BuildingState | undefined, t: number) => !!b?.building && b.building.doneAt > t;
/** Perk size (0..1) for a building at stage s. */
export const perkOf = (id: BuildingId, s: number) => (s <= 0 ? 0 : BUILDINGS[id].perkBy[Math.min(MAX_STAGE, s) - 1]!);
/** Civic buildings around the city (Dayne 2026-11-07 t1962u: they used to stand in one row on a grass strip west of the
 *  city at x -144..-127). Each plot sits on a street frontage, turned to face it (rot = the same convention as house OBBs).
 *  Only position changes: ids, build state, stages and perks are keyed by BuildingId as before. Lots under a plot are
 *  "retired" in shared/realEstate.ts (no longer for sale, hidden unless someone owns them); nothing owned is ever removed. */
export const CIVIC_PLOTS: Record<BuildingId, { x: number; z: number; rot: number }> = {
  highway: { x: -101, z: -54, rot: 3.03 }, // west edge, where the west street leaves the city
  park: { x: 68, z: -13, rot: -1.555 }, // east, on the old pocket park
  police: { x: 39, z: 10, rot: 0 }, // midtown, the block east of City Hall
  transit: { x: -13, z: -59, rot: 0 }, // north avenue just outside downtown
  lights: { x: 100, z: -45, rot: 0.11 }, // east edge near the Warehouse: maintenance depot
  hospital: { x: 13, z: -35, rot: 0 }, // midtown, beside the Employment Office
  school: { x: -60, z: -74, rot: 0.434 }, // north-west residential streets
};
export const CIVIC_W = 12; export const CIVIC_D = 7;
export const civicPlotOf = (id: BuildingId) => ({ ...CIVIC_PLOTS[id], w: CIVIC_W, d: CIVIC_D });
export const civicPlot = (i: number) => civicPlotOf(BUILDING_IDS[i]!);
/** Footprint that clears/retires lots (the drawn pad is w+1 x d+0.6). */
export const civicPad = (id: BuildingId) => ({ ...CIVIC_PLOTS[id], w: CIVIC_W + 1, d: CIVIC_D + 0.6 });
/** True on (or within m of) any civic pad. */
export const inCivic = (x: number, z: number, m = 0) => BUILDING_IDS.some((id) => { const p = civicPad(id); const c = Math.cos(p.rot), s = Math.sin(p.rot); const dx = x - p.x, dz = z - p.z;
  return Math.abs(dx * c - dz * s) < p.w / 2 + m && Math.abs(dx * s + dz * c) < p.d / 2 + m; });
export const PERK_BUILDING: Record<PerkId, BuildingId> = Object.fromEntries(BUILDING_IDS.map((b) => [BUILDINGS[b].perk, b])) as Record<PerkId, BuildingId>;

/**
 * Treasury projects (pt2027u, Nov 8 2026): short, public, treasury-funded boosts on top of an EXISTING civic perk.
 * They never pay a wallet: the effect is a city-wide rate (everyone, the mayor included, gets the same). The combined
 * perk (building stage + project) is capped at that building's fully-built perk, so a project can never exceed what the
 * city could already build permanently. One run of each project at a time, then a cooldown after it ends.
 * Public-building upgrades = BUILDINGS above; temporary production bonuses = POLICIES above (both already treasury-funded).
 */
export type ProjectId = 'road_repair' | 'community_festival';
export interface ProjectSpec { id: ProjectId; label: string; icon: string; perk: PerkId; boost: number; cost: number; durationMs: number; cooldownMs: number; blurb: string }
export const PROJECTS: Record<ProjectId, ProjectSpec> = {
  road_repair: { id: 'road_repair', label: 'Road repairs', icon: '🚧', perk: 'truck_speed', boost: 0.1, cost: 120_000, durationMs: 72 * H_MS, cooldownMs: 72 * H_MS, blurb: 'Crews resurface the roads: hired and own trucks travel 10% faster for 72 h, on top of the Highway (combined max 30%).' },
  community_festival: { id: 'community_festival', label: 'Community festival', icon: '🎪', perk: 'xp', boost: 0.05, cost: 75_000, durationMs: 48 * H_MS, cooldownMs: 72 * H_MS, blurb: 'A city-wide festival: everyone earns 5% more skill XP for 48 h, on top of the City Park (combined max 10%).' },
};
export const PROJECT_IDS = Object.keys(PROJECTS) as ProjectId[];
export interface ProjectRun { id: string; project: ProjectId; startsAt: number; endsAt: number; cost: number; by: string }
/** Perk cap for a project: the fully built perk of the building that owns it. */
export const projectCap = (p: ProjectId) => BUILDINGS[PERK_BUILDING[PROJECTS[p].perk]].perkBy[MAX_STAGE - 1]!;
/** Combined perk = building perk + active project boosts on that perk, capped at the fully-built perk. */
export function combinedPerk(perk: PerkId, buildingPerk: number, runs: ProjectRun[], t: number): number {
  let add = 0; for (const r of runs) if (PROJECTS[r.project]?.perk === perk && r.startsAt <= t && r.endsAt > t) add = Math.max(add, PROJECTS[r.project].boost); // non-stacking
  const cap = BUILDINGS[PERK_BUILDING[perk]].perkBy[MAX_STAGE - 1]!;
  return Math.min(Math.max(buildingPerk, cap), buildingPerk + add);
}
/** pt2037u: the mayor can end the decorative city riot joke for EXACTLY this many treasury chips (not price-indexed). Once ended it stays ended. */
export const RIOT_STOP_COST = 3_000;
export const isRequestId = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(x);

/** Approval + recall. */
export const APPROVAL_WINDOW_MS = 7 * DAY_MS;
export const APPROVAL_MIN_VOTES = 10;
export const RECALL_MAX_APPROVAL = 0.35;
export const RECALL_MIN_RATERS = 20;
export const RECALL_FEE = 1_000;
export const RECALL_GRACE_MS = 48 * H_MS; // no recall in a term's first 48 h
export const RECALL_VOTE_MS = DAY_MS;
export const RECALL_PASS = 0.6;
export const RECALL_TURNOUT = 0.4; // of that week's election turnout
export const RECALL_MIN_VOTES = 15;
export const recallNeeded = (electionVotes: number) => Math.max(RECALL_MIN_VOTES, Math.ceil(electionVotes * RECALL_TURNOUT));
export const recallPasses = (yes: number, no: number, electionVotes: number) => yes + no >= recallNeeded(electionVotes) && yes / Math.max(1, yes + no) >= RECALL_PASS;

/** Accounts that never take part in city politics or feed the public treasury. */
export const isExcludedName = (n: string) => { const t = String(n ?? '').trim(); return /^qa[-_ ]/i.test(t) || /^guest/i.test(t) || /^bot(?![a-z])/i.test(t); };

export type ActionKind = 'lever' | 'policy' | 'project' | 'build' | 'built' | 'recall_open' | 'recall_result' | 'admin' | 'event';
export interface CityAction { id: string; at: number; by: string; kind: ActionKind; text: string }
export interface TreasuryRow { id: string; at: number; kind: string; amount: number; balance: number; memo: string }
export interface CityView {
  now: number; index: number;
  levers: Record<LeverId, { value: number; pending: { value: number; effectiveAt: number } | null; nextChangeAt: number }>;
  policy: { id: PolicyId; startsAt: number; endsAt: number; by: string } | null; nextPolicyAt: number;
  projects?: Array<{ id: ProjectId; cost: number; active: ProjectRun | null; nextAt: number; headroom: number }>;
  projectLog?: ProjectRun[];
  /** Decorative riot joke: active until a mayor pays to end it (persisted, shared by every server). */
  riot?: { active: boolean; resolvedAt: number | null; by: string | null; cost: number };
  treasury: { balance: number; in7d: number; out7d: number; ledger: TreasuryRow[] };
  buildings: Array<BuildingState & { stageNow: number; nextCost: number | null }>;
  approval: { up: number; down: number; rating: number | null };
  recall: { id: string; endsAt: number; yes: number; no: number; needed: number; result: string | null } | null;
  actions: CityAction[];
  me?: { excluded: boolean; isMayor: boolean; ratedToday: boolean | null; canRecall: boolean; recallReason?: string; votedRecall: boolean };
}
export const leverText = (id: LeverId, v: number) => LEVERS[id].unit === 'pct' ? `${+(v * 100).toFixed(2)}%` : `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`;
