import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Estate } from '../server/estateProjects';
import { setRealEstateForTest, type RealEstate } from '../server/realEstate';
import { getBank, resetBank } from '../server/casino-store';
import { HYPER_STAGES } from '../shared/hyperFarm';

const fakeRE = (map: Record<string, string>) => ({ ownerOf: async (id: string) => (map[id] ? { key: map[id]!.toLowerCase(), name: map[id]! } : null) }) as unknown as RealEstate;
const fullRow = (i: number) => { const st = HYPER_STAGES[i]!; return { chips: st.chips, ...Object.fromEntries(st.goods.map(([id, n]) => [`good:${id}`, n])) }; };

beforeEach(() => { resetBank(); setRealEstateForTest(fakeRE({ 'cf:1005': 'Jay', 'cf:2008': 'Jay', 'f:3': 'Other' })); });
afterEach(() => setRealEstateForTest(null));

async function fundAll(e: Estate, plot: string) {
  await e.startHyper('Jay', plot);
  for (let i = 0; i < HYPER_STAGES.length; i++) {
    const st = HYPER_STAGES[i]!;
    await e.contributeHyper('Jay', plot, 'chips', st.chips);
    for (const [id, n] of st.goods) await e.contributeHyper('Jay', plot, `good:${id}`, n);
  }
}

describe('hyper farm: Finish glasshouse', () => {
  it('a fully funded glasshouse shows 100% / complete and the owner can finish it, once', async () => {
    let t = 1_000; const e = new Estate(null, () => t); getBank().transfer('Jay', 50_000_000, { game: 'admin' });
    await fundAll(e, 'cf:1005');
    let v = e.hyperView('Jay', 'cf:1005');
    expect(v.pct).toBe(1); expect(v.complete).toBe(true); expect(v.finished).toBe(false);
    expect(e.hyperComplete('Jay', 'cf:1005')).toBe(true); // flowers + faster growth do not wait on the button
    const chipsBefore = getBank().account('Jay').chips;
    v = await e.finishHyper('Jay', 'cf:1005');
    expect(v.finished).toBe(true); expect(v.finishedAt).toBe(1_000);
    t = 9_000; v = await e.finishHyper('Jay', 'cf:1005');           // idempotent: same stamp, no charge
    expect(v.finished).toBe(true); expect(v.finishedAt).toBe(1_000);
    expect(getBank().account('Jay').chips).toBe(chipsBefore);
    await expect(e.contributeHyper('Jay', 'cf:1005', 'chips', 1)).rejects.toThrow(/already finished/);
  });

  it('refuses while parts are missing, with how far along it is', async () => {
    const e = new Estate(null); getBank().transfer('Jay', 5_000_000, { game: 'admin' });
    await e.startHyper('Jay', 'cf:2008'); await e.contributeHyper('Jay', 'cf:2008', 'chips', 40_000);
    await expect(e.finishHyper('Jay', 'cf:2008')).rejects.toThrow(/Not finished yet: Beds & service trench still needs parts \(\d+% /);
    expect(e.hyperView('Jay', 'cf:2008').finished).toBe(false);
  });

  it('a stage whose parts are all full never stays current (repairs a stuck save)', async () => {
    const e = new Estate(null);
    await e.startHyper('Jay', 'cf:1005');
    const h = e.hyperOf('Jay', 'cf:1005')!;
    h.done = HYPER_STAGES.map((_, i) => fullRow(i)); h.stage = 2;   // every row full, stage counter behind
    expect(e.hyperComplete('Jay', 'cf:1005')).toBe(true);
    const v = await e.finishHyper('Jay', 'cf:1005');
    expect(v.stage).toBe(HYPER_STAGES.length); expect(v.complete).toBe(true); expect(v.finished).toBe(true);
    expect(e.hyperComplete('Jay', 'cf:1005')).toBe(true);
  });

  it('only the owner can finish', async () => {
    const e = new Estate(null);
    await expect(e.finishHyper('Jay', 'f:3')).rejects.toThrow(/own/);
    await expect(e.finishHyper('Jay', 'cf:2008')).rejects.toThrow(/Start the glasshouse/);
  });
});
