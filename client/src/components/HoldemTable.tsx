import { Fragment, useEffect, useState } from 'react';
import { TurnTimerBar } from './TurnTimerBar';
import { at, Chips, dealStyle, FeltTable } from '@/components/FeltTable';
import { blindSeats, ovalSeatPositions, towardCentre } from '@/lib/tableLayout';
import { CardFace } from '@/components/SolitairePanel';
import { emitCasino, useCountdown } from '@/lib/casino';
import { socket } from '@/lib/net';
import { playCardFlick, playSolitaireWin } from '@/lib/sounds';
import { heStakes, HE_SEATS, HE_SPECTATE_DELAY_MS, HE_STAKES, type HEStakes, type HEStakesId, type HESpectateView, type HEView } from '../../../shared/holdem';

interface TableInfo { id: string; stakes?: HEStakesId; seated: number; phase: string; watchers: number }

const k = (n: number) => (n >= 1000 && n % 1000 === 0 ? `${n / 1000}K` : n.toLocaleString());
/** Lobby label for a tier, e.g. "High Stakes 5K · blinds 25/50 · buy-in 5K". */
export const stakesLabel = (t: HEStakes) => `${t.label} · blinds ${t.small}/${t.big} · buy-in ${t.minBuyIn === t.maxBuyIn ? k(t.minBuyIn) : `${k(t.minBuyIn)}–${k(t.maxBuyIn)}`}`;

const PHASE: Record<HEView['phase'], string> = { waiting: 'Waiting for players', preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' };

/** Live multiplayer No-Limit Hold'em table. The server deals; you only ever receive your own hole cards. */
export function HoldemTableView({ name }: { name: string }) {
  const [v, setV] = useState<HEView | null>(null);
  const [buyIn, setBuyIn] = useState(500);
  const [pick, setPick] = useState<HEStakesId>(() => heStakes(localStorage.getItem('relay-he-stakes')).id);
  useEffect(() => { localStorage.setItem('relay-he-stakes', pick); }, [pick]);
  useEffect(() => {
    const on = (e: Event) => setPick(heStakes((e as CustomEvent).detail).id);
    window.addEventListener('open-high-stakes-holdem', on);
    return () => window.removeEventListener('open-high-stakes-holdem', on);
  }, []);
  const [raise, setRaise] = useState(0);
  const [err, setErr] = useState('');
  const [spec, setSpec] = useState<{ table: string; delayMs: number; view: HESpectateView | null } | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  useEffect(() => {
    const on = (s: HEView | null) => setV(s);
    const onSpec = (s: HESpectateView | null) => setSpec((p) => (p ? { ...p, view: s } : p));
    const onEnd = (e: { reason: string }) => { setSpec(null); setErr(e.reason); };
    socket.on('he_spectate', onSpec);
    socket.on('he_spectate_end', onEnd);
    socket.on('he_state', on);
    void emitCasino<{ state: HEView | null }>('he_watch').then((r) => r.ok && setV(r.state ?? null));
    return () => { socket.off('he_state', on); socket.off('he_spectate', onSpec); socket.off('he_spectate_end', onEnd); void emitCasino('he_unspectate'); void emitCasino('he_unwatch'); };
  }, [name]);
  const seatedNow = v?.you != null;
  useEffect(() => {
    if (seatedNow) return;
    const load = () => void emitCasino<{ tables: TableInfo[] }>('he_tables').then((r) => r.ok && setTables(r.tables ?? []));
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [seatedNow]);
  const spectate = async (table: string) => {
    setErr('');
    const r = await emitCasino<{ state: HESpectateView | null; delayMs: number }>('he_spectate', { table });
    if (!r.ok) return setErr(r.error ?? 'Try again.');
    setSpec({ table, delayMs: r.delayMs ?? HE_SPECTATE_DELAY_MS, view: r.state ?? null });
  };
  const stopSpec = () => { setSpec(null); void emitCasino('he_unspectate'); };
  const hand = v?.handNo ?? 0;
  useEffect(() => { if (hand) playCardFlick(); }, [hand]);
  const myTurn = v?.options != null;
  useEffect(() => { if (v?.options) setRaise(v.options.minRaiseTo); }, [myTurn, v?.currentBet]); // eslint-disable-line react-hooks/exhaustive-deps
  const won = v?.phase === 'showdown' && v.winners.some((w) => w.name === name);
  useEffect(() => { if (won) playSolitaireWin(); }, [won, hand]);
  const secs = useCountdown(v?.deadline ?? null, v?.serverNow);

  // Full-screen mode (#34, Liam): the table fills the window (and the real screen when the browser allows it).
  const [full, setFull] = useState(false);
  const toggleFull = () => {
    const next = !full; setFull(next);
    try {
      if (next && document.fullscreenEnabled && !document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => {});
      if (!next && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    } catch { /* overlay mode still works */ }
  };
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    const onFs = () => { if (!document.fullscreenElement) setFull(false); };
    window.addEventListener('keydown', onKey); document.addEventListener('fullscreenchange', onFs);
    document.body.classList.add('he-full-open');
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFs); document.body.classList.remove('he-full-open'); };
  }, [full]);

  const send = async (event: string, payload: unknown = {}) => {
    setErr('');
    const r = await emitCasino<{ state: HEView | null }>(event, payload);
    if (!r.ok) return setErr(r.error ?? 'Try again.');
    if ('state' in r) setV(r.state ?? null);
  };
  if (spec) return <SpectateView spec={spec} onStop={stopSpec} />;
  const o = v?.options;
  const seated = v?.you != null;
  const cur = heStakes(seated ? v?.stakes : pick);
  const tierOf = (t: { stakes?: HEStakesId }) => heStakes(t.stakes);
  return (
    <div className={`bj-table he-table${full ? ' he-full' : ''}`} data-testid="holdem">
      <button type="button" className="he-full-btn" onClick={toggleFull} data-testid="he-fullscreen" aria-pressed={full} title={full ? 'Exit full screen (Esc)' : 'Full screen'}>{full ? '✕ Exit full screen' : '⛶ Full screen'}</button>
      <div className="bj-status" data-testid="he-status">
        {!v || (!seated && v.phase === 'waiting') ? `No-Limit Hold'em · ${stakesLabel(cur)} · 2–6 players` : v.phase === 'showdown'
          ? v.winners.map((w) => `${w.name} wins ${w.amount} (${w.hand})`).join(' · ')
          : `${v.id} · ${heStakes(v.stakes).label} ${heStakes(v.stakes).small}/${heStakes(v.stakes).big} · ${PHASE[v.phase]}${v.pot ? ` · pot ${v.pot}` : ''}${secs !== null && v.toAct !== null ? ` · ${v.seats[v.toAct]?.name ?? ''} ${secs}s` : ''}`}
      </div>
      {v && v.phase !== 'showdown' && v.toAct !== null && <TurnTimerBar deadline={v.deadline} serverNow={v.serverNow} testId="he-timer" />}
      <HoldemFelt v={v} />
      {seated && o && (
        <div className="bj-controls he-controls">
          <button type="button" onClick={() => void send('he_action', { action: 'fold' })} data-testid="he-fold">Fold</button>
          {o.check
            ? <button type="button" onClick={() => void send('he_action', { action: 'check' })} data-testid="he-check">Check</button>
            : <button type="button" onClick={() => void send('he_action', { action: 'call' })} data-testid="he-call">Call {o.call}</button>}
          {o.raise && (
            <>
              <input type="range" min={o.minRaiseTo} max={o.maxRaiseTo} step={heStakes(v?.stakes).small} value={raise} onChange={(e) => setRaise(Number(e.target.value))} aria-label="Raise to" />
              <button type="button" className="bj-deal" onClick={() => void send('he_action', raise >= o.maxRaiseTo ? { action: 'allin' } : { action: 'raise', amount: raise })} data-testid="he-raise">
                {raise >= o.maxRaiseTo ? `All-in ${o.maxRaiseTo}` : `${v!.currentBet ? 'Raise to' : 'Bet'} ${raise}`}
              </button>
            </>
          )}
        </div>
      )}
      {seated && !o && <div className="bj-label">{v?.phase === 'waiting' ? 'Waiting for another player…' : v?.phase === 'showdown' ? 'Next hand in a moment…' : 'Waiting for your turn.'}</div>}
      <div className="bj-controls">
        {seated
          ? <button type="button" onClick={() => void send('he_leave')} data-testid="he-leave">Stand up & cash out</button>
          : (
            <>
              <div className="he-stakes" role="radiogroup" aria-label="Table stakes" data-testid="he-stakes">
                {HE_STAKES.map((t) => (
                  <button type="button" key={t.id} role="radio" aria-checked={pick === t.id} className={`he-stake ${pick === t.id ? 'on' : ''} ${t.id === 'classic' ? '' : 'high'}`} onClick={() => setPick(t.id)} data-testid={`he-stakes-${t.id}`}>
                    <b>{t.label}</b><span>Blinds {t.small}/{t.big}</span><span>Buy-in {t.minBuyIn === t.maxBuyIn ? t.minBuyIn.toLocaleString() : `${t.minBuyIn}–${t.maxBuyIn}`}</span>
                  </button>
                ))}
              </div>
              {cur.minBuyIn !== cur.maxBuyIn && <label className="bj-label">Buy-in <input type="number" min={cur.minBuyIn} max={cur.maxBuyIn} step={50} value={buyIn} onChange={(e) => setBuyIn(Number(e.target.value))} className="he-buyin" /></label>}
              <button type="button" className="bj-deal" onClick={() => void send('he_sit', { buyIn: cur.minBuyIn === cur.maxBuyIn ? cur.minBuyIn : buyIn, stakes: cur.id })} data-testid="he-sit">Sit down · {cur.label}</button>
            </>
          )}
      </div>
      {v?.watchers ? <div className="bj-label he-watchers" data-testid="he-watchers">👁 {v.watchers} watching (delayed feed)</div> : null}
      {!seated && tables.length > 0 && (
        <div className="he-spec-list" data-testid="he-tables">
          <span className="bj-label">Spectate (see every hand):</span>
          {tables.map((t) => (
            <button type="button" key={t.id} onClick={() => void spectate(t.id)} data-testid={`he-spectate-${t.id}`}>
              Watch {t.id} · {tierOf(t).label} {tierOf(t).small}/{tierOf(t).big} · {t.seated} seated · 👁 {t.watchers}
            </button>
          ))}
        </div>
      )}
      {err && <div className="account-error">{err}</div>}
    </div>
  );
}

function SpectateView({ spec, onStop }: { spec: { table: string; delayMs: number; view: HESpectateView | null }; onStop: () => void }) {
  const v = spec.view;
  const secs = Math.round(spec.delayMs / 1000);
  return (
    <div className="bj-table he-table he-spectating" data-testid="he-spectate-view">
      <div className="bj-status" data-testid="he-status">
        <span className="he-live">SPECTATING {spec.table}</span> · {secs}s delay · 👁 <span data-testid="he-watchers">{v?.watchers ?? 1}</span> watching
        {v && <> · {v.phase === 'showdown' ? v.winners.map((w) => `${w.name} wins ${w.amount} (${w.hand})`).join(' · ') : `${PHASE[v.phase]}${v.pot ? ` · pot ${v.pot}` : ''}`}</>}
      </div>
      {!v ? <div className="bj-label" data-testid="he-spec-wait">Feed starts in {secs}s (spectators are delayed so nobody can relay hands to a seat).</div> : (
        <>
          <HoldemFelt v={v} odds={v.odds} />
        </>
      )}
      <div className="bj-controls"><button type="button" onClick={onStop} data-testid="he-stop-spectate">Stop watching</button></div>
    </div>
  );
}

const DECK = { x: 74, y: 36 };
const CENTRE = { x: 50, y: 50 };

/** The felt: oval table, seats round the rail, board + pot in the middle, D / SB / BB markers. */
function HoldemFelt({ v, odds }: { v: HEView | null; odds?: Record<number, number> }) {
  const seats = v?.seats ?? (Array(HE_SEATS).fill(null) as HEView['seats']);
  const blinds = v && v.phase !== 'waiting' ? blindSeats(seats, v.button) : null;
  const pos = ovalSeatPositions(seats.length);
  const potInFront = (v?.pot ?? 0) - seats.reduce((a, s) => a + (s?.bet ?? 0), 0);
  return (
    <FeltTable kind="he" testId="he-felt">{(aspect) => (
      <>
        <div className="felt-logo" aria-hidden="true">CHUD HUB · NO-LIMIT HOLD'EM</div>
        <div className="felt-deck" style={at(DECK)} aria-hidden="true"><span /></div>
        <div className="felt-board" style={at({ x: 50, y: 47 })}>
          {[0, 1, 2, 3, 4].map((k) => {
            const c = v?.board[k];
            return c ? <div key={c.id} className="felt-card board deal-in" style={dealStyle(DECK, { x: 50, y: 47 }, aspect, k < 3 ? k : 0)}><CardFace card={c} /></div> : <div key={`e${k}`} className="felt-card board slot" />;
          })}
        </div>
        <div className="felt-pot" style={at({ x: 50, y: 62 })} data-testid="he-pot">
          {potInFront > 0 ? <Chips key={potInFront} amount={potInFront} label={`Pot ${(v?.pot ?? 0).toLocaleString()}`} /> : v?.pot ? <span className="felt-chip-amt">Pot {v.pot}</span> : !v || v.phase === 'waiting' ? <span className="felt-sub">Hand starts when two players sit.</span> : null}
        </div>
        {seats.map((s, i) => {
          const p = pos[i]!;
          const betAt = towardCentre(p, 0.42, CENTRE);
          const btnAt = towardCentre({ x: p.x + (p.x < 50 ? 7 : -7), y: p.y }, 0.3, CENTRE);
          const blind = blinds?.sb === i ? 'SB' : blinds?.bb === i ? 'BB' : null;
          return (
            <Fragment key={i}>
              {s && s.bet > 0 && <div className="felt-betspot he" style={at(betAt)}><Chips key={s.bet} amount={s.bet} from={p} to={betAt} aspect={aspect} /></div>}
              {v?.button === i && s && <div className="felt-dbtn" style={at(btnAt)} data-testid="he-dealer-btn">D</div>}
              {blind && <div className={`felt-blind ${blind.toLowerCase()}`} style={at(towardCentre(btnAt, -0.08, CENTRE), { marginTop: v?.button === i ? '4.2cqw' : 0 })} data-testid={`he-${blind.toLowerCase()}`}>{blind}</div>}
              <div className={`felt-seat he ${s?.you ? 'me' : ''} ${v?.toAct === i ? 'turn' : ''} ${s?.folded ? 'folded' : ''} ${s ? '' : 'empty'}`} style={at(p)} data-testid={`he-seat-${i}`}>
                {s && (
                  <div className="felt-hand sm">
                    {s.cards.map((c, k) => <div key={`${v?.handNo}-${k}`} className="felt-card deal-in" style={dealStyle(DECK, p, aspect, k * seats.length + i)}>{c ? <CardFace card={c} /> : <div className="sol-card sol-back" />}</div>)}
                  </div>
                )}
                <div className="felt-plate">
                  {s ? <><b>{s.name}</b><span>🪙{s.stack.toLocaleString()}</span></> : <span className="opacity-60">Open seat</span>}
                  {s?.lastAction && <span className="felt-sub act">{s.lastAction}</span>}
                  {odds?.[i] !== undefined && <span className="he-odds" data-testid={`he-odds-${i}`}>{Math.round(odds[i]! * 100)}% to win</span>}
                </div>
              </div>
            </Fragment>
          );
        })}
      </>
    )}</FeltTable>
  );
}
