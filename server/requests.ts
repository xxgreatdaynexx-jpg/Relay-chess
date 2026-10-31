/** Player change requests with one upvote per account, admin-only status changes, Postgres persistence. */
import express from 'express';
import pg from 'pg';
import { getAccounts, isGuestName, nameKey } from './accounts.js';
import { adminAuthorized } from './admin.js';
import { databaseUrl, type Queryable } from './leaderboard-store.js';
import { isQaName } from '../shared/qa.js';
import { CHANGELOG } from '../shared/changelog.js';
import { NEXT_STATUS, PER_DAY, REQUEST_STATUSES, validateRequest, type PublicRequest, type RequestCategory, type RequestStatus } from '../shared/requests.js';

export const REQUESTS_MIGRATION = `CREATE TABLE IF NOT EXISTS change_requests (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, details TEXT NOT NULL, category TEXT NOT NULL, author TEXT NOT NULL,
  author_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', note TEXT, changelog TEXT,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS change_request_votes (request_id INTEGER NOT NULL, voter_key TEXT NOT NULL, PRIMARY KEY (request_id, voter_key))`;

interface Row { id: number; title: string; details: string; category: RequestCategory; author: string; authorKey: string; status: RequestStatus; note?: string; changelog?: string; createdAt: number; updatedAt: number; voters: Set<string> }
export type Sort = 'top' | 'new' | 'status';
const DAY = 86_400_000;

export class RequestBoard {
  private rows = new Map<number, Row>();
  private nextId = 1;
  constructor(private db: Queryable | null = null) {}

  async load(): Promise<void> {
    if (!this.db) return;
    for (const stmt of REQUESTS_MIGRATION.split(';')) await this.db.query(stmt);
    const { rows } = await this.db.query('SELECT * FROM change_requests');
    for (const r of rows) this.rows.set(r.id, { id: r.id, title: r.title, details: r.details, category: r.category, author: r.author, authorKey: r.author_key, status: r.status, note: r.note ?? undefined, changelog: r.changelog ?? undefined, createdAt: +new Date(r.created_at), updatedAt: +new Date(r.updated_at), voters: new Set() });
    const v = await this.db.query('SELECT request_id, voter_key FROM change_request_votes');
    for (const x of v.rows) this.rows.get(x.request_id)?.voters.add(x.voter_key);
    this.nextId = Math.max(0, ...this.rows.keys()) + 1;
  }
  private save(r: Row) {
    void this.db?.query(`INSERT INTO change_requests (id,title,details,category,author,author_key,status,note,changelog,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, note=EXCLUDED.note, changelog=EXCLUDED.changelog, updated_at=EXCLUDED.updated_at`,
      [r.id, r.title, r.details, r.category, r.author, r.authorKey, r.status, r.note ?? null, r.changelog ?? null, new Date(r.createdAt), new Date(r.updatedAt)]).catch((e) => console.error('[requests] save failed:', (e as Error).message));
  }

  submit(author: string, body: unknown, now = Date.now()): { ok: true; request: PublicRequest } | { ok: false; error: string } {
    const v = validateRequest((body ?? {}) as Record<string, unknown>);
    if (!v.ok) return v;
    const key = nameKey(author);
    const recent = [...this.rows.values()].filter((r) => r.authorKey === key && now - r.createdAt < DAY).length;
    if (recent >= PER_DAY) return { ok: false, error: `You can post ${PER_DAY} requests a day. Try again tomorrow.` };
    if ([...this.rows.values()].some((r) => r.title.toLowerCase() === v.title.toLowerCase() && r.status !== 'declined')) return { ok: false, error: 'That request already exists — upvote it instead.' };
    const r: Row = { id: this.nextId++, title: v.title, details: v.details, category: v.category, author, authorKey: key, status: 'open', createdAt: now, updatedAt: now, voters: new Set([key]) };
    this.rows.set(r.id, r); this.save(r);
    void this.db?.query('INSERT INTO change_request_votes (request_id, voter_key) VALUES ($1,$2) ON CONFLICT DO NOTHING', [r.id, key]).catch(() => {});
    return { ok: true, request: this.view(r, key) };
  }

  vote(id: number, voter: string): { ok: true; votes: number; voted: boolean } | { ok: false; error: string } {
    const r = this.rows.get(id); if (!r) return { ok: false, error: 'No such request.' };
    if (r.status === 'shipped' || r.status === 'declined') return { ok: false, error: 'Voting is closed on this one.' };
    const key = nameKey(voter); const on = !r.voters.has(key);
    if (on) r.voters.add(key); else r.voters.delete(key);
    void this.db?.query(on ? 'INSERT INTO change_request_votes (request_id, voter_key) VALUES ($1,$2) ON CONFLICT DO NOTHING' : 'DELETE FROM change_request_votes WHERE request_id=$1 AND voter_key=$2', [id, key]).catch(() => {});
    return { ok: true, votes: r.voters.size, voted: on };
  }

  setStatus(id: number, status: unknown, note: unknown, changelog: unknown, now = Date.now()): { ok: true; request: PublicRequest } | { ok: false; error: string; code: number } {
    const r = this.rows.get(id); if (!r) return { ok: false, error: 'No such request.', code: 404 };
    const s = REQUEST_STATUSES.find((x) => x === status); if (!s) return { ok: false, error: `status must be one of ${REQUEST_STATUSES.join(', ')}.`, code: 400 };
    if (s !== r.status && !NEXT_STATUS[r.status].includes(s)) return { ok: false, error: `Can't move ${r.status} → ${s}. Allowed: ${NEXT_STATUS[r.status].join(', ') || 'none'}.`, code: 409 };
    if (note !== undefined && (typeof note !== 'string' || note.length > 300)) return { ok: false, error: 'note must be a string up to 300 chars.', code: 400 };
    let link: string | undefined;
    if (s === 'shipped') {
      if (typeof changelog !== 'string' || !changelog) return { ok: false, error: 'Shipped needs changelog: the commit (or title) of a CHANGELOG entry.', code: 400 };
      const e = CHANGELOG.find((x) => (x.commit && (x.commit.startsWith(changelog) || changelog.startsWith(x.commit))) || x.title.toLowerCase() === changelog.toLowerCase());
      if (!e) return { ok: false, error: 'No CHANGELOG entry matches that commit/title.', code: 400 };
      link = e.commit || e.title;
    }
    r.status = s; r.updatedAt = now; if (typeof note === 'string') r.note = note.trim() || undefined; if (link) r.changelog = link;
    this.save(r);
    return { ok: true, request: this.view(r) };
  }

  list(opts: { sort?: unknown; status?: unknown; viewer?: string | null; includeQa?: boolean }): PublicRequest[] {
    const vk = opts.viewer ? nameKey(opts.viewer) : null;
    const st = REQUEST_STATUSES.find((x) => x === opts.status);
    const order = { in_progress: 0, approved: 1, open: 2, shipped: 3, declined: 4 } as const;
    const sort = (['top', 'new', 'status'] as const).find((x) => x === opts.sort) ?? 'top';
    return [...this.rows.values()]
      .filter((r) => (!st || r.status === st) && (opts.includeQa || !isQaName(r.author)))
      .sort((a, b) => sort === 'new' ? b.createdAt - a.createdAt : sort === 'status' ? order[a.status] - order[b.status] || b.voters.size - a.voters.size : b.voters.size - a.voters.size || b.createdAt - a.createdAt)
      .map((r) => this.view(r, vk));
  }
  private view(r: Row, vk?: string | null): PublicRequest {
    return { id: r.id, title: r.title, details: r.details, category: r.category, author: r.author, status: r.status, votes: r.voters.size, ...(vk ? { voted: r.voters.has(vk) } : {}), createdAt: r.createdAt, updatedAt: r.updatedAt, ...(r.note ? { note: r.note } : {}), ...(r.changelog ? { changelog: r.changelog } : {}), ...(isQaName(r.author) ? { qa: true } : {}) };
  }
}

let board = new RequestBoard();
export const getRequests = () => board;
export const setRequestsForTest = (b: RequestBoard) => { board = b; };
export async function initRequests(): Promise<void> {
  const url = databaseUrl(); if (!url) return;
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[requests] pool error:', e.message));
  const b = new RequestBoard(pool);
  try { await b.load(); board = b; console.log('[requests] loaded from postgres'); } catch (e) { console.error('[requests] load failed, using memory:', (e as Error).message); }
}

async function signedIn(req: express.Request): Promise<string | null> {
  const t = req.get('x-relay-session'); if (!t) return null;
  try { const n = (await getAccounts().resume(t))?.name ?? null; return n && !isGuestName(n) ? n : null; } catch { return null; }
}

export function requestsRouter(): express.Router {
  const r = express.Router();
  const json = express.json({ limit: '4kb' });
  r.get('/api/requests', async (req, res) => {
    const me = await signedIn(req);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, requests: getRequests().list({ sort: req.query.sort, status: req.query.status, viewer: me, includeQa: isQaName(me ?? undefined) }) });
  });
  r.post('/api/requests', json, async (req, res) => {
    const me = await signedIn(req); if (!me) return res.status(401).json({ ok: false, error: 'Sign in to post a request.' });
    const out = getRequests().submit(me, req.body);
    res.status(out.ok ? 200 : 400).json(out);
  });
  r.post('/api/requests/:id/vote', async (req, res) => {
    const me = await signedIn(req); if (!me) return res.status(401).json({ ok: false, error: 'Sign in to vote.' });
    const out = getRequests().vote(Number(req.params.id), me);
    res.status(out.ok ? 200 : 400).json(out);
  });
  r.get('/api/admin/requests', (req, res) => {
    if (!adminAuthorized(req.get('authorization'))) return res.status(401).json({ ok: false, error: 'Unauthorized.' });
    res.json({ ok: true, requests: getRequests().list({ sort: req.query.sort, status: req.query.status, includeQa: true }) });
  });
  r.post('/api/admin/requests/:id/status', json, (req, res) => {
    if (!adminAuthorized(req.get('authorization'))) return res.status(401).json({ ok: false, error: 'Unauthorized.' });
    const { status, note, changelog } = (req.body ?? {}) as Record<string, unknown>;
    const out = getRequests().setStatus(Number(req.params.id), status, note, changelog);
    if (!out.ok) return res.status(out.code).json({ ok: false, error: out.error });
    console.log(`[admin] request #${req.params.id} -> ${String(status)} from ${req.ip ?? '?'}`);
    res.json(out);
  });
  return r;
}
