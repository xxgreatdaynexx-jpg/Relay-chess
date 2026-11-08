import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Coop, COOP_MIGRATION, resetCoop } from '../server/coop';
import { PgCasinoStore, resetBank } from '../server/casino-store';
import { PgMineStore, resetMines } from '../server/mines';
import { LocStore, setLocStore } from '../server/locstock';
import { WeeklyEvents } from '../server/weeklyEvent';
import { COOP_PLAN, projectStages, projectValue, partKey } from '../shared/coop';
import { EVENTS, LEGACY_EVENTS, EVENT_REBALANCE_FROM, eventFor, playerEventCap, eventReward, weekStart, weekIndex } from '../shared/coop3';

function shim(db: PGlite) {
  const query = async (sql: string, args?: unknown[]) => {
    const r = args?.length ? await db.query(sql, args) : (await db.exec(sql)).at(-1) ?? { rows: [], affectedRows: 0 };
    return { rows: r.rows as Record<string, unknown>[], rowCount: (r as { affectedRows?: number }).affectedRows ?? r.rows.length };
  };
  return { query, on: () => {}, connect: async () => ({ query, release: () => {} }) };
}
afterEach(() => { resetCoop(); resetBank(); resetMines(); });

describe('small-community goals', () => {
  it('keeps historical goals/caps and the existing weekly boundary; current and future events need two helpers', () => {
    const old = [25000,30000,4000,3000000,400], goals = [4000,6000,300,1000,20];
    Object.values(EVENTS).forEach((e,i) => {
      expect(e.goal).toBe(goals[i]); expect(LEGACY_EVENTS[e.id].goal).toBe(old[i]);
      expect(playerEventCap(e)).toBe(e.goal/2);
      expect(playerEventCap(e)).toBeLessThanOrEqual(playerEventCap(LEGACY_EVENTS[e.id])); // no existing tier lost
    });
    for (let w=EVENT_REBALANCE_FROM-5;w<EVENT_REBALANCE_FROM;w++) expect(eventFor(w)).toBe(LEGACY_EVENTS[eventFor(w).id]);
    expect(eventFor(EVENT_REBALANCE_FROM)).toBe(EVENTS.trade);
    const boundary=weekStart(EVENT_REBALANCE_FROM); expect(weekIndex(boundary-1)).toBe(EVENT_REBALANCE_FROM-1); expect(weekIndex(boundary)).toBe(EVENT_REBALANCE_FROM);
    for(const e of Object.values(EVENTS)) {
      // Independently verify reward formula unchanged: full gold 15k / half gold 7.5k.
      expect(eventReward(e,playerEventCap(e),1)).toBe(15000); expect(eventReward(e,playerEventCap(e),.5)).toBe(7500);
    }
  });

  it('retains over-new-cap current contribution rows, references and old claim history after restart', async () => {
    const db=new PGlite(), pool=shim(db); const now=weekStart(EVENT_REBALANCE_FROM)+3600000;
    try {
      let e=new WeeklyEvents(pool as never,()=>now); await e.init();
      await db.exec(`INSERT INTO wev_contrib VALUES (43,'ann','Ann',3000),(42,'ann','Ann',400); INSERT INTO wev_claims VALUES ('wev_claim:42:ann',42,'ann',15000,1); INSERT INTO wev_refs VALUES ('43:sale:b:ann',43);`);
      await db.exec("INSERT INTO wev_contrib SELECT 42,'other-'||i,'Other '||i,400 FROM generate_series(1,9) i;");
      e=new WeeklyEvents(pool as never,()=>now); await e.init(); e.guard.excluded=()=>null;
      expect(e.view('Ann').me?.amount).toBe(3000); expect(e.view('Ann').progress).toBe(1000);
      expect(e.credit('trade','Ann',100,'extra')).toBe(0); await e.flush();
      expect(Number((await db.query<{amount:string}>("SELECT amount FROM wev_contrib WHERE week=43")).rows[0].amount)).toBe(3000);
      expect(e.view('Ann').past).toMatchObject({claimed:true,pct:1,reward:15000});
      await expect(e.claim('Ann')).rejects.toThrow(/Already/);
      expect((await db.query('SELECT * FROM wev_claims')).rows).toHaveLength(1);
      // Current week can only be claimed after its unchanged end boundary, never as a migration payout.
      expect((await db.query('SELECT * FROM wev_claims WHERE week=43')).rows).toHaveLength(0);
    } finally { await db.close(); }
  });
});

describe('stadium proportional cost transition', () => {
  it('preserves four stages and the unchanged bridge; exact rounded cost stays near seven days at 25% cashflow', () => {
    expect(COOP_PLAN.stadium.total).toBe(693000); expect(COOP_PLAN.stadium.chipShare).toBe(.6);
    const stages=projectStages(COOP_PLAN.stadium); expect(stages).toHaveLength(4);
    expect(stages.every(s=>s.chips===103950)).toBe(true);
    expect(projectValue(COOP_PLAN.stadium)).toBeGreaterThanOrEqual(693000);
    expect(projectValue(COOP_PLAN.stadium)).toBeLessThan(693300);
    expect(COOP_PLAN.bridge.total).toBe(10000000);
  });

  it('never moves excess legacy donations between stages or regresses completed projects', async () => {
    const db=new PGlite(), pool=shim(db);
    try {
      await db.exec(COOP_MIGRATION);
      const st=projectStages(COOP_PLAN.stadium), at=Date.now(); let value=0;
      const insert=async(stage:number,part:string,qty:number,v:number) => {
        value+=v; await db.query('INSERT INTO coop_donations VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [`old-${stage}-${part}`,'stadium',stage,'ann','Ann',part,qty,v,0,at]);
      };
      await insert(0,'chips',3750000,3750000);
      for(const g of st[0].goods) await insert(0,partKey(g),g.qty,g.qty*g.price);
      let c=new Coop(pool as never,()=>at); await c.init();
      expect(c.stagesDone('stadium')).toBe(1); expect(c.projectView('stadium').stages[1].done).toEqual({});
      expect(c.stadiumDonated('Ann')).toBe(value); // full old value retained, not clamped for donor credit
      for(let i=1;i<4;i++) { await insert(i,'chips',st[i].chips,st[i].chips); for(const g of st[i].goods) await insert(i,partKey(g),g.qty,g.qty*g.price); }
      c=new Coop(pool as never,()=>at); await c.init();
      expect(c.projectView('stadium').state).toBe('complete'); expect(c.activeProject()).toBe('bridge');
      expect(c.stadiumDonated('Ann')).toBe(value); expect(c.projectView('stadium').pct).toBe(1);
      expect((await db.query('SELECT count(*)::int n FROM coop_donations')).rows[0]).toEqual({n:12});
    } finally { await db.close(); }
  },30000);

  it('replays the actual 10k legacy donation without paying again; goods leave Warehouse and persist exactly once (isolated Postgres)', async () => {
    const db=new PGlite(), pool=shim(db); const now=Date.parse('2026-11-08T01:45:00Z');
    try {
      await db.exec(COOP_MIGRATION);
      await db.query('INSERT INTO coop_donations VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', ['coop:ann:legacy01','stadium',0,'ann','Ann','chips',10000,10000,1000,now-1000]);
      const bank=resetBank(); bank.retryMs=[]; await bank.attach(new PgCasinoStore(pool as never));
      const mines=resetMines(); await mines.attach(new PgMineStore(pool as never));
      const ls=new LocStore(pool as never); await ls.init(); setLocStore(ls);
      let c=new Coop(pool as never,()=>now); await c.init();
      const balance=bank.account('Ann').chips;
      expect(c.view('Ann').me).toMatchObject({value:10000,rewarded:1000});
      expect(c.projectView('stadium').stages[0].done.chips).toBe(10000);
      expect(c.projectView('stadium').pct).toBeCloseTo(10000/projectValue(COOP_PLAN.stadium));
      expect(c.projectView('stadium').stage).toBe(0); expect(c.projectView('bridge').state).toBe('locked');
      expect((await c.donate('Ann',{project:'stadium',part:'chips',qty:10000,nonce:'legacy01'})).replay).toBe(true);
      expect(bank.account('Ann').chips).toBe(balance);
      const g=projectStages(COOP_PLAN.stadium)[0].goods[0], qty=20;
      await expect(c.donate('Ann',{project:'stadium',part:partKey(g),qty,nonce:'goods000'})).rejects.toThrow(/don’t have/);
      mines.adjustStack('Ann',g.type,g.id,qty); await mines.flush();
      const r=await c.donate('Ann',{project:'stadium',part:partKey(g),qty,nonce:'goods001'});
      expect(r.value).toBe(qty*g.price); expect(ls.qty('Ann','warehouse',partKey(g))).toBe(0);
      expect(bank.account('Ann').chips).toBe(balance+Math.floor(qty*g.price*.1));
      c=new Coop(pool as never,()=>now); await c.init();
      expect(c.projectView('stadium').stages[0].done[partKey(g)]).toBe(qty);
      expect(c.view('Ann').me).toMatchObject({value:10000+qty*g.price,rewarded:1000+r.reward});
      expect((await c.donate('Ann',{project:'stadium',part:partKey(g),qty,nonce:'goods001'})).replay).toBe(true);
      expect((await db.query('SELECT * FROM coop_donations')).rows).toHaveLength(2);
      expect((await db.query("SELECT * FROM wallet_transactions WHERE game='coop'")).rows).toHaveLength(1); // goods rebate only, no legacy re-award
    } finally { await db.close(); }
  },30000);
});
