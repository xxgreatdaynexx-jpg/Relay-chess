import { useEffect, useState } from 'react';
import type { CasinoStanding } from '../../../shared/casino';
import { socket } from '@/lib/net';
import { useAccount } from '@/lib/auth';

export type CasinoAck<T = Record<string, unknown>> = { ok: boolean; error?: string } & Partial<T>;

export function emitCasino<T = Record<string, unknown>>(event: string, payload: unknown = {}): Promise<CasinoAck<T>> {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (err: unknown, res: CasinoAck<T>) => resolve(err ? ({ ok: false, error: 'No answer from the server.' } as CasinoAck<T>) : res));
  });
}

/** Signed-in name ('' when signed out). Chips follow the account. */
export function useSavedName(): [string, () => void] {
  return [useAccount(), () => {}];
}

export function notifyNameChanged(): void {
  window.dispatchEvent(new Event('relay-name-changed'));
}

/** Seconds left until a server deadline, correcting for clock skew via serverNow. */
export function useCountdown(deadline: number | null, serverNow: number | undefined): number | null {
  const [offset, setOffset] = useState(0);
  const [, force] = useState(0);
  useEffect(() => {
    if (serverNow) setOffset(serverNow - Date.now());
  }, [serverNow]);
  useEffect(() => {
    if (deadline === null) return;
    const id = window.setInterval(() => force((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, [deadline]);
  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000));
}

export function useCasinoBoard(active: boolean): CasinoStanding[] | null {
  const [rows, setRows] = useState<CasinoStanding[] | null>(null);
  useEffect(() => {
    if (!active) return;
    const on = (r: CasinoStanding[]) => setRows(r);
    socket.on('casino_board', on);
    const load = () => void emitCasino<{ rows: CasinoStanding[] }>('casino_board').then((r) => r.ok && r.rows && setRows(r.rows));
    load();
    socket.on('connect', load);
    return () => {
      socket.off('casino_board', on);
      socket.off('connect', load);
    };
  }, [active]);
  return rows;
}
