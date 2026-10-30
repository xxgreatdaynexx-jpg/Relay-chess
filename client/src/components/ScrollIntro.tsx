import { useCallback, useEffect, useRef, useState } from 'react';
import { RulesDialog } from '@/components/RulesDialog';
import { ParticleMorph } from '@/components/ParticleMorph';
import type { GameType } from '../../../shared/types';

type Panel = {
  id: GameType;
  index: string;
  pre: string;
  accent: string;
  blurb: string;
  steps: Array<[string, string]>;
};

const PANELS: Panel[] = [
  {
    id: 'chess', index: '01', pre: 'Relay', accent: 'Chess',
    blurb: 'One board, a whole team per side. Teammates take turns making moves on a shared clock, with no talking about the plan.',
    steps: [
      ['Pick a mode', '1v1 up to 3v3. Seats rotate White 1 → Black 1 → White 2 …'],
      ['Play your move', 'You only see the position you inherit. Make it count before the clock runs out.'],
      ['Climb the board', 'Wins, draws, accuracy and brilliancies land on the chess leaderboard.'],
    ],
  },
  {
    id: 'checkers', index: '02', pre: 'Relay', accent: 'Checkers',
    blurb: 'The same relay table on an 8×8 checkers board. Captures are forced, multi-jumps chain, and reaching the far row makes a king.',
    steps: [
      ['Same seats', 'Every relay mode, shared team clocks and spectating work just like chess.'],
      ['Jump or be jumped', 'If you can capture you must. Miss a winning move and it costs you.'],
      ['Own standings', 'Checkers results go to their own leaderboard tab.'],
    ],
  },
];

function MiniBoard({ kind }: { kind: GameType }) {
  const cells = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const dark = (r + c) % 2 === 1;
    cells.push(<rect key={`${r}${c}`} x={c * 10} y={r * 10} width={10} height={10} fill={dark ? '#6f4f36' : '#c9b48f'} />);
    if (kind === 'checkers' && dark && (r < 3 || r > 4)) {
      cells.push(<circle key={`p${r}${c}`} cx={c * 10 + 5} cy={r * 10 + 5} r={3.6} fill={r < 3 ? '#7a1f1f' : '#f4ead8'} stroke="#0004" strokeWidth={0.6} />);
    }
  }
  if (kind === 'chess') {
    const back = '♜♞♝♛♚♝♞♜';
    for (let c = 0; c < 8; c++) {
      cells.push(<text key={`b${c}`} x={c * 10 + 5} y={8} fontSize={8} textAnchor="middle" fill="#1d1712">{back[c]}</text>);
      cells.push(<text key={`bp${c}`} x={c * 10 + 5} y={18} fontSize={8} textAnchor="middle" fill="#1d1712">♟</text>);
      cells.push(<text key={`wp${c}`} x={c * 10 + 5} y={68} fontSize={8} textAnchor="middle" fill="#fff" stroke="#0007" strokeWidth={0.3}>♟</text>);
      cells.push(<text key={`w${c}`} x={c * 10 + 5} y={78} fontSize={8} textAnchor="middle" fill="#fff" stroke="#0007" strokeWidth={0.3}>{back[c]}</text>);
    }
  }
  return <svg viewBox="0 0 80 80" className="si-board" aria-hidden="true">{cells}</svg>;
}

/** Scroll-driven intro: each game is a full-height sticky panel; the next one slides over the last. */
export function ScrollIntro({ onPick }: { onPick: (game: GameType) => void }) {
  const refs = useRef<Array<HTMLElement | null>>([]);
  const [active, setActive] = useState(0);
  const slotRefs = useRef<Array<HTMLDivElement | null>>([]);
  const slots = useCallback(() => slotRefs.current, []);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const tick = () => {
      raf = 0;
      const h = window.innerHeight;
      let current = 0;
      refs.current.forEach((el, i) => {
        if (!el) return;
        const next = refs.current[i + 1];
        // progress of the following panel covering this one (0..1)
        const p = next ? Math.min(1, Math.max(0, 1 - next.getBoundingClientRect().top / h)) : 0;
        el.style.setProperty('--cover', reduce ? '0' : p.toFixed(3));
        if (el.getBoundingClientRect().top <= h * 0.5) current = i;
      });
      setActive(current);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(tick); };
    tick();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    const hash = window.location.hash.slice(1);
    const target = PANELS.findIndex((p) => p.id === hash);
    if (target >= 0) setTimeout(() => refs.current[target]?.scrollIntoView({ behavior: 'auto' }), 60);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);

  const go = (i: number) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    refs.current[i]?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
    history.replaceState(null, '', `#${PANELS[i]!.id}`);
  };

  return (
    <div className="si-wrap" data-testid="scroll-intro">
      <ParticleMorph slots={slots} />
      <nav className="si-dots" aria-label="Games">
        {PANELS.map((p, i) => (
          <button key={p.id} type="button" className={active === i ? 'on' : ''} aria-current={active === i} aria-label={`Relay ${p.accent}`}
            onClick={() => go(i)} data-testid={`dot-${p.id}`}>
            <span>{p.accent}</span>
          </button>
        ))}
      </nav>
      {PANELS.map((p, i) => (
        <section key={p.id} id={p.id} ref={(el) => { refs.current[i] = el; }} className={`si-panel si-${p.id}`} data-testid={`intro-${p.id}`} aria-labelledby={`si-h-${p.id}`}>
          <div className="si-grid" aria-hidden="true" />
          <div className="si-inner">
            <div className="si-index"><b>{p.index}</b> / 0{PANELS.length}</div>
            <div className="si-copy">
              <h2 id={`si-h-${p.id}`} className="si-title">{p.pre} <em>{p.accent}</em></h2>
              <p className="si-blurb">{p.blurb}</p>
              <div className="si-actions">
                <button type="button" className="si-cta" onClick={() => onPick(p.id)} data-testid={`play-${p.id}`}>Play {p.accent.toLowerCase()} →</button>
                <RulesDialog />
              </div>
            </div>
            <div className="si-visual" ref={(el) => { slotRefs.current[i] = el; }} data-testid={`visual-${p.id}`}><MiniBoard kind={p.id} /></div>
            <ol className="si-steps" aria-label={`How ${p.accent} works`} data-testid={`how-${p.id}`}>
              {p.steps.map(([t, d], k) => (
                <li key={t}><span>0{k + 1}</span><strong>{t}</strong><p>{d}</p></li>
              ))}
            </ol>
          </div>
          {i < PANELS.length - 1 && (
            <button type="button" className="si-next" onClick={() => go(i + 1)} aria-label={`Scroll to Relay ${PANELS[i + 1]!.accent}`}>Scroll · {PANELS[i + 1]!.accent} ↓</button>
          )}
        </section>
      ))}
    </div>
  );
}
