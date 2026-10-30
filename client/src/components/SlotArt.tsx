import type { ReactNode } from 'react';
import { Piece } from '@/components/Pieces';
import type { CoinValue } from '../../../shared/video-slots';

/** Original symbol art for the video slots (inline SVG + chess pieces). No third-party imagery. */
const G = 'url(#vs-gold)';
function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 64 64" className="vs-svg" aria-hidden>
      <defs>
        <linearGradient id="vs-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffe6a0" /><stop offset=".5" stopColor="#d9a43c" /><stop offset="1" stopColor="#8a5a14" /></linearGradient>
        <linearGradient id="vs-steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c9ccc4" /><stop offset="1" stopColor="#5d6259" /></linearGradient>
        <linearGradient id="vs-olive" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7d8a4e" /><stop offset="1" stopColor="#3b4324" /></linearGradient>
        <linearGradient id="vs-red" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff6a5a" /><stop offset="1" stopColor="#8e1410" /></linearGradient>
      </defs>
      {children}
    </svg>
  );
}

const ART: Record<string, () => ReactNode> = {
  // ---- Dragon Queen
  pawn: () => <Piece type="p" color="w" className="vs-piece" />,
  knight: () => <Piece type="n" color="w" className="vs-piece" />,
  bishop: () => <Piece type="b" color="w" className="vs-piece" />,
  rook: () => <Piece type="r" color="w" className="vs-piece" />,
  king: () => <Piece type="k" color="b" className="vs-piece vs-piece-dark" />,
  queen: () => (
    <span className="vs-queen">
      <Svg><path d="M4 40 C14 18 22 30 30 20 C24 34 14 34 4 40Z M60 40 C50 18 42 30 34 20 C40 34 50 34 60 40Z" fill="#7a1c10" stroke="#e7b450" strokeWidth="1.2" /></Svg>
      <Piece type="q" color="w" className="vs-piece vs-piece-gold" />
      <b className="vs-wild-tag">WILD</b>
    </span>
  ),
  crown: () => <Svg><path d="M8 46 L12 18 L24 32 L32 12 L40 32 L52 18 L56 46 Z" fill={G} stroke="#5a3a0c" strokeWidth="2" /><rect x="8" y="46" width="48" height="8" rx="2" fill={G} stroke="#5a3a0c" strokeWidth="2" /><circle cx="32" cy="36" r="4" fill="#a3161a" /></Svg>,
  chest: () => <Svg><rect x="8" y="26" width="48" height="28" rx="3" fill="#5b3418" stroke="#24130a" strokeWidth="2" /><path d="M8 28 Q32 6 56 28 Z" fill="#6e4020" stroke="#24130a" strokeWidth="2" /><rect x="8" y="30" width="48" height="5" fill={G} /><rect x="27" y="32" width="10" height="12" rx="2" fill={G} stroke="#24130a" /></Svg>,
  // ---- Warzone
  ammo: () => <Svg><rect x="8" y="20" width="48" height="32" rx="2" fill="url(#vs-olive)" stroke="#1d2111" strokeWidth="2" /><rect x="8" y="14" width="48" height="8" fill="#4b5530" stroke="#1d2111" strokeWidth="2" /><text x="32" y="42" textAnchor="middle" fontSize="11" fontWeight="900" fill="#d8d2a8" fontFamily="monospace">7.62</text></Svg>,
  tags: () => <Svg><path d="M20 6 Q32 2 44 8" stroke="#9aa09a" strokeWidth="2" fill="none" strokeDasharray="2 2" /><rect x="12" y="14" width="24" height="38" rx="10" fill="url(#vs-steel)" stroke="#2a2d29" strokeWidth="2" transform="rotate(-12 24 33)" /><rect x="28" y="16" width="24" height="38" rx="10" fill="url(#vs-steel)" stroke="#2a2d29" strokeWidth="2" transform="rotate(10 40 35)" /></Svg>,
  compass: () => <Svg><circle cx="32" cy="32" r="24" fill="#2b2a22" stroke="url(#vs-steel)" strokeWidth="5" /><path d="M32 12 L37 32 L32 52 L27 32 Z" fill="#b43a22" /><path d="M32 32 L37 32 L32 52 L27 32 Z" fill="#d9d5c2" /><circle cx="32" cy="32" r="3" fill="#111" /></Svg>,
  radio: () => <Svg><line x1="44" y1="4" x2="44" y2="20" stroke="#222" strokeWidth="3" /><rect x="12" y="18" width="40" height="38" rx="4" fill="url(#vs-olive)" stroke="#1d2111" strokeWidth="2" /><rect x="18" y="24" width="28" height="10" fill="#141810" /><circle cx="24" cy="45" r="5" fill="#222" /><circle cx="40" cy="45" r="5" fill="#222" /></Svg>,
  helmet: () => <Svg><path d="M8 42 Q8 12 32 12 Q56 12 56 42 Z" fill="url(#vs-olive)" stroke="#1d2111" strokeWidth="2" /><rect x="4" y="40" width="56" height="7" rx="3" fill="#3b4324" stroke="#1d2111" strokeWidth="2" /><path d="M14 30 Q32 22 50 30" stroke="#2c331a" strokeWidth="2" fill="none" /></Svg>,
  tank: () => <Svg><rect x="6" y="38" width="52" height="14" rx="7" fill="#2a2d1f" stroke="#111" strokeWidth="2" /><rect x="10" y="28" width="44" height="12" rx="2" fill="url(#vs-olive)" stroke="#1d2111" strokeWidth="2" /><rect x="22" y="18" width="20" height="12" rx="3" fill="url(#vs-olive)" stroke="#1d2111" strokeWidth="2" /><rect x="40" y="21" width="22" height="4" fill="#3b4324" stroke="#1d2111" /></Svg>,
  star: () => <Svg><circle cx="32" cy="32" r="27" fill="#3a1a0a" stroke="#e7b450" strokeWidth="3" /><path d="M32 10 L38 26 L55 26 L41 36 L46 53 L32 43 L18 53 L23 36 L9 26 L26 26 Z" fill={G} stroke="#3a1a0a" strokeWidth="1.5" /><text x="32" y="38" textAnchor="middle" fontSize="9" fontWeight="900" fill="#2a1406" fontFamily="monospace">WILD</text></Svg>,
  // ---- Gold Rush
  cherry: () => <Svg><path d="M22 40 Q26 18 40 8 M42 40 Q40 22 40 8" stroke="#3e6b1e" strokeWidth="3" fill="none" /><circle cx="22" cy="44" r="11" fill="url(#vs-red)" /><circle cx="42" cy="44" r="11" fill="url(#vs-red)" /></Svg>,
  bar: () => <Bars n={1} />,
  bar2: () => <Bars n={2} />,
  bar3: () => <Bars n={3} />,
  bell: () => <Svg><path d="M32 8 Q16 10 16 34 L10 46 L54 46 L48 34 Q48 10 32 8 Z" fill={G} stroke="#5a3a0c" strokeWidth="2" /><circle cx="32" cy="50" r="5" fill="#8a5a14" /></Svg>,
  seven: () => <Svg><text x="32" y="54" textAnchor="middle" fontSize="56" fontWeight="900" fill="url(#vs-red)" stroke="#2a0604" strokeWidth="2" fontFamily="Georgia, serif">7</text></Svg>,
  wild: () => <Svg><text x="32" y="48" textAnchor="middle" fontSize="50" fontWeight="900" fill={G} stroke="#3a2406" strokeWidth="2" fontFamily="Georgia, serif">7</text><rect x="10" y="46" width="44" height="12" rx="2" fill="#1b0f04" stroke="#e7b450" /><text x="32" y="55.5" textAnchor="middle" fontSize="9" fontWeight="900" fill="#ffd98a" fontFamily="monospace">WILD</text></Svg>,
  coin: () => <CoinArt />,
};

function Bars({ n }: { n: number }) {
  const ys = n === 1 ? [24] : n === 2 ? [16, 34] : [8, 25, 42];
  return <Svg>{ys.map((y) => <g key={y}><rect x="6" y={y} width="52" height="14" rx="2" fill="#151515" stroke="#d9a43c" strokeWidth="2" /><text x="32" y={y + 11.5} textAnchor="middle" fontSize="11" fontWeight="900" fill="#e8e1cc" fontFamily="Georgia, serif">BAR</text></g>)}</Svg>;
}

export function CoinArt({ value }: { value?: CoinValue | null }) {
  const label = value ? (value.tier ?? `${value.mult}×`) : '$';
  return <Svg><circle cx="32" cy="32" r="26" fill={G} stroke="#5a3a0c" strokeWidth="3" /><circle cx="32" cy="32" r="19" fill="none" stroke="#8a5a14" strokeWidth="1.5" strokeDasharray="3 2" /><text x="32" y={value?.tier ? 36 : 40} textAnchor="middle" fontSize={value?.tier ? 11 : value ? 16 : 24} fontWeight="900" fill="#3a2406" fontFamily="Georgia, serif">{label}</text></Svg>;
}

export function SlotSymbol({ id }: { id: string }) {
  const f = ART[id];
  return <span className={`vs-sym vs-sym-${id}`}>{f ? f() : id}</span>;
}
