import { TopTab } from '@/components/TopTabs';
import { useWindowDrag } from '@/lib/windowDrag';
import { Fragment, useEffect, useRef, useState } from 'react';
import { CardFace } from '@/components/SolitairePanel';
import { NamePrompt, ResetChips } from '@/components/CasinoCommon';
import { handValue, type BJSeatView, type BJTableView } from '../../../shared/casino';
import { useWalletChips } from '@/lib/wallet';
import { emitCasino, useCountdown, useSavedName } from '@/lib/casino';
import { socket } from '@/lib/net';
import { at, Chips, dealStyle, FeltTable } from '@/components/FeltTable';
import { bjSeatPositions, towardCentre } from '@/lib/tableLayout';
import { playCardFlick, playSolitaireWin, playYourTurn } from '@/lib/sounds';

const OPEN_KEY = 'relay-blackjack-open';
const BETS = [5, 25, 100, 500];
const SHOE = { x: 86, y: 9 };
const DEALER = { x: 50, y: 13 };
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
  const [tab, setTab] = useState<'table'>('table');
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
  const wallet = useWalletChips();
  const chips = wallet ?? me?.chips ?? 0;
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
      <TopTab id="blackjack"><button type="button" className="sol-tab bj-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="blackjack-tab">
        🂡 Blackjack
      </button></TopTab>
      {open && (
        <div className={"sol-panel bj-panel" + win.className} role="dialog" aria-label="Blackjack" ref={winRef} style={win.style} onPointerDownCapture={win.front} onPointerMove={win.onPanelMove}>
          {win.grips}
          <div {...win.bar}>
            <button type="button" className={`casino-tabbtn ${tab === 'table' ? 'on' : ''}`} onClick={() => setTab('table')}>Table{t ? ` ${t.id}` : ''}</button>
            {win.moved && <button type="button" className="win-reset" aria-label="Reset window position" title="Reset position" onClick={win.reset}>⟲</button>}
            <button type="button" className="ml-auto" aria-label="Close blackjack" onClick={() => setOpen(false)}>✕</button>
          </div>
          {!name ? (
            <NamePrompt />
          ) : (
            <>
              <div className="bj-table">
                <div className="bj-status" data-testid="bj-status">{status}</div>
                <FeltTable kind="bj" testId="bj-felt">{(aspect) => {
                  const pos = bjSeatPositions(t?.maxSeats ?? 5);
                  return (
                    <>
                      <svg className="felt-print" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
                        <path id="bj-arc1" d="M 22 13 Q 50 29 78 13" fill="none" />
                        <path id="bj-arc2" d="M 20 17 Q 50 33 80 17" fill="none" />
                        <text><textPath href="#bj-arc1" startOffset="50%" textAnchor="middle">BLACKJACK PAYS 3 TO 2</textPath></text>
                        <text className="sm"><textPath href="#bj-arc2" startOffset="50%" textAnchor="middle">DEALER STANDS ON ALL 17s · NO INSURANCE</textPath></text>
                      </svg>
                      <div className="felt-shoe" style={at(SHOE)} aria-label="Shoe"><span /></div>
                      <div className="felt-dealer" style={at(DEALER)}>
                        <div className="felt-hand">{t?.dealer.map((c, i) => <div key={`${c.id}${i}`} className="felt-card deal-in" style={dealStyle(SHOE, DEALER, aspect, i)}><CardFace card={c} /></div>)}</div>
                        <div className="felt-plate dealer">Dealer{t?.dealer.length ? ` · ${handValue(t.dealer).total}${t.dealer.some((c) => !c.faceUp) ? '+?' : ''}` : ''}</div>
                      </div>
                      {pos.map((p, i) => {
                        const s = t?.seats.find((x) => x.seat === i);
                        const bet = towardCentre(p, 0.22, { x: 50, y: 20 });
                        const staked = s ? (s.hands.length ? s.hands.reduce((a, h) => a + h.bet * (h.doubled ? 2 : 1), 0) : s.bet) : 0;
                        return (
                          <Fragment key={i}>
                          <div className="felt-betspot" style={at(bet)}>
                            <Chips key={staked} amount={staked} from={p} to={bet} aspect={aspect} />
                          </div>
                          <div className={`felt-seat ${s && s.seat === t?.turn ? 'turn' : ''} ${s && s.seat === t?.you ? 'me' : ''} ${s ? '' : 'empty'}`} style={at(p)} data-testid={s ? 'bj-seat' : undefined}>
                            {s?.hands.map((h, hi) => (
                              <div key={hi} className={`felt-subhand ${s.seat === t?.turn && s.active === hi ? 'on' : ''}`}>
                                <div className="felt-hand sm">{h.cards.map((c, ci) => <div key={`${c.id}${ci}`} className="felt-card deal-in" style={dealStyle(SHOE, p, aspect, ci)}><CardFace card={c} /></div>)}</div>
                                <div className="felt-tag">
                                  {total(h.cards)}{h.doubled ? ' ×2' : ''}
                                  {h.outcome && <b className={h.net > 0 ? 'casino-up' : h.net < 0 ? 'casino-down' : ''}> {LABEL[h.outcome]} {h.net > 0 ? `+${h.net}` : h.net || ''}</b>}
                                </div>
                              </div>
                            ))}
                            <div className="felt-plate">
                              {s ? <><b>{s.seat === t?.you ? 'You' : s.name}</b><span>🪙{(s.seat === t?.you && wallet !== null ? wallet : s.chips).toLocaleString()}</span></> : <span className="opacity-60">Open</span>}
                              {s && !s.hands.length && <span className="felt-sub">{s.bet ? `Bet ${s.bet}` : t?.phase === 'betting' ? 'Betting…' : 'Sitting out'}</span>}
                            </div>
                          </div>
                          </Fragment>
                        );
                      })}
                    </>
                  );
                }}</FeltTable>
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
