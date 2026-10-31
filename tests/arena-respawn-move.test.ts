import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ArenaWorld } from '../server/arena-world.js';
import { TICK_HZ } from '../shared/fps.js';

const T0 = 1_000_000;
const STEP = Math.round(1000 / TICK_HZ);
type Dmg = { damage: (by: string | null, t: string, n: number, now: number, cause: string) => unknown };
const kill = (w: ArenaWorld, t: string, now: number) => (w as unknown as Dmg).damage('a', t, 9999, now, 'pistol');

function respawnAndWalk(loadout: 'pistol' | 'knife') {
  const w = new ArenaWorld();
  w.join('a', 'A', T0); const b = w.join('b', 'B', T0);
  // Walk a bit first so the validator has state (seq, carry, lastMove) from the old life.
  let t = T0 + 50, seq = 1;
  for (let i = 0; i < 10; i++, t += 50) w.move('b', b.x + 0.2, b.y, 0, t, 0, false, false, seq++);
  kill(w, 'b', t);
  expect(b.alive).toBe(false);
  t += 3000;
  expect(w.requestRespawn('b', loadout, t)).toBe(true);
  w.tick(t + STEP); t += STEP;
  expect(b.alive).toBe(true);
  const start = { x: b.x, y: b.y };
  // No hit in between: plain moves from the spawn point must be accepted.
  let x = b.x;
  for (let i = 0; i < 10; i++) { t += 50; x += 0.15; w.move('b', x, b.y, 0, t, 0, false, false, seq++); }
  return { b, start };
}

describe('respawn: you can move right away (authoritative teleport)', () => {
  for (const lo of ['pistol', 'knife'] as const) {
    it(`${lo} respawn: position changes without being hit`, () => {
      const { b, start } = respawnAndWalk(lo);
      expect(Math.hypot(b.x - start.x, b.y - start.y)).toBeGreaterThan(0.5);
      expect(b.hp).toBe(100);
    });
  }

  it('client resets prediction and re-takes keyboard focus on respawn', () => {
    const src = readFileSync(new URL('../client/src/components/ArenaPanel.tsx', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('function syncOnRespawn()'), src.indexOf('function releaseOnDeath()'));
    expect(block).toContain('net.hist.clear()');
    expect(block).toContain('net.corr = null');
    expect(block).toContain('focus(');
    expect(src).toMatch(/data-testid="arena-respawn-now"[\s\S]{0,400}respawnNow\(\)/);
    const rn = src.slice(src.indexOf('function respawnNow()'), src.indexOf('function onKey('));
    expect(rn).toContain('wrapRef.current?.focus');
    expect(rn).toContain('requestPointerLock');
  });
});

describe('arena fullscreen', () => {
  it('window clamping stands down while fullscreen (no update loop) and the panel fills the screen', () => {
    const drag = readFileSync(new URL('../client/src/lib/windowDrag.ts', import.meta.url), 'utf8');
    expect(drag).toContain('document.fullscreenElement === el');
    expect(drag).toMatch(/if \(inFs\(el\)\) return;/);
    const css = readFileSync(new URL('../client/src/index.css', import.meta.url), 'utf8');
    expect(css).toContain('.fps-panel:fullscreen .fps-canvas');
  });
});
