/** Real local Postgres only; private disposable DB, never touches shared instance data. */
import { expect, it } from 'vitest';
import pg from 'pg';
import { dropDrainedTestDatabase } from './fixtures/drain-postgres-db';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { auditBackTaxRefunds, refundOneBackTax, REFUND_CONFIRM, REFUND_GAME, refundKey, type RefundPool } from '../server/backTaxRefund';
import { PgCasinoStore } from '../server/casino-store';
import { setAdminCreditGate, FREEZE_CONFIRM, THAW_CONFIRM, adminCreditAdmission } from '../server/adminCreditGate';
const run = promisify(execFile);
const url = process.env.BACKTAX_TEST_DATABASE_URL;
it.skipIf(!url)('real PostgreSQL full back-tax refund: partial payments, durable keys, two processes, restart, prior compensation, lost COMMIT, rollback and stale manifest', async () => {
  const rootUrl = new URL(url!); if (!['localhost','127.0.0.1','[::1]'].includes(rootUrl.hostname)) throw new Error('Disposable local DB only');
  const name = `tax_refund_${process.pid}_${Date.now()}`;
  const root = new pg.Client({ connectionString: url }); await root.connect(); await root.query(`CREATE DATABASE ${name}`);
  const testUrl = new URL(rootUrl); testUrl.pathname = '/'+name;
  const pool = new pg.Pool({ connectionString: testUrl.toString(), max: 6 });
  const wallet = new PgCasinoStore(pool); await wallet.init();
  const step = async (id: string, hash?: string) => {
    const { stdout } = await run('npx',['tsx','tests/fixtures/backtax-refund-pg-step.ts',id,...(hash?[hash]:[])],{ env: { ...process.env, BACKTAX_TEST_DATABASE_URL: testUrl.toString() } });
    return JSON.parse(stdout.split('\n').find(l=>l.startsWith('RESULT '))!.slice(7));
  };
  const balance = async () => Number((await pool.query("SELECT chips FROM casino_players WHERE player_key='payer'")).rows[0].chips);
  const pay = async (key: string, amount: number) => {
    await wallet.apply({ name:'Payer', game:'property_backtax', amount:-amount, key, balance:0, at:Date.now(), memo:`Property back-tax: ${amount-5} surcharge + 5 wealth tax` },'payer');
    return String((await pool.query('SELECT id FROM wallet_transactions WHERE tx_key=$1',[key])).rows[0].id);
  };
  try {
    await wallet.apply({ name:'Payer',game:'test_fund',amount:100_000,key:'seed',balance:0,at:Date.now() },'payer');
    const a = await pay('partial:a',20_005), b = await pay('partial:b',17); // actual partial debits, not assessments
    await wallet.apply({name:'Recipient',game:'property_backtax_share',amount:5,key:'share:a',balance:0,at:Date.now()},'recipient');
    await pool.query("UPDATE casino_players SET name = 'Current Payer' WHERE player_key = 'payer'");
    const before = await balance();
    await setAdminCreditGate(pool, 'freeze', FREEZE_CONFIRM);
    let audit = await auditBackTaxRefunds(pool);
    expect(audit.payments.map(p=>p.amount)).toEqual([20_005,17]); expect(audit.totalPending).toBe(20_022);
    expect(audit.payments[0]!.components).toEqual({surcharge:20_000,wealthTax:5}); expect(audit.blockers).toEqual([]);
    expect(await balance()).toBe(before); // audit is read-only
    await expect(refundOneBackTax(pool,a,audit.manifestHash,'WRONG')).rejects.toThrow(/confirmation/);
    await expect(refundOneBackTax(pool,'999999',audit.manifestHash,REFUND_CONFIRM)).rejects.toThrow(/actual paid/);
    // Independent processes use same reviewed manifest. One credits, the other refuses stale review.
    const results = await Promise.all([step(a,audit.manifestHash),step(a,audit.manifestHash)]);
    expect(results.filter(r=>r.ok && r.applied)).toHaveLength(1); expect(await balance()).toBe(before+20_005);
    expect((await pool.query("SELECT name FROM casino_players WHERE player_key='payer'")).rows[0].name).toBe('Current Payer');
    expect((await step(a)).applied).toBe(false); // fresh process/restart
    await expect(refundOneBackTax(pool,b,audit.manifestHash,REFUND_CONFIRM)).rejects.toThrow(/Manifest changed/);
    audit = await auditBackTaxRefunds(pool); await refundOneBackTax(pool,b,audit.manifestHash,REFUND_CONFIRM);
    expect(await balance()).toBe(before+20_022);
    expect(Number((await pool.query("SELECT chips FROM casino_players WHERE player_key='recipient'")).rows[0].chips)).toBe(1005); // no clawback
    expect(Number((await pool.query("SELECT SUM(-amount) total FROM wallet_transactions WHERE game='property_backtax' AND amount<0")).rows[0].total)).toBe(20_022); // originals intact
    // Lost COMMIT acknowledgement after DB really commits. Existing atomic wallet row is the marker.
    const c = await pay('lost-ack',33); let lose = true;
    const lost = { query: pool.query.bind(pool), connect: async () => {
      const cl=await pool.connect();return { query: async (sql: string,args?: unknown[]) => {
        const r=await cl.query(sql,args); if (sql==='COMMIT' && lose) {lose=false;throw new Error('lost COMMIT acknowledgement');} return r;
      }, release: cl.release.bind(cl) };
    }} as unknown as RefundPool;
    const preLost=await balance(); audit=await auditBackTaxRefunds(pool);
    expect((await refundOneBackTax(lost,c,audit.manifestHash,REFUND_CONFIRM)).applied).toBe(true);
    expect(await balance()).toBe(preLost+33); expect((await step(c)).applied).toBe(false);
    // Commit lands while both acknowledgement and reconciliation read fail. No invented rollback or compensation.
    const unknownId = await pay('unknown-commit',37); let disconnected = false;
    const unknown = { query: async (sql: string,args?: unknown[]) => {
      if (disconnected && sql.startsWith('SELECT player_key, amount, game')) throw new Error('DB temporarily unreachable');
      return pool.query(sql,args);
    }, connect: async () => { const cl=await pool.connect(); return {
      query: async (sql: string,args?: unknown[]) => { const r=await cl.query(sql,args); if(sql==='COMMIT' && !disconnected){disconnected=true;throw new Error('lost ack');}return r; },
      release: cl.release.bind(cl)
    }; }} as unknown as RefundPool;
    const preUnknown=await balance(); audit=await auditBackTaxRefunds(pool);
    await expect(refundOneBackTax(unknown,unknownId,audit.manifestHash,REFUND_CONFIRM)).rejects.toThrow(/outcome unknown/);
    expect(await balance()).toBe(preUnknown+37); expect((await step(unknownId)).applied).toBe(false);
    // SQL failure after UPDATE but before ledger INSERT must roll wallet back; no marker and safe retry.
    const d = await pay('rollback',41); const preFail=await balance();
    await pool.query(`CREATE FUNCTION reject_refund() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.game = '${REFUND_GAME}' THEN RAISE EXCEPTION 'injected refund failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_refund BEFORE INSERT ON wallet_transactions FOR EACH ROW EXECUTE FUNCTION reject_refund()`);
    audit=await auditBackTaxRefunds(pool);
    await expect(refundOneBackTax(pool,d,audit.manifestHash,REFUND_CONFIRM)).rejects.toThrow(/not confirmed/);
    expect(await balance()).toBe(preFail); expect((await pool.query('SELECT 1 FROM wallet_transactions WHERE tx_key=$1',[refundKey(d)])).rows).toHaveLength(0);
    await pool.query('DROP TRIGGER reject_refund ON wallet_transactions; DROP FUNCTION reject_refund()');
    expect((await step(d)).applied).toBe(true); expect(await balance()).toBe(preFail+41);
    // Even if a payer disappears after the service's initial existence read, the atomic wallet credit must not
    // recreate it with default starting chips. The existing-only mode also preserves current wallet names.
    await expect(wallet.apply({name:'Missing',game:REFUND_GAME,amount:12,key:'orphan-refund',balance:0,at:Date.now()},'missing',{}, {existingWalletOnly:true})).rejects.toThrow(/Existing payer wallet/);
    expect((await pool.query("SELECT 1 FROM casino_players WHERE player_key='missing'")).rows).toHaveLength(0);
    expect((await pool.query("SELECT 1 FROM wallet_transactions WHERE tx_key='orphan-refund'")).rows).toHaveLength(0);
    await pool.query("INSERT INTO casino_players(player_key,name,chips) VALUES('integer-boundary','Boundary',9007199254740991)");
    await expect(wallet.apply({name:'Boundary',game:REFUND_GAME,amount:1,key:'unsafe-refund',balance:0,at:Date.now()},'integer-boundary',{}, {existingWalletOnly:true})).rejects.toThrow(/safe wallet integer range/);
    expect((await pool.query("SELECT chips::text FROM casino_players WHERE player_key='integer-boundary'")).rows[0].chips).toBe('9007199254740991');
    expect((await pool.query("SELECT 1 FROM wallet_transactions WHERE tx_key='unsafe-refund'")).rows).toHaveLength(0);
    // Generic admin credits require an explicit manifest-bound review, not an assumed absence of prior refunds.
    await setAdminCreditGate(pool, 'thaw', THAW_CONFIRM);
    await wallet.apply({name:'Payer',game:'admin',adminGateGeneration:(await adminCreditAdmission(pool)).generation,amount:7,key:'other-admin-credit',balance:0,at:Date.now(),memo:'Unrelated test grant'},'payer');
    const genericId=await pay('generic-review',11); await setAdminCreditGate(pool, 'freeze', FREEZE_CONFIRM); audit=await auditBackTaxRefunds(pool);
    await expect(refundOneBackTax(pool,genericId,audit.manifestHash,REFUND_CONFIRM)).rejects.toThrow(/Review all prior admin/);
    expect((await refundOneBackTax(pool,genericId,audit.manifestHash,REFUND_CONFIRM,async()=>{throw new Error('cache unavailable');},audit.unclassifiedAdminCreditIds)).cacheRefreshed).toBe(false);
    // Ambiguous old compensation blocks ALL new execution (no silent double refund).
    const e=await pay('earlier-compensation',29);
    await setAdminCreditGate(pool, 'thaw', THAW_CONFIRM);
    await wallet.apply({name:'Payer',game:'admin',adminGateGeneration:(await adminCreditAdmission(pool)).generation,amount:29,key:'old-refund',balance:0,at:Date.now(),memo:'Back tax refund'},'payer');
    await setAdminCreditGate(pool, 'freeze', FREEZE_CONFIRM);
    audit=await auditBackTaxRefunds(pool); expect(audit.blockers.join(' ')).toMatch(/prior compensation/);
    await expect(refundOneBackTax(pool,e,audit.manifestHash,REFUND_CONFIRM)).rejects.toThrow(/prior compensation/);
  } finally { await dropDrainedTestDatabase(root, pool, name); }
},60_000);
