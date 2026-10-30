import { io, type Socket } from 'socket.io-client';
import { clearAuth, loadAuth, saveAuth } from './auth';
import type { Ack } from '../../../shared/types';

export const socket: Socket = io({
  autoConnect: false,
  auth: (cb) => cb({ session: loadAuth()?.token }),
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

// A stored session that the server no longer knows (expired, logged out elsewhere, reset) is dropped.
socket.on('connect', () => {
  const saved = loadAuth();
  if (!saved) return;
  socket.emit('auth_resume', { session: saved.token }, (res?: { ok: boolean; name?: string | null }) => {
    if (res?.ok && !res.name) clearAuth();
  });
});

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
