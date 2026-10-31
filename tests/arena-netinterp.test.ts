import { describe, expect, it } from 'vitest';
import { angleLerp, EXTRAP_MAX_MS, PoseHistory, rewindTime, samplePlayers, SnapBuffer, LAG_COMP_MAX_MS } from '../shared/netInterp';
import { ArenaWorld } from '../server/arena-world';
import { gridMap } from '../shared/fps';
const P = (x: number, a = 0) => ({ id: 'b', x, y: 0, z: 0, a, p: 0, alive: true });
describe('arena interpolation', () => {
  it('lerps between snapshots and takes the short way round', () => {
    const s = [{ t: 0, players: [P(0, 3)] }, { t: 100, players: [P(2, -3)] }];
    const r = samplePlayers(s, 50).players[0];
    expect(r.x).toBeCloseTo(1);
    expect(Math.abs(Math.abs(r.a) - Math.PI)).toBeLessThan(0.3);
    expect(angleLerp(3, -3, 0.5)).toBeGreaterThan(3);
  });
  it('extrapolates on gaps but caps it, and never slides across a respawn', () => {
    const s = [{ t: 0, players: [P(0)] }, { t: 100, players: [P(1)] }];
    expect(samplePlayers(s, 150).players[0].x).toBeCloseTo(1.5);
    expect(samplePlayers(s, 5000).players[0].x).toBeCloseTo(1 + EXTRAP_MAX_MS / 100);
    expect(samplePlayers([{ t: 0, players: [P(0)] }, { t: 100, players: [P(20)] }], 30).players[0].x).toBe(0);
  });
  it('buffer estimates clock offset and renders 100ms behind', () => {
    const b = new SnapBuffer();
    b.push({ t: 1000, players: [] }, 5030); b.push({ t: 1066, players: [] }, 5080);
    expect(b.serverNow(5080)).toBeGreaterThanOrEqual(1066);
    expect(b.renderTime(5080)).toBeCloseTo(b.serverNow(5080) - 100);
    expect(b.offset).toBeLessThanOrEqual(4030);
  });
  it('lag compensation rewinds targets (capped) and restores them', () => {
    expect(rewindTime(1000, 0)).toBe(1000 - LAG_COMP_MAX_MS);
    expect(rewindTime(1000, 'x')).toBe(1000);
    const h = new PoseHistory(); h.record('b', 0, 0, 0, 0); h.record('b', 100, 2, 0, 0);
    expect(h.at('b', 50)!.x).toBeCloseTo(1);
    const w = new ArenaWorld(gridMap(['####################', '#..................#', '#..................#', '#..................#', '####################']), () => 0.5);
    const a = w.join('a', 'Ann', 0), b = w.join('b', 'Bob', 0);
    Object.assign(a, { x: 2, y: 2, a: 0, p: -0.06 });
    Object.assign(b, { x: 6, y: 2, a: Math.PI });
    w.history.record('b', 9800, 6, 2, 0);
    Object.assign(b, { y: 3.4 }); w.history.record('b', 9990, 6, 3.4, 0);
    // Shooter saw b on the line at 9800: a hit, and b is put back afterwards.
    w.shoot('a', 0, 10_000, -0.06, 9800);
    expect(b.y).toBeCloseTo(3.4);
    expect(b.hp).toBeLessThan(100);
  });
});
