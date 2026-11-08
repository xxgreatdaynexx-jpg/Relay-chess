// Public immutable legislation fixture, not a player profile or credential.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { implementationOf } from '../server/billImplementations';
import { MayorLaws } from '../server/mayorLaws';
import { MAYOR_MIGRATION } from '../server/mayor';
import { MayorLaws as Panel } from '../client/src/components/MayorLaws';
import type { MayorLaw } from '../shared/mayorLaws';
const ORIGINAL = {
  "at": 1794164599491,
  "day": "2026-11-08",
  "text": "remove the property surcharge and instead introduce a property cap by property zoning. Zones are defined as:\n\nResidential, commercial, and farmland\n\nResidential and commercial will be limited to 5 properties per citizen, eg one citizen may hold 5 residential and commercial properties at once, but NOT 10 residential and zero commercial, 5 per category.\n\nFarmland will instead be capped per tile. At any given time a citizen can own up to  1500 tiles of farmland. Citizens will be unable to purchase farmland going over this cap.",
  "number": 1,
  "status": "pending",
  "by_name": "carter2",
  "mayor_key": "carter2",
  "term_week": "2026-11-02",
  "vetoed_at": null,
  "vetoed_role": null,
  "vetoed_by_key": null,
  "vetoed_by_name": null,
  "vetoed_term_week": null
}
;
const viewBill=(r: typeof ORIGINAL): MayorLaw => ({number:String(r.number),title:`Bill Chud ${r.number}`,text:r.text,by:r.by_name,at:r.at,day:r.day,status:'pending',vetoedAt:null,vetoedBy:null,vetoedRole:null,implementation:implementationOf(r)});
it('matches only the exact immutable public original and reports the already verified enactment release',()=>{
 const m=implementationOf(ORIGINAL)!;expect(m).toMatchObject({status:'enacted',revision:1,release:'fc56eedcc90c5008b53d0c13319a15649c66e82f'});
 expect(m.implementedAt).toBe(Date.parse('2026-11-08T14:38:28.521-06:00'));
 for(const x of ['5 residential','5 commercial','1,500 full-plot tiles','grandfathered','Resort lots and land patches are exempt','No prior surcharge refunds','wealth-tax rules and rates'])expect(m.text).toContain(x);
 for(const [k,v] of Object.entries({number:2,day:'2026-11-09',text:ORIGINAL.text+' ',by_name:'Other',mayor_key:'other',term_week:'2026-11-09',at:ORIGINAL.at+1,status:'vetoed',vetoed_by_key:'vice'}))expect(implementationOf({...ORIGINAL,[k]:v}),k).toBeUndefined();
 const copy=implementationOf(ORIGINAL)!;copy.text='tampered';expect(implementationOf(ORIGINAL)!.text).toBe(m.text);
});
it('default history shows final wording and Enacted — revised wording; original pending submission is only in collapsed archive; other bill stays Pending',()=>{
 const b=viewBill(ORIGINAL);const pending={...b,number:'2',title:'Bill Chud 2',text:'Unimplemented new bill',implementation:undefined};
 const html=renderToStaticMarkup(<Panel view={{history:[b,pending],nextBefore:null,submittedToday:true}} isMayor isVice today="2026-11-08" busy={false} onPass={async()=>{}} onVeto={async()=>{}}/>);
 expect(html).toContain('Enacted — revised wording');expect(html).toContain('not an approval vote');expect(html).toContain('mayor-law-active-wording');expect(html).toContain('<details data-testid="mayor-law-original">');expect(html).not.toContain('<details open');
 expect(html).toContain('Original submission (archived)');expect(html).toContain('Original recorded status: Pending');expect(html).toContain('Unimplemented new bill');expect(html.match(/data-testid="mayor-law-veto"/g)).toHaveLength(1);
 expect(html).not.toMatch(/Dayne|approved by/i);
});
const url=process.env.MAYOR_LAWS_TEST_DATABASE_URL;
it.skipIf(!url)('native PG: read-only metadata survives restart/pagination; stale veto rejected; originals/events immutable and unrelated pending bill can veto',async()=>{
 const u=new URL(url!);if(!['127.0.0.1','localhost'].includes(u.hostname))throw new Error('local only');
 const root=new pg.Pool({connectionString:url});const schema=`bill_impl_${process.pid}_${Date.now()}`;await root.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:url,max:2,options:`-c search_path=${schema}`});const now=Date.parse('2026-11-08T21:40:00Z');
 try{
  await pool.query(MAYOR_MIGRATION);const laws=new MayorLaws(pool,()=>now);await laws.init();
  await pool.query('INSERT INTO mayor_terms(week,player_key,name,votes,starts_at,ends_at,vice_key,vice_name) VALUES($1,$2,$3,1,$4,$5,$6,$7)',['2026-11-02','carter2','carter2',now-100000000,now+86400000,'vice','Vice']);
  await pool.query('INSERT INTO mayor_bills(number,day,text,by_name,mayor_key,term_week,at) VALUES($1,$2,$3,$4,$5,$6,$7)',[1,ORIGINAL.day,ORIGINAL.text,ORIGINAL.by_name,ORIGINAL.mayor_key,ORIGINAL.term_week,ORIGINAL.at]);
  await pool.query('INSERT INTO mayor_bills(number,day,text,by_name,mayor_key,term_week,at) VALUES(2,$1,$2,$3,$4,$5,$6)',['2026-11-07','Unrelated pending bill','carter2','carter2','2026-11-02',ORIGINAL.at-86400000]);
  const original=(await pool.query('SELECT * FROM mayor_bills ORDER BY number')).rows;
  const h=await laws.history();expect(h.history.find(x=>x.number==='1')?.implementation?.status).toBe('enacted');expect(h.history.find(x=>x.number==='2')?.implementation).toBeUndefined();
  const restart=new MayorLaws(pool,()=>now);await restart.init();expect((await restart.history('2')).history[0]?.implementation?.status).toBe('enacted');
  await expect(restart.veto('Vice','1')).rejects.toThrow(/implemented with revised wording/);
  expect((await pool.query('SELECT * FROM mayor_bills ORDER BY number')).rows).toEqual(original);expect((await pool.query('SELECT * FROM mayor_bill_events')).rows).toHaveLength(0);
  await expect(pool.query("UPDATE mayor_bills SET text='replacement' WHERE number=1")).rejects.toThrow(/immutable/);
  await expect(pool.query('DELETE FROM mayor_bills WHERE number=1')).rejects.toThrow(/permanent/);
  await expect(pool.query('TRUNCATE mayor_bill_events')).rejects.toThrow(/append-only/);
  expect((await restart.veto('carter2','2')).bill.status).toBe('vetoed');expect((await pool.query('SELECT * FROM mayor_bill_events')).rows).toHaveLength(1);
 }finally{await pool.end();await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end();}
},30000);
