import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const s = readFileSync(new URL('../client/src/lib/resort3d.ts', import.meta.url), 'utf8');
describe('resort marina detail pass', () => {
  it('uses the real fleet boat models, disposed with the map', () => { expect(s).toMatch(/buildBoat\(BOATS\.find/); expect(s).toMatch(/boatModels\.forEach\(disposeTree\)/); expect(s).not.toMatch(/box\(3\.4, 1\.4, len/); });
  it('has piles, cleats, lamps, life rings and a harbourmaster hut with shared geometry', () => { for (const k of ['pileG', 'cleatG', 'lampG', 'ringG', 'harbourmaster']) expect(s).toContain(k); });
});
