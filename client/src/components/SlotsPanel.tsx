import { useEffect, useRef, useState } from 'react';
import { CasinoLeaderboard, NamePrompt, ResetChips } from '@/components/CasinoCommon';
import { emitCasino, useSavedName } from '@/lib/casino';
import { useWindowDrag } from '@/lib/windowDrag';
import { playBallLand, playCardFlick, playRouletteSpin, playSolitaireWin } from '@/lib/sounds';
import { SLOT_EMOJI, SLOT_SYMBOLS, SLOT_TRIPLE, type SlotSymbol } from '../../../shared/casino-games';

const OPEN_KEY = 'relay-slots-open';
const BETS = [1, 5, 10, 25, 50, 100];
interface Spin { reels: SlotSymbol[]; multiplier: number; returned: number; net: number; chips: number }

/** 3-reel slot machine on casino chips. The server picks the result; reels just animate to it. */
export function SlotsPanel() {
  const winRef = useRef<HTMLDivElement>(null);
  const win = useWindowDrag('slots', winRef);
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1');
  const [tab, setTab] = useState<'play' | 'board'>('play');
  const [name] = useSavedName();
  const [reels, setReels] = useState<SlotSymbol[]>(['seven', 'seven', 'seven']);
  const [stopped, setStopped] = useState(3);
  const [last, setLast] = useState<Spin | null>(null);
  const [chips, setChips] = useState<number | null>(null);
  const [bet, setBet] = useState(5);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); }, [open]);
  useEffect(() => {
    if (!open || !name) return;
    void emitCasino<{ state: { chips: number } }>('vp_state').then((r) => r.ok && r.state && setChips(r.state.chips));
  }, [open, name]);

  // Spin the unstopped reels through random symbols.
  useEffect(() => {
    if (stopped >= 3) return;
    const t = setInterval(() => setReels((rs) => rs.map((s, i) => (i < stopped ? s : SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]!))), 70);
    return () => clearInterval(t);
  }, [stopped]);

  const spin = async () => {
    setBusy(true); setErr(''); setLast(null); setStopped(0);
    playRouletteSpin(1.2);
    const r = await emitCasino<{ result: Spin }>('slots_spin', { bet });
    if (!r.ok || !r.result) { setStopped(3); setBusy(false); return setErr(r.error ?? 'Try again.'); }
    const res = r.result;
    for (let i = 0; i < 3; i++) {
      await new Promise((ok) => setTimeout(ok, 380));
      setReels((rs) => rs.map((s, j) => (j === i ? res.reels[i]! : s)));
      setStopped(i + 1);
      playCardFlick();
    }
    setLast(res); setChips(res.chips); setBusy(false);
    if (res.net > 0) (res.multiplier >= 25 ? playSolitaireWin : playBallLand)();
  };

  return (
    <div className={`cx-wrap sl-wrap ${open ? 'cx-open' : ''}`} data-testid="slots">
      <button type="button" className="sol-tab cx-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="slots-tab">🎰 Slots</button>
      {open && (
        <div className={"sol-panel bj-panel cx-panel" + win.className} role="dialog" aria-label="Slots" ref={winRef} style={win.style} onPointerDownCapture={win.front}>
          {win.grips}
          <div {...win.bar}>
            <button type="button" className={`casino-tabbtn ${tab === 'play' ? 'on' : ''}`} onClick={() => setTab('play')}>Slots</button>
            <button type="button" className={`casino-tabbtn ${tab === 'board' ? 'on' : ''}`} onClick={() => setTab('board')}>Casino leaderboard</button>
            {win.moved && <button type="button" className="win-reset" aria-label="Reset window position" onClick={win.reset}>⟲</button>}
            <button type="button" className="ml-auto" aria-label="Close slots" onClick={() => setOpen(false)}>✕</button>
          </div>
          {tab === 'board' ? <CasinoLeaderboard you={name} /> : !name ? <NamePrompt /> : (
            <div className="bj-table">
              <div className="bj-status" data-testid="sl-status">
                {busy ? 'Spinning…' : last ? (last.net > 0 ? `${last.multiplier}× · won ${last.net}` : last.multiplier === 1 ? 'Two cherries · stake back' : 'No win') : 'Pick a bet and Spin.'}
              </div>
              <div className={`sl-reels ${last && last.net > 0 ? 'win' : ''}`}>
                {reels.map((s, i) => <div key={i} className={`sl-reel ${i >= stopped ? 'spin' : ''}`} data-testid={`sl-reel-${i}`}>{SLOT_EMOJI[s]}</div>)}
              </div>
              <div className="bj-controls">
                {BETS.map((b) => <button type="button" key={b} className={bet === b ? 'bj-chip-on' : ''} disabled={busy} onClick={() => setBet(b)}>{b}</button>)}
                <button type="button" className="bj-deal" disabled={busy} onClick={() => void spin()} data-testid="sl-spin">Spin {bet}</button>
              </div>
              <div className="bj-label">Chips: {chips?.toLocaleString() ?? '…'} {err && <span className="account-error">· {err}</span>}</div>
              {chips !== null && chips < 1 && !busy && <ResetChips name={name} onDone={setChips} />}
              <table className="vp-pays">
                <tbody>
                  {[...SLOT_SYMBOLS].reverse().map((s) => <tr key={s}><td>{SLOT_EMOJI[s].repeat(3)}</td><td>{SLOT_TRIPLE[s]}×</td></tr>)}
                  <tr><td>🍒🍒 any two</td><td>1×</td></tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
