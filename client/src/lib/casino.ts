import { useEffect, useState } from 'react';
import type { CasinoStanding } from '../../../shared/casino';
import { socket } from '@/lib/net';
import { useAccount } from '@/lib/auth';

export type CasinoAck<T = Record<string, unknown>> = { ok: boolean; error?: string } & Partial<T>;

const once = <T,>(event: string, payload: unknown, ms: number): Promise<CasinoAck<T> | null> =>
  new Promise((resolve) => {
    socket.timeout(ms).emit(event, payload, (err: unknown, res: CasinoAck<T>) => resolve(err ? null : res));
  });

/**
 * Casino request with ack. `retry` (only for server handlers that dedupe on `rid`, e.g. slots spins) resends once,
 * quietly, with the same request id after a timeout/reconnect, so a dropped ack never double-charges or shows an error.
 */
export async function emitCasino<T = Record<string, unknown>>(event: string, payload: unknown = {}, opts: { retry?: boolean } = {}): Promise<CasinoAck<T>> {
  const body = opts.retry && payload && typeof payload === 'object' ? { ...(payload as object), rid: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` } : payload;
  const first = await once<T>(event, body, 12_000);
  if (first || !opts.retry) return first ?? ({ ok: false, error: 'No answer from the server.' } as CasinoAck<T>);
  if (!socket.connected) await new Promise<void>((r) => { const t = setTimeout(r, 8000); socket.once('connect', () => { clearTimeout(t); r(); }); });
  return (await once<T>(event, body, 12_000)) ?? ({ ok: false, error: 'No answer from the server.' } as CasinoAck<T>);
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
