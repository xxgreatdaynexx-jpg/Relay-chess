import type pg from 'pg';
import { implementationOf } from './billImplementations.js';
import { abDate } from '../shared/mayor.js';
import { lawText, lawTitle, parseBillNumber, type MayorLaw, type MayorLawView } from '../shared/mayorLaws.js';
import { playerKey } from './skins.js';

export class MayorLawError extends Error {}

export const MAYOR_LAWS_MIGRATION = `
CREATE TABLE IF NOT EXISTS mayor_bill_counter (id INTEGER PRIMARY KEY CHECK (id = 1), value BIGINT NOT NULL);
INSERT INTO mayor_bill_counter (id, value) VALUES (1, 0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS mayor_bills (number BIGINT PRIMARY KEY, day TEXT NOT NULL UNIQUE, text TEXT NOT NULL, by_name TEXT NOT NULL, mayor_key TEXT NOT NULL, term_week TEXT NOT NULL, at BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
ALTER TABLE mayor_bills ADD COLUMN IF NOT EXISTS vetoed_at BIGINT, ADD COLUMN IF NOT EXISTS vetoed_by_name TEXT, ADD COLUMN IF NOT EXISTS vetoed_by_key TEXT, ADD COLUMN IF NOT EXISTS vetoed_term_week TEXT, ADD COLUMN IF NOT EXISTS vetoed_role TEXT;
ALTER TABLE mayor_bills DROP CONSTRAINT IF EXISTS mayor_bills_status_check;
ALTER TABLE mayor_bills ADD CONSTRAINT mayor_bills_status_check CHECK (
  (status = 'pending' AND vetoed_at IS NULL AND vetoed_by_name IS NULL AND vetoed_by_key IS NULL AND vetoed_term_week IS NULL AND vetoed_role IS NULL)
  OR (status = 'vetoed' AND vetoed_at IS NOT NULL AND vetoed_by_name IS NOT NULL AND vetoed_by_key IS NOT NULL AND vetoed_term_week IS NOT NULL AND vetoed_role IN ('mayor', 'vice')));
CREATE TABLE IF NOT EXISTS mayor_bill_events (id BIGSERIAL PRIMARY KEY, number BIGINT NOT NULL REFERENCES mayor_bills(number), kind TEXT NOT NULL CHECK (kind = 'vetoed'), role TEXT NOT NULL CHECK (role IN ('mayor', 'vice')), by_name TEXT NOT NULL, by_key TEXT NOT NULL, term_week TEXT NOT NULL, at BIGINT NOT NULL, UNIQUE (number, kind));
`;
/** Database-enforced permanence; real PostgreSQL only (in-memory pg-mem unit DB cannot run plpgsql). */
export const MAYOR_LAWS_GUARDS = `
CREATE OR REPLACE FUNCTION mayor_bills_guard() RETURNS trigger LANGUAGE plpgsql AS $g$
BEGIN
  IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'mayor bills are permanent records'; END IF;
  IF NEW.number IS DISTINCT FROM OLD.number OR NEW.day IS DISTINCT FROM OLD.day OR NEW.text IS DISTINCT FROM OLD.text
     OR NEW.by_name IS DISTINCT FROM OLD.by_name OR NEW.mayor_key IS DISTINCT FROM OLD.mayor_key
     OR NEW.term_week IS DISTINCT FROM OLD.term_week OR NEW.at IS DISTINCT FROM OLD.at
     OR NOT (OLD.status = 'pending' AND NEW.status = 'vetoed') THEN
    RAISE EXCEPTION 'mayor bill records are immutable except pending -> vetoed';
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
const rowLaw = (r: Record<string, unknown>): MayorLaw => ({ number: String(r.number), title: lawTitle(String(r.number)), text: String(r.text), by: String(r.by_name), at: Number(r.at), day: String(r.day),
  status: r.status === 'vetoed' ? 'vetoed' : 'pending', vetoedBy: r.vetoed_by_name == null ? null : String(r.vetoed_by_name), vetoedAt: r.vetoed_at == null ? null : Number(r.vetoed_at), vetoedRole: r.vetoed_role === 'vice' ? 'vice' : r.vetoed_role === 'mayor' ? 'mayor' : null, ...(implementationOf(r) ? { implementation: implementationOf(r) } : {}) });
export class MayorLaws {
  constructor(private readonly pool: pg.Pool, private readonly clock = () => Date.now()) {}
  async init() {
    let inMemory = false;
    try { await this.pool.query('SELECT version()'); } catch (e) { inMemory = /pg-mem/i.test(String((e as Error).message) + JSON.stringify((e as { data?: unknown }).data ?? '')); if (!inMemory) throw e; }
    // pg-mem unit DB cannot run plpgsql; every real PostgreSQL gets the permanence guards.
    if (inMemory) { await this.pool.query(MAYOR_LAWS_MIGRATION); return; }
    // One implicit transaction; advisory lock serializes concurrent instance boots.
    await this.pool.query(`SELECT pg_advisory_xact_lock(74210611);${MAYOR_LAWS_MIGRATION}${MAYOR_LAWS_GUARDS}`);
  }
  async history(before?: unknown): Promise<MayorLawView> {
    if (before !== undefined && (typeof before !== 'string' || !/^[1-9]\d*$/.test(before) || before.length > 19 || BigInt(before) > 9223372036854775807n)) throw new MayorLawError('Invalid bill history cursor.');
    const r = before === undefined
      ? await this.pool.query('SELECT * FROM mayor_bills ORDER BY number DESC LIMIT 101')
      : await this.pool.query('SELECT * FROM mayor_bills WHERE number < $1 ORDER BY number DESC LIMIT 101', [before]);
    const history = r.rows.slice(0, 100).map(rowLaw);
    const today = await this.pool.query('SELECT number FROM mayor_bills WHERE day = $1', [abDate(this.clock())]);
    return { history, nextBefore: r.rows.length > 100 ? history[99]!.number : null, submittedToday: today.rows.length > 0 };
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
}
