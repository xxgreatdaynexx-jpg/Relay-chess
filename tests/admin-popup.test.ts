import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAccounts, resetAccounts } from '../server/accounts.js';
import { closeApp, createApp, type AppContext } from '../server/app.js';
import { getBank, resetBank } from '../server/casino-store.js';
import { resetLeaderboard } from '../server/leaderboard.js';
import { dismissPopup, getPopups, PopupStore, resetPopups } from '../server/popups.js';

const TOKEN = 'qa-admin-token-0123456789abcdef0123456789';

describe('admin popup', () => {
  let ctx: AppContext; let base = '';
  beforeAll(async () => {
    process.env.ADMIN_GRANT_TOKEN = TOKEN;
    resetAccounts(); resetBank(); resetPopups();
    resetLeaderboard(path.join(mkdtempSync(path.join(tmpdir(), 'relay-popup-')), 'lb.json'));
    await getAccounts().claim('QA-Popper', 'secret1', 'ip');
    ctx = await createApp();
    await new Promise<void>((r) => ctx.httpServer.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(ctx.httpServer.address() as AddressInfo).port}/api/admin/popup`;
  });
  afterAll(async () => { delete process.env.ADMIN_GRANT_TOKEN; await closeApp(ctx); });
  const post = (body: unknown, auth: string | null = `Bearer ${TOKEN}`) =>
    fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });

  it('requires the admin token', async () => {
    expect((await post({ name: 'QA-Popper', text: 'hi' }, null)).status).toBe(401);
    expect((await post({ name: 'QA-Popper', text: 'hi' }, 'Bearer nope')).status).toBe(401);
    expect((await fetch(`${base}?id=x`)).status).toBe(401);
  });
  it('validates name, text cap and sender', async () => {
    expect((await post({ name: '', text: 'hi' })).status).toBe(400);
    expect((await post({ name: 'QA-Popper', text: '' })).status).toBe(400);
    expect((await post({ name: 'QA-Popper', text: 'x'.repeat(1001) })).status).toBe(400);
    const long = 'Hi — ' + 'z'.repeat(990);
    const ok = await post({ name: 'QA-Popper', text: long, from: 'Nora, Chief of Staff' });
    expect(ok.status).toBe(200);
    const id = (await ok.json() as { id: string }).id;
    expect((await getPopups().pending('QA-Popper')).find((x) => x.id === id)?.text).toBe(long);
    expect(await getPopups().ack('QA-Popper', id)).toBe(true);
    expect((await post({ name: 'QA-Popper', text: 'hi', from: 'y'.repeat(33) })).status).toBe(400);
    expect((await post({ name: 'Nobody-Here', text: 'hi' })).status).toBe(404);
  });
  it('queues per player, acks only by that player, and moves no chips', async () => {
    const chips = getBank().account('QA-Popper').chips;
    const r = await post({ name: 'qa-popper', text: 'Hello there', from: 'Grok' });
    expect(r.status).toBe(200);
    const j = await r.json() as { id: string; player: string; status: string };
    expect(j.player).toBe('QA-Popper'); expect(j.status).toBe('queued');
    const pend = await getPopups().pending('QA-POPPER');
    expect(pend.map((p) => [p.from, p.text])).toEqual([['Grok', 'Hello there']]);
    expect(await getPopups().ack('someone-else', j.id)).toBe(false);
    const st = await fetch(`${base}?id=${j.id}`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect((await st.json() as { status: string }).status).toBe('queued');
    expect(await getPopups().ack('QA-Popper', j.id)).toBe(true);
    expect(await getPopups().ack('QA-Popper', j.id)).toBe(false);
    expect(await getPopups().pending('QA-Popper')).toEqual([]);
    expect(await getPopups().status(j.id)).toBe('delivered');
    expect(getBank().account('QA-Popper').chips).toBe(chips);
  });
  it('fake DB path round-trips through SQL', async () => {
    const rows: Array<Record<string, unknown>> = [];
    const db = { query: async (sql: string, p: unknown[] = []) => {
      if (sql.startsWith('INSERT')) { rows.push({ id: p[0], player_key: p[1], player: p[2], sender: p[3], body: p[4], created_at: p[5], acked_at: null }); return { rows: [] }; }
      if (sql.startsWith('SELECT id')) return { rows: rows.filter((r) => r.player_key === p[0] && r.acked_at == null) };
      if (sql.startsWith('UPDATE')) { const r = rows.find((x) => x.id === p[1] && x.player_key === p[2] && x.acked_at == null); if (r) r.acked_at = p[0]; return { rows: [], rowCount: r ? 1 : 0 }; }
      if (sql.startsWith('SELECT acked_at')) return { rows: rows.filter((r) => r.id === p[0]) };
      return { rows: [] };
    } };
    const s = new PopupStore(); await s.attach(db);
    const p = await s.add('Jay', 'Grok', 'yo');
    expect((await s.pending('jay')).length).toBe(1);
    expect(await s.ack('jay', p.id)).toBe(true);
    expect(await s.status(p.id)).toBe('delivered');
  });

  it('POST /dismiss force-acks and reports status', async () => {
    const queued = await post({ name: 'QA-Popper', text: 'Please ignore', from: 'Nora' });
    const id = (await queued.json() as { id: string }).id;
    expect(await getPopups().status(id)).toBe('queued');
    const r = await fetch(`${base}/dismiss`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ name: 'QA-Popper', id }),
    });
    expect(r.status).toBe(200);
    const j = await r.json() as { cleared: boolean; status: string; player: string };
    expect(j.cleared).toBe(true);
    expect(j.status).toBe('delivered');
    expect(j.player).toBe('QA-Popper');
    expect(await getPopups().status(id)).toBe('delivered');
    expect((await fetch(`${base}/dismiss`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ name: 'Nobody-Here', id }),
    })).status).toBe(404);
    const again = await fetch(`${base}/dismiss`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ name: 'qa-popper', id }),
    });
    expect(again.status).toBe(200);
    expect((await again.json() as { cleared: boolean }).cleared).toBe(false);
  });
});
