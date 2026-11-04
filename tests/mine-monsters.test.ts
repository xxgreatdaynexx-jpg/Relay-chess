import { describe, it, expect } from 'vitest';
import { MOBS, MOB_SKINS, mobSkin, mobKindAt, mobScale, BOSS_FLOOR, type MobKind } from '../shared/mineCombat';
import type { CaveId } from '../shared/mines';

const CAVES: CaveId[] = ['mine', 'frost', 'magma', 'coral', 'fortmc'];
const KINDS = Object.keys(MOBS) as MobKind[];

describe('themed mine monsters', () => {
  it('every cave has a skin for every kind, with distinct names and models', () => {
    for (const c of CAVES) {
      const names = KINDS.map((k) => mobSkin(c, k).name);
      expect(new Set(names).size).toBe(KINDS.length);
      for (const k of KINDS) { const s = MOB_SKINS[c][k]; expect(s.name.length).toBeGreaterThan(2); expect(s.color).toMatch(/^#/); expect(s.scale).toBeGreaterThan(0); }
    }
  });
  it('names are unique across mines', () => {
    const all = CAVES.flatMap((c) => KINDS.map((k) => mobSkin(c, k).name));
    expect(new Set(all).size).toBe(all.length);
  });
  it('requested themes are present', () => {
    const has = (c: CaveId, re: RegExp) => KINDS.some((k) => re.test(mobSkin(c, k).name));
    expect(has('mine', /bat/i) && has('mine', /slime/i) && has('mine', /golem/i)).toBe(true);
    expect(has('frost', /wolf/i) && has('frost', /elemental/i) && has('frost', /yeti/i)).toBe(true);
    expect(has('magma', /slug/i) && has('magma', /imp/i) && has('magma', /golem/i)).toBe(true);
    expect(has('coral', /crab/i) && has('coral', /eel/i) && has('coral', /jelly/i) && has('coral', /kraken/i)).toBe(true);
    expect(has('fortmc', /sludge/i) && has('fortmc', /drill/i) && has('fortmc', /gas wraith/i)).toBe(true);
  });
  it('boss only on the deepest floors, one per floor in slot 0', () => {
    for (let f = 1; f < BOSS_FLOOR; f++) for (let s = 0; s < 12; s++) for (const r of [0, 0.5, 0.99]) expect(mobKindAt(f, s, r)).not.toBe('boss');
    for (let f = BOSS_FLOOR; f <= 40; f++) { expect(mobKindAt(f, 0, 0.3)).toBe('boss'); for (let s = 1; s < 12; s++) expect(mobKindAt(f, s, 0.3)).not.toBe('boss'); }
  });
  it('harder deeper: tougher tiers unlock with depth and the stat curve is shared by every mine', () => {
    const ordered = [...KINDS].sort((a, b) => MOBS[a].minFloor - MOBS[b].minFloor);
    for (let i = 1; i < ordered.length; i++) expect(MOBS[ordered[i]].dmg).toBeGreaterThan(MOBS[ordered[i - 1]].dmg);
    for (const k of KINDS) expect(mobScale(k, 40)).toBeGreaterThan(mobScale(k, MOBS[k].minFloor));
    // skins carry no stats: HP / damage come only from MOBS[kind]
    for (const c of CAVES) for (const k of KINDS) { expect((MOB_SKINS[c][k] as unknown as Record<string, unknown>).hp).toBeUndefined(); expect((MOB_SKINS[c][k] as unknown as Record<string, unknown>).dmg).toBeUndefined(); }
  });
});
