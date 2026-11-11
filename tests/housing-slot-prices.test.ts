import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import baseline from './fixtures/housing-price-baseline.json';
import { properties, propertyById, workerBonusOf, workerBonusTotal, isEmployeeHousing, landPrice, sellBackOf, taxOf } from '../shared/realEstate';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { RealEstate } from '../server/realEstate';
import { Employment, EMPLOY_MIGRATION } from '../server/employment';
import { HOMES_MIGRATION } from '../server/homes';
import { setPriceIndexForTest, px } from '../server/price-index';
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const T=Date.parse('2026-11-07T21:32:00-06:00');
function shim(db:PGlite){
 let chain=Promise.resolve();
 const query=async(sql:string,args?:unknown[])=>{const r=args?.length?await db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[],affectedRows:0};return{rows:r.rows as Record<string,unknown>[],rowCount:(r as {affectedRows?:number}).affectedRows??r.rows.length};};
 return{query,on:()=>{},connect:async()=>{let release!:()=>void;const before=chain;chain=new Promise<void>(r=>{release=r;});await before;return{query,release};}};
}
afterEach(()=>setPriceIndexForTest(1));

describe('housing price per actual employee capacity',()=>{
 it('all city/countryside/resort homes retain exact pre-change slots; 1/2/3 slots cost10k/20k/30k; 4 slots untouched',()=>{
  const luxury=(p:{id:string})=>/^(sky|isl):/.test(p.id);
  const hs=properties().filter(p=>isEmployeeHousing(p)&&!luxury(p));expect(hs).toHaveLength(401);
  for(const old of baseline.housing){const p=propertyById(old.id)!;expect(workerBonusOf(p.id),p.id).toBe(old.slots);expect(p.price,p.id).toBe(old.slots<=3?old.slots*10000:old.price);

  }
  expect(hash(hs.map(({price:_price,housingEmployees:_employees,...geometry})=>geometry))).toBe(baseline.housingGeometryHash);
  expect(hs.filter(p=>workerBonusOf(p.id)>3)).toHaveLength(14);
  expect(hs.filter(p=>workerBonusOf(p.id)===1)).toHaveLength(286);
  expect(hs.filter(p=>workerBonusOf(p.id)===2)).toHaveLength(80);
  expect(hs.filter(p=>workerBonusOf(p.id)===3)).toHaveLength(21);
  // Size/type do not override the real bonus: some row houses have1slot; one apartment has3.
  expect(hs.some(p=>p.type==='rowhouse'&&workerBonusOf(p.id)===1&&p.price===10000)).toBe(true);
  expect(hs.some(p=>p.type==='apartment'&&workerBonusOf(p.id)===3&&p.price===30000)).toBe(true);
 });
 it('nonhousing catalog is byte-for-byte unchanged; same complete housing identity set',()=>{
  const added=new Set(['cf:1008','cf:1009','cf:1010','cf:1011','barn:big:1008','barn:big:1009','barn:big:1010','barn:big:1011']);
  const luxury=new Set(['sky:1','sky:2','sky:3','sky:4','sky:5','sky:6','isl:1','isl:2','isl:3','isl:4']);
  expect(hash(properties().filter(p=>!isEmployeeHousing(p)&&!added.has(p.id)).map(({tiles:_tiles,...p})=>p))).toBe(baseline.nonHousingHash); // Bill Chud 1 adds only derived plot tile counts (cols×rows); new northern Big Farms and their barns are additive
  expect(properties().filter(p=>isEmployeeHousing(p)&&!luxury.has(p.id)).map(p=>p.id)).toEqual(baseline.housing.map(p=>p.id));
  expect([...luxury].every(id=>isEmployeeHousing(propertyById(id)!))).toBe(true);
  for(const p of properties().filter(p=>!isEmployeeHousing(p))){const expected=p.type==='barn'||!['building','landmark'].includes(p.kind)?0:p.price<25000?1:p.price<75000?2:p.price<250000?3:4;expect(workerBonusOf(p.id)).toBe(expected);}
  expect(workerBonusTotal(baseline.housing.slice(0,20).map(p=>p.id))).toBe(22); // uncapped sum of first 20 housing slots
 });
 it('quote and new purchase apply unchanged price index and no surcharge (Bill Chud 1) to each slot-priced base (isolated Postgres)',async()=>{
  const db=new PGlite(),pool=shim(db);try{
   const bank=new CasinoBank();bank.retryMs=[];await bank.attach(new PgCasinoStore(pool as never));const re=new RealEstate(pool as never,()=>bank,()=>T);await re.init();
   await db.exec('CREATE TABLE farm_tiles(plot_id TEXT,tile INT,owner_key TEXT,crop TEXT,planted_at BIGINT,nonce TEXT); CREATE TABLE farm_upgrades(plot_id TEXT,kind TEXT,owner_key TEXT,level INT); CREATE TABLE farm_fert(plot_id TEXT,tile INT,nonce TEXT,kind TEXT);');
   setPriceIndexForTest(1.4);
   for(const slots of [1,2,3]){
    const name=`Buyer${slots}`,key=name.toLowerCase(),p=properties().find(p=>isEmployeeHousing(p)&&!p.retired&&!p.map&&workerBonusOf(p.id)===slots)!;
    bank.transfer(name,100000-bank.account(name).chips,{game:'test'});await bank.flush();
    await db.query('INSERT INTO properties(id,owner_key,owner_name,price,bought_at,deed,city_price) VALUES($1,$2,$3,7000,$4,$5,7000)',[`baseline-deed-${slots}`,key,name,T,'old']);
    const q=await re.quote(name,p.id),expected=px(slots*10000);
    expect(q.list).toBe(px(slots*10000));expect(q.ownedValue).toBe(7000);expect(q.surchargePct).toBe(0);expect(q.price).toBe(expected);
    const bought=await re.buy(name,p.id,q.price);expect(bought.price).toBe(expected);
    const row=(await db.query<{price:string;city_price:string}>('SELECT price,city_price FROM properties WHERE id=$1',[p.id])).rows[0];expect(Number(row.price)).toBe(expected);expect(Number(row.city_price)).toBe(expected);
   }
  }finally{await db.close();}
 },30000);
 it('existing owner paid/city basis, furnishings, worker records and employment bonus survive restart; refund still uses actual city payment',async()=>{
  const db=new PGlite(),pool=shim(db);try{
   const bank=new CasinoBank();bank.retryMs=[];await bank.attach(new PgCasinoStore(pool as never));let re=new RealEstate(pool as never,()=>bank,()=>T);await re.init();await db.exec(EMPLOY_MIGRATION+HOMES_MIGRATION);
   const old=baseline.housing.find(p=>p.slots===3&&p.id.startsWith('b:'))!;
   await db.query('INSERT INTO properties(id,owner_key,owner_name,price,bought_at,deed,city_price) VALUES($1,$2,$3,120000,$4,$5,90000)',[old.id,'owner','Owner',T-86400000,'original-deed']);
   await db.query("INSERT INTO employ_workers VALUES('worker1','owner','Owner','miner:mine',$1,$1,$1,$2,'working','{\"ores\":{\"iron\":7}}')",[T,T+86400000]);
   await db.query("INSERT INTO home_inventory VALUES('owner','chair',2)");
   await db.query("INSERT INTO home_layout VALUES($1,'owner','cream','oak','[]','locked','[]',$2)",[old.id,T]);
   const snap=async()=>({properties:(await db.query('SELECT * FROM properties')).rows,workers:(await db.query('SELECT * FROM employ_workers')).rows,inventory:(await db.query('SELECT * FROM home_inventory')).rows,layouts:(await db.query('SELECT * FROM home_layout')).rows});
   const before=await snap();re=new RealEstate(pool as never,()=>bank,()=>T);await re.init();setPriceIndexForTest(2);
   const employment=new Employment(pool as never,()=>bank,()=>T);expect((await employment.capOf('owner','Owner')).bonus).toBe(3);
   expect((await re.owned())[0]).toMatchObject({id:old.id,owner:'Owner',price:120000,basis:90000});expect(taxOf(120000)).toBe(600);expect(await snap()).toEqual(before);
   const sold=await re.sell('Owner',old.id);expect(sold.chips).toBe(sellBackOf(90000));expect(sold.chips).toBe(Math.floor(90000*0.7)); // Preserve existing sell-back rounding, too.
   expect((await db.query('SELECT * FROM employ_workers')).rows).toEqual(before.workers);expect((await db.query('SELECT * FROM home_layout')).rows).toEqual(before.layouts);
  }finally{await db.close();}
 },30000);
});
