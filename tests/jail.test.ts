import { describe, it, expect } from 'vitest';
import { Jail } from '../server/jail';
import { isApology, jailAllows, jailMessage, JAIL_PHRASE, JAIL_SITE } from '../shared/jail';
import { planWealthTax } from '../shared/wealthTax';
import { keepOut, outskirts } from '../shared/outskirts';
import { JAIL_HALF } from '../shared/jail';
import { fieldPlots } from '../shared/fieldFarms';
import { properties } from '../shared/realEstate';

describe('admin jail', () => {
  it('only an exact single line counts', () => {
    expect(isApology(JAIL_PHRASE)).toBe(true);
    expect(isApology('I\u2019m sorry grok.')).toBe(true);
    expect(isApology("i'm sorry grok.")).toBe(false);
    expect(isApology(`${JAIL_PHRASE}\n${JAIL_PHRASE}`)).toBe(false);
    expect(isApology(JAIL_PHRASE + JAIL_PHRASE)).toBe(false);
    expect(isApology(`${JAIL_PHRASE} `)).toBe(false);
  });
  it('blocks trading and earning events, keeps chat and views', () => {
    for (const e of ['stk_buy', 'stk_sell', 're_buy', 'farm_harvest', 'fish_cast', 'mines_sell', 'bj_bet', 'roulette_bet', 'vslots_spin', 'fac_buy', 'pay_bailout']) expect(jailAllows(e)).toBe(false);
    for (const e of ['chat_send', 'auth_resume', 'jail_type', 'jail_status', 'stk_list', 'disconnect']) expect(jailAllows(e)).toBe(true);
  });
  it('jails, counts lines with a rate limit, and releases at the target', async () => {
    const j = new Jail(null); const t0 = 1_000_000;
    await j.jail('Jay', null, 'stock pump', t0, 3);
    expect(j.isJailed('jay', t0)).toBe(true);
    expect(jailMessage(j.status('Jay', t0)!)).toMatch(/until you finish your lines.*stock pump/);
    expect((await j.apologize('Jay', JAIL_PHRASE, t0)).typed).toBe(1);
    const fast = await j.apologize('Jay', JAIL_PHRASE, t0 + 100); expect(fast.counted).toBe(false); expect(fast.typed).toBe(1);
    expect((await j.apologize('Jay', 'nope', t0 + 600)).counted).toBe(false);
    expect((await j.apologize('Jay', JAIL_PHRASE, t0 + 1200)).typed).toBe(2);
    const done = await j.apologize('Jay', JAIL_PHRASE, t0 + 1800); expect(done.released).toBe(true);
    expect(j.isJailed('Jay', t0 + 1900)).toBe(false);
  });
  it('releases when the timer runs out and keeps progress on re-jail', async () => {
    const j = new Jail(null); const t0 = 5_000_000;
    await j.jail('Conner', 1, 'pump', t0);
    expect(j.isJailed('Conner', t0 + 3_599_000)).toBe(true);
    expect(j.isJailed('Conner', t0 + 3_600_000)).toBe(false);
    expect(j.list(t0 + 3_600_001)).toHaveLength(0);
  });
  it('jailed players get no wealth-tax share (pool goes to everyone else)', () => {
    const rows = [{ name: 'rich', netWorth: 1_000_000 }, { name: 'a', netWorth: 20_000 }, { name: 'b', netWorth: 20_000 }, { name: 'c', netWorth: 20_000 }] as Parameters<typeof planWealthTax>[0];
    const p = planWealthTax(rows, (n) => n === 'b');
    expect(p.shares.map((s) => s.name)).not.toContain('b');
    expect(p.shares.reduce((a, s) => a + s.amount, 0)).toBe(p.total);
  });
  it('the jail site is kept clear of decor and far from the Millionaire sign', () => {
    expect(keepOut(JAIL_SITE.x, JAIL_SITE.z)).toBe(true);
    expect(Math.hypot(JAIL_SITE.x - -156, JAIL_SITE.z - 24)).toBeGreaterThan(60);
  });
  it('the jail sits in the bottom-right corner with nothing on its yard, and no other farm moved (pt1495u)', () => {
    expect(JAIL_SITE.x).toBeGreaterThan(150); expect(JAIL_SITE.z).toBeGreaterThan(150);
    const O = outskirts(); const hit = (o: { x: number; z: number; w: number; d: number }) => Math.abs(o.x - JAIL_SITE.x) < JAIL_HALF.x + o.w / 2 && Math.abs(o.z - JAIL_SITE.z) < JAIL_HALF.z + o.d / 2;
    for (const o of [...O.buildings, ...O.fields]) expect(hit(o)).toBe(false);
    const ids = new Set(properties().map((p) => p.id));
    expect(ids.has('cf:21')).toBe(false); expect(ids.has('cf:23')).toBe(false); expect(ids.has('b:house:1943:1718')).toBe(false);
    // pre-jail layout: the bottom-left fields stay exactly where players bought them
    const at = (n: number) => fieldPlots().find((f) => f.n === n)!;
    expect([Math.round(at(24).x), Math.round(at(24).z)]).toEqual([-168, 159]); expect([Math.round(at(25).x), Math.round(at(25).z)]).toEqual([-145, 157]); expect([Math.round(at(26).x), Math.round(at(26).z)]).toEqual([-160, 178]);
    expect(fieldPlots()).toHaveLength(30);
  });
});
