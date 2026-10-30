import { useState } from 'react';
import type { CasinoStanding } from '../../../shared/casino';
import { emitCasino, notifyNameChanged, useCasinoBoard } from '@/lib/casino';
import { saveName } from '@/lib/playerName';

/** Asks for a name when none is saved (chips are keyed by it). */
export function NamePrompt() {
  const [v, setV] = useState('');
  return (
    <form
      className="casino-name"
      onSubmit={(e) => {
        e.preventDefault();
        if (saveName(v)) notifyNameChanged();
      }}
    >
      <div className="bj-label">Pick a name to get 1,000 play chips. Your chips follow your name.</div>
      <input value={v} maxLength={18} onChange={(e) => setV(e.target.value)} placeholder="Your name" aria-label="Your name" />
      <button type="submit" className="bj-deal">Sit</button>
    </form>
  );
}

export function CasinoLeaderboard({ you }: { you: string }) {
  const rows = useCasinoBoard(true);
  if (!rows) return <div className="casino-board bj-label">Loading…</div>;
  if (!rows.length) return <div className="casino-board bj-label">No one has played yet. Be first.</div>;
  return (
    <div className="casino-board" data-testid="casino-board">
      <table>
        <thead><tr><th>#</th><th>Player</th><th>Chips</th><th>Net</th><th>Best</th></tr></thead>
        <tbody>
          {rows.map((r: CasinoStanding, i) => (
            <tr key={r.name} className={r.name.toLowerCase() === you.toLowerCase() ? 'casino-me' : ''}>
              <td>{i + 1}</td>
              <td>{r.name}</td>
              <td>{r.chips.toLocaleString()}</td>
              <td className={r.netWon >= 0 ? 'casino-up' : 'casino-down'}>{r.netWon >= 0 ? '+' : ''}{r.netWon.toLocaleString()}</td>
              <td>{r.biggestWin ? `+${r.biggestWin.toLocaleString()}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="bj-label">Shared by blackjack and roulette · play money</div>
    </div>
  );
}

export function ResetChips({ name, onDone }: { name: string; onDone: (chips: number) => void }) {
  return (
    <button type="button" className="bj-deal" onClick={() => void emitCasino<{ chips: number }>('casino_reset', { name }).then((r) => r.ok && r.chips && onDone(r.chips))}>
      Reset chips (1,000)
    </button>
  );
}
