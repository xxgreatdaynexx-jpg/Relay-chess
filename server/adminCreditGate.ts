/** Temporary, DB-enforced positive admin-credit barrier for audited back-tax refunds.
 * Ledger trigger covers queued/legacy atomic writers too; ordinary economy/debits are not gated.
 * Gate row SHARE locks drain transactions which already passed the guard before freeze can commit.
 */
import { randomUUID } from 'node:crypto';
export const ADMIN_CREDIT_FROZEN = 'PBT01';
export const REFUND_LOCK = 'property-backtax-refund-v1';
export const FREEZE_CONFIRM = 'FREEZE ADMIN CREDITS FOR BACKTAX REFUNDS';
export const THAW_CONFIRM = 'RESUME ORDINARY ADMIN CREDITS';
type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: any[] }> };
type Pool = Q & { connect: () => Promise<Q & { release: (destroy?: boolean) => void }> };
export const GATE_BODY = `DECLARE blocked boolean; epoch text;
BEGIN
  IF NEW.amount > 0 AND NEW.game IN ('admin', 'admin_refund') THEN
    SELECT frozen, generation INTO blocked, epoch FROM backtax_admin_credit_gate WHERE singleton = 1 FOR SHARE;
    IF blocked IS DISTINCT FROM false OR current_setting('chudhub.admin_credit_generation', true) IS DISTINCT FROM epoch THEN
      RAISE EXCEPTION 'Admin credit frozen or admission invalidated by audited back-tax refund gate' USING ERRCODE = 'PBT01';
    END IF;
  END IF;
  RETURN NEW;
END;`;
export async function adminCreditAdmission(db: Q): Promise<{ open: boolean; generation: string }> {
  try { const r = await db.query('SELECT frozen, generation FROM backtax_admin_credit_gate WHERE singleton = 1'); return r.rows.length === 1 ? { open: r.rows[0].frozen === false, generation: String(r.rows[0].generation) } : { open: false, generation: '' }; }
  catch (e) { if ((e as { code?: string }).code === '42P01') return { open: true, generation: '' }; throw e; }
}
export async function adminCreditsOpen(db: Q): Promise<boolean> {
  try { const r = await db.query('SELECT frozen FROM backtax_admin_credit_gate WHERE singleton = 1'); return r.rows.length === 1 && r.rows[0].frozen === false; }
  catch (e) { if ((e as { code?: string }).code === '42P01') return true; throw e; } // no refund window installed yet
}
export async function adminCreditGateStatus(db: Q) {
  const absent = { installed: false, frozen: false, generation: '', protected: false };
  try {
    const exists = await db.query("SELECT to_regclass('backtax_admin_credit_gate') AS name");
    if (!exists.rows[0]?.name) return absent;
    const r = await db.query(`SELECT g.frozen, g.generation,
      EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
        WHERE t.tgrelid='wallet_transactions'::regclass AND t.tgname='backtax_admin_credit_guard'
        AND t.tgenabled='A' AND t.tgtype=7 AND t.tgqual IS NULL AND t.tgnargs=0 AND NOT t.tgisinternal AND p.prosrc=$1) AS protected
      FROM backtax_admin_credit_gate g WHERE singleton=1`, [GATE_BODY]);
    return r.rows.length === 1 ? { installed: true, frozen: r.rows[0].frozen === true, generation: String(r.rows[0].generation), protected: r.rows[0].protected === true } : absent;
  } catch (e) { if ((e as { code?: string }).code === '42P01') return absent; throw e; }
}
/** Explicit operator action only. Not a boot migration; audit is read-only. DDL transaction drains prior ledger
 * writers before installing the trigger. Later freezes drain existing SHARE holders by updating the gate row.
 * Same advisory mutex as refund execution prevents thaw/reconfiguration during a validated credit operation.
 */
export async function setAdminCreditGate(pool: Pool, action: unknown, confirm: unknown) {
  if ((action !== 'freeze' && action !== 'thaw') || confirm !== (action === 'freeze' ? FREEZE_CONFIRM : THAW_CONFIRM)) throw new Error('Exact gate action and confirmation required');
  const cl = await pool.connect();
  try {
    await cl.query('BEGIN');
    await cl.query('SELECT pg_advisory_xact_lock(hashtext($1))', [REFUND_LOCK]);
    const state = await adminCreditGateStatus(cl);
    if (!state.protected) {
      // Table-level DDL lock drains all already-entered ledger INSERT transactions before activation.
      await cl.query('LOCK TABLE wallet_transactions IN SHARE ROW EXCLUSIVE MODE');
      await cl.query(`CREATE TABLE IF NOT EXISTS backtax_admin_credit_gate (singleton integer PRIMARY KEY CHECK(singleton=1), frozen boolean NOT NULL, generation text NOT NULL);
        INSERT INTO backtax_admin_credit_gate VALUES (1,false,'initial') ON CONFLICT DO NOTHING`);
      await cl.query(`CREATE OR REPLACE FUNCTION backtax_admin_credit_guard_fn() RETURNS trigger LANGUAGE plpgsql AS $gate$${GATE_BODY}$gate$`);
      await cl.query(`DROP TRIGGER IF EXISTS backtax_admin_credit_guard ON wallet_transactions;
        CREATE TRIGGER backtax_admin_credit_guard BEFORE INSERT ON wallet_transactions FOR EACH ROW EXECUTE FUNCTION backtax_admin_credit_guard_fn();
        ALTER TABLE wallet_transactions ENABLE ALWAYS TRIGGER backtax_admin_credit_guard`);
    }
    await cl.query('UPDATE backtax_admin_credit_gate SET frozen=$1, generation=$2 WHERE singleton=1', [action === 'freeze', randomUUID()]);
    const result = await adminCreditGateStatus(cl);
    if (!result.protected || result.frozen !== (action === 'freeze')) throw new Error('Gate activation verification failed');
    await cl.query('COMMIT');
    return result;
  } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; }
  finally { cl.release(); }
}
