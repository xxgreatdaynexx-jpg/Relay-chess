import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { LeaderboardRow } from '../../../shared/types';
import { CasinoLeaderboard } from '@/components/CasinoCommon';
import { loadName } from '@/lib/playerName';
import { sortChess, type ChessCol } from '../../../shared/chessStats';
import { ARENA_COLS, sortArena, type ArenaRow, type ArenaSort } from '../../../shared/arenaBoard';
import { loadAuth } from '../lib/auth';

/** Signed-in session header, so a QA account sees (tagged) QA rows; everyone else gets them filtered server-side. */
const qaHeaders = (): RequestInit => { const t = loadAuth()?.token; return t ? { headers: { 'X-Relay-Session': t } } : {}; };
export const QaTag = ({ on }: { on?: boolean }) => (on ? <span className="qa-tag" title="QA test account">QA</span> : null);

const CHESS_HEAD: Array<[ChessCol, string, string]> = [
  ['name', 'Player', 'Player name'], ['wins', 'W', 'Wins'], ['losses', 'L', 'Losses'], ['draws', 'D', 'Draws'], ['played', 'Games', 'Games played'],
  ['winRate', 'Win %', 'Win rate'], ['accuracy', 'Acc', 'Accuracy: average move percentile vs. all legal moves'],
  ['brilliant', '!!', 'Brilliant: the unique best move'], ['great', '!', 'Great: a top-fifth move'],
  ['mistake', '?', 'Mistake: bottom 40% (not a blunder)'], ['blunder', '??', 'Blunder: bottom-fifth move'],
];

export type BoardKind = 'chess' | 'checkers' | 'casino' | 'arena' | 'conquest';
const BOARDS: Array<[BoardKind, string]> = [['chess', 'Chess'], ['checkers', 'Checkers'], ['casino', 'Casino'], ['arena', 'Arena'], ['conquest', 'Conquest']];
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
        {board === 'chess' ? <LeaderboardTable /> : board === 'checkers' ? <LeaderboardTable game="checkers" /> : board === 'conquest' ? <LeaderboardTable game="conquest" /> : board === 'arena' ? <ArenaLeaderboard you={loadName()} /> : <div className="lb-casino"><CasinoLeaderboard you={loadName()} /></div>}
      </div>
    </div>
  );
}

export function LeaderboardTable({ highlight = [], game = 'chess' }: { highlight?: string[]; game?: 'chess' | 'checkers' | 'conquest' }) {
  const head = game !== 'chess' ? CHESS_HEAD.slice(0, 6) : CHESS_HEAD;
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<ChessCol>('wins');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const pick = (k: ChessCol) => { if (k === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSort(k); setDir(k === 'name' || k === 'losses' || k === 'mistake' || k === 'blunder' ? 'asc' : 'desc'); } };
  const sorted = rows ? (sort === 'wins' && dir === 'desc' ? rows : sortChess(rows as unknown as Array<LeaderboardRow & Record<string, unknown>>, sort, dir)) : [];
  const marked = new Set(highlight.map((name) => name.trim().toLowerCase()).filter(Boolean));

  useEffect(() => {
    let cancel = false;
    fetch(game === 'checkers' ? '/api/checkers-leaderboard' : game === 'conquest' ? '/api/conquest-leaderboard' : '/api/leaderboard', qaHeaders())
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
  }, [game]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!rows) return <p className="text-sm text-cream-dim">Loading standings…</p>;
  if (rows.length === 0) {
    return (
      <p className="text-sm text-cream-dim">
        {game === 'conquest' ? 'No finished wars yet. Conquer every territory in a game without bots to land here.' : game === 'checkers' ? 'No finished checkers games yet. Wins, resignations, flag falls and draws all land here.' : 'No finished games yet. Checkmate, resignation, a flag fall, and agreed draws all land here.'}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10">
      <table className={cn('w-full text-left text-sm', game !== 'chess' ? 'min-w-[28rem]' : 'min-w-[44rem]')} data-testid={`lb-table-${game}`}>
        <thead className="bg-white/5 text-[11px] tracking-[0.14em] text-cream/55 uppercase">
          <tr>
            <th className="px-3 py-2 font-medium">#</th>
            {head.map(([k, label, title]) => (
              <th key={k} className="px-2 py-2 font-medium" aria-sort={sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className={cn('lb-sort', sort === k && 'on')} onClick={() => pick(k)} data-testid={`chess-sort-${k}`} title={title}>
                  {label}{sort === k ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => {
            const mine = marked.has(row.name.trim().toLowerCase());
            return (
              <tr key={row.name.toLowerCase()} className={cn('border-t border-white/10', mine && 'bg-brass/15')} data-testid="leaderboard-row">
                <td className="px-3 py-2 text-cream/50">{index + 1}</td>
                <td className="px-2 py-2 font-medium">{row.name}<QaTag on={(row as { qa?: boolean }).qa} /></td>
                <td className="tabular px-2 py-2">{row.wins}</td>
                <td className="tabular px-2 py-2">{row.losses}</td>
                <td className="tabular px-2 py-2">{row.draws}</td>
                <td className="tabular px-2 py-2">{row.played}</td>
                <td className="tabular px-2 py-2">{Math.round(row.winRate * 100)}%</td>
                {game === 'chess' && <><td className="tabular px-2 py-2" title={row.moves ? `${row.moves} rated moves` : 'No rated moves yet'}>{row.accuracy == null ? '–' : `${row.accuracy}%`}</td>
                <td className="tabular px-2 py-2">{row.brilliant ?? 0}</td>
                <td className="tabular px-2 py-2">{row.great ?? 0}</td>
                <td className="tabular px-2 py-2">{row.mistake ?? 0}</td>
                <td className="tabular px-2 py-2">{row.blunder ?? 0}</td></>}
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
    fetch('/api/arena-leaderboard', qaHeaders()).then((r) => r.json()).then((d: { rows: ArenaRow[] }) => { if (live) setRows(d.rows ?? []); }).catch(() => live && setRows([]));
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
              <td className="tabular px-2 py-2">{i + 1}</td><td className="px-2 py-2">{r.name}<QaTag on={(r as { qa?: boolean }).qa} /></td>
              {ARENA_COLS.map(([k]) => <td key={k} className="tabular px-2 py-2">{k === 'kd' ? r.kd.toFixed(2) : r[k]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="bj-label mt-2">Lifetime stats for signed-in names · guests aren't recorded · nuke deaths count, nuke kills don't</div>
    </div>
  );
}
