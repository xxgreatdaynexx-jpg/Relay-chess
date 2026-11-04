import { useDoing } from '@/lib/doing';
import { backdropDismiss } from '@/lib/backdrop';
/** Stock Exchange: its own top-nav tab (/stocks, #stocks). Market list, company page with charts + buy/sell, portfolio, news. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Term } from '@/components/stocks/Explain';
import { TopTab } from '@/components/TopTabs';
import { request, socket } from '@/lib/net';
import { useMoneyAction } from '@/lib/moneyAction';
import { useAccount } from '@/lib/auth';
import { DIV_HOUR_UTC, FUND_MAX_ORDER, OPT_EXPIRIES, OPT_STRIKES, SHORT_INIT, SHORT_MAINT, BORROW_FEE, FUND_BY_ID, fundQuote, strikeFor } from '../../../shared/derivs';
import { MAX_TICK_IMPACT, MAX_TRADE_IMPACT, STOCK_FEE, STOCK_SPREAD, quote, parseQty, COMPANY_BY_TICKER, type NewsItem, type SectorInfo } from '../../../shared/stocks';
import { usePanelDrag } from '@/lib/panelDrag';
import { InvestChart, KeyStatsGrid, compact } from '@/components/stocks/InvestChart';
import { defaultInterval, epsOf, INTERVALS, type Candle, type CandleInterval, type KeyStats, type Period } from '../../../shared/stockStats';
import { optionPremium } from '../../../shared/derivs';
import { CandleChart } from '@/components/stocks/CandleChart';
import { Info, LearnView } from '@/components/stocks/Explain';
import { PeriodToggle } from '@/components/stocks/InvestChart';

interface Row { ticker: string; name: string; sector: string; price: number; chg: number; volume: number; shares: number; held: number; cap: number; playerPct: number; divYield?: number }
interface ListResp { companies: Row[]; sectors: SectorInfo[]; news: NewsItem[]; totals: { cap: number; playerOwned: number; offshore: number }; drift: { inflPct: number | null; activity: Record<string, number> } }
const EV = 'chud:open-stocks';
export const openStocks = (ticker?: string) => window.dispatchEvent(new CustomEvent(EV, { detail: { ticker } }));
const atStocks = () => window.location.pathname === '/stocks' || window.location.hash.startsWith('#stocks');
const n = (x: number) => Math.round(x).toLocaleString();
const pc = (x: number) => `${x > 0 ? '+' : ''}${x.toFixed(2)}%`;
const tone = (x: number) => (x > 0 ? 'text-emerald-400' : x < 0 ? 'text-rose-400' : 'opacity-70');
/** MU #9 v2: watchlist lives in this browser only (no server state). */
const WKEY = 'chud:stk-watch';
const readWatch = (): string[] => { try { const v = JSON.parse(localStorage.getItem(WKEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } };
function useWatch() {
  const [w, setW] = useState<string[]>(readWatch);
  useEffect(() => { const f = () => setW(readWatch()); window.addEventListener('chud:stk-watch', f); window.addEventListener('storage', f); return () => { window.removeEventListener('chud:stk-watch', f); window.removeEventListener('storage', f); }; }, []);
  const toggle = (t: string) => { const next = readWatch().includes(t) ? readWatch().filter((x) => x !== t) : [...readWatch(), t]; try { localStorage.setItem(WKEY, JSON.stringify(next)); } catch { /* private mode */ } window.dispatchEvent(new Event('chud:stk-watch')); };
  return { list: w, has: (t: string) => w.includes(t), toggle };
}
const Star = ({ t }: { t: string }) => { const w = useWatch(); const on = w.has(t); return <button type="button" className="stk-star" aria-pressed={on} aria-label={on ? `Remove ${t} from watchlist` : `Add ${t} to watchlist`} title={on ? 'On your watchlist' : 'Add to watchlist'} onClick={(e) => { e.stopPropagation(); w.toggle(t); }} data-testid={`stk-star-${t}`}>{on ? '★' : '☆'}</button>; };
const peOf = (c: { ticker: string; price: number }) => { const m = COMPANY_BY_TICKER.get(c.ticker); const e = m ? epsOf(m) : 0; return e > 0 ? c.price / e : null; };
type View = 'overview' | 'market' | 'movers' | 'watch' | 'screener' | 'funds' | 'shorts' | 'options' | 'portfolio' | 'orders' | 'news' | 'learn';
const TABS: ReadonlyArray<readonly [View, string]> = [['overview', '🏛 Markets'], ['market', '📊 Stocks'], ['movers', '🚀 Movers'], ['watch', '⭐ Watchlist'], ['screener', '🔎 Screener'], ['funds', '🧺 Funds'], ['shorts', '📉 Shorts'], ['options', '🎯 Options'], ['portfolio', '💼 Portfolio'], ['orders', '🧾 Orders'], ['news', '📰 News'], ['learn', '📚 Learn']];
export interface OptPrefill { ticker: string; kind: 'call' | 'put'; off: number; days: number }
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

export function StocksPage() {
  const dragStocks = usePanelDrag('stocks');
  const [open, setOpen] = useState(atStocks);
  useDoing('stocks', null, open);
  const [view, setView] = useState<View>('market'); const [pre, setPre] = useState<OptPrefill | null>(null);
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
        <div className="inv-backdrop" {...backdropDismiss(() => close())}>
          <div className="inv-win mkt-win" role="dialog" aria-label="Stock Exchange" data-drag-panel="stocks" onPointerDown={dragStocks.onPointerDown} style={dragStocks.style()} ref={dragStocks.ref}>{dragStocks.handle}
            <header className="inv-head">
              <h2>📈 Stock Exchange</h2>
              <nav className="inv-tabs stk-nav" role="tablist">
                {TABS.map(([k, t]) => <button key={k} type="button" role="tab" aria-selected={view === k && !ticker} className={view === k && !ticker ? 'on' : ''} onClick={() => { setView(k); setTicker(null); }} data-testid={`stk-tab-${k}`}>{t}</button>)}
              </nav>
              <button type="button" className="ml-auto" aria-label="Close stock exchange" onClick={close}>✕</button>
            </header>
            <div className="flex-1 overflow-auto p-3 text-sm">
              {err && <p className="text-rose-400">{err}</p>}
              {!data ? <p className="opacity-60">Loading the exchange…</p>
                : ticker ? <CompanyView ticker={ticker} onBack={() => setTicker(null)} onTraded={load} onOption={(o) => { setPre(o); setView('options'); setTicker(null); }} />
                : view === 'overview' ? <MarketsOverview data={data} onPick={setTicker} onTab={setView} />
                : view === 'market' ? <MarketList data={data} onPick={setTicker} />
                : view === 'movers' ? <Movers data={data} onPick={setTicker} />
                : view === 'watch' ? <Watchlist data={data} onPick={setTicker} />
                : view === 'screener' ? <Screener data={data} onPick={setTicker} />
                : view === 'orders' ? <Orders onPick={setTicker} />
                : view === 'learn' ? <LearnView />
                : view === 'funds' ? <FundsView onTraded={load} />
                : view === 'shorts' ? <ShortsView data={data} onTraded={load} />
                : view === 'options' ? <OptionsView key={pre ? `${pre.ticker}${pre.kind}${pre.off}${pre.days}` : 'o'} data={data} init={pre} />
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
  const th = (k: typeof sort, label: string, info?: string) => <th className="cursor-pointer select-none px-1 text-right" onClick={() => { if (sort === k) setDesc(!desc); else { setSort(k); setDesc(true); } }} data-testid={`stk-sort-${k}`}><span className="inline-flex items-center gap-1">{label}{sort === k ? (desc ? ' ▾' : ' ▴') : ''}{info && <Info id={info} label={label} />}</span></th>;
  return (
    <div data-testid="stk-market">
      <div className="mb-2 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded bg-white/5 p-2"><div className="flex items-center gap-1 opacity-60">Market cap <Info id="cap" /></div><b>🪙 {n(data.totals.cap)}</b></div>
        <div className="rounded bg-white/5 p-2" title="Shares players own — counted in the Bank's asset worth"><div className="flex items-center gap-1 opacity-60">Player-owned <Info id="playerOwned" /></div><b>🪙 {n(data.totals.playerOwned)}</b></div>
        <div className="rounded bg-white/5 p-2" title="Shares no player owns — offshore, not in anyone's net worth"><div className="flex items-center gap-1 opacity-60">🏝 Offshore <Info id="playerOwned" label="Offshore" /></div><b>🪙 {n(data.totals.offshore)}</b></div>
      </div>
      <div className="mb-2 flex flex-wrap gap-2">
        <input className="flex-1 rounded bg-black/30 px-2 py-1" placeholder="Search company or ticker" value={q} onChange={(e) => setQ(e.target.value)} data-testid="stk-search" />
        <select className="rounded bg-black/30 px-2 py-1" value={sector} onChange={(e) => setSector(e.target.value)} data-testid="stk-sector">
          <option value="">All sectors</option>{data.sectors.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
        </select>
      </div>
      <table className="w-full text-[12px] tabular-nums">
        <thead className="opacity-70"><tr><th className="w-5" /><th className="cursor-pointer px-1 text-left" onClick={() => { setSort('name'); setDesc(false); }}>Company</th><th className="px-1 text-left"><Term id="sector">Sector</Term></th>{th('price', 'Price', 'price')}{th('chg', '24h', 'chg24')}{th('volume', 'Vol 24h', 'volume')}<th className="px-1 text-right" title="Daily dividend yield, paid to holders every day"><Term id="yield">Div/day</Term></th><th className="px-1 text-right"><Term id="playerOwned">Player-owned</Term></th></tr></thead>
        <tbody>{rows.map((c) => (
          <tr key={c.ticker} className="cursor-pointer border-t border-white/5 hover:bg-white/5" onClick={() => onPick(c.ticker)} data-testid={`stk-row-${c.ticker}`}>
            <td className="px-1"><Star t={c.ticker} /></td><td className="px-1 py-1"><b>{c.ticker}</b> <span className="opacity-70">{c.name}</span></td>
            <td className="px-1">{sec.get(c.sector as never)?.icon} {sec.get(c.sector as never)?.label}</td>
            <td className="px-1 text-right">{c.price.toFixed(2)}</td>
            <td className={`px-1 text-right ${tone(c.chg)}`}>{pc(c.chg)}</td>
            <td className="px-1 text-right">{n(c.volume)}</td>
            <td className="px-1 text-right">{c.divYield ? `${(c.divYield * 100).toFixed(2)}%` : '—'}</td>
            <td className="px-1 text-right">{c.playerPct.toFixed(2)}%</td>
          </tr>))}</tbody>
      </table>
      <p className="mt-2 text-[11px] opacity-60">Prices move every 30s. Drift follows chip inflation ({data.drift.inflPct == null ? '—' : pc(data.drift.inflPct)}/day) and in-game activity by sector. Fee {STOCK_FEE * 100}% + {STOCK_SPREAD * 100}% spread per trade.</p>
      <TradeFeed onPick={onPick} />
    </div>
  );
}


interface CompanyResp { dayChg?: number; company: Row & { blurb: string; vol: number; beta: number; liquidity: number }; chart: Array<[number, number]>; stats?: KeyStats; news: NewsItem[]; upcoming: number; mine: { shares: number; cost: number } | null; maxOrder: number; drift: number; callLock?: boolean }
type Sub = 'overview' | 'chart' | 'financials' | 'news' | 'chain' | 'dividends' | 'holders';
const SUBS: ReadonlyArray<readonly [Sub, string]> = [['overview', 'Overview'], ['chart', 'Chart'], ['financials', 'Key stats'], ['news', 'News'], ['chain', 'Options chain'], ['dividends', 'Dividends'], ['holders', 'Holders & activity']];
function CompanyView({ ticker, onBack, onTraded, onOption }: { ticker: string; onBack: () => void; onTraded: () => void; onOption: (o: OptPrefill) => void }) {
  const account = useAccount(); const [sub, setSub] = useState<Sub>('overview');
  const [range, setRange] = useState<Period>('1d');
  const [d, setD] = useState<CompanyResp | null>(null);
  const [qty, setQty] = useState('1'); const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null); const { busy, run } = useMoneyAction(); /* QA r12: lock + spinner set synchronously on click, held for the whole request */
  const loadSeq = useRef(0); // QA r13: only the newest response may paint 'You own' (an older poll landing late showed a stale count)
  const load = useCallback(() => { const seq = ++loadSeq.current; return request('stk_company', { ticker, range }).then((r) => { if (r.ok && seq === loadSeq.current) setD(r as unknown as CompanyResp); }); }, [ticker, range]);
  useEffect(() => { void load(); const iv = setInterval(() => void load(), 30_000); return () => clearInterval(iv); }, [load]);
  if (!d) return <p className="opacity-60">Loading {ticker}…</p>;
  const c = d.company; const meta = COMPANY_BY_TICKER.get(ticker)!; const pq = parseQty(qty); const shares = pq.ok ? pq.n : 0; const qtyErr = pq.ok || qty.trim() === '' ? null : pq.error; const held = d.mine?.shares ?? 0;
  const qb = shares ? quote(meta, c.price, 'buy', shares) : null, qs = shares && held > 0 ? quote(meta, c.price, 'sell', Math.min(shares, held)) : null;
  const trade = async (side: 'buy' | 'sell') => {
    // QA r13: the lock (and spinner) stays until the refreshed holding is on screen, so 'You own' never shows the pre-trade count
    const r = await run(side, async () => { setMsg(null); const a = await request(side === 'buy' ? 'stk_buy' : 'stk_sell', { ticker, shares }); if (a.ok && !a.replayed) await load().catch(() => {}); return a; });
    if (!r) return;
    if (r.replayed) return setMsg({ ok: true, t: ALREADY });
    const x = r as unknown as { fill: number; total: number; fee: number };
    if (r.ok) { setMsg({ ok: true, t: `${side === 'buy' ? 'Bought' : 'Sold'} ${shares} ${ticker} at ${x.fill.toFixed(2)} — ${side === 'buy' ? 'paid' : 'received'} 🪙 ${n(x.total)} (fee ${x.fee}).` }); onTraded(); }
    else setMsg({ ok: false, t: r.error ?? 'Trade failed.' });
  };
  const offPct = 100 - c.playerPct; const day = d.dayChg ?? c.chg; /* MU #9 v2: badge = the same figure the 1D chart shows */
  const cards = (
      <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        <div className="ivx-stat" data-testid="stk-div"><div className="ivx-k ivx-k-i">Dividend <Info id="dividend" /></div>{c.divYield ? <div>Pays <b>{(c.divYield * 100).toFixed(2)}%/day</b> (≈ 🪙 {(c.price * c.divYield).toFixed(2)}/share) at {DIV_HOUR_UTC}:00 UTC</div> : <div className="opacity-60">No dividend: growth company.</div>}</div>
        <div className="ivx-stat" title="Player-owned shares count as assets; the rest is offshore"><div className="ivx-k ivx-k-i">Player-owned / 🏝 offshore <Info id="playerOwned" /></div><b>{c.playerPct.toFixed(2)}% / {offPct.toFixed(2)}%</b><div className="mt-1 h-1.5 rounded bg-white/10"><div className="h-1.5 rounded bg-emerald-400" style={{ width: `${Math.min(100, c.playerPct)}%` }} /></div></div>
        <div className="ivx-stat"><div className="ivx-k ivx-k-i">Trend (inflation + activity) <Info id="trend" /></div><b className={tone(d.drift)}>{pc(d.drift * 100)}/day</b></div>
      </div>);
  return (
    <div data-testid="stk-company">
      <button type="button" className="mb-2 text-xs opacity-70 hover:opacity-100" onClick={onBack}>← All companies</button>
      <div className="mb-1 flex flex-wrap items-center gap-2"><Star t={c.ticker} /><span className="rounded-lg bg-white/10 px-2 py-1 text-sm font-black tracking-wide">{c.ticker}</span><h3 className="text-lg font-bold">{c.name}</h3><span className="text-xs opacity-60">{c.sector}</span><span className="ml-auto text-lg font-black tabular-nums">{c.price.toFixed(2)}</span><span className={`ivx-pill ${day > 0 ? 'up' : day < 0 ? 'down' : 'flat'}`} data-testid="stk-day-badge">{pc(day)} 24h</span><Info id="chg24" /></div>
      <nav className="stk-sub" role="tablist" aria-label={`${c.ticker} sections`}>{SUBS.map(([k, t]) => <button key={k} type="button" role="tab" aria-selected={sub === k} className={sub === k ? 'on' : ''} onClick={() => setSub(k)} data-testid={`stk-sub-${k}`}>{t}</button>)}</nav>
      {sub === 'overview' && <>
        <p className="mb-2 text-xs opacity-70">{c.blurb}</p>
        <InvestChart pts={d.chart} period={range} onPeriod={setRange} value={c.price} testid="stk-chart" />
        {d.stats && <KeyStatsGrid s={d.stats} />}
        {cards}
      </>}
      {sub === 'chart' && <ProChart ticker={ticker} pts={d.chart} period={range} onPeriod={setRange} price={c.price} />}
      {sub === 'financials' && <>{d.stats ? <KeyStatsGrid s={d.stats} /> : <p className="text-xs opacity-60">No stats yet.</p>}{cards}<p className="mt-2 text-[11px] opacity-60">Beta {c.beta.toFixed(2)} <Info id="beta" /> · volatility {(c.vol * 100).toFixed(1)}%/day <Info id="volatility" /></p></>}
      {sub === 'news' && <><h4 className="text-xs uppercase tracking-wide opacity-70">{c.ticker} news {d.upcoming ? <span className="normal-case opacity-60">· {d.upcoming} more expected today</span> : null}</h4><NewsFeed news={d.news} /></>}
      {sub === 'chain' && <OptionChain ticker={ticker} price={c.price} onPick={onOption} />}
      {sub === 'dividends' && <Dividends c={c} stats={d.stats} mine={d.mine?.shares ?? 0} />}
      {sub === 'holders' && <Holders ticker={ticker} playerPct={c.playerPct} />}
      <div className="mt-3 rounded bg-white/5 p-2">
        {d.mine && <p className="mb-1 text-xs" data-testid="stk-mine">You own <b>{plural(d.mine.shares, 'share', 'shares')}</b> (player-owned asset) worth 🪙 {n(d.mine.shares * c.price)} · cost 🪙 {n(d.mine.cost)}</p>}
        {!account ? <p className="text-xs opacity-70">Sign in to trade. Guests can browse.</p> : (
          <div className="flex flex-wrap items-center gap-2">
            <input className="w-24 rounded bg-black/30 px-2 py-1" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Shares" aria-invalid={!!qtyErr} data-testid="stk-qty" />
            <button type="button" disabled={!!busy || !shares || !!d.callLock} title={d.callLock ? `You hold an open call on ${ticker}: no buying shares until it expires or you sell it.` : undefined} className="rounded bg-emerald-600 px-3 py-1 font-semibold disabled:opacity-40" onClick={() => void trade('buy')} data-testid="stk-buy" aria-busy={busy === 'buy'}>{busy === 'buy' && <Spin />}Buy {qb ? `· 🪙 ${n(qb.total)}` : ''}</button>
            <button type="button" disabled={!!busy || !shares || held < 1 || shares > held} title={held < 1 ? "You don't own any shares to sell." : shares > held ? `You only own ${plural(held, 'share', 'shares')}.` : undefined} className="rounded bg-rose-600 px-3 py-1 font-semibold disabled:opacity-40" onClick={() => void trade('sell')} data-testid="stk-sell" aria-busy={busy === 'sell'}>{busy === 'sell' && <Spin />}Sell {qs && shares <= held ? `· 🪙 ${n(qs.total)}` : ''}</button>
            <QtyErr e={qtyErr} />
            {d.callLock && <p className="w-full text-xs text-amber-300" data-testid="stk-call-lock">📈 You hold an open call on {ticker}, so buying {ticker} shares is locked until it expires or you sell it. You can still sell.</p>}
          </div>)}
        <p className="mt-1 text-[11px] opacity-60">Max 🪙 {n(d.maxOrder)} per order (moves the price ≤ {MAX_TRADE_IMPACT * 100}%; ≤ {MAX_TICK_IMPACT * 100}% per 30s for everyone). Your order moves the price; the effect fades over a few hours. {STOCK_FEE * 100}% fee is burned.</p>
        {msg && <p className={`mt-1 text-xs ${msg.ok ? 'text-emerald-400' : 'text-rose-400'}`} data-testid="stk-msg">{msg.t}</p>}
      </div>
      {sub === 'overview' && <>
        <h4 className="mt-3 text-xs uppercase tracking-wide opacity-70">News {d.upcoming ? <span className="normal-case opacity-60">· {d.upcoming} more expected today</span> : null}</h4>
        <NewsFeed news={d.news.slice(0, 5)} />
      </>}
      {(sub === 'overview' || sub === 'holders') && <TradeFeed ticker={ticker} title={`Recent ${ticker} trades`} />}
    </div>
  );
}

interface PubTrade { kind: 'buy' | 'sell' | 'short' | 'cover' | 'liquidated' | 'call' | 'put' | 'expired'; opt?: 'call' | 'put'; name: string; ticker: string; qty: number; price: number; chips: number; at: number; strike?: number; expiry?: number }
/** Alberta time (UTC-6 all year), labelled CST. */
const cst = (t: number) => { const d = new Date(t - 6 * 3600_000); const today = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10) === d.toISOString().slice(0, 10); const h = d.getUTCHours(), m = d.getUTCMinutes(); return `${today ? '' : `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()} `}${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'} CST`; };
const cstDay = (t: number) => { const d = new Date(t - 6 * 3600_000); return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`; };
const TAG: Record<PubTrade['kind'], [string, string]> = { buy: ['BUY', 'bg-emerald-700'], sell: ['SELL', 'bg-rose-700'], short: ['SHORT', 'bg-orange-700'], cover: ['COVER', 'bg-sky-700'], liquidated: ['LIQUIDATED', 'bg-red-900'], call: ['CALL', 'bg-violet-700'], put: ['PUT', 'bg-fuchsia-800'], expired: ['EXPIRED', 'bg-zinc-600'] };
export function TradeFeed({ ticker, fund, onPick, title = 'Recent trades' }: { ticker?: string; fund?: string; onPick?: (t: string) => void; title?: string }) {
  const [ts, setTs] = useState<PubTrade[] | null>(null); const [lim, setLim] = useState(25);
  const load = useCallback(() => request('stk2_trades', { ticker, fund, limit: lim }).then((r) => { if (r.ok) setTs((r as unknown as { trades: PubTrade[] }).trades); }), [ticker, fund, lim]);
  useEffect(() => { void load(); const iv = setInterval(() => void load(), 20_000); return () => clearInterval(iv); }, [load]);
  return (
    <div className="mt-3" data-testid="stk-trades">
      <h4 className="text-xs uppercase tracking-wide opacity-70">{title} <span className="normal-case opacity-60">· public · stocks, shorts &amp; options</span></h4>
      {!ts ? <p className="text-xs opacity-60">Loading trades…</p> : !ts.length ? <p className="text-xs opacity-60">No trades yet.</p> : (
        <table className="mt-1 w-full text-[11px] tabular-nums"><thead className="opacity-60"><tr><th className="text-left">Time</th><th className="text-left">Player</th><th className="text-left">Type</th><th className="text-left">Stock</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Chips</th></tr></thead>
          <tbody>{ts.map((t, i) => { const [lab, cls] = TAG[t.kind]; const opt = t.kind === 'call' || t.kind === 'put' || t.kind === 'expired'; return (
            <tr key={`${t.at}-${i}`} className="border-t border-white/5" data-testid="stk-trade-row">
              <td className="whitespace-nowrap opacity-70">{cst(t.at)}</td><td className="max-w-[9rem] truncate">{t.name}</td>
              <td className="whitespace-nowrap"><span className={`rounded px-1 font-semibold ${cls}`}>{t.kind === 'expired' ? `${(t.opt ?? '').toUpperCase()} EXPIRED` : lab}</span>{opt && t.strike != null ? <span className="ml-1 opacity-70">{t.strike.toFixed(2)} strike · exp {cstDay(t.expiry!)}</span> : null}</td>
              <td><button type="button" className={onPick ? 'font-bold hover:underline' : 'font-bold'} onClick={() => onPick?.(t.ticker)}>{t.ticker}</button></td>
              <td className="text-right">{t.qty.toLocaleString()}{opt ? ' ct' : ''}</td><td className="text-right">{t.kind === 'call' || t.kind === 'put' ? '—' : t.price.toFixed(2)}</td><td className="text-right">🪙 {n(t.chips)}</td>
            </tr>); })}</tbody></table>)}
      {ts && ts.length >= lim && lim < 100 && <button type="button" className="mt-1 text-[11px] opacity-70 hover:opacity-100" onClick={() => setLim(100)} data-testid="stk-trades-more">Show more</button>}
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


/** Shares input: keeps exactly what was typed (no silent stripping) and validates with the server's parser. */
const QtyErr = ({ e }: { e: string | null }) => (e ? <span className="text-[11px] text-rose-400" data-testid="stk-qty-err">{e}</span> : null);
const plural = (k: number, one: string, many: string) => `${k.toLocaleString()} ${k === 1 ? one : many}`;
const say = (set: (m: { ok: boolean; t: string } | null) => void) => (r: { ok: boolean; error?: string }, t: string) => set(r.ok ? { ok: true, t } : { ok: false, t: r.error ?? 'Failed.' });
const Msg = ({ m }: { m: { ok: boolean; t: string } | null }) => (m ? <p className={`mt-1 text-xs ${m.ok ? 'text-emerald-400' : 'text-rose-400'}`} data-testid="stk-msg">{m.t}</p> : null);
const Card = ({ k, v, title, cls }: { k: string; v: React.ReactNode; title?: string; cls?: string }) => <div className="rounded bg-white/5 p-2" title={title}><div className="opacity-60">{k}</div><b className={cls}>{v}</b></div>;

interface FundRow { id: string; name: string; kind: 'index' | 'mutual'; blurb: string; fee: number; expense: number; nav: number; dayPct?: number; yield: number; holdings: Array<{ ticker: string; weight: number }> }
export function FundsView({ onTraded }: { onTraded: () => void }) {
  const account = useAccount(); const [fs, setFs] = useState<FundRow[] | null>(null); const [sel, setSel] = useState<string | null>(null);
  const [units, setUnits] = useState('1'); const [m, setM] = useState<{ ok: boolean; t: string } | null>(null); const { busy, run } = useMoneyAction(); /* QA r12: lock + spinner set synchronously on click, held for the whole request */ const [mine, setMine] = useState<Record<string, number>>({});
  const load = useCallback(() => { void request('stk2_funds').then((r) => r.ok && setFs((r as unknown as { funds: FundRow[] }).funds)); if (account) void request('stk2_portfolio').then((r) => r.ok && setMine(Object.fromEntries((r as unknown as Port).funds.map((f) => [f.fund, f.units])))); }, [account]);
  useEffect(() => { load(); const iv = setInterval(load, 30_000); return () => clearInterval(iv); }, [load]);
  if (!fs) return <p className="opacity-60">Loading funds…</p>;
  const pu = parseQty(units, { decimals: 2 }); const u = pu.ok ? pu.n : 0; const uErr = pu.ok || units.trim() === '' ? null : pu.error.replaceAll('shares', 'units');
  const go = async (side: 'buy' | 'sell', id: string) => { const r = await run(`${side}:${id}`, () => request(side === 'buy' ? 'stk2_fund_buy' : 'stk2_fund_sell', { fund: id, units: u })); if (!r) return; if (r.replayed) return setM({ ok: true, t: ALREADY }); const x = r as unknown as { total: number; fee: number }; say(setM)(r, `${side === 'buy' ? 'Bought' : 'Sold'} ${u} ${id} — 🪙 ${n(x.total)} (fee ${x.fee}).`); if (r.ok) { load(); onTraded(); } };
  return (
    <div data-testid="stk-funds">
      <p className="mb-2 flex flex-wrap gap-x-3 text-xs"><Term id="fund">Fund</Term><Term id="index">Index fund</Term><Term id="mutual">Mutual fund</Term><Term id="nav">NAV</Term><Term id="expense">Expense ratio</Term><Term id="holdings">Holdings</Term></p>
      <p className="mb-2 text-xs opacity-70">Funds hold a basket of companies. <b>Index funds</b>: {0.25}% fee, no ongoing cost. <b>Mutual funds</b>: actively picked, 0.5% fee plus a daily expense ratio (taken from your units and burned). Dividends of the companies inside are passed through daily. Max 🪙 {n(FUND_MAX_ORDER)} per order.</p>
      <table className="w-full text-[12px] tabular-nums"><thead className="opacity-70"><tr><th className="text-left">Fund</th><th className="text-left">Type</th><th className="text-right">NAV</th><th className="text-right" title="NAV change over the last 24 hours">Day %</th><th className="text-right">Div/day</th><th className="text-right">Fee · expense/day</th><th className="text-right">You own</th></tr></thead>
        <tbody>{fs.map((f) => <tr key={f.id} className={`cursor-pointer border-t border-white/5 hover:bg-white/5 ${sel === f.id ? 'bg-white/10' : ''}`} onClick={() => setSel(sel === f.id ? null : f.id)} data-testid={`stk-fund-${f.id}`}>
          <td><b>{f.id}</b> <span className="opacity-70">{f.name}</span></td><td>{f.kind === 'index' ? 'Index' : 'Mutual'}</td><td className="text-right">{f.nav.toFixed(2)}</td><td className={`text-right ${tone(f.dayPct ?? 0)}`} data-testid={`stk-fund-day-${f.id}`}>{(f.dayPct ?? 0) >= 0 ? '+' : ''}{(f.dayPct ?? 0).toFixed(2)}%</td><td className="text-right">{(f.yield * 100).toFixed(3)}%</td><td className="text-right">{(f.fee * 100).toFixed(2)}% · {f.expense ? `${(f.expense * 100).toFixed(2)}%` : '—'}</td><td className="text-right">{mine[f.id] ? mine[f.id]!.toFixed(2) : '—'}</td></tr>)}</tbody></table>
      {sel && (() => { const f = fs.find((x) => x.id === sel)!; return (
        <div className="mt-2 rounded bg-white/5 p-2" data-testid="stk-fund-detail">
          <p className="text-xs"><b>{f.name}</b>: {f.blurb}</p>
          <p className="mt-1 text-xs" data-testid="stk-fund-detail-day">NAV {f.nav.toFixed(2)} · <span className={tone(f.dayPct ?? 0)}>{(f.dayPct ?? 0) >= 0 ? '+' : ''}{(f.dayPct ?? 0).toFixed(2)}% today (24h)</span></p>
          <div className="mt-2"><FundChart id={f.id} nav={f.nav} /></div>
          <div className="ivx-stats"><div className="ivx-stat"><div className="ivx-k">NAV / unit</div><div className="ivx-v">{f.nav.toFixed(2)}</div></div><div className="ivx-stat"><div className="ivx-k">Div yield</div><div className="ivx-v">{(f.yield * 100).toFixed(3)}%/day</div></div><div className="ivx-stat"><div className="ivx-k">Fee · expense</div><div className="ivx-v">{(f.fee * 100).toFixed(2)}% · {f.expense ? `${(f.expense * 100).toFixed(2)}%/d` : '—'}</div></div><div className="ivx-stat"><div className="ivx-k">Holdings</div><div className="ivx-v">{f.holdings.length}</div></div></div>
          <p className="mt-1 text-[11px] opacity-70">{f.holdings.length} holdings: {f.holdings.slice(0, 15).map((h) => `${h.ticker} ${h.weight}%`).join(' · ')}{f.holdings.length > 15 ? ' …' : ''}</p>
          {!account ? <p className="text-xs opacity-70">Sign in to trade.</p> : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input className="w-24 rounded bg-black/30 px-2 py-1" inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} aria-label="Units" aria-invalid={!!uErr} data-testid="stk-fund-units" />
              <button type="button" disabled={!!busy || !u} className="rounded bg-emerald-600 px-3 py-1 font-semibold disabled:opacity-40" onClick={() => void go('buy', f.id)} data-testid="stk-fund-buy" aria-busy={busy === `buy:${f.id}`}>{busy === `buy:${f.id}` && <Spin />}Buy{u ? ` · 🪙 ${n(fundQuote(FUND_BY_ID.get(f.id)!, f.nav, 'buy', u).total)}` : ''}</button>
              <button type="button" disabled={!!busy || !u || !mine[f.id]} className="rounded bg-rose-600 px-3 py-1 font-semibold disabled:opacity-40" onClick={() => void go('sell', f.id)} data-testid="stk-fund-sell" aria-busy={busy === `sell:${f.id}`}>{busy === `sell:${f.id}` && <Spin />}Sell{u && mine[f.id] ? ` · 🪙 ${n(fundQuote(FUND_BY_ID.get(f.id)!, f.nav, 'sell', Math.min(u, mine[f.id]!)).total)}` : ''}</button>
              <QtyErr e={uErr} />
            </div>)}
          <Msg m={m} />
          <TradeFeed fund={f.id} title={`Recent trades in ${f.id}'s companies`} />
        </div>); })()}
    </div>
  );
}

function FundChart({ id, nav }: { id: string; nav: number }) {
  const [period, setPeriod] = useState<Period>('1d'); const [pts, setPts] = useState<Array<[number, number]> | null>(null);
  useEffect(() => { let live = true; const go = () => void request('stk3_fund_chart', { fund: id, range: period }).then((r) => { if (live && r.ok) setPts((r as unknown as { chart: Array<[number, number]> }).chart); }); go(); const iv = setInterval(go, 60_000); return () => { live = false; clearInterval(iv); }; }, [id, period]);
  if (!pts) return <p className="text-xs opacity-60">Loading chart…</p>;
  return <InvestChart pts={pts} period={period} onPeriod={setPeriod} value={nav} prefix="NAV " testid="stk-fund-chart" height={150} />;
}
function PortfolioChart() {
  const [period, setPeriod] = useState<Period>('1d'); const [pts, setPts] = useState<Array<[number, number]> | null>(null);
  useEffect(() => { let live = true; const go = () => void request('stk3_portfolio_chart', { range: period }).then((r) => { if (live && r.ok) setPts((r as unknown as { chart: Array<[number, number]> }).chart); }); go(); const iv = setInterval(go, 60_000); return () => { live = false; clearInterval(iv); }; }, [period]);
  if (!pts) return <p className="text-xs opacity-60">Loading chart…</p>;
  return <InvestChart pts={pts} period={period} onPeriod={setPeriod} decimals={0} testid="stk-port-chart" empty="Your portfolio chart starts now: a new point is saved every 10 minutes." />;
}
function Allocation({ t }: { t: Port['totals'] }) {
  const parts: Array<[string, number, string]> = [['Stocks', t.stocks, '#22c55e'], ['Funds', t.funds, '#38bdf8'], ['Shorts', t.shorts, '#f97316'], ['Options', t.options, '#a78bfa']];
  const sum = parts.reduce((a, p) => a + Math.max(0, p[1]), 0); if (!sum) return null;
  return <div className="ivx-card mt-2" data-testid="stk-alloc"><div className="ivx-k ivx-k-i mb-1">Allocation <Info id="allocation" /></div><div className="ivx-alloc">{parts.map(([k, v, c]) => v > 0 ? <div key={k} style={{ width: `${(v / sum) * 100}%`, background: c }} title={`${k} ${((v / sum) * 100).toFixed(1)}%`} /> : null)}</div>
    <div className="mt-1 flex flex-wrap gap-3 text-[11px]">{parts.map(([k, v, c]) => <span key={k} className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />{k} <b>🪙 {compact(v)}</b> <span className="opacity-60">{sum ? ((Math.max(0, v) / sum) * 100).toFixed(1) : 0}%</span></span>)}</div></div>;
}

function ShortsView({ data, onTraded }: { data: ListResp; onTraded: () => void }) {
  const account = useAccount(); const [t, setT] = useState(data.companies[0]?.ticker ?? ''); const [qty, setQty] = useState('1'); const [p, setP] = useState<Port | null>(null);
  const [m, setM] = useState<{ ok: boolean; t: string } | null>(null); const { busy, run } = useMoneyAction(); /* QA r12: lock + spinner set synchronously on click, held for the whole request */
  const load = useCallback(() => { if (account) void request('stk2_portfolio').then((r) => r.ok && setP(r as unknown as Port)); }, [account]);
  useEffect(() => { load(); const iv = setInterval(load, 30_000); return () => clearInterval(iv); }, [load]);
  if (!account) return <p className="opacity-70">Sign in to short stocks.</p>;
  const c = data.companies.find((x) => x.ticker === t); const ps = parseQty(qty); const sh = ps.ok ? ps.n : 0; const shErr = ps.ok || qty.trim() === '' ? null : ps.error;
  const open = async () => { const r = await run('open', () => request('stk2_short_open', { ticker: t, shares: sh })); if (!r) return; if (r.replayed) return setM({ ok: true, t: ALREADY }); const x = r as unknown as { fill: number; collateral: number; liqPrice: number }; say(setM)(r, `Shorted ${sh} ${t} at ${x.fill?.toFixed(2)} — 🪙 ${n(x.collateral)} locked as collateral. Liquidated at ${x.liqPrice}.`); if (r.ok) { load(); onTraded(); } };
  const close = async (id: string) => { const r = await run(`close:${id}`, () => request('stk2_short_close', { id })); if (!r) return; if (r.replayed) return setM({ ok: true, t: ALREADY }); const x = r as unknown as { payout: number; pnl: number }; say(setM)(r, `Closed — got back 🪙 ${n(x.payout)} (P&L ${x.pnl >= 0 ? '+' : ''}${n(x.pnl)}).`); if (r.ok) { load(); onTraded(); } };
  return (
    <div data-testid="stk-shorts">
      <p className="mb-2 flex flex-wrap gap-x-3 text-xs"><Term id="short">Short</Term><Term id="collateral">Collateral</Term><Term id="liquidation">Liquidation</Term><Term id="borrow">Borrow fee</Term><Term id="cover">Cover / close</Term></p>
      <p className="mb-2 text-xs opacity-70">Short = bet a stock falls. You lock {SHORT_INIT * 100}% of the position as collateral (plus the 1% fee). If the price rises until your equity drops below {SHORT_MAINT * 100}% of the position, it's auto-closed at market. You can never lose more than your collateral. Borrow fee {(BORROW_FEE * 100).toFixed(2)}%/day is taken from collateral and burned. Short sales move the price like a sell (same 2% / 5% caps).</p>
      <div className="flex flex-wrap items-center gap-2">
        <select className="rounded bg-black/30 px-2 py-1" value={t} onChange={(e) => setT(e.target.value)} data-testid="stk-short-ticker">{[...data.companies].sort((a, b) => a.ticker.localeCompare(b.ticker)).map((x) => <option key={x.ticker} value={x.ticker}>{x.ticker} · {x.price.toFixed(2)}</option>)}</select>
        <input className="w-24 rounded bg-black/30 px-2 py-1" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Shares" aria-invalid={!!shErr} data-testid="stk-short-qty" />
        <button type="button" disabled={!!busy || !sh} className="rounded bg-rose-600 px-3 py-1 font-semibold disabled:opacity-40" onClick={() => void open()} data-testid="stk-short-open" aria-busy={busy === 'open'}>{busy === 'open' && <Spin />}Short · locks ≈🪙 {c ? n(c.price * sh * SHORT_INIT) : '—'}</button>
        <QtyErr e={shErr} />
      </div>
      <Msg m={m} />
      <ShortTable p={p} onClose={close} busy={busy} />
    </div>
  );
}
function ShortTable({ p, onClose, busy }: { p: Port | null; onClose?: (id: string) => void; busy?: string | false }) {
  if (!p) return null; if (!p.shorts.length) return <p className="mt-2 text-xs opacity-60">No open shorts.</p>;
  return <table className="mt-2 w-full text-[12px] tabular-nums"><thead className="opacity-70"><tr><th className="text-left">Short</th><th className="text-right">Entry → now</th><th className="text-right">Collateral</th><th className="text-right" title="What closing now pays back (buy-back at the ask, rounded, minus the 1% fee)">Close value</th><th className="text-right">P&amp;L</th><th className="text-right">Liq. at</th>{onClose && <th />}</tr></thead>
    <tbody>{p.shorts.map((s) => <tr key={s.id} className="border-t border-white/5" data-testid="stk-short-row"><td><b>{s.ticker}</b> ×{s.shares}</td><td className="text-right">{s.entry.toFixed(2)} → {s.price.toFixed(2)}</td><td className="text-right">{n(s.collateral)}</td><td className="text-right" title={`Equity ${n(s.equity)}`}>{n(s.closeValue ?? s.equity)}</td><td className={`text-right ${tone(s.pnl)}`}>{s.pnl >= 0 ? '+' : ''}{n(s.pnl)}</td><td className="text-right">{s.liqPrice.toFixed(2)}</td>{onClose && <td className="text-right"><button type="button" disabled={!!busy} className="rounded bg-white/10 px-2 py-0.5" onClick={() => onClose(s.id)} data-testid="stk-short-close" aria-busy={busy === `close:${s.id}`}>{busy === `close:${s.id}` && <Spin />}Close</button></td>}</tr>)}</tbody></table>;
}

function OptionsView({ data, init }: { data: ListResp; init?: OptPrefill | null }) {
  const account = useAccount(); const [t, setT] = useState(init?.ticker ?? data.companies[0]?.ticker ?? ''); const [kind, setKind] = useState<'call' | 'put'>(init?.kind ?? 'call');
  const [off, setOff] = useState<number>(init?.off ?? 0); const [days, setDays] = useState<number>(init?.days ?? 1); const [qty, setQty] = useState('10');
  const [q, setQ] = useState<{ premium: number; breakeven: number; strike: number } | null>(null); const [qe, setQe] = useState<string | null>(null);
  const [m, setM] = useState<{ ok: boolean; t: string } | null>(null); const { busy, run } = useMoneyAction(); /* QA r12: lock + spinner set synchronously on click, held for the whole request */ const [p, setP] = useState<Port | null>(null);
  const c = data.companies.find((x) => x.ticker === t); const strike = c ? strikeFor(c.price, off) : 0; const po = parseQty(qty); const n2 = po.ok ? po.n : 0; const oErr = po.ok || qty.trim() === '' ? null : po.error;
  useEffect(() => { if (!c || !n2) { setQ(null); return; } void request('stk2_opt_quote', { ticker: t, kind, strike, days, qty: n2 }).then((r) => { if (r.ok) { setQ(r as never); setQe(null); } else { setQ(null); setQe(r.error ?? null); } }); }, [t, kind, strike, days, n2, c]);
  const load = useCallback(() => { if (account) void request('stk2_portfolio').then((r) => r.ok && setP(r as unknown as Port)); }, [account]);
  useEffect(() => { load(); const iv = setInterval(load, 30_000); return () => clearInterval(iv); }, [load]);
  const buy = async () => { const r = await run('buy', () => request('stk2_opt_buy', { ticker: t, kind, strike, days, qty: n2 })); if (!r) return; if (r.replayed) return setM({ ok: true, t: ALREADY }); const x = r as unknown as { premium: number }; say(setM)(r, `Bought ${n2} ${t} ${strike} ${kind}s, ${days}d — paid 🪙 ${n(x.premium)}.`); if (r.ok) load(); };
  const sell = async (id: string, q2: number) => { const r = await run(`sell:${id}`, () => request('stk2_opt_sell', { id, qty: q2 })); if (!r) return; if (r.replayed) return setM({ ok: true, t: ALREADY }); const x = r as unknown as { sold: number; left: number; payout: number; pnl: number; ticker: string; kind: string }; say(setM)(r, `Sold ${x.sold} ${x.ticker} ${x.kind}${x.sold > 1 ? 's' : ''} for 🪙 ${n(x.payout)} (P&L ${x.pnl >= 0 ? '+' : ''}${n(x.pnl)})${x.left ? ` — ${x.left} still held` : ''}.`); load(); };
  return (
    <div data-testid="stk-options">
      <p className="mb-2 flex flex-wrap gap-x-3 text-xs"><Term id="call">Call</Term><Term id="put">Put</Term><Term id="strike">Strike</Term><Term id="expiry">Expiry</Term><Term id="premium">Premium</Term><Term id="breakeven">Breakeven</Term><Term id="chain">Options chain</Term></p>
      <p className="mb-2 text-xs opacity-70"><b>Call</b> = pays if the price ends above the strike; <b>put</b> = pays if it ends below. You pay the premium up front (burned) and that's the most you can lose. At expiry it settles automatically in chips: (price − strike) × shares for a call. Or sell early (all or part) at the current model value, less the 5% house edge and 1% fee. Options don't move the stock price.</p>
      <div className="flex flex-wrap items-center gap-2">
        <select className="rounded bg-black/30 px-2 py-1" value={t} onChange={(e) => setT(e.target.value)} data-testid="stk-opt-ticker">{[...data.companies].sort((a, b) => a.ticker.localeCompare(b.ticker)).map((x) => <option key={x.ticker} value={x.ticker}>{x.ticker} · {x.price.toFixed(2)}</option>)}</select>
        <select className="rounded bg-black/30 px-2 py-1" value={kind} onChange={(e) => setKind(e.target.value as 'call' | 'put')} data-testid="stk-opt-kind"><option value="call">Call 📈</option><option value="put">Put 📉</option></select>
        <select className="rounded bg-black/30 px-2 py-1" value={off} onChange={(e) => setOff(Number(e.target.value))} data-testid="stk-opt-strike">{OPT_STRIKES.map((o) => <option key={o} value={o}>Strike {c ? strikeFor(c.price, o).toFixed(2) : ''} ({o === 0 ? 'at the money' : `${o > 0 ? '+' : ''}${o * 100}%`})</option>)}</select>
        <select className="rounded bg-black/30 px-2 py-1" value={days} onChange={(e) => setDays(Number(e.target.value))} data-testid="stk-opt-days">{OPT_EXPIRIES.map((d) => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}</select>
        <input className="w-20 rounded bg-black/30 px-2 py-1" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Shares covered" aria-invalid={!!oErr} data-testid="stk-opt-qty" />
        <QtyErr e={oErr} />
        {account ? <button type="button" disabled={!!busy || !q} className="rounded bg-emerald-600 px-3 py-1 font-semibold disabled:opacity-40" onClick={() => void buy()} data-testid="stk-opt-buy" aria-busy={busy === 'buy'}>{busy === 'buy' && <Spin />}Buy · 🪙 {q ? n(q.premium) : '—'}</button> : <span className="text-xs opacity-70">Sign in to trade.</span>}
      </div>
      {q && <p className="mt-1 text-xs opacity-80">Breakeven at expiry: <b>{q.breakeven.toFixed(2)}</b>. Max loss 🪙 {n(q.premium)}.</p>}
      {qe && <p className="mt-1 text-xs text-rose-400">{qe}</p>}
      <Msg m={m} />
      <OptTable p={p} onSell={account ? sell : undefined} busy={busy} />
    </div>
  );
}
function OptSell({ o, onSell, busy }: { o: Port['options'][number]; onSell: (id: string, q: number) => void; busy: string | false }) {
  const [q, setQ] = useState(String(o.qty)); useEffect(() => setQ(String(o.qty)), [o.qty]);
  const k = Math.max(0, Math.min(o.qty, Math.floor(Number(q) || 0))); const bid = Math.floor(((o.bid ?? 0) * k) / o.qty); const mine = busy === `sell:${o.id}`;
  const expired = o.hoursLeft <= 0;
  return <span className="inline-flex items-center gap-1">
    <input className="w-12 rounded bg-black/30 px-1 py-0.5 text-right" inputMode="numeric" value={q} onChange={(e) => setQ(e.target.value.replace(/\D/g, ''))} aria-label="Contracts to sell" data-testid="stk-opt-sell-qty" disabled={!!busy || expired} />
    <button type="button" disabled={!!busy || expired || !k || Number(q) > o.qty || bid < 1} title={expired ? 'Expired: settles at the next tick' : bid < 1 ? 'Worth less than 1 chip: hold to expiry' : 'Sell to close at the current model value, less the house edge and 1% fee'} className="rounded bg-rose-600 px-2 py-0.5 font-semibold disabled:opacity-40" onClick={() => onSell(o.id, k)} data-testid="stk-opt-sell" aria-busy={mine}>{mine && <Spin />}Sell · 🪙 {n(bid)}</button>
  </span>;
}
function OptTable({ p, onSell, busy = false }: { p: Port | null; onSell?: (id: string, q: number) => void; busy?: string | false }) {
  if (!p) return null; if (!p.options.length) return <p className="mt-2 text-xs opacity-60">No open options.</p>;
  return <table className="mt-2 w-full text-[12px] tabular-nums"><thead className="opacity-70"><tr><th className="text-left">Option</th><th className="text-right">Strike · now</th><th className="text-right">Premium</th><th className="text-right">Value now</th><th className="text-right">Expires in</th>{onSell && <th className="text-right">Sell to close</th>}</tr></thead>
    <tbody>{p.options.map((o) => <tr key={o.id} className="border-t border-white/5" data-testid="stk-opt-row"><td><b>{o.ticker}</b> {o.kind} ×{o.qty}</td><td className="text-right">{o.strike.toFixed(2)} · {o.price?.toFixed(2)}</td><td className="text-right">{n(o.premium)}</td><td className={`text-right ${tone(o.mark - o.premium)}`}>{n(o.mark)}</td><td className="text-right">{o.hoursLeft}h</td>{onSell && <td className="text-right"><OptSell o={o} onSell={onSell} busy={busy} /></td>}</tr>)}</tbody></table>;
}

interface Port {
  stocks: { holdings: Array<{ ticker: string; name: string; shares: number; cost: number; price: number; value: number; pnl: number; pnlPct: number; lifePnl?: number; lifePct?: number }>; value: number; cost: number; pnl: number;
    lifetime?: Array<{ ticker: string; name: string; open: boolean; invested: number; sold: number; value: number; realized: number; pnl: number; pct: number }>;
    lifeTotal?: { invested: number; sold: number; value: number; realized: number; pnl: number; pct: number } };
  funds: Array<{ fund: string; name: string; kind: string; units: number; nav: number; value: number; cost: number; pnl: number }>;
  shorts: Array<{ id: string; ticker: string; shares: number; entry: number; price: number; collateral: number; equity: number; closeValue?: number; pnl: number; liqPrice: number }>;
  options: Array<{ id: string; ticker: string; kind: string; strike: number; qty: number; premium: number; price: number | null; mark: number; bid?: number; hoursLeft: number }>;
  history: { shorts: Array<{ id: string; ticker: string; shares: number; status: string; payout?: number | null; collateral: number; closedAt?: number | null }>; options: Array<{ id: string; ticker: string; kind: string; strike: number; qty: number; premium: number; status: string; payout?: number | null; settlePrice?: number | null }> };
  totals: { stocks: number; funds: number; shorts: number; options: number; all: number };
}
function Portfolio({ onPick }: { onPick: (t: string) => void }) {
  const account = useAccount(); const [p, setP] = useState<Port | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (account) void request('stk2_portfolio').then((r) => (r.ok ? setP(r as unknown as Port) : setErr(r.error ?? 'Could not load.'))); }, [account]);
  if (!account) return <p className="opacity-70">Sign in to see your portfolio.</p>;
  if (err) return <p className="text-rose-400">{err}</p>;
  if (!p) return <p className="opacity-60">Loading…</p>;
  const s = p.stocks;
  return (
    <div data-testid="stk-portfolio">
      <PortfolioChart />
      <Allocation t={p.totals} />
      <div className="mt-2" />
      <div className="mb-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
        <Card k="Total (Bank assets)" v={`🪙 ${n(p.totals.all)}`} title="Everything here counts toward your asset worth in the Bank, at market value" />
        <Card k="Stocks" v={`🪙 ${n(p.totals.stocks)}`} /><Card k="Funds" v={`🪙 ${n(p.totals.funds)}`} /><Card k="Short equity" v={`🪙 ${n(p.totals.shorts)}`} title="Collateral + unrealized P&L" /><Card k="Options (value)" v={`🪙 ${n(p.totals.options)}`} />
      </div>
      {s.lifeTotal && s.lifeTotal.invested > 0 && <div className="mb-2 rounded border border-white/10 p-2 text-xs" data-testid="stk-life-total" title="Lifetime return = (chips received from sells + current value of shares held − chips spent on buys, fees included) ÷ chips spent on buys">
        <span className="uppercase opacity-70">Lifetime stock return</span>{' '}
        <b className={`text-base ${tone(s.lifeTotal.pnl)}`}>{pc(s.lifeTotal.pct)}</b>{' '}
        <span className={tone(s.lifeTotal.pnl)}>({s.lifeTotal.pnl >= 0 ? '+' : ''}🪙 {n(s.lifeTotal.pnl)})</span>
        <span className="ml-2 opacity-70">invested 🪙 {n(s.lifeTotal.invested)} · realized <span className={tone(s.lifeTotal.realized)}>{s.lifeTotal.realized >= 0 ? '+' : ''}{n(s.lifeTotal.realized)}</span> · unrealized <span className={tone(s.pnl)}>{s.pnl >= 0 ? '+' : ''}{n(s.pnl)}</span></span>
      </div>}
      <p className="mb-1 flex flex-wrap gap-x-3 text-xs"><Term id="portfolio">Portfolio</Term><Term id="pnl">P&amp;L</Term><Term id="costBasis">Cost basis</Term></p>
      <h4 className="mt-2 text-xs uppercase opacity-70">Stocks <span className={`normal-case ${tone(s.pnl)}`}>P&amp;L {s.pnl >= 0 ? '+' : ''}{n(s.pnl)}</span></h4>
      {!s.holdings.length ? <p className="text-xs opacity-60">No stock yet.</p> : (
        <table className="w-full text-[12px] tabular-nums"><thead className="opacity-70"><tr><th className="text-left">Company</th><th className="text-right">Shares</th><th className="text-right">Price</th><th className="text-right">Value</th><th className="text-right">P&amp;L</th><th className="text-right" title="Sells + current value − buys, fees included, over everything you've ever traded in this stock">Lifetime</th></tr></thead>
          <tbody>{s.holdings.map((h) => <tr key={h.ticker} className="cursor-pointer border-t border-white/5 hover:bg-white/5" onClick={() => onPick(h.ticker)}><td><b>{h.ticker}</b> <span className="opacity-70">{h.name}</span></td><td className="text-right">{h.shares}</td><td className="text-right">{h.price.toFixed(2)}</td><td className="text-right">{n(h.value)}</td><td className={`text-right ${tone(h.pnl)}`}>{h.pnl >= 0 ? '+' : ''}{n(h.pnl)} ({pc(h.pnlPct)})</td><td className={`text-right ${tone(h.lifePnl ?? h.pnl)}`} data-testid="stk-life-row"><b>{pc(h.lifePct ?? h.pnlPct)}</b> <span className="opacity-80">({(h.lifePnl ?? h.pnl) >= 0 ? '+' : ''}{n(h.lifePnl ?? h.pnl)})</span></td></tr>)}</tbody></table>)}
      {(s.lifetime ?? []).some((x) => !x.open) && <>
        <h4 className="mt-3 text-xs uppercase opacity-70">Closed positions (lifetime)</h4>
        <table className="w-full text-[12px] tabular-nums"><tbody>{(s.lifetime ?? []).filter((x) => !x.open).map((x) => <tr key={x.ticker} className="border-t border-white/5" data-testid="stk-life-closed"><td><b>{x.ticker}</b> <span className="opacity-70">{x.name}</span></td><td className="text-right opacity-70">in 🪙 {n(x.invested)} · out 🪙 {n(x.sold)}</td><td className={`text-right ${tone(x.pnl)}`}><b>{pc(x.pct)}</b> ({x.pnl >= 0 ? '+' : ''}{n(x.pnl)})</td></tr>)}</tbody></table></>}
      <h4 className="mt-3 text-xs uppercase opacity-70">Funds</h4>
      {!p.funds.length ? <p className="text-xs opacity-60">No funds.</p> : (
        <table className="w-full text-[12px] tabular-nums"><tbody>{p.funds.map((f) => <tr key={f.fund} className="border-t border-white/5"><td><b>{f.fund}</b> <span className="opacity-70">{f.name}</span></td><td className="text-right">{f.units.toFixed(2)} u</td><td className="text-right">NAV {f.nav.toFixed(2)}</td><td className="text-right">🪙 {n(f.value)}</td><td className={`text-right ${tone(f.pnl)}`}>{f.pnl >= 0 ? '+' : ''}{n(f.pnl)}</td></tr>)}</tbody></table>)}
      <h4 className="mt-3 text-xs uppercase opacity-70">Shorts</h4><ShortTable p={p} />
      <h4 className="mt-3 text-xs uppercase opacity-70">Options</h4><OptTable p={p} />
      {(p.history.shorts.length > 0 || p.history.options.length > 0) && <>
        <h4 className="mt-3 text-xs uppercase opacity-70">Recently closed</h4>
        <ul className="space-y-0.5 text-[11px] opacity-80">{p.history.shorts.map((h) => <li key={h.id}>📉 {h.ticker} ×{h.shares} short {h.status} — returned 🪙 {n(h.payout ?? 0)}</li>)}{p.history.options.map((h) => <li key={h.id}>🎯 {h.ticker} {h.strike} {h.kind} ×{h.qty} {h.status} at {h.settlePrice?.toFixed(2)} — paid 🪙 {n(h.payout ?? 0)} (premium {n(h.premium)})</li>)}</ul></>}
    </div>
  );
}

/** QA r10: inline spinner on the money button whose request is pending (the button is disabled meanwhile). */
function Spin() { return <span className="world-spin mr-1" role="status" aria-label="Working…" data-testid="stk-spin" />; }

/** QA r12: the server answered a duplicate of an order that already went through; nothing new happened. */
const ALREADY = 'Already placed: that order went through once. Nothing new was traded.';

/* ---------------- MU #9 v2: brokerage-style sub-menus (display only; no prices, fees or odds change) ---------------- */
const Seg = <T extends string>({ v, opts, on, testid }: { v: T; opts: ReadonlyArray<readonly [T, string]>; on: (x: T) => void; testid: string }) => (
  <div className="stk-seg" role="group" data-testid={testid}>{opts.map(([k, l]) => <button key={k} type="button" className={v === k ? 'on' : ''} aria-pressed={v === k} onClick={() => on(k)} data-testid={`${testid}-${k}`}>{l}</button>)}</div>);

/** Chart tab: line or candlesticks, interval picker, volume bars. */
function ProChart({ ticker, pts, period, onPeriod, price }: { ticker: string; pts: Array<[number, number]>; period: Period; onPeriod: (p: Period) => void; price: number }) {
  const [mode, setMode] = useState<'candle' | 'line'>('candle'); const [iv, setIv] = useState<CandleInterval>(defaultInterval(period)); const [cs, setCs] = useState<Candle[] | null>(null);
  useEffect(() => setIv(defaultInterval(period)), [period]);
  useEffect(() => { if (mode !== 'candle') return; let live = true; const go = () => void request('stk4_candles', { ticker, range: period, interval: iv }).then((r) => { if (live && r.ok) setCs((r as unknown as { candles: Candle[] }).candles); }); go(); const t = setInterval(go, 60_000); return () => { live = false; clearInterval(t); }; }, [ticker, period, iv, mode]);
  return (
    <div data-testid="stk-prochart">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Seg v={mode} opts={[['candle', '🕯 Candles'], ['line', '〰 Line']]} on={setMode} testid="stk-mode" /><Info id={mode === 'candle' ? 'candle' : 'lineChart'} />
        {mode === 'candle' && <><Seg v={iv} opts={INTERVALS.map(([k, l]) => [k, l] as const)} on={setIv} testid="stk-iv" /><Info id="interval" /></>}
        {mode === 'candle' && <span className="ml-auto"><PeriodToggle value={period} onChange={onPeriod} testid="stk-cperiod" /></span>}
      </div>
      {mode === 'line' ? <InvestChart pts={pts} period={period} onPeriod={onPeriod} value={price} testid="stk-chart" height={220} />
        : !cs ? <p className="text-xs opacity-60">Loading candles…</p> : <CandleChart candles={cs} long={period !== '1d'} />}
      {mode === 'candle' && <p className="mt-2 flex flex-wrap gap-x-3 text-[11px] opacity-80"><span className="text-emerald-400">▮ green = closed higher</span><span className="text-rose-400">▮ red = closed lower</span><Term id="ohlc">O H L C</Term><Term id="volBars">Volume bars</Term></p>}
    </div>
  );
}

/** Options chain: every strike × expiry with the estimated premium, from the same shared formula the server quotes with. Tap a cell to prefill the Options ticket. */
function OptionChain({ ticker, price, onPick }: { ticker: string; price: number; onPick: (o: OptPrefill) => void }) {
  const [days, setDays] = useState<number>(OPT_EXPIRIES[0]!); const meta = COMPANY_BY_TICKER.get(ticker)!; const QTY = 10;
  return (
    <div data-testid="stk-chain">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs"><span className="opacity-70">Expires in</span><Seg v={String(days)} opts={OPT_EXPIRIES.map((x) => [String(x), `${x}d`] as const)} on={(x) => setDays(Number(x))} testid="stk-chain-exp" /><Info id="expiry" /><span className="ml-auto opacity-70">Premium for {QTY} contracts <Info id="contract" /></span></div>
      <table className="stk-chain w-full text-[12px] tabular-nums">
        <thead className="opacity-70"><tr><th className="text-right"><Term id="call">Calls 📈</Term></th><th className="text-right">Call breakeven</th><th className="text-center"><Term id="strike">Strike</Term></th><th className="text-left">Put breakeven</th><th className="text-left"><Term id="put">Puts 📉</Term></th></tr></thead>
        <tbody>{OPT_STRIKES.map((o) => { const K = strikeFor(price, o); const cp = optionPremium(meta, 'call', price, K, days, QTY), pp = optionPremium(meta, 'put', price, K, days, QTY); return (
          <tr key={o} className="border-t border-white/5" data-testid="stk-chain-row">
            <td className={`text-right ${K < price ? 'itm' : ''}`}><button type="button" onClick={() => onPick({ ticker, kind: 'call', off: o, days })} data-testid="stk-chain-call">🪙 {n(cp)}</button></td>
            <td className={`text-right opacity-70 ${K < price ? 'itm' : ''}`}>{(K + cp / QTY).toFixed(2)}</td>
            <td className="text-center font-bold">{K.toFixed(2)}<div className="text-[10px] font-normal opacity-60">{o === 0 ? 'at the money' : `${o > 0 ? '+' : ''}${o * 100}%`}</div></td>
            <td className={`opacity-70 ${K > price ? 'itm' : ''}`}>{(K - pp / QTY).toFixed(2)}</td>
            <td className={K > price ? 'itm' : ''}><button type="button" className="text-left" onClick={() => onPick({ ticker, kind: 'put', off: o, days })} data-testid="stk-chain-put">🪙 {n(pp)}</button></td>
          </tr>); })}</tbody>
      </table>
      <p className="mt-2 text-[11px] opacity-70">Shaded = <Term id="itm">in the money</Term> right now. Prices are estimates; the Options tab shows the exact quote before you buy. Tap a premium to open that ticket.</p>
    </div>
  );
}

function Dividends({ c, stats, mine }: { c: Row; stats?: KeyStats; mine: number }) {
  const y = c.divYield ?? 0; const per = c.price * y;
  if (!y) return <div className="ivx-card" data-testid="stk-divs"><b>No dividend</b><p className="mt-1 text-xs opacity-75">{c.ticker} is a <Term id="growth">growth company</Term>: it keeps its profits to grow instead of paying holders.</p></div>;
  return (
    <div data-testid="stk-divs">
      <div className="ivx-stats">
        <div className="ivx-stat"><div className="ivx-k ivx-k-i">Yield / day <Info id="yield" /></div><div className="ivx-v">{(y * 100).toFixed(2)}%</div></div>
        <div className="ivx-stat"><div className="ivx-k ivx-k-i">Per share / day <Info id="dividend" /></div><div className="ivx-v">🪙 {(stats?.divPerShare ?? per).toFixed(2)}</div></div>
        <div className="ivx-stat"><div className="ivx-k">Paid at</div><div className="ivx-v">{DIV_HOUR_UTC}:00 UTC daily</div></div>
        <div className="ivx-stat"><div className="ivx-k">Your shares</div><div className="ivx-v">{mine.toLocaleString()}</div></div>
      </div>
      <div className="ivx-card mt-2 text-xs">{mine > 0 ? <>At today's price your {plural(mine, 'share pays', 'shares pay')} about <b>🪙 {n(mine * per)}</b> per day.</> : <>Own 100 shares and you'd get about <b>🪙 {n(100 * per)}</b> per day at today's price.</>} <span className="opacity-60">Estimate: the payout follows the price at payout time.</span></div>
    </div>
  );
}

function Holders({ ticker, playerPct }: { ticker: string; playerPct: number }) {
  const [h, setH] = useState<{ count: number; holders: Array<{ name: string; shares: number; pct: number }> } | null>(null);
  useEffect(() => { void request('stk4_holders', { ticker }).then((r) => r.ok && setH(r as never)); }, [ticker]);
  return (
    <div data-testid="stk-holders">
      <h4 className="flex items-center gap-1 text-xs uppercase tracking-wide opacity-70">Top holders <Info id="holders" /></h4>
      <p className="mb-1 text-[11px] opacity-60">{playerPct.toFixed(2)}% held by players{h ? ` · ${h.count} holder${h.count === 1 ? '' : 's'}` : ''}; the rest is offshore.</p>
      {!h ? <p className="text-xs opacity-60">Loading…</p> : !h.holders.length ? <p className="text-xs opacity-60">No player holds {ticker} yet.</p> : (
        <table className="w-full text-[12px] tabular-nums"><thead className="opacity-60"><tr><th className="text-left">#</th><th className="text-left">Player</th><th className="text-right">Shares</th><th className="text-right">% of company</th></tr></thead>
          <tbody>{h.holders.map((x, i) => <tr key={x.name} className="border-t border-white/5" data-testid="stk-holder-row"><td className="opacity-60">{i + 1}</td><td className="max-w-[10rem] truncate">{x.name}</td><td className="text-right">{x.shares.toLocaleString()}</td><td className="text-right">{x.pct.toFixed(2)}%</td></tr>)}</tbody></table>)}
    </div>
  );
}

const Mini = ({ c, onPick }: { c: Row; onPick: (t: string) => void }) => (
  <button type="button" className="ivx-stat w-full text-left hover:bg-white/10" onClick={() => onPick(c.ticker)} data-testid={`stk-mini-${c.ticker}`}>
    <div className="flex items-center justify-between"><b>{c.ticker}</b><span className={tone(c.chg)}>{pc(c.chg)}</span></div>
    <div className="truncate text-[11px] opacity-60">{c.name}</div><div className="tabular-nums">{c.price.toFixed(2)}</div>
  </button>);

/** Markets home: totals, sector heat, top movers, latest headlines. */
function MarketsOverview({ data, onPick, onTab }: { data: ListResp; onPick: (t: string) => void; onTab: (v: View) => void }) {
  const cs = data.companies; const up = cs.filter((c) => c.chg > 0).length, down = cs.filter((c) => c.chg < 0).length;
  const capW = cs.reduce((a, c) => a + c.cap, 0) || 1; const mkt = cs.reduce((a, c) => a + c.chg * c.cap, 0) / capW;
  const bySec = data.sectors.map((s) => { const xs = cs.filter((c) => c.sector === s.id); const w = xs.reduce((a, c) => a + c.cap, 0) || 1; return { s, n: xs.length, chg: xs.reduce((a, c) => a + c.chg * c.cap, 0) / w }; }).filter((x) => x.n);
  const sorted = [...cs].sort((a, b) => b.chg - a.chg);
  return (
    <div data-testid="stk-overview">
      <div className="mb-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Card k="Whole market (24h)" v={pc(mkt)} cls={tone(mkt)} title="Every company's 24h move, weighted by market cap" />
        <Card k="Market cap" v={`🪙 ${compact(data.totals.cap)}`} /><Card k="Up / down" v={`${up} ▲ · ${down} ▼`} />
        <Card k="Chip inflation drift" v={data.drift.inflPct == null ? '—' : `${pc(data.drift.inflPct)}/day`} />
      </div>
      <p className="mb-2 flex flex-wrap gap-x-3 text-xs"><Term id="index">Whole market</Term><Term id="cap">Market cap</Term><Term id="trend">Drift</Term><Term id="sector">Sectors</Term></p>
      <h4 className="mb-1 text-xs uppercase tracking-wide opacity-70">Sectors today</h4>
      <div className="mb-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4" data-testid="stk-heat">{bySec.map(({ s, n: k, chg }) => <div key={s.id} className="rounded p-2 text-xs" style={{ background: chg >= 0 ? `rgba(34,197,94,${Math.min(0.45, 0.08 + Math.abs(chg) / 10)})` : `rgba(244,63,94,${Math.min(0.45, 0.08 + Math.abs(chg) / 10)})` }}><div className="truncate">{s.icon} {s.label}</div><b>{pc(chg)}</b> <span className="opacity-60">· {k}</span></div>)}</div>
      <div className="mb-1 flex items-center"><h4 className="text-xs uppercase tracking-wide opacity-70">Top gainers</h4><button type="button" className="ml-auto text-[11px] opacity-70 hover:opacity-100" onClick={() => onTab('movers')}>All movers →</button></div>
      <div className="mb-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">{sorted.slice(0, 4).map((c) => <Mini key={c.ticker} c={c} onPick={onPick} />)}</div>
      <h4 className="mb-1 text-xs uppercase tracking-wide opacity-70">Top losers</h4>
      <div className="mb-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">{sorted.slice(-4).reverse().map((c) => <Mini key={c.ticker} c={c} onPick={onPick} />)}</div>
      <div className="mb-1 flex items-center"><h4 className="text-xs uppercase tracking-wide opacity-70">Headlines</h4><button type="button" className="ml-auto text-[11px] opacity-70 hover:opacity-100" onClick={() => onTab('news')}>All news →</button></div>
      <NewsFeed news={data.news.slice(0, 5)} onPick={onPick} />
    </div>
  );
}

function MoverTable({ rows, onPick, testid }: { rows: Row[]; onPick: (t: string) => void; testid: string }) {
  return <table className="w-full text-[12px] tabular-nums" data-testid={testid}><thead className="opacity-60"><tr><th className="w-5" /><th className="text-left">Company</th><th className="text-right">Price</th><th className="text-right"><Term id="chg24">24h</Term></th><th className="text-right"><Term id="volume">Volume</Term></th></tr></thead>
    <tbody>{rows.map((c) => <tr key={c.ticker} className="cursor-pointer border-t border-white/5 hover:bg-white/5" onClick={() => onPick(c.ticker)} data-testid={`stk-row-${c.ticker}`}><td><Star t={c.ticker} /></td><td><b>{c.ticker}</b> <span className="opacity-70">{c.name}</span></td><td className="text-right">{c.price.toFixed(2)}</td><td className={`text-right ${tone(c.chg)}`}>{pc(c.chg)}</td><td className="text-right">{n(c.volume)}</td></tr>)}</tbody></table>;
}
function Movers({ data, onPick }: { data: ListResp; onPick: (t: string) => void }) {
  const [k, setK] = useState<'gain' | 'lose' | 'active'>('gain'); const cs = [...data.companies];
  const rows = k === 'gain' ? cs.filter((c) => c.chg > 0).sort((a, b) => b.chg - a.chg) : k === 'lose' ? cs.filter((c) => c.chg < 0).sort((a, b) => a.chg - b.chg) : cs.sort((a, b) => b.volume - a.volume);
  return <div data-testid="stk-movers"><div className="mb-2 flex items-center gap-2"><Seg v={k} opts={[['gain', '▲ Gainers'], ['lose', '▼ Losers'], ['active', '🔥 Most active']]} on={setK} testid="stk-mv" /><Info id="movers" /></div>
    {rows.length ? <MoverTable rows={rows.slice(0, 15)} onPick={onPick} testid="stk-mv-table" /> : <p className="text-xs opacity-60">Nothing here right now.</p>}</div>;
}
function Watchlist({ data, onPick }: { data: ListResp; onPick: (t: string) => void }) {
  const w = useWatch(); const rows = data.companies.filter((c) => w.has(c.ticker));
  return <div data-testid="stk-watch"><p className="mb-2 flex items-center gap-1 text-xs opacity-75">Tap ☆ next to any stock to follow it here. Saved on this device. <Info id="watchlist" /></p>
    {rows.length ? <MoverTable rows={rows} onPick={onPick} testid="stk-watch-table" /> : <p className="rounded bg-white/5 p-4 text-center text-xs opacity-70">Your watchlist is empty. Star a stock from Stocks, Movers or a company page.</p>}</div>;
}
function Screener({ data, onPick }: { data: ListResp; onPick: (t: string) => void }) {
  const [sector, setSector] = useState(''); const [peMax, setPeMax] = useState(''); const [yMin, setYMin] = useState(''); const [chg, setChg] = useState<'any' | 'up' | 'down'>('any'); const [owned, setOwned] = useState(false);
  const rows = data.companies.map((c) => ({ ...c, pe: peOf(c) })).filter((c) => (!sector || c.sector === sector) && (!peMax || (c.pe != null && c.pe <= Number(peMax))) && (!yMin || (c.divYield ?? 0) * 100 >= Number(yMin)) && (chg === 'any' || (chg === 'up' ? c.chg > 0 : c.chg < 0)) && (!owned || c.held > 0)).sort((a, b) => b.cap - a.cap);
  const inp = 'w-20 rounded bg-black/30 px-2 py-1';
  return (
    <div data-testid="stk-screener">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <select className="rounded bg-black/30 px-2 py-1" value={sector} onChange={(e) => setSector(e.target.value)} data-testid="stk-scr-sector"><option value="">All sectors</option>{data.sectors.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}</select>
        <label className="inline-flex items-center gap-1">P/E ≤ <input className={inp} inputMode="decimal" value={peMax} onChange={(e) => setPeMax(e.target.value.replace(/[^\d.]/g, ''))} placeholder="any" data-testid="stk-scr-pe" /><Info id="pe" /></label>
        <label className="inline-flex items-center gap-1">Yield ≥ <input className={inp} inputMode="decimal" value={yMin} onChange={(e) => setYMin(e.target.value.replace(/[^\d.]/g, ''))} placeholder="%/day" data-testid="stk-scr-yield" /><Info id="yield" /></label>
        <Seg v={chg} opts={[['any', 'Any'], ['up', '▲ Up'], ['down', '▼ Down']]} on={setChg} testid="stk-scr-chg" />
        <label className="inline-flex items-center gap-1"><input type="checkbox" checked={owned} onChange={(e) => setOwned(e.target.checked)} /> Players hold it</label>
        <Info id="screener" />
      </div>
      <p className="mb-1 text-[11px] opacity-60">{rows.length} match{rows.length === 1 ? '' : 'es'}</p>
      <table className="w-full text-[12px] tabular-nums" data-testid="stk-scr-table"><thead className="opacity-60"><tr><th className="w-5" /><th className="text-left">Company</th><th className="text-right">Price</th><th className="text-right">24h</th><th className="text-right"><Term id="pe">P/E</Term></th><th className="text-right"><Term id="yield">Yield/day</Term></th><th className="text-right"><Term id="cap">Mkt cap</Term></th></tr></thead>
        <tbody>{rows.map((c) => <tr key={c.ticker} className="cursor-pointer border-t border-white/5 hover:bg-white/5" onClick={() => onPick(c.ticker)} data-testid={`stk-scr-${c.ticker}`}><td><Star t={c.ticker} /></td><td><b>{c.ticker}</b> <span className="opacity-70">{c.name}</span></td><td className="text-right">{c.price.toFixed(2)}</td><td className={`text-right ${tone(c.chg)}`}>{pc(c.chg)}</td><td className="text-right">{c.pe == null ? '—' : c.pe.toFixed(1)}</td><td className="text-right">{c.divYield ? `${(c.divYield * 100).toFixed(2)}%` : '—'}</td><td className="text-right">{compact(c.cap)}</td></tr>)}</tbody></table>
    </div>
  );
}
function Orders({ onPick }: { onPick: (t: string) => void }) {
  const account = useAccount(); const [o, setO] = useState<Array<{ id: string; ticker: string; side: string; shares: number; price: number; chips: number; fee: number; at: number }> | null>(null);
  useEffect(() => { if (account) void request('stk4_orders', { limit: 100 }).then((r) => r.ok && setO((r as unknown as { orders: NonNullable<typeof o> }).orders)); }, [account]);
  if (!account) return <p className="opacity-70">Sign in to see your order history.</p>;
  return (
    <div data-testid="stk-orders">
      <p className="mb-2 flex items-center gap-1 text-xs opacity-75">Every stock buy and sell you've made, newest first. <Info id="order" /></p>
      {!o ? <p className="text-xs opacity-60">Loading…</p> : !o.length ? <p className="text-xs opacity-60">No orders yet.</p> : (
        <table className="w-full text-[12px] tabular-nums"><thead className="opacity-60"><tr><th className="text-left">Time</th><th className="text-left">Side</th><th className="text-left">Stock</th><th className="text-right">Shares</th><th className="text-right">Fill</th><th className="text-right"><Term id="fee">Fee</Term></th><th className="text-right">Chips</th></tr></thead>
          <tbody>{o.map((x) => <tr key={x.id} className="border-t border-white/5" data-testid="stk-order-row"><td className="whitespace-nowrap opacity-70">{cst(x.at)}</td><td><span className={`rounded px-1 font-semibold ${x.side === 'buy' ? 'bg-emerald-700' : 'bg-rose-700'}`}>{x.side.toUpperCase()}</span></td><td><button type="button" className="font-bold hover:underline" onClick={() => onPick(x.ticker)}>{x.ticker}</button></td><td className="text-right">{x.shares.toLocaleString()}</td><td className="text-right">{x.price.toFixed(2)}</td><td className="text-right">{n(x.fee)}</td><td className="text-right">🪙 {n(x.chips)}</td></tr>)}</tbody></table>)}
    </div>
  );
}
