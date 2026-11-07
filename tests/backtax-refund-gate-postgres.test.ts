/** Actual HTTP grant race, actual queued CasinoBank write, PostgreSQL trigger backstop and cache-read failure. */
import { expect, it } from 'vitest';
import pg from 'pg';
import express from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { adminRouter } from '../server/admin';
import { resetAccounts, getAccounts } from '../server/accounts';
import { PgCasinoStore, resetBank, type WalletTx, type StatDelta } from '../server/casino-store';
import { auditBackTaxRefunds, refundOneBackTax, backTaxRefundRouter, REFUND_CONFIRM, refundKey, type RefundPool } from '../server/backTaxRefund';
import { setAdminCreditGate, adminCreditGateStatus, adminCreditAdmission, FREEZE_CONFIRM, THAW_CONFIRM } from '../server/adminCreditGate';
import { dropDrainedTestDatabase } from './fixtures/drain-postgres-db';
const run=promisify(execFile), url=process.env.BACKTAX_TEST_DATABASE_URL;
const TOKEN='synthetic-admin-refund-gate-token-01234567890123456789';
const defer=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
it.skipIf(!url)('real PostgreSQL: enforced freeze defeats HTTP/queued/raw/OS admin refund races; drains existing writers; truthful failed cache confirmation',async()=>{
 const u=new URL(url!);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw new Error('Local test DB only');
 const root=new pg.Client({connectionString:url});await root.connect();const db=`tax_refund_gate_${process.pid}_${Date.now()}`;await root.query(`CREATE DATABASE ${db}`);
 const du=new URL(u);du.pathname='/'+db;const pool=new pg.Pool({connectionString:du.toString(),max:10});
 const queued=defer(),release=defer(),queuedLate=defer(),releaseLate=defer();let cacheDown=false,queuedAttempts=0,lateAttempts=0;
 class Controlled extends PgCasinoStore {
  override async chipsOf(k:string){if(cacheDown)throw new Error('actual injected cache read failure');return super.chipsOf(k);}
  override async apply(tx:WalletTx,key:string,stats:StatDelta={},opts:{existingWalletOnly?:boolean}={}){
   if(tx.key==='queued-race'){queuedAttempts++;queued.resolve();await release.promise;}
   if(tx.key==='queued-after-thaw'){lateAttempts++;queuedLate.resolve();await releaseLate.promise;}
   return super.apply(tx,key,stats,opts);
  }
 }
 const wallet=new PgCasinoStore(pool),controlled=new Controlled(pool);await wallet.init();
 const bank=resetBank();bank.retryMs=[1,2];
 resetAccounts();await getAccounts().claim('Payer','synthetic-test-password','local-test');
 const originalToken=process.env.ADMIN_GRANT_TOKEN;process.env.ADMIN_GRANT_TOKEN=TOKEN;
 const app=express();app.use(adminRouter());app.use(backTaxRefundRouter(pool));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const address=server.address() as {port:number};const base=`http://127.0.0.1:${address.port}`;
 const post=async(path:string,body:unknown)=>{const r=await fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+TOKEN,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 const chips=async()=>Number((await pool.query("SELECT chips FROM casino_players WHERE player_key='payer'")).rows[0].chips);
 const pay=async(key:string)=>{await wallet.apply({name:'Payer',game:'property_backtax',amount:-10,key,balance:0,at:Date.now(),memo:'Property back-tax: 8 surcharge + 2 wealth tax'},'payer');return String((await pool.query('SELECT id FROM wallet_transactions WHERE tx_key=$1',[key])).rows[0].id);};
 try {
  await wallet.apply({name:'Payer',game:'seed',amount:100,key:'seed',balance:0,at:Date.now()},'payer');const first=await pay('source-one');await bank.attach(controlled);
  let audit=await auditBackTaxRefunds(pool);
  await expect(refundOneBackTax(pool,first,audit.manifestHash,REFUND_CONFIRM)).rejects.toThrow(/route locked/);
  // No credit route can run on an audit-only deployment before an explicit protected database freeze.
  expect(await chips()).toBe(1090);
  expect((await post('/api/admin/backtax-refunds/gate',{action:'freeze',confirm:'wrong'})).status).toBe(409);
  expect((await auditBackTaxRefunds(pool)).gate.installed).toBe(false);
  const freeze=await post('/api/admin/backtax-refunds/gate',{action:'freeze',confirm:FREEZE_CONFIRM});expect(freeze.status).toBe(200);expect(freeze.body).toMatchObject({gate:{frozen:true,protected:true},localQueueDrained:true});
  await pool.query('ALTER TABLE wallet_transactions DISABLE TRIGGER backtax_admin_credit_guard');
  audit=await auditBackTaxRefunds(pool);expect(audit.gate.protected).toBe(false);
  await expect(refundOneBackTax(pool,first,audit.manifestHash,REFUND_CONFIRM)).rejects.toThrow(/route locked/);
  await pool.query('ALTER TABLE wallet_transactions ENABLE ALWAYS TRIGGER backtax_admin_credit_guard');
  audit=await auditBackTaxRefunds(pool);cacheDown=true;
  const receipt=await post('/api/admin/backtax-refunds/refund-one',{sourceId:first,manifestHash:audit.manifestHash,confirm:REFUND_CONFIRM});
  expect(receipt.status).toBe(200);expect(receipt.body).toMatchObject({ok:true,applied:true,cacheRefreshed:false,amount:10});
  expect(bank.account('Payer').chips).toBe(1090);expect(await chips()).toBe(1100);
  audit=await auditBackTaxRefunds(pool);expect(audit.payments.find(p=>p.sourceId===first)?.refunded).toBe(true);
  expect((await post('/api/admin/backtax-refunds/refund-one',{sourceId:first,manifestHash:audit.manifestHash,confirm:REFUND_CONFIRM})).body.applied).toBe(false);expect(await chips()).toBe(1100);
  cacheDown=false;expect((await bank.refreshConfirmed('Payer')).ok).toBe(true);
  // Independent OS process uses the same DB guard; no process-local freeze can fake this protection.
  const child=await run('npx',['tsx','tests/fixtures/backtax-gate-pg-step.ts'],{env:{...process.env,BACKTAX_TEST_DATABASE_URL:du.toString()}});
  expect(JSON.parse(child.stdout.split('\n').find(x=>x.startsWith('RESULT '))!.slice(7))).toMatchObject({ok:false,reason:'admin_frozen'});
  expect((await pool.query("SELECT 1 FROM wallet_transactions WHERE tx_key='os-frozen-credit'")).rows).toHaveLength(0);
  // Ordinary earnings and negative admin movements are not frozen.
  expect((await wallet.apply({name:'Payer',game:'chess',amount:3,key:'ordinary',balance:0,at:Date.now()},'payer')).ok).toBe(true);
  expect((await wallet.apply({name:'Payer',game:'admin',amount:-1,key:'ordinary-admin-debit',balance:0,at:Date.now()},'payer')).ok).toBe(true);
  await setAdminCreditGate(pool,'thaw',THAW_CONFIRM);
  expect((await post('/api/admin/grant',{player:'Payer',amount:7,key:'prior-unrelated',memo:'Unrelated synthetic grant'})).body.applied).toBe(true);
  const second=await pay('source-two');await bank.refresh('Payer');
  // Actual admin HTTP handler passes open check and queues its write BEFORE freeze, but has not hit Postgres.
  const queuedGrant=post('/api/admin/grant',{player:'Payer',amount:10,key:'queued-race',memo:'Back tax refund'});await queued.promise;
  await setAdminCreditGate(pool,'freeze',FREEZE_CONFIRM);audit=await auditBackTaxRefunds(pool);
  expect(audit.unclassifiedAdminCreditIds).toHaveLength(1);
  const before=await chips();let grantReceipt:Awaited<typeof queuedGrant>|undefined,intercept=false;
  const racePool={connect:pool.connect.bind(pool),query:async(sql:string,args?:unknown[])=>{
   if(!intercept&&sql.startsWith('SELECT chips FROM casino_players')){intercept=true;release.resolve();grantReceipt=await queuedGrant;}
   return pool.query(sql,args);
  }} as unknown as RefundPool;
  const result=await refundOneBackTax(racePool,second,audit.manifestHash,REFUND_CONFIRM,async n=>(await bank.refreshConfirmed(n)).ok,audit.unclassifiedAdminCreditIds);
  expect(result).toMatchObject({ok:true,applied:true,cacheRefreshed:true});expect(grantReceipt?.status).toBe(423);expect(queuedAttempts).toBe(1);
  expect(await chips()).toBe(before+10);expect((await pool.query("SELECT 1 FROM wallet_transactions WHERE tx_key='queued-race'")).rows).toHaveLength(0);
  expect((await pool.query('SELECT amount FROM wallet_transactions WHERE tx_key=$1',[refundKey(second)])).rows.map(x=>Number(x.amount))).toEqual([10]);
  // Legacy atomic writer bypassing all new application prechecks still cannot commit its competing credit.
  const third=await pay('source-three');audit=await auditBackTaxRefunds(pool);let raw=false;
  const rawPool={connect:pool.connect.bind(pool),query:async(sql:string,args?:unknown[])=>{
   if(!raw&&sql.startsWith('SELECT chips FROM casino_players')){raw=true;const c=await pool.connect();try{await c.query('BEGIN');await c.query("UPDATE casino_players SET chips=chips+10 WHERE player_key='payer'");await expect(c.query("INSERT INTO wallet_transactions(tx_key,player_key,name,game,amount,balance,memo) VALUES('raw-race','payer','Payer','admin_refund',10,0,'Back tax refund')")).rejects.toMatchObject({code:'PBT01'});await c.query('ROLLBACK');}finally{c.release();}}
   return pool.query(sql,args);
  }} as unknown as RefundPool;
  const rawBefore=await chips();await refundOneBackTax(rawPool,third,audit.manifestHash,REFUND_CONFIRM,async()=>false,audit.unclassifiedAdminCreditIds);expect(await chips()).toBe(rawBefore+10);
  // A thaw cannot slip between final manifest validation and the credit: it uses the same mutex.
  const fourth=await pay('source-four');audit=await auditBackTaxRefunds(pool);let thawed=false,thaw:Promise<unknown>|undefined,thawIntercept=false;
  const thawPool={connect:pool.connect.bind(pool),query:async(sql:string,args?:unknown[])=>{
   if(!thawIntercept&&sql.startsWith('SELECT chips FROM casino_players')){thawIntercept=true;thaw=setAdminCreditGate(pool,'thaw',THAW_CONFIRM).then(x=>{thawed=true;return x;});await pool.query('SELECT pg_sleep(0.03)');expect(thawed).toBe(false);expect((await adminCreditGateStatus(pool)).frozen).toBe(true);}
   return pool.query(sql,args);
  }} as unknown as RefundPool;
  await refundOneBackTax(thawPool,fourth,audit.manifestHash,REFUND_CONFIRM,async()=>false,audit.unclassifiedAdminCreditIds);await thaw;expect(thawed).toBe(true);
  // Even a queued request delayed until AFTER thaw cannot reuse its pre-freeze admission epoch.
  const lateSource=await pay('source-late-queue');await bank.refreshConfirmed('Payer');
  const lateGrant=post('/api/admin/grant',{player:'Payer',amount:10,key:'queued-after-thaw',memo:'Back tax refund'});await queuedLate.promise;
  await setAdminCreditGate(pool,'freeze',FREEZE_CONFIRM);audit=await auditBackTaxRefunds(pool);const lateBefore=await chips();
  await refundOneBackTax(pool,lateSource,audit.manifestHash,REFUND_CONFIRM,async()=>false,audit.unclassifiedAdminCreditIds);
  await setAdminCreditGate(pool,'thaw',THAW_CONFIRM);releaseLate.resolve();expect((await lateGrant).status).toBe(409);expect(lateAttempts).toBe(1);
  expect(await chips()).toBe(lateBefore+10);expect((await pool.query("SELECT 1 FROM wallet_transactions WHERE tx_key='queued-after-thaw'")).rows).toHaveLength(0);
  expect((await post('/api/admin/grant',{player:'Payer',amount:5,key:'fresh-after-thaw',memo:'Unrelated fresh synthetic grant'})).body.applied).toBe(true);
  // Freeze drains an already-open ledger writer that passed the SHARE guard, then its compensation is reviewed.
  const fifth=await pay('source-five'),c=await pool.connect();await c.query('BEGIN');await c.query("SELECT set_config('chudhub.admin_credit_generation',$1,true)",[(await adminCreditAdmission(pool)).generation]);await c.query("UPDATE casino_players SET chips=chips+10 WHERE player_key='payer'");await c.query("INSERT INTO wallet_transactions(tx_key,player_key,name,game,amount,balance,memo) VALUES('before-freeze','payer','Payer','admin',10,0,'Back tax refund')");
  let froze=false;const freezing=setAdminCreditGate(pool,'freeze',FREEZE_CONFIRM).then(x=>{froze=true;return x;});await pool.query('SELECT pg_sleep(0.03)');expect(froze).toBe(false);await c.query('COMMIT');c.release();await freezing;
  audit=await auditBackTaxRefunds(pool);expect(audit.blockers.join(' ')).toMatch(/prior compensation/);
  await expect(refundOneBackTax(pool,fifth,audit.manifestHash,REFUND_CONFIRM,async()=>false,audit.unclassifiedAdminCreditIds)).rejects.toThrow(/prior compensation/);
  expect((await pool.query('SELECT 1 FROM wallet_transactions WHERE tx_key=$1',[refundKey(fifth)])).rows).toHaveLength(0);
  expect((await pool.query("SELECT count(*)::int n FROM wallet_transactions WHERE game='property_backtax' AND amount=-10")).rows[0].n).toBe(6);
 } finally {
  release.resolve();releaseLate.resolve();await bank.flush();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));resetBank();resetAccounts();
  if(originalToken===undefined)delete process.env.ADMIN_GRANT_TOKEN;else process.env.ADMIN_GRANT_TOKEN=originalToken;
  await dropDrainedTestDatabase(root,pool,db);
 }
},120_000);
