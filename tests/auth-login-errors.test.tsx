// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';

const h = vi.hoisted(() => ({ connected: false, handlers: new Map<string, () => void>(), emit: vi.fn() }));
vi.mock('socket.io-client', () => ({ io: () => ({
  get connected() { return h.connected; }, connect: vi.fn(), on: vi.fn(), off: (e: string) => h.handlers.delete(e), once: (e: string, f: () => void) => h.handlers.set(e, f),
  timeout: () => ({ emit: h.emit }), emit: vi.fn(),
}) }));
import { AccountBox } from '../client/src/components/AccountBox';
import { authCall, resumeStoredSession } from '../client/src/lib/net';
import { saveAuth, loadAuth } from '../client/src/lib/auth';
afterEach(() => { cleanup(); vi.useRealTimers(); h.connected = false; h.emit.mockReset(); localStorage.clear(); });
const fill = () => { fireEvent.change(screen.getByTestId('auth-name'), { target: { value: 'Someone' } }); fireEvent.change(screen.getByTestId('auth-password'), { target: { value: 'pw12' } }); };

describe('t2051 sign-in failures stay visible and recoverable', () => {
  it('server unreachable on mobile: no endless spinner; clear error; button usable again; nothing stored', async () => {
    vi.useFakeTimers(); render(createElement(AccountBox)); fill();
    fireEvent.click(screen.getByTestId('auth-submit'));
    expect((screen.getByTestId('auth-submit') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_500); });
    expect(screen.getByText(/Can’t reach the server/)).toBeTruthy();
    expect((screen.getByTestId('auth-submit') as HTMLButtonElement).disabled).toBe(false);
    expect(localStorage.getItem('relay-auth-v1')).toBeNull();
  });
  it('a connection timeout and transient resume failure preserve the existing session; explicit invalidation alone clears it', async () => {
    vi.useFakeTimers(); saveAuth({ name: 'Example Account', token: 'synthetic-session' });
    const pending = authCall('auth_status', { name: 'Example Account' });
    await act(async () => { await vi.advanceTimersByTimeAsync(10001); });
    expect((await pending).ok).toBe(false); expect(loadAuth()?.token).toBe('synthetic-session');
    h.connected = true; h.emit.mockImplementation((_ev: string, _data: unknown, cb: (e: Error | null, r?: object) => void) => cb(new Error('synthetic timeout')));
    resumeStoredSession(); expect(loadAuth()?.token).toBe('synthetic-session');
    h.emit.mockImplementation((_ev: string, _data: unknown, cb: (e: null, r: object) => void) => cb(null, { ok: true, invalid: true, name: null }));
    resumeStoredSession(); expect(loadAuth()).toBeNull(); vi.clearAllTimers();
  });
  it('wrong password from the server is shown and the form can retry', async () => {
    h.connected = true; h.emit.mockImplementation((ev: string, _d: unknown, cb: (e: null, r: object) => void) => cb(null, ev === 'auth_status' ? { ok: true, claimed: true } : { ok: false, error: 'Wrong password.' }));
    render(createElement(AccountBox)); fill(); await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    await act(async () => { fireEvent.click(screen.getByTestId('auth-submit')); });
    expect(screen.getByText('Wrong password.')).toBeTruthy(); expect((screen.getByTestId('auth-submit') as HTMLButtonElement).disabled).toBe(false);
    expect(localStorage.getItem('relay-auth-v1')).toBeNull();
  });
});
