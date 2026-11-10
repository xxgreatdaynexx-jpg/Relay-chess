import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PURCHASE_TAX_PREP_MS, withTimeout } from '../server/purchase-tax';

describe('property buy: purchase-tax prep cannot hang the deed', () => {
  it('prices the tax roster before taking the owner lock or pinning a pool client, and fails closed', () => {
    const src = readFileSync('server/realEstate.ts', 'utf8');
    const buy = src.slice(src.indexOf('async buy('), src.indexOf('async ownedBigFarms('));
    expect(buy.indexOf('preparePurchaseTax')).toBeGreaterThan(0);
    expect(buy.indexOf('preparePurchaseTax')).toBeLessThan(buy.indexOf('this.lock('));
    expect(buy.indexOf('this.pool.connect()')).toBe(-1);
    expect(buy).toMatch(/Nothing was charged/);
    const buyNow = src.slice(src.indexOf('private async buyNow('), src.indexOf('async ownedCount('));
    expect(buyNow).not.toMatch(/preparePurchaseTax/);
    expect(buyNow).toMatch(/this\.pool\.connect\(\)/);
  });

  it('the prep budget is under the 15 s client ack and withTimeout fails promptly', async () => {
    expect(PURCHASE_TAX_PREP_MS).toBeGreaterThanOrEqual(3_000);
    expect(PURCHASE_TAX_PREP_MS).toBeLessThan(15_000);
    const t0 = Date.now();
    await expect(withTimeout(40, () => new Promise(() => {}), 'purchase-tax-prep')).rejects.toThrow(/purchase-tax-prep timed out/);
    expect(Date.now() - t0).toBeLessThan(500);
    await expect(withTimeout(200, async () => 7, 'purchase-tax-prep')).resolves.toBe(7);
  });

  it('the deed Buy button always clears Buying… and a late grant still applies', () => {
    const src = readFileSync('client/src/components/WorldMap.tsx', 'utf8');
    const start = src.indexOf('const act = (ev: \'re_buy\'');
    expect(start).toBeGreaterThan(0);
    const act = src.slice(start, src.indexOf('const buyout', start) > start ? src.indexOf('\n  const buyout', start) : start + 2500);
    // act is after buyout in the file actually — take a window from act to the next const at top level of the function
    const window = src.slice(start, start + 2200);
    expect(window).toMatch(/16_000/);
    expect(window).toMatch(/setBusy\(null\)/);
    expect(window).toMatch(/late success still applies/);
    expect(window).toMatch(/No answer from the server\. Try again\./);
    expect(window.toLowerCase()).not.toMatch(/dayne/);
  });
});
