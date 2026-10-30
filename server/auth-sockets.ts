/** Socket events for claiming / signing in to a name. The signed-in identity lives on socket.data.account. */
import type { Socket } from 'socket.io';
import { AuthError, getAccounts, type Identity } from './accounts.js';

type Ack = (res: { ok: boolean; error?: string; [k: string]: unknown }) => void;

/** Name of the signed-in account on this socket, or a plain-words error. Never trusts a name sent by the client. */
export function signedIn(socket: Socket): string {
  const account = socket.data.account as Identity | undefined;
  if (!account) throw new AuthError('Sign in (or claim a name) first.');
  return account.name;
}

export function clientIp(socket: Socket): string {
  const fwd = socket.handshake.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || socket.handshake.address || 'unknown';
}

function validName(input: unknown): string {
  if (typeof input !== 'string') throw new AuthError('Enter a name.');
  const name = input.replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > 18) throw new AuthError('Enter a name (1–18 characters).');
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .'-]*$/u.test(name)) throw new AuthError('Use letters, numbers, and spaces in your name.');
  return name;
}

export function registerAuth(socket: Socket): void {
  const run = (fn: (body: Record<string, unknown>) => Promise<Record<string, unknown> | void>) => (payload: unknown, ack?: Ack) => {
    const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    fn(body)
      .then((extra) => ack?.({ ok: true, ...(extra ?? {}) }))
      .catch((err: unknown) => {
        const message = err instanceof AuthError || err instanceof Error ? err.message : 'Something went wrong.';
        if (!(err instanceof AuthError)) console.error('[auth] error:', message);
        ack?.({ ok: false, error: err instanceof AuthError ? message : 'Sign-in failed. Try again.' });
      });
  };

  socket.on('auth_status', run(async (body) => {
    const name = validName(body.name);
    const s = await getAccounts().status(name);
    const me = socket.data.account as Identity | undefined;
    return { ...s, you: me?.name ?? null };
  }));

  socket.on('auth_claim', run(async (body) => {
    const { identity, token } = await getAccounts().claim(validName(body.name), body.password as string, clientIp(socket));
    socket.data.account = identity;
    return { name: identity.name, session: token };
  }));

  socket.on('auth_login', run(async (body) => {
    const { identity, token } = await getAccounts().login(validName(body.name), body.password as string, clientIp(socket));
    socket.data.account = identity;
    return { name: identity.name, session: token };
  }));

  socket.on('auth_resume', run(async (body) => {
    const identity = await getAccounts().resume(body.session);
    socket.data.account = identity ?? undefined;
    return { name: identity?.name ?? null };
  }));

  socket.on('auth_logout', run(async (body) => {
    await getAccounts().logout(body.session);
    socket.data.account = undefined;
  }));
}
