/** MU #9 v2: candlestick chart with volume bars and a touch/hover readout. Display only. */
import { useMemo, useRef, useState } from 'react';
import type { Candle } from '../../../../shared/stockStats';

const fmt = (t: number, long: boolean) => { const d = new Date(t); const hm = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); return long ? `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${hm}` : hm; };
export function CandleChart({ candles, height = 220, long = false, testid = 'stk-candles' }: { candles: Candle[]; height?: number; long?: boolean; testid?: string }) {
  const ref = useRef<HTMLDivElement>(null); const [hi, setHi] = useState<number | null>(null);
  const W = 600, H = height, VH = Math.round(height * 0.22), PH = H - VH - 6;
  const g = useMemo(() => {
    if (!candles.length) return null;
    const lo = Math.min(...candles.map((c) => c.l)), hh = Math.max(...candles.map((c) => c.h)); const pad = (hh - lo) * 0.08 || Math.max(0.01, hh * 0.01);
    const y0 = lo - pad, y1 = hh + pad; const vmax = Math.max(1, ...candles.map((c) => c.v)); const slot = W / candles.length;
    return { Y: (p: number) => PH - ((p - y0) / (y1 - y0)) * PH, V: (v: number) => (v / vmax) * VH, slot, bw: Math.max(1, Math.min(14, slot * 0.7)), lo, hh };
  }, [candles, PH, VH]);
  if (!g) return <p className="mt-2 rounded bg-black/20 p-6 text-center text-xs opacity-60">Not enough history for candles yet.</p>;
  const c = hi != null ? candles[hi] : candles[candles.length - 1]!; const up = c ? c.c >= c.o : true;
  const move = (x: number) => { const r = ref.current?.getBoundingClientRect(); if (!r) return; setHi(Math.max(0, Math.min(candles.length - 1, Math.floor(((x - r.left) / r.width) * candles.length)))); };
  return (
    <div data-testid={testid}>
      {c && <div className="mb-1 flex flex-wrap gap-x-3 text-[11px] tabular-nums" data-testid={`${testid}-ohlc`}>
        <span className="opacity-60">{fmt(c.t, long)}</span><span>O <b>{c.o.toFixed(2)}</b></span><span>H <b>{c.h.toFixed(2)}</b></span><span>L <b>{c.l.toFixed(2)}</b></span><span>C <b className={up ? 'text-emerald-400' : 'text-rose-400'}>{c.c.toFixed(2)}</b></span><span className="opacity-70">Vol <b>{c.v.toLocaleString()}</b></span>
      </div>}
      <div ref={ref} className="relative touch-none select-none" onPointerMove={(e) => move(e.clientX)} onPointerDown={(e) => move(e.clientX)} onPointerLeave={() => setHi(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height: H }} data-testid={`${testid}-svg`}>
          {candles.map((k, i) => { const x = i * g.slot + g.slot / 2; const col = k.c >= k.o ? '#22c55e' : '#f43f5e'; const top = g.Y(Math.max(k.o, k.c)), bot = g.Y(Math.min(k.o, k.c));
            return <g key={k.t} opacity={hi == null || hi === i ? 1 : 0.55}>
              <line x1={x} x2={x} y1={g.Y(k.h)} y2={g.Y(k.l)} stroke={col} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
              <rect x={x - g.bw / 2} width={g.bw} y={top} height={Math.max(1, bot - top)} fill={col} rx="0.5" />
              <rect x={x - g.bw / 2} width={g.bw} y={H - g.V(k.v)} height={g.V(k.v)} fill={col} opacity="0.35" data-testid="stk-vol-bar" />
            </g>; })}
          <line x1="0" x2={W} y1={PH + 3} y2={PH + 3} stroke="#fff2" vectorEffect="non-scaling-stroke" />
          {hi != null && <line x1={hi * g.slot + g.slot / 2} x2={hi * g.slot + g.slot / 2} y1="0" y2={H} stroke="#fff5" vectorEffect="non-scaling-stroke" />}
        </svg>
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums opacity-50"><span>{fmt(candles[0]!.t, long)}</span><span>Low {g.lo.toFixed(2)} · High {g.hh.toFixed(2)} · bars = volume</span><span>Now</span></div>
    </div>
  );
}
