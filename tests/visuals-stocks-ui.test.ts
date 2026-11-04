import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const css = readFileSync('client/src/index.css', 'utf8'), ic = readFileSync('client/src/components/stocks/InvestChart.tsx', 'utf8');
describe('stock UI polish', () => {
  it('title stays on one line and the tab row fades at the clipped end', () => { expect(css).toMatch(/\.mkt-win \.inv-head h2 \{[^}]*nowrap/); expect(css).toMatch(/stk-nav \{[^}]*mask-image/); });
  it('negative EPS reads 🪙 −1.58, sign after the coin', () => { expect(ic).toContain("`🪙 ${s.eps < 0 ? '−' : ''}"); });
});
