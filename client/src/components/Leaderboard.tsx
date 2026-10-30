import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { LeaderboardRow } from '../../../shared/types';
import { CasinoLeaderboard } from '@/components/CasinoCommon';
import { loadName } from '@/lib/playerName';
import { ARENA_COLS, sortArena, type ArenaRow, type ArenaSort } from '../../../shared/arenaBoard';

export type BoardKind = 'chess' | 'casino' | 'arena';
const BOARDS: Array<[BoardKind, string]> = [['chess', 'Chess'], ['casino', 'Casino chips'], ['arena', 'Arena']];
const BOARD_KEY = 'relay-leaderboard-tab';
function loadBoard(): BoardKind {
  try { const v = localStorage.getItem(BOARD_KEY); return BOARDS.some(([k]) => k === v) ? (v as BoardKind) : 'chess'; } catch { return 'chess'; }
}

/** Chess / Casino selector; remembers the last choice. */
export function BoardSwitch({ value, onChange }: { value: BoardKind; onChange: (k: BoardKind) => void }) {
  return (
    <div className="lb-switch" role="tablist" aria-label="Leaderboard">
      {BOARDS.map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={cn('lb-switch-btn', value === k && 'on')} data-testid={`lb-tab-${k}`}
          onClick={() => { onChange(k); try { localStorage.setItem(BOARD_KEY, k); } catch { /* ignore */ } }}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function LeaderboardScreen({ onBack, onMainMenu }: { onBack: () => void; onMainMenu?: () => void }) {
  const [board, setBoard] = useState<BoardKind>(loadBoard);
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 py-5 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-serif text-3xl italic">Chud Hub</div>
          <h1 className="mt-2 font-serif text-4xl">Leaderboard</h1>
        </div>
        <div className="flex gap-1">
          {onMainMenu && (
            <Button variant="ghost" onClick={onMainMenu} data-testid="main-menu">
              Main Menu
            </Button>
          )}
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
        </div>
      </header>
      <div className="mt-5">
        <BoardSwitch value={board} onChange={setBoard} />
      </div>
      <div className="mt-4" data-testid={`lb-view-${board}`}>
        {board === 'chess' ? <LeaderboardTable /> : board === 'arena' ? <ArenaLeaderboard you={loadName()} /> : <div className="lb-casino"><CasinoLeaderboard you={loadName()} /></div>}
      </div>
    </div>
  );
}

export function LeaderboardTable({ highlight = [] }: { highlight?: string[] }) {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState('');
  const marked = new Set(highlight.map((name) => name.trim().toLowerCase()).filter(Boolean));

  useEffect(() => {
    let cancel = false;
    fetch('/api/leaderboard')
      .then(async (response) => {
        if (!response.ok) throw new Error('bad status');
        return (await response.json()) as { rows: LeaderboardRow[] };
      })
      .then((data) => {
        if (!cancel) setRows(data.rows ?? []);
      })
      .catch(() => {
        if (!cancel) setError('The leaderboard could not be loaded.');
      });
    return () => {
      cancel = true;
    };
  }, []);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!rows) return <p className="text-sm text-cream-dim">Loading standings…</p>;
  if (rows.length === 0) {
    return (
      <p className="text-sm text-cream-dim">
        No finished games yet. Checkmate, resignation, a flag fall, and agreed draws all land here.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="bg-white/5 text-[11px] tracking-[0.14em] text-cream/55 uppercase">
          <tr>
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">Player</th>
            <th className="px-3 py-2 font-medium">W</th>
            <th className="px-3 py-2 font-medium">L</th>
            <th className="px-3 py-2 font-medium">D</th>
            <th className="px-3 py-2 font-medium">Games</th>
            <th className="px-3 py-2 font-medium">Win rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const mine = marked.has(row.name.trim().toLowerCase());
            return (
              <tr key={row.name.toLowerCase()} className={cn('border-t border-white/10', mine && 'bg-brass/15')} data-testid="leaderboard-row">
                <td className="px-3 py-2 text-cream/50">{index + 1}</td>
                <td className="px-3 py-2 font-medium">{row.name}</td>
                <td className="tabular px-3 py-2">{row.wins}</td>
                <td className="tabular px-3 py-2">{row.losses}</td>
                <td className="tabular px-3 py-2">{row.draws}</td>
                <td className="tabular px-3 py-2">{row.played}</td>
                <td className="tabular px-3 py-2">{Math.round(row.winRate * 100)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ArenaLeaderboard({ you = '' }: { you?: string }) {
  const [rows, setRows] = useState<ArenaRow[] | null>(null);
  const [sort, setSort] = useState<ArenaSort>('kills');
  useEffect(() => {
    let live = true;
    fetch('/api/arena-leaderboard').then((r) => r.json()).then((d: { rows: ArenaRow[] }) => { if (live) setRows(d.rows ?? []); }).catch(() => live && setRows([]));
    return () => { live = false; };
  }, []);
  if (!rows) return <div className="bj-label">Loading…</div>;
  if (!rows.length) return <div className="bj-label" data-testid="arena-board-empty">No arena matches yet. Sign in and play to get on the board.</div>;
  const sorted = sortArena(rows, sort);
  return (
    <div className="lb-arena overflow-x-auto" data-testid="arena-board">
      <table className="w-full text-left text-sm">
        <thead><tr>
          <th className="px-2 py-2">#</th><th className="px-2 py-2">Player</th>
          {ARENA_COLS.map(([k, label, short]) => (
            <th key={k} className="px-2 py-2" aria-sort={sort === k ? 'descending' : 'none'}>
              <button type="button" className={cn('lb-sort', sort === k && 'on')} onClick={() => setSort(k)} data-testid={`arena-sort-${k}`} title={label}>
                <span className="hidden sm:inline">{label}</span><span className="sm:hidden">{short}</span>{sort === k ? ' ▾' : ''}
              </button>
            </th>
          ))}
        </tr></thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.name} className={cn('border-t border-white/10', r.name.toLowerCase() === you.toLowerCase() && 'casino-me')}>
              <td className="tabular px-2 py-2">{i + 1}</td><td className="px-2 py-2">{r.name}</td>
              {ARENA_COLS.map(([k]) => <td key={k} className="tabular px-2 py-2">{k === 'kd' ? r.kd.toFixed(2) : r[k]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="bj-label mt-2">Lifetime stats for signed-in names · guests aren't recorded · nuke deaths count, nuke kills don't</div>
    </div>
  );
}
