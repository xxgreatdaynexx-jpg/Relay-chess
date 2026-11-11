import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fieldPlots, allFieldPlots, fieldPlotId } from '../shared/fieldFarms.js';
import { farmPlots, plotId } from '../shared/farm.js';

const src = readFileSync(new URL('../client/src/lib/world3d.ts', import.meta.url), 'utf8');

describe('countryside field farms render like the Farm district (snow map stripes bug)', () => {
  it('the farm renderer (soil, furrows, fence, crops, setFarm) uses allFarmPlots, which includes every cf: field', () => {
    expect(src).toMatch(/const plots = allFarmPlots\(\); const d/);
    expect(src).toMatch(/new Map\(allFarmPlots\(\)\.map\(\(p\) => \[p\.id, p\]\)\)/);
    const decl = src.match(/export const allFarmPlots = \(\) => (.*);/)![1];
    expect(decl).toContain('allFieldPlots()'); // outskirts fields + Big Farms expect(decl).toContain('fieldPlotId');
    expect(fieldPlots().length).toBeGreaterThan(0);
    const ids = [...farmPlots().map((p) => plotId(p.n)), ...allFieldPlots().map((p) => fieldPlotId(p.n))]; expect(allFieldPlots().length).toBe(fieldPlots().length + 12 + 10);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('the old flat green crop-row slabs for O.fields are gone', () => {
    expect(src).not.toMatch(/for \(const f of O\.fields\)/);
    expect(src).not.toMatch(/0x3f8a3a, 0x8a7a3a, 0x2f7a36, 0x6a8a34/);
  });
});
