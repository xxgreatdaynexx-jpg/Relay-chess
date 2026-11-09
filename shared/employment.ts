/**
 * Employment Office (pt1274u): hire AI workers that mine or fish for you. Pure rules shared by the server (authoritative)
 * and the client (display). All chip amounts are BASE units; the server scales them by the price index (px).
 *
 * Balance: a worker's daily wage + its hire fee amortised over a week ≈ 50% of the expected house value of what it
 * brings in on a full day (collected at least every 8 h). Output lands in your normal storage (ores → mine storage,
 * fish → cooler), so it sells through the usual daily sell tiers (no cap bypass) and gives the owner no skill XP.
 *   wage  = 45% of a full day's expected output
 *   hire  = 35% of a full day's expected output  (≈ 5%/day over 7 days)
 * pt1378u: every worker now picks every 5 min (miners 2x, fishers 12x); now every 3 min (480/day); wage/hire are still priced off the old rates below.
 * Miners: 1 ore / 10 min, biased toward the mine's signature ores (MINER_BIAS), no key/chest drops.
 * Fishers: 1 fish / hour from the normal catch table minus junk (a fish is ~11x an ore: at 1 / 10 min a fisher would
 * bring in 3x the fish dock's old daily sell cap, so after the sell tiers it could never pay for itself).
 */
import { CAVES, ORES, type OreId } from './mines.js';
import { fishPool, RARITY_ODDS, rollFish, rollWeight, fishValue, type Fish } from './fishing.js';

export const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
export const MAX_WORKERS = 3;
/** Uncollected work stops piling up 8 h after your last visit (idle accounts / alts can't farm it). */
export const OFFLINE_CAP_MS = 8 * HOUR;
/** Accounts younger than this can't hire. */
export const MIN_ACCOUNT_AGE_MS = DAY;
export const WAGE_SHARE = 0.45, HIRE_SHARE = 0.35, AMORTISE_DAYS = 7;
export type WorkerKind = 'miner' | 'fisher';
/** City mines workers may run (incl. Stone Quarry — stone-only output). */
export type MinerCave = 'mine' | 'frost' | 'magma' | 'quarry';
export const MINER_CAVES: MinerCave[] = ['mine', 'frost', 'magma', 'quarry'];
export const isMinerCave = (v: unknown): v is MinerCave => v === 'mine' || v === 'frost' || v === 'magma' || v === 'quarry';

/** Expected base value of one fish from the worker's table (junk removed, average size → 1.0x base). */
export const FISHER_ITEM_EV = (() => {
  let ev = 0, tot = 0;
  for (const r of Object.keys(RARITY_ODDS) as Array<keyof typeof RARITY_ODDS>) {
    if (r === 'junk') continue; const pool = fishPool('lake').filter((f) => f.rarity === r);
    ev += RARITY_ODDS[r] * pool.reduce((a, f) => a + f.base, 0) / pool.length; tot += RARITY_ODDS[r];
  }
  return ev / tot;
})();

/** Expected base value of one ore: the mine's real node mix (each node always holds the same ore). */
/**
 * Per-mine gather bias (pt1350u): a share of picks comes from the mine's signature ores, the rest from the mine's
 * normal node mix minus those ores. Tuned so value/hour stays within ~1% of the old unbiased mix (see tests).
 * `restScale` re-weights ores in the remainder (e.g. trims stone or drops the diamond jackpot) to pay for a pricey bias.
 * Player manual mining is unaffected (it uses the cave nodes directly).
 */
export interface MinerBias { share: number; ores: Partial<Record<OreId, number>>; restScale?: Partial<Record<OreId, number>>; label: string }
export const MINER_BIAS: Record<MinerCave, MinerBias> = {
  // pt1357u: ~85% signature, matching the cave rocks exactly (gold lightest of the three)
  mine:  { share: 0.86,  ores: { iron: 47, stone: 24, gold: 9 }, label: 'Mostly Iron Ore, Stone & Gold Ore' },
  // crystal is 5x silver's price, so it stays a rare pick; the rest is mostly stone
  frost: { share: 0.768, ores: { silver: 62, gem: 1 }, label: 'Mostly Silver Ore & Crystal' },
  magma: { share: 0.854, ores: { coal: 1, copper: 1 }, label: 'Mostly Coal & Copper Ore' },
  // Stone Quarry: only Stone (matches cave nodes); share 1 so the empty remainder is unused.
  quarry: { share: 1, ores: { stone: 1 }, label: 'Only Stone' },
};
/** The normal (unbiased) node mix: ore -> fraction of nodes. */
export function caveMix(c: MinerCave): Partial<Record<OreId, number>> {
  const m: Partial<Record<OreId, number>> = {}; const ns = CAVES[c].nodes;
  for (const n of ns) m[n.ore] = (m[n.ore] ?? 0) + 1 / ns.length;
  return m;
}
const evOf = (t: Array<[OreId, number]>) => t.reduce((a, [o, w]) => a + ORES[o].price * w, 0);
/** Final worker pick table for a mine: [ore, probability], probabilities sum to 1. */
export function minerTable(c: MinerCave): Array<[OreId, number]> {
  const b = MINER_BIAS[c]; const bt = Object.values(b.ores).reduce((a, w) => a + (w ?? 0), 0);
  const biased = Object.entries(b.ores).map(([o, w]): [OreId, number] => [o as OreId, b.share * (w ?? 0) / bt]);
  if (b.share >= 1) return biased;
  const rest = Object.entries(caveMix(c)).filter(([o]) => !(o in b.ores)).map(([o, w]): [OreId, number] => [o as OreId, (w ?? 0) * (b.restScale?.[o as OreId] ?? 1)]).filter(([, w]) => w > 0);
  const rt = rest.reduce((a, [, w]) => a + w, 0);
  if (rt <= 0) return biased;
  return [...biased, ...rest.map(([o, w]): [OreId, number] => [o, (1 - b.share) * w / rt])];
}
/** Worker value per ore before any bias (pt1350u baseline, from the old node mix): the economy anchor the tests hold to. */
/** pt1379u: The Mine re-anchored to its iron-heavy mix (more iron, less gold, request #25). */
export const WORKER_EV_BEFORE: Record<MinerCave, number> = { mine: 5.606, frost: 6.665, magma: 2.674, quarry: 0.1 };
/** Per-ore value of the cave's current node mix. */
export const unbiasedItemEv = (c: MinerCave) => CAVES[c].nodes.reduce((a, n) => a + ORES[n.ore].price, 0) / CAVES[c].nodes.length;
export const minerItemEv = (c: MinerCave) => evOf(minerTable(c));
export interface JobDef { id: string; kind: WorkerKind; cave?: MinerCave; label: string; emoji: string; everyMs: number; /** pt1378u: wage/hire stay priced off the old interval, so the 5-min buff is pure extra output */ priceEveryMs: number; itemEv: number; blurb: string; /** miners: 'Mostly …' gather bias */ bias?: string }
/** pt1378u: every worker brings in one pick every 3 minutes (480/day; was 5 min / 288). */
export const WORKER_EVERY_MS = 3 * MIN;
/** pt1966u (Dayne 2026-11-07 "Give mining employees a buff"): miners pick every 2 min (720/day, +50% ore); wage and hire fee
 *  stay priced off priceEveryMs, so the extra ore is pure profit. Fishers and manual mining are unchanged. */
export const MINER_EVERY_MS = 2 * MIN;
const r5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
export const JOBS: JobDef[] = [
  ...MINER_CAVES.map((c): JobDef => ({ id: `miner:${c}`, kind: 'miner', cave: c, label: `Miner · ${CAVES[c].name}`, emoji: '⛏️', everyMs: MINER_EVERY_MS, priceEveryMs: 10 * MIN, itemEv: minerItemEv(c), blurb: `1 ore every 2 min from ${CAVES[c].name}. ${MINER_BIAS[c].label}. No keys or chests.`, bias: MINER_BIAS[c].label })),
  { id: 'fisher', kind: 'fisher', label: 'Fisher · Lake Dock', emoji: '🎣', everyMs: WORKER_EVERY_MS, priceEveryMs: 60 * MIN, itemEv: FISHER_ITEM_EV, blurb: '1 fish every 3 min from the normal catch table (no junk). Goes in your cooler.' },
];
export const jobById = (id: unknown) => JOBS.find((j) => j.id === id);
/** Items on a full day, expected base value of a full day, and the BASE prices derived from it. */
export const itemsPerDay = (j: JobDef) => DAY / j.everyMs;
export const dayValue = (j: JobDef) => itemsPerDay(j) * j.itemEv;
/** Old-rate day value that wages and hire fees are anchored to (unchanged by the pt1378u speed buff). */
export const priceDayValue = (j: JobDef) => DAY / j.priceEveryMs * j.itemEv;
export const baseWage = (j: JobDef) => r5(priceDayValue(j) * WAGE_SHARE);
export const baseHire = (j: JobDef) => r5(priceDayValue(j) * HIRE_SHARE);
/** Cost / expected output over the first `days` days (hire fee + wages). ≈ 0.5 over a week. */
export const costShare = (j: JobDef, days = AMORTISE_DAYS) => (baseHire(j) + baseWage(j) * days) / (priceDayValue(j) * days);

/** Uniform [0,1) source (crypto on the server, seeded in tests). */
export type Unit = () => number;
export function rollOre(cave: MinerCave, u: Unit, priority: OreId | null = null): OreId {
  const t = minerPickTable(cave, priority); let x = u();
  for (const [o, w] of t) { if (x < w) return o; x -= w; }
  return t[t.length - 1]![0];
}

/** Ores a miner at this cave can prioritize (those with positive weight in the balanced table). Quarry → stone only. */
export function minerPriorityOptions(cave: MinerCave): OreId[] {
  return minerTable(cave).filter(([, w]) => w > 1e-12).map(([o]) => o);
}
/** Balanced (null) or one of the cave's ores. */
export type MinerPriority = OreId | null;
export const PRIORITY_FOCUS = 3; // soft focus before EV clamp
const mixTables = (a: Array<[OreId, number]>, b: Array<[OreId, number]>, m: number): Array<[OreId, number]> => {
  const keys = new Set([...a.map(([o]) => o), ...b.map(([o]) => o)]);
  const wa = Object.fromEntries(a) as Partial<Record<OreId, number>>;
  const wb = Object.fromEntries(b) as Partial<Record<OreId, number>>;
  const out: Array<[OreId, number]> = [];
  for (const o of keys) { const w = (1 - m) * (wa[o] ?? 0) + m * (wb[o] ?? 0); if (w > 1e-15) out.push([o, w]); }
  const s = out.reduce((x, [, w]) => x + w, 0);
  return out.map(([o, w]) => [o, w / s]);
};
/**
 * Player priority table: Balanced = minerTable. Prioritizing ore X multiplies X's weight by PRIORITY_FOCUS then
 * renormalizes; if that would raise expected value above Balanced, blend back toward Balanced until EV matches.
 * So volume/hour is unchanged and prioritizing a rare/pricey ore cannot beat Balanced on EV — you get more of it
 * by trading other ores value-neutrally. Prioritizing a cheap ore (e.g. stone) can lower EV (player choice).
 */
export function minerPickTable(cave: MinerCave, priority: MinerPriority): Array<[OreId, number]> {
  const base = minerTable(cave);
  if (!priority) return base;
  if (!base.some(([o]) => o === priority)) return base; // unknown / not in cave → Balanced
  if (base.length === 1) return base; // quarry stone-only
  const baseEv = evOf(base);
  const boosted = base.map(([o, w]): [OreId, number] => [o, o === priority ? w * PRIORITY_FOCUS : w]);
  const sum = boosted.reduce((a, [, w]) => a + w, 0);
  const focused = boosted.map(([o, w]): [OreId, number] => [o, w / sum]);
  if (evOf(focused) <= baseEv + 1e-12) return focused;
  // EV would rise: find largest blend m in [0,1] with EV(mix) <= baseEv
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (evOf(mixTables(base, focused, mid)) > baseEv) hi = mid; else lo = mid;
  }
  return mixTables(base, focused, lo);
}
export const parseMinerPriority = (cave: MinerCave, v: unknown): MinerPriority => {
  if (v == null || v === '' || v === 'balanced') return null;
  if (typeof v !== 'string' || !minerPriorityOptions(cave).includes(v as OreId)) return null;
  return v as OreId;
};
/** Normal catch table with junk taken out (junk is the first 10% of the rarity roll). */
export function rollWorkerFish(u: Unit): { fish: Fish; grams: number; value: number } {
  const junk = RARITY_ODDS.junk / 100; const f = rollFish(junk + u() * (1 - junk), u()); const grams = rollWeight(f, u());
  return { fish: f, grams, value: fishValue(f, grams) };
}

/**
 * Expected haul over a full paid day of continuous work (pt2088u). Same pick tables / fish odds the server uses
 * (minerPickTable + priority, rollWorkerFish). Does not model offline 8 h idle, storage-full holding, or unpaid
 * downtime — those cut real output below this. Workers ignore player skill/gear. Quantities are means, not guarantees.
 */
export interface ExpectedDayItem { type: 'ore' | 'fish'; id: string; label: string; qty: number }
export interface ExpectedDayHaul { picks: number; items: ExpectedDayItem[]; /** expected base chip value (pre price-index) */ value: number }

/** Species probabilities for one worker fish catch (junk removed; lake dock; mirrors rollWorkerFish → rollFish). */
export function fisherCatchTable(): Array<{ id: string; label: string; p: number }> {
  const tot = (Object.entries(RARITY_ODDS) as Array<[keyof typeof RARITY_ODDS, number]>).filter(([r]) => r !== 'junk').reduce((a, [, n]) => a + n, 0);
  const out: Array<{ id: string; label: string; p: number }> = [];
  for (const r of Object.keys(RARITY_ODDS) as Array<keyof typeof RARITY_ODDS>) {
    if (r === 'junk') continue;
    const pool = fishPool('lake').filter((f) => f.rarity === r && (f.zone ?? 1) <= 3 && !f.crew);
    if (!pool.length) continue;
    const share = RARITY_ODDS[r] / tot / pool.length;
    for (const f of pool) out.push({ id: f.id, label: f.label, p: share });
  }
  return out;
}

/** Approximate per-day item counts + base value for a job (miners honor priority). */
export function expectedDayHaul(job: JobDef, priority: MinerPriority = null): ExpectedDayHaul {
  const picks = itemsPerDay(job);
  if (job.kind === 'miner' && job.cave) {
    const table = minerPickTable(job.cave, priority);
    const items: ExpectedDayItem[] = table
      .map(([o, p]) => ({ type: 'ore' as const, id: o, label: ORES[o].name, qty: picks * p }))
      .filter((x) => x.qty > 1e-9)
      .sort((a, b) => b.qty - a.qty || a.id.localeCompare(b.id));
    const value = items.reduce((a, x) => a + x.qty * ORES[x.id as OreId].price, 0);
    return { picks, items, value };
  }
  if (job.kind === 'fisher') {
    // Rarity buckets (species within a rarity are equal); keeps the Employment line readable.
    const byR: Record<string, number> = {};
    for (const f of fisherCatchTable()) {
      const fish = fishPool('lake').find((x) => x.id === f.id);
      const r = fish?.rarity ?? f.id;
      byR[r] = (byR[r] ?? 0) + picks * f.p;
    }
    const order = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    const items: ExpectedDayItem[] = order.filter((r) => (byR[r] ?? 0) > 1e-9)
      .map((r) => ({ type: 'fish' as const, id: r, label: r, qty: byR[r]! }));
    // Match wage/EV math: average-size fish → 1.0x base (FISHER_ITEM_EV), not weight-roll EV.
    return { picks, items, value: picks * job.itemEv };
  }
  return { picks: 0, items: [], value: 0 };
}

/** Compact "~12 iron" style quantity (means, so fractional rare ores stay visible). */
export function approxQty(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 100) return String(Math.round(n));
  if (n >= 10) return String(Math.round(n));
  if (n >= 1) {
    const t = Math.round(n * 10) / 10;
    return Number.isInteger(t) ? String(t) : t.toFixed(1);
  }
  if (n >= 0.05) {
    const t = Math.round(n * 10) / 10;
    return t.toFixed(1);
  }
  return '<0.1';
}

/** Short display name: ore id ("iron") or fish label. */
export function expectedItemShort(item: ExpectedDayItem): string {
  if (item.type === 'ore') return item.id;
  return item.label;
}

/** Player-facing one-liner, e.g. "~346 iron, ~177 stone, ~66 gold/day". */
export function formatExpectedDay(haul: ExpectedDayHaul): string {
  if (!haul.items.length) return 'no deterministic estimate';
  return haul.items.map((x) => `~${approxQty(x.qty)} ${expectedItemShort(x)}`).join(', ') + '/day';
}

/** Pending output in a worker's box. */
export interface WorkerBox { ores?: Partial<Record<OreId, number>>; fish?: Array<{ species: string; grams: number; value: number }> }
export const boxCount = (b: WorkerBox) => Object.values(b.ores ?? {}).reduce((a, n) => a + (n ?? 0), 0) + (b.fish?.length ?? 0);
export type WorkerStatus = 'working' | 'idle' | 'unpaid';
export interface WorkerView { id: string; job: string; status: WorkerStatus; hiredAt: number; paidUntil: number; seenAt: number; nextAt: number | null; box: WorkerBox; boxValue: number; wage: number; /** miners only: null = Balanced */ priority?: MinerPriority; priorityOptions?: OreId[] }
/** Last-24 h pick-up log, totalled per item. */
export interface EmployLogItem { type: 'ore' | 'fish'; id: string; qty: number; lastAt: number }
export interface EmployView { log?: EmployLogItem[]; notes?: string[]; workers: WorkerView[]; jobs: Array<{ id: string; hire: number; wage: number; perDay: number; dayValue: number }>; now: number; canHire: boolean; reason?: string; max: number; base?: number; bonus?: number }
