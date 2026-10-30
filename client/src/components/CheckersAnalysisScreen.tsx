import { useEffect, useMemo, useState } from 'react';
import { Board } from '@/components/Board';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { FinishedGame } from '@/lib/lastGame';
import { INITIAL_CHECKERS_FEN, legalMoves, parseFen } from '../../../shared/checkers';
import { CHECKERS_WIN, GRADE_MARK, gradeCheckersMove, searchCheckers, type CheckersGrade } from '../../../shared/checkers-engine';

interface Ev { score: number; best: { from: string; to: string } | null; depth: number }
const GRADE_CLASS: Record<CheckersGrade, string> = { best: 'text-sky-300', good: 'text-emerald-300', inaccuracy: 'text-yellow-200', mistake: 'text-orange-300', blunder: 'text-red-400' };

function evalText(s: number): string {
  if (Math.abs(s) > CHECKERS_WIN - 1000) return `${s > 0 ? '+' : '-'}W${Math.ceil((CHECKERS_WIN - Math.abs(s)) / 2)}`;
  return `${s >= 0 ? '+' : ''}${(s / 100).toFixed(1)}`;
}

/** Post-game review for Relay Checkers: alpha-beta engine in the browser, eval bar, best-move arrow, move grades. */
export function CheckersAnalysisScreen({ game, onBack, onMainMenu }: { game: FinishedGame; onBack: () => void; onMainMenu: () => void }) {
  const fens = useMemo(() => [game.moves[0]?.fenBefore ?? INITIAL_CHECKERS_FEN, ...game.moves.map((m) => m.fenAfter ?? '')], [game]);
  const [index, setIndex] = useState(fens.length - 1);
  const [evals, setEvals] = useState<Array<Ev | undefined>>([]);
  const [flipped, setFlipped] = useState(false);

  // Analyse one position per tick so the page stays responsive; current position first.
  useEffect(() => {
    let cancelled = false;
    const todo = [index, ...fens.map((_, i) => i).filter((i) => i !== index)];
    const done = new Set<number>(evals.flatMap((e, i) => (e ? [i] : [])));
    const step = () => {
      if (cancelled) return;
      const i = todo.find((k) => !done.has(k));
      if (i === undefined) return;
      done.add(i);
      const pos = parseFen(fens[i]!);
      if (pos) {
        const r = searchCheckers(pos, { maxNodes: 25000 });
        setEvals((prev) => { const next = [...prev]; next[i] = { score: r.score, best: r.best ? { from: r.best.from, to: r.best.to } : null, depth: r.depth }; return next; });
      }
      setTimeout(step, 0);
    };
    const t = setTimeout(step, 0);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, fens]);

  const grades = game.moves.map((m, j) => {
    const before = evals[j]; const after = evals[j + 1];
    const pos = parseFen(fens[j]!);
    if (!before || !after || !pos) return null;
    return gradeCheckersMove(before.score, after.score, pos.turn, legalMoves(pos).length === 1);
  });
  const ev = evals[index];
  const whitePct = ev ? Math.max(4, Math.min(96, 50 + 50 * Math.tanh(ev.score / 400))) : 50;
  const last = game.moves[index - 1];

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      else if (e.key === 'ArrowRight') setIndex((i) => Math.min(fens.length - 1, i + 1));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [fens.length]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-4 px-4 pt-14 pb-6 sm:px-8" data-testid="checkers-analysis">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-serif text-3xl">Checkers review</h1>
          <p className="text-sm text-cream-dim">{game.headline} · {game.white.join(', ')} vs {game.black.join(', ')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setFlipped((f) => !f)}>Flip</Button>
          <Button variant="outline" size="sm" onClick={onBack}>Back</Button>
          <Button variant="ghost" size="sm" onClick={onMainMenu}>Main menu</Button>
        </div>
      </header>
      <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)_18rem]">
        <div className="relative hidden w-6 overflow-hidden rounded-md border border-white/15 bg-neutral-900 md:block" data-testid="checkers-eval-bar" title={ev ? evalText(ev.score) : 'Thinking…'}>
          <div className="absolute inset-x-0 bottom-0 bg-[#f4ead8] transition-[height] duration-300" style={{ height: `${flipped ? 100 - whitePct : whitePct}%` }} />
        </div>
        <div className="mx-auto w-full max-w-[min(100%,72dvh)]">
          <div className="mb-2 flex items-center gap-2 text-sm md:hidden">
            <div className="h-3 flex-1 overflow-hidden rounded bg-neutral-900"><div className="h-full bg-[#f4ead8]" style={{ width: `${whitePct}%` }} /></div>
          </div>
          <Board fen={fens[index]!} orientation={flipped ? 'black' : 'white'} legalMoves={[]} lastMove={last ? { from: last.from, to: last.to } : undefined}
            inCheck={false} interactive={false} hints={ev?.best && index < fens.length ? [ev.best] : []} variant="checkers" onMove={() => {}} />
          <div className="mt-3 flex items-center justify-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setIndex(0)}>⏮</Button>
            <Button size="sm" variant="outline" onClick={() => setIndex((i) => Math.max(0, i - 1))} data-testid="ck-prev">◀</Button>
            <span className="tabular w-36 text-center text-sm" data-testid="checkers-eval">{ev ? `${evalText(ev.score)} · depth ${ev.depth}` : 'Thinking…'}</span>
            <Button size="sm" variant="outline" onClick={() => setIndex((i) => Math.min(fens.length - 1, i + 1))} data-testid="ck-next">▶</Button>
            <Button size="sm" variant="outline" onClick={() => setIndex(fens.length - 1)}>⏭</Button>
          </div>
          {ev?.best && <p className="mt-1 text-center text-xs text-cream-dim">Engine's best: {ev.best.from}–{ev.best.to} (arrow)</p>}
        </div>
        <section className="rounded-2xl border border-white/10 bg-black/20 p-3">
          <h2 className="text-xs tracking-[0.16em] text-cream/55 uppercase">Moves</h2>
          <ol className="mt-2 max-h-[60dvh] space-y-1 overflow-y-auto text-sm" data-testid="checkers-analysis-moves">
            <li><button className={cn('rounded px-1 text-cream/50', index === 0 && 'bg-white/15')} onClick={() => setIndex(0)}>Start</button></li>
            {game.moves.map((m, j) => (
              <li key={j}>
                <button className={cn('w-full rounded px-1 text-left hover:bg-white/10', index === j + 1 && 'bg-white/15')} onClick={() => setIndex(j + 1)} data-testid={`ck-move-${j}`}>
                  <span className="text-cream/40">{j + 1}.</span> <span className="font-medium">{m.san}</span>
                  {grades[j] && <span className={cn('ml-1 font-semibold', GRADE_CLASS[grades[j]!])} title={grades[j]!}>{GRADE_MARK[grades[j]!]}</span>}
                  <span className="ml-2 text-[10px] tracking-wide text-cream/45 uppercase">{m.name ?? m.seat}</span>
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] text-cream/45">‼ best · ! good · ?! inaccuracy · ? mistake · ?? blunder. ←/→ step.</p>
        </section>
      </div>
    </div>
  );
}
