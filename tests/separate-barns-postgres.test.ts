import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import pg from 'pg';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { setPriceIndexForTest } from '../server/price-index';
import { barnFarms } from '../shared/barnFarms';
import { propertyById, taxOf } from '../shared/realEstate';
const url=process.env.MAYOR_LAWS_TEST_DATABASE_URL;let root:pg.Client,pool:pg.Pool,db='';let bank:CasinoBank,re:RealEstate;const T=Date.parse('2026-11-07T18:00:00-06:00');let now=T;
beforeAll(async()=>{if(!url)return;const u=new URL(url);if(!['localhost','127.0.0.1'].includes(u.hostname))throw Error('local test DB only');db=`separatebarn_${process.pid}_${Date.now()}`;root=new pg.Client({connectionString:url});await root.connect();await root.query(`CREATE DATABASE ${db}`);u.pathname='/'+db;pool=new pg.Pool({connectionString:u.toString()});bank=new CasinoBank();await bank.attach(new PgCasinoStore(pool));re=new RealEstate(pool,()=>bank,()=>now);await re.init();await pool.query(`CREATE TABLE farm_tiles(plot_id TEXT,tile INT,owner_key TEXT,crop TEXT,planted_at BIGINT,nonce TEXT);CREATE TABLE farm_upgrades(plot_id TEXT,kind TEXT,owner_key TEXT,level INT);CREATE TABLE farm_fert(plot_id TEXT,tile INT,nonce TEXT,kind TEXT);`);});
afterAll(async()=>{if(!url)return;await bank.flush();await pool.end();await root.query(`DROP DATABASE ${db}`);await root.end();});
beforeEach(async()=>{if(!url)return;await bank.flush();await pool.query('TRUNCATE properties,property_tax,wallet_transactions,casino_players');bank=new CasinoBank();bank.retryMs=[];await bank.attach(new PgCasinoStore(pool));re=new RealEstate(pool,()=>bank,()=>now);now=T;setPriceIndexForTest(1);});
async function fund(n:string,chips=100000){bank.transfer(n,chips-bank.account(n).chips,{game:'test'});await bank.flush();}
describe.skipIf(!url)('independent barn deeds durable PostgreSQL',()=>{
 it('Jay keeps farm10, another player can purchase its separate barn; restart preserves both and only paid barn unlocks',async()=>{
  await fund('Jay');await fund('Buyer');await re.buy('Jay','f:10');expect(barnFarms('Jay',await re.owned()).unlocked).toBe(false);
  const q=await re.quote('Buyer','barn:district:1');expect(q.list).toBe(17500);expect(q.price).toBe(17500);await re.buy('Buyer','barn:district:1',q.price);
  expect(await re.ownerOf('f:10')).toMatchObject({name:'Jay'});expect(await re.ownerOf('barn:district:1')).toMatchObject({name:'Buyer'});
  const reboot=new RealEstate(pool,()=>bank,()=>now);await reboot.init();expect(barnFarms('Buyer',await reboot.owned()).unlocked).toBe(true);expect(barnFarms('Jay',await reboot.owned()).unlocked).toBe(false);
 });
 it('concurrent buyers have exactly one owner/debit; normal stale-quote and insufficient-wallet guards remain',async()=>{
  await fund('A');await fund('B');const rs=await Promise.allSettled([re.buy('A','barn:country:23',7000),re.buy('B','barn:country:23',7000)]);expect(rs.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  expect((await pool.query("SELECT * FROM wallet_transactions WHERE game='property_buy'")).rows).toHaveLength(1);
  await expect(re.buy('A','barn:district:2',1)).rejects.toThrow(/price changed/);await fund('Poor',1);await expect(re.buy('Poor','barn:big:1003')).rejects.toThrow(/Not enough chips/);
 });
 it('owner-authenticated sellback revokes only barn unlock and preserves neighboring farm, crop and inventory rows',async()=>{
  await fund('Jay');await re.buy('Jay','f:20');const q=await re.quote('Jay','barn:district:2');await re.buy('Jay','barn:district:2',q.price);
  await pool.query("INSERT INTO farm_tiles VALUES('f:20',1,'jay','wheat',$1,'crop-proof')",[T]);
  await expect(re.sell('Other','barn:district:2')).rejects.toThrow();await re.sell('Jay','barn:district:2');
  expect(barnFarms('Jay',await re.owned()).unlocked).toBe(false);expect(await re.ownerOf('f:20')).toMatchObject({name:'Jay'});expect((await pool.query("SELECT * FROM farm_tiles WHERE nonce='crop-proof'")).rows).toHaveLength(1);
 });
 it('normal daily property tax claims once; only the new barn deed is charged',async()=>{
  await fund('A');await re.buy('A','barn:country:2');now+=86400000;await re.runTax();await re.runTax();
  const rows=(await pool.query("SELECT amount FROM wallet_transactions WHERE game='property_tax'")).rows;expect(rows).toHaveLength(1);expect(Number(rows[0].amount)).toBe(-taxOf(propertyById('barn:country:2')!.price));
 });
});
