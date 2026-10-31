/** Market history: per-item price chart (avg + median line, volume bars), recent sales, and the player's own history. Plain SVG. */
import { useEffect, useState } from 'react';
import { request } from '@/lib/net';

type Ack = { ok: boolean; error?: string } & Record<string, unknown>;
interface Point { t: number; avg: number | null; median: number | null; vol: number }
interface Chart { points: Point[]; range: string; volume: number }
interface Recent { what: string; name: string; qty: number; unit: number; total: number; at: number }
interface Mine extends Recent { side: 'buy' | 'sell'; fee: number; net: number }
const fmt = (n: number) => n.toLocaleString();
const when = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function PriceChart({ what }: { what: string }) {
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('7d'); const [c, setC] = useState<Chart | null>(null);
  useEffect(() => { if (!what) return; void request('mkt_chart', { what, range }).then((r) => { const a = r as Ack; if (a.ok) setC(a as unknown as Chart); }); }, [what, range]);
  const W = 260, H = 110, VH = 26, pts = c?.points ?? [];
  const ps = pts.flatMap((p) => [p.avg, p.median].filter((x): x is number => x != null));
  const lo = ps.length ? Math.min(...ps) : 0, hi = ps.length ? Math.max(...ps) : 1, vmax = Math.max(1, ...pts.map((p) => p.vol));
  const x = (i: number) => (pts.length > 1 ? (i / (pts.length - 1)) * (W - 8) + 4 : W / 2);
  const y = (v: number) => H - VH - 6 - ((v - lo) / (hi - lo || 1)) * (H - VH - 16);
  const line = (k: 'avg' | 'median') => pts.map((p, i) => (p[k] == null ? null : `${x(i).toFixed(1)},${y(p[k]!).toFixed(1)}`)).filter(Boolean).join(' ');
  const bw = Math.max(2, (W - 8) / Math.max(1, pts.length) - 2);
  return (
    <div className="mkt-chart" data-testid="mkt-chart">
      <div className="mkt-chart-head">
        {(['24h', '7d', '30d'] as const).map((r) => <button type="button" key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)} data-testid={`mkt-range-${r}`}>{r}</button>)}
        <span className="mkt-legend"><i style={{ background: '#7cf' }} />avg <i style={{ background: '#ffcf3a' }} />median · vol {fmt(c?.volume ?? 0)}</span>
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {pts.map((p, i) => p.vol > 0 && <rect key={i} x={x(i) - bw / 2} y={H - (p.vol / vmax) * VH} width={bw} height={(p.vol / vmax) * VH} fill="rgba(160,170,190,.45)"><title>{`${when(p.t)}: ${p.vol} sold`}</title></rect>)}
        {ps.length > 0 && <><text x={W - 2} y={10} textAnchor="end" fontSize="9" fill="#aaa">{fmt(hi)}</text><text x={W - 2} y={H - VH - 4} textAnchor="end" fontSize="9" fill="#aaa">{fmt(lo)}</text></>}
        <polyline points={line('avg')} fill="none" stroke="#7cf" strokeWidth="2" />
        <polyline points={line('median')} fill="none" stroke="#ffcf3a" strokeWidth="1.5" strokeDasharray="4 3" />
        {pts.map((p, i) => p.avg != null && <circle key={'c' + i} cx={x(i)} cy={y(p.avg)} r="2.2" fill="#7cf"><title>{`${when(p.t)} · avg ${p.avg} · median ${p.median}`}</title></circle>)}
        {!ps.length && <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="11" fill="#888">No sales in this range</text>}
      </svg>
    </div>
  );
}

export function RecentSales({ what }: { what?: string }) {
  const [rows, setRows] = useState<Recent[]>([]);
  useEffect(() => { void request('mkt_recent', { what: what ?? '' }).then((r) => { const a = r as Ack; if (a.ok) setRows(a.sales as Recent[]); }); }, [what]);
  return (
    <div className="mkt-recent" data-testid="mkt-recent">
      <p className="mkt-sub">Recent sales</p>
      {rows.length ? <table className="mkt-table"><tbody>{rows.slice(0, 10).map((r, i) => <tr key={i}><td>{r.qty > 1 ? `${r.qty}× ` : ''}{r.name}</td><td>{fmt(r.unit)}{r.qty > 1 ? ' ea' : ''}</td><td>{when(r.at)}</td></tr>)}</tbody></table> : <p className="inv-note">No sales yet.</p>}
    </div>
  );
}

export function MyHistoryView() {
  const [d, setD] = useState<{ rows: Mine[]; totals: { bought: number; sold: number; fees: number } } | null>(null); const [err, setErr] = useState('');
  useEffect(() => { void request('mkt_my_history', {}).then((r) => { const a = r as Ack; if (a.ok) setD(a as unknown as NonNullable<typeof d>); else setErr(a.error ?? 'Sign in to see your history.'); }); }, []);
  if (err) return <p className="inv-note">{err}</p>;
  if (!d) return <p className="inv-note">Loading…</p>;
  return (
    <div className="mkt-mats" data-testid="mkt-myhist">
      <p className="mkt-stats">Bought {fmt(d.totals.bought)} · Sold {fmt(d.totals.sold)} · Fees paid {fmt(d.totals.fees)} · Net {fmt(d.totals.sold - d.totals.fees - d.totals.bought)}</p>
      <table className="mkt-table"><thead><tr><th>When</th><th>Side</th><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th><th>Fee</th><th>Net</th></tr></thead><tbody>
        {d.rows.map((r, i) => <tr key={i}><td>{when(r.at)}</td><td className={r.side === 'buy' ? 'mkt-buy' : 'mkt-sell-side'}>{r.side === 'buy' ? 'Bought' : 'Sold'}</td><td>{r.name}</td><td>{r.qty}</td><td>{fmt(r.unit)}</td><td>{fmt(r.total)}</td><td>{r.fee ? fmt(r.fee) : '—'}</td><td>{r.net > 0 ? '+' : ''}{fmt(r.net)}</td></tr>)}
        {!d.rows.length && <tr><td colSpan={8} className="inv-note">No market activity yet.</td></tr>}
      </tbody></table>
    </div>
  );
}
