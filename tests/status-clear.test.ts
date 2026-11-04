import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// Tess QA #5: a status line must not follow you to another panel/tab/deed.
const cases: Array<[string, string]> = [['FortMcMap', '[panel, tract]'], ['FreightYard', '[tab]'], ['MechanicShop', '[tab, sel]'], ['CookingPanels', '[tab]'], ['WorldMap', '[id]'], ['FleetStore', '[kind]']];
describe('status messages clear on switch', () => {
  for (const [f, deps] of cases) it(f, () => expect(readFileSync(`client/src/components/${f}.tsx`, 'utf8')).toContain(`useEffect(() => setMsg(null), ${deps})`));
});
