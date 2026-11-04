import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// recheck #6: map titles with a subtitle (<small>) read "FORT McCHUD" / "oil sands · tap a site" on two lines, not "McCHUDoil sands".
describe('recheck #6 world title subtitle', () => {
  const css = readFileSync('client/src/index.css', 'utf8');
  it('.world-title small is a block on its own line', () => { const m = /\.world-title small\s*\{([^}]*)\}/.exec(css); expect(m).toBeTruthy(); expect(m![1]).toMatch(/display:\s*block/); });
  it('every <small> subtitle sits inside a .world-title', () => {
    for (const f of ['FortMcMap', 'ResortMap']) expect(readFileSync(`client/src/components/${f}.tsx`, 'utf8')).toMatch(/className="world-title">[^<]*<span>[^<]*<\/span>[^<]*<small>/);
  });
});
