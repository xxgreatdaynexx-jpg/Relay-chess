import { describe, it, expect } from 'vitest';
import { CAVES, ORES, type OreId } from '../shared/mines';
import { MINER_BIAS, minerTable } from '../shared/employment';

const share = (id: 'mine' | 'frost' | 'magma', ores: OreId[]) => CAVES[id].nodes.filter((n) => ores.includes(n.ore)).length / CAVES[id].nodes.length;
const of = (id: 'mine' | 'frost' | 'magma', o: OreId) => share(id, [o]);

describe('cave node spawn bias matches the worker bias (pt1354u)', () => {
  it('signature ores are ~82–86% (pt1357u) of each cave\'s nodes', () => {
    for (const id of ['mine', 'frost', 'magma'] as const) { const s = share(id, Object.keys(MINER_BIAS[id].ores) as OreId[]); expect(s, id).toBeGreaterThanOrEqual(0.8); expect(s, id).toBeLessThanOrEqual(0.9); }
  });
  it('per-ore node shares track the worker table within 4 points', () => {
    for (const id of ['mine', 'frost', 'magma'] as const) for (const [o, w] of minerTable(id)) expect(Math.abs(of(id, o) - w), `${id} ${o}`).toBeLessThan(0.04);
  });
  it('main Mine: iron leads, gold the lightest of the three; Frostbite keeps crystal rare; Magma coal ≈ copper', () => {
    expect(of('mine', 'iron')).toBeGreaterThan(of('mine', 'stone')); expect(of('mine', 'gold')).toBeLessThan(of('mine', 'stone'));
    expect(of('frost', 'silver')).toBeGreaterThan(0.75); expect(of('frost', 'gem')).toBeGreaterThan(0); expect(of('frost', 'gem')).toBeLessThan(0.03);
    expect(Math.abs(of('magma', 'coal') - of('magma', 'copper'))).toBeLessThan(0.03);
  });
  it('prices are untouched', () => { expect(ORES.gem.price).toBe(40); expect(ORES.gold.price).toBe(15); });
  it('respawn time rises with ore value (pt1357u)', () => {
    const ids = (['stone', 'coal', 'copper', 'iron', 'silver', 'gold', 'gem', 'diamond'] as OreId[]);
    for (let i = 1; i < ids.length; i++) { expect(ORES[ids[i]].price).toBeGreaterThan(ORES[ids[i - 1]].price); expect(ORES[ids[i]].respawnMs).toBeGreaterThan(ORES[ids[i - 1]].respawnMs); }
    expect(ORES.stone.respawnMs).toBe(15_000); expect(ORES.diamond.respawnMs).toBe(480_000);
  });
});
