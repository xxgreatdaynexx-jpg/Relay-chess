/**
 * Employment Office production view: workers grouped by workplace, expected resources per hour (from the same
 * expectedDayHaul math as the per-worker "Expected per day" line), and the hourly pick-up history for the graph.
 * Display-only; nothing here changes what workers produce.
 */
import { JOBS, expectedDayHaul, jobById, type EmployHourItem, type EmployLogItem, type WorkerView } from './employment.js';
import { ORES, type OreId } from './mines.js';

export const HOUR_MS = 3_600_000;
/** Resource key for rates and the graph: the ore id, or 'fish' for every fish species. */
export const resourceKey = (type: 'ore' | 'fish', id: string) => (type === 'ore' ? id : 'fish');
export const resourceLabel = (key: string) => (key === 'fish' ? 'Fish' : ORES[key as OreId]?.name ?? key);
export const resourceColor = (key: string) => (key === 'fish' ? '#4fb3ff' : ORES[key as OreId]?.color ?? '#cccccc');

export interface WorkplaceGroup { job: string; label: string; emoji: string; workers: WorkerView[] }
/** Group workers by workplace (job), biggest group first; ties keep the hire-card order. Hire order inside a group. */
export function workplaceGroups(workers: WorkerView[]): WorkplaceGroup[] {
  const m = new Map<string, WorkerView[]>();
  for (const w of workers) { const a = m.get(w.job) ?? []; a.push(w); m.set(w.job, a); }
  const order = (id: string) => { const i = JOBS.findIndex((j) => j.id === id); return i < 0 ? JOBS.length : i; };
  return [...m.entries()]
    .map(([job, ws]) => { const j = jobById(job); return { job, label: j?.label ?? job, emoji: j?.emoji ?? '🧑‍🏭', workers: [...ws].sort((a, b) => a.hiredAt - b.hiredAt || a.id.localeCompare(b.id)) }; })
    .sort((a, b) => b.workers.length - a.workers.length || order(a.job) - order(b.job));
}

export interface RateItem { key: string; perHour: number }
export interface WorkplaceRate { job: string; working: number; total: number; perHour: number; items: RateItem[] }
export interface ProductionRates { perHour: number; items: RateItem[]; byJob: WorkplaceRate[] }
const sortItems = (m: Map<string, number>): RateItem[] => [...m.entries()].map(([key, perHour]) => ({ key, perHour })).sort((a, b) => b.perHour - a.perHour || a.key.localeCompare(b.key));
/** Expected items per hour right now: working (paid) workers only, each at its job's pick rate and priority. */
export function productionRates(workers: WorkerView[]): ProductionRates {
  const all = new Map<string, number>();
  const byJob = workplaceGroups(workers).map((g): WorkplaceRate => {
    const m = new Map<string, number>(); let working = 0;
    const j = jobById(g.job);
    for (const w of g.workers) {
      if (w.status !== 'working' || !j) continue; working++;
      for (const it of expectedDayHaul(j, j.kind === 'miner' ? (w.priority ?? null) : null).items) {
        const k = resourceKey(it.type, it.id); const q = it.qty / 24;
        m.set(k, (m.get(k) ?? 0) + q); all.set(k, (all.get(k) ?? 0) + q);
      }
    }
    const items = sortItems(m);
    return { job: g.job, working, total: g.workers.length, perHour: items.reduce((a, x) => a + x.perHour, 0), items };
  });
  const items = sortItems(all);
  return { perHour: items.reduce((a, x) => a + x.perHour, 0), items, byJob };
}

/** Last-24 h totals per resource key (fish species folded into 'fish'). */
export function last24ByResource(log: EmployLogItem[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of log) { const k = resourceKey(x.type, x.id); m.set(k, (m.get(k) ?? 0) + x.qty); }
  return m;
}

export interface HourlySeries { hours: number[]; series: Array<{ key: string; values: number[]; total: number }>; max: number }
/** `hours` hourly buckets ending with the current (partial) hour; one series per resource, largest total first. */
export function hourlySeries(rows: EmployHourItem[], now: number, hours = 24): HourlySeries {
  const last = Math.floor(now / HOUR_MS) * HOUR_MS; const first = last - (hours - 1) * HOUR_MS;
  const hs = Array.from({ length: hours }, (_, i) => first + i * HOUR_MS);
  const m = new Map<string, number[]>();
  for (const r of rows) {
    const i = Math.round((Math.floor(r.t / HOUR_MS) * HOUR_MS - first) / HOUR_MS); if (i < 0 || i >= hours) continue;
    const k = resourceKey(r.type, r.id); const v = m.get(k) ?? new Array<number>(hours).fill(0); v[i]! += r.qty; m.set(k, v);
  }
  const series = [...m.entries()].map(([key, values]) => ({ key, values, total: values.reduce((a, n) => a + n, 0) })).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  return { hours: hs, series, max: Math.max(0, ...series.flatMap((s) => s.values)) };
}

/** "12.5" / "3" / "0.4" / "<0.1" per-hour figure. */
export function perHourText(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 10) return String(Math.round(n));
  if (n >= 0.1) return (Math.round(n * 10) / 10).toString();
  return '<0.1';
}
