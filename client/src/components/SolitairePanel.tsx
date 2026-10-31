import { TopTab } from '@/components/TopTabs';
import { useWindowDrag } from '@/lib/windowDrag';
import { useEffect, useRef, useState } from 'react';
import { deal, draw, isStuck, isValidState, isWon, move, type GameState, type Loc, type Target } from '@/solitaire/logic';
import { playCardFlick, playSolitaireWin } from '@/lib/sounds';
import { KlondikeBoard } from '@/solitaire/Board';
import { SolitroGame } from '@/solitaire/Solitro';
export { CardFace } from '@/solitaire/Board';

const KEY = 'relay-solitaire-v1';
const OPEN_KEY = 'relay-solitaire-open';
const MODE_KEY = 'relay-solitaire-mode';
export type SolMode = 'solitro' | 'classic';
interface Saved { game: GameState; history: GameState[]; secs: number }

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && isValidState(raw.game)) return { game: raw.game, history: Array.isArray(raw.history) ? raw.history.filter(isValidState).slice(-60) : [], secs: Number.isFinite(raw.secs) && raw.secs >= 0 ? Math.floor(raw.secs) : 0 };
  } catch { /* ignore */ }
  return { game: deal(), history: [], secs: 0 };
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, '0')}`;
}

export function ModeToggle({ mode, setMode }: { mode: SolMode; setMode: (m: SolMode) => void }) {
  return (
    <span className="sto-toggle" role="group" aria-label="Solitaire mode">
      <button type="button" aria-pressed={mode === 'solitro'} onClick={() => setMode('solitro')} data-testid="mode-solitro">Solitro</button>
      <button type="button" aria-pressed={mode === 'classic'} onClick={() => setMode('classic')} data-testid="mode-classic">Classic</button>
    </span>
  );
}

/** Pull-up solitaire panel, fixed bottom-right on every screen: Solitro (roguelike run) or Classic Klondike (draw 1). */
export function SolitairePanel() {
  const winRef = useRef<HTMLDivElement>(null);
  const win = useWindowDrag('solitaire', winRef);
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1');
  const [mode, setMode] = useState<SolMode>(() => (localStorage.getItem(MODE_KEY) === 'classic' ? 'classic' : 'solitro'));
  useEffect(() => { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); }, [open]);
  useEffect(() => { localStorage.setItem(MODE_KEY, mode); }, [mode]);
  const tail = (
    <>
      {win.moved && <button type="button" className="win-reset" aria-label="Reset window position" title="Reset position" onClick={win.reset}>⟲</button>}
      <button type="button" aria-label="Minimize solitaire" onClick={() => setOpen(false)}>✕</button>
    </>
  );
  return (
    <div className={`sol-wrap ${open ? 'sol-open' : ''}`} data-testid="solitaire">
      <TopTab id="solitaire"><button type="button" className="sol-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="solitaire-tab">
        🃏 Solitaire <span aria-hidden>{open ? '▾' : '▴'}</span>
      </button></TopTab>
      {open && (
        <div className={'sol-panel' + (mode === 'solitro' ? ' sto-panel' : '') + win.className} role="dialog" aria-label="Solitaire" ref={winRef} style={win.style} onPointerDownCapture={win.front} onPointerMove={win.onPanelMove}>
          {win.grips}
          {mode === 'classic'
            ? <ClassicGame bar={win.bar} toggle={<ModeToggle mode={mode} setMode={setMode} />} tail={tail} />
            : <SolitroGame bar={win.bar} toggle={<ModeToggle mode={mode} setMode={setMode} />} tail={tail} />}
        </div>
      )}
    </div>
  );
}

type BarProps = Record<string, unknown>;
function ClassicGame({ bar, toggle, tail }: { bar: BarProps; toggle: React.ReactNode; tail: React.ReactNode }) {
  const [{ game, history, secs }, setSaved] = useState<Saved>(load);
  const won = isWon(game);
  const stuck = !won && isStuck(game, true);
  // The clock counts seconds of play for this deal only: it starts at 0:00, begins with the first move and pauses while
  // the window is closed, so an old saved deal (or a deal's wall-clock start time) can never show hours.
  const running = !won && !stuck && game.moves > 0;
  useEffect(() => { localStorage.setItem(KEY, JSON.stringify({ game, history: history.slice(-60), secs })); }, [game, history, secs]);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setSaved((p) => ({ ...p, secs: p.secs + 1 })), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  const wonRef = useRef(won);
  useEffect(() => {
    if (won && !wonRef.current) playSolitaireWin();
    wonRef.current = won;
  }, [won]);
  function commit(next: GameState | null) {
    if (!next) return false;
    setSaved((prev) => ({ game: next, history: [...prev.history, prev.game].slice(-60), secs: prev.secs }));
    playCardFlick();
    return true;
  }
  function newGame() { setSaved({ game: deal(), history: [], secs: 0 }); }
  function undo() { setSaved((p) => (p.history.length ? { game: p.history[p.history.length - 1], history: p.history.slice(0, -1), secs: p.secs } : p)); }
  const elapsed = secs;
  return (
    <>
      <div {...bar}>
        {toggle}
        <button type="button" onClick={newGame}>New</button>
        <button type="button" onClick={undo} disabled={!history.length}>Undo</button>
        <span className="ml-auto tabular-nums">Moves {game.moves} · ⏱ {fmt(elapsed)}</span>
        {tail}
      </div>
      <KlondikeBoard game={game} onMove={(from: Loc, to: Target) => commit(move(game, from, to))} onDraw={() => commit(draw(game))}>
        {won && (
          <div className="sol-win" data-testid="sol-win">
            <div className="text-4xl">🎉🏆🎉</div>
            <div className="mt-1 font-serif text-2xl">You won!</div>
            <div className="text-sm opacity-80">{game.moves} moves · {fmt(elapsed)}</div>
            <button type="button" className="mt-3" onClick={newGame}>Deal again</button>
          </div>
        )}
        {stuck && (
          <div className="sol-win sto-stuck" data-testid="sol-stuck" role="alert">
            <div className="text-3xl">🚫</div>
            <div className="mt-1 font-serif text-2xl">No moves left</div>
            <div className="text-sm opacity-80">Nothing in the stock or on the table can be played.</div>
            <div className="mt-3 flex justify-center gap-2">
              <button type="button" onClick={undo} disabled={!history.length}>Undo</button>
              <button type="button" onClick={newGame}>Deal again</button>
            </div>
          </div>
        )}
      </KlondikeBoard>
    </>
  );
}
