import { describe, it, expect } from 'vitest';
import {
  MINER_CAVES, minerTable, minerPickTable, minerItemEv, minerPriorityOptions, parseMinerPriority,
  rollOre, PRIORITY_FOCUS,
} from '../shared/employment';
import { ORES, type OreId } from '../shared/mines';

// re-export helper via table EV
const ev = (t: Array<[OreId, number]>) => t.reduce((a, [o, w]) => a + ORES[o].price * w, 0);
function seeded(s: number) { return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

describe('miner priority (value-neutral reweight)', () => {
  it('Balanced equals the current minerTable exactly', () => {
    for (const c of MINER_CAVES) {
      expect(minerPickTable(c, null)).toEqual(minerTable(c));
      expect(ev(minerPickTable(c, null))).toBeCloseTo(minerItemEv(c), 12);
    }
  });

  it('lists only ores the cave actually yields; quarry is stone-only', () => {
    expect(minerPriorityOptions('quarry')).toEqual(['stone']);
    for (const c of MINER_CAVES) {
      const opts = minerPriorityOptions(c);
      expect(opts.length).toBeGreaterThan(0);
      for (const o of opts) expect(minerTable(c).some(([x]) => x === o)).toBe(true);
    }
  });

  it('raises the chosen ore share without raising expected value above Balanced', () => {
    for (const c of MINER_CAVES) {
      const base = minerTable(c); const baseEv = ev(base);
      for (const o of minerPriorityOptions(c)) {
        const t = minerPickTable(c, o);
        const baseShare = base.find(([x]) => x === o)?.[1] ?? 0;
        const newShare = t.find(([x]) => x === o)?.[1] ?? 0;
        expect(newShare).toBeGreaterThanOrEqual(baseShare - 1e-12);
        expect(ev(t)).toBeLessThanOrEqual(baseEv + 1e-9);
        expect(t.reduce((a, [, w]) => a + w, 0)).toBeCloseTo(1, 9);
      }
    }
  });

  it('does not inflate value or volume: EV ≤ Balanced; one pick still one ore', () => {
    expect(PRIORITY_FOCUS).toBeGreaterThan(1);
    for (const c of ['mine', 'frost', 'magma'] as const) {
      const baseEv = minerItemEv(c);
      // prioritize the most expensive option in the table
      const rich = [...minerPriorityOptions(c)].sort((a, b) => ORES[b].price - ORES[a].price)[0]!;
      expect(ev(minerPickTable(c, rich))).toBeLessThanOrEqual(baseEv + 1e-9);
      const u = seeded(11); const N = 40_000; let v = 0; const counts: Partial<Record<OreId, number>> = {};
      for (let i = 0; i < N; i++) { const o = rollOre(c, u, rich); counts[o] = (counts[o] ?? 0) + 1; v += ORES[o].price; }
      expect(v / N).toBeLessThanOrEqual(baseEv * 1.03); // sampling slack
      expect((counts[rich] ?? 0) / N).toBeGreaterThan((minerTable(c).find(([o]) => o === rich)?.[1] ?? 0) - 0.02);
    }
  });

  it('parseMinerPriority accepts Balanced / cave ores and rejects unknowns', () => {
    expect(parseMinerPriority('mine', null)).toBeNull();
    expect(parseMinerPriority('mine', 'balanced')).toBeNull();
    expect(parseMinerPriority('mine', 'iron')).toBe('iron');
    expect(parseMinerPriority('mine', 'not_an_ore')).toBeNull();
    expect(parseMinerPriority('quarry', 'stone')).toBe('stone');
    expect(parseMinerPriority('quarry', 'iron')).toBeNull();
  });
});
