import { ADJ, CONTINENTS, EDGES, TERRITORIES, type Pt } from '../../../shared/conquest';

export const CQ_COLORS = ['#d9ae66', '#b23b3b', '#4f8fc0', '#8a5fb5', '#e9e2d4', '#4fa36b'];

/** Clip polygon by the half-plane closer to a than to b (Sutherland–Hodgman). */
function clip(poly: Pt[], a: Pt, b: Pt): Pt[] {
  const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const d: Pt = [b[0] - a[0], b[1] - a[1]];
  const side = (p: Pt) => (p[0] - m[0]) * d[0] + (p[1] - m[1]) * d[1];
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    const sp = side(p), sq = side(q);
    if (sp <= 0) out.push(p);
    if ((sp <= 0) !== (sq <= 0)) { const k = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]); }
  }
  return out;
}
/** Original Chudlands art: each continent's outline split into territory cells around their capitals. */
export const CELLS: Pt[][] = TERRITORIES.map((t) => {
  const c = CONTINENTS.find((x) => x.id === t.continent)!;
  return TERRITORIES.filter((o) => o.continent === t.continent && o.id !== t.id).reduce((poly, o) => clip(poly, t.at, o.at), c.poly);
});
const path = (p: Pt[]) => `M${p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`;

export interface MapProps {
  owner?: number[];
  armies?: number[];
  selected?: number | null;
  targets?: Set<number>;
  onPick?: (t: number) => void;
  flight?: { from: number; to: number; key: string; color: string } | null;
  compact?: boolean;
}

export function ConquestMap({ owner, armies, selected = null, targets, onPick, flight, compact }: MapProps) {
  return (
    <svg viewBox="0 0 1000 630" className="cq-map" role="img" aria-label="Map of the Chudlands">
      <defs>
        <pattern id="cq-waves" width="40" height="20" patternUnits="userSpaceOnUse"><path d="M0 10 q10 -6 20 0 t20 0" fill="none" stroke="#ffffff08" strokeWidth="1.2" /></pattern>
        <filter id="cq-rough"><feTurbulence baseFrequency="0.035" numOctaves="2" seed="4" /><feDisplacementMap in="SourceGraphic" scale="9" /></filter>
      </defs>
      <rect width="1000" height="630" fill="#0d1d18" />
      <rect width="1000" height="630" fill="url(#cq-waves)" />
      {EDGES.filter((e) => e[2]).map(([a, b]) => (
        <line key={`s${a}-${b}`} x1={TERRITORIES[a]!.at[0]} y1={TERRITORIES[a]!.at[1]} x2={TERRITORIES[b]!.at[0]} y2={TERRITORIES[b]!.at[1]} stroke="#e9e2d455" strokeWidth={2} strokeDasharray="6 7" />
      ))}
      {CONTINENTS.map((c) => (
        <g key={c.id} filter="url(#cq-rough)">
          <path d={path(c.poly)} fill={c.color} stroke="#0a1511" strokeWidth={10} strokeLinejoin="round" />
        </g>
      ))}
      {CELLS.map((cell, t) => {
        const o = owner?.[t];
        const pickable = Boolean(onPick && (targets ? targets.has(t) || selected === t : true));
        return (
          <path key={t} d={path(cell)} data-testid={`cq-t-${t}`} className={`cq-cell${pickable ? ' pick' : ''}${selected === t ? ' sel' : ''}${targets?.has(t) ? ' tgt' : ''}`}
            fill={o === undefined ? '#00000000' : `${CQ_COLORS[o]}38`} stroke="#0a151199" strokeWidth={1.6}
            onClick={onPick ? () => onPick(t) : undefined} />
        );
      })}
      {CONTINENTS.map((c) => {
        const xs = c.poly.map((p) => p[0]), ys = c.poly.map((p) => p[1]);
        return !compact && <text key={c.id} x={(Math.min(...xs) + Math.max(...xs)) / 2} y={Math.max(...ys) + 18} className="cq-cont" textAnchor="middle">{c.name.toUpperCase()} · +{c.bonus}</text>;
      })}
      {TERRITORIES.map((t) => {
        const o = owner?.[t.id];
        return (
          <g key={t.id} className="cq-token" pointerEvents="none">
            {!compact && <text x={t.at[0]} y={t.at[1] + 30} className="cq-name" textAnchor="middle">{t.name}</text>}
            <circle cx={t.at[0]} cy={t.at[1]} r={compact ? 9 : 15} fill={o === undefined ? '#e9e2d4' : CQ_COLORS[o]} stroke={selected === t.id ? '#fff' : '#0a1511'} strokeWidth={selected === t.id ? 3.5 : 2.5} />
            {armies && <text x={t.at[0]} y={t.at[1] + 5} className="cq-army" textAnchor="middle" fill={o === 1 || o === 3 ? '#fff' : '#14110c'}>{armies[t.id]}</text>}
          </g>
        );
      })}
      {flight && (() => {
        const a = TERRITORIES[flight.from]!.at, b = TERRITORIES[flight.to]!.at;
        return (
          <circle key={flight.key} r={10} fill={flight.color} stroke="#0a1511" strokeWidth={2} className="cq-flight" pointerEvents="none">
            <animate attributeName="cx" from={a[0]} to={b[0]} dur="0.55s" fill="freeze" />
            <animate attributeName="cy" from={a[1]} to={b[1]} dur="0.55s" fill="freeze" />
            <animate attributeName="opacity" values="1;1;0" dur="0.7s" fill="freeze" />
          </circle>
        );
      })()}
    </svg>
  );
}
export { ADJ };
