// @vitest-environment jsdom
// Request-flood regression (Dayne via Nora, 2026-11-07 07:18 UTC-6): the obsolete Millionaire prelaunch overlay put the
// server skew in its effect deps, so every /api/millionaire-prelaunch answer (new skew each time) re-ran the effect,
// which asked again at once: one request per round trip, forever, even long after the window ended.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createElement, StrictMode } from 'react';
import { MILLIONAIRE_PRELAUNCH_START_MS, MILLIONAIRE_PRELAUNCH_END_MS, millionairePrelaunchView } from '../shared/millionairePrelaunch';

const h = vi.hoisted(() => ({ handlers: new Map<string, Set<(...a: unknown[]) => void>>(), emits: 0 }));
vi.mock('@/lib/net', () => ({
  socket: {
    connected: true,
    on: (ev: string, fn: (...a: unknown[]) => void) => { if (!h.handlers.has(ev)) h.handlers.set(ev, new Set()); h.handlers.get(ev)!.add(fn); },
    off: (ev: string, fn: (...a: unknown[]) => void) => { h.handlers.get(ev)?.delete(fn); },
    emit: (_ev: string, _d: unknown, ack?: (r: unknown) => void) => { h.emits++; ack?.({ ...millionairePrelaunchView(Date.now()), serverNow: Date.now() + Math.floor(Math.random() * 50) }); },
  },
}));
import { MillionairePrelaunchOverlay } from '../client/src/components/MillionairePrelaunchOverlay';

let fetches = 0;
const fire = (ev: string) => { for (const f of [...(h.handlers.get(ev) ?? [])]) f(); };
const settle = async (ms: number) => { for (let i = 0; i < Math.ceil(ms / 250); i++) await act(async () => { await vi.advanceTimersByTimeAsync(250); }); };
beforeEach(() => {
  fetches = 0; h.emits = 0; h.handlers.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  // a real server answers with its own clock: the skew differs on every answer (network jitter)
  vi.stubGlobal('fetch', vi.fn(async () => { fetches++; return { json: async () => ({ ok: true, ...millionairePrelaunchView(Date.now()), serverNow: Date.now() + Math.floor(Math.random() * 50) + fetches }) }; }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('prelaunch overlay requests', () => {
  it('after the window ended (today): app open makes no prelaunch requests at all, StrictMode + rerenders', async () => {
    vi.setSystemTime(MILLIONAIRE_PRELAUNCH_END_MS + 11 * 3_600_000);
    const r = render(createElement(StrictMode, null, createElement(MillionairePrelaunchOverlay)));
    await settle(10_000); for (let i = 0; i < 5; i++) r.rerender(createElement(StrictMode, null, createElement(MillionairePrelaunchOverlay)));
    fire('connect'); fire('connect'); document.dispatchEvent(new Event('visibilitychange')); await settle(60_000);
    expect(fetches + h.emits).toBe(0);
    expect(r.container.querySelector('[data-testid="millionaire-prelaunch-overlay"]')).toBeNull();
  });
  it('during the window: bounded (initial + reconnects + one per 30s / boundary), no overlapping loop', async () => {
    vi.setSystemTime(MILLIONAIRE_PRELAUNCH_START_MS + 60_000);
    const r = render(createElement(StrictMode, null, createElement(MillionairePrelaunchOverlay)));
    await settle(10_000);
    expect(fetches).toBeLessThanOrEqual(2); // StrictMode mounts twice in dev
    expect(r.container.querySelector('[data-testid="millionaire-prelaunch-overlay"]')).not.toBeNull();
    const f0 = fetches; fire('connect'); await settle(1_000); expect(fetches - f0).toBe(1); // reconnect re-syncs once
    const f1 = fetches; await settle(60_000); expect(fetches - f1).toBeLessThanOrEqual(2); // 30 s cadence
  });
  it('the window end hides the overlay and stops requests; unmount cleans every listener and timer', async () => {
    vi.setSystemTime(MILLIONAIRE_PRELAUNCH_END_MS - 5_000);
    const r = render(createElement(MillionairePrelaunchOverlay));
    await settle(2_000); expect(r.container.querySelector('[data-testid="millionaire-prelaunch-overlay"]')).not.toBeNull();
    await settle(10_000); expect(r.container.querySelector('[data-testid="millionaire-prelaunch-overlay"]')).toBeNull();
    const f = fetches; await settle(120_000); fire('connect'); await settle(1_000); expect(fetches).toBe(f);
    r.unmount(); expect([...h.handlers.values()].reduce((n, s) => n + s.size, 0)).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
});
