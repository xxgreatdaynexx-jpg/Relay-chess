import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { MINE_METRICS, MINE_PERIODS, type MineBoardRow, type MineMetric, type MinePeriod } from '../../../shared/minesBoard';

type Board = Record<MineMetric, MineBoardRow[]>;

/** Mining leaderboard: Today / This week / All time × chips earned, ore mined, best haul. Server-computed from the ledger. */
export function MiningLeaderboard({ you = '', compact = false }: { you?: string; compact?: boolean }) {
  const [period, setPeriod] = useState<MinePeriod>('today');
  const [metric, setMetric] = useState<MineMetric>('chips');
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true; setBoard(null); setError(false);
    fetch(`/api/mines-leaderboard?period=${period}`)
      .then((r) => { if (!r.ok) throw new Error('bad'); return r.json(); })
      .then((d: Board) => { if (live) setBoard({ chips: d.chips ?? [], ore: d.ore ?? [], haul: d.haul ?? [] }); })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [period]);
  const rows = (board?.[metric] ?? []).slice(0, compact ? 10 : 25);
  const fmt = (r: MineBoardRow) => (metric === 'ore' ? `${r.ore.toLocaleString()} ore` : `🪙 ${r[metric].toLocaleString()}`);
  return (
    <div className={cn('mine-lb', compact && 'mine-lb-compact')} data-testid="mining-board">
      <div className="lb-switch" role="tablist" aria-label="Period">
        {MINE_PERIODS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={period === k} className={cn('lb-switch-btn', period === k && 'on')} onClick={() => setPeriod(k)} data-testid={`mine-lb-period-${k}`}>{label}</button>
        ))}
      </div>
      <div className="mine-lb-metrics" role="tablist" aria-label="Ranking">
        {MINE_METRICS.map(([k, label, title]) => (
          <button key={k} type="button" role="tab" aria-selected={metric === k} title={title} className={cn('lb-sort', metric === k && 'on')} onClick={() => setMetric(k)} data-testid={`mine-lb-metric-${k}`}>{label}</button>
        ))}
      </div>
      {error ? <div className="bj-label">The mining leaderboard could not be loaded.</div>
        : !board ? <div className="bj-label">Loading…</div>
        : !rows.length ? <div className="bj-label" data-testid="mining-board-empty">Nobody on the board {period === 'all' ? 'yet' : period === 'today' ? 'today' : 'this week'}. Sign in, mine, and bank at the EXIT lift.</div>
        : (
          <table className="w-full text-left text-sm">
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.name} className={cn('border-t border-white/10', r.name.toLowerCase() === you.toLowerCase() && 'casino-me')} data-testid="mining-row">
                  <td className="tabular px-2 py-1 opacity-60">{i + 1}</td>
                  <td className="px-2 py-1 font-medium">{r.name}</td>
                  <td className="tabular px-2 py-1 text-right">{fmt(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      {!compact && <div className="bj-label mt-2">Days and weeks are UTC · signed-in players only · chips are house payouts for ore and factory goods</div>}
    </div>
  );
}
