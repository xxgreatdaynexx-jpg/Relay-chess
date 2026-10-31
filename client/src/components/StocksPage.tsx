/** Stock Exchange: its own top-nav tab (/stocks, #stocks). Market list, company page with charts + buy/sell, portfolio, news. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { TopTab } from '@/components/TopTabs';
import { request, socket } from '@/lib/net';
import { useAccount } from '@/lib/auth';
import { MAX_TICK_IMPACT, MAX_TRADE_IMPACT, STOCK_FEE, STOCK_SPREAD, quote, COMPANY_BY_TICKER, type NewsItem, type SectorInfo } from '../../../shared/stocks';

interface Row { ticker: string; name: string; sector: string; price: number; chg: number; volume: number; shares: number; held: number; cap: number; playerPct: number }
interface ListResp { companies: Row[]; sectors: SectorInfo[]; news: NewsItem[]; totals: { cap: number; playerOwned: number; offshore: number }; drift: { inflPct: number | null; activity: Record<string, number> } }
const EV = 'chud:open-stocks';
export const openStocks = (ticker?: string) => window.dispatchEvent(new CustomEvent(EV, { detail: { ticker } }));
const atStocks = () => window.location.pathname === '/stocks' || window.location.hash.startsWith('#stocks');
const n = (x: number) => Math.round(x).toLocaleString();
const pc = (x: number) => `${x > 0 ? '+' : ''}${x.toFixed(2)}%`;
const tone = (x: number) => (x > 0 ? 'text-emerald-400' : x < 0 ? 'text-rose-400' : 'opacity-70');
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

export function StocksPage() {
  const [open, setOpen] = useState(atStocks);
  const [view, setView] = useState<'market' | 'portfolio' | 'news'>('market');
  const [ticker, setTicker] = useState<string | null>(null);
  const [data, setData] = useState<ListResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => request('stk_list').then((r) => { if (r.ok) { setData(r as unknown as ListResp); setErr(null); } else setErr(r.error ?? 'Could not load the exchange.'); }), []);
  useEffect(() => {
    const on = (e: Event) => { setOpen(true); const t = (e as CustomEvent<{ ticker?: string }>).detail?.ticker; if (t) setTicker(t); };
    const pop = () => { if (atStocks()) setOpen(true); };
    window.addEventListener(EV, on); window.addEventListener('popstate', pop); window.addEventListener('hashchange', pop);
    return () => { window.removeEventListener(EV, on); window.removeEventListener('popstate', pop); window.removeEventListener('hashchange', pop); };
  }, []);
  useEffect(() => {
    if (!open) return; void load();
    const tick = (m: { prices: Array<[string, number]> }) => setData((d) => d && { ...d, companies: d.companies.map((c) => { const p = m.prices.find((x) => x[0] === c.ticker)?.[1]; return p ? { ...c, price: p, chg: c.price ? c.chg + ((p - c.price) / c.price) * 100 : c.chg, cap: Math.round(p * c.shares) } : c; }) });
    socket.on('stk_tick', tick); const iv = setInterval(() => void load(), 120_000);
    return () => { socket.off('stk_tick', tick); clearInterval(iv); };
  }, [open, load]);
  const close = () => { setOpen(false); if (atStocks()) history.replaceState(history.state, '', '/'); };
  return (
    <div data-testid="stocks-page">
      <TopTab id="stocks"><button type="button" className="sol-tab" aria-expanded={open} id="stocks-tab" onClick={() => (open ? close() : setOpen(true))} data-testid="stocks-tab">{open ? '▴ Stocks' : '📈 Stocks'}</button></TopTab>
      {open && (
        <div className="inv-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="inv-win mkt-win" role="dialog" aria-label="Stock Exchange">
            <header className="inv-head">
              <h2>📈 Stock Exchange</h2>
              <nav className="inv-tabs" role="tablist">
                {([['market', '📊 Market'], ['portfolio', '💼 Portfolio'], ['news', '📰 News']] as const).map(([k, t]) => <button key={k} type="button" role="tab" aria-selected={view === k && !ticker} className={view === k && !ticker ? 'on' : ''} onClick={() => { setView(k); setTicker(null); }} data-testid={`stk-tab-${k}`}>{t}</button>)}
              </nav>
              <button type="button" className="ml-auto" aria-label="Close stock exchange" onClick={close}>✕</button>
            </header>
            <div className="flex-1 overflow-auto p-3 text-sm">
              {err && <p className="text-rose-400">{err}</p>}
              {!data ? <p className="opacity-60">Loading the exchange…</p>
                : ticker ? <CompanyView ticker={ticker} onBack={() => setTicker(null)} onTraded={load} />
                : view === 'market' ? <MarketList data={data} onPick={setTicker} />
                : view === 'portfolio' ? <Portfolio onPick={setTicker} />
                : <NewsFeed news={data.news} onPick={setTicker} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MarketList({ data, onPick }: { data: ListResp; onPick: (t: string) => void }) {
  const [q, setQ] = useState(''); const [sector, setSector] = useState(''); const [sort, setSort] = useState<'price' | 'chg' | 'volume' | 'name'>('chg'); const [desc, setDesc] = useState(true);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const r = data.companies.filter((c) => (!sector || c.sector === sector) && (!s || c.ticker.toLowerCase().includes(s) || c.name.toLowerCase().includes(s)));
    return r.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : (a[sort] - b[sort])) * (desc ? -1 : 1));
  }, [data, q, sector, sort, desc]);
  const sec = new Map(data.sectors.map((s) => [s.id, s]));
  const th = (k: typeof sort, label: string) => <th className="cursor-pointer select-none px-1 text-right" onClick={() => { if (sort === k) setDesc(!desc); else { setSort(k); setDesc(true); } }} data-testid={`stk-sort-${k}`}>{label}{sort === k ? (desc ? ' ▾' : ' ▴') : ''}</th>;
  return (
    <div data-testid="stk-market">
      <div className="mb-2 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded bg-white/5 p-2"><div className="opacity-60">Market cap</div><b>🪙 {n(data.totals.cap)}</b></div>
        <div className="rounded bg-white/5 p-2" title="Shares players own — counted in the Bank's asset worth"><div className="opacity-60">Player-owned</div><b>🪙 {n(data.totals.playerOwned)}</b></div>
        <div className="rounded bg-white/5 p-2" title="Shares no player owns — offshore, not in anyone's net worth"><div className="opacity-60">🏝 Offshore</div><b>🪙 {n(data.totals.offshore)}</b></div>
      </div>
      <div className="mb-2 flex flex-wrap gap-2">
        <input className="flex-1 rounded bg-black/30 px-2 py-1" placeholder="Search company or ticker" value={q} onChange={(e) => setQ(e.target.value)} data-testid="stk-search" />
        <select className="rounded bg-black/30 px-2 py-1" value={sector} onChange={(e) => setSector(e.target.value)} data-testid="stk-sector">
          <option value="">All sectors</option>{data.sectors.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
        </select>
      </div>
      <table className="w-full text-[12px] tabular-nums">
        <thead className="opacity-70"><tr><th className="cursor-pointer px-1 text-left" onClick={() => { setSort('name'); setDesc(false); }}>Company</th><th className="px-1 text-left">Sector</th>{th('price', 'Price')}{th('chg', '24h')}{th('volume', 'Vol 24h')}<th className="px-1 text-right">Player-owned</th></tr></thead>
        <tbody>{rows.map((c) => (
          <tr key={c.ticker} className="cursor-pointer border-t border-white/5 hover:bg-white/5" onClick={() => onPick(c.ticker)} data-testid={`stk-row-${c.ticker}`}>
            <td className="px-1 py-1"><b>{c.ticker}</b> <span className="opacity-70">{c.name}</span></td>
            <td className="px-1">{sec.get(c.sector as never)?.icon} {sec.get(c.sector as never)?.label}</td>
            <td className="px-1 text-right">{c.price.toFixed(2)}</td>
            <td className={`px-1 text-right ${tone(c.chg)}`}>{pc(c.chg)}</td>
            <td className="px-1 text-right">{n(c.volume)}</td>
            <td className="px-1 text-right">{c.playerPct.toFixed(2)}%</td>
          </tr>))}</tbody>
      </table>
      <p className="mt-2 text-[11px] opacity-60">Prices move every 30s. Drift follows chip inflation ({data.drift.inflPct == null ? '—' : pc(data.drift.inflPct)}/day) and in-game activity by sector. Fee {STOCK_FEE * 100}% + {STOCK_SPREAD * 100}% spread per trade.</p>
    </div>
  );
}

function Chart({ pts }: { pts: Array<[number, number]> }) {
  if (pts.length < 2) return <p className="text-xs opacity-60">Not enough history yet: the chart fills in every 10 minutes.</p>;
  const W = 600, H = 160; const v = pts.map((p) => p[1]); const lo = Math.min(...v), hi = Math.max(...v); const span = hi - lo || 1;
  const t0 = pts[0]![0], t1 = pts[pts.length - 1]![0] || t0 + 1;
  const d = pts.map(([t, p]) => `${(((t - t0) / (t1 - t0 || 1)) * W).toFixed(1)},${(H - ((p - lo) / span) * (H - 10) - 5).toFixed(1)}`).join(' ');
  const up = v[v.length - 1]! >= v[0]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full rounded bg-black/20" preserveAspectRatio="none" data-testid="stk-chart">
      <polyline points={d} fill="none" stroke={up ? '#34d399' : '#fb7185'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <text x="4" y="12" fill="#fff8" fontSize="11">{hi.toFixed(2)}</text><text x="4" y={H - 4} fill="#fff8" fontSize="11">{lo.toFixed(2)}</text>
    </svg>
  );
}

interface CompanyResp { company: Row & { blurb: string; vol: number; beta: number; liquidity: number }; chart: Array<[number, number]>; news: NewsItem[]; upcoming: number; mine: { shares: number; cost: number } | null; maxOrder: number; drift: number }
function CompanyView({ ticker, onBack, onTraded }: { ticker: string; onBack: () => void; onTraded: () => void }) {
  const account = useAccount();
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('24h');
  const [d, setD] = useState<CompanyResp | null>(null);
  const [qty, setQty] = useState('1'); const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(() => request('stk_company', { ticker, range }).then((r) => { if (r.ok) setD(r as unknown as CompanyResp); }), [ticker, range]);
  useEffect(() => { void load(); const iv = setInterval(() => void load(), 30_000); return () => clearInterval(iv); }, [load]);
  if (!d) return <p className="opacity-60">Loading {ticker}…</p>;
  const c = d.company; const meta = COMPANY_BY_TICKER.get(ticker)!; const shares = Math.max(0, Math.floor(Number(qty) || 0));
  const qb = shares ? quote(meta, c.price, 'buy', shares) : null, qs = shares ? quote(meta, c.price, 'sell', shares) : null;
  const trade = async (side: 'buy' | 'sell') => {
    setBusy(true); setMsg(null);
    const r = await request(side === 'buy' ? 'stk_buy' : 'stk_sell', { ticker, shares });
    setBusy(false);
    const x = r as unknown as { fill: number; total: number; fee: number };
    if (r.ok) { setMsg({ ok: true, t: `${side === 'buy' ? 'Bought' : 'Sold'} ${shares} ${ticker} at ${x.fill.toFixed(2)} — ${side === 'buy' ? 'paid' : 'received'} 🪙 ${n(x.total)} (fee ${x.fee}).` }); void load(); onTraded(); }
    else setMsg({ ok: false, t: r.error ?? 'Trade failed.' });
  };
  const offPct = 100 - c.playerPct;
  return (
    <div data-testid="stk-company">
      <button type="button" className="mb-2 text-xs opacity-70 hover:opacity-100" onClick={onBack}>← All companies</button>
      <div className="flex flex-wrap items-baseline gap-3"><h3 className="text-lg font-bold">{c.name} <span className="opacity-60">{c.ticker}</span></h3><span className="text-xl font-bold tabular-nums">🪙 {c.price.toFixed(2)}</span><span className={tone(c.chg)}>{pc(c.chg)} 24h</span></div>
      <p className="mb-2 text-xs opacity-70">{c.blurb}</p>
      <div className="mb-1 flex gap-1">{(['24h', '7d', '30d'] as const).map((r) => <button key={r} type="button" className={`rounded px-2 py-0.5 text-xs ${range === r ? 'bg-white/20' : 'bg-white/5'}`} onClick={() => setRange(r)} data-testid={`stk-range-${r}`}>{r}</button>)}</div>
      <Chart pts={d.chart} />
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded bg-white/5 p-2"><div className="opacity-60">Market cap</div><b>🪙 {n(c.cap)}</b></div>
        <div className="rounded bg-white/5 p-2" title="Player-owned shares count as assets; the rest is offshore"><div className="opacity-60">Player-owned / 🏝 offshore</div><b>{c.playerPct.toFixed(2)}% / {offPct.toFixed(2)}%</b><div className="mt-1 h-1.5 rounded bg-white/10"><div className="h-1.5 rounded bg-emerald-400" style={{ width: `${Math.min(100, c.playerPct)}%` }} /></div></div>
        <div className="rounded bg-white/5 p-2"><div className="opacity-60">Volatility · beta</div><b>{(meta.vol * 100).toFixed(1)}%/day · {meta.beta}</b></div>
        <div className="rounded bg-white/5 p-2"><div className="opacity-60">Trend (inflation + activity)</div><b className={tone(d.drift)}>{pc(d.drift * 100)}/day</b></div>
      </div>
      <div className="mt-3 rounded bg-white/5 p-2">
        {d.mine && <p className="mb-1 text-xs" data-testid="stk-mine">You own <b>{d.mine.shares}</b> shares (player-owned asset) worth 🪙 {n(d.mine.shares * c.price)} · cost 🪙 {n(d.mine.cost)}</p>}
        {!account ? <p className="text-xs opacity-70">Sign in to trade. Guests can browse.</p> : (
          <div className="flex flex-wrap items-center gap-2">
            <input className="w-24 rounded bg-black/30 px-2 py-1" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} aria-label="Shares" data-testid="stk-qty" />
            <button type="button" disabled={busy || !shares} className="rounded bg-emerald-600 px-3 py-1 font-semibold disabled:opacity-40" onClick={() => void trade('buy')} data-testid="stk-buy">Buy {qb ? `· 🪙 ${n(qb.total)}` : ''}</button>
            <button type="button" disabled={busy || !shares || !d.mine} className="rounded bg-rose-600 px-3 py-1 font-semibold disabled:opacity-40" onClick={() => void trade('sell')} data-testid="stk-sell">Sell {qs ? `· 🪙 ${n(qs.total)}` : ''}</button>
          </div>)}
        <p className="mt-1 text-[11px] opacity-60">Max 🪙 {n(d.maxOrder)} per order (moves the price ≤ {MAX_TRADE_IMPACT * 100}%; ≤ {MAX_TICK_IMPACT * 100}% per 30s for everyone). Your order moves the price; the effect fades over a few hours. {STOCK_FEE * 100}% fee is burned.</p>
        {msg && <p className={`mt-1 text-xs ${msg.ok ? 'text-emerald-400' : 'text-rose-400'}`} data-testid="stk-msg">{msg.t}</p>}
      </div>
      <h4 className="mt-3 text-xs uppercase tracking-wide opacity-70">News {d.upcoming ? <span className="normal-case opacity-60">· {d.upcoming} more expected today</span> : null}</h4>
      <NewsFeed news={d.news} />
    </div>
  );
}

function NewsFeed({ news, onPick }: { news: NewsItem[]; onPick?: (t: string) => void }) {
  if (!news.length) return <p className="text-xs opacity-60">No news yet today.</p>;
  return (
    <ul className="mt-1 space-y-1" data-testid="stk-news">{news.map((x) => (
      <li key={x.id} className={`flex items-baseline gap-2 rounded bg-white/5 px-2 py-1 text-xs ${onPick ? 'cursor-pointer hover:bg-white/10' : ''}`} onClick={() => onPick?.(x.ticker)}>
        <span>{x.good ? '🟢' : '🔴'}</span><b>{x.ticker}</b><span className="flex-1">{x.headline}</span><span className={tone(x.move)}>{pc(x.move * 100)}</span><span className="opacity-50">{ago(x.at)}</span>
      </li>))}</ul>
  );
}

interface PortResp { holdings: Array<{ ticker: string; name: string; shares: number; cost: number; price: number; value: number; pnl: number; pnlPct: number }>; value: number; cost: number; pnl: number }
function Portfolio({ onPick }: { onPick: (t: string) => void }) {
  const account = useAccount(); const [p, setP] = useState<PortResp | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (account) void request('stk_portfolio').then((r) => (r.ok ? setP(r as unknown as PortResp) : setErr(r.error ?? 'Could not load.'))); }, [account]);
  if (!account) return <p className="opacity-70">Sign in to see your portfolio.</p>;
  if (err) return <p className="text-rose-400">{err}</p>;
  if (!p) return <p className="opacity-60">Loading…</p>;
  return (
    <div data-testid="stk-portfolio">
      <div className="mb-2 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded bg-white/5 p-2" title="Player-owned shares count toward your asset worth in the Bank"><div className="opacity-60">Player-owned stock (assets)</div><b>🪙 {n(p.value)}</b></div>
        <div className="rounded bg-white/5 p-2"><div className="opacity-60">Cost basis</div><b>🪙 {n(p.cost)}</b></div>
        <div className="rounded bg-white/5 p-2"><div className="opacity-60">P&amp;L</div><b className={tone(p.pnl)}>{p.pnl >= 0 ? '+' : ''}{n(p.pnl)}</b></div>
      </div>
      {!p.holdings.length ? <p className="opacity-60">You don't own any stock yet. Pick a company in Market to buy.</p> : (
        <table className="w-full text-[12px] tabular-nums"><thead className="opacity-70"><tr><th className="text-left">Company</th><th className="text-right">Shares</th><th className="text-right">Price</th><th className="text-right">Value</th><th className="text-right">P&amp;L</th></tr></thead>
          <tbody>{p.holdings.map((h) => <tr key={h.ticker} className="cursor-pointer border-t border-white/5 hover:bg-white/5" onClick={() => onPick(h.ticker)}><td><b>{h.ticker}</b> <span className="opacity-70">{h.name}</span></td><td className="text-right">{h.shares}</td><td className="text-right">{h.price.toFixed(2)}</td><td className="text-right">{n(h.value)}</td><td className={`text-right ${tone(h.pnl)}`}>{h.pnl >= 0 ? '+' : ''}{n(h.pnl)} ({pc(h.pnlPct)})</td></tr>)}</tbody></table>)}
    </div>
  );
}
