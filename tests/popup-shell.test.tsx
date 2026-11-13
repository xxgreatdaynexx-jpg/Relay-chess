// @vitest-environment jsdom
import { createElement as el, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapSheet } from '../client/src/components/MapSheet';
import { ModalShell, PanelLoading, TimedSuspense, PANEL_LOAD_MS } from '../client/src/components/ModalShell';
import { FutureFeaturesPopup } from '../client/src/components/FutureFeaturesPopup';
import { SellAllConfirm } from '../client/src/components/SellAllConfirm';
import { LaunchPopup } from '../client/src/components/LaunchPopup';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const css = () => read('client/src/index.css');
const src = (f: string) => read(`client/src/${f}`);

afterEach(() => {
  document.body.style.overflow = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(node as React.ReactElement); });
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}

describe('ModalShell: close, scroll, lock, loading', () => {
  it('renders a visible ✕ in the non-scrolling header, and Escape closes', async () => {
    const onClose = vi.fn();
    const long = Array.from({ length: 80 }, (_, i) => el('p', { key: i }, `Line ${i} — enough text to overflow a short viewport.`));
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const { host, unmount } = await mount(el(ModalShell, { title: 'Test menu', onClose, testId: 'shell', portal: false }, long));
    const x = host.querySelector('[data-testid="shell-close"]') as HTMLButtonElement;
    expect(x).toBeTruthy();
    expect(x.getAttribute('aria-label')).toBe('Close');
    expect(x.textContent).toContain('✕');
    expect(x.closest('.modal-shell-body')).toBeNull();
    expect(x.closest('.modal-shell-head')).toBeTruthy();
    const body = host.querySelector('.modal-shell-body') as HTMLElement;
    expect(body).toBeTruthy();
    body.scrollTop = 4000;
    expect(x.closest('.modal-shell-body')).toBeNull();
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    await unmount();
    vi.unstubAllGlobals();
  });

  it('releases the body scroll lock on unmount', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    document.body.style.overflow = 'auto';
    const { unmount } = await mount(el(ModalShell, { title: 'Lock', onClose: () => {}, portal: false }, 'hi'));
    expect(document.body.style.overflow).toBe('hidden');
    await unmount();
    expect(document.body.style.overflow).toBe('auto');
    vi.unstubAllGlobals();
  });

  it('shows an error with Retry instead of a blank body', async () => {
    const retry = vi.fn();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const { host, unmount } = await mount(el(ModalShell, { title: 'Load', onClose: () => {}, error: 'Could not load.', onRetry: retry, testId: 'err', portal: false }));
    expect(host.querySelector('[data-testid="modal-error"]')!.textContent).toContain('Could not load.');
    const btn = host.querySelector('[data-testid="modal-retry"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(retry).toHaveBeenCalledTimes(1);
    await unmount();
    vi.unstubAllGlobals();
  });
});

describe('PanelLoading and TimedSuspense', () => {
  it('loading card has a working ✕ and a retry state after the timeout', async () => {
    const onClose = vi.fn();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const { host, unmount } = await mount(el(PanelLoading, { label: 'Opening the hangar…', onClose }));
    const x = host.querySelector('[data-testid="panel-loading-close"]') as HTMLButtonElement;
    expect(x).toBeTruthy();
    expect(host.textContent).toContain('Opening the hangar…');
    await act(async () => { x.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(1);
    await unmount();

    // TimedSuspense error path via PanelLoading.
    const { host: h2, unmount: u2 } = await mount(el(PanelLoading, { label: 'Opening…', error: 'This menu is taking too long to open.', onClose, onRetry: () => {} }));
    expect(h2.querySelector('[data-testid="panel-loading-error"]')!.textContent).toMatch(/too long/);
    expect(h2.querySelector('[data-testid="panel-loading-retry"]')).toBeTruthy();
    expect(h2.querySelector('[data-testid="panel-loading-close"]')).toBeTruthy();
    await u2();
    vi.unstubAllGlobals();
    expect(PANEL_LOAD_MS).toBeGreaterThanOrEqual(8_000);
  });

  it('does not replace a menu that already opened once the timeout elapses', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const { host, unmount } = await mount(el(TimedSuspense, { label: 'Opening the dock…', onClose: () => {}, testId: 'dock-load', children: el('div', { 'data-testid': 'dock-ready' }, 'Fishing ready') }));
    expect(host.querySelector('[data-testid="dock-ready"]')!.textContent).toBe('Fishing ready');
    expect(host.querySelector('[data-testid="dock-load-error"]')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(PANEL_LOAD_MS + 2_000); });
    expect(host.querySelector('[data-testid="dock-ready"]')!.textContent).toBe('Fishing ready');
    expect(host.querySelector('[data-testid="dock-load-error"]')).toBeNull();
    expect(host.textContent).not.toMatch(/too long/);
    await unmount();
    vi.unstubAllGlobals();
  });

  it('times out only while still loading, and Retry remounts the menu', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    // Gate on a flag, not a render count — React may invoke the child twice in development.
    let allow = false;
    function Dock() {
      if (!allow) throw new Promise<void>(() => { /* stays pending so the fallback stays up */ });
      return el('div', { 'data-testid': 'dock-ready' }, 'Fishing ready');
    }
    const onClose = vi.fn();
    const { host, unmount } = await mount(el(TimedSuspense, { label: 'Opening the dock…', onClose, testId: 'dock-load', children: el(Dock) }));
    expect(host.textContent).toContain('Opening the dock…');
    expect(host.querySelector('[data-testid="dock-load-error"]')).toBeNull();
    expect(host.querySelector('[data-testid="dock-ready"]')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(PANEL_LOAD_MS); });
    expect(host.querySelector('[data-testid="dock-load-error"]')!.textContent).toMatch(/too long/);
    const retry = host.querySelector('[data-testid="dock-load-retry"]') as HTMLButtonElement;
    expect(retry).toBeTruthy();
    expect(host.querySelector('[data-testid="dock-load-close"]')).toBeTruthy();
    allow = true;
    await act(async () => { retry.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(host.querySelector('[data-testid="dock-ready"]')!.textContent).toBe('Fishing ready');
    expect(host.querySelector('[data-testid="dock-load-error"]')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(PANEL_LOAD_MS + 2_000); });
    expect(host.querySelector('[data-testid="dock-ready"]')!.textContent).toBe('Fishing ready');
    expect(host.textContent).not.toMatch(/too long/);
    await unmount();
    vi.unstubAllGlobals();
  });
});

describe('Launch and Future Features popups gained a close ✕', () => {
  it('LaunchPopup shows ✕, and the close button dismisses it', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const { unmount } = await mount(el(LaunchPopup));
    await act(async () => { window.dispatchEvent(new Event('open-launch-popup')); });
    const popup = document.querySelector('[data-testid="launch-popup"]');
    expect(popup).toBeTruthy();
    const x = document.querySelector('[data-testid="launch-close"]') as HTMLButtonElement;
    expect(x).toBeTruthy();
    expect(x.getAttribute('aria-label')).toBe('Close');
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(document.querySelector('[data-testid="launch-popup"]')).toBeNull();
    await unmount();
    vi.unstubAllGlobals();
  });

  it('Future Features has ✕ and Escape closes it', async () => {
    const onClose = vi.fn();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const { unmount } = await mount(el(FutureFeaturesPopup, { onClose }));
    const x = document.querySelector('[data-testid="ff-close"]') as HTMLButtonElement;
    expect(x).toBeTruthy();
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalled();
    await unmount();
    vi.unstubAllGlobals();
  });
});

describe('Sell-all confirm has a close ✕', () => {
  it('✕ and Escape call onCancel', async () => {
    const onCancel = vi.fn();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const { unmount } = await mount(el(SellAllConfirm, { text: 'Sell 12 items?', onCancel, onConfirm: () => {} }));
    const x = document.querySelector('[data-testid="sellall-close"]') as HTMLButtonElement;
    expect(x).toBeTruthy();
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onCancel).toHaveBeenCalled();
    await unmount();
    vi.unstubAllGlobals();
  });
});

describe('source and CSS contracts: every popup can close and scroll', () => {
  it('Launch, Future Features, Dialog, Admin, Sell-all, Profile, Daily report, Wallet, and crash card all have a close ✕', () => {
    expect(src('components/LaunchPopup.tsx')).toMatch(/data-testid="launch-close"/);
    expect(src('components/FutureFeaturesPopup.tsx')).toMatch(/data-testid="ff-close"/);
    expect(src('components/ui/dialog.tsx')).toMatch(/data-testid="dialog-close"/);
    expect(src('components/ui/dialog.tsx')).toContain('modal-shell-body');
    expect(src('components/AdminPopup.tsx')).toMatch(/data-testid="admin-popup-close"/);
    expect(src('components/SellAllConfirm.tsx')).toMatch(/data-testid=\{`\$\{testid\}-close`\}/);
    expect(src('components/PlayerProfile.tsx')).toContain('player-profile-close');
    expect(src('components/PlayerProfile.tsx')).toContain('modal-shell-head');
    expect(src('components/DailyReport.tsx')).toContain('daily-report-close');
    expect(src('components/DailyReport.tsx')).toContain('modal-shell-body');
    expect(src('components/WalletButton.tsx')).toContain('wallet-close');
    expect(src('components/ErrorBoundary.tsx')).toContain('modal-shell-x');
    expect(src('components/MapSheet.tsx')).toContain('map-sheet-header');
    expect(src('components/MapSheet.tsx')).not.toContain('if (!mobile)');
  });

  it('loading fallbacks are closeable and time out instead of hanging blank', () => {
    expect(src('components/WorldMap.tsx')).toContain('TimedSuspense');
    expect(src('components/WorldMap.tsx')).not.toContain("fallback={<div className=\"world-loading\">Opening");
    expect(src('components/ResortMap.tsx')).toContain('TimedSuspense');
    expect(src('components/ResortMap.tsx')).not.toContain('fallback={null}');
    expect(src('components/Venues.tsx')).not.toContain('fallback={null}');
    expect(src('components/PlayerProfile.tsx')).toContain('12_000');
    expect(src('components/PlayerProfile.tsx')).toContain('player-profile-retry');
    expect(src('components/ChatDrawer.tsx')).toContain('profileErr');
    expect(src('components/FactoryViewer.tsx')).toContain('AbortSignal.timeout');
  });

  it('shared CSS fits the viewport with a vh fallback, sticky header, and touch scrolling', () => {
    const c = css();
    expect(c).toMatch(/\.modal-shell \{[^}]*max-height: calc\(100vh - 24px\);[^}]*max-height: calc\(100dvh - 24px\)/s);
    expect(c).toMatch(/\.modal-shell-head \{[^}]*flex: 0 0 auto/s);
    expect(c).toMatch(/\.modal-shell-body \{[^}]*overflow-y: auto;[^}]*-webkit-overflow-scrolling: touch/s);
    expect(c).toMatch(/\.modal-shell-x/);
    expect(c).toMatch(/\.map-sheet > \.map-sheet-header/);
    expect(c).toMatch(/\.map-sheet > \.map-sheet-body[^}]*overflow-y: auto;[^}]*-webkit-overflow-scrolling: touch/s);
    expect(c).toMatch(/\.launch-card \{[^}]*max-height: calc\(100vh - 28px\);[^}]*max-height: calc\(100dvh - 28px\)/s);
    expect(c).toMatch(/\.acct-panel \{[^}]*max-height: calc\(100vh - 24px\);[^}]*max-height: calc\(100dvh - 24px\)/s);
    expect(c).toMatch(/\.dealer-box \{[^}]*max-height: 92vh;[^}]*max-height: 92dvh/s);
    expect(c).toMatch(/env\(safe-area-inset-/);
  });
});
