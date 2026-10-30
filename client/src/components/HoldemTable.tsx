import { useEffect, useState } from 'react';
import { CardFace } from '@/components/SolitairePanel';
import { emitCasino, useCountdown } from '@/lib/casino';
import { socket } from '@/lib/net';
import { playCardFlick, playSolitaireWin } from '@/lib/sounds';
import { HE_BIG, HE_MAX_BUYIN, HE_MIN_BUYIN, HE_SMALL, type HEView } from '../../../shared/holdem';

const PHASE: Record<HEView['phase'], string> = { waiting: 'Waiting for players', preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' };

/** Live multiplayer No-Limit Hold'em table. The server deals; you only ever receive your own hole cards. */
export function HoldemTableView({ name }: { name: string }) {
  const [v, setV] = useState<HEView | null>(null);
  const [buyIn, setBuyIn] = useState(500);
  const [raise, setRaise] = useState(0);
  const [err, setErr] = useState('');
  useEffect(() => {
    const on = (s: HEView | null) => setV(s);
    socket.on('he_state', on);
    void emitCasino<{ state: HEView | null }>('he_watch').then((r) => r.ok && setV(r.state ?? null));
    return () => { socket.off('he_state', on); void emitCasino('he_unwatch'); };
  }, [name]);
  const hand = v?.handNo ?? 0;
  useEffect(() => { if (hand) playCardFlick(); }, [hand]);
  const myTurn = v?.options != null;
  useEffect(() => { if (v?.options) setRaise(v.options.minRaiseTo); }, [myTurn, v?.currentBet]); // eslint-disable-line react-hooks/exhaustive-deps
  const won = v?.phase === 'showdown' && v.winners.some((w) => w.name === name);
  useEffect(() => { if (won) playSolitaireWin(); }, [won, hand]);
  const secs = useCountdown(v?.deadline ?? null, v?.serverNow);

  const send = async (event: string, payload: unknown = {}) => {
    setErr('');
    const r = await emitCasino<{ state: HEView | null }>(event, payload);
    if (!r.ok) return setErr(r.error ?? 'Try again.');
    if ('state' in r) setV(r.state ?? null);
  };
  const o = v?.options;
  const seated = v?.you != null;
  return (
    <div className="bj-table he-table" data-testid="holdem">
      <div className="bj-status" data-testid="he-status">
        {!v ? `No-Limit Hold'em · blinds ${HE_SMALL}/${HE_BIG} · 2–6 players` : v.phase === 'showdown'
          ? v.winners.map((w) => `${w.name} wins ${w.amount} (${w.hand})`).join(' · ')
          : `${v.id} · ${PHASE[v.phase]}${v.pot ? ` · pot ${v.pot}` : ''}${secs !== null && v.toAct !== null ? ` · ${v.seats[v.toAct]?.name ?? ''} ${secs}s` : ''}`}
      </div>
      <div className="he-board">
        {(v?.board ?? []).map((c) => <span className="he-card" key={c.id}><CardFace card={c} /></span>)}
        {(!v || v.board.length === 0) && <span className="bj-label">{v?.phase === 'waiting' || !v ? 'Hand starts when two players sit.' : ''}</span>}
      </div>
      <div className="he-seats">
        {(v?.seats ?? (Array(6).fill(null) as HEView["seats"])).map((s, i) => (
          <div key={i} className={`he-seat ${s?.you ? 'you' : ''} ${v?.toAct === i ? 'turn' : ''} ${s?.folded ? 'folded' : ''}`} data-testid={`he-seat-${i}`}>
            {s ? (
              <>
                <div className="he-name">{v?.button === i && <span className="he-btn">D</span>}{s.name}</div>
                <div className="he-cards">{s.cards.map((c, k) => (c ? <span className="he-card sm" key={k}><CardFace card={c} /></span> : <span className="he-back" key={k} />))}</div>
                <div className="he-stack">{s.stack}{s.bet ? ` · bet ${s.bet}` : ''}</div>
                {s.lastAction && <div className="he-act">{s.lastAction}</div>}
              </>
            ) : <div className="he-empty">Open seat</div>}
          </div>
        ))}
      </div>
      {seated && o && (
        <div className="bj-controls he-controls">
          <button type="button" onClick={() => void send('he_action', { action: 'fold' })} data-testid="he-fold">Fold</button>
          {o.check
            ? <button type="button" onClick={() => void send('he_action', { action: 'check' })} data-testid="he-check">Check</button>
            : <button type="button" onClick={() => void send('he_action', { action: 'call' })} data-testid="he-call">Call {o.call}</button>}
          {o.raise && (
            <>
              <input type="range" min={o.minRaiseTo} max={o.maxRaiseTo} step={HE_SMALL} value={raise} onChange={(e) => setRaise(Number(e.target.value))} aria-label="Raise to" />
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
              <label className="bj-label">Buy-in <input type="number" min={HE_MIN_BUYIN} max={HE_MAX_BUYIN} step={50} value={buyIn} onChange={(e) => setBuyIn(Number(e.target.value))} className="he-buyin" /></label>
              <button type="button" className="bj-deal" onClick={() => void send('he_sit', { buyIn })} data-testid="he-sit">Sit down</button>
            </>
          )}
      </div>
      {err && <div className="account-error">{err}</div>}
    </div>
  );
}
