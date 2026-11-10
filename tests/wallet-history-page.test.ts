import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { getBank, resetBank } from '../server/casino-store';
import { readFileSync } from 'node:fs';

describe('wallet history pagination', () => {
  beforeEach(() => resetBank());
  afterEach(() => resetBank());

  it('recent() pages older rows by id cursor, newest first', async () => {
    const bank = getBank();
    bank.account('Ann');
    for (let i = 0; i < 40; i++) bank.transfer('Ann', 1, { game: 'test', memo: `n${i}`, key: `t${i}` });
    const first = await bank.recent('Ann', 25);
    expect(first).toHaveLength(25);
    expect(first[0]!.id).toBeGreaterThan(first[24]!.id!);
    const next = await bank.recent('Ann', 25, first[24]!.id);
    expect(next.length).toBeGreaterThan(0);
    expect(next[0]!.id).toBeLessThan(first[24]!.id!);
    const ids = new Set([...first, ...next].map((t) => t.id));
    expect(ids.size).toBe(first.length + next.length);
  });

  it('wallet log UI has a scroll area, Load more, and an expanded view', () => {
    const src = readFileSync('client/src/components/WalletButton.tsx', 'utf8');
    expect(src).toMatch(/wallet_history/);
    expect(src).toMatch(/data-testid="wallet-load-more"/);
    expect(src).toMatch(/data-testid="wallet-expand"/);
    expect(src).toMatch(/wallet-panel--expanded/);
    expect(src).toMatch(/wallet-history-scroll/);
    const css = readFileSync('client/src/index.css', 'utf8');
    expect(css).toMatch(/\.wallet-history-scroll[^}]*overflow-y: auto/);
    expect(css).toMatch(/\.wallet-panel--expanded/);
    const sock = readFileSync('server/wallet-sockets.ts', 'utf8');
    expect(sock).toMatch(/socket\.on\('wallet_history'/);
    expect(sock).toMatch(/nextCursor/);
  });
});
