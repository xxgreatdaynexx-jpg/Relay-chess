import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const src = (f: string) => readFileSync(new URL(`../client/src/lib/${f}`, import.meta.url), 'utf8');
describe('resort is tropical, snow stays elsewhere', () => {
  it('resort map has no snow, snowfall or frost', () => {
    const s = src('resort3d.ts');
    expect(s).not.toMatch(/addXmas|xmasOn|xmasGround|snowTextures|SNOW_COUNT/);
    expect(s).not.toMatch(/0xe8eef2|0xf2f6ff/i);
    expect(s).toMatch(/RESORT_SNOW = false/);
    expect(s).toMatch(/[Pp]alm/);
  });
  it('Chud City still gets christmas snow', () => { expect(src('world3d.ts')).toMatch(/addXmas\(scene/); });
  it('Fort McChud keeps its snow patches', () => { expect(src('fortmc3d.ts')).toMatch(/snowM/); });
});
