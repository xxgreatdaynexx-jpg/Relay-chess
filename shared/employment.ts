/**
 * Employment Office (pt1274u): hire AI workers that mine or fish for you. Pure rules shared by the server (authoritative)
 * and the client (display). All chip amounts are BASE units; the server scales them by the price index (px).
 *
 * Balance: a worker's daily wage + its hire fee amortised over a week ≈ 50% of the expected house value of what it
 * brings in on a full day (collected at least every 8 h). Output lands in your normal storage (ores → mine storage,
 * fish → cooler), so it sells through the usual daily sell tiers (no cap bypass) and gives the owner no skill XP.
 *   wage  = 45% of a full day's expected output
 *   hire  = 35% of a full day's expected output  (≈ 5%/day over 7 days)
 * Miners: 1 ore / 10 min from the chosen mine's normal ore mix (no key/chest drops).
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
export type MinerCave = 'mine' | 'frost' | 'magma';
export const MINER_CAVES: MinerCave[] = ['mine', 'frost', 'magma'];
export const isMinerCave = (v: unknown): v is MinerCave => v === 'mine' || v === 'frost' || v === 'magma';

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
export const minerItemEv = (c: MinerCave) => CAVES[c].nodes.reduce((a, n) => a + ORES[n.ore].price, 0) / CAVES[c].nodes.length;
export interface JobDef { id: string; kind: WorkerKind; cave?: MinerCave; label: string; emoji: string; everyMs: number; itemEv: number; blurb: string }
const r5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
export const JOBS: JobDef[] = [
  ...MINER_CAVES.map((c): JobDef => ({ id: `miner:${c}`, kind: 'miner', cave: c, label: `Miner · ${CAVES[c].name}`, emoji: '⛏️', everyMs: 10 * MIN, itemEv: minerItemEv(c), blurb: `1 ore every 10 min from ${CAVES[c].name}'s normal ore mix. No keys or chests.` })),
  { id: 'fisher', kind: 'fisher', label: 'Fisher · Lake Dock', emoji: '🎣', everyMs: 60 * MIN, itemEv: FISHER_ITEM_EV, blurb: '1 fish every hour from the normal catch table (no junk). Goes in your cooler.' },
];
export const jobById = (id: unknown) => JOBS.find((j) => j.id === id);
/** Items on a full day, expected base value of a full day, and the BASE prices derived from it. */
export const itemsPerDay = (j: JobDef) => DAY / j.everyMs;
export const dayValue = (j: JobDef) => itemsPerDay(j) * j.itemEv;
export const baseWage = (j: JobDef) => r5(dayValue(j) * WAGE_SHARE);
export const baseHire = (j: JobDef) => r5(dayValue(j) * HIRE_SHARE);
/** Cost / expected output over the first `days` days (hire fee + wages). ≈ 0.5 over a week. */
export const costShare = (j: JobDef, days = AMORTISE_DAYS) => (baseHire(j) + baseWage(j) * days) / (dayValue(j) * days);

/** Uniform [0,1) source (crypto on the server, seeded in tests). */
export type Unit = () => number;
export function rollOre(cave: MinerCave, u: Unit): OreId {
  const c = CAVES[cave]; return c.nodes[Math.min(c.nodes.length - 1, Math.floor(u() * c.nodes.length))]!.ore;
}
/** Normal catch table with junk taken out (junk is the first 10% of the rarity roll). */
export function rollWorkerFish(u: Unit): { fish: Fish; grams: number; value: number } {
  const junk = RARITY_ODDS.junk / 100; const f = rollFish(junk + u() * (1 - junk), u()); const grams = rollWeight(f, u());
  return { fish: f, grams, value: fishValue(f, grams) };
}

/** Pending output in a worker's box. */
export interface WorkerBox { ores?: Partial<Record<OreId, number>>; fish?: Array<{ species: string; grams: number; value: number }> }
export const boxCount = (b: WorkerBox) => Object.values(b.ores ?? {}).reduce((a, n) => a + (n ?? 0), 0) + (b.fish?.length ?? 0);
export type WorkerStatus = 'working' | 'idle' | 'unpaid';
export interface WorkerView { id: string; job: string; status: WorkerStatus; hiredAt: number; paidUntil: number; seenAt: number; nextAt: number | null; box: WorkerBox; boxValue: number; wage: number }
export interface EmployView { workers: WorkerView[]; jobs: Array<{ id: string; hire: number; wage: number; perDay: number; dayValue: number }>; now: number; canHire: boolean; reason?: string; max: number }
