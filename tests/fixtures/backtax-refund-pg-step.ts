import pg from 'pg';
import { auditBackTaxRefunds, refundOneBackTax, REFUND_CONFIRM } from '../../server/backTaxRefund.js';
const u = new URL(process.env.BACKTAX_TEST_DATABASE_URL!);
if (!['127.0.0.1','localhost','[::1]'].includes(u.hostname)) throw new Error('Local test DB only');
const pool = new pg.Pool({ connectionString: u.toString(), max: 4 });
try {
  const [id, hash] = process.argv.slice(2);
  const result = await refundOneBackTax(pool, id, hash ?? (await auditBackTaxRefunds(pool)).manifestHash, REFUND_CONFIRM);
  console.log('RESULT '+JSON.stringify(result));
} catch (e) { console.log('RESULT '+JSON.stringify({ ok: false, error: (e as Error).message })); }
finally { await pool.end(); }
