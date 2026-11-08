import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import pg from 'pg';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { PropertyIncome } from '../server/propertyIncome';
import { setPriceIndexForTest } from '../server/price-index';
import { PROPERTY_PAYBACK_MS as WEEK } from '../shared/propertyIncome';
import { propertyById, taxOf } from '../shared/realEstate';
const url=process.env.MAYOR_LAWS_TEST_DATABASE_URL;
let root:pg.Client,pool:pg.Pool,db='';let bank:CasinoBank,re:RealEstate;
const T=Date.parse('2026-11-07T20:30:00-06:00');let now=T;
const gas='b:gas:600:1600',warehouse='lm:warehouse';
beforeAll(async()=>{
 if(!url)return;const u=new URL(url);if(!['localhost','127.0.0.1'].includes(u.hostname))throw Error('isolated LOCAL test database only');
 db=`propertyincome_${process.pid}_${Date.now()}`;root=new pg.Client({connectionString:url});await root.connect();await root.query(`CREATE DATABASE ${db}`);u.pathname='/'+db;
 pool=new pg.Pool({connectionString:u.toString(),max:12});bank=new CasinoBank();await bank.attach(new PgCasinoStore(pool));re=new RealEstate(pool,()=>bank,()=>now);await re.init();
 await pool.query(`CREATE TABLE farm_tiles(plot_id TEXT,tile INT,owner_key TEXT,crop TEXT,planted_at BIGINT,nonce TEXT);CREATE TABLE farm_upgrades(plot_id TEXT,kind TEXT,owner_key TEXT,level INT);CREATE TABLE farm_fert(plot_id TEXT,tile INT,nonce TEXT,kind TEXT);`);
});
afterAll(async()=>{if(!url)return;await bank.flush();await pool.end();await root.query(`DROP DATABASE ${db}`);await root.end();});
beforeEach(async()=>{if(!url)return;await bank.flush();await pool.query('TRUNCATE properties,property_tax,property_income,property_income_activation,wallet_transactions,casino_players');now=T;bank=new CasinoBank();bank.retryMs=[];await bank.attach(new PgCasinoStore(pool));re=new RealEstate(pool,()=>bank,()=>now);await re.init();setPriceIndexForTest(1);});
async function fund(name:string,n=10000000){bank.transfer(name,n-bank.account(name).chips,{game:'test'});await bank.flush();}
async function own(id=gas,name='A',cost=60000,at=T){await fund(name);await pool.query('INSERT INTO properties(id,owner_key,owner_name,price,bought_at,deed) VALUES($1,$2,$3,$4,$5,$6)',[id,name.toLowerCase(),name,cost,at,`${name}-${at}`]);}
async function earnings(name='A'){return Number((await pool.query("SELECT COALESCE(SUM(amount),0) n FROM wallet_transactions WHERE game='property_income' AND player_key=$1",[name.toLowerCase()])).rows[0].n);}
async function balance(name='A'){return Number((await pool.query('SELECT chips FROM casino_players WHERE player_key=$1',[name.toLowerCase()])).rows[0].chips);}
describe.skipIf(!url)('business income real PostgreSQL atomic durability',()=>{
 it('existing owners activate only at durable cutover; seven days repay actual paid cost, not current indexed list; restart retains clock',async()=>{
  await own(gas,'A',150001,T-WEEK*10);await re.runIncome();expect(await earnings()).toBe(0);
  now=T+WEEK;setPriceIndexForTest(3);const reboot=new RealEstate(pool,()=>bank,()=>now);await reboot.init();await reboot.runIncome();expect(await earnings()).toBe(150001);
  expect(Number((await pool.query('SELECT started_at FROM property_income_activation')).rows[0].started_at)).toBe(T);
  now+=WEEK;await re.runIncome();expect(await earnings()).toBe(300002);expect(Number((await pool.query('SELECT basis FROM property_income')).rows[0].basis)).toBe(150001);
 });
 it('fractional entitlement survives repeated tiny ticks, restart and backward clock without drift or duplicate ledger entries',async()=>{
  await own(gas,'A',17);for(let i=1;i<=29;i++){now=T+Math.floor(WEEK*i/30);await re.runIncome();}
  const r2=new RealEstate(pool,()=>bank,()=>now);await r2.init();now=T+WEEK;await r2.runIncome();expect(await earnings()).toBe(17);
  now-=WEEK/2;await r2.runIncome();expect(await earnings()).toBe(17);now=T+WEEK;await r2.runIncome();expect(await earnings()).toBe(17);
 });
 it('multiple instances and concurrent ticks credit one cumulative entitlement only',async()=>{
  await own();now+=WEEK;const bank2=new CasinoBank();await bank2.attach(new PgCasinoStore(pool));const other=new RealEstate(pool,()=>bank2,()=>now);await other.init();await Promise.all([re.runIncome(),other.runIncome(),re.runIncome()]);
  expect(await earnings()).toBe(60000);expect((await pool.query("SELECT * FROM wallet_transactions WHERE game='property_income'")).rows).toHaveLength(1);
 });
 it('ledger failure rolls back wallet and checkpoint together; retry pays once',async()=>{
  await own();now+=WEEK;
  await pool.query(`CREATE FUNCTION reject_income() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.game='property_income' THEN RAISE EXCEPTION 'test ledger failure'; END IF; RETURN NEW; END$$; CREATE TRIGGER reject_income BEFORE INSERT ON wallet_transactions FOR EACH ROW EXECUTE FUNCTION reject_income();`);
  const before=await balance();await expect(re.runIncome()).rejects.toThrow(/test ledger failure/);expect(await balance()).toBe(before);expect(await earnings()).toBe(0);expect((await pool.query('SELECT * FROM property_income')).rows).toHaveLength(0);
  await pool.query('DROP TRIGGER reject_income ON wallet_transactions; DROP FUNCTION reject_income()');await re.runIncome();expect(await earnings()).toBe(60000);
 });
 it('failed sale rolls back income, refund and checkpoint; retry settles once without losing goods or ownership',async()=>{
  await own();now+=WEEK/2;const before=await balance();
  await pool.query(`CREATE FUNCTION reject_sale() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.game='property_sell' THEN RAISE EXCEPTION 'test sale failure'; END IF; RETURN NEW; END$$; CREATE TRIGGER reject_sale BEFORE INSERT ON wallet_transactions FOR EACH ROW EXECUTE FUNCTION reject_sale();`);
  await expect(re.sell('A',gas)).rejects.toThrow();expect(await earnings()).toBe(0);expect(await balance()).toBe(before);expect(await re.ownerOf(gas)).toMatchObject({key:'a'});
  await pool.query('DROP TRIGGER reject_sale ON wallet_transactions; DROP FUNCTION reject_sale()');await re.sell('A',gas);expect(await earnings()).toBe(30000);expect(await balance()).toBe(before+72000);
 });
 it('an income failure cannot halt unrelated property taxes or repossess an unsettled business',async()=>{
  await own(gas,'A',60000,T-86400000);await own('barn:country:2','B',7000,T-86400000);now+=86400000;
  await pool.query(`CREATE FUNCTION reject_business() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.game='property_income' THEN RAISE EXCEPTION 'test defer'; END IF; RETURN NEW; END$$; CREATE TRIGGER reject_business BEFORE INSERT ON wallet_transactions FOR EACH ROW EXECUTE FUNCTION reject_business();`);
  await re.runTax();expect((await pool.query("SELECT property_id FROM property_tax")).rows.map(r=>r.property_id)).toEqual(['barn:country:2']);expect(await re.ownerOf(gas)).toMatchObject({key:'a'});
  await pool.query('DROP TRIGGER reject_business ON wallet_transactions; DROP FUNCTION reject_business()');await re.runTax();expect((await pool.query('SELECT * FROM property_tax')).rows).toHaveLength(2);expect(await earnings()).toBe(Math.floor(60000/7));
 });
 it('lost commit acknowledgement followed by restart never duplicates a durable credit',async()=>{
  await own();now+=WEEK;let lose=true;
  const wrapped={query:pool.query.bind(pool),connect:async()=>{const cl=await pool.connect();return new Proxy(cl,{get(target,key){if(key==='query')return async(...args:any[])=>{const r=await (target.query as any)(...args);if(args[0]==='COMMIT'&&lose){lose=false;throw Error('test lost COMMIT reply');}return r;};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});}} as unknown as pg.Pool;
  const income=new PropertyIncome(wrapped,()=>now);await expect(income.run()).rejects.toThrow(/lost COMMIT/);expect(await earnings()).toBe(60000);
  const reboot=new RealEstate(pool,()=>bank,()=>now);await reboot.init();await reboot.runIncome();expect(await earnings()).toBe(60000);
 });
 it('sale settles seller through sale time atomically; no income while unowned or inherited new-owner backpay',async()=>{
  await own();now+=WEEK/2;const before=await balance();const sold=await re.sell('A',gas);expect(sold.chips).toBe(42000);expect(await earnings()).toBe(30000);expect(await balance()).toBe(before+72000);
  now+=WEEK;await re.runIncome();expect(await earnings()).toBe(30000);await fund('B');await re.buy('B',gas);const bAt=now;
  await re.runIncome();expect(await earnings('B')).toBe(0);now=bAt+WEEK;await re.runIncome();expect(await earnings('B')).toBe(60000);expect(await earnings()).toBe(30000);
 });
 it('concurrent tick/sale pays seller once, and another player cannot sell or receive the income',async()=>{
  await own();await fund('Other');now+=WEEK;await expect(re.sell('Other',gas)).rejects.toThrow(/do not own/);
  await Promise.all([re.runIncome(),re.sell('A',gas)]);expect(await earnings()).toBe(60000);expect(await earnings('Other')).toBe(0);
 });
 it('warehouse hostile buyout settles prior owner; new owner rate uses actual buyout cost from new ownership time',async()=>{
  await own(warehouse,'A',500000);await fund('B');now+=WEEK;await re.buyout('B',warehouse);expect(await earnings()).toBe(500000);await re.runIncome();expect(await earnings('B')).toBe(0);
  now+=WEEK;await re.runIncome();expect(await earnings('B')).toBe(1000000);expect(await earnings()).toBe(500000);
 });
 it('new normal purchases use canonical surcharged acquisition price, not tax or guessed base price',async()=>{
  await own('f:10','A',10000);now+=12345;const q=await re.quote('A',gas);const bought=await re.buy('A',gas,q.price);expect(bought.price).toBe(66000);
  await re.runIncome();expect(await earnings()).toBe(0);now+=WEEK;await re.runIncome();expect(await earnings()).toBe(66000);
 });
 it('normal property tax stays exactly once and unchanged; income has no separate deductions; repossession ends ownership clock',async()=>{
  await own(gas,'A',60000,T-86400000);now=T+WEEK;await re.runTax();await re.runTax();expect(await earnings()).toBe(60000);
  const taxes=(await pool.query("SELECT amount FROM wallet_transactions WHERE game='property_tax'")).rows;expect(taxes).toHaveLength(1);expect(Number(taxes[0].amount)).toBe(-taxOf(60000));
  expect((await pool.query("SELECT * FROM wallet_transactions WHERE game='property_income' AND amount < 0")).rows).toHaveLength(0);
  await pool.query("UPDATE properties SET arrears=2 WHERE id=$1",[gas]);await pool.query("UPDATE casino_players SET chips=0 WHERE player_key='a'");now+=86400000;
  // An exceptionally high independent mayor/tax policy is not needed: use a second ordinary non-income deed for repo guard.
  await own('barn:country:2','Poor',7000,T-86400000);await pool.query("UPDATE properties SET arrears=2 WHERE owner_key='poor'");await pool.query("UPDATE casino_players SET chips=0 WHERE player_key='poor'");
  await re.runTax();expect(await re.ownerOf('barn:country:2')).toBeNull();expect(await re.ownerOf(gas)).not.toBeNull();
 });
 it('business repossession pays only through the cutoff and never resurrects the old clock while unowned',async()=>{
  await own(gas,'A',1,T-86400000);await pool.query("UPDATE properties SET arrears=2 WHERE id=$1",[gas]);await pool.query("UPDATE casino_players SET chips=0 WHERE player_key='a'");
  now+=86400000;await re.runTax();expect(await re.ownerOf(gas)).toBeNull();expect(await earnings()).toBe(0);now+=WEEK*2;await re.runIncome();expect(await earnings()).toBe(0);
 });
 it('jail and harbour follow existing quote/buy/owner-only-sell/tax paths and never earn business income',async()=>{
  for(const id of ['lm:jail','lm:harbour']){await fund('ServiceBuyer');const q=await re.quote('ServiceBuyer',id);const b=await re.buy('ServiceBuyer',id,q.price);expect(b.price).toBe(q.price);expect(await re.ownerOf(id)).toMatchObject({key:'servicebuyer'});await expect(re.sell('Intruder',id)).rejects.toThrow();now+=86400000;await re.runTax();expect(await earnings('ServiceBuyer')).toBe(0);await re.sell('ServiceBuyer',id);expect(await re.ownerOf(id)).toBeNull();}
 });
 it('no owner means no income; unrelated farm/barn rows and crop/inventory tables are not touched',async()=>{
  await re.runIncome();expect((await pool.query('SELECT * FROM property_income')).rows).toHaveLength(0);await own('f:10');await pool.query("INSERT INTO farm_tiles VALUES('f:10',1,'a','wheat',$1,'preserved')",[T]);const crops=(await pool.query('SELECT * FROM farm_tiles')).rows;
  now+=WEEK;await re.runIncome();expect(await earnings()).toBe(0);expect((await pool.query('SELECT * FROM farm_tiles')).rows).toEqual(crops);expect(await re.ownerOf('f:10')).toMatchObject({key:'a'});
 });
});
