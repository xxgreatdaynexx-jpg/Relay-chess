// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';

const h = vi.hoisted(() => ({ account: null as string | null, review: null as unknown, calls: [] as Array<[string, unknown]>, handlers: new Map<string, () => void>() }));
vi.mock('../client/src/lib/net', () => ({
  request: vi.fn(async (ev: string, data?: unknown) => {
    h.calls.push([ev, data]);
    if (ev === 'city_bill_review') return { ok: true, account: h.account, review: h.account?.toLowerCase() === 'carter2' ? h.review : null };
    if (ev === 'city_bill_review_seen') { h.review = { ...(h.review as object), autoOpen: false }; return { ok: true, review: h.review }; }
    if (ev === 'city_bill_review_save') { const d = data as { answers: Record<string, string>; submit: boolean }; h.review = { ...(h.review as object), answers: d.answers, submittedAt: d.submit ? 1 : null }; return { ok: true, review: h.review }; }
    return { ok: false };
  }),
  socket: { on: (e: string, f: () => void) => h.handlers.set(e, f), off: (e: string) => h.handlers.delete(e) },
}));
import { MayorBillReviewHost, OPEN_BILL_REVIEW } from '../client/src/components/MayorBillReview';
import { saveAuth, clearAuth } from '../client/src/lib/auth';
import { BILL_REVIEW_MESSAGE, BILL_REVIEW_QUESTIONS } from '../shared/mayorQuestionnaire';

const fresh = () => ({ id: 'x', message: BILL_REVIEW_MESSAGE, questions: BILL_REVIEW_QUESTIONS, answers: {}, submittedAt: null, autoOpen: true });
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); h.account = null; h.review = fresh(); h.calls = []; h.handlers.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('pt2050u bill review popup (DOM)', () => {
  it('waits for server-side auth (delayed), then auto-opens once with the exact message', async () => {
    saveAuth({ name: 'carter2', token: 't' });
    render(createElement(MayorBillReviewHost)); await flush();
    expect(screen.queryByTestId('bill-review')).toBeNull(); // socket not authenticated yet -> retry
    h.account = 'carter2'; await flush(1500);
    expect(screen.getByTestId('bill-review')).toBeTruthy();
    expect(screen.getByTestId('bill-review-message').textContent).toBe(BILL_REVIEW_MESSAGE);
    expect(h.calls.filter((c) => c[0] === 'city_bill_review_seen')).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByTestId('bill-review-close'));
    for (const r of screen.getAllByRole('radio')) expect((r as HTMLInputElement).checked).toBe(false); // nothing preselected
    fireEvent.click(screen.getByTestId('bill-review-close')); expect(screen.queryByTestId('bill-review')).toBeNull();
    h.handlers.get('connect')!(); await flush(); expect(screen.queryByTestId('bill-review')).toBeNull(); // reconnect: already seen, no re-popup
    act(() => { window.dispatchEvent(new Event(OPEN_BILL_REVIEW)); }); await flush(); expect(screen.getByTestId('bill-review')).toBeTruthy(); // City Hall reopen
  });
  it('non-mayor never sees it; logout / account switch clears an open popup and ignores late answers', async () => {
    saveAuth({ name: 'Bob', token: 't' }); h.account = 'Bob';
    render(createElement(MayorBillReviewHost)); await flush(); expect(screen.queryByTestId('bill-review')).toBeNull();
    act(() => { window.dispatchEvent(new Event(OPEN_BILL_REVIEW)); }); await flush(); expect(screen.queryByTestId('bill-review')).toBeNull();
    h.account = 'carter2'; act(() => { saveAuth({ name: 'carter2', token: 't2' }); }); await flush(); expect(screen.getByTestId('bill-review')).toBeTruthy();
    act(() => { clearAuth(); }); await flush(); expect(screen.queryByTestId('bill-review')).toBeNull();
    h.account = 'carter2'; act(() => { saveAuth({ name: 'Bob', token: 't3' }); }); await flush(2000); // server still on the old account: answer dropped
    expect(screen.queryByTestId('bill-review')).toBeNull();
  });
  it('save draft + submit persist and reload; Esc and backdrop close; submitted is read-only', async () => {
    saveAuth({ name: 'carter2', token: 't' }); h.account = 'carter2';
    const v = render(createElement(MayorBillReviewHost)); await flush();
    fireEvent.click(screen.getAllByRole('radio')[0]!); fireEvent.click(screen.getByTestId('bill-review-draft')); await flush();
    expect((screen.getByTestId('bill-review-submit') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' }); expect(screen.queryByTestId('bill-review')).toBeNull();
    v.unmount(); render(createElement(MayorBillReviewHost)); await flush(); act(() => { window.dispatchEvent(new Event(OPEN_BILL_REVIEW)); }); await flush();
    expect((screen.getAllByRole('radio')[0] as HTMLInputElement).checked).toBe(true); // draft reloaded from server
    for (const q of BILL_REVIEW_QUESTIONS) fireEvent.click(screen.getAllByRole('radio').find((r) => (r as HTMLInputElement).name === `bq-${q.id}` && (r as HTMLInputElement).value === 'needs_discussion')!);
    fireEvent.click(screen.getByTestId('bill-review-submit')); await flush();
    expect(screen.queryByTestId('bill-review-submit')).toBeNull(); expect(screen.getByRole('status').textContent).toMatch(/submitted/);
    for (const r of screen.getAllByRole('radio')) expect((r as HTMLInputElement).closest('fieldset')!.disabled).toBe(true);
    fireEvent.click(document.querySelector('.bill-review-backdrop')!); expect(screen.queryByTestId('bill-review')).toBeNull();
  });
  it('layout: fixed (not draggable), header/close outside the scrolling body, pinned footer, 44px targets, safe areas', () => {
    const css = readFileSync('client/src/index.css', 'utf8'); const tsx = readFileSync('client/src/components/MayorBillReview.tsx', 'utf8');
    expect(tsx).not.toMatch(/usePanelDrag|data-drag-panel|onPointerDown/);
    expect(css).toMatch(/\.bill-review \{[^}]*max-height: 100%;[^}]*flex-direction: column;[^}]*overflow: hidden/);
    expect(css).toMatch(/\.bill-review-head \{ flex: none/); expect(css).toMatch(/\.bill-review-foot \{ flex: none/);
    expect(css).toMatch(/\.bill-review-body \{ flex: 1 1 auto; min-height: 0; overflow-y: auto/);
    expect(css).toMatch(/\.bill-review-x \{ min-width: 44px; min-height: 44px/); expect(css).toMatch(/\.bill-review-qs label \{[^}]*min-height: 44px/); expect(css).toMatch(/\.bill-review-actions button \{ min-height: 44px/);
    expect(css).toMatch(/\.bill-review-backdrop \{ position: fixed; inset: 0;[^}]*env\(safe-area-inset-top\)/);
  });
});
