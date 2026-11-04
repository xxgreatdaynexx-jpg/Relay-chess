import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore } from '../server/casino-store';
import { Fishing, type FishRng } from '../server/fishing';
import { FishPan } from '../server/fishPan';
import { Reel, fishById, sizeFrac, FISH_DAILY_MAX } from '../shared/fishing';
import { Pan, judge, replayCook, cookedValue, doneWindow, OUTCOME_MULT } from '../shared/fishPan';
import { SKILLS } from '../shared/skills';
import { CAPS } from '../server/skills';

const T0 = Date.parse('2026-11-01T12:00:00Z');
function playReel(seed: number, diff: number) { const r = new Reel(seed, diff); let s = ''; while (!r.s.done) { const h = r.s.x < r.s.c - 0.35 * r.s.v; s += h ? '1' : '0'; r.tick(h); } return s; }
/** A decent cook: medium-high heat, flip when the bottom is done, plate when the other side is. */
export function cookWell(seed: number, thick: number, target = 1): string {
  const p = new Pan(seed, thick); let s = '2'; p.tick('2');
  while (p.s.down < target && s.length < 800) { s += '2'; p.tick('2'); }
  s += 'f'; p.tick('f');
  while (p.s.down < target - 0.02 && s.length < 880) { s += '2'; p.tick('2'); }
  return s;
}
async function setup(level = 1) {
  const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
  const bank = new CasinoBank(); bank.retryMs = []; await bank.attach(new PgCasinoStore(pool));
  let now = T0; const rng: FishRng = { unit: () => 0.5, int: (lo) => (lo === 1 ? 42 : 2000) }; // u=0.5 → common
  const f = new Fishing(pool, () => bank, () => now, rng); await f.init();
  let lvl = level; const c = new FishPan(pool, async () => lvl, () => now, () => 7);
  const adv = (ms: number) => { now += ms; };
  const catchOne = async (name: string) => { const { biteIn } = await f.cast(name); adv(biteIn + 100); const h = f.hook(name); const inp = playReel(h.seed, h.diff); adv(inp.length * 50 + 1300); const r = await f.land(name, inp); return r.fish!; };
  return { db, pool, bank, f, c, adv, catchOne, setLevel: (n: number) => { lvl = n; } };
}

describe('cooking rules', () => {
  it('is a skill with caps', () => { expect(SKILLS.some((s) => s.id === 'cooking')).toBe(true); expect(CAPS.cooking.hour).toBeGreaterThan(0); });
  it('sim: good timing cooks, ignoring it burns or undercooks, level widens the window', () => {
    expect(replayCook(7, 0.5, 1, cookWell(7, 0.5))).toMatch(/perfect|good/);
    expect(replayCook(7, 0.5, 1, '3'.repeat(400) + 'f' + '3'.repeat(400))).toBe('burnt');
    expect(replayCook(7, 0.5, 1, '2'.repeat(50))).toBe('undercooked');
    expect(replayCook(7, 0.5, 1, '2'.repeat(150))).not.toMatch(/good|perfect/); // never flipped
    expect(replayCook(7, 0.5, 1, 'x1')).toBe('invalid'); expect(replayCook(7, 0.5, 1, '')).toBe('invalid');
    expect(doneWindow(99)).toBeGreaterThan(doneWindow(1));
    // an over-cooked timeline: burnt at level 1, saved at 99
    const over = cookWell(7, 0.5, 1.17); expect(replayCook(7, 0.5, 1, over)).toBe('burnt'); expect(replayCook(7, 0.5, 99, over)).toMatch(/good|perfect/);
    const p = new Pan(7, 0.5); for (const ch of cookWell(7, 0.5)) p.tick(ch); expect(judge(p.s, 1)).not.toBe('burnt');
  });
  it('value bonus is modest and burnt is a loss', () => {
    expect(OUTCOME_MULT.perfect).toBeLessThanOrEqual(1.5); expect(cookedValue(10, 'burnt')).toBe(2); expect(cookedValue(10, 'good')).toBe(13);
  });
});

describe('FishPan server', () => {
  it('cooks an owned raw fish exactly once and the dish sells through the capped fish market', async () => {
    const { f, c, adv, catchOne, bank } = await setup();
    const fish = await catchOne('Cook1'); const sp = fishById(fish.fish)!;
    const s = await c.start('Cook1', fish.id); const inp = cookWell(s.seed, s.thick);
    await expect(c.plate('Cook1', inp)).rejects.toThrow(/slipped/); // faster than real time
    const s2 = await c.start('Cook1', fish.id); expect(s2.thick).toBeCloseTo(sizeFrac(sp, fish.grams));
    adv(inp.length * 100); const r = await c.plate('Cook1', inp);
    expect(['perfect', 'good']).toContain(r.outcome); expect(r.value).toBe(cookedValue(fish.value, r.outcome)); expect(r.raw).toBe(fish.value);
    await expect(c.start('Cook1', fish.id)).rejects.toThrow(/already cooked/);
    await expect(c.plate('Cook1', inp)).rejects.toThrow(/Nothing in the pan/);
    const pan = await c.pantry('Cook1'); expect(pan.items[0]!.dish).toBe(r.dish); expect(pan.items[0]!.raw).toBe(fish.value);
    expect((await f.view('Cook1')).best).toBeTruthy();
    const sold = await f.sell('Cook1'); expect(sold.gross).toBe(Math.floor(r.value * 1.5)); // +50% cooking buff expect(sold.paid).toBeLessThanOrEqual(FISH_DAILY_MAX);
    expect(bank.account('Cook1').chips).toBeGreaterThan(0);
    await expect(c.start('Cook1', fish.id)).rejects.toThrow(/isn't in your cooler/);
  });
  it('pan dishes count toward the one shared cooking-sales cap (kitchen_daily), and stay unsold once it is full', async () => {
    const { f, c, adv, catchOne, pool } = await setup();
    const day = new Date(T0).toISOString().slice(0, 10);
    const a = await catchOne('Cook3'); const s = await c.start('Cook3', a.id); const inp = cookWell(s.seed, s.thick); adv(inp.length * 100); const r = await c.plate('Cook3', inp);
    const sold = await f.sell('Cook3', [a.id]); expect(sold.gross).toBe(Math.floor(r.value * 1.5));
    const k = (await pool.query('SELECT gross, paid FROM kitchen_daily WHERE player_key = $1 AND day = $2', ['cook3', day])).rows[0];
    expect(Number(k.gross)).toBe(Math.floor(r.value * 1.5)); expect(Number(k.paid)).toBe(sold.paid);
    const fd = (await pool.query('SELECT gross FROM fish_daily WHERE player_key = $1 AND day = $2', ['cook3', day])).rows[0]; expect(Number(fd?.gross ?? 0)).toBe(0);
    await pool.query('UPDATE kitchen_daily SET gross = 100000 WHERE player_key = $1 AND day = $2', ['cook3', day]);
    const b = await catchOne('Cook3'); const s2 = await c.start('Cook3', b.id); const inp2 = cookWell(s2.seed, s2.thick); adv(inp2.length * 100); await c.plate('Cook3', inp2);
    await expect(f.sell('Cook3', [b.id])).rejects.toThrow(/cooking sales cap/);
    expect((await f.view('Cook3')).cooler.some((x) => x.id === b.id)).toBe(true);
  });
  it('refuses other players fish, bad ids, locked recipes, sold fish mid-cook and concurrent plates', async () => {
    const { f, c, adv, catchOne, setLevel } = await setup();
    const fish = await catchOne('Cook2');
    await expect(c.start('Other', fish.id)).rejects.toThrow(/isn't in your cooler/);
    await expect(c.start('Cook2', 42)).rejects.toThrow(/Pick a fish/);
    // locked recipe: a common fish needs level 1, so fake an uncommon by level 0 check via setLevel(0)
    setLevel(0); await expect(c.start('Cook2', fish.id)).rejects.toThrow(/Cooking level/); setLevel(1);
    const s = await c.start('Cook2', fish.id); const inp = cookWell(s.seed, s.thick); adv(inp.length * 100);
    const [a, b] = await Promise.allSettled([c.plate('Cook2', inp), c.plate('Cook2', inp)]);
    expect([a.status, b.status].filter((x) => x === 'fulfilled').length).toBe(1);
    const fish2 = await catchOne('Cook2'); const s3 = await c.start('Cook2', fish2.id); await f.sell('Cook2', [fish2.id]);
    const inp3 = cookWell(s3.seed, s3.thick); adv(inp3.length * 100); await expect(c.plate('Cook2', inp3)).rejects.toThrow(/gone/);
  });
});
