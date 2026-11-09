import { useDoing } from '@/lib/doing';
import { TopTab } from '@/components/TopTabs';
import { useWindowDrag } from '@/lib/windowDrag';
import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from '@/lib/net';
import {
  LM_CHIP_DAILY_CAP, LM_CHIP_PER, LM_CHIP_ROUND_MAX, LM_LABEL, LM_MOVES, LM_SIZE,
  canSwap, lootMatchPayout, newLootMatch, trySwap, type LmState, type LmTile,
} from '../../../shared/lootMatch';

const OPEN_KEY = 'chud-lootmatch-open';
const PB_KEY = 'chud-lootmatch-pb';

type BoardRow = { name: string; best: number; games: number };

function loadPb(): number { try { return Math.max(0, Number(localStorage.getItem(PB_KEY)) || 0); } catch { return 0; } }
function savePb(n: number) { try { localStorage.setItem(PB_KEY, String(n)); } catch { /* */ } }

export function LootMatchPanel() {
  const winRef = useRef<HTMLDivElement>(null);
  const win = useWindowDrag('lootmatch', winRef);
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1');
  useDoing('lootmatch', null, open);
  useEffect(() => { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); }, [open]);
  const [game, setGame] = useState<LmState>(() => newLootMatch());
  const [sel, setSel] = useState<[number, number] | null>(null);
  const [pb, setPb] = useState(loadPb);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [todayPaid, setTodayPaid] = useState(0);
  const [dailyCap, setDailyCap] = useState(LM_CHIP_DAILY_CAP);
  const [token, setToken] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const touch = useRef<{ r: number; c: number; x: number; y: number } | null>(null);
  const submittedRef = useRef(false);
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;

  const refreshBoard = useCallback(() => {
    socket.emit('loot_match_board', {}, (r?: { ok?: boolean; board?: BoardRow[]; me?: { best: number; todayPaid?: number; dailyCap?: number } }) => {
      if (r?.ok && r.board) setBoard(r.board);
      if (r?.me?.best != null && r.me.best > pb) { setPb(r.me.best); savePb(r.me.best); }
      if (typeof r?.me?.todayPaid === 'number') setTodayPaid(r.me.todayPaid);
      if (typeof r?.me?.dailyCap === 'number') setDailyCap(r.me.dailyCap);
    });
  }, [pb]);
  useEffect(() => { if (open) refreshBoard(); }, [open, refreshBoard]);

  const beginRound = useCallback(() => {
    if (starting) return;
    setStarting(true); setMsg(null); setSel(null); submittedRef.current = false;
    socket.emit('loot_match_start', {}, (r?: {
      ok?: boolean; error?: string; token?: string; todayPaid?: number; dailyCap?: number;
    }) => {
      setStarting(false);
      if (!r?.ok || !r.token) {
        // Guests / unsigned: play locally without payout
        setToken(null); setGame(newLootMatch());
        if (r?.error && !/Sign in/i.test(r.error)) setMsg(r.error);
        else if (r?.error) setMsg('Playing for score only — sign in for chips.');
        return;
      }
      setToken(r.token);
      if (typeof r.todayPaid === 'number') setTodayPaid(r.todayPaid);
      if (typeof r.dailyCap === 'number') setDailyCap(r.dailyCap);
      setGame(newLootMatch());
    });
  }, [starting]);

  // Auto-start a token when the panel opens (signed-in players)
  useEffect(() => { if (open && !token) beginRound(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = useCallback((g: LmState) => {
    if (g.score > pb) { setPb(g.score); savePb(g.score); }
    const movesUsed = LM_MOVES - g.movesLeft;
    const tok = tokenRef.current;
    socket.emit('loot_match_submit', { score: g.score, movesUsed, token: tok }, (r?: {
      ok?: boolean; error?: string; best?: number; improved?: boolean; board?: BoardRow[];
      paid?: number; todayPaid?: number; dailyCap?: number;
    }) => {
      if (!r?.ok) { setMsg(r?.error ?? null); return; }
      if (r.board) setBoard(r.board);
      if (typeof r.best === 'number' && r.best > pb) { setPb(r.best); savePb(r.best); }
      if (typeof r.todayPaid === 'number') setTodayPaid(r.todayPaid);
      if (typeof r.dailyCap === 'number') setDailyCap(r.dailyCap);
      const pay = typeof r.paid === 'number' ? r.paid : 0;
      const base = r.improved ? `New personal best: ${g.score.toLocaleString('en-US')}!` : `Score ${g.score.toLocaleString('en-US')} saved.`;
      setMsg(pay > 0 ? `${base} +🪙 ${pay.toLocaleString('en-US')}` : base);
      setToken(null); // consume; next New round will start again
    });
  }, [pb]);

  useEffect(() => {
    if (game.movesLeft > 0 && game.status === 'playing') { submittedRef.current = false; return; }
    if (submittedRef.current) return;
    submittedRef.current = true;
    const g = { ...game, status: 'lost' as const };
    setGame(g);
    finish(g);
  }, [game.movesLeft, game.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const attempt = (a: [number, number], b: [number, number]) => {
    const next = trySwap(game, a, b);
    if (!next) { setSel(null); return; }
    setGame(next); setSel(null);
  };

  const onCell = (r: number, c: number) => {
    if (game.status !== 'playing') return;
    if (!sel) { setSel([r, c]); return; }
    if (sel[0] === r && sel[1] === c) { setSel(null); return; }
    if (canSwap(sel, [r, c])) attempt(sel, [r, c]);
    else setSel([r, c]);
  };

  const onTouchStart = (r: number, c: number, e: React.TouchEvent) => {
    const t = e.changedTouches[0]; if (!t) return;
    touch.current = { r, c, x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current; touch.current = null; if (!start || game.status !== 'playing') return;
    const t = e.changedTouches[0]; if (!t) return;
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    if (Math.hypot(dx, dy) < 24) { onCell(start.r, start.c); return; }
    const horiz = Math.abs(dx) >= Math.abs(dy);
    const b: [number, number] = horiz
      ? [start.r, start.c + (dx > 0 ? 1 : -1)]
      : [start.r + (dy > 0 ? 1 : -1), start.c];
    if (canSwap([start.r, start.c], b)) attempt([start.r, start.c], b);
  };

  const tileClass = (t: LmTile | null, r: number, c: number) => {
    const on = sel && sel[0] === r && sel[1] === c;
    return `lm-tile lm-${t?.kind ?? 'empty'}${t?.special ? ` lm-sp-${t.special}` : ''}${on ? ' lm-sel' : ''}`;
  };

  const est = lootMatchPayout(game.score);

  return (
    <div className={`lm-wrap ${open ? 'lm-open' : ''}`} data-testid="lootmatch">
      <TopTab id="lootmatch"><button type="button" className="lm-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="lootmatch-tab">
        💎 Loot Match <span aria-hidden>{open ? '▾' : '▴'}</span>
      </button></TopTab>
      {open && (
        <div className={'lm-panel' + win.className} role="dialog" aria-label="Loot Match" ref={winRef} style={win.style} onPointerDownCapture={win.front} onPointerMove={win.onPanelMove} data-testid="lootmatch-panel">
          {win.grips}
          <div className="lm-bar">
            <span {...win.bar}><b>💎 Loot Match</b></span>
            <small>Match 3+ · {game.movesLeft} moves · Score {game.score.toLocaleString('en-US')} · Best {pb.toLocaleString('en-US')}</small>
            {win.moved && <button type="button" className="win-reset" aria-label="Reset window position" onClick={win.reset}>⟲</button>}
            <button type="button" aria-label="Minimize" onClick={() => setOpen(false)}>✕</button>
          </div>
          <p className="lm-help">
            Swap neighboring tiles to make lines of 3+. Four makes a rocket, five a prism. Cascades keep scoring.
            Finish all {LM_MOVES} moves for chips: 🪙 1 per {LM_CHIP_PER} pts (max {LM_CHIP_ROUND_MAX}/round).
            {' '}<span data-testid="lootmatch-today">Today: {todayPaid.toLocaleString('en-US')} / {dailyCap.toLocaleString('en-US')}</span>
          </p>
          <div className="lm-grid" style={{ gridTemplateColumns: `repeat(${LM_SIZE}, 1fr)` }} data-testid="lootmatch-grid">
            {game.board.map((row, r) => row.map((t, c) => (
              <button
                key={t?.id ?? `e-${r}-${c}`}
                type="button"
                className={tileClass(t, r, c)}
                aria-label={t ? `${LM_LABEL[t.kind].name}${t.special ? ` ${t.special}` : ''}` : 'empty'}
                onClick={() => onCell(r, c)}
                onTouchStart={(e) => onTouchStart(r, c, e)}
                onTouchEnd={onTouchEnd}
                disabled={game.status !== 'playing'}
              >{t ? (t.special === 'rocket' ? '🚀' : t.special === 'bomb' ? '💥' : t.special === 'prism' ? '🔮' : LM_LABEL[t.kind].emoji) : ''}</button>
            )))}
          </div>
          <div className="lm-actions">
            <button type="button" data-testid="lootmatch-new" disabled={starting} onClick={() => beginRound()}>
              {starting ? 'Starting…' : 'New round'}
            </button>
            {game.status === 'playing' && est > 0 && <small>Est. 🪙 {est} this round</small>}
            {game.status !== 'playing' && <small role="status">Round over — {game.score.toLocaleString('en-US')} pts</small>}
            {msg && <small role="status" data-testid="lootmatch-msg">{msg}</small>}
          </div>
          <div className="lm-board" data-testid="lootmatch-leaders">
            <b>Leaderboard</b>
            {!board.length && <small className="chat-dim">No scores yet — finish a round while signed in.</small>}
            <ol>{board.slice(0, 10).map((r, i) => <li key={r.name}><span>#{i + 1} {r.name}</span><span>{r.best.toLocaleString('en-US')}</span></li>)}</ol>
          </div>
        </div>
      )}
    </div>
  );
}
