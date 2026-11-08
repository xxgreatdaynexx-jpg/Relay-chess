import { io, type Socket } from 'socket.io-client';
import { clearAuth, loadAuth, saveAuth } from './auth';
import type { Ack } from '../../../shared/types';

/** A random per-browser id. Used only to stop one device spectating a Hold'em table it is seated at. */
function deviceId(): string {
  try {
    let d = localStorage.getItem('relay-device');
    if (!d) { d = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('relay-device', d); }
    return d;
  } catch { return ''; }
}

export const socket: Socket = io({
  autoConnect: false,
  auth: (cb) => cb({ session: loadAuth()?.token, device: deviceId() }),
  transports: ['websocket', 'polling'],
});

/** Money-moving stock events. QA r9: they carry a request id (`rid`) so a retry is answered with the first result
 *  instead of trading twice, get a longer time limit (a cold DB connection can take > 8 s), and are retried once on timeout. */
const IDEMPOTENT = /^stk2?_(buy|sell|fund_buy|fund_sell|short_open|short_close|opt_buy|opt_close|opt_sell)$/;
const newRid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
export function request(event: string, data?: unknown, onOk?: (ack: Ack) => void): Promise<Ack> {
  const money = IDEMPOTENT.test(event);
  const payload = money && data && typeof data === 'object' ? { ...(data as object), rid: newRid() } : (data ?? {});
  const once = (ms: number) => new Promise<Ack | null>((resolve) => { socket.timeout(ms).emit(event, payload, (error: Error | null, ack?: Ack) => resolve(error || !ack ? null : ack)); });
  return (async () => {
    let ack = await once(money ? 20_000 : 8000);
    if (!ack && money) ack = await once(20_000); // same rid: the server replays the first answer, never charges twice
    const result: Ack = ack ?? { ok: false, error: 'No response from the server.' };
    if (result.ok) onOk?.(result);
    return result;
  })();
}

// Re-sends the stored session on every (re)connect. The token is forgotten ONLY when the server
// explicitly says it is invalid; timeouts, restarts and database hiccups keep it and retry.
export function resumeStoredSession(attempt = 0): void {
  const saved = loadAuth();
  if (!saved || !socket.connected) return;
  socket.timeout(10000).emit('auth_resume', { session: saved.token }, (err: Error | null, res?: { ok: boolean; name?: string | null; invalid?: boolean }) => {
    if (!err && res?.ok && res.invalid === true && !res.name) {
      if (loadAuth()?.token === saved.token) clearAuth();
      return;
    }
    if ((err || !res?.ok) && attempt < 8) setTimeout(() => resumeStoredSession(attempt + 1), Math.min(30000, 1000 * 2 ** attempt));
  });
}
socket.on('connect', () => resumeStoredSession());

type AuthAck = { ok: boolean; error?: string; name?: string; session?: string; claimed?: boolean; reserved?: boolean };

/** Resolves true once connected, false after `ms` (t2051: sign-in used to wait forever with the button stuck on a bad mobile connection). */
export function ensureConnected(ms = 10_000): Promise<boolean> {
  if (socket.connected) return Promise.resolve(true);
  return new Promise((resolve) => {
    const ok = () => { clearTimeout(t); resolve(true); };
    const t = setTimeout(() => { socket.off('connect', ok); resolve(false); }, ms);
    socket.once('connect', ok);
    socket.connect();
  });
}

export async function authCall(event: 'auth_status' | 'auth_claim' | 'auth_login', data: Record<string, unknown>): Promise<AuthAck> {
  if (!(await ensureConnected())) return { ok: false, error: 'Can’t reach the server. Check your connection and try again.' };
  return new Promise((resolve) => {
    socket.timeout(10000).emit(event, data, (err: Error | null, res?: AuthAck) => {
      const out = err || !res ? { ok: false, error: 'No response from the server.' } : res;
      if (out.ok && out.session && out.name) saveAuth({ name: out.name, token: out.session });
      resolve(out);
    });
  });
}

export function logout(): void {
  const saved = loadAuth();
  clearAuth();
  if (saved && socket.connected) socket.emit('auth_logout', { session: saved.token }, () => {});
}
