import { describe,it,expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { Mayor } from '../server/mayor';
import { schedule } from '../shared/mayor';
const START=Date.parse('2026-11-08T00:00:00-06:00'),OLD=Date.parse('2026-11-09T00:00:00-06:00'),END=Date.parse('2026-11-16T00:00:00-06:00');
function poolOf(db:PGlite){return{query:async(sql:string,args?:unknown[])=>{const r=args?.length?await db.query(sql,args):(await db.exec(sql)).at(-1)??{rows:[]};return{rows:r.rows,rowCount:(r as {affectedRows?:number}).affectedRows??r.rows.length};}};}
describe('reviewed one-term mayor date correction',()=>{
 it('durable current term controls real mayor/vice eligibility and UI dates at exact Regina midnight, across restart; future cadence unchanged',async()=>{
  const db=new PGlite();try{
   let now=START-1;const pool=poolOf(db),m=new Mayor(pool as never,undefined,()=>now);await m.init();
   await db.query("INSERT INTO mayor_terms(week,player_key,name,votes,starts_at,ends_at,vice_key,vice_name,vice_votes,vice_settled) VALUES('2026-11-02','carter2','carter2',3,$1,$2,'liam','Liam',2,true)",[START,END]);
   expect(await m.mayor()).toBe(null);expect(await m.vice()).toBe(null);expect((await m.elect())?.startsAt).toBe(START);
   now=START;let v=await m.view(null);expect(v.mayor?.name).toBe('carter2');expect(v.vice?.name).toBe('Liam');expect(v.elect).toBe(null);expect(v.schedule.termStart).toBe(START);expect(v.schedule.termEnd).toBe(END);expect(v.schedule.phase).toBe('results');
   now=START+8*3600000;const reboot=new Mayor(pool as never,undefined,()=>now);await reboot.init();await reboot.settle();v=await reboot.view(null);expect(v.mayor?.startsAt).toBe(START);expect(v.schedule.termStart).toBe(START);
   expect(schedule(now).termStart).toBe(OLD); // General cadence is deliberately NOT rewritten.
   now=OLD;v=await reboot.view(null);expect(v.mayor?.name).toBe('carter2');expect(v.schedule.week).toBe('2026-11-09');expect(v.schedule.termStart).toBe(END); // next election still MonNov16
   now=END-1;expect((await reboot.mayor())?.name).toBe('carter2');now=END;expect(await reboot.mayor()).toBe(null);
  }finally{await db.close();}
 },30000);
});

describe('guarded production proposal (executed ONLY against isolated PGlite)',()=>{
 const sql=readFileSync(new URL('../scripts/sql/mayor-handover-2026-11-08.sql',import.meta.url),'utf8');
 const onDate=(day='2026-11-08')=>sql.replace("timezone('America/Regina', current_timestamp)::date",`DATE '${day}'`);
 async function fixture(){
  const db=new PGlite();await new Mayor(poolOf(db) as never).init();
  for(const [i,key]of ['liam','carter2','chessguy2'].entries())await db.query("INSERT INTO mayor_candidates VALUES('2026-11-02',$1,$2,'slogan',$3)",[key,key==='liam'?'Liam':key,i+1]);
  let voter=0;for(const[key,n]of [['carter2',3],['liam',2],['chessguy2',1]]as const)for(let i=0;i<n;i++)await db.query("INSERT INTO mayor_votes VALUES('2026-11-02',$1,$2,1)",[`fixture-voter-${++voter}`,key]);
  await db.query("INSERT INTO mayor_terms(week,player_key,name,votes,starts_at,ends_at,vice_key,vice_name,vice_votes,vice_settled) VALUES('2026-11-02','carter2','carter2',3,$1,$2,'liam','Liam',2,true)",[OLD,END]);return db;
 }
 it('changes only starts_at, preserves election/rates/history/vice, replays as no-op, and immediately grants real office',async()=>{
  const db=await fixture();try{
   const snapshot=async()=>Object.fromEntries(await Promise.all(['mayor_terms','mayor_votes','mayor_candidates','mayor_rates','mayor_successions'].map(async t=>[t,(await db.query(`SELECT * FROM ${t}`)).rows])));
   const before=await snapshot();await db.exec(onDate());const after=await snapshot();expect(after).toEqual({...before,mayor_terms:[{...before.mayor_terms[0],starts_at:START}]});await db.exec(onDate());expect(await snapshot()).toEqual(after);
   const m=new Mayor(poolOf(db) as never,undefined,()=>START+1);await m.init();expect((await m.mayor())?.name).toBe('carter2');expect(await m.elect()).toBe(null);expect((await m.vice())?.name).toBe('Liam');
  }finally{await db.close();}
 },30000);
 it('rejects stale approval date, changed vote tally, or overlapping incumbent without updating the term',async()=>{
  for(const kind of ['stale','tally','overlap']){
   const db=await fixture();try{
    if(kind==='tally')await db.query("INSERT INTO mayor_votes VALUES('2026-11-02','extra-voter','liam',1)");
    if(kind==='overlap')await db.query("INSERT INTO mayor_terms(week,player_key,name,votes,starts_at,ends_at) VALUES('2026-10-26','incumbent','Incumbent',1,$1,$2)",[START-86400000,OLD]);
    await expect(db.exec(onDate(kind==='stale'?'2026-11-09':'2026-11-08'))).rejects.toThrow();await db.exec('ROLLBACK');expect(Number((await db.query<{starts_at:number}>("SELECT starts_at FROM mayor_terms WHERE week='2026-11-02'")).rows[0].starts_at)).toBe(OLD);
   }finally{await db.close();}
  }
 },30000);
});
