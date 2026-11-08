import { describe, expect, it, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { mountClientErrors } from '../server/client-error';
import { browserOf, cleanClientError, errorFrame } from '../shared/clientError';

const logs: string[] = []; let t = 1_000_000;
const app = express(); app.set('trust proxy', true); mountClientErrors(app, (l) => logs.push(l), () => t, 3);
const srv = app.listen(0); const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`; afterAll(() => srv.close());
const post = (body: string, ip = '1.1.1.1', type = 'application/json') => fetch(`${base}/api/client-error`, { method: 'POST', headers: { 'content-type': type, 'x-forwarded-for': ip }, body }).then((r) => r.status);
const ok = { where: 'player-profile', kind: 'TypeError', frame: 'index-Ab12_c.js:1:234', browser: 'Chrome/120' };

describe('t2051 /api/client-error (real HTTP)', () => {
  it('logs only the classified fields', async () => {
    expect(await post(JSON.stringify(ok))).toBe(204);
    expect(logs.pop()).toBe('[client-error] where=player-profile kind=TypeError frame=index-Ab12_c.js:1:234 browser=Chrome/120');
  });
  it('rejects secrets, extra fields, control/ANSI chars, non-objects, malformed and oversize bodies without logging', async () => {
    const n = logs.length;
    for (const b of [
      { ...ok, message: 'token=abc a@b.com' }, { ...ok, kind: 'TypeError\u001b[31m' }, { ...ok, kind: 'Type\nError' }, { ...ok, frame: 'https://x/assets/a.js?session=1:1:1' },
      { ...ok, frame: '/api/player/Secret.js:1:1' }, { ...ok, where: 'anything' }, { ...ok, browser: 'Chrome/120 token=x' }, { ...ok, kind: 5 },
    ]) expect(await post(JSON.stringify(b), '2.2.2.2')).toBe(400);
    expect(await post('[1,2]', '3.3.3.3')).toBe(400); expect(await post('"str"', '3.3.3.3')).toBe(400); expect(await post('{bad', '3.3.3.3')).toBe(400);
    expect(await post(JSON.stringify({ ...ok, pad: 'x'.repeat(2000) }), '3.3.3.3')).toBe(400);
    expect(logs.length).toBe(n);
  });
  it('10/min per IP; bounded IP map with expiry (a flood of new IPs is refused, not a limit reset)', async () => {
    t += 120_000; for (let i = 0; i < 10; i++) expect(await post(JSON.stringify(ok), '9.9.9.9')).toBe(204);
    expect(await post(JSON.stringify(ok), '9.9.9.9')).toBe(429);
    expect(await post(JSON.stringify(ok), '8.8.8.8')).toBe(204); expect(await post(JSON.stringify(ok), '7.7.7.7')).toBe(204); // map full (max 3)
    expect(await post(JSON.stringify(ok), '6.6.6.6')).toBe(429); expect(await post(JSON.stringify(ok), '9.9.9.9')).toBe(429); // 9.9.9.9 still limited
    t += 61_000; expect(await post(JSON.stringify(ok), '6.6.6.6')).toBe(204); // expired entries swept
  });
  it('helpers keep only asset file:line:col and browser family/major', () => {
    expect(errorFrame('TypeError: x\n    at f (https://chudhub.club/assets/index-AbC.js:12:345)\n')).toBe('index-AbC.js:12:345');
    expect(errorFrame('at https://chudhub.club/api/player/Bob?token=1:2:3')).toBe('');
    expect(browserOf('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36')).toBe('Chrome/130');
    expect(browserOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari/17');
    expect(browserOf('... SamsungBrowser/25.0 Chrome/121 ...')).toBe('Samsung/25');
    expect(cleanClientError(ok)).toEqual(ok);
  });
});
