import { afterEach, describe, expect, it } from 'vitest';
import { Estate, EstateError } from '../server/estateProjects.ts';
import { setRealEstateForTest, type RealEstate } from '../server/realEstate.ts';
import { DIGITAL_DAILY_BASE, GPU_RIG, SERVER_RACK, digitalPayout, throttle } from '../shared/estateProjects.ts';

function fakeRE(map: Record<string, string>): RealEstate {
  return {
    ownerOf: async (id: string) => {
      const name = map[id];
      return name ? { key: name.toLowerCase(), name } : null;
    },
  } as unknown as RealEstate;
}

describe('estate deed ownership', () => {
  afterEach(() => setRealEstateForTest(null));

  it('rejects choosing a project on a lot you do not own or that is unsold', async () => {
    setRealEstateForTest(fakeRE({ 'lot:estate:1': 'Ann' }));
    const e = new Estate(null);
    await expect(e.choose('Bob', 'lot:estate:1', 'bitcoin_farm')).rejects.toThrow(EstateError);
    await expect(e.choose('Bob', 'lot:estate:1', 'bitcoin_farm')).rejects.toThrow(/do not own/);
    await expect(e.choose('Ann', 'lot:estate:2', 'bitcoin_farm')).rejects.toThrow(/do not own/);
    const site = await e.choose('Ann', 'lot:estate:1', 'bitcoin_farm');
    expect(site.build).toBe('bitcoin_farm');
    expect(site.stage).toBe(0);
  });

  it('rejects converting a farm you do not own into a hyper farm', async () => {
    setRealEstateForTest(fakeRE({ 'cf:2000': 'Ann' }));
    const e = new Estate(null);
    await expect(e.startHyper('Bob', 'cf:2000')).rejects.toThrow(/do not own/);
    await expect(e.startHyper('Ann', 'cf:2000')).resolves.toMatchObject({ plotId: 'cf:2000', stage: 0 });
  });

  it('rejects demolishing a property you do not own', async () => {
    setRealEstateForTest(fakeRE({ 'lot:estate:1': 'Ann' }));
    const e = new Estate(null);
    await expect(e.demolish('Bob', 'lot:estate:1', true)).rejects.toThrow(/do not own/);
  });
});

describe('estate input and payout guards', () => {
  afterEach(() => setRealEstateForTest(null));

  it('rejects negative, zero and fractional contribute and gear quantities', async () => {
    const e = new Estate(null);
    await e.choose('Ann', 'lot:estate:7', 'bitcoin_farm');
    for (const q of [0, -1, -1000, 1.5, NaN, Infinity, 'abc', null]) {
      await expect(e.contribute('Ann', 'lot:estate:7', 'chips', q)).rejects.toThrow();
    }
    await expect(e.buyGear('Ann', 'lot:estate:7', 1)).rejects.toThrow(/Finish construction/);
    await expect(e.buyGear('Ann', 'lot:estate:7', -1)).rejects.toThrow();
    await expect(e.setGrid('Ann', -10)).rejects.toThrow();
    await expect(e.setGrid('Ann', 401)).rejects.toThrow();
  });

  it('the daily digital cap and 24-hour settle window cannot be exceeded by the payout helpers', () => {
    const farmDay = GPU_RIG.chipsPerHour * GPU_RIG.max * 24;
    const dcDay = SERVER_RACK.chipsPerHour * SERVER_RACK.max * 24;
    expect(farmDay + dcDay).toBeLessThanOrEqual(DIGITAL_DAILY_BASE);
    expect(digitalPayout(farmDay + dcDay, 0, DIGITAL_DAILY_BASE)).toBe(farmDay + dcDay);
    expect(digitalPayout(farmDay + dcDay, DIGITAL_DAILY_BASE, DIGITAL_DAILY_BASE)).toBe(0);
    expect(digitalPayout(50_000, DIGITAL_DAILY_BASE - 10_000, DIGITAL_DAILY_BASE)).toBe(10_000);
    // throttle never exceeds 1, and is 0 with no supply
    expect(throttle(0, 24)).toBe(0);
    expect(throttle(48, 24)).toBe(1);
    expect(throttle(12, 24)).toBe(0.5);
  });
});
