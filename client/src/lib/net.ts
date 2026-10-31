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

export function request(event: string, data?: unknown, onOk?: (ack: Ack) => void): Promise<Ack> {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, data ?? {}, (error: Error | null, ack?: Ack) => {
      const result: Ack = error || !ack ? { ok: false, error: 'No response from the server.' } : ack;
      if (result.ok) onOk?.(result);
      resolve(result);
    });
  });
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

function ensureConnected(): Promise<void> {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve) => {
    socket.once('connect', () => resolve());
    socket.connect();
  });
}

export async function authCall(event: 'auth_status' | 'auth_claim' | 'auth_login', data: Record<string, unknown>): Promise<AuthAck> {
  await ensureConnected();
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
