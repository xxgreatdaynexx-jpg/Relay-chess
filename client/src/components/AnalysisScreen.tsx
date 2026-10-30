import { Chess } from 'chess.js';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Copy, FlipVertical2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Board } from '@/components/Board';
import { Button } from '@/components/ui/button';
import { socket, request } from '@/lib/net';
import { gameToPgn, START_FEN, type FinishedGame } from '@/lib/lastGame';
import { cn } from '@/lib/utils';
import {
  analyzeMove,
  evalCp,
  LABEL_GLYPH,
  summarizePlayers,
  winPercent,
  type AnalyzedMove,
  type Evaluation,
  type MoveLabel,
} from '../../../shared/analysis';
import { seatLabel, seatsFor, seatSide, type LegalMove, type Promotion } from '../../../shared/types';

interface Ply {
  san: string;
  from: string;
  to: string;
  fenBefore: string;
  fenAfter: string;
}

interface Variation {
  /** Game position index the variation branches from. */
  base: number;
  plies: Ply[];
  /** How many variation plies are shown (0..plies.length). */
  cursor: number;
}

const LABEL_CLASS: Record<MoveLabel, string> = {
  best: 'text-teal-300',
  good: 'text-green-400',
  inaccuracy: 'text-yellow-300',
  mistake: 'text-orange-400',
  blunder: 'text-red-400',
};

function buildPositions(game: FinishedGame): { start: string; plies: Ply[] } {
  const start = game.moves[0]?.fenBefore ?? START_FEN;
  const chess = new Chess(start);
  const plies: Ply[] = [];
  for (const move of game.moves) {
    let before = move.fenBefore;
    if (!before) before = chess.fen();
    let after = move.fenAfter;
    if (!after) {
      try {
        chess.load(before);
        chess.move(move.san);
        after = chess.fen();
      } catch {
        after = before;
      }
    }
    chess.load(after);
    plies.push({ san: move.san, from: move.from, to: move.to, fenBefore: before, fenAfter: after });
  }
  return { start, plies };
}

function legalFor(fen: string): LegalMove[] {
  try {
    const chess = new Chess(fen);
    if (chess.isGameOver()) return [];
    return chess.moves({ verbose: true }).map((m) => ({
      from: m.from,
      to: m.to,
      san: m.san,
      ...(m.promotion ? { promotion: m.promotion as Promotion } : {}),
    }));
  } catch {
    return [];
  }
}

function formatEval(evaluation: Evaluation | undefined): string {
  if (!evaluation) return '…';
  if (evaluation.mate !== null) {
    if (evaluation.mate === 0) return '#';
    return `${evaluation.mate > 0 ? '' : '-'}M${Math.abs(evaluation.mate)}`;
  }
  const pawns = (evaluation.cp ?? 0) / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`;
}

function uciOf(ply: { from: string; to: string; san: string }): string {
  const promo = ply.san.match(/=([QRBN])/);
  return `${ply.from}${ply.to}${promo ? promo[1].toLowerCase() : ''}`;
}

export function AnalysisScreen({
  game,
  inRoom,
  onBack,
  onMainMenu,
}: {
  game: FinishedGame;
  inRoom: boolean;
  onBack: () => void;
  onMainMenu: () => void;
}) {
  const { start, plies } = useMemo(() => buildPositions(game), [game]);
  const setup = { mode: game.mode, pairSide: game.pairSide };
  const active = seatsFor(setup);
  const [index, setIndex] = useState(plies.length);
  const [variation, setVariation] = useState<Variation | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [evals, setEvals] = useState<Record<string, Evaluation>>({});
  const [copied, setCopied] = useState(false);
  const [engineDown, setEngineDown] = useState(false);
  const queueBusy = useRef(false);
  const failed = useRef(new Set<string>());

  const gameFens = useMemo(() => [start, ...plies.map((p) => p.fenAfter)], [start, plies]);
  const fen = variation
    ? variation.cursor === 0
      ? gameFens[variation.base]
      : variation.plies[variation.cursor - 1].fenAfter
    : gameFens[index];
  const lastPly = variation
    ? variation.cursor > 0
      ? variation.plies[variation.cursor - 1]
      : plies[variation.base - 1]
    : plies[index - 1];

  // Ask the server engine for one position at a time: the current one first, then the game line.
  useEffect(() => {
    if (!socket.connected) socket.connect();
  }, []);
  useEffect(() => {
    if (queueBusy.current) return;
    const wanted = [fen, ...plies.flatMap((p) => [p.fenBefore, p.fenAfter])];
    const next = wanted.find((f) => !evals[f] && !failed.current.has(f));
    if (!next) return;
    queueBusy.current = true;
    void request('analyze', { fen: next }).then((ack) => {
      queueBusy.current = false;
      if (ack.ok && ack.evaluation) {
        setEngineDown(false);
        setEvals((prev) => ({ ...prev, [next]: ack.evaluation as Evaluation }));
      } else {
        failed.current.add(next);
        if (!ack.ok) setEngineDown(true);
        setEvals((prev) => ({ ...prev }));
      }
    });
  }, [fen, evals, plies]);

  const analyzed: (AnalyzedMove | null)[] = useMemo(
    () =>
      plies.map((ply, i) => {
        const before = evals[ply.fenBefore];
        const after = evals[ply.fenAfter];
        if (!before || !after) return null;
        return analyzeMove(before, after, seatSide(game.moves[i].seat), uciOf(ply));
      }),
    [plies, evals, game.moves],
  );
  const summary = useMemo(() => summarizePlayers(game.moves, analyzed), [game.moves, analyzed]);
  const done = analyzed.filter(Boolean).length;

  const current = evals[fen];
  const best = current?.best;
  const hints = best ? [{ from: best.slice(0, 2), to: best.slice(2, 4) }] : [];
  const whitePct = current ? winPercent(evalCp(current)) : 50;
  const inCheck = useMemo(() => {
    try {
      return new Chess(fen).isCheck();
    } catch {
      return false;
    }
  }, [fen]);

  function go(target: number) {
    setVariation(null);
    setIndex(Math.max(0, Math.min(plies.length, target)));
  }
  function step(delta: number) {
    if (variation) {
      const cursor = variation.cursor + delta;
      if (cursor < 0) {
        go(variation.base - 1);
        return;
      }
      setVariation({ ...variation, cursor: Math.min(variation.plies.length, cursor) });
      return;
    }
    go(index + delta);
  }

  function play(move: { from: string; to: string; promotion?: Promotion }) {
    const chess = new Chess(fen);
    let played;
    try {
      played = chess.move({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
    } catch {
      return;
    }
    const ply: Ply = { san: played.san, from: played.from, to: played.to, fenBefore: fen, fenAfter: chess.fen() };
    if (!variation) {
      const main = plies[index];
      if (main && main.san === ply.san && main.fenBefore === fen) {
        setIndex(index + 1);
        return;
      }
      setVariation({ base: index, plies: [ply], cursor: 1 });
      return;
    }
    const kept = variation.plies.slice(0, variation.cursor);
    setVariation({ ...variation, plies: [...kept, ply], cursor: kept.length + 1 });
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      if (event.key === 'ArrowLeft') step(-1);
      else if (event.key === 'ArrowRight') step(1);
      else if (event.key === 'ArrowUp' || event.key === 'Home') go(0);
      else if (event.key === 'ArrowDown' || event.key === 'End') go(plies.length);
      else if (event.key === 'f') setFlipped((v) => !v);
      else return;
      event.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function copyPgn() {
    const pgn = gameToPgn(game);
    try {
      await navigator.clipboard.writeText(pgn);
    } catch {
      const area = document.createElement('textarea');
      area.value = pgn;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const shownIndex = variation ? variation.base : index;
  const currentLabel = !variation && index > 0 ? analyzed[index - 1] : null;
  const rows: number[] = [];
  for (let i = 0; i < plies.length; i += 2) rows.push(i);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-3 px-3 py-4 sm:px-6" data-testid="analysis">
      <div className="flex flex-wrap items-center justify-between gap-2 pl-24 sm:pl-28">
        <div>
          <p className="text-xs tracking-[0.16em] text-cream/55 uppercase">Analysis · {game.mode}</p>
          <h1 className="font-serif text-2xl">
            {game.headline} <span className="text-base text-cream-dim">{game.detail}</span>
          </h1>
        </div>
        <div className="flex gap-2 pr-24 sm:pr-28">
          <Button variant="outline" size="sm" onClick={onBack} data-testid="analysis-back">
            {inRoom ? 'Back to table' : 'Back'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onMainMenu} data-testid="analysis-menu">
            Main Menu
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex gap-2">
          <div
            className="relative w-5 shrink-0 overflow-hidden rounded-md border border-white/15 bg-[#1b1b1b]"
            title={formatEval(current)}
            data-testid="eval-bar"
          >
            <div
              className="absolute inset-x-0 bg-[#f3ecdc] transition-all duration-500"
              style={
                (flipped ? { top: 0, height: `${whitePct}%` } : { bottom: 0, height: `${whitePct}%` })
              }
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="rounded bg-black/40 px-2 py-0.5 font-mono text-lg" data-testid="eval-number">
                {formatEval(current)}
              </span>
              <span className="text-cream-dim">
                {best ? `Best: ${sanOf(fen, best)}` : current ? 'Game over' : 'Engine thinking…'}
                {currentLabel && (
                  <span className={cn('ml-2 font-semibold', LABEL_CLASS[currentLabel.label])}>
                    {lastPly?.san} {LABEL_GLYPH[currentLabel.label]} {currentLabel.label}
                  </span>
                )}
              </span>
            </div>
            <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-230px))]">
              <Board
                fen={fen}
                orientation={flipped ? 'black' : 'white'}
                legalMoves={legalFor(fen)}
                lastMove={lastPly ? { from: lastPly.from, to: lastPly.to } : undefined}
                inCheck={inCheck}
                interactive
                hints={hints}
                onMove={play}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => go(0)} aria-label="Start" data-testid="an-start">
                <ChevronFirst className="size-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => step(-1)} aria-label="Back" data-testid="an-back">
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => step(1)} aria-label="Forward" data-testid="an-forward">
                <ChevronRight className="size-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => go(plies.length)} aria-label="End" data-testid="an-end">
                <ChevronLast className="size-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setFlipped((v) => !v)} data-testid="an-flip">
                <FlipVertical2 className="size-4" /> Flip
              </Button>
              <Button variant="outline" size="sm" onClick={() => void copyPgn()} data-testid="copy-pgn">
                <Copy className="size-4" /> {copied ? 'Copied!' : 'Copy PGN'}
              </Button>
              {variation && (
                <Button size="sm" onClick={() => go(variation.base)} data-testid="back-to-line">
                  Back to game line
                </Button>
              )}
            </div>
            {variation && (
              <p className="mt-2 text-center text-sm text-cream-dim" data-testid="variation">
                Variation: {variation.plies.slice(0, variation.cursor).map((p) => p.san).join(' ') || '(start)'} — just you, nothing is sent to the table.
              </p>
            )}
          </div>
        </div>

        <aside className="flex flex-col gap-3">
          <section className="rounded-2xl border border-white/10 bg-panel/70 p-3">
            <h2 className="text-xs tracking-[0.16em] text-cream/55 uppercase">
              Players {done < plies.length ? `· analyzing ${done}/${plies.length}` : ''}
            </h2>
            {engineDown && <p className="mt-1 text-xs text-amber-200">The engine is busy; some moves are unrated.</p>}
            <table className="mt-2 w-full text-sm" data-testid="summary">
              <thead className="text-left text-[10px] tracking-wide text-cream/45 uppercase">
                <tr>
                  <th>Player</th>
                  <th className="text-right">Acc</th>
                  <th className="text-right">ACPL</th>
                  <th className="text-right">‼</th>
                  <th className="text-right">??</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row) => (
                  <tr key={row.key}>
                    <td>
                      {row.name}
                      <span className="ml-1 text-[10px] text-cream/45 uppercase">{seatLabel(row.seat, active)}</span>
                    </td>
                    <td className="text-right">{row.moves ? `${row.accuracy}%` : '–'}</td>
                    <td className="text-right">{row.moves ? row.acpl : '–'}</td>
                    <td className="text-right">{row.best}</td>
                    <td className="text-right">{row.blunders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <h2 className="text-xs tracking-[0.16em] text-cream/55 uppercase">Moves</h2>
            <ol className="mt-2 max-h-[55dvh] space-y-1 overflow-y-auto pr-1 text-sm" data-testid="analysis-moves">
              <li>
                <button
                  className={cn('rounded px-1 text-cream/50', shownIndex === 0 && !variation && 'bg-white/15')}
                  onClick={() => go(0)}
                >
                  Start
                </button>
              </li>
              {rows.map((i) => (
                <li key={i} className="grid grid-cols-[2rem_1fr_1fr] gap-1">
                  <span className="text-cream/40">{Math.floor(i / 2) + 1}.</span>
                  {[i, i + 1].map((j) =>
                    j < plies.length ? (
                      <button
                        key={j}
                        data-testid={`an-move-${j}`}
                        onClick={() => go(j + 1)}
                        className={cn(
                          'rounded px-1 text-left hover:bg-white/10',
                          !variation && index === j + 1 && 'bg-white/15',
                          variation && variation.base === j + 1 && 'ring-1 ring-white/30',
                        )}
                      >
                        <span className="font-medium">{plies[j].san}</span>
                        {analyzed[j] && (
                          <span className={cn('ml-1 font-semibold', LABEL_CLASS[analyzed[j]!.label])}>
                            {LABEL_GLYPH[analyzed[j]!.label]}
                          </span>
                        )}
                        <span className="block text-[10px] tracking-wide text-cream/45 uppercase">
                          {game.moves[j].name ?? '?'} · {seatLabel(game.moves[j].seat, active)}
                        </span>
                      </button>
                    ) : (
                      <span key={j} />
                    ),
                  )}
                </li>
              ))}
            </ol>
            <p className="mt-2 text-[11px] text-cream/45">
              ‼ best · ! good · ?! inaccuracy · ? mistake · ?? blunder. Arrows/buttons step; drag pieces to try lines.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function sanOf(fen: string, uci: string): string {
  try {
    const chess = new Chess(fen);
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) }).san;
  } catch {
    return uci;
  }
}
