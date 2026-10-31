import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { arenaLiveHud, kiaCanvasStrip } from '../client/src/lib/arenaHud';

describe('arena HUD while dead / spectating', () => {
  it('hides the live-play HUD only when joined and dead', () => {
    expect(arenaLiveHud(true, true)).toBe(true);
    expect(arenaLiveHud(true, false)).toBe(false);
    expect(arenaLiveHud(false, false)).toBe(true);
  });
  it('KIA canvas strip only while spectating; during play it is the loadout box header', () => {
    expect(kiaCanvasStrip('play')).toBe(false);
    expect(kiaCanvasStrip('ended')).toBe(false);
    expect(kiaCanvasStrip('sudden')).toBe(true);
  });
  it('ArenaPanel gates the ammo box and streak/UAV pips on liveHud and folds KIA into the box header', () => {
    const src = readFileSync('client/src/components/ArenaPanel.tsx', 'utf8');
    expect(src).toMatch(/const liveHud = arenaLiveHud\(m\.joined, m\.alive\);\n\s*ctx\.textAlign = 'right';\n\s*if \(liveHud\) \{/);
    expect(src).toMatch(/\/\/ Streak pips\n\s*if \(liveHud\) \{/);
    expect(src).toContain('!m.alive && kiaCanvasStrip(phaseRef.current)');
    expect(src).toMatch(/data-testid="arena-kia-header"[^>]*>KILLED IN ACTION · PICK YOUR LOADOUT</);
  });
  it('Open Chud Case looks disabled when it is (signed out / no cases / no keys)', () => {
    expect(readFileSync('client/src/index.css', 'utf8')).toMatch(/\.inv-open-btn:disabled \{[^}]*grayscale\(1\)[^}]*not-allowed/);
    expect(readFileSync('client/src/components/SkinsPanel.tsx', 'utf8')).toContain('disabled={!cases || !keys}');
  });
});
