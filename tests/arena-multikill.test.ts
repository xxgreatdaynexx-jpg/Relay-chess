import { describe, expect, it } from 'vitest';
import { MULTI_WINDOW_MS, multiTier, nextChain } from '../shared/arenaMulti';
import { feedParts, popupScale } from '../client/src/lib/arenaFeed';
import { ArenaWorld, type ArenaEvent } from '../server/arena-world';
import { gridMap } from '../shared/fps';

const OPEN = gridMap(['##############', ...Array(4).fill('#............#'), '##############']);
function setup(victims = 8) {
  const w = new ArenaWorld(OPEN, () => 0.5);
  w.join('k', 'dayne', 0);
  for (let i = 0; i < victims; i++) w.join(`v${i}`, `v${i}`, 0);
  const dmg = w as unknown as { damage(by: string | null, t: string, amt: number, now: number, cause: string, head?: boolean): ArenaEvent[] };
  const kill = (i: number, now: number, cause = 'rifle', head = false) => dmg.damage('k', `v${i}`, 999, now, cause, head);
  return { w, kill };
}
const multis = (ev: ArenaEvent[]) => ev.filter((e) => e.ev === 'fps_multi');

describe('multi-kill chain', () => {
  it('exactly 5 s still chains; 5 s + 1 ms resets', () => {
    expect(MULTI_WINDOW_MS).toBe(5000);
    expect(nextChain({ n: 1, at: 1000 }, 6000)).toEqual({ n: 2, at: 6000 });
    expect(nextChain({ n: 4, at: 1000 }, 6001)).toEqual({ n: 1, at: 6001 });
    expect(nextChain({ n: 1, at: 1000 }, 4500)).toEqual({ n: 2, at: 4500 }); // 3.5 s now chains
  });
  it('the window restarts on every kill', () => {
    let c = nextChain(undefined, 0);
    for (const t of [2900, 5800, 8700]) c = nextChain(c, t);
    expect(c.n).toBe(4);
  });
  it('tier mapping, 6+ repeats MULTI', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 12].map(multiTier)).toEqual([null, 'double', 'triple', 'quadra', 'penta', 'multi', 'multi', 'multi']);
  });
  it('server: chained kills emit tiers, gap resets', () => {
    const { kill } = setup();
    expect(multis(kill(0, 1000))).toHaveLength(0);
    expect(multis(kill(1, 6000))[0].data).toMatchObject({ name: 'dayne', tier: 'double', title: 'DOUBLE KILL' });
    expect(multis(kill(2, 11001))).toHaveLength(0);
    expect(multis(kill(3, 11500))[0].data.tier).toBe('double');
  });
  it('server: 6th and 7th chained kills are MULTI', () => {
    const { kill } = setup();
    const tiers = [0, 1, 2, 3, 4, 5, 6].map((i) => multis(kill(i, 1000 + i * 500))[0]?.data.tier ?? null);
    expect(tiers).toEqual([null, 'double', 'triple', 'quadra', 'penta', 'multi', 'multi']);
  });
  it('bot victims count toward the pop-up', () => {
    const { w, kill } = setup(2);
    for (const id of ['v0', 'v1']) Object.assign((w as unknown as { fighters: Map<string, object> }).fighters.get(id)!, { bot: true });
    kill(0, 1000);
    expect(multis(kill(1, 1500))[0].data.tier).toBe('double');
  });
  it('sound cue goes only to the killer; the feed line is broadcast', () => {
    const { kill } = setup();
    kill(0, 1000);
    const ev = kill(1, 1200);
    const me = ev.find((e) => e.ev === 'fps_multi_me')!;
    expect(me.to).toBe('k');
    expect(me.data.sound).toBe('double');
    expect(multis(ev)[0].to).toBeUndefined();
    expect(ev.filter((e) => e.data.sound !== undefined && e.to !== 'k')).toHaveLength(0);
  });
});

describe('headshot kill flag', () => {
  const killEv = (cause: string, head: boolean) => setup(1).kill(0, 1000, cause, head).find((e) => e.ev === 'fps_kill')!.data;
  it('head hit → headshot true', () => expect(killEv('sniper', true).headshot).toBe(true));
  it('body hit → no headshot', () => expect(killEv('rifle', false).headshot).toBeUndefined());
  it('splash / rocket → no headshot', () => {
    const { w } = setup(1);
    const ev = (w as unknown as { damage(...a: unknown[]): ArenaEvent[] }).damage('k', 'v0', 999, 1000, 'rocket');
    expect(ev.find((e) => e.ev === 'fps_kill')!.data.headshot).toBeUndefined();
  });
});

describe('feed rendering', () => {
  const base = { key: 1, killer: 'dayne', victim: 'rook', cause: 'sniper', self: false, mine: true };
  it('headshot icon sits between weapon and victim', () => {
    expect(feedParts({ ...base, head: true }).map((p) => p.t)).toEqual(['killer', 'weapon', 'head', 'victim']);
  });
  it('body kill has no icon', () => expect(feedParts(base).map((p) => p.t)).toEqual(['killer', 'weapon', 'victim']));
  it('suicide never shows headshot', () => expect(feedParts({ ...base, self: true, head: true }).map((p) => p.t)).toEqual(['weapon', 'victim']));
  it('multi line reads "dayne — TRIPLE KILL"', () => {
    const parts = feedParts({ ...base, multi: 'TRIPLE KILL' });
    expect(parts.map((p) => ('text' in p ? p.text : '')).join(' ')).toBe('dayne — TRIPLE KILL');
  });
  it('pop-up grows per tier', () => {
    const s = [1, 2, 3, 4, 5].map(popupScale);
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1]);
  });
});
