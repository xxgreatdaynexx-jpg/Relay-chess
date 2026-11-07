import type pg from 'pg';
import { abDate } from '../shared/mayor.js';
import { lawText, lawTitle, type MayorLaw, type MayorLawView } from '../shared/mayorLaws.js';
import { playerKey } from './skins.js';

export class MayorLawError extends Error {}

export const MAYOR_LAWS_MIGRATION = `
CREATE TABLE IF NOT EXISTS mayor_bill_counter (id INTEGER PRIMARY KEY CHECK (id = 1), value BIGINT NOT NULL);
INSERT INTO mayor_bill_counter (id, value) VALUES (1, 0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS mayor_bills (number BIGINT PRIMARY KEY, day TEXT NOT NULL UNIQUE, text TEXT NOT NULL, by_name TEXT NOT NULL, mayor_key TEXT NOT NULL, term_week TEXT NOT NULL, at BIGINT NOT NULL, approved_at BIGINT, approved_by TEXT);
ALTER TABLE mayor_bills ADD COLUMN IF NOT EXISTS approved_at BIGINT;
ALTER TABLE mayor_bills ADD COLUMN IF NOT EXISTS approved_by TEXT;
`;
const rowLaw = (r: Record<string, unknown>): MayorLaw => ({ number: String(r.number), title: lawTitle(String(r.number)), text: String(r.text), by: String(r.by_name), at: Number(r.at), day: String(r.day), status: r.approved_at == null ? 'pending' : 'approved', approvedAt: r.approved_at == null ? null : Number(r.approved_at) });
export class MayorLaws {
  constructor(private readonly pool: pg.Pool, private readonly clock = () => Date.now()) {}
  async init() { await this.pool.query(MAYOR_LAWS_MIGRATION); }
  async history(before?: unknown): Promise<MayorLawView> {
    if (before !== undefined && (typeof before !== 'string' || !/^[1-9]\d*$/.test(before) || before.length > 19 || BigInt(before) > 9223372036854775807n)) throw new MayorLawError('Invalid bill history cursor.');
    const r = before === undefined
      ? await this.pool.query('SELECT * FROM mayor_bills ORDER BY number DESC LIMIT 101')
      : await this.pool.query('SELECT * FROM mayor_bills WHERE number < $1 ORDER BY number DESC LIMIT 101', [before]);
    const history = r.rows.slice(0, 100).map(rowLaw);
    const today = await this.pool.query('SELECT number FROM mayor_bills WHERE day = $1', [abDate(this.clock())]);
    return { history, nextBefore: r.rows.length > 100 ? history[99]!.number : null, passedToday: today.rows.length > 0 };
  }
  async pass(name: string, value: unknown): Promise<{ bill: MayorLaw }> {
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
      if ((await cl.query('SELECT number FROM mayor_bills WHERE day = $1', [day])).rows.length) throw new MayorLawError('The city has already passed a bill today (America/Regina).');
      const c = await cl.query('UPDATE mayor_bill_counter SET value = value + 1 WHERE id = 1 RETURNING value');
      const number = String(c.rows[0].value);
      const r = await cl.query('INSERT INTO mayor_bills (number, day, text, by_name, mayor_key, term_week, at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [number, day, text, m.rows[0].name, m.rows[0].player_key, m.rows[0].week, now]);
      await cl.query('COMMIT'); return { bill: rowLaw(r.rows[0]) };
    } catch (e) { await cl.query('ROLLBACK'); throw e; }
    finally { cl.release(); }
  }
}
