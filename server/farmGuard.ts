/**
 * In-memory farm anti-bot (open hours only — overnight is the full hub sleep lockout):
 * per-account plant/harvest rate limits and a Jay-style clockwork regularity check.
 * No Neon writes, no auto soft-disable — just refuse the action (caller throws FarmError).
 * Process-local: resets on restart.
 *
 * Tuned against observed bot patterns (~2s plant bursts, ~60s harvest cadence).
 */
const PLANT_GAP_MS = 800;
const PLANT_MAX = 20;
const PLANT_WINDOW_MS = 60_000;

const HARVEST_GAP_MS = 1_500;
const HARVEST_MAX = 40;
const HARVEST_WINDOW_MS = 60 * 60_000;

const REG_KEEP = 10;
const REG_MIN_GAPS = 7;
const HARVEST_CADENCE_LO = 25_000;
const HARVEST_CADENCE_HI = 90_000;
const PLANT_CADENCE_LO = 1_200;
const PLANT_CADENCE_HI = 3_500;
const REG_CV_MAX = 0.08;

export const FARM_RATE_MSG = 'Too many farm actions. Slow down a bit.';
export const FARM_CLOCKWORK_MSG = 'Farming looks automated. Vary your timing.';

interface AccState { plant: number[]; harvest: number[] }
const accounts = new Map<string, AccState>();

function state(key: string): AccState {
  let s = accounts.get(key);
  if (!s) { s = { plant: [], harvest: [] }; accounts.set(key, s); }
  return s;
}

function prune(list: number[], now: number, windowMs: number): number[] {
  return list.filter((t) => now - t < windowMs);
}

function cv(gaps: number[]): number {
  if (gaps.length < 2) return 1;
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (mean <= 0) return 1;
  let sum = 0;
  for (const g of gaps) { const d = g - mean; sum += d * d; }
  return Math.sqrt(sum / gaps.length) / mean;
}

function gapsOf(times: number[]): number[] {
  const g: number[] = [];
  for (let i = 1; i < times.length; i++) g.push(times[i]! - times[i - 1]!);
  return g;
}

function clockwork(times: number[], lo: number, hi: number): boolean {
  if (times.length < REG_MIN_GAPS + 1) return false;
  const recent = times.slice(-(REG_MIN_GAPS + 1));
  const gaps = gapsOf(recent);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (mean < lo || mean > hi) return false;
  return cv(gaps) < REG_CV_MAX;
}

/** Returns an error message to throw, or null when allowed. Records the action on success. */
export function checkFarmAction(kind: 'plant' | 'harvest', accountKey: string, now = Date.now()): string | null {
  const key = accountKey.trim().toLowerCase();
  if (!key) return FARM_RATE_MSG;
  const s = state(key);
  const list = kind === 'plant' ? s.plant : s.harvest;
  const gapMs = kind === 'plant' ? PLANT_GAP_MS : HARVEST_GAP_MS;
  const max = kind === 'plant' ? PLANT_MAX : HARVEST_MAX;
  const windowMs = kind === 'plant' ? PLANT_WINDOW_MS : HARVEST_WINDOW_MS;
  const cadLo = kind === 'plant' ? PLANT_CADENCE_LO : HARVEST_CADENCE_LO;
  const cadHi = kind === 'plant' ? PLANT_CADENCE_HI : HARVEST_CADENCE_HI;

  if (clockwork(list, cadLo, cadHi)) return FARM_CLOCKWORK_MSG;

  const kept = prune(list, now, Math.max(windowMs, cadHi * (REG_MIN_GAPS + 1)));
  const last = kept[kept.length - 1];
  if (last !== undefined && now > last && now - last < gapMs) return FARM_RATE_MSG;
  const inWindow = kept.filter((t) => now - t < windowMs);
  if (inWindow.length >= max) return FARM_RATE_MSG;

  kept.push(now);
  if (kind === 'plant') s.plant = kept.slice(-Math.max(REG_KEEP, max + 2));
  else s.harvest = kept.slice(-Math.max(REG_KEEP, max + 2));

  if (accounts.size > 8_000) {
    for (const [k, v] of accounts) {
      const lastA = Math.max(v.plant[v.plant.length - 1] ?? 0, v.harvest[v.harvest.length - 1] ?? 0);
      if (!lastA || now - lastA > 2 * HARVEST_WINDOW_MS) accounts.delete(k);
    }
  }
  return null;
}

export function resetFarmGuardForTest(): void { accounts.clear(); }
