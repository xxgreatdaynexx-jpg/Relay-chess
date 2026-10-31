import { useEffect, useRef, useState } from 'react';
import { ADJ, CQ_PALETTE, mapById, type CqMap, type Pt } from '../../../shared/conquest';
import { tierOf, UnitSprite } from '@/components/ConquestUnits';

export const CQ_COLORS = CQ_PALETTE;

const path = (p: Pt[]) => `M${p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`;
const dark = (hex: string) => { const n = parseInt(hex.slice(1, 7), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 150; };

export interface Flight { from: number; to: number; key: string; color: string; faction?: string; n?: number }
export interface MapProps {
  map?: CqMap | string;
  owner?: number[];
  armies?: number[];
  selected?: number | null;
  targets?: Set<number>;
  onPick?: (t: number) => void;
  flight?: Flight | null;
  compact?: boolean;
  /** Colour per player index (defaults to the palette order). */
  colors?: string[];
  /** Faction id per player index (unit art). */
  factions?: Array<string | undefined>;
  /** Show zoom buttons and allow wheel/drag/pinch pan & zoom. */
  zoomable?: boolean;
  children?: React.ReactNode;
}

type VB = [number, number, number, number];

export function ConquestMap({ map, owner, armies, selected = null, targets, onPick, flight, compact, colors = CQ_COLORS, factions, zoomable, children }: MapProps) {
  const m = typeof map === 'object' ? map : mapById(map);
  const full: VB = [0, 0, m.w, m.h];
  const [vb, setVb] = useState<VB>(full);
  useEffect(() => setVb([0, 0, m.w, m.h]), [m.id, m.w, m.h]);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ pts: Map<number, Pt>; moved: number; start?: { vb: VB; mid: Pt; dist: number } }>({ pts: new Map(), moved: 0 });

  const clamp = (v: VB): VB => {
    const w = Math.min(m.w, Math.max(m.w / 5, v[2])), h = w * (m.h / m.w);
    return [Math.min(m.w - w, Math.max(0, v[0])), Math.min(m.h - h, Math.max(0, v[1])), w, h];
  };
  const toMap = (cx: number, cy: number, v: VB): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return [v[0] + ((cx - r.left) / r.width) * v[2], v[1] + ((cy - r.top) / r.height) * v[3]];
  };
  const zoomAt = (k: number, at?: Pt) => setVb((v) => {
    const c = at ?? [v[0] + v[2] / 2, v[1] + v[3] / 2];
    return clamp([c[0] - (c[0] - v[0]) * k, c[1] - (c[1] - v[1]) * k, v[2] * k, v[3] * k]);
  });

  useEffect(() => {
    const el = svg.current;
    if (!zoomable || !el) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); setVb((v) => { const at = toMap(e.clientX, e.clientY, v); const k = e.deltaY > 0 ? 1.15 : 1 / 1.15; return clamp([at[0] - (at[0] - v[0]) * k, at[1] - (at[1] - v[1]) * k, v[2] * k, v[3] * k]); }); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  const gesture = () => {
    const pts = [...drag.current.pts.values()];
    const mid: Pt = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
    const dist = pts.length > 1 ? Math.hypot(pts[0]![0] - pts[1]![0], pts[0]![1] - pts[1]![1]) : 0;
    return { mid, dist };
  };
  const onDown = (e: React.PointerEvent) => {
    if (!zoomable) return;
    drag.current.pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (drag.current.pts.size === 1) drag.current.moved = 0;
    drag.current.start = { vb, ...gesture() };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!zoomable || !d.pts.has(e.pointerId) || !d.start) return;
    d.pts.set(e.pointerId, [e.clientX, e.clientY]);
    const g = gesture(), s = d.start, r = svg.current!.getBoundingClientRect();
    d.moved = Math.max(d.moved, Math.hypot(g.mid[0] - s.mid[0], g.mid[1] - s.mid[1]));
    const k = s.dist && g.dist ? s.dist / g.dist : 1;
    const w = s.vb[2] * k, h = s.vb[3] * k;
    // Keep the map point under the starting midpoint under the current midpoint.
    const ax = s.vb[0] + ((s.mid[0] - r.left) / r.width) * s.vb[2], ay = s.vb[1] + ((s.mid[1] - r.top) / r.height) * s.vb[3];
    if (d.moved > 6 || k !== 1) setVb(clamp([ax - ((g.mid[0] - r.left) / r.width) * w, ay - ((g.mid[1] - r.top) / r.height) * h, w, h]));
  };
  const onUp = (e: React.PointerEvent) => { drag.current.pts.delete(e.pointerId); drag.current.start = drag.current.pts.size ? { vb, ...gesture() } : undefined; };
  const click = (t: number) => { if (drag.current.moved > 8) return; onPick?.(t); };

  const T = m.territories;
  const zoomed = vb[2] < m.w - 1;
  const unitScale = Math.min(1.5, Math.max(0.95, m.w / 950)) * (compact ? 0.7 : 1);
  return (
    <div className={`cq-mapwrap${zoomable ? ' zoomable' : ''}`}>
      <svg ref={svg} viewBox={vb.join(' ')} className="cq-map" role="img" aria-label={`Map: ${m.name}`} data-map={m.id}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onUp}
        style={zoomable ? { touchAction: 'none' } : undefined}>
        <defs>
          <pattern id="cq-waves" width="40" height="20" patternUnits="userSpaceOnUse"><path d="M0 10 q10 -6 20 0 t20 0" fill="none" stroke="#ffffff08" strokeWidth="1.2" /></pattern>
          <filter id="cq-rough"><feTurbulence baseFrequency="0.035" numOctaves="2" seed="4" /><feDisplacementMap in="SourceGraphic" scale="9" /></filter>
        </defs>
        <rect width={m.w} height={m.h} fill={m.id === 'mars' ? '#1d0f0b' : '#0d1d18'} />
        <rect width={m.w} height={m.h} fill="url(#cq-waves)" />
        {m.edges.filter((e) => e[2]).map(([a, b]) => (
          <line key={`s${a}-${b}`} x1={T[a]!.at[0]} y1={T[a]!.at[1]} x2={T[b]!.at[0]} y2={T[b]!.at[1]} stroke="#e9e2d455" strokeWidth={2} strokeDasharray="6 7" />
        ))}
        <g filter="url(#cq-rough)">
          {m.cells.map((cell, t) => {
            const c = m.continents.find((x) => x.id === T[t]!.continent)!;
            return <path key={t} d={path(cell)} fill={c.color} stroke="#0a1511" strokeWidth={8} strokeLinejoin="round" />;
          })}
        </g>
        {m.cells.map((cell, t) => {
          const o = owner?.[t];
          const pickable = Boolean(onPick && (targets ? targets.has(t) || selected === t : true));
          return (
            <path key={t} d={path(cell)} data-testid={`cq-t-${t}`} data-owner={o} data-armies={armies?.[t]} className={`cq-cell${pickable ? ' pick' : ''}${selected === t ? ' sel' : ''}${targets?.has(t) ? ' tgt' : ''}`}
              fill={o === undefined ? '#00000000' : `${colors[o]}38`} stroke="#0a151199" strokeWidth={1.6}
              onClick={onPick ? () => click(t) : undefined} />
          );
        })}
        {!compact && m.continents.map((c) => {
          const ts = T.filter((t) => t.continent === c.id);
          const x = ts.reduce((a, t) => a + t.at[0], 0) / ts.length, y = Math.max(...ts.map((t) => t.at[1])) + 52;
          return <text key={c.id} x={x} y={Math.min(m.h - 8, y)} className="cq-cont" textAnchor="middle" pointerEvents="none">{c.name.toUpperCase()} · +{c.bonus}</text>;
        })}
        {T.map((t) => {
          const o = owner?.[t.id];
          const n = armies?.[t.id];
          const col = o === undefined ? '#e9e2d4' : colors[o]!;
          return (
            <g key={t.id} className={`cq-token${selected === t.id ? ' sel' : ''}`} pointerEvents="none" data-tier={n !== undefined ? tierOf(n) : undefined}>
              {!compact && <text x={t.at[0]} y={t.at[1] + 24} className="cq-name" textAnchor="middle">{t.name}</text>}
              {n === undefined || o === undefined
                ? <circle cx={t.at[0]} cy={t.at[1]} r={compact ? 7 : 11} fill={col} stroke="#0a1511" strokeWidth={2} />
                : <>
                    {selected === t.id && <ellipse cx={t.at[0]} cy={t.at[1] + 2} rx={22} ry={7} fill="none" stroke="#fff" strokeWidth={2.5} />}
                    <g transform={`translate(${t.at[0]} ${t.at[1] + 4})`}><g className="cq-bob" style={{ animationDelay: `${(t.id * 0.137) % 1.6}s` }}><UnitSprite faction={factions?.[o] ?? 'grande'} tier={tierOf(n)} color={col} scale={unitScale} /></g></g>
                    <g transform={`translate(${t.at[0] + 14 * unitScale} ${t.at[1] - 22 * unitScale})`}>
                      <circle r={9.5} fill={col} stroke="#0a1511" strokeWidth={2} />
                      <text y={4} className="cq-army" textAnchor="middle" fill={dark(col) ? '#fff' : '#14110c'}>{n}</text>
                    </g>
                  </>}
            </g>
          );
        })}
        {flight && (() => {
          const a = T[flight.from]!.at, b = T[flight.to]!.at;
          const n = flight.n ?? 1;
          return (
            <g key={flight.key} className="cq-flight" pointerEvents="none" data-testid="cq-march">
              <animateTransform attributeName="transform" type="translate" from={`${a[0]} ${a[1] + 4}`} to={`${b[0]} ${b[1] + 4}`} dur="0.7s" fill="freeze" />
              <animate attributeName="opacity" values="1;1;1;0" dur="0.85s" fill="freeze" />
              <g className="cq-march" transform={b[0] < a[0] ? 'scale(-1 1)' : undefined}>
                <UnitSprite faction={flight.faction} tier={tierOf(n)} color={flight.color} scale={unitScale} />
                {n > 1 && tierOf(n) === 0 && <g transform="translate(-9 3)"><UnitSprite faction={flight.faction} tier={0} color={flight.color} scale={unitScale * 0.85} /></g>}
              </g>
            </g>
          );
        })()}
        {children}
      </svg>
      {zoomable && (
        <div className="cq-zoom" data-testid="cq-zoom">
          <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1 / 1.35)}>+</button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomAt(1.35)}>−</button>
          {zoomed && <button type="button" aria-label="Reset zoom" onClick={() => setVb(full)}>⤢</button>}
        </div>
      )}
    </div>
  );
}
export { ADJ };
