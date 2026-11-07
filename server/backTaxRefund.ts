/** Explicit, authenticated full back-tax refunds. No boot writes and no historical assessment replay.
 * The existing wallet store commits balance increment + UNIQUE ledger key atomically. That ledger row IS the
 * durable per-original-debit refund marker. Never clear original payment rows or claw back tax-share recipients.
 */
import { createHash } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { adminAuthorized } from './admin.js';
import { databaseUrl } from './leaderboard-store.js';
import { PgCasinoStore, getBank } from './casino-store.js';

export const REFUND_GAME = 'property_backtax_refund_v1';
export const refundKey = (id: string) => `backtax_refund_v1:${id}`;
export const REFUND_CONFIRM = 'REFUND ONE VERIFIED BACKTAX DEBIT IN FULL';
type LedgerRow = { id: string; tx_key: string | null; player_key: string; name: string; game: string; amount: string; memo: string | null; created_at: Date | string };
export type RefundPool = Pick<pg.Pool, 'query' | 'connect'>;
export class RefundConflict extends Error {}
const positiveInteger = (v: unknown) => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new RefundConflict('Unsafe/nonpositive ledger amount'); return n; };
const validId = (v: unknown): v is string => typeof v === 'string' && /^[1-9][0-9]*$/.test(v);

export async function auditBackTaxRefunds(pool: Pick<pg.Pool, 'query'>) {
  // One statement/snapshot. Include every original actual debit, our markers (even malformed), any possible earlier
  // back-tax compensation, and all admin credits to affected players for manual prior-compensation review.
  const rows = (await pool.query<LedgerRow>(`SELECT id::text, tx_key, player_key, name, game, amount::text, memo, created_at
    FROM wallet_transactions WHERE (game = 'property_backtax' AND amount < 0)
      OR game = $1 OR tx_key LIKE 'backtax_refund_v1:%'
      OR (amount > 0 AND game <> 'property_backtax_share' AND
        (game ~* 'back[ _-]*tax' OR COALESCE(memo,'') ~* 'back[ _-]*tax' OR COALESCE(tx_key,'') ~* 'back[ _-]*tax'))
      OR (amount > 0 AND game IN ('admin','admin_refund') AND player_key IN
        (SELECT player_key FROM wallet_transactions WHERE game = 'property_backtax' AND amount < 0))
    ORDER BY id`, [REFUND_GAME])).rows.map(r => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
  const sources = rows.filter(r => r.game === 'property_backtax' && Number(r.amount) < 0);
  const blockers: string[] = [];
  const payments = sources.map(r => {
    const amount = positiveInteger(-Number(r.amount));
    const marker = rows.find(x => x.tx_key === refundKey(r.id));
    if (marker && (marker.game !== REFUND_GAME || marker.player_key !== r.player_key || Number(marker.amount) !== amount)) blockers.push(`Refund marker mismatch for debit ${r.id}`);
    const components = /Property back-tax: ([\d,]+) surcharge \+ ([\d,]+) wealth tax/.exec(r.memo ?? '');
    return { sourceId: r.id, sourceKey: r.tx_key, playerKey: r.player_key, name: r.name, amount, memo: r.memo, paidAt: r.created_at,
      components: components ? { surcharge: Number(components[1]!.replaceAll(',', '')), wealthTax: Number(components[2]!.replaceAll(',', '')) } : null,
      refundKey: refundKey(r.id), refunded: !!marker };
  });
  const priorCredits = rows.filter(r => Number(r.amount) > 0 && !sources.includes(r) && r.game !== REFUND_GAME && !r.tx_key?.startsWith('backtax_refund_v1:'));
  for (const r of priorCredits) if (/back[ _-]*tax/i.test(`${r.game} ${r.memo ?? ''} ${r.tx_key ?? ''}`)) blockers.push(`Possible prior compensation ledger ${r.id}; requires explicit reconciliation, not an automatic second refund`);
  for (const r of rows.filter(r => r.game === REFUND_GAME || r.tx_key?.startsWith('backtax_refund_v1:'))) {
    if (!payments.some(p => p.refundKey === r.tx_key)) blockers.push(`Orphan/malformed refund marker ${r.id}`);
  }
  const unclassifiedAdminCreditIds = priorCredits.filter(r => !/back[ _-]*tax/i.test(`${r.game} ${r.memo ?? ''} ${r.tx_key ?? ''}`)).map(r => r.id);
  const pending = payments.filter(p => !p.refunded);
  const totalPending = pending.reduce((n, p) => n + p.amount, 0);
  if (!Number.isSafeInteger(totalPending)) throw new RefundConflict('Unsafe aggregate amount');
  const manifestHash = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  return { policy: 'Full actual property_backtax debits, no recipient clawbacks; unpaid historical debt canceled', manifestHash,
    payments, priorCredits, unclassifiedAdminCreditIds, blockers, pendingCount: pending.length, totalPending };
}

/** One original debit per explicit reviewed manifest, not a blind bulk/grant loop. Safe to retry after any lost response.
 * Session advisory lock serializes operators across processes; UNIQUE wallet tx_key remains the atomic backstop.
 * Wallet write uses PgCasinoStore.apply: no direct/absolute balance SQL in this migration.
 */
export async function refundOneBackTax(pool: RefundPool, sourceId: unknown, expectedHash: unknown, confirm: unknown,
  refresh: (name: string) => Promise<unknown> = async () => {}, reviewedUnrelatedCreditIds: unknown = []) {
  if (!validId(sourceId) || typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash) || confirm !== REFUND_CONFIRM) throw new RefundConflict('Exact sourceId, reviewed manifestHash and confirmation required');
  const lock = await pool.connect();
  let acquired = false;
  try {
    const claimed = await lock.query("SELECT pg_try_advisory_lock(hashtext('property-backtax-refund-v1')) AS acquired");
    acquired = claimed.rows[0]?.acquired === true;
    if (!acquired) throw new RefundConflict('Another refund operator is active; obtain a fresh audit and retry later');
    const audit = await auditBackTaxRefunds(pool);
    if (audit.manifestHash !== expectedHash) throw new RefundConflict('Manifest changed; audit and review again');
    if (audit.blockers.length) throw new RefundConflict(audit.blockers.join('; '));
    if (!Array.isArray(reviewedUnrelatedCreditIds) || reviewedUnrelatedCreditIds.some(id => !validId(id)) ||
      JSON.stringify([...new Set(reviewedUnrelatedCreditIds)].sort()) !== JSON.stringify([...audit.unclassifiedAdminCreditIds].sort())) {
      throw new RefundConflict('Review all prior admin credits; provide exact reviewedUnrelatedCreditIds only after proving they are unrelated to back-tax');
    }
    const source = audit.payments.find(p => p.sourceId === sourceId);
    if (!source) throw new RefundConflict('Not an actual paid back-tax debit');
    if (source.refunded) return { ok: true, applied: false, sourceId, key: source.refundKey };
    const store = new PgCasinoStore(pool);
    if (await store.chipsOf(source.playerKey) === null) throw new RefundConflict('Original payer has no persistent wallet; manual investigation required');
    let applied = false;
    try {
      const result = await store.apply({ name: source.name, amount: source.amount, game: REFUND_GAME, key: source.refundKey,
        memo: `Full back-tax refund; source ${sourceId}; reviewed manifest ${expectedHash}`, balance: 0, at: Date.now() }, source.playerKey);
      applied = result.ok;
      if (!result.ok && result.reason !== 'duplicate') throw new Error('Wallet refused refund');
    } catch {
      // A thrown COMMIT is NOT evidence of rollback. Read the durable marker on a fresh pooled connection.
      // If database is unreachable, leave outcome explicitly unknown and retry with a NEW audit after recovery.
      const check = await pool.query('SELECT player_key, amount, game FROM wallet_transactions WHERE tx_key = $1', [source.refundKey]).catch(() => null);
      if (!check) throw new Error('Refund outcome unknown; do not compensate manually; audit after recovery');
      if (!check.rows.length) throw new Error('Refund not confirmed; retry only after fresh audit');
      if (check.rows[0].player_key !== source.playerKey || Number(check.rows[0].amount) !== source.amount || check.rows[0].game !== REFUND_GAME) throw new Error('Refund marker mismatch; stop');
      applied = true;
    }
    const verified = await auditBackTaxRefunds(pool);
    if (!verified.payments.find(p => p.sourceId === sourceId)?.refunded || verified.blockers.length) throw new Error('Refund post-write verification failed; audit before retry');
    // Only refresh cached wallet after durable success. A cache refresh failure never reverses a real credit.
    let cacheRefreshed = true; try { await refresh(source.name); } catch { cacheRefreshed = false; }
    return { ok: true, applied, sourceId, key: source.refundKey, amount: source.amount, cacheRefreshed, manifestHash: verified.manifestHash };
  } finally {
    // A failed unlock must not return a still-locked session to the pool.
    if (!acquired) { lock.release(); }
    else try { await lock.query("SELECT pg_advisory_unlock(hashtext('property-backtax-refund-v1'))"); lock.release(); }
    catch { lock.release(true); }
  }
}

let pool: pg.Pool | null = null;
export function backTaxRefundRouter(): express.Router {
  const router = express.Router();
  const db = () => { const url = databaseUrl(); if (!url) throw new Error('Persistent wallet database unavailable'); return pool ??= new pg.Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 10_000 }); };
  router.get('/api/admin/backtax-refunds/audit', async (req, res) => {
    if (!adminAuthorized(req.get('authorization'))) return res.status(401).json({ ok: false, error: 'Unauthorized.' });
    res.set('Cache-Control', 'no-store');
    try { return res.json({ ok: true, ...await auditBackTaxRefunds(db()) }); }
    catch { return res.status(503).json({ ok: false, error: 'Could not audit persistent ledger; no refunds executed.' }); }
  });
  router.post('/api/admin/backtax-refunds/refund-one', express.json({ limit: '2kb' }), async (req, res) => {
    if (!adminAuthorized(req.get('authorization'))) return res.status(401).json({ ok: false, error: 'Unauthorized.' });
    res.set('Cache-Control', 'no-store');
    try {
      if (!getBank().ready) return res.status(503).json({ ok: false, error: 'Wallet unavailable.' });
      const { sourceId, manifestHash, confirm, reviewedUnrelatedCreditIds } = req.body ?? {};
      return res.json(await refundOneBackTax(db(), sourceId, manifestHash, confirm, name => getBank().refresh(name), reviewedUnrelatedCreditIds));
    } catch (e) { return res.status(e instanceof RefundConflict ? 409 : 503).json({ ok: false, error: (e as Error).message }); }
  });
  return router;
}
