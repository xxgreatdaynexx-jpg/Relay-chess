import express, { type Express } from 'express';
import { cleanClientError } from '../shared/clientError.js';

/** POST /api/client-error (t2051): classified crash reports only (see shared/clientError.ts). 1 kB body, 10/min per IP,
 *  bounded IP map with expiry (never wholesale-cleared, so a flood cannot reset limits). No auth/session/cookies read. */
export function mountClientErrors(app: Express, log: (line: string) => void = (l) => console.error(l), now: () => number = Date.now, maxIps = 5000) {
  const hits = new Map<string, { n: number; at: number }>();
  app.post('/api/client-error', express.json({ limit: '1kb', type: ['application/json', 'text/plain'], strict: true }), (req, res) => {
    const t = now(); const ip = String(req.ip ?? '');
    let h = hits.get(ip);
    if (!h || t - h.at >= 60_000) {
      if (!h && hits.size >= maxIps) { for (const [k, v] of hits) if (t - v.at >= 60_000) hits.delete(k); if (hits.size >= maxIps) return res.status(429).end(); }
      h = { n: 0, at: t }; hits.set(ip, h);
    }
    if (++h.n > 10) return res.status(429).end();
    const r = cleanClientError(req.body);
    if (!r) return res.status(400).end();
    log(`[client-error] where=${r.where} kind=${r.kind} frame=${r.frame || '-'} browser=${r.browser}`);
    res.status(204).end();
  });
  app.use('/api/client-error', ((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => { if (err) return res.status(400).end(); next(); }) as express.ErrorRequestHandler);
}
