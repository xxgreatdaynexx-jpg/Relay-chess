import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { RealEstate, realEstateRouter, setRealEstateForTest } from '../server/realEstate';
import { fetchRealEstateList } from '../client/src/lib/realEstateApi';
import { CHANGELOG } from '../shared/changelog';

const src = (f: string) => readFileSync(f, 'utf8');

const OWNED_ROW = { id: 'f:1', owner_key: 'chessguy2', owner_name: 'chessguy2', price: 1000, bought_at: 1, arrears: 0, tax_paid: 0 };

function fakePool(opts?: { delay?: number; failStats?: boolean; track?: { current: number; max: number; calls: number } }) {
  const track = opts?.track ?? { current: 0, max: 0, calls: 0 };
  const pool = {
    query: async (sql: string) => {
      track.calls++;
      track.current++;
      track.max = Math.max(track.max, track.current);
      await new Promise((r) => setTimeout(r, opts?.delay ?? 30));
      try {
        if (/FROM property_tax/.test(sql) && opts?.failStats) throw new Error('tax timed out');
        if (/FROM properties ORDER BY id/.test(sql)) return { rows: [OWNED_ROW] };
        if (/COUNT\(\*\)/.test(sql) && /FROM properties/.test(sql)) return { rows: [{ n: 1, v: 1000 }] };
        if (/FROM property_tax/.test(sql)) return { rows: [{ burned: 10, today: 2, repo: 0 }] };
        if (/monument_royalty|wallet_transactions/.test(sql)) return { rows: [] };
        return { rows: [] };
      } finally { track.current--; }
    },
  };
  return { pool, track, re: new RealEstate(pool as never, () => ({}) as never, () => 0) };
}

describe('real-estate public list', () => {
  afterEach(() => setRealEstateForTest(null));

  it('stats and listing never hold more than one pool query at a time, and concurrent listings share one read', async () => {
    const { re, track } = fakePool({ delay: 40 });
    const out = await Promise.all([re.listing(), re.listing(), re.listing()]);
    expect(out[0].owned).toEqual(out[1].owned);
    expect(out[0].owned.map((o) => o.id)).toEqual(['f:1']);
    expect(track.max).toBe(1);
    // one shared trip: owned + two stats queries + royalties
    expect(track.calls).toBe(4);
  });

  it('listing still returns ownership when stats fails', async () => {
    const { re } = fakePool({ failStats: true });
    const d = await re.listing();
    expect(d.owned).toEqual([expect.objectContaining({ id: 'f:1', owner: 'chessguy2' })]);
    expect(d.stats).toEqual({ owned: 1, taxBurned: 0, taxToday: 0, repossessed: 0 });
  });

  it('GET /api/real-estate is not cacheable and still returns owned when stats fails', async () => {
    const { re } = fakePool({ failStats: true });
    setRealEstateForTest(re);
    const app = express();
    app.use(realEstateRouter());
    const server = await new Promise<import('node:http').Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/real-estate`;
      const r = await fetch(url);
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('no-store');
      const body = await r.json() as { ok: boolean; live: boolean; owned: Array<{ id: string }> };
      expect(body).toMatchObject({ ok: true, live: true });
      expect(body.owned.map((o) => o.id)).toEqual(['f:1']);
    } finally { await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve())); }
  });

  it('GET /api/real-estate is no-store when the subsystem is offline', async () => {
    setRealEstateForTest(null);
    const app = express();
    app.use(realEstateRouter());
    const server = await new Promise<import('node:http').Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/real-estate`;
      const r = await fetch(url);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(await r.json()).toEqual({ ok: true, live: false, owned: [] });
    } finally { await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve())); }
  });
});

describe('fetchRealEstateList', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('returns null for a 500 or offline body so callers keep the last good list', async () => {
    const calls: RequestInit[] = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    expect(await fetchRealEstateList()).toBeNull();
    expect(calls[0]?.cache).toBe('no-store');

    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, live: false, owned: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
    expect(await fetchRealEstateList()).toBeNull();
  });

  it('returns a live ownership list', async () => {
    const owned = [{ id: 'f:1', owner: 'chessguy2', price: 1, arrears: 0, boughtAt: 1 }];
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, live: true, owned, index: 1.2 }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
    const d = await fetchRealEstateList();
    expect(d?.owned).toEqual(owned);
    expect(d?.index).toBe(1.2);
  });
});

describe('client call sites keep the last good ownership list', () => {
  it('every map loads through fetchRealEstateList and no longer writes owned ?? [] from a raw fetch', () => {
    const files = [
      'client/src/components/WorldMap.tsx',
      'client/src/components/ResortMap.tsx',
      'client/src/components/IslandFlatMap.tsx',
      'client/src/components/ChudbaiMap.tsx',
      'client/src/components/FactoryBuilder.tsx',
      'client/src/lib/world3d.ts',
    ];
    for (const f of files) {
      const t = src(f);
      expect(t, f).toContain("from '@/lib/realEstateApi'");
      expect(t, f).toContain('fetchRealEstateList');
      expect(t, f).not.toMatch(/fetch\('\/api\/real-estate'\)/);
      expect(t, f).not.toMatch(/owned \?\? \[\]/);
    }
    const helper = src('client/src/lib/realEstateApi.ts');
    expect(helper).toContain("cache: 'no-store'");
    expect(helper).toContain('d.live === false');
    expect(src('server/realEstate.ts')).toContain("res.set('Cache-Control', 'no-store')");
    const stats = src('server/realEstate.ts').split('async stats()')[1]?.split('async playerValue')[0] ?? '';
    expect(stats).toContain('await this.pool.query');
    expect(stats).not.toContain('Promise.all(');
  });

  it('has a player-facing changelog entry', () => {
    const e = CHANGELOG.find((x) => /for sale after a listing glitch/i.test(x.title));
    expect(e).toBeTruthy();
    expect(e!.bullets.length).toBeGreaterThan(0);
  });
});
