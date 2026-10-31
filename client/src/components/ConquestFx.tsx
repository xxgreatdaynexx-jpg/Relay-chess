import { useEffect } from 'react';
import type { CqMap } from '../../../shared/conquest';
import { UnitSprite, tierOf } from '@/components/ConquestUnits';
import { playBoom, playGunshot } from '@/lib/sounds';

/** One dice roll, drawn as a short firefight between two territories. */
export interface Battle { key: string; from: number; to: number; att: number[]; def: number[]; attLost: number; defLost: number; conquered: boolean; attN: number; defN: number; attColor: string; defColor: string; attFaction?: string; defFaction?: string }

let lastBoom = 0;
/** Gunfire per die (staggered), a cannon/explosion when a side loses armies. Sounds go through the shared master volume and mute. */
export function battleSounds(b: Battle, ms: number): Array<ReturnType<typeof setTimeout>> {
  const ids: Array<ReturnType<typeof setTimeout>> = [];
  const step = Math.max(40, ms / 6);
  b.att.forEach((_, i) => ids.push(setTimeout(() => playGunshot(tierOf(b.attN) > 0 ? 0.55 : 0.4), i * step)));
  b.def.forEach((_, i) => ids.push(setTimeout(() => playGunshot(0.3), step / 2 + i * step)));
  if (b.defLost + b.attLost > 0) ids.push(setTimeout(() => { const t = Date.now(); if (t - lastBoom > 350) { lastBoom = t; playBoom(); } }, step * 3));
  return ids;
}

/** Muzzle flashes, tracers, explosions on the losing side and units falling for each loss. `ms` is the dice-speed duration. */
export function BattleFx({ map, battle: b, ms, scale = 1, sound = true }: { map: CqMap; battle: Battle; ms: number; scale?: number; sound?: boolean }) {
  useEffect(() => {
    if (!sound) return;
    const ids = battleSounds(b, ms);
    return () => ids.forEach(clearTimeout);
  }, [b.key]);
  const A = map.territories[b.from]!.at, D = map.territories[b.to]!.at;
  const step = Math.max(40, ms / 6);
  const dur = Math.max(500, ms * 1.6);
  const dx = D[0] - A[0], dy = D[1] - A[1], len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const heavy = tierOf(b.attN) > 0;
  const flash = (x: number, y: number, delay: number, k: string, big = false) => (
    <g key={k} transform={`translate(${x} ${y}) scale(${scale * 1.3})`}>
      <g className="cq-flash" style={{ animationDelay: `${delay}ms`, animationDuration: `${Math.max(120, step * 1.2)}ms` }}>
        <path d={big ? 'M0 -11 L3 -3 L11 0 L3 3 L0 11 L-3 3 L-11 0 L-3 -3 Z' : 'M0 -7 L2 -2 L7 0 L2 2 L0 7 L-2 2 L-7 0 L-2 -2 Z'} fill="#ffe27a" stroke="#ff8a2a" strokeWidth={1.2} />
      </g>
    </g>
  );
  const boom = (x: number, y: number, delay: number, k: string, sz = 46, size = sz * scale * 1.35) => (
    <foreignObject key={k} x={x - size / 2} y={y - size / 2 - 6} width={size} height={size} pointerEvents="none">
      <div className="cq-boom" style={{ animationDelay: `${delay}ms, ${delay}ms`, ['--cq-boom-ms' as string]: `${Math.max(360, ms)}ms` }} />
    </foreignObject>
  );
  const fall = (x: number, y: number, delay: number, k: string, faction: string | undefined, color: string, dir: number) => (
    <g key={k} transform={`translate(${x} ${y})`}>
      <g className="cq-fall" style={{ animationDelay: `${delay}ms`, animationDuration: `${dur}ms`, ['--cq-fall-dir' as string]: dir }}>
        <UnitSprite faction={faction} tier={0} color={color} scale={scale * 0.85} />
      </g>
    </g>
  );
  const els: React.ReactNode[] = [];
  const off = 16 * scale;
  b.att.forEach((_, i) => {
    const t = i * step;
    els.push(flash(A[0] + ux * off + uy * (i - 1) * 6, A[1] - 8 + uy * off - ux * (i - 1) * 6, t, `af${i}`, heavy));
    els.push(<line key={`tr${i}`} className="cq-tracer" x1={A[0] + ux * off} y1={A[1] - 8 + uy * off} x2={D[0] - ux * off} y2={D[1] - 8 - uy * off} stroke={heavy ? '#ffb347' : '#ffe9a8'} strokeWidth={heavy ? 3 : 1.6} strokeLinecap="round" style={{ animationDelay: `${t}ms`, animationDuration: `${Math.max(140, step * 1.6)}ms` }} />);
  });
  b.def.forEach((_, i) => els.push(flash(D[0] - ux * off - uy * (i - 0.5) * 6, D[1] - 8 - uy * off + ux * (i - 0.5) * 6, step / 2 + i * step, `df${i}`)));
  const hit = step * 3;
  for (let i = 0; i < b.defLost; i++) {
    els.push(boom(D[0] + (i - (b.defLost - 1) / 2) * 16, D[1], hit + i * step, `db${i}`, b.conquered && i === b.defLost - 1 ? 64 : 46));
    els.push(fall(D[0] + 10 + i * 10, D[1] + 6, hit + i * step, `dk${i}`, b.defFaction, b.defColor, ux >= 0 ? 1 : -1));
  }
  for (let i = 0; i < b.attLost; i++) {
    els.push(boom(A[0] + (i - (b.attLost - 1) / 2) * 16, A[1], hit + i * step, `ab${i}`, 40));
    els.push(fall(A[0] - 10 - i * 10, A[1] + 6, hit + i * step, `ak${i}`, b.attFaction, b.attColor, ux >= 0 ? -1 : 1));
  }
  return <g className="cq-battle" pointerEvents="none" data-testid="cq-battle" data-key={b.key} data-booms={b.attLost + b.defLost}>{els}</g>;
}
