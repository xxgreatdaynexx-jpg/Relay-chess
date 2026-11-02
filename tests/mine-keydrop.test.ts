import { describe, expect, it } from 'vitest';
import { ItemVault, MINE_DROP_CHANCE } from '../server/skins';

const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };

describe('mines key/chest drop', () => {
  it('is 1% (pt1358u, was 5%)', () => expect(MINE_DROP_CHANCE).toBe(0.01));
  it('forced roll mints a case or key, 50/50, idempotent by source', () => {
    const v = new ItemVault();
    const c = v.dropForMine('QA-Miner', 'mine-drop:a', 'iron', seq(0.005, 0.2));
    expect(c?.kind).toBe('case');
    expect(v.dropForMine('QA-Miner', 'mine-drop:a', 'iron', seq(0.005, 0.2))).toBeNull();
    expect(v.dropForMine('QA-Miner', 'mine-drop:b', 'iron', seq(0.005, 0.9))?.kind).toBe('key');
    expect(v.inventory('QA-Miner').length).toBe(2);
  });
  it('misses at >= 1%', () => {
    const v = new ItemVault();
    expect(v.dropForMine('QA-Miner', 'mine-drop:c', 'iron', seq(0.01))).toBeNull();
    expect(v.owned('QA-Miner').length).toBe(0);
  });
  it('refuses while inventory offline', () => {
    const v = new ItemVault(); v.offline = true;
    expect(v.dropForMine('QA-Miner', 'mine-drop:d', 'iron', seq(0))).toBeNull();
  });
  it('rate ~1% over many rolls', () => {
    const v = new ItemVault();
    let n = 0; for (let i = 0; i < 20000; i++) if (v.dropForMine('QA-Miner', `k${i}`, 'x')) n++;
    expect(n / 20000).toBeGreaterThan(0.006); expect(n / 20000).toBeLessThan(0.014);
  });
});
