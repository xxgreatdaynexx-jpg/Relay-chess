import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { getBank, resetBank } from '../server/casino-store';
import { setPriceIndexForTest } from '../server/price-index';
import { SpaceProgram, SPACE_SOCIAL_MIGRATION, SPACE_SOCIAL_TTL_MS } from '../server/spaceProgram';
import { courierI, makeDesign, designCost } from '../shared/spaceParts';
import { SPACE_COOLDOWN_MS, SPACE_PAYOUT, SPACE_MAX_PAID } from '../shared/spaceFlight';
import { dailyBoard, designMeetsMission } from '../shared/spaceMissions';
import { TECH_NODES } from '../shared/spaceScience';

const fund = (name: string, n: number) => { const b = getBank(); b.transfer(name, n - b.account(name).chips, { game: 'admin' }); };
const chips = (n: string) => getBank().account(n).chips;
const T0 = Date.parse('2026-11-13T12:00:00Z');
const DAY = '2026-11-13';

function shim(db: PGlite) {
  let chain = Promise.resolve();
  const q = async (sql: string, args?: unknown[]) => {
    const r = args?.length ? await db.query(sql, args as unknown[]) : (await db.exec(sql)).at(-1) ?? { rows: [], affectedRows: 0 };
    return { rows: r.rows as Record<string, unknown>[], rowCount: (r as { affectedRows?: number }).affectedRows ?? r.rows.length };
  };
  return { query: q, connect: async () => { let release!: () => void; const prev = chain; chain = new Promise<void>((r) => (release = r)); await prev; return { query: q, release }; } };
}

function sciCourier(extra: string[] = ['sci-thermo', 'sci-baro'], payload = 'commsat') {
  return makeDesign('SciCourier', [
    { part: payload, stage: 0 }, { part: 'probe-okto', stage: 15 },
    ...extra.map((p) => ({ part: p, stage: 15 })),
    { part: 'fairing-125', stage: 2 }, { part: 'fl-t400', stage: 1 }, { part: 'terrier', stage: 1 }, { part: 'tr-18a', stage: 1 },
    { part: 'fl-t800', stage: 3 }, { part: 'fl-t800', stage: 3 }, { part: 'reliant', stage: 3 },
  ]);
}
const uidOf = (d: ReturnType<typeof sciCourier>, partId: string) => d.parts.find((p) => p.partId === partId)!.uid;
const settled = async <T,>(ps: Promise<T>[]) => {
  const r = await Promise.allSettled(ps);
  return { ok: r.filter((x) => x.status === 'fulfilled').map((x) => (x as PromiseFulfilledResult<T>).value), err: r.filter((x) => x.status === 'rejected').map((x) => String((x as PromiseRejectedResult).reason?.message)) };
};

type Mode = 'memory' | 'postgres';
async function make(mode: Mode, clock: () => number) {
  if (mode === 'memory') return new SpaceProgram(null, clock);
  const p = new SpaceProgram(shim(new PGlite()) as never, clock);
  await p.init();
  return p;
}

for (const mode of ['memory', 'postgres'] as Mode[]) {
  describe(`space multiplayer (${mode})`, () => {
    beforeEach(() => { resetBank(); setPriceIndexForTest(1); });

    it('keeps designs, tickets, science, survey and contracts private to each player', async () => {
      let now = T0;
      const p = await make(mode, () => now);
      fund('Alice', 200_000); fund('Bob', 200_000);
      const saved = await p.saveDesign('Alice', courierI());
      await expect(p.saveDesign('Bob', courierI(), saved.id)).rejects.toThrow(/not found/);
      await expect(p.deleteDesign('Bob', saved.id)).rejects.toThrow(/not found/);
      const d = sciCourier();
      const L = await p.launch('Alice', d);
      now += 300_000;
      await expect(p.deploy('Bob', { launchId: L.launchId, peM: 90_000, apM: 95_000 })).rejects.toThrow(/not found/);
      await expect(p.runScience('Bob', { launchId: L.launchId, experimentId: 'thermo', partUid: uidOf(d, 'sci-thermo'), situation: 'pad', metS: 0, alt: 0 })).rejects.toThrow(/not found/);
      await p.runScience('Alice', { launchId: L.launchId, experimentId: 'thermo', partUid: uidOf(d, 'sci-thermo'), situation: 'lowOrbit', metS: 280, alt: 90_000, peM: 80_000, apM: 95_000 });
      const board = dailyBoard(DAY);
      await p.acceptMission('Alice', board[0]!.id);
      const vb = await p.view('Bob');
      expect(vb.designs).toHaveLength(0);
      expect(vb.sats).toHaveLength(0);
      expect(vb.science.total).toBe(0);
      expect(vb.missions.accepted).toHaveLength(0);
      expect(vb.survey.mappers).toHaveLength(0);
      // The daily board is shared and deterministic.
      const va = await p.view('Alice');
      expect(vb.missions.board.map((m) => m.id)).toEqual(va.missions.board.map((m) => m.id));
      expect(va.science.total).toBeGreaterThan(0);
      // Names are case-insensitive keys: the same player in another case is the same account.
      expect((await p.view('ALICE')).designs).toHaveLength(1);
    });

    it('lets one launch through when a player fires several at once (two tabs)', async () => {
      const now = T0;
      const p = await make(mode, () => now);
      fund('Cara', 200_000);
      const before = chips('Cara');
      const r = await settled([1, 2, 3, 4].map(() => p.launch('Cara', courierI())));
      expect(r.ok).toHaveLength(1);
      expect(r.err.every((e) => /cooling down/.test(e))).toBe(true);
      expect(chips('Cara')).toBe(before - designCost(courierI()));
    });

    it('does not block different players launching at the same moment', async () => {
      const now = T0;
      const p = await make(mode, () => now);
      const names = ['P1', 'P2', 'P3', 'P4', 'P5'];
      for (const n of names) fund(n, 100_000);
      const r = await settled(names.map((n) => p.launch(n, courierI())));
      expect(r.ok).toHaveLength(5);
      for (const n of names) expect(chips(n)).toBe(100_000 - designCost(courierI()));
    });

    it('pays a deploy once under parallel claims, and never past the five-flight cap', async () => {
      let now = T0;
      const p = await make(mode, () => now);
      fund('Dan', 500_000);
      const L = await p.launch('Dan', courierI());
      now += 300_000;
      const before = chips('Dan');
      const r = await settled([1, 2, 3].map(() => p.deploy('Dan', { launchId: L.launchId, peM: 90_000, apM: 95_000 })));
      expect(r.ok).toHaveLength(1);
      expect(chips('Dan')).toBe(before + SPACE_PAYOUT);
      // Burn paid slots up to the cap - 1, then race two deploys from two tickets.
      const tickets: string[] = [];
      for (let i = 0; i < SPACE_MAX_PAID + 1; i++) {
        now += SPACE_COOLDOWN_MS;
        tickets.push((await p.launch('Dan', courierI())).launchId);
      }
      now += 300_000;
      for (let i = 0; i < SPACE_MAX_PAID - 2; i++) await p.deploy('Dan', { launchId: tickets[i]!, peM: 90_000, apM: 95_000 });
      const last = await settled(tickets.slice(SPACE_MAX_PAID - 2).map((id) => p.deploy('Dan', { launchId: id, peM: 90_000, apM: 95_000 })));
      expect(last.ok.filter((x) => x.payout > 0)).toHaveLength(1);
      expect((await p.view('Dan')).rules.paid).toBe(SPACE_MAX_PAID);
    });

    it('settles a contract once when claimed from two tabs', async () => {
      let now = T0;
      const p = await make(mode, () => now);
      fund('Eve', 200_000);
      const board = dailyBoard(DAY);
      const m = board.find((x) => (x.kind === 'reach-orbit' || x.kind === 'circular') && designMeetsMission(courierI(), x) === null)
        ?? board.find((x) => designMeetsMission(courierI(), x) === null && x.kind !== 'science' && x.kind !== 'survey-orbit')!;
      await p.acceptMission('Eve', m.id);
      const L = await p.launch('Eve', courierI(), m.id);
      now += Math.max(m.minFlightSec, 260) * 1000;
      const peC = m.maxPe != null ? Math.min(Math.max(m.minPe ?? 80_000, 80_000), m.maxPe) : Math.max(m.minPe ?? 80_000, 80_000);
      const apC = m.maxAp != null ? Math.min(Math.max(peC + 2_000, m.minAp ?? peC), m.maxAp) : Math.max(peC + 8_000, 90_000);
      const before = chips('Eve');
      const body = { launchId: L.launchId, missionId: m.id, peM: peC, apM: apC, flightTimeS: 600, deployed: true, deployedCount: 2, altitudeM: apC, eccentricity: 0.005 };
      const r = await settled([1, 2, 3].map(() => p.completeMission('Eve', body)));
      expect(r.ok).toHaveLength(1);
      expect(chips('Eve')).toBe(before + r.ok[0]!.payout);
    });

    it('records a science subject once and unlocks a tech node once under parallel requests', async () => {
      let now = T0;
      const p = await make(mode, () => now);
      fund('Fay', 200_000);
      const d = sciCourier();
      const L = await p.launch('Fay', d);
      now += 300_000;
      const body = { launchId: L.launchId, experimentId: 'thermo', partUid: uidOf(d, 'sci-thermo'), situation: 'lowOrbit', metS: 280, alt: 90_000, peM: 80_000, apM: 95_000 };
      const before = chips('Fay');
      const r = await settled([1, 2, 3].map(() => p.runScience('Fay', body)));
      expect(r.ok).toHaveLength(1);
      expect(chips('Fay')).toBe(before + r.ok[0]!.grant);
      await p.runScience('Fay', { ...body, experimentId: 'baro', partUid: uidOf(d, 'sci-baro'), situation: 'pad', metS: 0, alt: 0 });
      const avail = (await p.view('Fay')).science.available;
      expect(avail).toBeGreaterThanOrEqual(10);
      const u = await settled([1, 2, 3].map(() => p.unlockTech('Fay', 'basic-science')));
      expect(u.ok).toHaveLength(1);
      expect((await p.view('Fay')).science.spent).toBe(TECH_NODES.find((n) => n.id === 'basic-science')!.cost);
    });

    it('pays each survey milestone once when several syncs race', async () => {
      let now = T0;
      const p = await make(mode, () => now);
      fund('Gus', 200_000);
      const d = sciCourier([], 'scan-camera');
      const L = await p.launch('Gus', d);
      now += 300_000;
      await p.deploy('Gus', { launchId: L.launchId, peM: 120_000, apM: 130_000 });
      now += 18 * 3600 * 1000;
      const before = chips('Gus');
      const r = await settled([1, 2, 3, 4].map(() => p.syncSurvey('Gus')));
      expect(r.err).toEqual([]);
      const paid = r.ok.reduce((s, x) => s + x.paid, 0);
      expect(chips('Gus')).toBe(before + paid);
      const pct = (await p.view('Gus')).survey.maps.find((m) => m.mapType === 'visual')!;
      const expected = [25, 50, 75, 100].filter((m) => m <= pct.milestone).reduce((s, m) => s + ({ 25: 5000, 50: 7500, 75: 10_000, 100: 15_000 } as Record<number, number>)[m]!, 0);
      expect(paid).toBe(expected);
    });

    it('shares satellites, a launch feed and leaderboards across players, without QA accounts', async () => {
      let now = T0;
      const p = await make(mode, () => now);
      for (const n of ['Hal', 'Ivy', 'qa-Bot']) fund(n, 200_000);
      const ids: Record<string, string> = {};
      const d = sciCourier();
      for (const n of ['Hal', 'Ivy', 'qa-Bot']) ids[n] = (await p.launch(n, d)).launchId;
      now += 300_000;
      for (const n of ['Hal', 'Ivy', 'qa-Bot']) {
        await p.deploy(n, { launchId: ids[n]!, peM: 90_000, apM: 95_000 });
        await p.runScience(n, { launchId: ids[n]!, experimentId: 'thermo', partUid: uidOf(d, 'sci-thermo'), situation: 'lowOrbit', metS: 280, alt: 90_000, peM: 80_000, apM: 95_000 });
      }
      now += SPACE_SOCIAL_TTL_MS + 1;
      const v = await p.view('Ivy');
      const s = v.social;
      expect(s.fleet.map((x) => x.ownerName).sort()).toEqual(['Hal', 'Ivy']);
      expect(s.feed.map((x) => x.ownerName).sort()).toEqual(['Hal', 'Ivy']);
      expect(s.feed.every((x) => x.deployed)).toBe(true);
      expect(s.leaders.sats.map((x) => x.name).sort()).toEqual(['Hal', 'Ivy']);
      expect(s.leaders.science.map((x) => x.name).sort()).toEqual(['Hal', 'Ivy']);
      // The QA account still sees its own satellite.
      expect((await p.view('qa-Bot')).sats).toHaveLength(1);
      // Cached: a new launch is not visible until the TTL passes.
      now += SPACE_COOLDOWN_MS;
      expect((await p.social()).feed).toHaveLength(2);
      await p.launch('Hal', courierI());
      expect((await p.social()).feed).toHaveLength(2);
      now += SPACE_SOCIAL_TTL_MS + 1;
      expect((await p.social()).feed).toHaveLength(3);
      expect(SPACE_SOCIAL_MIGRATION).not.toMatch(/DROP/i);
    });
  });
}
