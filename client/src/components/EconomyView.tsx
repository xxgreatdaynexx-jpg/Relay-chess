import { useEffect, useState } from 'react';

interface Cat { key: string; label: string; value: number; units: number; estValue: number }
interface Flow { game: string; amount: number }
interface Econ {
  ok: boolean; error?: string; at: number; cash: number; assets: number; total: number; estPct: number; categories: Cat[];
  change: { cash: number | null; assets: number | null; total: number | null };
  inflation: { cash7: number | null; cash30: number | null; total7: number | null; total30: number | null };
  flows: { faucets: Flow[]; sinks: Flow[]; transfers?: Flow[] }; net: number;
  history: Array<{ day: string; cash: number; assets: number | null; total: number | null; source: string }>; method: string;
}

const n = (v: number) => v.toLocaleString();
const pc = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
const tone = (v: number | null | undefined) => (v == null ? 'opacity-60' : v > 0 ? 'text-amber-300' : v < 0 ? 'text-sky-300' : '');
const LABEL: Record<string, string> = { mines: '⛏ Mines & factory', market: '🏪 Market', 'market fees': '🏪 Market fees', trade: '🤝 Trades & gifts', gift: '🎁 Gifts', tip: '🎁 Tips', transfer: '🤝 Transfers', p2p: '🤝 Transfers', arena: '🔫 Arena', refill: '♻ Refills', admin: '🛠 Admin grants', blackjack: '🂡 Blackjack', roulette: '🎡 Roulette', slots: '🎰 Slots', holdem: "♠ Hold'em", 'video-poker': '🃏 Video poker', chess: '♞ Chess', checkers: '⛀ Checkers', conquest: '⚔ Conquest', solitro: '🃏 Solitro', casino: '🎲 Casino' };

function Chart({ h, live }: { h: Econ['history']; live: Econ }) {
  const pts = [...h.map((d) => ({ day: d.day, cash: d.cash, total: d.total })), { day: 'now', cash: live.cash, total: live.total as number | null }];
  if (pts.length < 2) return <p className="mt-1 text-[11px] opacity-60">The chart fills in as days close (snapshots at midnight UTC).</p>;
  const W = 300, H = 90, vals = pts.flatMap((p) => [p.cash, p.total ?? p.cash]); const lo = Math.min(...vals) * 0.98, hi = Math.max(...vals) * 1.02 || 1;
  const x = (i: number) => (i / (pts.length - 1)) * W, y = (v: number) => H - ((v - lo) / (hi - lo || 1)) * H;
  const line = (k: 'cash' | 'total') => pts.map((p, i) => (p[k] == null ? null : `${x(i).toFixed(1)},${y(p[k]!).toFixed(1)}`)).filter(Boolean).join(' ');
  return (
    <div className="mt-1" data-testid="econ-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[90px] w-full" preserveAspectRatio="none">
        <polyline points={line('total')} fill="none" stroke="#e8c26a" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <polyline points={line('cash')} fill="none" stroke="#5fd0ff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] opacity-60"><span>{pts[0]!.day}</span><span><b className="text-sky-300">—</b> cash <b className="text-amber-300">—</b> net worth</span><span>now</span></div>
      <p className="text-[10px] opacity-50">Past cash rebuilt from the ledger; asset worth is tracked from {h.find((d) => d.assets != null)?.day ?? 'today'} on.</p>
    </div>
  );
}

/** Global economy: liquid cash, asset worth, daily inflation and today's faucets/sinks. */
export function EconomyView() {
  const [e, setE] = useState<Econ | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    fetch('/api/economy').then((r) => r.json()).then((j: Econ) => { if (!live) return; if (j.ok) setE(j); else setErr(j.error ?? 'Unavailable.'); }).catch(() => live && setErr('Could not load economy stats.'));
    return () => { live = false; };
  }, []);
  if (err) return <p className="mt-2 text-sm opacity-70">{err}</p>;
  if (!e) return <p className="mt-2 text-sm opacity-60">Crunching the numbers…</p>;
  const Stat = ({ label, v, c, id, tip }: { label: string; v: number; c: number | null; id: string; tip?: string }) => (
    <div className="rounded-lg bg-white/5 p-2" title={tip}>
      <div className="text-[10px] uppercase tracking-wide opacity-60">{label}</div>
      <div className="text-base font-bold tabular-nums" data-testid={id}>🪙 {n(v)}</div>
      <div className={`text-[11px] tabular-nums ${tone(c)}`}>{pc(c)} today</div>
    </div>
  );
  return (
    <div data-testid="econ-view">
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Stat label="Liquid cash" v={e.cash} c={e.change.cash} id="econ-cash" tip="All players' chip balances (QA accounts excluded)." />
        <Stat label="Asset worth" v={e.assets} c={e.change.assets} id="econ-assets" tip={e.method} />
      </div>
      <div className="mt-2 rounded-lg bg-white/5 p-2">
        <div className="flex items-baseline justify-between"><span className="text-[10px] uppercase tracking-wide opacity-60">Total net worth</span><span className={`text-[11px] ${tone(e.change.total)}`}>{pc(e.change.total)} today</span></div>
        <div className="text-lg font-bold tabular-nums" data-testid="econ-total">🪙 {n(e.total)}</div>
        <div className="text-[11px] opacity-60" title={e.method}>{e.estPct}% of asset worth is est. ⓘ</div>
      </div>
      <div className="mt-3 text-xs uppercase tracking-wide opacity-70">Daily inflation</div>
      <table className="mt-1 w-full text-[12px] tabular-nums" data-testid="econ-inflation">
        <thead><tr className="opacity-60"><th className="text-left font-normal" /><th className="font-normal">Today</th><th className="font-normal">7-day avg</th><th className="font-normal">30-day avg</th></tr></thead>
        <tbody>
          <tr><td>Cash</td><td className={`text-center ${tone(e.change.cash)}`}>{pc(e.change.cash)}</td><td className={`text-center ${tone(e.inflation.cash7)}`}>{pc(e.inflation.cash7)}</td><td className={`text-center ${tone(e.inflation.cash30)}`}>{pc(e.inflation.cash30)}</td></tr>
          <tr><td>Net worth</td><td className={`text-center ${tone(e.change.total)}`}>{pc(e.change.total)}</td><td className={`text-center ${tone(e.inflation.total7)}`}>{pc(e.inflation.total7)}</td><td className={`text-center ${tone(e.inflation.total30)}`}>{pc(e.inflation.total30)}</td></tr>
        </tbody>
      </table>
      <Chart h={e.history} live={e} />
      <div className="mt-3 text-xs uppercase tracking-wide opacity-70">Assets</div>
      <ul className="mt-1" data-testid="econ-cats">
        {e.categories.map((c) => (
          <li key={c.key}><span>{c.label} <span className="opacity-50">×{n(c.units)}</span></span>
            <span className="tabular-nums">{n(c.value)}{c.estValue > 0 ? <span className="ml-1 opacity-60" title={`${n(c.estValue)} of this is estimated. ${e.method}`}>est.</span> : null}</span></li>
        ))}
      </ul>
      <div className="mt-3 flex items-baseline justify-between text-xs uppercase tracking-wide opacity-70"><span>Today’s flows (UTC)</span><span className={e.net >= 0 ? 'text-amber-300' : 'text-sky-300'}>{e.net >= 0 ? '+' : ''}{n(e.net)} net</span></div>
      <div className="mt-1 grid grid-cols-2 gap-2 text-[12px]" data-testid="econ-flows">
        <div><div className="opacity-60">Created</div>{e.flows.faucets.length ? e.flows.faucets.slice(0, 8).map((f) => <div key={f.game} className="flex justify-between gap-1"><span className="truncate">{LABEL[f.game] ?? f.game}</span><b className="text-emerald-300 tabular-nums">+{n(f.amount)}</b></div>) : <div className="opacity-50">None yet</div>}</div>
        <div><div className="opacity-60">Destroyed</div>{e.flows.sinks.length ? e.flows.sinks.slice(0, 8).map((f) => <div key={f.game} className="flex justify-between gap-1"><span className="truncate">{LABEL[f.game] ?? f.game}</span><b className="text-rose-300 tabular-nums">−{n(f.amount)}</b></div>) : <div className="opacity-50">None yet</div>}</div>
      </div>
      {(() => { const t = e.flows.transfers ?? []; const vol = t.reduce((x, f) => x + f.amount, 0); return (
        <div className="mt-2 text-[12px]" data-testid="econ-transfers" title="Chips moving between players (trades, gifts, market sales). Not created or destroyed, so not counted in net.">
          <div className="flex justify-between gap-1"><span className="opacity-60">Transfers between players</span><b className="tabular-nums opacity-90">{n(vol)}</b></div>
          {t.slice(0, 4).map((f) => <div key={f.game} className="flex justify-between gap-1 pl-2 opacity-70"><span className="truncate">{LABEL[f.game] ?? f.game}</span><span className="tabular-nums">{n(f.amount)}</span></div>)}
          <div className="text-[10px] opacity-50">Volume only · not a source or sink</div>
        </div>); })()}
      <p className="mt-2 text-[10px] opacity-50">Updated {new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · refreshes every 5 min · QA accounts excluded.</p>
    </div>
  );
}
