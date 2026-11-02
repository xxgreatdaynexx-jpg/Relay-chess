import { backdropDismiss } from '@/lib/backdrop';
import { createPortal } from 'react-dom';
import { INFLATION_LABELS as L, type InflationView } from '../../../shared/inflation';

export interface Mover { ticker: string; name: string; price: number; chg: number }
export interface DailyReportData {
  day: string;
  bonus: number | null;
  history?: Array<{ day: string; cash: number; assets: number; total: number }>;
  economy: { cash: number; assets: number; total: number; inflation: InflationView; priceIndex?: number; priceIndexPct?: number | null; movers: { up: Mover[]; down: Mover[] } | null } | null;
  me: { cash: number; assets: number; total: number; categories: Array<{ key: string; label: string; value: number; units: number }>; since: { day: string; total: number; totalPct: number | null; cash: number; assets: number } | null };
}

const n = (v: number) => Math.round(v).toLocaleString();
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${n(Math.abs(v))}`;
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);
const tone = (v: number | null | undefined) => (v == null || v === 0 ? '' : v > 0 ? 'text-emerald-300' : 'text-rose-300');

function Row({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return <div className="flex justify-between gap-3 py-0.5 text-sm"><span className="opacity-75">{label}</span><span className={`tabular-nums font-semibold ${cls}`}>{value}</span></div>;
}

/** Dismissable Daily Report: first sign-in of the day (with the bonus) or reopened from the Bank. */
export function DailyReport({ report, onClose }: { report: DailyReportData; onClose: () => void }) {
  const e = report.economy, me = report.me;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" {...backdropDismiss(onClose)} data-testid="daily-report">
      <div role="dialog" aria-label="Daily report" className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/15 bg-[#1b1d2e] p-5 text-cream shadow-2xl" >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">📊 Daily Report <span className="text-xs font-normal opacity-60">{report.day}</span></h2>
          <button type="button" aria-label="Close" className="rounded-full px-2 text-lg opacity-70 hover:opacity-100" onClick={onClose} data-testid="daily-report-close">×</button>
        </div>
        {report.bonus ? <div className="mt-3 rounded-xl bg-[#e8c26a]/15 px-3 py-2 text-center font-bold text-[#e8c26a]" data-testid="daily-report-bonus">🎁 +{n(report.bonus)} daily bonus received</div> : null}
        <h3 className="mt-4 text-xs uppercase tracking-wide opacity-70">Your assets</h3>
        <Row label="Wallet chips" value={`🪙 ${n(me.cash)}`} />
        {me.categories.filter((c) => c.value > 0).map((c) => <Row key={c.key} label={`${c.label} (${n(c.units)})`} value={n(c.value)} />)}
        <Row label="Assets total" value={n(me.assets)} />
        <Row label="Net worth" value={`🪙 ${n(me.total)}`} cls="text-[#e8c26a]" />
        {me.since ? <Row label={`Since last report (${me.since.day})`} value={`${signed(me.since.total)} (${pct(me.since.totalPct)})`} cls={tone(me.since.total)} />
          : <p className="text-xs opacity-60">First report: tomorrow you'll see how your net worth changed.</p>}
        {e && <>
          <h3 className="mt-4 text-xs uppercase tracking-wide opacity-70">Economy</h3>
          <Row label="Liquid cash (all players)" value={n(e.cash)} />
          <Row label="Asset worth" value={n(e.assets)} />
          <Row label="Total net worth" value={n(e.total)} />
          <div title={L.tip} data-testid="daily-report-inflation">
            <Row label={L.cashToday} value={pct(e.inflation.cashToday)} cls={tone(e.inflation.cashToday)} />
            <Row label={L.totalToday} value={pct(e.inflation.totalToday)} cls={tone(e.inflation.totalToday)} />
            <Row label={`Cash ${L.avg7}`} value={pct(e.inflation.cash7)} />
            <Row label={L.smoothed} value={e.inflation.smoothed == null ? L.smoothedEmpty : pct(e.inflation.smoothed)} />
            <p className="text-[10px] opacity-50">As of {new Date(e.inflation.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · same numbers as Bank › Economy</p>
          </div>
          {e.priceIndex != null && <Row label="Prices & payouts index" value={`x${e.priceIndex.toFixed(2)}${e.priceIndexPct != null ? ` (${pct(e.priceIndexPct)} today)` : ''}`} />}
          {e.movers && <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
            {(['up', 'down'] as const).map((k) => <div key={k}>
              <div className="mb-1 opacity-70">{k === 'up' ? '📈 Top gainers' : '📉 Top losers'}</div>
              {e.movers![k].map((m) => <div key={m.ticker} className="flex justify-between" title={m.name}><span className="font-semibold">{m.ticker}</span><span className={tone(m.chg)}>{pct(m.chg)}</span></div>)}
            </div>)}
          </div>}
        </>}
        {report.history && report.history.length > 0 && <>
          <h3 className="mt-4 text-xs uppercase tracking-wide opacity-70">Past 7 days</h3>
          <div data-testid="daily-report-history" className="text-xs">
            <div className="grid grid-cols-4 gap-2 py-0.5 opacity-60"><span>Day</span><span className="text-right">Cash</span><span className="text-right">Net worth</span><span className="text-right">Change</span></div>
            {report.history.map((h, i) => { const prev = report.history![i + 1]; const d = prev ? h.total - prev.total : null; return (
              <div key={h.day} className="grid grid-cols-4 gap-2 py-0.5 tabular-nums"><span>{h.day.slice(5)}</span><span className="text-right">{n(h.cash)}</span><span className="text-right font-semibold">{n(h.total)}</span><span className={`text-right ${tone(d)}`}>{d == null ? '—' : signed(d)}</span></div>); })}
          </div>
        </>}
        <button type="button" className="mt-5 w-full rounded-full bg-[#e8c26a] py-2 text-sm font-bold text-[#1b1d2e]" onClick={onClose}>Got it</button>
      </div>
    </div>, document.body);
}
