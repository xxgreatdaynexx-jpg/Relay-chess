import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Mayor, pickWinner, setMayorForTest, cityFeeMul, cityPropertyTaxMul } from '../server/mayor';
import { feeOf as marketFee } from '../server/market';
import { feeOf as stockFee } from '../shared/stocks';
import { schedule, weekId, clampRate, FILING_FEE, DAY_MS, WEEK_MS, RATE_MIN, RATE_MAX } from '../shared/mayor';
import { properties, CIVIC_IDS } from '../shared/realEstate';
import { landmarks } from '../shared/worldLayout';

const MON = Date.parse('2026-11-02T06:00:00Z'); // Monday 00:00 Alberta (UTC-6)
const H = 3_600_000;
async function setup() {
  const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  await pool.query('CREATE TABLE players (player_key TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL)');
  let now = MON + 10 * H; const clock = () => now;
  const m = new Mayor(pool, () => bank, clock); await m.init();
  const player = async (name: string, ageMs = 3 * DAY_MS, plays = 6, chips = 50_000) => {
    await pool.query('INSERT INTO players VALUES ($1,$2,$3)', [name.toLowerCase(), name, new Date(now - ageMs).toISOString()]);
    bank.transfer(name, chips, { game: 'admin' });
    for (let i = 0; i < plays; i++) bank.transfer(name, 1, { game: 'slots' });
    await bank.flush();
  };
  const ledger = (key: string, game: string) => (db.public.many(`SELECT amount FROM wallet_transactions WHERE player_key = '${key}' AND game = '${game}'`) as Array<{ amount: number }>).map((r) => Number(r.amount));
  return { pool, bank, m, player, ledger, set: (t: number) => { now = t; }, get now() { return now; } };
}

describe('mayor schedule (fixed UTC-6)', () => {
  it('Mon–Thu filing, Fri–Sat voting, Sunday results, term starts next Monday 00:00 AB for one week', () => {
    expect(schedule(MON).phase).toBe('filing');
    expect(schedule(MON - 1).phase).toBe('results'); // Sunday 23:59 AB of the previous week
    expect(schedule(MON + 4 * DAY_MS - 1).phase).toBe('filing');
    expect(schedule(MON + 4 * DAY_MS).phase).toBe('voting');
    expect(schedule(MON + 6 * DAY_MS).phase).toBe('results');
    const s = schedule(MON + 5 * DAY_MS); expect(s.week).toBe('2026-11-02'); expect(s.termStart).toBe(MON + WEEK_MS); expect(s.termEnd - s.termStart).toBe(WEEK_MS);
    expect(weekId(MON + 6 * DAY_MS + 23 * H)).toBe('2026-11-02');
  });
  it('rate multipliers clamp to ±25% and snap to 5% steps', () => {
    expect(clampRate(2)).toBe(RATE_MAX); expect(clampRate(0)).toBe(RATE_MIN); expect(clampRate('x')).toBe(1); expect(clampRate(1.07)).toBe(1.05); expect(clampRate(-5)).toBe(0.75);
  });
  it('ties go to the earlier filer', () => {
    expect(pickWinner([{ key: 'b', filedAt: 2, votes: 3 }, { key: 'a', filedAt: 1, votes: 3 }, { key: 'c', filedAt: 0, votes: 2 }])!.key).toBe('a');
    expect(pickWinner([])).toBeNull();
  });
});

describe('City Hall map', () => {
  it('City Hall is a downtown landmark that is not for sale', () => {
    expect(landmarks().cityhall).toBeTruthy(); expect(CIVIC_IDS.has('cityhall')).toBe(true);
    expect(properties().some((p) => p.id === 'lm:cityhall')).toBe(false);
  });
});

describe('mayor election', () => {
  it('filing burns the fee through the ledger, needs a slogan, once per week, only Mon–Thu', async () => {
    const s = await setup(); await s.player('Ann');
    await expect(s.m.file('Ann', 'x')).rejects.toThrow(/slogan/);
    const before = s.bank.account('Ann').chips;
    await s.m.file('Ann', 'Lower taxes for all');
    expect(s.bank.account('Ann').chips).toBe(before - FILING_FEE);
    expect(s.ledger('ann', 'mayor_filing')).toEqual([-FILING_FEE]);
    await expect(s.m.file('Ann', 'Again!')).rejects.toThrow(/already running/);
    s.set(MON + 4 * DAY_MS); await s.player('Bob'); await expect(s.m.file('Bob', 'Too late')).rejects.toThrow(/Filing is closed/);
  });
  it('broke candidates are not charged or listed', async () => {
    const s = await setup(); await s.player('Poor', 3 * DAY_MS, 6, 0);
    await expect(s.m.file('Poor', 'Free chips')).rejects.toThrow(/chips/);
    expect(await s.m.candidates(weekId(s.now))).toEqual([]);
  });
  it('voters must be 24 h old with some playtime; one vote per account; only Fri–Sat', async () => {
    const s = await setup(); await s.player('Ann'); await s.player('Bob'); await s.player('Idle', 3 * DAY_MS, 0);
    await s.m.file('Ann', 'A plan'); s.set(s.now + H); await s.m.file('Bob', 'B plan');
    await expect(s.m.vote('Ann', 'Bob')).rejects.toThrow(/Friday/);
    s.set(MON + 4 * DAY_MS + H); await s.player('Alt', 2 * H);
    await expect(s.m.vote('Alt', 'Ann')).rejects.toThrow(/24 hours/);
    await expect(s.m.vote('Idle', 'Ann')).rejects.toThrow(/Play a few games/);
    await s.m.vote('Bob', 'Ann'); await expect(s.m.vote('Bob', 'Ann')).rejects.toThrow(/already voted/);
    await expect(s.m.vote('Ann', 'Nobody')).rejects.toThrow(/No such candidate/);
  });
  it('Sunday tallies once (tie -> earlier filer), mayor-elect takes office Monday for a week', async () => {
    const s = await setup(); for (const n of ['Ann', 'Bob', 'Cat', 'Dan']) await s.player(n);
    await s.m.file('Bob', 'Bob first'); s.set(s.now + H); await s.m.file('Ann', 'Ann second');
    s.set(MON + 5 * DAY_MS); await s.m.vote('Cat', 'Ann'); await s.m.vote('Dan', 'Bob');
    s.set(MON + 6 * DAY_MS + H);
    let v = await s.m.view(null); expect(v.elect?.name).toBe('Bob'); expect(v.mayor).toBeNull();
    await s.m.settle(); // idempotent
    expect((await s.pool.query('SELECT count(*) AS n FROM mayor_terms')).rows[0].n).toBe(1);
    s.set(MON + WEEK_MS + H); v = await s.m.view('Bob'); expect(v.mayor?.name).toBe('Bob'); expect(v.me?.isMayor).toBe(true);
    s.set(MON + 2 * WEEK_MS + H); expect((await s.m.view(null)).mayor).toBeNull(); // term over, nobody ran
  });
  it('hides per-candidate vote counts during voting; shows them on results day', async () => {
    const s = await setup(); for (const n of ['Ann', 'Bob', 'Cat']) await s.player(n);
    await s.m.file('Ann', 'Ann plan'); s.set(s.now + H); await s.m.file('Bob', 'Bob plan');
    s.set(MON + 5 * DAY_MS); await s.m.vote('Cat', 'Ann');
    let v = await s.m.view(null);
    expect(v.schedule.phase).toBe('voting');
    expect(v.candidates.every((c) => c.votes === undefined)).toBe(true);
    expect(v.candidates.map((c) => c.name).sort()).toEqual(['Ann', 'Bob']);
    s.set(MON + 6 * DAY_MS + H); v = await s.m.view(null);
    expect(v.schedule.phase).toBe('results');
    const ann = v.candidates.find((c) => c.name === 'Ann'); const bob = v.candidates.find((c) => c.name === 'Bob');
    expect(ann?.votes).toBe(1); expect(bob?.votes).toBe(0);
  });
});

describe('mayor powers', () => {
  async function withMayor() {
    const s = await setup(); await s.player('Ann'); await s.player('Bob');
    await s.m.file('Ann', 'Hi all'); s.set(MON + 5 * DAY_MS); await s.m.vote('Bob', 'Ann');
    s.set(MON + WEEK_MS + 9 * H); return s;
  }
  it('only the mayor can set rates; clamped to ±25%; effective next AB midnight; once per day; logged', async () => {
    const s = await withMayor(); setMayorForTest(s.m);
    try {
      await expect(s.m.setRates('Bob', { property: 0.8, fee: 0.8 })).rejects.toThrow(/sitting mayor/);
      const c = await s.m.setRates('Ann', { property: 5, fee: 0.1 });
      expect(c).toMatchObject({ property: 1.25, fee: 0.75, effectiveAt: MON + WEEK_MS + DAY_MS });
      expect(cityPropertyTaxMul(s.now)).toBe(1); expect(cityFeeMul(s.now)).toBe(1); // not yet
      await expect(s.m.setRates('Ann', { property: 1, fee: 1 })).rejects.toThrow(/already changed/);
      const next = MON + WEEK_MS + DAY_MS; expect(cityPropertyTaxMul(next)).toBe(1.25); expect(cityFeeMul(next)).toBe(0.75);
      s.set(next + H); const v = await s.m.view(null); expect(v.log[0]).toMatchObject({ by: 'Ann', property: 1.25, fee: 0.75 });
      await s.m.setRates('Ann', { property: 0.75, fee: 1.25 }); // a new day: allowed
      // survives a restart (Postgres)
      const m2 = new Mayor(s.pool, () => s.bank, () => next + 2 * DAY_MS); await m2.init(); expect(m2.rates()).toEqual({ property: 0.75, fee: 1.25 });
    } finally { setMayorForTest(null); }
  });
  it('once-per-day rate change holds across concurrent requests and a second instance (Postgres guard)', async () => {
    const s = await withMayor();
    const r = await Promise.allSettled([s.m.setRates('Ann', { property: 1.25, fee: 1 }), s.m.setRates('Ann', { property: 0.75, fee: 1 })]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason.message).toMatch(/already changed/);
    // a second instance whose in-memory log is stale still can't change rates again today
    const m2 = new Mayor(s.pool, () => s.bank, () => s.now + H); await m2.init(); m2.log = [];
    await expect(m2.setRates('Ann', { property: 1, fee: 1 })).rejects.toThrow(/already changed/);
    expect(Number((await s.pool.query('SELECT count(*) AS n FROM mayor_rates')).rows[0].n)).toBe(1);
    const m3 = new Mayor(s.pool, () => s.bank, () => s.now + DAY_MS); await m3.init(); m3.log = [];
    await expect(m3.setRates('Ann', { property: 1, fee: 1 })).resolves.toMatchObject({ property: 1 }); // next day: allowed
  });
  it('fees scale with the city rate but stay clamped and never drop below 1 chip', () => {
    expect(marketFee(1000)).toBe(50); expect(marketFee(1000, 1, 1.25)).toBe(63); expect(marketFee(1000, 1, 0.75)).toBe(38); expect(marketFee(1000, 1, 9)).toBe(63);
    expect(stockFee(10_000, 1, 0.75)).toBe(75); expect(stockFee(10_000, 1, 1.25)).toBe(125); expect(marketFee(1, 1, 0.75)).toBe(1);
  });
  it('mayor API includes text-only bill records, not arbitrary economy powers', () => {
    const own = Object.getOwnPropertyNames(Mayor.prototype).filter((k) => k !== 'constructor').sort();
    expect(own).toEqual(['approveLawDraft', 'candidates', 'tallied', 'changeBlock', 'denyLaw', 'elect', 'eligibility', 'file', 'init', 'lawHistory', 'mayor', 'noteLaw', 'submitLaw', 'pending', 'rates', 'rejectLawDraft', 'reload', 'remove', 'setRates', 'settle', 'term', 'tx', 'vetoLaw', 'vice', 'view', 'vote'].sort());
  });
  it('admin removal ends the term and resets rates to default immediately', async () => {
    const s = await withMayor(); await s.m.setRates('Ann', { property: 1.25, fee: 1.25 });
    s.set(s.now + DAY_MS); expect(s.m.rates()).toEqual({ property: 1.25, fee: 1.25 });
    expect(await s.m.remove('abuse')).toEqual({ removed: 'Ann', successor: null });
    expect(s.m.rates()).toEqual({ property: 1, fee: 1 }); expect((await s.m.view(null)).mayor).toBeNull();
    await expect(s.m.setRates('Ann', { property: 1.25, fee: 1 })).rejects.toThrow(/sitting mayor/);
    await expect(s.m.remove('again')).rejects.toThrow(/no mayor/);
  });
});

describe('vice mayor = election runner-up (existing tie order, no minimum, no promotion)', () => {
  const cand = (pool: any, week: string, key: string, filedAt: number) => pool.query('INSERT INTO mayor_candidates VALUES ($1,$2,$3,$4,$5)', [week, key, key.toUpperCase(), 'slogan', filedAt]);
  const vote = (pool: any, week: string, voter: string, key: string) => pool.query('INSERT INTO mayor_votes VALUES ($1,$2,$3,$4)', [week, voter, key, 0]);
  it('runner-up by votes then earliest filer becomes vice for the term; zero-vote runner-up counts', async () => {
    const s = await setup(); const w = schedule(MON).week;
    await cand(s.pool, w, 'a', 1); await cand(s.pool, w, 'b', 2); await cand(s.pool, w, 'c', 3);
    await vote(s.pool, w, 'v1', 'c'); await vote(s.pool, w, 'v2', 'c'); await vote(s.pool, w, 'v3', 'b');
    s.set(schedule(MON).resultsAt + H); await s.m.settle();
    s.set(MON + WEEK_MS + H);
    expect((await s.m.mayor())?.key).toBe('c'); expect(await s.m.vice()).toMatchObject({ key: 'b', votes: 1 });
    const v = await s.m.view('B'); expect(v.vice?.name).toBe('B'); expect(v.me?.isVice).toBe(true); expect(v.me?.isMayor).toBe(false);
    s.set(MON + 2 * WEEK_MS + H); expect(await s.m.vice()).toBeNull(); // role ends with the term
  });
  it('tie for second -> earliest filer; zero votes still ranked; single candidate -> no vice; removal promotes vice, vacates slot', async () => {
    const s = await setup(); const w = schedule(MON).week;
    await cand(s.pool, w, 'a', 1); await cand(s.pool, w, 'b', 2); await cand(s.pool, w, 'c', 3);
    await vote(s.pool, w, 'v1', 'a');
    s.set(schedule(MON).resultsAt + H); await s.m.settle(); s.set(MON + WEEK_MS + H);
    expect(await s.m.vice()).toMatchObject({ key: 'b', votes: 0 });
    expect(await s.m.remove('test')).toEqual({ removed: 'A', successor: 'B' });
    const term = await s.m.mayor(); expect(term?.key).toBe('b'); expect(term?.startsAt).toBe(schedule(MON).termStart); expect(term?.endsAt).toBe(schedule(MON).termEnd);
    expect(await s.m.vice()).toBeNull(); // slot vacated; 'c' (third) is NOT promoted
    expect((await s.m.view('A')).me?.isMayor).toBe(false); expect((await s.m.view('B')).me?.isMayor).toBe(true);
    expect((await s.pool.query('SELECT from_key, to_key FROM mayor_successions')).rows).toEqual([{ from_key: 'a', to_key: 'b' }]);
    expect(await s.m.remove('again')).toEqual({ removed: 'B', successor: null }); expect(await s.m.mayor()).toBeNull();
    const s2 = await setup(); const w2 = schedule(MON).week; await cand(s2.pool, w2, 'solo', 1);
    s2.set(schedule(MON).resultsAt + H); await s2.m.settle(); s2.set(MON + WEEK_MS + H);
    expect((await s2.m.mayor())?.key).toBe('solo'); expect(await s2.m.vice()).toBeNull();
  });
  it('backfills runner-up once for a term tallied before vice mayors existed', async () => {
    const s = await setup(); const w = schedule(MON).week;
    await cand(s.pool, w, 'a', 1); await cand(s.pool, w, 'b', 2); await vote(s.pool, w, 'v1', 'a');
    const sc = schedule(MON);
    await s.pool.query('INSERT INTO mayor_terms (week, player_key, name, votes, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5,$6)', [w, 'a', 'A', 1, sc.termStart, sc.termEnd]);
    s.set(MON + WEEK_MS + H); await s.m.settle(); await s.m.settle();
    expect(await s.m.vice()).toMatchObject({ key: 'b' }); expect((await s.m.mayor())?.key).toBe('a');
  });
});
