import { useEffect, useRef, useState } from 'react';
import type { ThinkTime } from '../../../shared/types';
import { formatThink, rankThinkTimes } from '../../../shared/thinkTime';

/** Milliseconds since the latest server snapshot, ticking while `live`. */
export function useSinceSnapshot(serverNow: number, live: boolean): number {
  const received = useRef(Date.now());
  const [, setTick] = useState(0);
  useEffect(() => {
    received.current = Date.now();
  }, [serverNow]);
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, [live]);
  return live ? Date.now() - received.current : 0;
}

export function ThinkSummary({ times, title = 'Time used per player' }: { times: ThinkTime[]; title?: string }) {
  const rows = rankThinkTimes(times);
  if (rows.length === 0) return null;
  return (
    <div className="think-summary rounded-xl border border-white/10 bg-white/5 px-3 py-2" data-testid="think-summary">
      <div className="text-[11px] tracking-[0.16em] text-cream/60 uppercase">{title}</div>
      <table className="mt-1 w-full text-sm">
        <thead>
          <tr className="text-[10px] text-cream/50 uppercase">
            <th className="text-left font-normal">Player</th>
            <th className="text-right font-normal">Total</th>
            <th className="text-right font-normal">Avg/move</th>
            <th className="text-right font-normal">Longest</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.seat}>
              <td className="truncate">
                {i === 0 && row.usedMs >= 1000 ? '🐢 ' : ''}
                {row.name}
                <span className="ml-1 text-[10px] text-cream/40">{row.moves} mv</span>
              </td>
              <td className="tabular text-right">{formatThink(row.usedMs)}</td>
              <td className="tabular text-right">{formatThink(row.averageMs)}</td>
              <td className="tabular text-right">{formatThink(row.longestMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
