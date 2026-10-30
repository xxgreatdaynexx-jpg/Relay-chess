import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { LeaderboardRow } from '../../../shared/types';

export function LeaderboardScreen({ onBack, onMainMenu }: { onBack: () => void; onMainMenu?: () => void }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 py-5 sm:px-8">
      <header className="flex items-center justify-between gap-3">
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
      <div className="mt-6">
        <LeaderboardTable />
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
