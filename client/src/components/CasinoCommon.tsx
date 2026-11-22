import { openAccount } from '@/lib/settings';
import { useEffect, useState } from 'react';
import type { CasinoStanding } from '../../../shared/casino';
import { emitCasino, notifyNameChanged, useCasinoBoard } from '@/lib/casino';
import { saveName } from '@/lib/playerName';
import { clampChipAmount, parseChipAmount, validateCasinoBet } from '../../../shared/casino-bet';

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

/** Shown instead of the bet controls when the balance can't cover the minimum bet. There is no refill. */
export function OutOfChips() {
  return <div className="bj-label" data-testid="out-of-chips">Out of chips</div>;
}


/** Custom chip amount next to the usual bet presets. Commas are allowed; the value is clamped on blur. */
export function BetAmountInput({
  value, min, max, balance, disabled, onChange, testId = 'custom-bet', label = 'Custom',
}: {
  value: number;
  min: number;
  max: number;
  balance?: number;
  disabled?: boolean;
  onChange: (n: number) => void;
  testId?: string;
  label?: string;
}) {
  const [text, setText] = useState(value.toLocaleString());
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState('');
  const limits = { min, max, balance };

  useEffect(() => {
    if (!focused) setText(value.toLocaleString());
  }, [value, focused]);

  const apply = (raw: string, clampOnFail: boolean) => {
    if (!raw.trim()) {
      setError('Enter a whole number of chips.');
      if (clampOnFail) setText(value.toLocaleString());
      return;
    }
    const parsed = parseChipAmount(raw);
    if (parsed === null) {
      setError('Enter a whole number of chips.');
      if (clampOnFail) setText(value.toLocaleString());
      return;
    }
    const checked = validateCasinoBet(parsed, limits);
    if (checked.ok) {
      setError('');
      onChange(checked.amount);
      if (clampOnFail) setText(checked.amount.toLocaleString());
      return;
    }
    if (clampOnFail) {
      const next = clampChipAmount(parsed, min, max, balance);
      onChange(next);
      setText(next.toLocaleString());
    }
    setError(checked.error);
  };

  const errId = `${testId}-err`;
  return (
    <label className="bet-custom">
      <span className="bet-custom-label">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={focused ? text : value.toLocaleString()}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        data-testid={testId}
        onChange={(e) => { setText(e.target.value); apply(e.target.value, false); }}
        onFocus={(e) => { setFocused(true); setText(value.toLocaleString()); e.currentTarget.select(); }}
        onBlur={() => { setFocused(false); apply(text, true); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      {error && <span id={errId} className="bet-custom-err" role="alert" data-testid={`${testId}-error`}>{error}</span>}
    </label>
  );
}
