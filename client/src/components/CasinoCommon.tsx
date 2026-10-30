import { openAccount } from '@/lib/settings';
import { useState } from 'react';
import type { CasinoStanding } from '../../../shared/casino';
import { emitCasino, notifyNameChanged, useCasinoBoard } from '@/lib/casino';
import { saveName } from '@/lib/playerName';

/** Asks for a name when none is saved (chips are keyed by it). */
export function NamePrompt() {
  return (
    <div className="casino-name">
      <div className="bj-label">Sign in or claim a name to get 1,000 play chips. Your chips follow your name.</div>
      <button type="button" className="bj-deal casino-signin" onClick={() => openAccount()} data-testid="casino-signin">Sign in / claim a name</button>
    </div>
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
              <td>{r.name}{r.qa && <span className="qa-tag" title="QA test account">QA</span>}</td>
              <td>{r.chips.toLocaleString()}</td>
              <td className={r.netWon >= 0 ? 'casino-up' : 'casino-down'}>{r.netWon >= 0 ? '+' : ''}{r.netWon.toLocaleString()}</td>
              <td>{r.biggestWin ? `+${r.biggestWin.toLocaleString()}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="bj-label">All casino games share one chip balance · play money</div>
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
