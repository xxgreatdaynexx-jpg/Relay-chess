import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { creditFor, formatPlayTime, PLAY_GAP_CAP_MS } from '../shared/playtime';
import { PlayTimeStore } from '../server/playtime';

const shim = (db: PGlite) => ({ query: async (sql: string, args?: unknown[]) => { const r = args?.length ? await db.query(sql, args as unknown[]) : (await db.exec(sql)).at(-1) ?? { rows: [] }; return { rows: r.rows as Record<string, unknown>[] }; } });

describe('play time formatter', () => {
  it('formats like 123h 45m', () => {
    expect(formatPlayTime(0)).toBe('0h 0m');
    expect(formatPlayTime(59_999)).toBe('0h 0m');
    expect(formatPlayTime((123 * 60 + 45) * 60_000 + 30_000)).toBe('123h 45m');
    expect(formatPlayTime(undefined)).toBe('0h 0m');
    expect(formatPlayTime(-5)).toBe('0h 0m');
  });
});

describe('idle cap', () => {
  it('caps each gap and ignores inactive/first beats', () => {
    expect(creditFor(undefined, 1000, true)).toBe(0);
    expect(creditFor(0, 60_000, true)).toBe(60_000);
    expect(creditFor(0, 3_600_000, true)).toBe(PLAY_GAP_CAP_MS);
    expect(creditFor(0, 60_000, false)).toBe(0);
    expect(creditFor(100, 50, true)).toBe(0);
  });
  it('AFK tab earns nothing; multiple tabs never double count; persists in pglite', async () => {
    const s = new PlayTimeStore(); await s.attach(shim(new PGlite()));
    await s.beat('Bob', 0, true);
    await s.beat('Bob', 60_000, true);
    await s.beat('bob', 70_000, true); // second tab: only 10s more
    expect(await s.total('BOB')).toBe(70_000);
    await s.beat('Bob', 130_000, false); // idle beat resets anchor
    await s.beat('Bob', 190_000, true);  // first active after idle: no credit
    await s.beat('Bob', 10_000_000, true); // huge gap capped
    expect(await s.total('bob')).toBe(70_000 + PLAY_GAP_CAP_MS);
    expect(await s.total('nobody')).toBe(0);
  });
});
