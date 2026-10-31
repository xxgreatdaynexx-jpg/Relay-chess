import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from '@/lib/net';
import { useAccount } from '@/lib/auth';
import { emitCasino } from '@/lib/casino';
import { playCardFlick, playSolitaireWin } from '@/lib/sounds';
import { KlondikeBoard } from '@/solitaire/Board';
import { canMove, type Card, type Loc, type Target } from '@/solitaire/logic';
import {
  act, blindTarget, BLIND_NAMES, BOSS, EDITION_INFO, ENH_INFO, interestCap, isDebuffed, isRun, JOKER, JOKER_SLOTS, MAX_ANTE, newRun,
  OMEN, OMEN_SLOTS, sellValue, type Action, type Run, type ScoreEvent, type ScoreStep, type SolitroStanding,
} from '../../../shared/solitro';

const GUEST_KEY = 'relay-solitro-guest-v1';
const GUEST_BEST = 'relay-solitro-guest-best';
type Best = { bestAnte: number; runs: number; wins: number } | null;

function loadGuest(): Run | null {
  try { const r = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null'); return isRun(r) ? r : null; } catch { return null; }
}
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;

/** Signed in: the server owns the run. Guests: same engine, kept in localStorage (no leaderboard). */
function useSolitro() {
  const name = useAccount();
  const [run, setRun] = useState<Run | null>(() => (name ? null : loadGuest()));
  const [best, setBest] = useState<Best>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!name);
  const [fresh, setFresh] = useState(0); // bumps when a new scoring event arrives from a play (not a reload)
  const busy = useRef(false);

  useEffect(() => {
    if (!name) {
      setRun(loadGuest());
      try { setBest(JSON.parse(localStorage.getItem(GUEST_BEST) || 'null')); } catch { setBest(null); }
      setLoaded(true);
      return;
    }
    setLoaded(false);
    const load = () => void emitCasino<{ run: Run | null; best: Best }>('solitro_state').then((r) => {
      if (r.ok) { setRun(r.run ?? null); setBest(r.best ?? null); setLoaded(true); }
    });
    load();
    socket.on('connect', load);
    return () => { socket.off('connect', load); };
  }, [name]);

  useEffect(() => {
    if (name || !run) return;
    localStorage.setItem(GUEST_KEY, JSON.stringify(run));
    const b = best ?? { bestAnte: 0, runs: 0, wins: 0 };
    if (run.ante > b.bestAnte) { const nb = { ...b, bestAnte: Math.min(MAX_ANTE, run.ante) }; setBest(nb); localStorage.setItem(GUEST_BEST, JSON.stringify(nb)); }
  }, [name, run, best]);

  const doAct = useCallback(async (a: Action) => {
    if (busy.current || !run) return false;
    setError(null);
    if (!name) {
      try {
        const next = act(run, a);
        if (next.phase === 'won' && run.phase !== 'won') { const b = best ?? { bestAnte: 0, runs: 0, wins: 0 }; const nb = { ...b, wins: b.wins + 1 }; setBest(nb); localStorage.setItem(GUEST_BEST, JSON.stringify(nb)); }
        setRun(next);
        if (next.last && a.t === 'move') setFresh((n) => n + 1);
        return true;
      } catch (e) { setError((e as Error).message); return false; }
    }
    busy.current = true;
    const r = await emitCasino<{ run: Run }>('solitro_act', { a });
    busy.current = false;
    if (!r.ok || !r.run) { setError(r.error ?? 'Something went wrong.'); return false; }
    setRun(r.run);
    if (r.run.last && a.t === 'move') setFresh((n) => n + 1);
    return true;
  }, [run, name, best]);

  const start = useCallback(async () => {
    setError(null);
    if (!name) {
      const r = newRun(randomSeed());
      setRun(r);
      const b = best ?? { bestAnte: 0, runs: 0, wins: 0 };
      const nb = { ...b, runs: b.runs + 1, bestAnte: Math.max(b.bestAnte, 1) };
      setBest(nb); localStorage.setItem(GUEST_BEST, JSON.stringify(nb));
      return;
    }
    const r = await emitCasino<{ run: Run }>('solitro_new');
    if (!r.ok || !r.run) return setError(r.error ?? 'Could not start a run.');
    setRun(r.run);
    setBest((b) => ({ bestAnte: Math.max(b?.bestAnte ?? 0, 1), runs: (b?.runs ?? 0) + 1, wins: b?.wins ?? 0 }));
  }, [name, best]);

  return { name, run, best, error, setError, loaded, fresh, doAct, start };
}

interface Anim { ev: ScoreEvent; k: number; chips: number; mult: number; done: boolean }

/**
 * Steps through a score event: chips and mult tick up one trigger at a time, then the total lands.
 * The displayed score only ever moves forward from what's on screen to the new score (no snapping ahead and back).
 */
export function useScoreAnim(run: Run | null, fresh: number) {
  const [anim, setAnim] = useState<Anim | null>(null);
  const target = run?.score ?? 0;
  const [shown, setShownState] = useState(target);
  const shownRef = useRef(target);
  const setShown = (n: number) => { shownRef.current = n; setShownState(n); };
  const targetRef = useRef(target);
  targetRef.current = target;
  const timers = useRef<number[]>([]);
  const lastFresh = useRef(fresh);
  const animating = useRef(false);
  const clear = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };
  useEffect(() => clear, []);
  useEffect(() => {
    const ev = run?.last;
    if (fresh !== lastFresh.current && ev) {
      lastFresh.current = fresh;
      clear();
      animating.current = true;
      // Start from what's on screen (never from above it), end on the new score.
      const from = Math.min(shownRef.current, target);
      const to = target;
      const STEP = 230;
      let chips = 0, mult = 0;
      ev.steps.forEach((st, k) => {
        timers.current.push(window.setTimeout(() => {
          if (st.chips) chips += st.chips;
          if (st.mult) mult += st.mult;
          if (st.xmult) mult = Math.max(1, mult) * st.xmult;
          setAnim({ ev, k: k + 1, chips, mult: Math.round(mult * 100) / 100, done: false });
        }, k * STEP));
      });
      const endT = ev.steps.length * STEP;
      timers.current.push(window.setTimeout(() => setAnim({ ev, k: ev.steps.length, chips: ev.chips, mult: ev.mult, done: true }), endT));
      const TICKS = 12;
      for (let i = 1; i <= TICKS; i++) {
        timers.current.push(window.setTimeout(() => setShown(Math.max(shownRef.current, Math.round(from + ((to - from) * i) / TICKS))), endT + i * 40));
      }
      timers.current.push(window.setTimeout(() => { animating.current = false; setAnim(null); setShown(targetRef.current); }, endT + 1100));
      return;
    }
    lastFresh.current = fresh;
    if (!animating.current) setShown(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh, target]);
  return { anim, shown };
}

const fmtStep = (st: ScoreStep) => [st.chips ? `+${st.chips} chips` : '', st.mult ? `+${st.mult} mult` : '', st.xmult ? `×${st.xmult} mult` : '', st.money ? `+$${st.money}` : ''].filter(Boolean).join(' · ');

/** The last play's score, step by step: base card, bonuses, each joker, then chips × mult. */
function Breakdown({ ev }: { ev: ScoreEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sto-last" data-testid="sto-last">
      <button type="button" className="sto-last-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="How the last play scored">
        Last play <b>+{fmtN(ev.total)}</b> = <span className="sto-chips">{fmtN(ev.chips)}</span> × <span className="sto-mult">{ev.mult}</span> <span aria-hidden>{open ? '▾' : 'ⓘ'}</span>
      </button>
      {open && (
        <ol className="sto-last-list" data-testid="sto-breakdown">
          {ev.steps.map((st, i) => <li key={i}><span>{st.icon} {st.label}</span><span>{fmtStep(st) || '—'}</span></li>)}
          <li className="sto-last-total"><span>Total</span><span>{fmtN(ev.chips)} chips × {ev.mult} mult = {fmtN(ev.total)}</span></li>
        </ol>
      )}
    </div>
  );
}

const fmtN = (n: number) => n.toLocaleString('en-US');
const cardName = (id: string) => `${['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][Number(id.slice(1))]}${{ S: '♠', H: '♥', D: '♦', C: '♣' }[id[0] as Card['suit']]}`;

export function SolitroGame({ bar, toggle, tail }: { bar: Record<string, unknown>; toggle: React.ReactNode; tail: React.ReactNode }) {
  const s = useSolitro();
  const { run } = s;
  const { anim, shown } = useScoreAnim(run, s.fresh);
  const [sel, setSel] = useState<{ kind: 'joker' | 'omen'; i: number } | null>(null);
  const [board, setBoard] = useState(false);
  const wonRef = useRef(false);
  useEffect(() => { if (run?.phase === 'won' && !wonRef.current) { wonRef.current = true; playSolitaireWin(); } if (run?.phase !== 'won') wonRef.current = false; }, [run?.phase]);
  useEffect(() => { if (s.error) { const t = window.setTimeout(() => s.setError(null), 2600); return () => window.clearTimeout(t); } }, [s.error, s]);

  const inBlind = run?.phase === 'blind' || (!!anim && run?.phase === 'shop');
  const boss = run && run.blind === 2 && run.phase === 'blind' ? BOSS[run.boss] : null;
  const popJoker = anim && !anim.done ? anim.ev.steps[anim.k - 1]?.joker : undefined;

  async function onMove(from: Loc, to: Target) {
    if (!run || run.phase !== 'blind' || !canMove(run.board, from, to)) return;
    if (await s.doAct({ t: 'move', from, to })) playCardFlick();
  }
  const decorate = (c: Card) => {
    if (!run) return undefined;
    const cls: string[] = [];
    const e = run.enh[c.id];
    if (e) cls.push(`sto-enh sto-enh-${e}`);
    if (isDebuffed(run, c)) cls.push('sto-debuff');
    if (anim && !anim.done && anim.ev.steps.some((x) => x.card === c.id)) cls.push('sto-hitcard');
    return cls.join(' ');
  };

  return (
    <>
      <div {...bar}>
        {toggle}
        <button type="button" onClick={() => { if (!run || run.phase === 'over' || run.phase === 'won' || confirm('Abandon this run and start a new one?')) void s.start(); }} data-testid="sto-new">New run</button>
        <button type="button" onClick={() => setBoard((b) => !b)} aria-pressed={board} title="Best runs">🏆</button>
        <span className="ml-auto" />
        {tail}
      </div>
      {board ? <Leaderboard onClose={() => setBoard(false)} signedIn={!!s.name} best={s.best} /> : !s.loaded ? (
        <div className="sto-center">Loading…</div>
      ) : !run ? (
        <Intro onStart={() => void s.start()} best={s.best} signedIn={!!s.name} />
      ) : (
        <>
          <div className="sto-hud" data-testid="sto-hud">
            <div className="sto-blind">
              <span className={`sto-chip ${run.blind === 2 ? 'sto-chip-boss' : ''}`}>{run.blind === 2 ? BOSS[run.boss].icon : run.blind === 0 ? '🔹' : '🔷'}</span>
              <span><b>Ante {Math.min(run.ante, MAX_ANTE)}</b>/{MAX_ANTE}<br /><small>{run.phase === 'shop' && !anim ? 'Shop' : BLIND_NAMES[run.blind]}</small></span>
            </div>
            <div className="sto-scorebox">
              <div className="sto-scoreline"><span>Score</span><b data-testid="sto-score">{fmtN(shown)}</b><span className="opacity-70">/ {fmtN(run.target)}</span></div>
              <div className="sto-progress"><i style={{ width: `${Math.min(100, (shown / Math.max(1, run.target)) * 100)}%` }} /></div>
            </div>
            <div className="sto-stats">
              <span title="Plays left">🂠 {run.plays}</span>
              <span title="Redeals left">↻ {run.redeals}</span>
              <span className="sto-money" title={`Interest: $1 per $5, max $${interestCap(run)}`}>${run.money}</span>
            </div>
          </div>
          {boss && <div className="sto-boss" data-testid="sto-boss">{boss.icon} <b>{boss.name}</b> — {boss.text}</div>}
          <div className="sto-belt">
            <div className="sto-jokers">
              {Array.from({ length: JOKER_SLOTS }, (_, i) => {
                const j = run.jokers[i];
                if (!j) return <div key={i} className="sto-joker sto-empty" />;
                const d = JOKER[j.id];
                const off = run.blind === 2 && run.phase === 'blind' && run.boss === 'hush' && i === 0;
                return (
                  <button type="button" key={i} className={`sto-joker ${j.ed ? `sto-ed-${j.ed}` : ''} ${popJoker === i ? 'sto-pop' : ''} ${off ? 'sto-off' : ''} ${sel?.kind === 'joker' && sel.i === i ? 'sto-sel' : ''}`}
                    onClick={() => setSel(sel?.kind === 'joker' && sel.i === i ? null : { kind: 'joker', i })} title={`${d.name}: ${d.text}`} data-testid="sto-joker">
                    <span className="sto-jicon">{d.icon}</span><span className="sto-jname">{d.name}{j.id === 'snowball' && j.n ? ` +${j.n}` : ''}</span>
                  </button>
                );
              })}
            </div>
            <div className="sto-omens">
              {Array.from({ length: OMEN_SLOTS }, (_, i) => {
                const o = run.omens[i];
                if (!o) return <div key={i} className="sto-omen sto-empty" />;
                return <button type="button" key={i} className={`sto-omen ${sel?.kind === 'omen' && sel.i === i ? 'sto-sel' : ''}`} onClick={() => setSel(sel?.kind === 'omen' && sel.i === i ? null : { kind: 'omen', i })} title={OMEN[o].text}>{OMEN[o].icon}</button>;
              })}
            </div>
          </div>
          {sel && <SelBar run={run} sel={sel} onClose={() => setSel(null)} doAct={async (a) => { if (await s.doAct(a)) setSel(null); }} />}
          {s.error && <div className="sto-err" role="alert">{s.error}</div>}
          {run.note && !s.error && <div className="sto-note">{run.note}</div>}
          {run.phase === 'blind' && run.last && !anim && <Breakdown key={run.last.id} ev={run.last} />}
          {inBlind || run.phase === 'over' || run.phase === 'won' ? (
            <KlondikeBoard game={run.board} onMove={(f, t) => void onMove(f, t)} onDraw={() => { if (run.phase === 'blind') void s.doAct({ t: 'draw' }); }} decorate={decorate}
              stockHint={run.board.stock.length === 0 && run.board.waste.length > 0 ? <span className="sto-redeal">{run.redeals > 0 ? `redeal (${run.redeals})` : 'no redeals'}</span> : null}>
              {anim && (
                <div className={`sto-anim ${anim.done ? 'sto-anim-done' : ''}`} data-testid="sto-anim">
                  <div className="sto-anim-step">{anim.ev.steps[anim.k - 1]?.icon} {anim.ev.steps[anim.k - 1]?.label}</div>
                  <div className="sto-cm"><span className="sto-chips">{fmtN(anim.chips)}</span><span>×</span><span className="sto-mult">{anim.mult}</span></div>
                  {anim.done && <div className="sto-total">+{fmtN(anim.ev.total)}</div>}
                </div>
              )}
              {run.phase === 'blind' && run.stuck && !anim && (
                <div className="sol-win sto-stuck" data-testid="sto-stuck" role="alert">
                  <div className="text-3xl">🚫</div>
                  <div className="mt-1 font-serif text-2xl">No moves left</div>
                  <div className="text-sm opacity-80">{run.redeals > 0 ? 'Nothing can be played.' : 'No redeals left and nothing can be played.'} This blind can’t reach its target.</div>
                  <button type="button" className="mt-3" onClick={() => void s.doAct({ t: 'forfeit' })} data-testid="sto-stuck-end">End run</button>
                </div>
              )}
              {(run.phase === 'over' || run.phase === 'won') && <RunOver run={run} best={s.best} signedIn={!!s.name} onNew={() => void s.start()} />}
            </KlondikeBoard>
          ) : (
            <Shop run={run} doAct={s.doAct} />
          )}
          {run.phase === 'blind' && !anim && (
            <div className="sto-foot">
              <span>Foundation plays score chips × mult. Streaks of foundation plays raise mult.</span>
              <button type="button" onClick={() => { if (confirm('Give up this run?')) void s.doAct({ t: 'forfeit' }); }}>Give up</button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function SelBar({ run, sel, onClose, doAct }: { run: Run; sel: { kind: 'joker' | 'omen'; i: number }; onClose: () => void; doAct: (a: Action) => void }) {
  if (sel.kind === 'joker') {
    const j = run.jokers[sel.i];
    if (!j) return null;
    const d = JOKER[j.id];
    return (
      <div className="sto-selbar">
        <span><b>{d.icon} {d.name}</b>{j.ed && <em className={`sto-edtag sto-ed-${j.ed}`}> {EDITION_INFO[j.ed].name} ({EDITION_INFO[j.ed].text})</em>} — {d.text}</span>
        <span className="sto-selbtns">
          <button type="button" disabled={sel.i === 0} onClick={() => doAct({ t: 'shift', i: sel.i, dir: -1 })} aria-label="Move left">◀</button>
          <button type="button" disabled={sel.i >= run.jokers.length - 1} onClick={() => doAct({ t: 'shift', i: sel.i, dir: 1 })} aria-label="Move right">▶</button>
          <button type="button" onClick={() => doAct({ t: 'sell', i: sel.i })}>Sell ${sellValue(j)}</button>
          <button type="button" onClick={onClose} aria-label="Close">✕</button>
        </span>
      </div>
    );
  }
  const o = run.omens[sel.i];
  if (!o) return null;
  const d = OMEN[o];
  const can = !(d.blindOnly && run.phase !== 'blind');
  return (
    <div className="sto-selbar">
      <span><b>{d.icon} {d.name}</b> — {d.text}</span>
      <span className="sto-selbtns"><button type="button" disabled={!can} onClick={() => doAct({ t: 'use', i: sel.i })}>Use</button><button type="button" onClick={onClose} aria-label="Close">✕</button></span>
    </div>
  );
}

function Shop({ run, doAct }: { run: Run; doAct: (a: Action) => Promise<boolean> }) {
  const nextTarget = blindTarget(run.ante, run.blind, run.boss);
  const boss = BOSS[run.boss];
  const enhanced = Object.entries(run.enh);
  return (
    <div className="sto-shop" data-testid="sto-shop">
      {run.payout && (
        <div className="sto-payout">
          <b>Blind cleared!</b> Score {fmtN(run.score)}
          <span>Reward ${run.payout.reward} · Leftover plays ${run.payout.leftover} · Interest ${run.payout.interest}</span>
          <b className="sto-money">+${run.payout.total}</b>
        </div>
      )}
      <div className="sto-shop-title">Shop <span className="opacity-70">· ${run.money}</span></div>
      <div className="sto-items">
        {run.shop.map((it, i) => {
          const d = it.kind === 'joker' ? JOKER[it.id] : OMEN[it.id];
          return (
            <div key={i} className={`sto-item ${it.kind === 'omen' ? 'sto-item-omen' : ''} ${it.kind === 'joker' && it.ed ? `sto-ed-${it.ed}` : ''} ${it.sold ? 'sto-sold' : ''}`} data-testid="sto-item">
              <div className="sto-item-icon">{d.icon}</div>
              <div className="sto-item-name">{d.name}</div>
              <div className="sto-item-kind">{it.kind === 'joker' ? (it.ed ? `${EDITION_INFO[it.ed].name} joker · ${EDITION_INFO[it.ed].text}` : 'Joker') : 'Omen'}</div>
              <div className="sto-item-text">{d.text}</div>
              <button type="button" disabled={!!it.sold || run.money < it.cost} onClick={() => void doAct({ t: 'buy', i })}>{it.sold ? 'Bought' : `Buy $${it.cost}`}</button>
            </div>
          );
        })}
      </div>
      <div className="sto-shop-actions">
        <button type="button" disabled={run.money < run.rerollCost} onClick={() => void doAct({ t: 'reroll' })} data-testid="sto-reroll">Reroll ${run.rerollCost}</button>
        <button type="button" className="sto-next" onClick={() => void doAct({ t: 'next' })} data-testid="sto-next">
          Next: Ante {run.ante} {BLIND_NAMES[run.blind]} · target {fmtN(nextTarget)}
        </button>
      </div>
      <div className={`sto-upcoming ${run.blind === 2 ? 'sto-upcoming-now' : ''}`}>{boss.icon} Ante {run.ante} boss: <b>{boss.name}</b> — {boss.text}</div>
      {enhanced.length > 0 && <div className="sto-deck">Deck: {enhanced.map(([id, e]) => <span key={id} className={`sto-enhtag sto-enh-${e}`}>{cardName(id)} {ENH_INFO[e].name}</span>)}</div>}
      <div className="sto-tip">Interest: $1 per $5 held at the end of a blind (max ${interestCap(run)}). Leftover plays pay too.</div>
    </div>
  );
}

function RunOver({ run, best, signedIn, onNew }: { run: Run; best: Best; signedIn: boolean; onNew: () => void }) {
  return (
    <div className="sol-win" data-testid="sto-over">
      <div className="text-4xl">{run.phase === 'won' ? '🏆' : '🂠'}</div>
      <div className="mt-1 font-serif text-2xl">{run.phase === 'won' ? 'Run complete!' : 'Run over'}</div>
      <div className="text-sm opacity-80">{run.note ?? ''} Reached ante {Math.min(run.ante, MAX_ANTE)} · {run.stats.blindsWon} blinds · best play {fmtN(run.stats.bestPlay)}</div>
      {best && <div className="text-sm opacity-80">Best ante {best.bestAnte} · {best.runs} runs · {best.wins} wins{signedIn ? '' : ' (this device — sign in to get on the board)'}</div>}
      <button type="button" className="mt-3" onClick={onNew}>New run</button>
    </div>
  );
}

function Intro({ onStart, best, signedIn }: { onStart: () => void; best: Best; signedIn: boolean }) {
  return (
    <div className="sto-center sto-intro">
      <div className="font-serif text-3xl">Solitro</div>
      <p>A solitaire run: clear 8 antes of three blinds each. Every card you play scores <b className="sto-chips">chips</b> × <b className="sto-mult">mult</b>; foundation streaks, reveals, cascades and finished suits score more. Hit the target before your plays run out.</p>
      <p>Between blinds, spend your winnings on jokers that bend the rules and omens that enhance your deck. Boss blinds fight back.</p>
      {best && <p className="opacity-80">Best ante {best.bestAnte} · {best.runs} runs · {best.wins} wins</p>}
      {!signedIn && <p className="opacity-80">Playing as a guest: your run is saved on this device. Sign in to keep it on your account and get on the board.</p>}
      <button type="button" className="sto-next" onClick={onStart} data-testid="sto-start">Start run</button>
    </div>
  );
}

function Leaderboard({ onClose, signedIn, best }: { onClose: () => void; signedIn: boolean; best: Best }) {
  const [rows, setRows] = useState<SolitroStanding[] | null>(null);
  useEffect(() => { void emitCasino<{ rows: SolitroStanding[] }>('solitro_board').then((r) => setRows(r.ok && r.rows ? r.rows : [])); }, []);
  return (
    <div className="sto-shop" data-testid="sto-board">
      <div className="sto-shop-title">Solitro · best runs <button type="button" className="ml-auto" onClick={onClose}>Back</button></div>
      {!signedIn && best && <div className="sto-tip">You (guest, this device): best ante {best.bestAnte}. Sign in to appear here.</div>}
      {!rows ? <div className="sto-center">Loading…</div> : !rows.length ? <div className="sto-center">No runs yet. Be the first.</div> : (
        <table className="sto-table">
          <thead><tr><th>#</th><th>Player</th><th>Best ante</th><th>Wins</th><th>Best play</th><th>Runs</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={r.name}><td>{i + 1}</td><td>{r.name}{r.qa && <span className="opacity-60"> (QA)</span>}</td><td>{r.bestAnte}</td><td>{r.wins}</td><td>{fmtN(r.bestPlay)}</td><td>{r.runs}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}
