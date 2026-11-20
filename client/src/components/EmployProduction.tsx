import { useMemo, useState } from 'react';
import type { EmployHourItem, EmployLogItem, WorkerView } from '../../../shared/employment';
import { hourlySeries, last24ByResource, perHourText, productionRates, resourceColor, resourceLabel } from '../../../shared/employProduction';

const HOUR_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Edmonton', hour: 'numeric' });
const W = 320, H = 132, PAD_L = 30, PAD_R = 6, PAD_T = 8, PAD_B = 18;

/** Factorio-style line graph: items gathered per hour over the last 24 h, one line per resource. Tap the legend to hide a line. */
export function ProductionGraph({ hourly, now }: { hourly: EmployHourItem[]; now: number }) {
  const data = useMemo(() => hourlySeries(hourly, now, 24), [hourly, now]);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [pick, setPick] = useState<number | null>(null);
  const shown = data.series.filter((s) => !hidden.has(s.key));
  const max = Math.max(1, ...shown.flatMap((s) => s.values));
  const n = data.hours.length;
  const x = (i: number) => PAD_L + (i * (W - PAD_L - PAD_R)) / (n - 1);
  const y = (v: number) => PAD_T + (H - PAD_T - PAD_B) * (1 - v / max);
  const toggle = (k: string) => setHidden((h) => { const n2 = new Set(h); if (n2.has(k)) n2.delete(k); else n2.add(k); return n2; });
  const onPoint = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W;
    setPick(Math.max(0, Math.min(n - 1, Math.round(((px - PAD_L) / (W - PAD_L - PAD_R)) * (n - 1)))));
  };
  if (!data.series.length) return <small className="employ-empty" data-testid="employ-graph-empty">No pick-ups in the last 24 hours yet. The graph fills in as your workers bring items in.</small>;
  return (
    <div className="employ-graph" data-testid="employ-graph">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Items gathered per hour, last 24 hours" onPointerDown={onPoint} onPointerMove={(e) => { if (e.buttons || e.pointerType === 'mouse') onPoint(e); }} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setPick(null); }}>
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={PAD_L} x2={W - PAD_R} y1={y(max * f)} y2={y(max * f)} className="employ-graph-grid" /><text x={PAD_L - 4} y={y(max * f) + 3} textAnchor="end">{Math.round(max * f)}</text></g>)}
        {[0, 6, 12, 18, n - 1].map((i) => <text key={i} x={x(i)} y={H - 4} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{i === n - 1 ? 'now' : `-${n - 1 - i}h`}</text>)}
        {shown.map((s) => <polyline key={s.key} data-testid={`employ-graph-line-${s.key}`} fill="none" stroke={resourceColor(s.key)} strokeWidth={2} strokeLinejoin="round" points={s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} />)}
        {pick != null && <line x1={x(pick)} x2={x(pick)} y1={PAD_T} y2={H - PAD_B} className="employ-graph-cursor" />}
      </svg>
      <small className="employ-graph-read" data-testid="employ-graph-read">{pick == null ? 'Items per hour (Alberta time). The last point is the current hour so far. Tap the graph for an hour.' : `${HOUR_FMT.format(data.hours[pick]!)}${pick === n - 1 ? ' (so far)' : ''}: ${shown.map((s) => `${resourceLabel(s.key)} ${s.values[pick]}`).join(' · ') || 'nothing shown'}`}</small>
      <div className="employ-legend">
        {data.series.map((s) => <button type="button" key={s.key} aria-pressed={!hidden.has(s.key)} className={hidden.has(s.key) ? 'off' : ''} onClick={() => toggle(s.key)} data-testid={`employ-legend-${s.key}`}><i style={{ background: resourceColor(s.key) }} />{resourceLabel(s.key)}</button>)}
      </div>
    </div>
  );
}

/** Production summary: expected items per hour now (paid workers) next to what actually came in over the last 24 h. */
export function ProductionPanel({ workers, log, hourly, now }: { workers: WorkerView[]; log: EmployLogItem[]; hourly: EmployHourItem[]; now: number }) {
  const rates = useMemo(() => productionRates(workers), [workers]);
  const got = useMemo(() => last24ByResource(log), [log]);
  const keys = [...rates.items.map((x) => x.key), ...[...got.keys()].filter((k) => !rates.items.some((x) => x.key === k))];
  return (
    <div className="employ-prod" data-testid="employ-production">
      <h4>Production</h4>
      <table>
        <thead><tr><th>Resource</th><th>Per hour now</th><th>Last 24 h</th></tr></thead>
        <tbody>{keys.map((k) => { const r = rates.items.find((x) => x.key === k)?.perHour ?? 0; return (
          <tr key={k} data-testid="employ-prod-row"><td><i className="employ-dot" style={{ background: resourceColor(k) }} /> {resourceLabel(k)}</td><td data-testid={`employ-rate-${k}`}>~{perHourText(r)}/h</td><td>{(got.get(k) ?? 0).toLocaleString('en-US')}</td></tr>); })}</tbody>
        <tfoot><tr><td>Total</td><td data-testid="employ-rate-total">~{perHourText(rates.perHour)}/h</td><td>{[...got.values()].reduce((a, n) => a + n, 0).toLocaleString('en-US')}</td></tr></tfoot>
      </table>
      <small>Per hour now is the expected rate of your paid workers (same math as Expected per day). Last 24 h is what they actually brought in.</small>
      <ProductionGraph hourly={hourly} now={now} />
    </div>
  );
}
