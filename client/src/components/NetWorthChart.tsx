/** #31 (chessguy2): net worth over time on player profiles. Gold line = net worth snapshots, faint line = chips (ledger). */
export interface NetWorthHistory { points: Array<{ t: number; net: number }>; chips: Array<{ t: number; chips: number }> }
const short = (v: number) => { const a = Math.abs(v); return a >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : a >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(Math.round(v)); };
export function NetWorthChart({ h, now, current }: { h: NetWorthHistory; now: number; current: number }) {
  const net = [...h.points.map((p) => ({ t: p.t, v: p.net }))]; if (!net.length || net[net.length - 1].t < now - 60_000) net.push({ t: now, v: current });
  const chips = h.chips.map((p) => ({ t: p.t, v: p.chips }));
  const all = [...net, ...chips]; const W = 320, H = 110, P = 4;
  if (all.length < 2) return <p className="text-xs opacity-60" data-testid="networth-chart-empty">History starts building from today, so check back later.</p>;
  const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(now, ...all.map((p) => p.t)); const v0 = Math.min(0, ...all.map((p) => p.v)), v1 = Math.max(1, ...all.map((p) => p.v));
  const X = (t: number) => P + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * P), Y = (v: number) => H - P - ((v - v0) / Math.max(1, v1 - v0)) * (H - 2 * P);
  const path = (s: Array<{ t: number; v: number }>) => s.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const first = net[0].v, chg = current - first;
  return <div data-testid="networth-chart">
    <div className="flex items-baseline justify-between text-xs"><span className="opacity-70">since {new Date(t0).toLocaleDateString()}</span><span className={chg >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{chg >= 0 ? '▲ +' : '▼ '}{short(chg)}</span></div>
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label="Net worth chart">
      <defs><linearGradient id="nwg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#e8c26a" stopOpacity="0.35" /><stop offset="1" stopColor="#e8c26a" stopOpacity="0" /></linearGradient></defs>
      {net.length > 1 && <path d={`${path(net)} L${X(net[net.length - 1].t)},${H - P} L${X(net[0].t)},${H - P} Z`} fill="url(#nwg)" />}
      {chips.length > 1 && <path d={path(chips)} fill="none" stroke="#9fb4ff" strokeOpacity="0.6" strokeWidth="1.2" strokeDasharray="3 2" />}
      {net.length > 1 ? <path d={path(net)} fill="none" stroke="#e8c26a" strokeWidth="2" /> : <circle cx={X(net[0].t)} cy={Y(net[0].v)} r="3" fill="#e8c26a" />}
      <text x={W - P} y={12} textAnchor="end" fontSize="10" fill="#ffffff99">{short(v1)}</text>
    </svg>
    <div className="text-[10px] opacity-60"><span className="text-[#e8c26a]">━ net worth</span> · <span className="text-[#9fb4ff]">┅ chips (30d)</span></div>
  </div>;
}
