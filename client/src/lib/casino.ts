import { useEffect, useState } from 'react';
import type { CasinoStanding } from '../../../shared/casino';
import { socket } from '@/lib/net';
import { loadName } from '@/lib/playerName';

export type CasinoAck<T = Record<string, unknown>> = { ok: boolean; error?: string } & Partial<T>;

export function emitCasino<T = Record<string, unknown>>(event: string, payload: unknown = {}): Promise<CasinoAck<T>> {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (err: unknown, res: CasinoAck<T>) => resolve(err ? ({ ok: false, error: 'No answer from the server.' } as CasinoAck<T>) : res));
  });
}

/** Saved name, re-read when it changes in this or another tab. */
export function useSavedName(): [string, () => void] {
  const [name, setName] = useState(loadName);
  useEffect(() => {
    const on = () => setName(loadName());
    window.addEventListener('storage', on);
    window.addEventListener('relay-name-changed', on);
    return () => {
      window.removeEventListener('storage', on);
      window.removeEventListener('relay-name-changed', on);
    };
  }, []);
  return [name, () => setName(loadName())];
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
