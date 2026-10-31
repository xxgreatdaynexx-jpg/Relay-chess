import { TopTab } from '@/components/TopTabs';
import { useWindowDrag } from '@/lib/windowDrag';
import { useEffect, useRef, useState } from 'react';
import { deal, draw, isValidState, isWon, move, type GameState, type Loc, type Target } from '@/solitaire/logic';
import { playCardFlick, playSolitaireWin } from '@/lib/sounds';
import { KlondikeBoard } from '@/solitaire/Board';
import { SolitroGame } from '@/solitaire/Solitro';
export { CardFace } from '@/solitaire/Board';

const KEY = 'relay-solitaire-v1';
const OPEN_KEY = 'relay-solitaire-open';
const MODE_KEY = 'relay-solitaire-mode';
export type SolMode = 'solitro' | 'classic';
interface Saved { game: GameState; history: GameState[] }

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && isValidState(raw.game)) return { game: raw.game, history: Array.isArray(raw.history) ? raw.history.filter(isValidState).slice(-60) : [] };
  } catch { /* ignore */ }
  return { game: deal(), history: [] };
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
  const [{ game, history }, setSaved] = useState<Saved>(load);
  const [now, setNow] = useState(Date.now());
  const won = isWon(game);
  const [wonAt, setWonAt] = useState<number | null>(null);
  useEffect(() => { localStorage.setItem(KEY, JSON.stringify({ game, history: history.slice(-60) })); }, [game, history]);
  useEffect(() => {
    if (won) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [won]);
  useEffect(() => {
    if (won && wonAt === null) { setWonAt(Date.now()); playSolitaireWin(); }
    if (!won && wonAt !== null) setWonAt(null);
  }, [won, wonAt]);
  function commit(next: GameState | null) {
    if (!next) return false;
    setSaved((prev) => ({ game: next, history: [...prev.history, prev.game].slice(-60) }));
    playCardFlick();
    return true;
  }
  function newGame() { setSaved({ game: deal(), history: [] }); setWonAt(null); }
  function undo() { setSaved((p) => (p.history.length ? { game: p.history[p.history.length - 1], history: p.history.slice(0, -1) } : p)); }
  const elapsed = Math.max(0, Math.floor(((wonAt ?? now) - game.startedAt) / 1000));
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
      </KlondikeBoard>
    </>
  );
}
