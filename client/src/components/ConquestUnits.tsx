/** Original unit art for each Conquest faction: infantry (1), cavalry (5) and heavy (10) pieces. Drawn facing right, feet at y=0. */
export type Tier = 0 | 1 | 2;
export const tierOf = (n: number): Tier => (n >= 10 ? 2 : n >= 5 ? 1 : 0);

const INK = '#0a1511';

function Head({ f, c }: { f: string; c: string }) {
  switch (f) {
    case 'grande': return <><rect x={-3.6} y={-27} width={7.2} height={7} fill={INK} /><rect x={-4.4} y={-20.6} width={8.8} height={1.6} fill={INK} /><rect x={-0.8} y={-31} width={1.6} height={4.5} fill={c} /></>;
    case 'redcoat': return <><ellipse cx={0} cy={-24} rx={4.2} ry={6} fill={INK} /><rect x={-4.4} y={-20.2} width={8.8} height={1.2} fill="#e9d27a" /></>;
    case 'cossack': return <><rect x={-4.8} y={-25.5} width={9.6} height={6} rx={2.5} fill="#5b4632" /><rect x={-2} y={-27.2} width={4} height={2.4} fill={c} /></>;
    case 'samurai': return <><path d="M-5 -20 Q0 -28 5 -20 Z" fill={INK} /><path d="M-4 -24 L-7 -30 M4 -24 L7 -30" stroke="#e9d27a" strokeWidth={1.4} /></>;
    case 'marines': return <path d="M-5 -19.6 Q-5 -26.5 0 -26.5 Q5 -26.5 5 -19.6 L6.5 -19.6 L6.5 -18.6 L-6.5 -18.6 Z" fill="#4a5a3a" stroke={INK} strokeWidth={0.8} />;
    case 'robots': return <><rect x={-4.2} y={-25} width={8.4} height={7} rx={1} fill="#b8c4cc" stroke={INK} strokeWidth={0.8} /><rect x={-2.6} y={-23} width={5.2} height={1.8} fill={c} /><path d="M0 -25 L0 -29" stroke={INK} strokeWidth={1} /><circle cx={0} cy={-29.4} r={1.1} fill={c} /></>;
    default: return null;
  }
}

/** One soldier, about 30 units tall. */
function Infantry({ f, c }: { f: string; c: string }) {
  const robot = f === 'robots';
  const skin = robot ? '#b8c4cc' : '#e8c9a0';
  return (
    <g>
      <rect x={-3.4} y={-8} width={2.6} height={8} fill={robot ? '#8a969e' : '#1d1a16'} />
      <rect x={0.8} y={-8} width={2.6} height={8} fill={robot ? '#8a969e' : '#1d1a16'} />
      <rect x={-4.5} y={-18} width={9} height={11} rx={1.5} fill={c} stroke={INK} strokeWidth={0.9} />
      {f === 'grande' || f === 'redcoat' ? <path d="M-4 -17 L4 -9 M4 -17 L-4 -9" stroke="#f2ede2" strokeWidth={1.1} /> : null}
      {f === 'samurai' ? <rect x={-5} y={-12} width={10} height={4} fill={INK} opacity={0.6} /> : null}
      <circle cx={0} cy={-21.5} r={3.4} fill={skin} stroke={INK} strokeWidth={0.7} />
      <Head f={f} c={c} />
      {f === 'samurai'
        ? <path d="M3 -12 Q10 -20 14 -28" stroke="#dfe6ea" strokeWidth={1.4} fill="none" />
        : robot
          ? <><rect x={3} y={-15} width={10} height={2.6} fill="#5b6870" /><circle cx={13.5} cy={-13.7} r={1.2} fill={c} /></>
          : f === 'cossack'
            ? <path d="M3 -13 Q11 -16 14 -24" stroke="#dfe6ea" strokeWidth={1.3} fill="none" />
            : <><path d="M2 -12 L14 -17" stroke="#5b3b22" strokeWidth={1.8} /><path d="M13.5 -17 L17 -18.5" stroke="#dfe6ea" strokeWidth={0.9} /></>}
    </g>
  );
}

function Cavalry({ f, c }: { f: string; c: string }) {
  const robot = f === 'robots';
  const horse = robot ? '#8a969e' : f === 'cossack' ? '#3b2a1c' : f === 'samurai' ? '#1d1a16' : '#6b4a2f';
  if (f === 'marines') {
    // Armoured car instead of horses.
    return (
      <g>
        <rect x={-14} y={-14} width={28} height={10} rx={2.5} fill="#4a5a3a" stroke={INK} strokeWidth={1} />
        <rect x={-6} y={-19} width={12} height={6} rx={1.5} fill={c} stroke={INK} strokeWidth={0.9} />
        <rect x={5} y={-18} width={10} height={2} fill={INK} />
        <circle cx={-8} cy={-3} r={3.6} fill={INK} /><circle cx={8} cy={-3} r={3.6} fill={INK} />
      </g>
    );
  }
  return (
    <g>
      <g className="cq-legs">
        <rect x={-10} y={-7} width={2.2} height={7} fill={horse} /><rect x={-5.5} y={-7} width={2.2} height={7} fill={horse} />
        <rect x={5} y={-7} width={2.2} height={7} fill={horse} /><rect x={9} y={-7} width={2.2} height={7} fill={horse} />
      </g>
      <ellipse cx={0} cy={-10} rx={13} ry={5} fill={horse} stroke={INK} strokeWidth={0.9} />
      <path d="M10 -12 L16 -21 L20 -19 L14 -10 Z" fill={horse} stroke={INK} strokeWidth={0.9} />
      <path d="M-13 -11 Q-18 -8 -17 -2" stroke={robot ? '#5b6870' : INK} strokeWidth={1.8} fill="none" />
      <rect x={-6} y={-14} width={10} height={3} fill={c} />
      <g transform="translate(-1 -9) scale(0.78)"><Infantry f={f} c={c} /></g>
    </g>
  );
}

function Heavy({ f, c }: { f: string; c: string }) {
  if (f === 'marines') {
    return (
      <g>
        <rect x={-16} y={-9} width={32} height={8} rx={4} fill={INK} />
        {[-11, -4, 3, 10].map((x) => <circle key={x} cx={x} cy={-5} r={2.4} fill="#5b6870" />)}
        <path d="M-14 -9 L-12 -15 L13 -15 L15 -9 Z" fill="#4a5a3a" stroke={INK} strokeWidth={1} />
        <rect x={-7} y={-21} width={13} height={7} rx={2} fill={c} stroke={INK} strokeWidth={0.9} />
        <rect x={5} y={-19.5} width={16} height={2.6} fill={INK} className="cq-barrel" />
      </g>
    );
  }
  if (f === 'robots') {
    return (
      <g>
        <rect x={-8} y={-10} width={4} height={10} fill="#8a969e" stroke={INK} strokeWidth={0.8} />
        <rect x={4} y={-10} width={4} height={10} fill="#8a969e" stroke={INK} strokeWidth={0.8} />
        <rect x={-11} y={-25} width={22} height={16} rx={3} fill="#b8c4cc" stroke={INK} strokeWidth={1} />
        <rect x={-7} y={-21} width={14} height={4} fill={c} />
        <rect x={9} y={-20} width={13} height={4} fill="#5b6870" stroke={INK} strokeWidth={0.8} className="cq-barrel" />
        <circle cx={22.5} cy={-18} r={1.6} fill={c} />
      </g>
    );
  }
  // Field cannon with a gunner, coloured per faction.
  const wood = f === 'samurai' ? '#2a1d14' : '#6b4a2f';
  return (
    <g>
      <path d="M-14 -4 L4 -4" stroke={wood} strokeWidth={3} />
      <rect x={-6} y={-16} width={24} height={6} rx={3} fill={f === 'samurai' ? INK : '#3a3f44'} stroke={INK} strokeWidth={0.9} transform="rotate(-12 -6 -13)" className="cq-barrel" />
      <circle cx={0} cy={-7} r={7} fill="none" stroke={wood} strokeWidth={2.2} />
      <path d="M0 -14 L0 0 M-7 -7 L7 -7" stroke={wood} strokeWidth={1.2} />
      <rect x={-6} y={-14} width={4} height={3} fill={c} />
      <g transform="translate(-14 0) scale(0.72)"><Infantry f={f} c={c} /></g>
    </g>
  );
}

export function UnitSprite({ faction = 'grande', tier, color, scale = 1 }: { faction?: string; tier: Tier; color: string; scale?: number }) {
  return (
    <g transform={`scale(${scale})`} className={`cq-unit cq-unit-${tier}`} data-faction={faction} data-tier={tier}>
      <ellipse cx={0} cy={0.5} rx={tier ? 15 : 7} ry={2.4} fill="#0006" />
      {tier === 2 ? <Heavy f={faction} c={color} /> : tier === 1 ? <Cavalry f={faction} c={color} /> : <Infantry f={faction} c={color} />}
    </g>
  );
}

/** Faction banner/emblem: a small flag with an original device. */
export function FactionBanner({ faction, color, size = 28 }: { faction: string; color: string; size?: number }) {
  const device: Record<string, React.ReactNode> = {
    grande: <path d="M8 9 Q14 4 20 9 Q17 11 14 10 Q11 11 8 9 Z M14 10 L14 17" stroke={INK} strokeWidth={1.4} fill="#e9d27a" />,
    redcoat: <path d="M14 5 L16 11 L22 11 L17 15 L19 21 L14 17 L9 21 L11 15 L6 11 L12 11 Z" fill="#f2ede2" />,
    cossack: <path d="M7 18 Q14 2 21 18 M10 14 L18 14" stroke="#f2ede2" strokeWidth={2} fill="none" />,
    samurai: <><circle cx={14} cy={12} r={5.5} fill="#f2ede2" /><circle cx={14} cy={12} r={2.5} fill={INK} /></>,
    marines: <path d="M14 4 L14 20 M8 8 L20 8 M7 15 Q14 23 21 15" stroke="#f2ede2" strokeWidth={2} fill="none" />,
    robots: <><rect x={8} y={7} width={12} height={10} rx={2} fill="#f2ede2" /><rect x={10} y={10} width={3} height={2.5} fill={INK} /><rect x={15} y={10} width={3} height={2.5} fill={INK} /></>,
  };
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} className="cq-banner" aria-hidden>
      <rect x={1} y={1} width={2} height={26} fill="#c9b27a" />
      <path d="M3 2 L26 2 L26 22 L14.5 18 L3 22 Z" fill={color} stroke={INK} strokeWidth={1} />
      {device[faction]}
    </svg>
  );
}
