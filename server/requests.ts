/** Player change requests with one upvote per account, admin-only status changes, Postgres persistence. */
import express from 'express';
import pg from 'pg';
import { bootAttach, reconnectMsg, setBootState } from './boot-retry.js';
export const REQUESTS_OFFLINE_MSG = reconnectMsg('Requests');
import { getAccounts, isGuestName, nameKey } from './accounts.js';
import { getMayor } from './mayor.js';
import { adminAuthorized } from './admin.js';
import { databaseUrl, type Queryable } from './leaderboard-store.js';
import { isQaName } from '../shared/qa.js';
import { CHANGELOG } from '../shared/changelog.js';
import { NEXT_STATUS, PER_DAY, parseScheduledFor, REQUEST_STATUSES, validateRequest, type PublicRequest, type RequestCategory, type RequestStatus, type RequestEndorsement, type CivicRole } from '../shared/requests.js';

export const REQUESTS_MIGRATION = `CREATE TABLE IF NOT EXISTS change_requests (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, details TEXT NOT NULL, category TEXT NOT NULL, author TEXT NOT NULL,
  author_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', note TEXT, changelog TEXT,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS change_request_votes (request_id INTEGER NOT NULL, voter_key TEXT NOT NULL, PRIMARY KEY (request_id, voter_key));
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS scheduled_for TEXT;
CREATE TABLE IF NOT EXISTS change_request_endorsements (
  request_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  player_key TEXT NOT NULL,
  name TEXT NOT NULL,
  term_week TEXT NOT NULL,
  at BIGINT NOT NULL,
  PRIMARY KEY (request_id, role, term_week)
);`;

interface Row { id: number; title: string; details: string; category: RequestCategory; author: string; authorKey: string; status: RequestStatus; note?: string; changelog?: string; scheduledFor?: string; createdAt: number; updatedAt: number; voters: Set<string>; endorsements: RequestEndorsement[] }
export type Sort = 'top' | 'new' | 'old' | 'status';
const DAY = 86_400_000;

export class RequestBoard {
  private rows = new Map<number, Row>();
  private nextId = 1;
  /** True while booting/reconnecting: the board is not loaded, so it is neither shown nor written. */
  offline = false;
  constructor(private db: Queryable | null = null, private officersOf: () => Promise<{ mayor: { key: string; name: string; week: string } | null; vice: { key: string; name: string; week: string } | null }> = sittingOfficers) {}

  async load(): Promise<void> {
    if (!this.db) return;
    for (const stmt of REQUESTS_MIGRATION.split(';')) await this.db.query(stmt);
    const { rows } = await this.db.query('SELECT * FROM change_requests');
    this.rows.clear();
    for (const r of rows) this.rows.set(r.id, { id: r.id, title: r.title, details: r.details, category: r.category, author: r.author, authorKey: r.author_key, status: r.status, note: r.note ?? undefined, changelog: r.changelog ?? undefined, scheduledFor: r.scheduled_for ?? undefined, createdAt: +new Date(r.created_at), updatedAt: +new Date(r.updated_at), voters: new Set(), endorsements: [] });
    const v = await this.db.query('SELECT request_id, voter_key FROM change_request_votes');
    for (const x of v.rows) this.rows.get(x.request_id)?.voters.add(x.voter_key);
    try {
      const e = await this.db.query('SELECT * FROM change_request_endorsements');
      for (const x of e.rows) this.rows.get(x.request_id)?.endorsements.push({ role: x.role, name: x.name, at: Number(x.at), week: String(x.term_week) });
    } catch { /* table added by migration */ }
    this.nextId = Math.max(0, ...this.rows.keys()) + 1;
    this.offline = false;
  }
  private save(r: Row) {
    void this.db?.query(`INSERT INTO change_requests (id,title,details,category,author,author_key,status,note,changelog,created_at,updated_at,scheduled_for) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, note=EXCLUDED.note, changelog=EXCLUDED.changelog, updated_at=EXCLUDED.updated_at, scheduled_for=EXCLUDED.scheduled_for`,
      [r.id, r.title, r.details, r.category, r.author, r.authorKey, r.status, r.note ?? null, r.changelog ?? null, new Date(r.createdAt), new Date(r.updatedAt), r.scheduledFor ?? null]).catch((e) => console.error('[requests] save failed:', (e as Error).message));
  }

  submit(author: string, body: unknown, now = Date.now()): { ok: true; request: PublicRequest } | { ok: false; error: string } {
    if (this.offline) return { ok: false, error: REQUESTS_OFFLINE_MSG };
    const v = validateRequest((body ?? {}) as Record<string, unknown>);
    if (!v.ok) return v;
    const key = nameKey(author);
    const recent = [...this.rows.values()].filter((r) => r.authorKey === key && now - r.createdAt < DAY).length;
    if (recent >= PER_DAY) return { ok: false, error: `You can post ${PER_DAY} requests a day. Try again tomorrow.` };
    if ([...this.rows.values()].some((r) => r.title.toLowerCase() === v.title.toLowerCase() && r.status !== 'declined')) return { ok: false, error: 'That request already exists — upvote it instead.' };
    const r: Row = { id: this.nextId++, title: v.title, details: v.details, category: v.category, author, authorKey: key, status: 'open', createdAt: now, updatedAt: now, voters: new Set([key]), endorsements: [] };
    this.rows.set(r.id, r); this.save(r);
    void this.db?.query('INSERT INTO change_request_votes (request_id, voter_key) VALUES ($1,$2) ON CONFLICT DO NOTHING', [r.id, key]).catch(() => {});
    return { ok: true, request: this.view(r, key) };
  }

  vote(id: number, voter: string): { ok: true; votes: number; voted: boolean } | { ok: false; error: string } {
    if (this.offline) return { ok: false, error: REQUESTS_OFFLINE_MSG };
    const r = this.rows.get(id); if (!r) return { ok: false, error: 'No such request.' };
    if (r.status === 'shipped' || r.status === 'declined') return { ok: false, error: 'Voting is closed on this one.' };
    const key = nameKey(voter); const on = !r.voters.has(key);
    if (on) r.voters.add(key); else r.voters.delete(key);
    void this.db?.query(on ? 'INSERT INTO change_request_votes (request_id, voter_key) VALUES ($1,$2) ON CONFLICT DO NOTHING' : 'DELETE FROM change_request_votes WHERE request_id=$1 AND voter_key=$2', [id, key]).catch(() => {});
    return { ok: true, votes: r.voters.size, voted: on };
  }

  setStatus(id: number, status: unknown, note: unknown, changelog: unknown, now = Date.now(), scheduledFor?: unknown): { ok: true; request: PublicRequest } | { ok: false; error: string; code: number } {
    if (this.offline) return { ok: false, error: REQUESTS_OFFLINE_MSG, code: 503 };
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
    let sched: string | undefined;
    if (s === 'scheduled' && scheduledFor !== undefined && scheduledFor !== null && scheduledFor !== '') {
      const d = parseScheduledFor(scheduledFor); if (!d) return { ok: false, error: 'scheduledFor must be a date like 2026-11-07.', code: 400 };
      sched = d;
    }
    r.status = s; r.updatedAt = now; r.scheduledFor = s === 'scheduled' ? sched : undefined; if (typeof note === 'string') r.note = note.trim() || undefined; if (link) r.changelog = link;
    this.save(r);
    return { ok: true, request: this.view(r) };
  }


  async endorse(name: string, id: number, now = Date.now()): Promise<{ ok: true; request: PublicRequest } | { ok: false; error: string; code: number }> {
    if (this.offline) return { ok: false, error: REQUESTS_OFFLINE_MSG, code: 503 };
    const r = this.rows.get(id); if (!r) return { ok: false, error: 'No such request.', code: 404 };
    if (r.status !== 'open' && r.status !== 'scheduled') return { ok: false, error: 'Only open (or scheduled) requests can be endorsed.', code: 409 };
    const officers = await this.officersOf();
    const key = nameKey(name);
    let role: CivicRole | null = null; let week = '';
    if (officers.mayor && officers.mayor.key === key) { role = 'mayor'; week = officers.mayor.week; }
    else if (officers.vice && officers.vice.key === key) { role = 'vice'; week = officers.vice.week; }
    if (!role) return { ok: false, error: 'Only the sitting mayor and sitting vice mayor can endorse a request.', code: 403 };
    if (r.endorsements.some((e) => e.role === role && e.week === week)) {
      return { ok: true, request: this.view(r) }; // idempotent
    }
    // Replace a prior-term endorsement for this role.
    r.endorsements = r.endorsements.filter((e) => !(e.role === role && e.week !== week));
    r.endorsements.push({ role, name: name.trim(), at: now, week });
    void this.db?.query(
      `INSERT INTO change_request_endorsements (request_id, role, player_key, name, term_week, at) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (request_id, role, term_week) DO NOTHING`,
      [r.id, role, key, name.trim(), week, now],
    ).catch((e) => console.error('[requests] endorse save failed:', (e as Error).message));
    const cur = r.endorsements.filter((e) => e.week === week);
    if (officers.mayor && officers.vice && cur.some((e) => e.role === 'mayor') && cur.some((e) => e.role === 'vice') && r.status === 'open') {
      r.status = 'approved'; r.updatedAt = now; this.save(r);
    }
    return { ok: true, request: this.view(r) };
  }
  async withdrawEndorsement(name: string, id: number): Promise<{ ok: true; request: PublicRequest } | { ok: false; error: string; code: number }> {
    if (this.offline) return { ok: false, error: REQUESTS_OFFLINE_MSG, code: 503 };
    const r = this.rows.get(id); if (!r) return { ok: false, error: 'No such request.', code: 404 };
    if (r.status !== 'open' && r.status !== 'scheduled') return { ok: false, error: 'Endorsements can only be withdrawn while the request is still open or scheduled.', code: 409 };
    const officers = await this.officersOf();
    const key = nameKey(name);
    let role: CivicRole | null = null; let week = '';
    if (officers.mayor && officers.mayor.key === key) { role = 'mayor'; week = officers.mayor.week; }
    else if (officers.vice && officers.vice.key === key) { role = 'vice'; week = officers.vice.week; }
    if (!role) return { ok: false, error: 'Only the sitting mayor and sitting vice mayor can withdraw an endorsement.', code: 403 };
    const before = r.endorsements.length;
    r.endorsements = r.endorsements.filter((e) => !(e.role === role && e.week === week));
    if (r.endorsements.length === before) return { ok: true, request: this.view(r) };
    void this.db?.query('DELETE FROM change_request_endorsements WHERE request_id = $1 AND role = $2 AND term_week = $3', [r.id, role, week])
      .catch((e) => console.error('[requests] withdraw save failed:', (e as Error).message));
    return { ok: true, request: this.view(r) };
  }

  list(opts: { sort?: unknown; status?: unknown; viewer?: string | null; includeQa?: boolean }): PublicRequest[] {
    const vk = opts.viewer ? nameKey(opts.viewer) : null;
    const st = REQUEST_STATUSES.find((x) => x === opts.status);
    const order = { in_progress: 0, scheduled: 1, approved: 2, open: 3, shipped: 4, declined: 5 } as const;
    const sort = (['top', 'new', 'old', 'status'] as const).find((x) => x === opts.sort) ?? 'top';
    const newest = (a: Row, b: Row) => b.createdAt - a.createdAt || b.id - a.id;
    return [...this.rows.values()]
      .filter((r) => (!st || r.status === st) && (opts.includeQa || !isQaName(r.author)))
      .sort((a, b) => sort === 'new' ? newest(a, b) : sort === 'old' ? -newest(a, b) : sort === 'status' ? order[a.status] - order[b.status] || b.voters.size - a.voters.size || newest(a, b) : b.voters.size - a.voters.size || newest(a, b))
      .map((r) => this.view(r, vk));
  }
  private view(r: Row, vk?: string | null): PublicRequest {
    return { id: r.id, title: r.title, details: r.details, category: r.category, author: r.author, status: r.status, votes: r.voters.size, ...(vk ? { voted: r.voters.has(vk) } : {}), createdAt: r.createdAt, updatedAt: r.updatedAt, ...(r.note ? { note: r.note } : {}), ...(r.changelog ? { changelog: r.changelog } : {}), ...(r.scheduledFor ? { scheduledFor: r.scheduledFor } : {}), ...(isQaName(r.author) ? { qa: true } : {}), ...(r.endorsements?.length ? { endorsements: r.endorsements } : {}) };
  }
}

export async function sittingOfficers(): Promise<{ mayor: { key: string; name: string; week: string } | null; vice: { key: string; name: string; week: string } | null }> {
  const inst = getMayor();
  if (!inst) return { mayor: null, vice: null };
  const [mayor, vice] = await Promise.all([inst.mayor(), inst.vice()]);
  const week = mayor?.week ?? '';
  return {
    mayor: mayor ? { key: mayor.key, name: mayor.name, week } : null,
    vice: vice ? { key: vice.key, name: vice.name, week } : null,
  };
}

let board = new RequestBoard();
export const getRequests = () => board;
export const setRequestsForTest = (b: RequestBoard) => { board = b; };
export async function initRequests(): Promise<void> {
  const url = databaseUrl(); if (!url) { setBootState('requests', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[requests] pool error:', e.message));
  const b = new RequestBoard(pool); b.offline = true;
  board = b;
  await bootAttach('requests', async () => { try { await b.load(); return true; } catch (e) { console.error('[requests] load failed:', (e as Error).message); return false; } }, { onOk: () => console.log('[requests] loaded from postgres') });
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
    if (getRequests().offline) return res.status(503).json({ ok: false, offline: true, error: REQUESTS_OFFLINE_MSG, requests: [] });
    res.json({ ok: true, requests: getRequests().list({ sort: req.query.sort, status: req.query.status, viewer: me, includeQa: isQaName(me ?? undefined) }) });
  });
  r.post('/api/requests', json, async (req, res) => {
    const me = await signedIn(req); if (!me) return res.status(401).json({ ok: false, error: 'Sign in to post a request.' });
    const out = getRequests().submit(me, req.body);
    res.status(out.ok ? 200 : getRequests().offline ? 503 : 400).json(out);
  });

  r.post('/api/requests/:id/endorse', async (req, res) => {
    const me = await signedIn(req); if (!me) return res.status(401).json({ ok: false, error: 'Sign in to endorse a request.' });
    const withdraw = req.query.withdraw === '1' || req.query.withdraw === 'true';
    const out = withdraw ? await getRequests().withdrawEndorsement(me, Number(req.params.id)) : await getRequests().endorse(me, Number(req.params.id));
    if (!out.ok) return res.status(out.code).json({ ok: false, error: out.error });
    res.json(out);
  });
  r.post('/api/requests/:id/vote', async (req, res) => {
    const me = await signedIn(req); if (!me) return res.status(401).json({ ok: false, error: 'Sign in to vote.' });
    const out = getRequests().vote(Number(req.params.id), me);
    res.status(out.ok ? 200 : getRequests().offline ? 503 : 400).json(out);
  });
  r.get('/api/admin/requests', (req, res) => {
    if (!adminAuthorized(req.get('authorization'))) return res.status(401).json({ ok: false, error: 'Unauthorized.' });
    if (getRequests().offline) return res.status(503).json({ ok: false, offline: true, error: REQUESTS_OFFLINE_MSG, requests: [] });
    res.json({ ok: true, requests: getRequests().list({ sort: req.query.sort, status: req.query.status, includeQa: true }) });
  });
  r.post('/api/admin/requests/:id/status', json, (req, res) => {
    if (!adminAuthorized(req.get('authorization'))) return res.status(401).json({ ok: false, error: 'Unauthorized.' });
    const { status, note, changelog, scheduledFor } = (req.body ?? {}) as Record<string, unknown>;
    const out = getRequests().setStatus(Number(req.params.id), status, note, changelog, Date.now(), scheduledFor);
    if (!out.ok) return res.status(out.code).json({ ok: false, error: out.error });
    console.log(`[admin] request #${req.params.id} -> ${String(status)} from ${req.ip ?? '?'}`);
    res.json(out);
  });
  return r;
}
