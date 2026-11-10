import type pg from 'pg';
import { implementationOf } from './billImplementations.js';
import { abDate } from '../shared/mayor.js';
import { lawDenyReason, lawRejectReason, lawText, lawTitle, MAX_PENDING_LAW_DRAFTS, parseBillNumber, parseDraftId, type MayorLaw, type MayorLawView } from '../shared/mayorLaws.js';
import { playerKey } from './skins.js';

export class MayorLawError extends Error {}

export const MAYOR_LAWS_MIGRATION = `
CREATE TABLE IF NOT EXISTS mayor_bill_counter (id INTEGER PRIMARY KEY CHECK (id = 1), value BIGINT NOT NULL);
INSERT INTO mayor_bill_counter (id, value) VALUES (1, 0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS mayor_bills (number BIGINT PRIMARY KEY, day TEXT NOT NULL UNIQUE, text TEXT NOT NULL, by_name TEXT NOT NULL, mayor_key TEXT NOT NULL, term_week TEXT NOT NULL, at BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
ALTER TABLE mayor_bills ADD COLUMN IF NOT EXISTS vetoed_at BIGINT, ADD COLUMN IF NOT EXISTS vetoed_by_name TEXT, ADD COLUMN IF NOT EXISTS vetoed_by_key TEXT, ADD COLUMN IF NOT EXISTS vetoed_term_week TEXT, ADD COLUMN IF NOT EXISTS vetoed_role TEXT;
ALTER TABLE mayor_bills ADD COLUMN IF NOT EXISTS denied_at BIGINT, ADD COLUMN IF NOT EXISTS deny_reason TEXT;
ALTER TABLE mayor_bills DROP CONSTRAINT IF EXISTS mayor_bills_status_check;
ALTER TABLE mayor_bills ADD CONSTRAINT mayor_bills_status_check CHECK (
  (status = 'pending' AND vetoed_at IS NULL AND vetoed_by_name IS NULL AND vetoed_by_key IS NULL AND vetoed_term_week IS NULL AND vetoed_role IS NULL AND denied_at IS NULL AND deny_reason IS NULL)
  OR (status = 'vetoed' AND vetoed_at IS NOT NULL AND vetoed_by_name IS NOT NULL AND vetoed_by_key IS NOT NULL AND vetoed_term_week IS NOT NULL AND vetoed_role IN ('mayor', 'vice') AND denied_at IS NULL AND deny_reason IS NULL)
  OR (status = 'denied' AND denied_at IS NOT NULL AND deny_reason IS NOT NULL AND vetoed_at IS NULL AND vetoed_by_name IS NULL AND vetoed_by_key IS NULL AND vetoed_term_week IS NULL AND vetoed_role IS NULL));
CREATE TABLE IF NOT EXISTS mayor_bill_events (id BIGSERIAL PRIMARY KEY, number BIGINT NOT NULL REFERENCES mayor_bills(number), kind TEXT NOT NULL CHECK (kind IN ('vetoed', 'denied')), role TEXT NOT NULL CHECK (role IN ('mayor', 'vice', 'admin')), by_name TEXT NOT NULL, by_key TEXT NOT NULL, term_week TEXT NOT NULL, at BIGINT NOT NULL, UNIQUE (number, kind));
ALTER TABLE mayor_bill_events DROP CONSTRAINT IF EXISTS mayor_bill_events_kind_check;
ALTER TABLE mayor_bill_events ADD CONSTRAINT mayor_bill_events_kind_check CHECK (kind IN ('vetoed', 'denied'));
ALTER TABLE mayor_bill_events DROP CONSTRAINT IF EXISTS mayor_bill_events_role_check;
ALTER TABLE mayor_bill_events ADD CONSTRAINT mayor_bill_events_role_check CHECK (role IN ('mayor', 'vice', 'admin'));
`;
/** Database-enforced permanence; real PostgreSQL only (in-memory pg-mem unit DB cannot run plpgsql). */
export const MAYOR_LAWS_GUARDS = `
CREATE OR REPLACE FUNCTION mayor_bills_guard() RETURNS trigger LANGUAGE plpgsql AS $g$
BEGIN
  IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'mayor bills are permanent records'; END IF;
  IF NEW.number IS DISTINCT FROM OLD.number OR NEW.day IS DISTINCT FROM OLD.day OR NEW.text IS DISTINCT FROM OLD.text
     OR NEW.by_name IS DISTINCT FROM OLD.by_name OR NEW.mayor_key IS DISTINCT FROM OLD.mayor_key
     OR NEW.term_week IS DISTINCT FROM OLD.term_week OR NEW.at IS DISTINCT FROM OLD.at
     OR NOT (OLD.status = 'pending' AND NEW.status IN ('vetoed', 'denied')) THEN
    RAISE EXCEPTION 'mayor bill records are immutable except pending -> vetoed or denied';
  END IF;
  RETURN NEW;
END $g$;
CREATE OR REPLACE FUNCTION mayor_bill_events_guard() RETURNS trigger LANGUAGE plpgsql AS $g$
BEGIN RAISE EXCEPTION 'mayor bill events are append-only'; END $g$;
DROP TRIGGER IF EXISTS mayor_bills_guard ON mayor_bills;
CREATE TRIGGER mayor_bills_guard BEFORE UPDATE OR DELETE ON mayor_bills FOR EACH ROW EXECUTE FUNCTION mayor_bills_guard();
DROP TRIGGER IF EXISTS mayor_bills_no_truncate ON mayor_bills;
CREATE TRIGGER mayor_bills_no_truncate BEFORE TRUNCATE ON mayor_bills FOR EACH STATEMENT EXECUTE FUNCTION mayor_bills_guard();
DROP TRIGGER IF EXISTS mayor_bill_events_guard ON mayor_bill_events;
CREATE TRIGGER mayor_bill_events_guard BEFORE UPDATE OR DELETE ON mayor_bill_events FOR EACH ROW EXECUTE FUNCTION mayor_bill_events_guard();
DROP TRIGGER IF EXISTS mayor_bill_events_no_truncate ON mayor_bill_events;
CREATE TRIGGER mayor_bill_events_no_truncate BEFORE TRUNCATE ON mayor_bill_events FOR EACH STATEMENT EXECUTE FUNCTION mayor_bill_events_guard();
`;

/** Additive vice-mayor drafts (pending mayor approval). Does not alter existing mayor_bills rows. */
export const MAYOR_LAW_DRAFTS_MIGRATION = `
CREATE TABLE IF NOT EXISTS mayor_bill_drafts (
  id BIGSERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  by_name TEXT NOT NULL,
  vice_key TEXT NOT NULL,
  term_week TEXT NOT NULL,
  at BIGINT NOT NULL,
  status TEXT NOT NULL,
  reject_reason TEXT,
  rejected_at BIGINT,
  rejected_by_name TEXT,
  rejected_by_key TEXT,
  approved_at BIGINT,
  approved_by_name TEXT,
  approved_by_key TEXT,
  approved_bill_number BIGINT REFERENCES mayor_bills(number),
  expired_at BIGINT
);
ALTER TABLE mayor_bill_drafts DROP CONSTRAINT IF EXISTS mayor_bill_drafts_status_check;
ALTER TABLE mayor_bill_drafts ADD CONSTRAINT mayor_bill_drafts_status_check CHECK (
  (status = 'pending_approval' AND reject_reason IS NULL AND rejected_at IS NULL AND rejected_by_name IS NULL AND rejected_by_key IS NULL AND approved_at IS NULL AND approved_by_name IS NULL AND approved_by_key IS NULL AND approved_bill_number IS NULL AND expired_at IS NULL)
  OR (status = 'rejected' AND rejected_at IS NOT NULL AND rejected_by_name IS NOT NULL AND rejected_by_key IS NOT NULL AND approved_at IS NULL AND approved_by_name IS NULL AND approved_by_key IS NULL AND approved_bill_number IS NULL AND expired_at IS NULL)
  OR (status = 'approved' AND approved_at IS NOT NULL AND approved_by_name IS NOT NULL AND approved_by_key IS NOT NULL AND approved_bill_number IS NOT NULL AND rejected_at IS NULL AND rejected_by_name IS NULL AND rejected_by_key IS NULL AND reject_reason IS NULL AND expired_at IS NULL)
  OR (status = 'expired' AND expired_at IS NOT NULL AND rejected_at IS NULL AND rejected_by_name IS NULL AND rejected_by_key IS NULL AND reject_reason IS NULL AND approved_at IS NULL AND approved_by_name IS NULL AND approved_by_key IS NULL AND approved_bill_number IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS mayor_bill_drafts_approved_bill ON mayor_bill_drafts (approved_bill_number);
CREATE INDEX IF NOT EXISTS mayor_bill_drafts_vice_pending ON mayor_bill_drafts (vice_key, status);
CREATE INDEX IF NOT EXISTS mayor_bill_drafts_term ON mayor_bill_drafts (term_week, status);
`;
export const MAYOR_LAW_DRAFTS_GUARDS = `
CREATE OR REPLACE FUNCTION mayor_bill_drafts_guard() RETURNS trigger LANGUAGE plpgsql AS $g$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'vice mayor bill drafts are permanent records'; END IF;
  IF TG_OP = 'TRUNCATE' THEN RAISE EXCEPTION 'vice mayor bill drafts are permanent records'; END IF;
  IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'vice mayor bill drafts are permanent records'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.text IS DISTINCT FROM OLD.text OR NEW.by_name IS DISTINCT FROM OLD.by_name
     OR NEW.vice_key IS DISTINCT FROM OLD.vice_key OR NEW.term_week IS DISTINCT FROM OLD.term_week OR NEW.at IS DISTINCT FROM OLD.at THEN
    RAISE EXCEPTION 'vice mayor bill drafts are immutable except pending_approval status changes';
  END IF;
  IF NOT (OLD.status = 'pending_approval' AND NEW.status IN ('rejected', 'approved', 'expired')) THEN
    RAISE EXCEPTION 'vice mayor bill drafts are immutable except pending_approval status changes';
  END IF;
  RETURN NEW;
END $g$;
DROP TRIGGER IF EXISTS mayor_bill_drafts_guard ON mayor_bill_drafts;
CREATE TRIGGER mayor_bill_drafts_guard BEFORE UPDATE OR DELETE ON mayor_bill_drafts FOR EACH ROW EXECUTE FUNCTION mayor_bill_drafts_guard();
DROP TRIGGER IF EXISTS mayor_bill_drafts_no_truncate ON mayor_bill_drafts;
CREATE TRIGGER mayor_bill_drafts_no_truncate BEFORE TRUNCATE ON mayor_bill_drafts FOR EACH STATEMENT EXECUTE FUNCTION mayor_bill_drafts_guard();
`;
const rowLaw = (r: Record<string, unknown>): MayorLaw => ({ number: String(r.number), title: lawTitle(String(r.number)), text: String(r.text), by: String(r.by_name), at: Number(r.at), day: String(r.day),
  status: r.status === 'vetoed' ? 'vetoed' : r.status === 'denied' ? 'denied' : 'pending', vetoedBy: r.vetoed_by_name == null ? null : String(r.vetoed_by_name), vetoedAt: r.vetoed_at == null ? null : Number(r.vetoed_at), vetoedRole: r.vetoed_role === 'vice' ? 'vice' : r.vetoed_role === 'mayor' ? 'mayor' : null,
  denyReason: r.deny_reason == null ? null : String(r.deny_reason), deniedAt: r.denied_at == null ? null : Number(r.denied_at),
  ...(r.drafted_by_name ? { draftedBy: String(r.drafted_by_name), approvedBy: r.approved_by_name == null ? null : String(r.approved_by_name) } : {}),
  ...(implementationOf(r) ? { implementation: implementationOf(r) } : {}) });
const rowDraft = (r: Record<string, unknown>): MayorLaw => {
  const st = String(r.status);
  const status = st === 'rejected' || st === 'expired' || st === 'pending_approval' ? st : 'pending_approval';
  const at = Number(r.at);
  return {
    number: `draft:${r.id}`, title: 'Vice mayor draft', text: String(r.text), by: String(r.by_name), at, day: abDate(at),
    status, vetoedBy: null, vetoedAt: null, vetoedRole: null,
    draftedBy: String(r.by_name),
    approvedBy: r.approved_by_name == null ? null : String(r.approved_by_name),
    draftId: String(r.id),
    rejectReason: r.reject_reason == null ? null : String(r.reject_reason),
  };
};
async function expirePendingDrafts(q: { query: pg.Pool['query'] }, now: number) {
  await q.query("UPDATE mayor_bill_drafts SET status = 'expired', expired_at = $1 WHERE status = 'pending_approval' AND term_week IN (SELECT week FROM mayor_terms WHERE ends_at <= $1)", [now]);
}
export class MayorLaws {

  constructor(private readonly pool: pg.Pool, private readonly clock = () => Date.now()) {}
  async init() {
    let inMemory = false;
    try { await this.pool.query('SELECT version()'); } catch (e) { inMemory = /pg-mem/i.test(String((e as Error).message) + JSON.stringify((e as { data?: unknown }).data ?? '')); if (!inMemory) throw e; }
    // pg-mem unit DB cannot run plpgsql; every real PostgreSQL gets the permanence guards.
    if (inMemory) { await this.pool.query(MAYOR_LAWS_MIGRATION + MAYOR_LAW_DRAFTS_MIGRATION); return; }
    // One implicit transaction; advisory lock serializes concurrent instance boots.
    await this.pool.query(`SELECT pg_advisory_xact_lock(74210611);${MAYOR_LAWS_MIGRATION}${MAYOR_LAWS_GUARDS}${MAYOR_LAW_DRAFTS_MIGRATION}${MAYOR_LAW_DRAFTS_GUARDS}`);
  }
  async history(before?: unknown): Promise<MayorLawView> {
    if (before !== undefined && (typeof before !== 'string' || !/^[1-9]\d*$/.test(before) || before.length > 19 || BigInt(before) > 9223372036854775807n)) throw new MayorLawError('Invalid bill history cursor.');
    await expirePendingDrafts(this.pool, this.clock());
    const r = before === undefined
      ? await this.pool.query('SELECT b.*, d.by_name AS drafted_by_name, d.approved_by_name FROM mayor_bills b LEFT JOIN mayor_bill_drafts d ON d.approved_bill_number = b.number AND d.status = \'approved\' ORDER BY b.number DESC LIMIT 101')
      : await this.pool.query('SELECT b.*, d.by_name AS drafted_by_name, d.approved_by_name FROM mayor_bills b LEFT JOIN mayor_bill_drafts d ON d.approved_bill_number = b.number AND d.status = \'approved\' WHERE b.number < $1 ORDER BY b.number DESC LIMIT 101', [before]);
    let history = r.rows.slice(0, 100).map(rowLaw);
    const today = await this.pool.query('SELECT number FROM mayor_bills WHERE day = $1', [abDate(this.clock())]);
    const pending = await this.pool.query("SELECT * FROM mayor_bill_drafts WHERE status = 'pending_approval' ORDER BY at DESC, id DESC");
    const pendingDrafts = pending.rows.map(rowDraft);
    if (before === undefined) {
      const archived = await this.pool.query("SELECT * FROM mayor_bill_drafts WHERE status IN ('rejected', 'expired') ORDER BY at DESC, id DESC LIMIT 100");
      const extras = archived.rows.map(rowDraft);
      history = [...pendingDrafts, ...history, ...extras].sort((a, b) => b.at - a.at || b.number.localeCompare(a.number, undefined, { numeric: true }));
    }
    return { history, nextBefore: r.rows.length > 100 ? String(r.rows[99]!.number) : null, submittedToday: today.rows.length > 0, pendingDrafts, pendingDraftCount: pendingDrafts.length };
  }
  async submit(name: string, value: unknown): Promise<{ bill: MayorLaw }> {
    let text: string;
    try { text = lawText(value); } catch (e) { throw new MayorLawError((e as Error).message); }
    const cl = await this.pool.connect();
    try {
      await cl.query('BEGIN');
      // One globally serialized claim; counter update rolls back with any failed insert.
      await cl.query('SELECT value FROM mayor_bill_counter WHERE id = 1 FOR UPDATE');
      // Check clock AFTER waiting for the counter lock (including midnight/term boundaries).
      const now = this.clock();
      const m = await cl.query('SELECT * FROM mayor_terms WHERE starts_at <= $1 AND ends_at > $1 AND removed_at IS NULL ORDER BY starts_at DESC LIMIT 1 FOR SHARE', [now]);
      if (!m.rows[0] || m.rows[0].player_key !== playerKey(name)) throw new MayorLawError('Only the sitting mayor may pass a bill.');
      const day = abDate(now);
      if ((await cl.query('SELECT number FROM mayor_bills WHERE day = $1', [day])).rows.length) throw new MayorLawError('The city has already submitted a bill today (America/Regina).');
      const c = await cl.query('UPDATE mayor_bill_counter SET value = value + 1 WHERE id = 1 RETURNING value');
      const number = String(c.rows[0].value);
      const r = await cl.query('INSERT INTO mayor_bills (number, day, text, by_name, mayor_key, term_week, at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [number, day, text, m.rows[0].name, m.rows[0].player_key, m.rows[0].week, now]);
      await cl.query('COMMIT'); return { bill: rowLaw(r.rows[0]) };
    } catch (e) { await cl.query('ROLLBACK'); throw e; }
    finally { cl.release(); }
  }
  /** Veto = status only (bills are inert; nothing to roll back).
   * Strict America/Regina day split: vice mayor -> bills submitted today only; sitting mayor -> bills from earlier days only. */
  async veto(name: string, value: unknown): Promise<{ bill: MayorLaw; already: boolean }> {
    let number: string;
    try { number = parseBillNumber(value); } catch (e) { throw new MayorLawError((e as Error).message); }
    const cl = await this.pool.connect();
    try {
      await cl.query('BEGIN');
      const b = await cl.query('SELECT * FROM mayor_bills WHERE number = $1 FOR UPDATE', [number]);
      // Clock and roles are read after the row lock (midnight / term rollover / removal races).
      const now = this.clock(); const today = abDate(now); const key = playerKey(name);
      const m = await cl.query('SELECT * FROM mayor_terms WHERE starts_at <= $1 AND ends_at > $1 AND removed_at IS NULL ORDER BY starts_at DESC LIMIT 1 FOR SHARE', [now]);
      const v = await cl.query('SELECT * FROM mayor_terms WHERE starts_at <= $1 AND ends_at > $1 AND vice_key IS NOT NULL ORDER BY starts_at DESC LIMIT 1 FOR SHARE', [now]);
      const isMayor = !!m.rows[0] && m.rows[0].player_key === key;
      const isVice = !!v.rows[0] && v.rows[0].vice_key === key;
      if (!isMayor && !isVice) throw new MayorLawError('Only the sitting mayor or vice mayor may veto a bill.');
      if (!b.rows[0]) throw new MayorLawError('No such bill.');
      if (implementationOf(b.rows[0])) throw new MayorLawError('This bill has been implemented with revised wording. It is not a pending bill; changing the active rules requires a new implementation.');
      if (b.rows[0].status === 'denied') throw new MayorLawError('This bill has already been denied.');
      const fromToday = String(b.rows[0].day) === today;
      let role: 'mayor' | 'vice'; let term: Record<string, unknown>; let byName: string;
      if (fromToday) { if (!isVice) throw new MayorLawError('Bills submitted today can only be vetoed by the vice mayor.'); role = 'vice'; term = v.rows[0]; byName = String(v.rows[0].vice_name); }
      else { if (!isMayor) throw new MayorLawError('Bills from earlier days can only be vetoed by the sitting mayor.'); role = 'mayor'; term = m.rows[0]; byName = String(m.rows[0].name); }
      if (b.rows[0].status === 'vetoed') { await cl.query('COMMIT'); return { bill: rowLaw(b.rows[0]), already: true }; }
      const r = await cl.query("UPDATE mayor_bills SET status = 'vetoed', vetoed_at = $2, vetoed_by_name = $3, vetoed_by_key = $4, vetoed_term_week = $5, vetoed_role = $6 WHERE number = $1 AND status = 'pending' RETURNING *", [number, now, byName, key, term.week, role]);
      await cl.query("INSERT INTO mayor_bill_events (number, kind, role, by_name, by_key, term_week, at) VALUES ($1, 'vetoed', $2, $3, $4, $5, $6)", [number, role, byName, key, term.week, now]);
      await cl.query('COMMIT'); return { bill: rowLaw(r.rows[0]), already: false };
    } catch (e) { await cl.query('ROLLBACK'); throw e; }
    finally { cl.release(); }
  }
  /** Sitting vice mayor (from the persisted current term) files a draft. No bill number, day slot, veto, or treasury. */
  async submitDraft(name: string, value: unknown): Promise<{ bill: MayorLaw }> {
    let text: string;
    try { text = lawText(value); } catch (e) { throw new MayorLawError((e as Error).message); }
    const cl = await this.pool.connect();
    try {
      await cl.query('BEGIN');
      const now = this.clock();
      const v = await cl.query('SELECT * FROM mayor_terms WHERE starts_at <= $1 AND ends_at > $1 AND vice_key IS NOT NULL ORDER BY starts_at DESC LIMIT 1 FOR UPDATE', [now]);
      if (!v.rows[0] || v.rows[0].vice_key !== playerKey(name)) throw new MayorLawError('Only the sitting vice mayor may draft a bill.');
      await expirePendingDrafts(cl, now);
      const n = await cl.query("SELECT id FROM mayor_bill_drafts WHERE vice_key = $1 AND status = 'pending_approval' FOR UPDATE", [v.rows[0].vice_key]);
      if (n.rows.length >= MAX_PENDING_LAW_DRAFTS) throw new MayorLawError(`You already have ${MAX_PENDING_LAW_DRAFTS} bills waiting for the mayor’s approval.`);
      const r = await cl.query('INSERT INTO mayor_bill_drafts (text, by_name, vice_key, term_week, at, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [text, v.rows[0].vice_name, v.rows[0].vice_key, v.rows[0].week, now, 'pending_approval']);
      await cl.query('COMMIT'); return { bill: rowDraft(r.rows[0]) };
    } catch (e) { await cl.query('ROLLBACK'); throw e; }
    finally { cl.release(); }
  }
  /** Sitting mayor accepts a draft: same official submit path as if they had typed it, plus drafter attribution. */
  async approveDraft(name: string, value: unknown): Promise<{ bill: MayorLaw }> {
    let id: string;
    try { id = parseDraftId(value); } catch (e) { throw new MayorLawError((e as Error).message); }
    const cl = await this.pool.connect();
    try {
      await cl.query('BEGIN');
      const d = await cl.query('SELECT * FROM mayor_bill_drafts WHERE id = $1 FOR UPDATE', [id]);
      const now = this.clock();
      await expirePendingDrafts(cl, now);
      if (!d.rows[0]) throw new MayorLawError('No such draft.');
      const fresh = await cl.query('SELECT * FROM mayor_bill_drafts WHERE id = $1', [id]);
      if (!fresh.rows[0] || fresh.rows[0].status !== 'pending_approval') throw new MayorLawError('That draft is no longer waiting for approval.');
      const m = await cl.query('SELECT * FROM mayor_terms WHERE starts_at <= $1 AND ends_at > $1 AND removed_at IS NULL ORDER BY starts_at DESC LIMIT 1 FOR SHARE', [now]);
      if (!m.rows[0] || m.rows[0].player_key !== playerKey(name)) throw new MayorLawError('Only the sitting mayor may approve a vice mayor’s draft.');
      if (m.rows[0].player_key === fresh.rows[0].vice_key) throw new MayorLawError('You can’t approve your own draft.');
      await cl.query('SELECT value FROM mayor_bill_counter WHERE id = 1 FOR UPDATE');
      const day = abDate(now);
      if ((await cl.query('SELECT number FROM mayor_bills WHERE day = $1', [day])).rows.length) throw new MayorLawError('The city has already submitted a bill today (America/Regina).');
      const c = await cl.query('UPDATE mayor_bill_counter SET value = value + 1 WHERE id = 1 RETURNING value');
      const number = String(c.rows[0].value);
      const bill = await cl.query('INSERT INTO mayor_bills (number, day, text, by_name, mayor_key, term_week, at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [number, day, fresh.rows[0].text, m.rows[0].name, m.rows[0].player_key, m.rows[0].week, now]);
      await cl.query("UPDATE mayor_bill_drafts SET status = 'approved', approved_at = $2, approved_by_name = $3, approved_by_key = $4, approved_bill_number = $5 WHERE id = $1 AND status = 'pending_approval'", [id, now, m.rows[0].name, m.rows[0].player_key, number]);
      await cl.query('COMMIT');
      return { bill: { ...rowLaw(bill.rows[0]), draftedBy: String(fresh.rows[0].by_name), approvedBy: String(m.rows[0].name) } };
    } catch (e) { await cl.query('ROLLBACK'); throw e; }
    finally { cl.release(); }
  }
  async rejectDraft(name: string, value: unknown, reason?: unknown): Promise<{ bill: MayorLaw }> {
    let id: string; let why: string | null;
    try { id = parseDraftId(value); why = lawRejectReason(reason); } catch (e) { throw new MayorLawError((e as Error).message); }
    const cl = await this.pool.connect();
    try {
      await cl.query('BEGIN');
      const d = await cl.query('SELECT * FROM mayor_bill_drafts WHERE id = $1 FOR UPDATE', [id]);
      const now = this.clock();
      await expirePendingDrafts(cl, now);
      if (!d.rows[0]) throw new MayorLawError('No such draft.');
      const fresh = await cl.query('SELECT * FROM mayor_bill_drafts WHERE id = $1', [id]);
      if (!fresh.rows[0] || fresh.rows[0].status !== 'pending_approval') throw new MayorLawError('That draft is no longer waiting for approval.');
      const m = await cl.query('SELECT * FROM mayor_terms WHERE starts_at <= $1 AND ends_at > $1 AND removed_at IS NULL ORDER BY starts_at DESC LIMIT 1 FOR SHARE', [now]);
      if (!m.rows[0] || m.rows[0].player_key !== playerKey(name)) throw new MayorLawError('Only the sitting mayor may reject a vice mayor’s draft.');
      if (m.rows[0].player_key === fresh.rows[0].vice_key) throw new MayorLawError('You can’t reject your own draft.');
      const r = await cl.query("UPDATE mayor_bill_drafts SET status = 'rejected', rejected_at = $2, rejected_by_name = $3, rejected_by_key = $4, reject_reason = $5 WHERE id = $1 AND status = 'pending_approval' RETURNING *", [id, now, m.rows[0].name, m.rows[0].player_key, why]);
      await cl.query('COMMIT'); return { bill: { ...rowDraft(r.rows[0]), approvedBy: String(m.rows[0].name) } };
    } catch (e) { await cl.query('ROLLBACK'); throw e; }
    finally { cl.release(); }
  }

  /** Admin-only: mark a pending official bill Denied with a public reason. Original text stays immutable. No economy effect. */
  async deny(value: unknown, reason: unknown): Promise<{ bill: MayorLaw; already: boolean }> {
    let number: string; let why: string;
    try { number = parseBillNumber(value); why = lawDenyReason(reason); } catch (e) { throw new MayorLawError((e as Error).message); }
    const cl = await this.pool.connect();
    try {
      await cl.query('BEGIN');
      const b = await cl.query('SELECT * FROM mayor_bills WHERE number = $1 FOR UPDATE', [number]);
      const now = this.clock();
      if (!b.rows[0]) throw new MayorLawError('No such bill.');
      if (implementationOf(b.rows[0])) throw new MayorLawError('This bill has been implemented with revised wording. It is not a pending bill; changing the active rules requires a new implementation.');
      if (b.rows[0].status === 'vetoed') throw new MayorLawError('This bill has already been vetoed.');
      if (b.rows[0].status === 'denied') { await cl.query('COMMIT'); return { bill: rowLaw(b.rows[0]), already: true }; }
      const r = await cl.query("UPDATE mayor_bills SET status = 'denied', denied_at = $2, deny_reason = $3 WHERE number = $1 AND status = 'pending' RETURNING *", [number, now, why]);
      await cl.query("INSERT INTO mayor_bill_events (number, kind, role, by_name, by_key, term_week, at) VALUES ($1, 'denied', 'admin', 'admin', 'admin', $2, $3)", [number, b.rows[0].term_week, now]);
      await cl.query('COMMIT'); return { bill: rowLaw(r.rows[0]), already: false };
    } catch (e) { await cl.query('ROLLBACK'); throw e; }
    finally { cl.release(); }
  }

}
