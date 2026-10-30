import { TopTab } from '@/components/TopTabs';
import { useEffect, useRef, useState } from 'react';
import { CasinoLeaderboard, NamePrompt, ResetChips } from '@/components/CasinoCommon';
import { CoinArt, SlotSymbol } from '@/components/SlotArt';
import { emitCasino, useSavedName } from '@/lib/casino';
import { useWindowDrag } from '@/lib/windowDrag';
import { playBallLand, playCardFlick, playRouletteSpin, playSolitaireWin } from '@/lib/sounds';
import {
  MACHINE_IDS, MACHINES, PAYLINES, VS_BETS, VS_REELS, VS_ROWS,
  type CoinValue, type Grid, type MachineId, type RoundResult, type SpinStep,
} from '../../../shared/video-slots';

const OPEN_KEY = 'relay-slots-open';
const MACHINE_KEY = 'relay-slots-machine';
interface Spin { round: RoundResult; returned: number; net: number; chips: number }
type Tier = 'BIG' | 'MEGA' | 'EPIC';

const reduced = () =>
  document.documentElement.classList.contains('reduce-motion') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function randomGrid(m: MachineId): Grid {
  const syms = MACHINES[m].symbols.map((s) => s.id);
  return Array.from({ length: VS_REELS }, () => Array.from({ length: VS_ROWS }, () => syms[Math.floor(Math.random() * syms.length)]!));
}
const cellKey = (r: number, w: number) => `${r}:${w}`;

/** Count of feature-trigger symbols on the first `n` reels (anticipation check). */
function triggerCount(m: MachineId, g: Grid, n: number): number {
  const ids = m === 'dragon' ? ['crown', 'chest'] : m === 'goldrush' ? ['coin'] : [];
  let best = 0;
  for (const id of ids) best = Math.max(best, g.slice(0, n).flat().filter((c) => c === id).length);
  return best;
}
const anticipateAt = (m: MachineId) => (m === 'goldrush' ? 4 : m === 'dragon' ? 2 : 99);

/** Modern 5x3 video slots on casino chips. Server decides the whole round; this only animates the script. */
export function SlotsPanel() {
  const winRef = useRef<HTMLDivElement>(null);
  const win = useWindowDrag('slots', winRef);
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1');
  const [tab, setTab] = useState<'play' | 'board'>('play');
  const [name] = useSavedName();
  const [machine, setMachine] = useState<MachineId | null>(() => {
    const m = localStorage.getItem(MACHINE_KEY);
    return m && (MACHINE_IDS as string[]).includes(m) ? (m as MachineId) : null;
  });
  const [grid, setGrid] = useState<Grid>(() => randomGrid(machine ?? 'dragon'));
  const [spinning, setSpinning] = useState<boolean[]>(Array(VS_REELS).fill(false));
  const [antic, setAntic] = useState<boolean[]>(Array(VS_REELS).fill(false));
  const [lit, setLit] = useState<Set<string>>(new Set());
  const [blast, setBlast] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<number[]>([]);
  const [line, setLine] = useState<number | null>(null);
  const [msg, setMsg] = useState('Pick a bet and Spin.');
  const [banner, setBanner] = useState('');
  const [fs, setFs] = useState<{ n: number; of: number; mult: number; total: number } | null>(null);
  const [chest, setChest] = useState<{ picks: number[]; shown: (number | null)[]; done: boolean } | null>(null);
  const [hold, setHold] = useState<{ coins: (CoinValue | null)[][]; left: number } | null>(null);
  const [big, setBig] = useState<{ tier: Tier; amount: number; shown: number } | null>(null);
  const [chips, setChips] = useState<number | null>(null);
  const [bet, setBet] = useState<number>(VS_BETS[0]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const chestDone = useRef<(() => void) | null>(null);
  const skip = useRef(false);
  useEffect(() => { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); }, [open]);
  useEffect(() => { if (machine) localStorage.setItem(MACHINE_KEY, machine); }, [machine]);
  useEffect(() => {
    if (!open || !name) return;
    void emitCasino<{ state: { chips: number } }>('vp_state').then((r) => r.ok && r.state && setChips(r.state.chips));
  }, [open, name]);

  // Spinning reels cycle through random symbols (the strip itself scrolls in CSS).
  useEffect(() => {
    if (!machine || !spinning.some(Boolean)) return;
    const syms = MACHINES[machine].symbols.map((s) => s.id);
    const t = setInterval(() => setGrid((g) => g.map((reel, i) => (spinning[i] ? reel.map(() => syms[Math.floor(Math.random() * syms.length)]!) : reel))), 90);
    return () => clearInterval(t);
  }, [spinning, machine]);

  const wait = (ms: number) => new Promise<void>((ok) => setTimeout(ok, reduced() || skip.current ? Math.min(ms, 30) : ms));

  const landStep = async (m: MachineId, step: SpinStep, fast: boolean) => {
    setLit(new Set()); setBlast(new Set()); setExpanded([]); setLine(null);
    setSpinning(Array(VS_REELS).fill(true)); setAntic(Array(VS_REELS).fill(false));
    await wait(fast ? 350 : 550);
    const stops = Array(VS_REELS).fill(true);
    for (let i = 0; i < VS_REELS; i++) {
      if (i >= 2 && triggerCount(m, step.grid, i) >= anticipateAt(m)) {
        setAntic((a) => a.map((_, j) => j >= i));
        await wait(900);
      }
      stops[i] = false;
      setGrid((g) => g.map((reel, j) => (j === i ? step.grid[i]! : reel)));
      setSpinning([...stops]);
      playCardFlick();
      await wait(fast ? 140 : 220);
    }
    setAntic(Array(VS_REELS).fill(false));
    if (step.airstrike?.length) {
      setBanner('AIRSTRIKE INBOUND');
      setBlast(new Set(step.airstrike.map(([r, w]) => cellKey(r, w))));
      playBallLand();
      await wait(900);
      setGrid((g) => g.map((reel, r) => reel.map((c, w) => (step.airstrike!.some(([a, b]) => a === r && b === w) ? 'star' : c))));
      await wait(350);
      setBlast(new Set()); setBanner('');
    }
    if (step.expanded?.length) {
      setExpanded(step.expanded);
      await wait(500);
    }
    setGrid(step.final);
    if (step.wins.length) {
      const all = new Set(step.wins.flatMap((w) => w.cells.map(([r, c]) => cellKey(r, c))));
      setLit(all);
      await wait(fast ? 500 : 700);
      for (const w of step.wins.slice(0, fast ? 3 : 8)) {
        setLine(w.line);
        setLit(new Set(w.cells.map(([r, c]) => cellKey(r, c))));
        const sym = MACHINES[m].symbols.find((s) => s.id === w.sym)!;
        setMsg(`Line ${w.line + 1} · ${w.count}× ${sym.label} · ${Math.floor(w.amount * step.multiplier)}`);
        await wait(fast ? 450 : 850);
      }
      setLine(null); setLit(all);
    }
  };

  const celebrate = async (amount: number, b: number) => {
    const x = amount / b;
    const tier: Tier | null = x >= 100 ? 'EPIC' : x >= 40 ? 'MEGA' : x >= 15 ? 'BIG' : null;
    if (!tier) return;
    playSolitaireWin();
    if (reduced()) { setBig({ tier, amount, shown: amount }); await wait(1500); setBig(null); return; }
    const t0 = performance.now();
    const dur = tier === 'BIG' ? 1800 : 3000;
    await new Promise<void>((ok) => {
      const tick = () => {
        const p = Math.min(1, (performance.now() - t0) / dur);
        setBig({ tier, amount, shown: Math.floor(amount * (1 - (1 - p) ** 3)) });
        if (p < 1 && !skip.current) requestAnimationFrame(tick); else ok();
      };
      tick();
    });
    setBig({ tier, amount, shown: amount });
    await wait(1400);
    setBig(null);
  };

  const spin = async () => {
    if (!machine) return;
    const m = machine;
    skip.current = false;
    setBusy(true); setErr(''); setMsg('Spinning…'); setFs(null); setHold(null); setChest(null);
    setSpinning(Array(VS_REELS).fill(true)); setLit(new Set()); setExpanded([]);
    playRouletteSpin(1.2);
    const r = await emitCasino<{ result: Spin }>('vslots_spin', { machine: m, bet });
    if (!r.ok || !r.result) {
      setSpinning(Array(VS_REELS).fill(false)); setBusy(false); setMsg('');
      return setErr(r.error ?? 'Try again.');
    }
    const res = r.result;
    const round = res.round;
    setChips(res.chips + 0 - res.returned); // stake gone; wins count up as they land
    const [base, ...free] = round.steps;
    await landStep(m, base!, false);
    let running = base!.win;
    if (round.chest) {
      setBanner('PICK A CHEST');
      await wait(900); setBanner('');
      const picks = round.chest.picks;
      await new Promise<void>((ok) => {
        chestDone.current = ok;
        setChest({ picks, shown: Array(12).fill(null), done: false });
      });
      running += round.chest.total;
      setMsg(`Chests paid ${round.chest.total}`);
      await wait(900);
      setChest(null);
    }
    if (round.freeSpins) {
      const f = round.freeSpins;
      setBanner(`${base!.awarded} FREE SPINS · ×${f.multiplier}`);
      playBallLand();
      await wait(1500); setBanner('');
      let total = 0;
      let of = base!.awarded ?? 0;
      for (let i = 0; i < free.length; i++) {
        const s = free[i]!;
        setFs({ n: i + 1, of, mult: f.multiplier, total });
        await landStep(m, s, true);
        total += s.win;
        if (s.awarded) { of += s.awarded; setBanner(`+${s.awarded} FREE SPINS`); await wait(1100); setBanner(''); }
        setFs({ n: i + 1, of, mult: f.multiplier, total });
      }
      running += total;
      setMsg(`Free spins paid ${total}`);
      await wait(900);
    }
    if (round.hold) {
      const h = round.hold;
      setBanner('HOLD & SPIN');
      await wait(1200); setBanner('');
      for (const fr of h.frames) { setHold(fr); playCardFlick(); await wait(750); }
      if (h.grand) { setBanner('GRAND JACKPOT'); await wait(1500); setBanner(''); }
      running += h.total;
      setMsg(`Hold & Spin paid ${h.total}`);
      await wait(900);
      setHold(null);
    }
    setFs(null);
    await celebrate(running, bet);
    setChips(res.chips);
    setMsg(res.returned > 0 ? `Won ${res.returned.toLocaleString()} (${(res.returned / bet).toFixed(1)}× bet)` : 'No win');
    if (res.returned > 0 && res.returned < bet * 15) playBallLand();
    setBusy(false);
  };

  const pickChest = (i: number) => {
    setChest((c) => {
      if (!c || c.done || c.shown[i] !== null) return c;
      const k = c.shown.filter((x) => x !== null).length;
      const shown = [...c.shown];
      shown[i] = c.picks[k]!;
      const done = k + 1 >= c.picks.length;
      playCardFlick();
      if (done) setTimeout(() => chestDone.current?.(), reduced() ? 50 : 800);
      return { ...c, shown, done };
    });
  };
  const revealAll = () => {
    setChest((c) => {
      if (!c || c.done) return c;
      const shown = [...c.shown];
      let k = shown.filter((x) => x !== null).length;
      for (let i = 0; i < shown.length && k < c.picks.length; i++) if (shown[i] === null) shown[i] = c.picks[k++]!;
      setTimeout(() => chestDone.current?.(), 600);
      return { ...c, shown, done: true };
    });
  };

  const cfg = machine ? MACHINES[machine] : null;
  const pays = cfg ? cfg.symbols.filter((s) => s.pays).reverse() : [];
  return (
    <div className={`cx-wrap sl-wrap ${open ? 'cx-open' : ''}`} data-testid="slots">
      <TopTab id="slots"><button type="button" className="sol-tab cx-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="slots-tab">🎰 Slots</button></TopTab>
      {open && (
        <div className={"sol-panel bj-panel cx-panel vs-panel" + win.className} role="dialog" aria-label="Slots" ref={winRef} style={win.style} onPointerDownCapture={win.front}>
          {win.grips}
          <div {...win.bar}>
            <button type="button" className={`casino-tabbtn ${tab === 'play' && !machine ? 'on' : ''}`} disabled={busy} onClick={() => { setTab('play'); setMachine(null); }} data-testid="vs-lobby">Machines</button>
            {cfg && <button type="button" className={`casino-tabbtn ${tab === 'play' ? 'on' : ''}`} onClick={() => setTab('play')}>{cfg.name}</button>}
            {win.moved && <button type="button" className="win-reset" aria-label="Reset window position" onClick={win.reset}>⟲</button>}
            <button type="button" className="ml-auto" aria-label="Close slots" onClick={() => setOpen(false)}>✕</button>
          </div>
          {tab === 'board' ? <CasinoLeaderboard you={name} /> : !name ? <NamePrompt /> : !machine || !cfg ? (
            <div className="vs-lobby" data-testid="vs-selector">
              <div className="vs-lobby-title">Choose a machine</div>
              {MACHINE_IDS.map((id) => {
                const c = MACHINES[id];
                const hero = id === 'dragon' ? 'queen' : id === 'warzone' ? 'tank' : 'seven';
                return (
                  <button type="button" key={id} className={`vs-card vs-theme-${id}`} onClick={() => { setMachine(id); setGrid(randomGrid(id)); setMsg('Pick a bet and Spin.'); setLit(new Set()); }} data-testid={`vs-pick-${id}`}>
                    <span className="vs-card-art"><SlotSymbol id={hero} /></span>
                    <span className="vs-card-text"><b>{c.name}</b><small>{c.tagline}</small><em>5×3 · 20 lines</em></span>
                  </button>
                );
              })}
              <div className="bj-label">Chips: {chips?.toLocaleString() ?? '…'}</div>
            </div>
          ) : (
            <div className={`vs-machine vs-theme-${machine} ${big ? 'vs-shake-' + big.tier : ''}`} data-testid={`vs-machine-${machine}`}>
              <div className="vs-head">
                <b>{cfg.name}</b>
                {fs && <span className="vs-fs" data-testid="vs-freespins">FREE SPIN {fs.n}/{fs.of} · ×{fs.mult} · {fs.total.toLocaleString()}</span>}
              </div>
              <div className="vs-screen">
                <div className="vs-grid" data-testid="vs-grid">
                  {grid.map((reel, r) => (
                    <div key={r} className={`vs-reel ${spinning[r] ? 'spin' : 'landed'} ${antic[r] ? 'antic' : ''} ${expanded.includes(r) ? 'expand' : ''}`}>
                      {reel.map((s, w) => {
                        const coin = hold?.coins[r]?.[w];
                        return (
                          <div key={w} className={`vs-cell ${lit.has(cellKey(r, w)) ? 'lit' : ''} ${blast.has(cellKey(r, w)) ? 'blast' : ''} ${hold ? (coin ? 'held' : 'dim') : ''}`}>
                            {hold ? (coin ? <CoinArt value={coin} /> : null) : <SlotSymbol id={s} />}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  {line !== null && (
                    <svg className="vs-line" viewBox="0 0 500 300" preserveAspectRatio="none" aria-hidden>
                      <polyline points={PAYLINES[line]!.map((row, reel) => `${reel * 100 + 50},${row * 100 + 50}`).join(' ')} />
                    </svg>
                  )}
                </div>
                {hold && <div className="vs-respins" data-testid="vs-hold">RESPINS {hold.left}</div>}
                {banner && <div className="vs-banner" data-testid="vs-banner">{banner}</div>}
                {chest && (
                  <div className="vs-chests" data-testid="vs-chests">
                    <div className="vs-chests-title">{chest.done ? 'COLLECT' : 'Pick chests until COLLECT'} · {chest.shown.reduce<number>((a, x) => a + (x ?? 0), 0).toLocaleString()}</div>
                    <div className="vs-chest-grid">
                      {chest.shown.map((v, i) => (
                        <button type="button" key={i} className={`vs-chest ${v !== null ? 'open' : ''} ${v === 0 ? 'collect' : ''}`} onClick={() => pickChest(i)} disabled={chest.done || v !== null}>
                          {v === null ? <SlotSymbol id="chest" /> : v === 0 ? 'COLLECT' : `+${v.toLocaleString()}`}
                        </button>
                      ))}
                    </div>
                    {!chest.done && <button type="button" className="vs-reveal" onClick={revealAll}>Open the rest</button>}
                  </div>
                )}
                {big && (
                  <div className={`vs-big vs-big-${big.tier}`} data-testid="vs-bigwin" onClick={() => { skip.current = true; }}>
                    <div className="vs-embers" aria-hidden>{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 6) * 0.25}s` }} />)}</div>
                    <b>{big.tier} WIN</b>
                    <span>{big.shown.toLocaleString()}</span>
                  </div>
                )}
              </div>
              <div className="bj-status vs-msg" data-testid="sl-status">{msg}</div>
              <div className="bj-controls vs-controls">
                {VS_BETS.map((b) => <button type="button" key={b} className={bet === b ? 'bj-chip-on' : ''} disabled={busy} onClick={() => setBet(b)}>{b}</button>)}
                {busy
                  ? <button type="button" className="bj-deal" onClick={() => { skip.current = true; }}>Skip</button>
                  : <button type="button" className="bj-deal" onClick={() => void spin()} data-testid="sl-spin">Spin {bet}</button>}
              </div>
              <div className="bj-label">Chips: {chips?.toLocaleString() ?? '…'} {err && <span className="account-error">· {err}</span>}</div>
              {chips !== null && chips < VS_BETS[0] && !busy && <ResetChips name={name} onDone={setChips} />}
              <details className="vs-pays">
                <summary>Paytable (× line bet = bet ÷ 20)</summary>
                <table className="vp-pays"><tbody>
                  {pays.map((s) => <tr key={s.id}><td className="vs-paysym"><SlotSymbol id={s.id} /> {s.label}</td><td>{s.pays!.join(' / ')}</td></tr>)}
                </tbody></table>
                <p className="vs-note">{cfg.tagline}. Results are decided by the server.</p>
              </details>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
