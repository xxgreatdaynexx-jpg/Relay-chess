// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
vi.mock('../client/src/components/Skills', () => ({ SkillGrid: ({ profile }: { profile: { title: string } }) => { if (profile.title === 'BOOM') throw new Error('token=abc123 a@b.com /api/player/Secret?session=zzz'); return null; } }));
const BOOM = { skills: { name: 'x', total: 1, title: 'BOOM', totalXp: 1, skills: [] } };
import { readFileSync } from 'node:fs';
import PlayerProfile, { openPlayer } from '../client/src/components/PlayerProfile';
import { AccountButton, AccountPanel } from '../client/src/components/AccountPanel';
import { ErrorBoundary, resetClientErrorReportsForTest } from '../client/src/components/ErrorBoundary';
import { normalizeProfile } from '../client/src/components/PlayerProfile';
import { saveAuth } from '../client/src/lib/auth';

const good = JSON.parse(readFileSync('tests/fixtures/public-profile.json', 'utf8')).profile; // synthetic example in the /api/player shape
const beacons: string[] = [];
let profile: unknown = good;
const mobile = (on: boolean) => { window.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never; };
beforeEach(() => {
  localStorage.clear(); beacons.length = 0; resetClientErrorReportsForTest(); profile = good; mobile(true);
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: (_u: string, b: Blob) => { void b.text().then((t) => beacons.push(t)); return true; } });
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, profile }), { status: 200 })) as never;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const app = () => render(createElement(ErrorBoundary, { where: 'app', kind: 'app' }, createElement('div', null,
  createElement('div', { 'data-testid': 'hub' }, 'hub'), createElement(AccountButton),
  createElement(ErrorBoundary, { where: 'account-panel', kind: 'panel' }, createElement(AccountPanel)),
  createElement(ErrorBoundary, { where: 'player-profile', kind: 'panel' }, createElement(PlayerProfile)))));
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });

describe('t2051 mobile profile / sign-in never blanks the whole app', () => {
  it('real production-shaped profile opens on mobile (signed in)', async () => {
    saveAuth({ name: 'carter2', token: 'tok' }); app();
    act(() => openPlayer('carter2')); await flush();
    expect(screen.getByTestId('player-profile-name').textContent).toBe('Example Player');
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({ headers: { 'x-relay-session': 'tok' } });
  });
  it('malformed profile data: only the profile window is replaced; hub, account button and sign-in keep working; storage untouched', async () => {
    saveAuth({ name: 'carter2', token: 'tok' }); const before = JSON.stringify({ ...localStorage });
    profile = { ...good, properties: undefined, skins: null, categories: 'x', stocks: [{ ticker: 'A' }], history: { points: 'bad' } }; app();
    act(() => openPlayer('carter2')); await flush();
    expect(screen.getByTestId('player-profile-name').textContent).toBe('Example Player'); // partial payload renders, no crash
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    profile = { ...good, ...BOOM };
    act(() => openPlayer('carter2')); await flush();
    expect(screen.getByTestId('crash-player-profile')).toBeTruthy(); expect(screen.queryByTestId('crash-app')).toBeNull();
    expect(screen.getByTestId('hub')).toBeTruthy(); expect(screen.getByTestId('account-button')).toBeTruthy();
    await flush(); expect(beacons.join()).toMatch(/"where":"player-profile"/); expect(beacons.join()).not.toMatch(/tok|abc123|a@b|Secret|session|zzz|player\/|Example/);
    expect(Object.keys(JSON.parse(beacons[0]!)).sort()).toEqual(['browser', 'frame', 'kind', 'where']);
    fireEvent.click(screen.getByTestId('crash-close')); expect(screen.queryByTestId('crash-player-profile')).toBeNull();
    profile = good; act(() => openPlayer('carter2')); await flush(); expect(screen.getByTestId('player-profile-name')).toBeTruthy(); // reopens fresh
    expect(JSON.stringify({ ...localStorage })).toBe(before);
  });
  it('signed out on mobile: Account opens the sign-in form even after a profile crash', async () => {
    profile = { ...good, ...BOOM }; app();
    act(() => openPlayer('someone')); await flush(); expect(screen.getByTestId('crash-player-profile')).toBeTruthy();
    fireEvent.click(screen.getByTestId('crash-close'));
    fireEvent.click(screen.getByTestId('account-button')); await flush();
    expect(screen.getByTestId('account-panel')).toBeTruthy(); expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });
  it('a crash outside any panel shows a Reload screen instead of the bare green page, without signing out', async () => {
    saveAuth({ name: 'carter2', token: 'tok' }); const Boom = () => { throw new Error('boom'); };
    render(createElement(ErrorBoundary, { where: 'app', kind: 'app' }, createElement(Boom)));
    expect(screen.getByTestId('crash-app').textContent).toMatch(/Reload to try again\. Your saved sign-in details have not been cleared/); expect(screen.getByTestId('crash-app').textContent).not.toMatch(/still signed in/); expect(localStorage.getItem('relay-auth-v1')).toMatch(/tok/);
  });
  it('mechanism (before): with no boundary, one bad profile render unmounts the WHOLE tree -> bare page background', async () => {
    profile = { ...good, ...BOOM }; const v = render(createElement('div', null, createElement('div', { 'data-testid': 'hub' }, 'hub'), createElement(PlayerProfile)));
    let threw = false; try { act(() => openPlayer('x')); await flush(); } catch { threw = true; }
    expect(threw || !v.container.querySelector('[data-testid="hub"]')).toBe(true); expect(v.container.querySelector('[data-testid="hub"]')).toBeNull();
  });
  it('normalizeProfile: null/garbage -> null; missing arrays/objects default safely', () => {
    expect(normalizeProfile(null, 'x')).toBeNull(); expect(normalizeProfile([], 'x')).toBeNull();
    const p = normalizeProfile({ netWorth: 'NaN' }, 'Fallback')!; expect(p.name).toBe('Fallback'); expect(p.properties).toEqual([]); expect(p.skins.highlights).toEqual([]); expect(p.history).toBeUndefined(); expect(p.netWorth).toBe(0); expect(p.chips).toBeNull();
  });
  it('wired in main/App', () => {
    expect(readFileSync('client/src/main.tsx', 'utf8')).toMatch(/<ErrorBoundary where="app" kind="app"><App \/><\/ErrorBoundary>/);
    const a = readFileSync('client/src/App.tsx', 'utf8'); expect(a).toMatch(/kind="panel"><AccountPanel \/>/); expect(a).toMatch(/kind="panel"><PlayerProfile \/>/);
  });
});
