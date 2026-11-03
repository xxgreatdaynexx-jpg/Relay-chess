/** MU #9: investing-app style chart (area + crosshair), period toggles and key-stat cards. Display only. */
import { useId, useMemo, useRef, useState } from 'react';
import { PERIODS, seriesChange, type Period, type KeyStats } from '../../../../shared/stockStats';

const fmtTime = (t: number, p: Period) => { const d = new Date(t); const hm = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); return p === '1d' ? hm : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${hm}`; };
const LABEL: Record<Period, string> = { '1d': 'Today', '1w': 'Past week', '1m': 'Past month', all: 'All time' };
export const compact = (x: number) => { const a = Math.abs(x); return a >= 1e9 ? `${(x / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(x / 1e6).toFixed(2)}M` : a >= 1e4 ? `${(x / 1e3).toFixed(1)}K` : Math.round(x).toLocaleString(); };

export function PeriodToggle({ value, onChange, testid = 'inv-period' }: { value: Period; onChange: (p: Period) => void; testid?: string }) {
  return <div className="ivx-periods" role="tablist" data-testid={testid}>{PERIODS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)} data-testid={`${testid}-${k}`}>{l}</button>)}</div>;
}

/** Big value + period change header and an area chart with a hover/touch crosshair. */
export function InvestChart({ pts, period, onPeriod, value, prefix = '🪙 ', decimals = 2, testid = 'inv-chart', empty = 'Not enough history yet: the chart fills in every 10 minutes.', height = 180 }: {
  pts: Array<[number, number]>; period: Period; onPeriod: (p: Period) => void; value?: number; prefix?: string; decimals?: number; testid?: string; empty?: string; height?: number;
}) {
  const gid = useId().replace(/:/g, ''); const ref = useRef<SVGSVGElement>(null); const [hover, setHover] = useState<number | null>(null);
  const W = 600, H = height;
  const geo = useMemo(() => {
    if (pts.length < 2) return null;
    const v = pts.map((p) => p[1]); const lo = Math.min(...v), hi = Math.max(...v); const pad = (hi - lo) * 0.12 || Math.max(1, hi * 0.01);
    const y0 = lo - pad, y1 = hi + pad; const t0 = pts[0]![0], t1 = pts[pts.length - 1]![0];
    const X = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W, Y = (p: number) => H - ((p - y0) / (y1 - y0)) * H;
    const line = pts.map(([t, p], i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(p).toFixed(1)}`).join('');
    return { X, Y, line, area: `${line}L${W},${H}L0,${H}Z`, base: Y(pts[0]![1]), lo, hi };
  }, [pts, H]);
  const ch = seriesChange(pts); const up = ch.abs >= 0; const col = up ? '#22c55e' : '#f43f5e';
  const hp = hover != null ? pts[hover] : null;
  const shown = hp ? hp[1] : value ?? pts[pts.length - 1]?.[1] ?? 0;
  const hc = hp && pts.length ? { abs: hp[1] - pts[0]![1], pct: pts[0]![1] ? ((hp[1] - pts[0]![1]) / pts[0]![1]) * 100 : 0 } : ch;
  const move = (clientX: number) => { const r = ref.current?.getBoundingClientRect(); if (!r || !geo) return; const x = ((clientX - r.left) / r.width) * W; let best = 0, bd = Infinity; pts.forEach(([t], i) => { const d = Math.abs(geo.X(t) - x); if (d < bd) { bd = d; best = i; } }); setHover(best); };
  return (
    <div className="ivx-chart-card" data-testid={testid}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="ivx-big tabular-nums" data-testid={`${testid}-value`}>{prefix}{shown.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</div>
          <div className={`text-xs font-semibold tabular-nums ${hc.abs >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} data-testid={`${testid}-change`}>
            {hc.abs >= 0 ? '▲' : '▼'} {hc.abs >= 0 ? '+' : '−'}{Math.abs(hc.abs).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ({hc.pct >= 0 ? '+' : ''}{hc.pct.toFixed(2)}%) <span className="font-normal opacity-60">{hp ? fmtTime(hp[0], period) : LABEL[period]}</span>
          </div>
        </div>
        <PeriodToggle value={period} onChange={(p) => { setHover(null); onPeriod(p); }} testid={`${testid}-period`} />
      </div>
      {!geo ? <p className="mt-2 rounded bg-black/20 p-6 text-center text-xs opacity-60">{empty}</p> : (
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full touch-none select-none" style={{ height: H }} preserveAspectRatio="none"
          onPointerMove={(e) => move(e.clientX)} onPointerDown={(e) => move(e.clientX)} onPointerLeave={() => setHover(null)} data-testid={`${testid}-svg`}>
          <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={col} stopOpacity="0.35" /><stop offset="100%" stopColor={col} stopOpacity="0" /></linearGradient></defs>
          <line x1="0" x2={W} y1={geo.base} y2={geo.base} stroke="#fff3" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
          <path d={geo.area} fill={`url(#${gid})`} />
          <path d={geo.line} fill="none" stroke={col} strokeWidth="2.25" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {hp && <><line x1={geo.X(hp[0])} x2={geo.X(hp[0])} y1="0" y2={H} stroke="#fff6" vectorEffect="non-scaling-stroke" /><circle cx={geo.X(hp[0])} cy={geo.Y(hp[1])} r="4" fill={col} stroke="#fff" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></>}
        </svg>)}
      {geo && <div className="mt-1 flex justify-between text-[10px] tabular-nums opacity-50"><span>{fmtTime(pts[0]![0], period)}</span><span>Low {geo.lo.toFixed(decimals)} · High {geo.hi.toFixed(decimals)}</span><span>Now</span></div>}
    </div>
  );
}

/** Range bar (low — marker — high), like the 52-week range on real apps. */
export function RangeBar({ lo, hi, at, label }: { lo: number; hi: number; at: number; label: string }) {
  const pct = hi > lo ? Math.min(100, Math.max(0, ((at - lo) / (hi - lo)) * 100)) : 50;
  return (
    <div className="ivx-stat col-span-2" data-testid={`inv-range-${label.replace(/\W+/g, '').toLowerCase()}`}>
      <div className="ivx-k">{label}</div>
      <div className="mt-1 flex items-center gap-2 tabular-nums text-xs"><span>{lo.toFixed(2)}</span><div className="relative h-1.5 flex-1 rounded-full bg-white/10"><div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-rose-500/60 to-emerald-500/60" style={{ width: '100%' }} /><div className="absolute -top-1 h-3.5 w-1 rounded bg-white shadow" style={{ left: `calc(${pct}% - 2px)` }} /></div><span>{hi.toFixed(2)}</span></div>
    </div>
  );
}

const S = ({ k, v, title, cls, testid }: { k: string; v: React.ReactNode; title?: string; cls?: string; testid?: string }) => <div className="ivx-stat" title={title} data-testid={testid}><div className="ivx-k">{k}</div><div className={`ivx-v ${cls ?? ''}`}>{v}</div></div>;

/** Key statistics grid for one company. Numbers come from the server (derived, deterministic). */
export function KeyStatsGrid({ s }: { s: KeyStats }) {
  return (
    <div className="ivx-stats" data-testid="ivx-keystats">
      <S k="Market cap" v={`🪙 ${compact(s.cap)}`} title="Price × shares outstanding" testid="ivx-stat-cap" />
      <S k="P/E ratio" v={s.pe == null ? '—' : s.pe.toFixed(1)} title={s.pe == null ? 'Negative earnings: no P/E' : 'Price ÷ earnings per share'} testid="ivx-stat-pe" />
      <S k="EPS" v={`${s.eps < 0 ? '−' : ''}🪙 ${Math.abs(s.eps).toFixed(2)}`} cls={s.eps < 0 ? 'text-rose-400' : ''} title="Earnings per share (fixed per company)" testid="ivx-stat-eps" />
      <S k="Div yield" v={s.divYieldDay ? `${(s.divYieldDay * 100).toFixed(2)}%/day` : '—'} title={s.divYieldDay ? `≈ 🪙 ${s.divPerShare.toFixed(2)} per share, paid daily` : 'Growth company: no dividend'} testid="ivx-stat-div" />
      <S k="Open" v={s.open == null ? '—' : s.open.toFixed(2)} title="Price 24 hours ago" />
      <S k="Day low / high" v={`${s.dayLo.toFixed(2)} – ${s.dayHi.toFixed(2)}`} />
      <S k="Volume 24h" v={compact(s.volume)} title={`${s.turnoverPct.toFixed(2)}% of shares traded`} testid="ivx-stat-vol" />
      <S k="Avg volume" v={s.avgVolume == null ? '—' : compact(s.avgVolume)} title="Average daily shares traded, last 7 days" />
      <S k="Beta" v={s.beta.toFixed(2)} title="How much it moves with the whole market (1 = in line)" testid="ivx-stat-beta" />
      <S k="Volatility" v={`${(s.vol * 100).toFixed(1)}%/day`} title="Typical daily swing" />
      <S k="Realized vol" v={s.realizedVol == null ? '—' : `${(s.realizedVol * 100).toFixed(1)}%/day`} title="Measured from the last 24 hours of prices" />
      <S k="Shares out" v={compact(s.shares)} />
      <RangeBar lo={s.dayLo} hi={s.dayHi} at={s.price} label="Day range" />
      <RangeBar lo={s.lo30} hi={s.hi30} at={s.price} label="30-day range" />
    </div>
  );
}
