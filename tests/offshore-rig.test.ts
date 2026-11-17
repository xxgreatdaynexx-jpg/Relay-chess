import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Estate } from '../server/estateProjects';
import { getBank, resetBank } from '../server/casino-store';
import { px } from '../server/price-index';
import { GOODS } from '../shared/mines';
import { RIG_CHIP_STEP, RIG_LAUNCH_FEE, RIG_MAX_PER_PLAYER, RIG_STAGES, rigPct, rigStagePct, rigStageValue } from '../shared/offshoreRig';

const price = (id: string) => GOODS[id]?.price ?? 0;

beforeEach(() => { resetBank(); });

describe('offshore rig construction', () => {
  it('10,000 chips is not a server cap; a larger contribution is accepted and clamped only to leftover', async () => {
    const e = new Estate(null);
    getBank().transfer('Jay', 50_000_000, { game: 'admin' });
    const started = await e.startRig('Jay');
    const st = RIG_STAGES[0]!;
    const first = await e.contributeRig('Jay', started.id, 'chips', 50_000);
    expect(first.done[0]!.chips).toBe(50_000);
    expect(first.stage).toBe(0);
    const second = await e.contributeRig('Jay', started.id, 'chips', 10_000);
    expect(second.done[0]!.chips).toBe(60_000);
    const rest = st.chips - 60_000;
    const filled = await e.contributeRig('Jay', started.id, 'chips', rest + 99_999);
    expect(filled.done[0]!.chips).toBe(st.chips);
    await expect(e.contributeRig('Jay', started.id, 'chips', RIG_CHIP_STEP)).rejects.toThrow(/already full/);
  });

  it('filling chips alone does not finish a stage; materials plus chips do', async () => {
    const e = new Estate(null);
    getBank().transfer('Jay', 80_000_000, { game: 'admin' });
    const started = await e.startRig('Jay');
    const st = RIG_STAGES[0]!;
    let v = await e.contributeRig('Jay', started.id, 'chips', st.chips);
    expect(v.stage).toBe(0);
    expect(v.status).toBe('building');
    expect(v.label).toMatch(/Hull/);
    for (const [gid, n] of st.goods) v = await e.contributeRig('Jay', started.id, gid, n);
    expect(v.stage).toBe(1);
    expect(v.status).toBe('building');
    expect(v.label).toMatch(/Derrick/);
  });

  it('a fully funded rig can launch, and the launch fee is charged', async () => {
    const e = new Estate(null);
    const bank = getBank();
    bank.transfer('Jay', 200_000_000, { game: 'admin' });
    const started = await e.startRig('Jay');
    let last = started;
    for (let i = 0; i < RIG_STAGES.length; i++) {
      const st = RIG_STAGES[i]!;
      last = await e.contributeRig('Jay', started.id, 'chips', st.chips);
      for (const [gid, n] of st.goods) last = await e.contributeRig('Jay', started.id, gid, n);
    }
    expect(last.status).toBe('ready');
    const before = bank.account('Jay').chips;
    const launched = await e.launchRig('Jay', started.id);
    expect(launched.status).toBe('launched');
    expect(launched.label).toBe('On station');
    expect(before - bank.account('Jay').chips).toBe(px(RIG_LAUNCH_FEE));
  });

  it('reports value-weighted progress for a stage and the whole rig', () => {
    const st = RIG_STAGES[0]!;
    expect(rigStagePct(st, {}, price)).toBe(0);
    expect(rigStagePct(st, { chips: st.chips }, price)).toBeCloseTo(st.chips / rigStageValue(st, price), 6);
    expect(rigPct(0, [], price)).toBe(0);
    expect(rigPct(RIG_STAGES.length, [], price, 'ready')).toBe(1);
    expect(rigPct(RIG_STAGES.length, [], price, 'launched')).toBe(1);
    const mid = rigPct(2, [], price); expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(1);
  });

  it('refuses a fourth rig', async () => {
    const e = new Estate(null);
    getBank().transfer('Jay', 1_000_000, { game: 'admin' });
    for (let i = 0; i < RIG_MAX_PER_PLAYER; i++) await e.startRig('Jay');
    await expect(e.startRig('Jay')).rejects.toThrow(/at most 3/);
  });
});
