import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { handForKey, swingAction, toggleHand, isMineHand } from '../shared/mineHand';
import { WEAPONS, weaponDef } from '../shared/mineCombat';

describe('mine hand selector (pt2017u)', () => {
  it('keys: 1 tool, 2 sword, Q toggles, others ignored', () => {
    expect(handForKey('1', 'sword')).toBe('tool');
    expect(handForKey('2', 'tool')).toBe('sword');
    expect(handForKey('q', 'tool')).toBe('sword');
    expect(handForKey('q', 'sword')).toBe('tool');
    for (const k of ['w', 'a', 's', 'd', ' ', 'shift', 'c', 'e', '3']) expect(handForKey(k, 'tool')).toBeNull();
    expect(toggleHand(toggleHand('tool'))).toBe('tool');
    expect(isMineHand('sword') && isMineHand('tool') && !isMineHand('axe')).toBe(true);
  });
  it('sword never mines rock; tool keeps existing behaviour', () => {
    expect(swingAction('sword', false, true)).toBe('air');
    expect(swingAction('sword', true, true)).toBe('attack');
    expect(swingAction('tool', true, true)).toBe('attack');
    expect(swingAction('tool', false, true)).toBe('mine');
    expect(swingAction('tool', false, false)).toBe('air');
  });
  it('switching grants nothing: weapon stats/prices untouched by selector module', () => {
    expect(weaponDef('rusty_sword').tier).toBe(0);
    expect(WEAPONS.length).toBeGreaterThan(1);
    const src = readFileSync('shared/mineHand.ts', 'utf8');
    expect(src).not.toMatch(/socket|emit|price|dmg\s*[:=]/);
  });
  it('panel wires the selector without new server events, keeps sword in hand, returns to tool', () => {
    const p = readFileSync('client/src/components/MinesPanel.tsx', 'utf8');
    expect(p).toMatch(/data-testid=\{`mines-hand-\$\{h\}`\}/);
    expect(p).toMatch(/onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/); // tapping the button never swings (mobile)
    expect(p).toMatch(/t\.hand = handRef\.current/); // survives per-floor scene rebuild
    expect(p).not.toMatch(/mine_hand|mines_hand/); // client-only: server attack still uses owned equipped weapon
    const g = readFileSync('client/src/lib/mines3d.ts', 'utf8');
    expect(g).toMatch(/this\.swordT < 1 \|\| this\.hand === 'sword'/);
  });
});
