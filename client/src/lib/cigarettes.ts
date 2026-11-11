import { useEffect, useState } from 'react';
import { socket } from '@/lib/net';
import { emitCasino } from '@/lib/casino';
import type { CigaretteView } from '../../../shared/cigarettes';

/** Shared live cigarette state for every open casino window on this page. */
export function useCigaretteState(open: boolean): CigaretteView | null {
  const [st, setSt] = useState<CigaretteView | null>(null);
  useEffect(() => {
    if (!open) { setSt(null); return; }
    const on = (v: CigaretteView) => setSt(v);
    socket.on('cig_state', on);
    void emitCasino<{ state: CigaretteView }>('cig_state').then((r) => { if (r.ok && r.state) setSt(r.state); });
    return () => { socket.off('cig_state', on); };
  }, [open]);
  return st;
}

export async function smokeCigarette(): Promise<{ ok: true; state: CigaretteView } | { ok: false; error: string }> {
  const r = await emitCasino<{ state: CigaretteView }>('cig_smoke', {}, { retry: true });
  if (r.ok && r.state) return { ok: true, state: r.state };
  return { ok: false, error: r.error ?? 'Could not smoke that.' };
}

export function cigRemain(st: CigaretteView | null, now = Date.now()): number {
  if (!st || !st.until) return 0;
  const skew = st.serverNow ? st.serverNow - now : 0;
  return Math.max(0, st.until - (now + skew));
}

export function formatCigRemain(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
