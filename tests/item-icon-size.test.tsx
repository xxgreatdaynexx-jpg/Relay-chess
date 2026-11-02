import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'fs';
import { GOODS, ORES } from '../shared/mines';
import { itemIconSvg } from '../shared/itemIcons';
import { ItemIcon } from '../client/src/components/ItemIcon';

const ALL = () => [...Object.keys(ORES).map((i) => itemIconSvg('ore', i)), ...Object.values(GOODS).map((g) => itemIconSvg(g.type, g.id)), itemIconSvg('bar', 'no_such_item')];

describe('item icon svgs and sizing', () => {
  it('no element repeats an attribute (duplicate stroke-width made ore icons broken images)', () => {
    for (const s of ALL()) for (const tag of s.match(/<[a-zA-Z][^>]*>/g) ?? []) {
      const names = [...tag.matchAll(/\s([a-zA-Z:-]+)="/g)].map((m) => m[1]);
      expect(new Set(names).size, tag).toBe(names.length);
    }
  });
  it('every svg, including the fallback crate, has explicit width and height', () => {
    for (const s of ALL()) expect(s).toMatch(/^<svg [^>]*\bwidth="24"[^>]*\bheight="24"[^>]*>/);
  });
  it('ItemIcon sets inline size and --ii (default 20)', () => {
    const d = renderToStaticMarkup(<ItemIcon type="ore" id="copper" />);
    expect(d).toMatch(/width="20"/); expect(d).toMatch(/height="20"/); expect(d).toMatch(/width:20px/); expect(d).toMatch(/--ii:20px/);
    const c = renderToStaticMarkup(<ItemIcon k="stack:good:bread" size={28} />);
    expect(c).toMatch(/width:28px/); expect(c).toMatch(/--ii:28px/);
  });
  it('css sizes .item-icon from var(--ii, 20px), never width:auto', () => {
    const rule = /\.item-icon \{[^}]*\}/.exec(fs.readFileSync('client/src/index.css', 'utf8'))![0];
    expect(rule).not.toMatch(/width:\s*auto/);
    expect(rule).toMatch(/width:\s*var\(--ii,\s*20px\)/); expect(rule).toMatch(/height:\s*var\(--ii,\s*20px\)/);
  });
});
