import pg from 'pg';
import { PgCasinoStore } from '../../server/casino-store';
const u = new URL(process.env.BACKTAX_TEST_DATABASE_URL!);
if (!['127.0.0.1','localhost','[::1]'].includes(u.hostname)) throw new Error('Local test database only');
const pool = new pg.Pool({connectionString:u.toString()});
try { console.log('RESULT '+JSON.stringify(await new PgCasinoStore(pool).apply({name:'Payer',game:'admin_refund',amount:10,key:'os-frozen-credit',memo:'Back tax refund',balance:0,at:Date.now()},'payer'))); }
finally { await pool.end(); }
