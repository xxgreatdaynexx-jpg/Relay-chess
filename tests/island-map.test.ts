import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ISLAND_BEACH_R, ISLAND_CENTER, ISLAND_DOCK, ISLAND_GRASS_R, ISLAND_LAND_R, ISLAND_LOTS, ISLAND_MAP, ISLAND_PLACES, islandMapPos, islandSpots } from '../shared/island';

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('private island map', () => {
  it('lists every estate plus the dock', () => {
    const spots = islandSpots();
    expect(spots.filter((s) => s.kind === 'estate').map((s) => s.id).sort()).toEqual(ISLAND_LOTS.map((l) => l.id).sort());
    expect(spots.filter((s) => s.kind === 'dock').map((s) => s.id)).toEqual([ISLAND_DOCK.id]);
  });

  it('fits the whole shoreline inside the map frame', () => {
    expect(ISLAND_GRASS_R).toBeLessThan(ISLAND_LAND_R); expect(ISLAND_LAND_R).toBeLessThan(ISLAND_BEACH_R);
    expect(ISLAND_CENTER.x - ISLAND_BEACH_R).toBeGreaterThan(ISLAND_MAP.x0); expect(ISLAND_CENTER.x + ISLAND_BEACH_R).toBeLessThan(ISLAND_MAP.x1);
    expect(ISLAND_CENTER.z - ISLAND_BEACH_R).toBeGreaterThan(ISLAND_MAP.z0); expect(ISLAND_CENTER.z + ISLAND_BEACH_R).toBeLessThan(ISLAND_MAP.z1);
  });

  it('puts every marker and label on the map, estates on land and the dock at the shore', () => {
    for (const s of [...islandSpots(), ...ISLAND_PLACES]) {
      const { left, top } = islandMapPos(s.x, s.z);
      expect(left).toBeGreaterThan(0); expect(left).toBeLessThan(100); expect(top).toBeGreaterThan(0); expect(top).toBeLessThan(100);
    }
    for (const l of ISLAND_LOTS) expect(Math.hypot(l.x - ISLAND_CENTER.x, l.z - ISLAND_CENTER.z)).toBeLessThan(ISLAND_LAND_R);
    const d = Math.hypot(ISLAND_DOCK.x - ISLAND_CENTER.x, ISLAND_DOCK.z - ISLAND_CENTER.z);
    expect(d).toBeGreaterThan(ISLAND_GRASS_R - 8); expect(d).toBeLessThan(ISLAND_BEACH_R + 8);
    expect(islandMapPos(ISLAND_MAP.x0, ISLAND_MAP.z0)).toEqual({ left: 0, top: 0 });
    expect(islandMapPos(ISLAND_MAP.x1, ISLAND_MAP.z1)).toEqual({ left: 100, top: 100 });
  });

  it('keeps markers spread out so they stay tappable', () => {
    const pts = islandSpots().map((s) => islandMapPos(s.x, s.z));
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      expect(Math.hypot(pts[i].left - pts[j].left, pts[i].top - pts[j].top)).toBeGreaterThan(12);
    }
  });

  it('draws the 3D island from the same shoreline the 2D map uses', () => {
    const s = src('client/src/lib/island3d.ts');
    for (const k of ['ISLAND_LAND_R', 'ISLAND_BEACH_R', 'ISLAND_GRASS_R', 'ISLAND_CENTER']) expect(s).toContain(k);
  });

  it('offers a 2D map, falls back to it without WebGL, and opens panels from markers', () => {
    const s = src('client/src/components/IslandMap.tsx');
    expect(s).toContain('IslandFlatMap'); expect(s).toContain("'chud-world-mode'");
    expect(s).toContain('island-map-mode'); expect(s).toContain('setMapError');
    expect(s).toContain('island-sheet-x'); expect(s).toContain('island-dock-home'); expect(s).toContain('island-buy');
    const f = src('client/src/components/IslandFlatMap.tsx');
    expect(f).toContain('islandSpots()'); expect(f).toContain('fetchRealEstateList');
  });

  it('can be looked at from the Billionaire Club before travelling', () => {
    const club = src('client/src/components/BillionaireClub.tsx');
    expect(club).toContain('club-island-map'); expect(club).toContain('IslandPreview');
    const p = src('client/src/components/IslandPreview.tsx');
    expect(p).toContain('createPortal'); expect(p).not.toContain('re_buy');
  });

  it('keeps the map bounded on phones', () => {
    const css = src('client/src/index.css');
    expect(css).toContain('.island-flat-board'); expect(css).toContain('container-type: size');
    expect(css).toMatch(/\.island-flat-spot \{[^}]*min-height: 44px/);
    expect(css).toMatch(/@media \(max-width: 700px\), \(max-height: 520px\) \{\s*\.world\.island \.island-map-controls/);
  });
});
