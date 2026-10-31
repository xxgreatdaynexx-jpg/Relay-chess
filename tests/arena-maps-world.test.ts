import { describe, expect, it } from 'vitest';
import { ArenaWorld, END_SCREEN_MS, droneZ, MATCH_MS, nextInRotation } from '../server/arena-world.js';
import { canStand, MAPS, WEAPONS } from '../shared/fps.js';

const seq = () => { let i = 0; return () => ((i++ * 0.6180339887) % 1); };

describe('arena map selection and rotation', () => {
  it('rejects unknown, junk and prototype map ids, and picks from non-players', () => {
    const w = new ArenaWorld(MAPS.dunes, seq());
    w.join('a', 'A', 0); w.join('b', 'B', 0);
    for (const bad of ['nope', '__proto__', 'constructor', '', 3, null, undefined, { map: 'depot' }, ['depot']]) expect(w.pickMap(bad, 'a', 1)).toBeNull();
    expect(w.pickMap('depot', 'stranger', 1)).toBeNull();
    expect(w.nextMapId).toBeNull();
    expect(w.map.id).toBe('dunes');
  });

  it('a pick with others present sets the next map; the match end loads it and resets scores', () => {
    const w = new ArenaWorld(MAPS.dunes, seq());
    const a = w.join('a', 'A', 0); w.join('b', 'B', 0);
    a.kills = 5; a.ammo.smg = 0;
    const ev = w.pickMap('office', 'b', 10)!;
    expect(ev[0]).toMatchObject({ ev: 'fps_map', data: { phase: 'next', map: 'office' } });
    expect(w.map.id).toBe('dunes');
    expect(w.snapshot(10)).toMatchObject({ map: 'dunes', next: 'office', picked: true });
    expect(w.tick(MATCH_MS - 1).some((e) => e.ev === 'fps_map')).toBe(false);
    w.tick(MATCH_MS + 1); // sudden death
    expect(w.phase).toBe('sudden');
    w.fighters.get('b')!.alive = false;
    w.tick(MATCH_MS + 2); // last alive: end screen
    expect(w.phase).toBe('ended');
    const out = w.tick(MATCH_MS + 2 + END_SCREEN_MS);
    expect(out.some((e) => e.ev === 'fps_map' && e.data.map === 'office')).toBe(true);
    expect(w.map.id).toBe('office');
    expect(a.kills).toBe(0);
    expect(a.ammo.smg).toBe(WEAPONS.smg.mag);
    for (const f of w.fighters.values()) expect(canStand(f.x, f.y, f.z, w.map)).toBe(true);
    expect(w.nextMapId).toBeNull();
  });

  it('rotates when nobody picks', () => {
    const w = new ArenaWorld(MAPS.dunes, seq());
    w.join('a', 'A', 0);
    let t = 0;
    const seen = [w.map.id];
    for (let i = 0; i < 3; i++) { t += MATCH_MS + 1; w.tick(t); t += END_SCREEN_MS; w.tick(t); seen.push(w.map.id); }
    expect(seen).toEqual(['dunes', 'depot', 'office', 'dunes']);
    expect(nextInRotation('office')).toBe('dunes');
  });

  it('the only human present switches immediately (QA bots do not count)', () => {
    const w = new ArenaWorld(MAPS.dunes, seq());
    w.join('me', 'Me', 0); w.join('qa-bot-1', 'Bot', 0);
    const ev = w.pickMap('depot', 'me', 5, (id) => !id.startsWith('qa-bot'))!;
    expect(ev[0].data).toMatchObject({ phase: 'load', map: 'depot' });
    expect(w.map.id).toBe('depot');
    expect(w.snapshot(5).left).toBe(MATCH_MS);
  });

  it('flies drones above the tallest structure on every map', () => {
    for (const m of Object.values(MAPS)) {
      const top = Math.max(...m.solids.filter((s) => s.x1 - s.x0 < m.w - 1 && s.y1 - s.y0 < m.d - 1).map((s) => s.z1));
      expect(droneZ(m)).toBeGreaterThan(top);
    }
  });
});
