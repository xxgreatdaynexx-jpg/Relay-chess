// Render's live health check path is /api/health: it must carry the inventory fence/readiness (reviewer 4c448c8).
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
const inv = vi.hoisted(() => ({ v: { ok: true, fence: 'none', ready: true } as { ok: boolean; fence: string; ready: boolean } }));
vi.mock('../server/invFence.js', async (orig) => ({ ...(await orig<Record<string, unknown>>()), invHealth: () => inv.v }));
import { closeApp, createApp, type AppContext } from '../server/app.js';
let ctx: AppContext; let port = 0;
beforeAll(async () => { ctx = await createApp(); await new Promise<void>((r) => ctx.httpServer.listen(0, '127.0.0.1', () => r())); port = (ctx.httpServer.address() as AddressInfo).port; });
afterAll(async () => { await closeApp(ctx); });
const get = async (p: string) => { const r = await fetch(`http://127.0.0.1:${port}${p}`); return { status: r.status, body: await r.json() as Record<string, unknown> }; };
it('no DB fallback: /api/health 200 with chipDb, subsystems, build and inventory', async () => {
  inv.v = { ok: true, fence: 'none', ready: true };
  const r = await get('/api/health'); expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ ok: true, inventory: { ok: true, fence: 'none' } }); expect(r.body.chipDb).toBeDefined(); expect(r.body.subsystems).toBeDefined(); expect(r.body.build).toBeDefined();
});
it('fence held and ready: 200', async () => {
  inv.v = { ok: true, fence: 'held', ready: true };
  for (const p of ['/api/health', '/health']) { const r = await get(p); expect(r.status).toBe(200); expect(r.body).toMatchObject({ ok: true, inventory: { fence: 'held', ready: true } }); }
});
it('held but not ready (boot migration running): 503', async () => {
  inv.v = { ok: false, fence: 'held', ready: false };
  for (const p of ['/api/health', '/health']) { const r = await get(p); expect(r.status).toBe(503); expect(r.body).toMatchObject({ ok: false }); }
});
it('lost fence: 503 with the reason, subsystems still reported', async () => {
  inv.v = { ok: false, fence: 'lost', ready: true };
  const r = await get('/api/health'); expect(r.status).toBe(503);
  expect(r.body).toMatchObject({ ok: false, inventory: { fence: 'lost' } }); expect(String(r.body.error)).toMatch(/fence lost/); expect(r.body.subsystems).toBeDefined();
  expect((await get('/health')).status).toBe(503);
});
