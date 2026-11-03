import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// r22: the property deed panel overflowed sideways (values were nowrap in an `auto 1fr` grid).
const css = readFileSync(new URL('../client/src/index.css', import.meta.url), 'utf8');
describe('deed panel fits its width', () => {
  it('values wrap, the grid value column can shrink, and the panel never scrolls sideways', () => {
    expect(css).not.toMatch(/\.world-deed dd[^{]*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.world-deed dd \{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/\.world-deed dl \{ grid-template-columns: max-content minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.world-deed \{ overflow-x: hidden; \}/);
  });
});
