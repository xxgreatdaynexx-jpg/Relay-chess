import { useEffect, useState } from 'react';
import { CardFace } from '@/components/SolitairePanel';
import { canDouble, deal, double, handValue, hit, isValidBJ, newState, stand, type BJState } from '@/blackjack/logic';
import { playCardFlick, playSolitaireWin } from '@/lib/sounds';

const KEY = 'relay-blackjack-v1';
const OPEN_KEY = 'relay-blackjack-open';
const BETS = [10, 25, 50, 100, 250];
const LABEL: Record<string, string> = {
  blackjack: 'Blackjack! Pays 3:2', win: 'You win', push: 'Push', lose: 'Dealer wins', bust: 'Bust', 'dealer-blackjack': 'Dealer blackjack',
};

function load(): BJState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (isValidBJ(raw)) return raw;
  } catch { /* ignore */ }
  return newState(1000);
}

/** Drop-down blackjack (play-money chips only), fixed top-left on every screen. */
export function BlackjackPanel() {
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1');
  const [s, setS] = useState<BJState>(load);
  const [bet, setBet] = useState(25);
  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(s)); }, [s]);
  useEffect(() => { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); }, [open]);

  function apply(next: BJState | null) {
    if (!next) return;
    setS(next);
    playCardFlick();
    if (next.phase === 'done' && next.payout > 0) window.setTimeout(playSolitaireWin, 150);
  }
  const playing = s.phase === 'player';
  const broke = !playing && s.chips < BETS[0];
  const effBet = Math.min(bet, s.chips);
  const dealerShown = playing ? handValue([s.dealer[0]]).total : handValue(s.dealer).total;

  return (
    <div className={`bj-wrap ${open ? 'bj-open' : ''}`} data-testid="blackjack">
      <button type="button" className="sol-tab bj-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="blackjack-tab">
        🂡 Blackjack <span aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="sol-panel bj-panel" role="dialog" aria-label="Blackjack">
          <div className="sol-bar">
            <span className="font-semibold">🪙 {s.chips.toLocaleString()} chips</span>
            <span className="opacity-70">play money</span>
            <button type="button" className="ml-auto" aria-label="Close blackjack" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="bj-table">
            <div className="bj-label">Dealer {s.dealer.length ? `· ${dealerShown}${playing ? '+?' : ''}` : ''}</div>
            <div className="bj-hand">{s.dealer.map((c) => <div key={c.id} className="bj-card"><CardFace card={c} /></div>)}</div>
            <div className="bj-result" data-testid="bj-result">
              {s.phase === 'done' && s.outcome ? `${LABEL[s.outcome]} ${s.payout > 0 ? `+${s.payout}` : s.payout < 0 ? s.payout : ''}` : playing ? `Bet ${s.bet}${s.doubled ? ' (doubled)' : ''}` : 'Place your bet'}
            </div>
            <div className="bj-hand">{s.player.map((c) => <div key={c.id} className="bj-card"><CardFace card={c} /></div>)}</div>
            <div className="bj-label">You {s.player.length ? `· ${handValue(s.player).total}${handValue(s.player).soft && handValue(s.player).total < 21 ? ' (soft)' : ''}` : ''}</div>
          </div>
          <div className="bj-controls">
            {playing ? (
              <>
                <button type="button" onClick={() => apply(hit(s))}>Hit</button>
                <button type="button" onClick={() => apply(stand(s))}>Stand</button>
                <button type="button" onClick={() => apply(double(s))} disabled={!canDouble(s)}>Double</button>
              </>
            ) : broke ? (
              <button type="button" onClick={() => setS({ ...newState(1000), shoe: s.shoe })}>Reset chips (1000)</button>
            ) : (
              <>
                <div className="flex flex-wrap gap-1">
                  {BETS.map((b) => (
                    <button type="button" key={b} className={bet === b ? 'bj-chip-on' : ''} disabled={b > s.chips} onClick={() => setBet(b)}>{b}</button>
                  ))}
                </div>
                <button type="button" className="bj-deal" onClick={() => apply(deal(s, effBet))} data-testid="bj-deal">Deal {effBet}</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
