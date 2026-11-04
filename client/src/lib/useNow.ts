import { useEffect, useState } from 'react';
/** Ticks every `ms` (default 1s). */
export function useNow(ms = 1000): number {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setN(Date.now()), ms); return () => window.clearInterval(t); }, [ms]);
  return n;
}
