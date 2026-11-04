import { describe, it, expect } from 'vitest';
import { mineLantern, mineExitProps } from '../client/src/lib/mines3d';

describe('mine props', () => {
  it('lantern is tagged and has meshes', () => {
    const l = mineLantern('#ffb060');
    expect(l.userData.prop).toBe('lantern');
    let n = 0; l.traverse((o: any) => { if (o.isMesh) n++; });
    expect(n).toBeGreaterThan(1);
  });
  it('exit props include crates, barrel and cart', () => {
    const g = mineExitProps();
    const tags = new Set<string>(); g.traverse((o: any) => { if (o.userData?.prop) tags.add(o.userData.prop); });
    expect(tags.size).toBeGreaterThan(1);
  });
});
