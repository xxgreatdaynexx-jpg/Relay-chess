import { useWindowDrag } from '@/lib/windowDrag';
import { useEffect, useRef, useState } from 'react';
import { CardFace } from '@/components/SolitairePanel';
import { CasinoLeaderboard, NamePrompt, ResetChips } from '@/components/CasinoCommon';
import { handValue, type BJSeatView, type BJTableView } from '../../../shared/casino';
import { emitCasino, useCountdown, useSavedName } from '@/lib/casino';
import { socket } from '@/lib/net';
import { playCardFlick, playSolitaireWin, playYourTurn } from '@/lib/sounds';

const OPEN_KEY = 'relay-blackjack-open';
const BETS = [5, 25, 100, 500];
const LABEL: Record<string, string> = {
  blackjack: 'Blackjack!', win: 'Win', push: 'Push', lose: 'Lose', bust: 'Bust', 'dealer-blackjack': 'Dealer BJ',
};

function total(cards: BJSeatView['hands'][number]['cards']) {
  const v = handValue(cards);
  return `${v.total}${v.soft && v.total < 21 ? ' soft' : ''}`;
}

/** Drop-down shared blackjack table (server-run, play-money chips), fixed top-left on every screen. */
export function BlackjackPanel() {
  const winRef = useRef<HTMLDivElement>(null);
  const win = useWindowDrag('blackjack', winRef);
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1');
  const [tab, setTab] = useState<'table' | 'board'>('table');
  const [name] = useSavedName();
  const [t, setT] = useState<BJTableView | null>(null);
  const [bet, setBet] = useState(25);
  const [err, setErr] = useState('');
  const cardCount = useRef(0);
  const lastTurn = useRef<string>('');
  const wonAt = useRef<number | null>(null);
  useEffect(() => { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); }, [open]);

  useEffect(() => {
    if (!open || !name) return;
    const on = (v: BJTableView) => setT(v);
    socket.on('bj_state', on);
    const join = () => void emitCasino<{ table: BJTableView }>('bj_join', { name }).then((r) => {
      if (r.ok && r.table) setT(r.table);
      else setErr(r.error ?? '');
    });
    join();
    socket.on('connect', join);
    return () => {
      socket.off('bj_state', on);
      socket.off('connect', join);
      void emitCasino('bj_leave');
      setT(null);
    };
  }, [open, name]);

  // Sounds: card flick on new cards, chime on your turn, arpeggio on a win.
  useEffect(() => {
    if (!t) return;
    const n = t.dealer.length + t.seats.reduce((s, x) => s + x.hands.reduce((a, h) => a + h.cards.length, 0), 0);
    if (n > cardCount.current) playCardFlick();
    cardCount.current = n;
    const key = `${t.turn}:${t.deadline}`;
    if (t.phase === 'playing' && t.turn !== null && t.turn === t.you && lastTurn.current !== key && !lastTurn.current.startsWith(`${t.turn}:`)) playYourTurn();
    lastTurn.current = t.phase === 'playing' ? key : '';
    const me = t.seats.find((s) => s.seat === t.you);
    if (t.phase === 'settled' && me && me.hands.reduce((s, h) => s + h.net, 0) > 0 && wonAt.current !== t.deadline) {
      wonAt.current = t.deadline;
      window.setTimeout(playSolitaireWin, 150);
    }
  }, [t]);

  const secs = useCountdown(t?.deadline ?? null, t?.serverNow);
  const me = t?.seats.find((s) => s.seat === t.you) ?? null;
  const chips = me?.chips ?? 0;
  const myTurn = t?.phase === 'playing' && t.turn !== null && t.turn === t.you;
  const hand = myTurn && me && me.active !== null ? me.hands[me.active] : null;

  async function send(event: string, payload: unknown) {
    setErr('');
    const r = await emitCasino(event, payload);
    if (!r.ok) setErr(r.error ?? 'Failed');
  }

  const status = !t
    ? 'Joining table…'
    : t.phase === 'betting'
      ? `Place bets · ${secs ?? ''}s`
      : t.phase === 'playing'
        ? myTurn ? `Your turn · ${secs ?? ''}s` : `${t.seats.find((s) => s.seat === t.turn)?.name ?? ''}'s turn · ${secs ?? ''}s`
        : t.phase === 'settled' ? 'Round over' : 'Waiting for players';

  return (
    <div className={`bj-wrap ${open ? 'bj-open' : ''}`} data-testid="blackjack">
      <button type="button" className="sol-tab bj-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="blackjack-tab">
        🂡 Blackjack <span aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="sol-panel bj-panel" role="dialog" aria-label="Blackjack" ref={winRef} style={win.style} onPointerDownCapture={win.front}>
          <div {...win.bar}>
            <button type="button" className={`casino-tabbtn ${tab === 'table' ? 'on' : ''}`} onClick={() => setTab('table')}>Table{t ? ` ${t.id}` : ''}</button>
            <button type="button" className={`casino-tabbtn ${tab === 'board' ? 'on' : ''}`} onClick={() => setTab('board')} data-testid="casino-board-tab">Casino leaderboard</button>
            {win.moved && <button type="button" className="win-reset" aria-label="Reset window position" title="Reset position" onClick={win.reset}>⟲</button>}
            <button type="button" className="ml-auto" aria-label="Close blackjack" onClick={() => setOpen(false)}>✕</button>
          </div>
          {tab === 'board' ? (
            <CasinoLeaderboard you={name} />
          ) : !name ? (
            <NamePrompt />
          ) : (
            <>
              <div className="bj-table">
                <div className="bj-status" data-testid="bj-status">{status}</div>
                <div className="bj-label">Dealer {t?.dealer.length ? `· ${handValue(t.dealer).total}${t.dealer.some((c) => !c.faceUp) ? '+?' : ''}` : ''}</div>
                <div className="bj-hand">{t?.dealer.map((c, i) => <div key={`${c.id}${i}`} className="bj-card"><CardFace card={c} /></div>)}</div>
                <div className="bj-seats">
                  {t?.seats.map((s) => (
                    <div key={s.seat} className={`bj-seat ${s.seat === t.turn ? 'bj-seat-turn' : ''} ${s.seat === t.you ? 'bj-seat-me' : ''}`} data-testid="bj-seat">
                      <div className="bj-seat-name">{s.seat === t.you ? 'You' : s.name} <span className="opacity-70">🪙{s.chips.toLocaleString()}</span></div>
                      {s.hands.length === 0 && <div className="bj-label">{s.bet ? `Bet ${s.bet}` : t.phase === 'betting' ? 'Betting…' : 'Sitting out'}</div>}
                      {s.hands.map((h, hi) => (
                        <div key={hi} className={`bj-subhand ${s.seat === t.turn && s.active === hi ? 'bj-subhand-on' : ''}`}>
                          <div className="bj-hand bj-hand-sm">{h.cards.map((c, i) => <div key={`${c.id}${i}`} className="bj-card"><CardFace card={c} /></div>)}</div>
                          <div className="bj-label">
                            {total(h.cards)} · {h.bet}{h.doubled ? ' ×2' : ''}
                            {h.outcome && <b className={h.net > 0 ? 'casino-up' : h.net < 0 ? 'casino-down' : ''}> {LABEL[h.outcome]} {h.net > 0 ? `+${h.net}` : h.net || ''}</b>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                {err && <div className="bj-err">{err}</div>}
              </div>
              <div className="bj-controls">
                <span className="font-semibold">🪙 {chips.toLocaleString()}</span>
                {myTurn && hand ? (
                  <>
                    <button type="button" onClick={() => void send('bj_action', { action: 'hit' })} data-testid="bj-hit">Hit</button>
                    <button type="button" onClick={() => void send('bj_action', { action: 'stand' })}>Stand</button>
                    <button type="button" disabled={hand.cards.length !== 2 || chips < hand.bet} onClick={() => void send('bj_action', { action: 'double' })}>Double</button>
                    <button type="button" disabled={hand.cards.length !== 2 || Math.min(hand.cards[0]!.rank, 10) !== Math.min(hand.cards[1]!.rank, 10) || chips < hand.bet || (me?.hands.length ?? 0) >= 4} onClick={() => void send('bj_action', { action: 'split' })}>Split</button>
                  </>
                ) : t?.phase === 'betting' && me && !me.bet ? (
                  chips < BETS[0]! ? (
                    <ResetChips name={name} onDone={() => undefined} />
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-1">
                        {BETS.map((b) => <button type="button" key={b} className={bet === b ? 'bj-chip-on' : ''} disabled={b > chips} onClick={() => setBet(b)}>{b}</button>)}
                      </div>
                      <button type="button" className="bj-deal" onClick={() => void send('bj_bet', { amount: Math.min(bet, chips) })} data-testid="bj-bet">Bet {Math.min(bet, chips)}</button>
                    </>
                  )
                ) : (
                  <span className="bj-label">{me?.bet && t?.phase === 'betting' ? `Bet ${me.bet} in · waiting for others` : 'Watching'}</span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
