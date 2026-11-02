import { describe, expect, it } from 'vitest';
import { gridMap, MAX_HP } from '../shared/fps.js';
import { ArenaWorld, type ArenaEvent } from '../server/arena-world.js';
import { MAPS } from '../shared/arenaMaps.js';
import { showsHitMarker } from '../client/src/lib/arenaHeadFx.js';

const HALL = gridMap(['####################', '#..................#', '#..................#', '#..................#', '####################']);
const CHEST = -0.06;
type Dmg = (by: string | null, t: string, amount: number, now: number, cause: string) => ArenaEvent[];
const dmg = (w: ArenaWorld): Dmg => (w as unknown as { damage: Dmg }).damage.bind(w);
const hits = (ev: ArenaEvent[]) => ev.filter((e) => e.ev === 'fps_hit').map((e) => e.data as { by: string | null; target: string; dmg?: number });

/** Every marker the client would draw for `me` must match real hp lost server-side. */
function markersImplyDamage(ev: ArenaEvent[], me: string, hpBefore: Map<string, number>, w: ArenaWorld) {
  for (const h of hits(ev)) {
    if (!showsHitMarker(h, me)) continue;
    expect(h.dmg!).toBeGreaterThan(0);
    expect(hpBefore.get(h.target)! - w.fighters.get(h.target)!.hp).toBeGreaterThan(0);
  }
}
const snapHp = (w: ArenaWorld) => new Map([...w.fighters.values()].map((f) => [f.id, f.hp]));

describe('arena hit marker implies server damage > 0', () => {
  it('a confirmed hit shows a marker and dealt damage', () => {
    const w = new ArenaWorld(HALL, () => 0.5);
    const a = w.join('a', 'A', 0), b = w.join('b', 'B', 0);
    Object.assign(a, { x: 2, y: 2, a: 0, p: CHEST }); Object.assign(b, { x: 6, y: 2, a: Math.PI });
    const before = snapHp(w);
    const ev = w.shoot('a', 0, 10_000, CHEST);
    expect(hits(ev).some((h) => showsHitMarker(h, 'a'))).toBe(true);
    markersImplyDamage(ev, 'a', before, w);
  });
  it('moving targets: every marker over a strafe matches hp lost', () => {
    const w = new ArenaWorld(HALL, () => 0.5);
    const a = w.join('a', 'A', 0), b = w.join('b', 'B', 0);
    Object.assign(a, { x: 2, y: 2, a: 0, p: CHEST }); Object.assign(b, { x: 8, y: 2, a: Math.PI });
    let t = 10_000;
    for (let i = 0; i < 20; i++) {
      b.y = 2 + (i % 4) * 0.3; // strafing
      w.tick(t += 100);
      const before = snapHp(w);
      if (b.alive) markersImplyDamage(w.shoot('a', 0, t, CHEST, t - 80), 'a', before, w);
    }
  });
  it('dead or respawning targets: no fps_hit, no marker', () => {
    const w = new ArenaWorld(HALL, () => 0.5);
    w.join('a', 'A', 0); const b = w.join('b', 'B', 0);
    b.alive = false; b.hp = 0;
    expect(hits(dmg(w)('a', 'b', 50, 1000, 'pistol'))).toEqual([]);
  });
  it('zero damage (e.g. protected / fully mitigated): no fps_hit, no marker', () => {
    const w = new ArenaWorld(HALL, () => 0.5);
    w.join('a', 'A', 0); const b = w.join('b', 'B', 0);
    expect(hits(dmg(w)('a', 'b', 0, 1000, 'pistol'))).toEqual([]);
    expect(b.hp).toBe(MAX_HP);
  });
  for (const mode of ['snd', 'ctf'] as const) {
    it(`${mode}: teammates take no damage and give no marker; enemies do`, () => {
      let seed = 7;
      const w = new ArenaWorld(MAPS.depot, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
      w.join('h1', 'Hum', 1_000_000);
      for (let i = 1; i < 4; i++) w.join(`arena-bot-${i}`, `Bot${i}`, 1_000_000);
      expect(w.pickMode(mode, 'h1', 1_000_000, (id) => !id.startsWith('arena-bot-'))).not.toBeNull();
      const m = w.modes!;
      const ids = [...w.fighters.keys()];
      const mate = ids.find((id) => id !== 'h1' && m.teamOf(id) === m.teamOf('h1'))!;
      const foe = ids.find((id) => m.teamOf(id) !== m.teamOf('h1'))!;
      const before = snapHp(w);
      const ev = dmg(w)('h1', mate, 40, 1_000_100, 'pistol');
      expect(hits(ev)).toEqual([]);
      expect(w.fighters.get(mate)!.hp).toBe(before.get(mate));
      const ev2 = dmg(w)('h1', foe, 40, 1_000_100, 'pistol');
      expect(hits(ev2).some((h) => showsHitMarker(h, 'h1'))).toBe(true);
      markersImplyDamage(ev2, 'h1', before, w);
    });
  }
  it('client never marks self-damage, others\' hits or dmg 0', () => {
    expect(showsHitMarker({ by: 'a', target: 'a', dmg: 30 }, 'a')).toBe(false);
    expect(showsHitMarker({ by: 'b', target: 'c', dmg: 30 }, 'a')).toBe(false);
    expect(showsHitMarker({ by: 'a', target: 'b', dmg: 0 }, 'a')).toBe(false);
    expect(showsHitMarker({ by: 'a', target: 'b' }, 'a')).toBe(false);
    expect(showsHitMarker({ by: 'a', target: 'b', dmg: 12 }, 'a')).toBe(true);
  });
});
