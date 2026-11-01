import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { restoreOpen } from '../client/src/lib/restoreOpen';

const src = (f: string) => readFileSync(new URL(`../client/src/${f}`, import.meta.url), 'utf8');
const mem = (init: Record<string, string>) => { const m = new Map(Object.entries(init)); return { getItem: (k: string) => m.get(k) ?? null, removeItem: (k: string) => { m.delete(k); }, m }; };

describe('QA r10: Mines/Arena never reopen after a reload', () => {
  it('a stale mines/arena open flag is ignored and cleared', () => {
    const s = mem({ 'relay-mines-open': '1', 'relay-fps-open': '1', 'relay-slots-open': '1' });
    expect(restoreOpen('relay-mines-open', s)).toBe(false);
    expect(restoreOpen('relay-fps-open', s)).toBe(false);
    expect(s.m.has('relay-mines-open')).toBe(false);
    expect(restoreOpen('relay-slots-open', s)).toBe(true); // card tables still restore
  });
  it('no storage / throwing storage is closed', () => {
    expect(restoreOpen('relay-slots-open', null)).toBe(false);
    expect(restoreOpen('x', { getItem: () => { throw new Error('denied'); }, removeItem: () => {} })).toBe(false);
  });
  it('Mines and Arena panels use restoreOpen and no longer persist the flag', () => {
    for (const f of ['components/MinesPanel.tsx', 'components/ArenaPanel.tsx']) {
      expect(src(f)).toContain('restoreOpen(OPEN_KEY)');
      expect(src(f)).not.toMatch(/localStorage\.setItem\(OPEN_KEY/);
    }
  });
});

describe('QA r10: overlays swallow the outside click', () => {
  it('Wallet uses the shared backdrop instead of a document mousedown listener', () => {
    const w = src('components/WalletButton.tsx');
    expect(w).toContain('wallet-backdrop'); expect(w).toContain('backdropDismiss(() => setOpen(false))');
    expect(w).not.toContain("addEventListener('mousedown'");
    expect(src('index.css')).toMatch(/\.wallet-backdrop \{[^}]*position: fixed; inset: 0; z-index: 59/);
  });
  it('Daily report and resort casino use the shared backdrop', () => {
    expect(src('components/DailyReport.tsx')).toContain('backdropDismiss(onClose)');
    expect(src('components/ResortMap.tsx')).toContain('backdropDismiss(() => setCasino(false))');
  });
});

describe('QA r10: money buttons show a spinner while pending', () => {
  it('every stocks/funds/shorts/options money button is disabled and spins while busy', () => {
    const s = src('components/StocksPage.tsx');
    for (const id of ['stk-buy', 'stk-sell', 'stk-fund-buy', 'stk-fund-sell', 'stk-short-open', 'stk-short-close', 'stk-opt-buy'])
      expect(s).toMatch(new RegExp(`data-testid="${id}" aria-busy=\\{busy === [^\\n]*?&& <Spin />`));
    expect(s).not.toContain('setBusy(true)');
  });
});
