import type { Socket } from 'socket.io-client';

const signed = new WeakSet<Socket>();
export const TEST_PASSWORD = 'test-pass-123';

function emit(socket: Socket, event: string, data: unknown): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => socket.emit(event, data, resolve));
}

/** Before a name-using event, claim (or sign in to) that name on this socket once. */
export async function ensureSignedIn(socket: Socket, data: unknown): Promise<void> {
  const name = (data as { name?: unknown } | undefined)?.name;
  if (typeof name !== 'string' || signed.has(socket)) return;
  const claim = await emit(socket, 'auth_claim', { name, password: TEST_PASSWORD });
  if (!claim.ok) {
    const login = await emit(socket, 'auth_login', { name, password: TEST_PASSWORD });
    if (!login.ok) throw new Error(`test sign-in failed: ${login.error}`);
  }
  signed.add(socket);
}
