import { useWindowDrag } from '@/lib/windowDrag';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CasinoLeaderboard, NamePrompt, ResetChips } from '@/components/CasinoCommon';
import { betKey, CHIP_VALUES, payoutOdds, RED, WHEEL, type RouletteBet, type RouletteKind, type RouletteView } from '../../../shared/casino';
import { emitCasino, useCountdown, useSavedName } from '@/lib/casino';
import { socket } from '@/lib/net';
import { playBallLand, playCardFlick, playRouletteSpin, playSolitaireWin } from '@/lib/sounds';

const OPEN_KEY = 'relay-roulette-open';
const SPIN_SECONDS = 5.6;

type Spot = { kind: RouletteKind; numbers: number[] };
const numAt = (col: number, row: number) => col * 3 + (3 - row); // row 0 = top (3, 6, ... 36)
const color = (n: number) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');

/** Hotspots for split/corner/street/line bets, positioned in cell units over the number grid. */
function hotspots(): { spot: Spot; x: number; y: number }[] {
  const out: { spot: Spot; x: number; y: number }[] = [];
  for (let c = 0; c < 12; c++) {
    for (let r = 0; r < 3; r++) {
      const n = numAt(c, r);
      if (c < 11) out.push({ spot: { kind: 'split', numbers: [n, n + 3] }, x: c + 1, y: r + 0.5 });
      if (r < 2) out.push({ spot: { kind: 'split', numbers: [n - 1, n] }, x: c + 0.5, y: r + 1 });
      if (r < 2 && c < 11) out.push({ spot: { kind: 'corner', numbers: [n - 1, n, n + 2, n + 3] }, x: c + 1, y: r + 1 });
    }
    out.push({ spot: { kind: 'street', numbers: [c * 3 + 1, c * 3 + 2, c * 3 + 3] }, x: c + 0.5, y: 3 });
    if (c < 11) out.push({ spot: { kind: 'line', numbers: [c * 3 + 1, c * 3 + 2, c * 3 + 3, c * 3 + 4, c * 3 + 5, c * 3 + 6] }, x: c + 1, y: 3 });
  }
  // Zero splits, trios and first four along the zero edge.
  out.push({ spot: { kind: 'split', numbers: [0, 3] }, x: 0, y: 0.5 });
  out.push({ spot: { kind: 'split', numbers: [0, 2] }, x: 0, y: 1.5 });
  out.push({ spot: { kind: 'split', numbers: [0, 1] }, x: 0, y: 2.5 });
  out.push({ spot: { kind: 'street', numbers: [0, 2, 3] }, x: 0, y: 1 });
  out.push({ spot: { kind: 'street', numbers: [0, 1, 2] }, x: 0, y: 2 });
  out.push({ spot: { kind: 'corner', numbers: [0, 1, 2, 3] }, x: 0, y: 3 });
  return out;
}
const HOTSPOTS = hotspots();

function Wheel({ view }: { view: RouletteView | null }) {
  const [angle, setAngle] = useState(0);
  const [ball, setBall] = useState(0);
  const spun = useRef<number>(-1);
  useEffect(() => {
    if (!view || view.result === null || spun.current === view.spinId) return;
    spun.current = view.spinId;
    const idx = WHEEL.indexOf(view.result);
    const pocket = 360 / WHEEL.length;
    // Rotate the wheel so the winning pocket ends under the top marker; ball goes the other way.
    const animate = view.phase === 'spinning';
    setAngle((a) => {
      const base = Math.ceil(a / 360) * 360 + (animate ? 360 * 4 : 0);
      return base - idx * pocket;
    });
    setBall((b) => Math.floor(b / 360) * 360 - (animate ? 360 * 6 : 0));
  }, [view]);
  const spinning = view?.phase === 'spinning';
  const pocket = 360 / WHEEL.length;
  return (
    <div className="rl-wheel-wrap" aria-hidden>
      <svg viewBox="-100 -100 200 200" className="rl-wheel" style={{ transform: `rotate(${angle}deg)`, transition: spinning ? `transform ${SPIN_SECONDS}s cubic-bezier(.15,.6,.25,1)` : 'none' }}>
        <circle r="98" fill="#5a3a1a" />
        {WHEEL.map((n, i) => {
          const a0 = ((i - 0.5) * pocket - 90) * (Math.PI / 180);
          const a1 = ((i + 0.5) * pocket - 90) * (Math.PI / 180);
          const p = (r: number, a: number) => `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
          const fill = n === 0 ? '#1d7a4e' : RED.has(n) ? '#b3261e' : '#1a1a1a';
          const mid = (i * pocket - 90) * (Math.PI / 180);
          return (
            <g key={n}>
              <path d={`M ${p(90, a0)} A 90 90 0 0 1 ${p(90, a1)} L ${p(58, a1)} A 58 58 0 0 0 ${p(58, a0)} Z`} fill={fill} stroke="#c9a54a" strokeWidth="0.6" />
              <text x={76 * Math.cos(mid)} y={76 * Math.sin(mid)} fontSize="8" fill="#fff" textAnchor="middle" dominantBaseline="central" transform={`rotate(${i * pocket} ${76 * Math.cos(mid)} ${76 * Math.sin(mid)})`}>{n}</text>
            </g>
          );
        })}
        <circle r="56" fill="#2b1a0b" stroke="#c9a54a" />
        <circle r="18" fill="#c9a54a" />
      </svg>
      <div className="rl-ball-track" style={{ transform: `rotate(${ball}deg)`, transition: spinning ? `transform ${SPIN_SECONDS}s cubic-bezier(.2,.7,.3,1)` : 'none' }}>
        <div className="rl-ball" />
      </div>
      <div className="rl-marker" />
      {view?.phase === 'result' && view.result !== null && <div className={`rl-result rl-${color(view.result)}`} data-testid="rl-result">{view.result}</div>}
    </div>
  );
}

/** Slide-out shared roulette wheel on the left edge. Same play-money chips as blackjack. */
export function RoulettePanel() {
  const winRef = useRef<HTMLDivElement>(null);
  const win = useWindowDrag('roulette', winRef);
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1');
  const [tab, setTab] = useState<'wheel' | 'board'>('wheel');
  const [name] = useSavedName();
  const [v, setV] = useState<RouletteView | null>(null);
  const [chip, setChip] = useState(25);
  const [err, setErr] = useState('');
  const phaseRef = useRef<string>('');
  useEffect(() => { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); }, [open]);

  useEffect(() => {
    if (!open) return;
    const on = (x: RouletteView) => setV(x);
    socket.on('roulette_state', on);
    const watch = () => void emitCasino<{ state: RouletteView }>('roulette_watch', { name: name || undefined }).then((r) => r.ok && r.state && setV(r.state));
    watch();
    socket.on('connect', watch);
    return () => {
      socket.off('roulette_state', on);
      socket.off('connect', watch);
      void emitCasino('roulette_unwatch');
    };
  }, [open, name]);

  const mine = useMemo(() => v?.players.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? null, [v, name]);

  useEffect(() => {
    if (!v) return;
    const key = `${v.spinId}:${v.phase}`;
    if (phaseRef.current && phaseRef.current !== key) {
      if (v.phase === 'spinning') playRouletteSpin(SPIN_SECONDS);
      if (v.phase === 'result') {
        playBallLand();
        if ((mine?.net ?? 0) > 0) window.setTimeout(playSolitaireWin, 250);
      }
    }
    phaseRef.current = key;
  }, [v, mine]);

  const secs = useCountdown(v?.deadline ?? null, v?.serverNow);
  const chips = v?.yourChips ?? 0;
  const betting = v?.phase === 'betting';

  const totals = useMemo(() => {
    const m = new Map<string, { me: number; others: number }>();
    for (const p of v?.players ?? []) {
      const isMe = p.name.toLowerCase() === name.toLowerCase();
      for (const b of p.bets) {
        const k = betKey(b);
        const cur = m.get(k) ?? { me: 0, others: 0 };
        if (isMe) cur.me += b.amount;
        else cur.others += b.amount;
        m.set(k, cur);
      }
    }
    return m;
  }, [v, name]);

  async function place(spot: Spot) {
    if (!betting || !name) return;
    setErr('');
    const r = await emitCasino('roulette_bet', { name, bet: { ...spot, amount: chip } });
    if (!r.ok) setErr(r.error ?? 'Failed');
    else playCardFlick();
  }
  async function cmd(event: string) {
    setErr('');
    const r = await emitCasino(event, { name });
    if (!r.ok) setErr(r.error ?? 'Failed');
  }

  const marker = (spot: Spot) => {
    const t = totals.get(betKey(spot));
    if (!t) return null;
    return (
      <>
        {t.me > 0 && <span className="rl-chip rl-chip-me">{t.me >= 1000 ? `${Math.round(t.me / 100) / 10}k` : t.me}</span>}
        {t.others > 0 && <span className="rl-chip rl-chip-other" title="Other players">{t.others >= 1000 ? `${Math.round(t.others / 100) / 10}k` : t.others}</span>}
      </>
    );
  };
  const cell = (spot: Spot, label: string, cls: string, style?: React.CSSProperties, title?: string) => (
    <button type="button" key={betKey(spot)} className={`rl-cell ${cls}`} style={style} disabled={!betting} onClick={() => void place(spot)} title={title ?? `${label} · pays ${payoutOdds(spot.kind)}:1`}>
      {label}
      {marker(spot)}
    </button>
  );

  const status = !v ? 'Connecting…' : v.phase === 'betting' ? `Place your bets · spin in ${secs ?? ''}s` : v.phase === 'spinning' ? 'No more bets…' : `${v.result} ${v.result === 0 ? 'green' : v.result !== null && RED.has(v.result) ? 'red' : 'black'}${mine?.net != null ? ` · you ${mine.net >= 0 ? '+' : ''}${mine.net}` : ''}`;

  return (
    <div className={`rl-wrap ${open ? 'rl-open' : ''}`} data-testid="roulette">
      <button type="button" className="sol-tab rl-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="roulette-tab">
        <span>🎡 Roulette</span>
      </button>
      {open && (
        <div className="sol-panel rl-panel" role="dialog" aria-label="Roulette" ref={winRef} style={win.style} onPointerDownCapture={win.front}>
          <div {...win.bar}>
            <button type="button" className={`casino-tabbtn ${tab === 'wheel' ? 'on' : ''}`} onClick={() => setTab('wheel')}>Wheel</button>
            <button type="button" className={`casino-tabbtn ${tab === 'board' ? 'on' : ''}`} onClick={() => setTab('board')}>Casino leaderboard</button>
            {win.moved && <button type="button" className="win-reset" aria-label="Reset window position" title="Reset position" onClick={win.reset}>⟲</button>}
            <button type="button" className="ml-auto" aria-label="Close roulette" onClick={() => setOpen(false)}>✕</button>
          </div>
          {tab === 'board' ? (
            <CasinoLeaderboard you={name} />
          ) : (
            <div className="rl-body">
              <div className="rl-top">
                <Wheel view={v} />
                <div className="rl-side">
                  <div className="bj-status" data-testid="rl-status">{status}</div>
                  <div className="rl-history" aria-label="Last 10 numbers">
                    {(v?.history ?? []).map((n, i) => <span key={i} className={`rl-h rl-${color(n)}`}>{n}</span>)}
                  </div>
                  {name && <div className="font-semibold">🪙 {chips.toLocaleString()}{mine ? ` · on table ${mine.total}` : ''}</div>}
                </div>
              </div>
              {!name ? (
                <NamePrompt />
              ) : (
                <>
                  <div className="rl-board-scroll">
                    <div className="rl-board">
                      {cell({ kind: 'straight', numbers: [0] }, '0', 'rl-zero rl-green', { gridColumn: '1', gridRow: '1 / span 3' })}
                      {Array.from({ length: 12 }, (_, c) => [0, 1, 2].map((r) => {
                        const n = numAt(c, r);
                        return cell({ kind: 'straight', numbers: [n] }, String(n), `rl-${color(n)}`, { gridColumn: String(c + 2), gridRow: String(r + 1) });
                      }))}
                      {[3, 2, 1].map((col, r) => cell({ kind: 'column', numbers: [col] }, '2:1', 'rl-out', { gridColumn: '14', gridRow: String(r + 1) }, `Column ${col} · pays 2:1`))}
                      {[1, 2, 3].map((d) => cell({ kind: 'dozen', numbers: [d] }, `${d === 1 ? '1st' : d === 2 ? '2nd' : '3rd'} 12`, 'rl-out', { gridColumn: `${(d - 1) * 4 + 2} / span 4`, gridRow: '4' }))}
                      {([['low', '1–18'], ['even', 'Even'], ['red', '◆'], ['black', '◆'], ['odd', 'Odd'], ['high', '19–36']] as [RouletteKind, string][]).map(([k, label], i) =>
                        cell({ kind: k, numbers: [] }, label, `rl-out ${k === 'red' ? 'rl-red' : k === 'black' ? 'rl-black' : ''}`, { gridColumn: `${i * 2 + 2} / span 2`, gridRow: '5' }, `${k} · pays 1:1`),
                      )}
                      <div className="rl-hot-layer">
                        {HOTSPOTS.map(({ spot, x, y }) => (
                          <button
                            type="button"
                            key={betKey(spot)}
                            className={`rl-hot ${totals.has(betKey(spot)) ? 'rl-hot-on' : ''}`}
                            style={{ left: `calc(${x} * var(--rl-cw))`, top: `calc(${y} * var(--rl-ch))` }}
                            disabled={!betting}
                            title={`${spot.kind} ${spot.numbers.join('/')} · pays ${payoutOdds(spot.kind)}:1`}
                            aria-label={`${spot.kind} ${spot.numbers.join(' ')}`}
                            onClick={() => void place(spot)}
                          >
                            {marker(spot)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {err && <div className="bj-err">{err}</div>}
                  <div className="bj-controls">
                    {chips < 5 && !mine && betting ? (
                      <ResetChips name={name} onDone={() => undefined} />
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-1">
                          {CHIP_VALUES.map((c) => <button type="button" key={c} className={chip === c ? 'bj-chip-on' : ''} onClick={() => setChip(c)}>{c}</button>)}
                        </div>
                        <div className="flex gap-1">
                          <button type="button" disabled={!betting || !mine} onClick={() => void cmd('roulette_clear')}>Clear</button>
                          <button type="button" disabled={!betting} onClick={() => void cmd('roulette_rebet')}>Rebet</button>
                        </div>
                      </>
                    )}
                  </div>
                  {v && v.players.length > 0 && (
                    <div className="rl-players">
                      {v.players.map((p) => (
                        <div key={p.name}>
                          <b>{p.name}</b> {p.total} on {p.bets.length} spot{p.bets.length === 1 ? '' : 's'}
                          {p.net !== null && <span className={p.net > 0 ? 'casino-up' : p.net < 0 ? 'casino-down' : ''}> {p.net >= 0 ? '+' : ''}{p.net}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export type { RouletteBet };
