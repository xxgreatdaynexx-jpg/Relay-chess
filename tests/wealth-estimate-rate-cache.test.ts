import { describe,it,expect,vi } from 'vitest';
const fixture=vi.hoisted(()=>({rate:0.01,reads:0}));
vi.mock('../server/leaderboard-store',async(original)=>({...await original<object>(),databaseUrl:()=> 'postgres://synthetic-test-only'}));
vi.mock('../server/city-rates',async(original)=>({...await original<object>(),cityDailyWealthTaxRate:()=>fixture.rate}));
vi.mock('../server/casino-store',async(original)=>({...await original<object>(),getBank:()=>({refresh:async(name:string)=>name==='Rich'?300000:20000,account:()=>({chips:0})})}));
vi.mock('../server/economy',async(original)=>({...await original<object>(),getEconomy:()=>null}));
vi.mock('pg',async(original)=>{const old=await original<{default:object}>();return{...old,default:{...old.default,Pool:class{async query(sql:string){if(sql.includes('DISTINCT ON')){fixture.reads++;return{rows:[{name:'Rich'},{name:'A'},{name:'B'}]};}return{rows:[]};}}}};});
import { wealthTaxRouter } from '../server/wealth-tax';
describe('daily wealth estimate uses its actual lever rate',()=>{
 it('reuses cache only for same rate and immediately recomputes after a rate change',async()=>{
  const route=wealthTaxRouter().stack.find((x:any)=>x.route?.path==='/api/wealth-tax')!.route.stack[0].handle;
  const get=async()=>{let body:any;const res:any={set:()=>res,status:()=>res,json:(x:unknown)=>{body=x;return res;}};await route({query:{}},res,()=>{});return body;};
  expect(await get()).toMatchObject({ok:true,rate:0.01,total:2600});expect(fixture.reads).toBe(1);
  expect(await get()).toMatchObject({rate:0.01,total:2600});expect(fixture.reads).toBe(1);
  fixture.rate=0.015;expect(await get()).toMatchObject({ok:true,rate:0.015,total:3900});expect(fixture.reads).toBe(2);
  fixture.rate=0.005;expect(await get()).toMatchObject({rate:0.005,total:1300});expect(fixture.reads).toBe(3);
 });
});
