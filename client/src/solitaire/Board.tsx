import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { autoTarget, pickup, isRed, type Card, type GameState, type Loc, type Target } from '@/solitaire/logic';

const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SYM: Record<Card['suit'], string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

export function CardFace({ card, style, extra }: { card: Card; style?: React.CSSProperties; extra?: string }) {
  if (!card.faceUp) return <div className="sol-card sol-back" style={style} />;
  const red = isRed(card.suit);
  return (
    <div className={`sol-card sol-face ${red ? 'text-[#c0262d]' : 'text-[#14171a]'} ${extra ?? ''}`} style={style}>
      <span className="sol-corner">{RANKS[card.rank]}<br />{SYM[card.suit]}</span>
      <span className="sol-pip">{SYM[card.suit]}</span>
    </div>
  );
}

interface Drag { from: Loc; cards: Card[]; x: number; y: number; dx: number; dy: number; w: number; started: boolean; sx: number; sy: number }

/** Klondike table with drag-and-drop and tap-to-auto-move. Rules are checked by the caller's onMove. */
export function KlondikeBoard({ game, onMove, onDraw, decorate, children, stockHint }: {
  game: GameState;
  onMove: (from: Loc, to: Target) => void;
  onDraw: () => void;
  decorate?: (c: Card) => string | undefined;
  children?: React.ReactNode;
  stockHint?: React.ReactNode;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [down, setDown] = useState(8);
  const [up, setUp] = useState(18);

  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth / 7;
      const h = w * 1.4;
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
  }, [game]);

  function auto(from: Loc) { const t = autoTarget(game, from); if (t) onMove(from, t); }
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
          onMove(d.from, { kind: kind as Target['kind'], index: Number(i) } as Target);
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
  const wasteTop = game.waste[game.waste.length - 1];
  const deco = (c: Card) => (c.faceUp ? decorate?.(c) : undefined);

  return (
    <div className="sol-table" ref={tableRef}>
      <div className="sol-row">
        <div className="sol-slot" onClick={onDraw} data-testid="sol-stock">
          {game.stock.length ? <CardFace card={game.stock[game.stock.length - 1]} /> : <div className="sol-card sol-empty">↻</div>}
          {stockHint}
        </div>
        <div className="sol-slot">
          {game.waste.length > 1 && <CardFace card={game.waste[game.waste.length - 2]} extra={deco(game.waste[game.waste.length - 2])} />}
          {wasteTop && !dragging(wasteTop.id) && (
            <div className="sol-hit" onPointerDown={(e) => onDown(e, { kind: 'waste' })} onDoubleClick={() => auto({ kind: 'waste' })}><CardFace card={wasteTop} extra={deco(wasteTop)} /></div>
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
              {under && dragging(top.id) && <CardFace card={under} extra={deco(under)} />}
              {top && !dragging(top.id) && <div className="sol-hit" data-drop={`foundation:${i}`} onPointerDown={(e) => onDown(e, { kind: 'foundation', index: i })}><CardFace card={top} extra={deco(top)} /></div>}
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
                  <CardFace card={c} extra={deco(c)} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {children}
      {drag?.started && createPortal(
        <div className="sol-ghost" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }}>
          {drag.cards.map((c, k) => <div key={c.id} className="sol-hit" style={{ top: k * up }}><CardFace card={c} extra={deco(c)} /></div>)}
        </div>,
        document.body,
      )}
    </div>
  );
}
