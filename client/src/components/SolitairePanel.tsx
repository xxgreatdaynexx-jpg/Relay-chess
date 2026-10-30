import { useEffect, useRef, useState } from 'react';
import { autoTarget, deal, draw, isValidState, isWon, move, pickup, isRed, type Card, type GameState, type Loc, type Target } from '@/solitaire/logic';
import { playCardFlick, playSolitaireWin } from '@/lib/sounds';

const KEY = 'relay-solitaire-v1';
const OPEN_KEY = 'relay-solitaire-open';
const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SYM: Record<Card['suit'], string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
interface Saved { game: GameState; history: GameState[] }

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && isValidState(raw.game)) return { game: raw.game, history: Array.isArray(raw.history) ? raw.history.filter(isValidState).slice(-60) : [] };
  } catch { /* ignore */ }
  return { game: deal(), history: [] };
}

interface Drag { from: Loc; cards: Card[]; x: number; y: number; dx: number; dy: number; w: number; started: boolean; sx: number; sy: number }

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, '0')}`;
}

export function CardFace({ card, style }: { card: Card; style?: React.CSSProperties }) {
  if (!card.faceUp) return <div className="sol-card sol-back" style={style} />;
  const red = isRed(card.suit);
  return (
    <div className={`sol-card sol-face ${red ? 'text-[#c0262d]' : 'text-[#14171a]'}`} style={style}>
      <span className="sol-corner">{RANKS[card.rank]}<br />{SYM[card.suit]}</span>
      <span className="sol-pip">{SYM[card.suit]}</span>
    </div>
  );
}

/** Pull-up Klondike (draw 1) panel, fixed bottom-right on every screen. */
export function SolitairePanel() {
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1');
  const [{ game, history }, setSaved] = useState<Saved>(load);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [now, setNow] = useState(Date.now());
  const dragRef = useRef<Drag | null>(null);
  const won = isWon(game);
  const [wonAt, setWonAt] = useState<number | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [down, setDown] = useState(8);
  const [up, setUp] = useState(18);

  useEffect(() => { localStorage.setItem(KEY, JSON.stringify({ game, history: history.slice(-60) })); }, [game, history]);
  useEffect(() => { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); }, [open]);
  useEffect(() => {
    if (!open || won) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open, won]);
  useEffect(() => {
    if (won && wonAt === null) { setWonAt(Date.now()); playSolitaireWin(); }
    if (!won && wonAt !== null) setWonAt(null);
  }, [won, wonAt]);
  useEffect(() => {
    const el = tableRef.current;
    if (!open || !el) return;
    const fit = () => {
      const w = el.clientWidth / 7;
      const h = w * 1.4;
      // keep the longest pile inside available height
      const avail = el.clientHeight - h * 1.25 - 16;
      const longest = Math.max(...game.tableau.map((p) => p.length), 1);
      const scale = Math.min(1, avail / (longest * h * 0.26));
      setDown(Math.max(4, h * 0.12 * scale));
      setUp(Math.max(10, h * 0.26 * scale));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, game]);

  function commit(next: GameState | null) {
    if (!next) return false;
    setSaved((prev) => ({ game: next, history: [...prev.history, prev.game].slice(-60) }));
    playCardFlick();
    return true;
  }
  function newGame() { setSaved({ game: deal(), history: [] }); setWonAt(null); }
  function undo() { setSaved((p) => (p.history.length ? { game: p.history[p.history.length - 1], history: p.history.slice(0, -1) } : p)); }
  function auto(from: Loc) { const t = autoTarget(game, from); if (t) commit(move(game, from, t)); }

  function onDown(e: React.PointerEvent, from: Loc) {
    const cards = pickup(game, from);
    if (!cards || e.button > 0) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const d: Drag = { from, cards, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, started: false, sx: e.clientX, sy: e.clientY };
    dragRef.current = d;
    setDrag(d);
  }
  useEffect(() => {
    if (!drag) return;
    function mv(e: PointerEvent) {
      const d = dragRef.current; if (!d) return;
      const started = d.started || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6;
      dragRef.current = { ...d, x: e.clientX, y: e.clientY, started };
      setDrag(dragRef.current);
    }
    function upH(e: PointerEvent) {
      const d = dragRef.current; dragRef.current = null; setDrag(null);
      if (!d) return;
      if (!d.started) { auto(d.from); return; }
      const cx = e.clientX - d.dx + d.w / 2, cy = e.clientY - d.dy + 10;
      for (const el of document.elementsFromPoint(cx, cy)) {
        const t = (el as HTMLElement).dataset?.drop;
        if (t) {
          const [kind, i] = t.split(':');
          commit(move(game, d.from, { kind: kind as Target['kind'], index: Number(i) } as Target));
          return;
        }
      }
    }
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', upH);
    window.addEventListener('pointercancel', upH);
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', upH); window.removeEventListener('pointercancel', upH); };
  });

  const dragging = (id: string) => drag?.started && drag.cards.some((c) => c.id === id);
  const elapsed = Math.max(0, Math.floor(((wonAt ?? now) - game.startedAt) / 1000));
  const wasteTop = game.waste[game.waste.length - 1];

  return (
    <div className={`sol-wrap ${open ? 'sol-open' : ''}`} data-testid="solitaire">
      <button type="button" className="sol-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="solitaire-tab">
        🃏 Solitaire <span aria-hidden>{open ? '▾' : '▴'}</span>
      </button>
      {open && (
        <div className="sol-panel" role="dialog" aria-label="Solitaire">
          <div className="sol-bar">
            <button type="button" onClick={newGame}>New</button>
            <button type="button" onClick={undo} disabled={!history.length}>Undo</button>
            <span className="ml-auto tabular-nums">Moves {game.moves} · ⏱ {fmt(elapsed)}</span>
            <button type="button" aria-label="Minimize solitaire" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="sol-table" ref={tableRef}>
            <div className="sol-row">
              <div className="sol-slot" onClick={() => commit(draw(game))} data-testid="sol-stock">
                {game.stock.length ? <CardFace card={game.stock[game.stock.length - 1]} /> : <div className="sol-card sol-empty">↻</div>}
              </div>
              <div className="sol-slot">
                {game.waste.length > 1 && <CardFace card={game.waste[game.waste.length - 2]} />}
                {wasteTop && !dragging(wasteTop.id) && (
                  <div className="sol-hit" onPointerDown={(e) => onDown(e, { kind: 'waste' })} onDoubleClick={() => auto({ kind: 'waste' })}><CardFace card={wasteTop} /></div>
                )}
                {!game.waste.length && <div className="sol-card sol-empty" />}
              </div>
              <div className="sol-slot" />
              {game.foundations.map((p, i) => {
                const top = p[p.length - 1];
                const under = p[p.length - 2];
                return (
                  <div className="sol-slot" key={i} data-drop={`foundation:${i}`}>
                    <div className="sol-card sol-empty" data-drop={`foundation:${i}`}>A</div>
                    {under && (dragging(top.id)) && <CardFace card={under} />}
                    {top && !dragging(top.id) && <div className="sol-hit" data-drop={`foundation:${i}`} onPointerDown={(e) => onDown(e, { kind: 'foundation', index: i })}><CardFace card={top} /></div>}
                  </div>
                );
              })}
            </div>
            <div className="sol-row sol-tableau">
              {game.tableau.map((pile, i) => {
                let top = 0;
                const tops = pile.map((c) => { const t = top; top += c.faceUp ? up : down; return t; });
                return (
                  <div className="sol-pile" key={i} data-drop={`tableau:${i}`}>
                    <div className="sol-card sol-empty" data-drop={`tableau:${i}`} />
                    {pile.map((c, j) => (
                      <div key={c.id} className="sol-hit" data-drop={`tableau:${i}`} style={{ top: tops[j], visibility: dragging(c.id) ? 'hidden' : 'visible' }}
                        onPointerDown={c.faceUp ? (e) => onDown(e, { kind: 'tableau', index: i, cardIndex: j }) : undefined}
                        onDoubleClick={() => auto({ kind: 'tableau', index: i, cardIndex: j })}>
                        <CardFace card={c} />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            {won && (
              <div className="sol-win" data-testid="sol-win">
                <div className="text-4xl">🎉🏆🎉</div>
                <div className="mt-1 font-serif text-2xl">You won!</div>
                <div className="text-sm opacity-80">{game.moves} moves · {fmt(elapsed)}</div>
                <button type="button" className="mt-3" onClick={newGame}>Deal again</button>
              </div>
            )}
          </div>
        </div>
      )}
      {drag?.started && (
        <div className="sol-ghost" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }}>
          {drag.cards.map((c, k) => <div key={c.id} className="sol-hit" style={{ top: k * up }}><CardFace card={c} /></div>)}
        </div>
      )}
    </div>
  );
}
