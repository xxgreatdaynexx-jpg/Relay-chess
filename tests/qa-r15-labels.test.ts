import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dimColor, labelScaleFor, LABEL_MAX_LUMA } from '../client/src/lib/labelSprite';
const src = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const luma = (n: number) => { const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255; return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const hex = (v: string | number) => typeof v === 'number' ? v : parseInt(String(v).replace('#', ''), 16);
describe('r15 building labels', () => {
  it('texture is crisp: mipmaps, premultiplied alpha, anisotropy', () => {
    const s = src('client/src/lib/labelSprite.ts');
    for (const k of ['generateMipmaps', 'LinearMipmapLinearFilter', 'anisotropy', 'premultiplyAlpha', 'toneMapped: false', 'LABEL_LAYER']) expect(s).toContain(k);
  });
  it('scale follows DPR, clamped 2..3', () => { expect(labelScaleFor(1)).toBe(2); expect(labelScaleFor(2.5)).toBe(3); expect(labelScaleFor(4)).toBe(3); });
  it('dimmed colours stay below the luma cap', () => { for (const c of ['#6ad66a', '#ffffff', '#ff4fd8']) expect(luma(hex(dimColor(c, 0.6)))).toBeLessThanOrEqual(LABEL_MAX_LUMA + 1e-6); });
  it('world and resort render labels outside bloom', () => {
    for (const f of ['client/src/lib/world3d.ts', 'client/src/lib/resort3d.ts']) { const s = src(f); expect(s).toContain('renderScene('); expect(s).toContain('asLabel('); expect(s).not.toMatch(/shadowBlur/); }
  });
});
