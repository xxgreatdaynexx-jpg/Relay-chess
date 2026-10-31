import { describe, expect, it } from 'vitest';
import { isTypingTarget, SPACE_RESPAWN_GUARD_MS, spaceRespawns } from '../client/src/lib/respawnKey';

const base = { repeat: false, alive: false, phase: 'play', broke: false, sinceDeathMs: 1000, typing: false };
describe('Space to respawn', () => {
  it('respawns from the death screen during play', () => expect(spaceRespawns(base)).toBe(true));
  it('ignored in the first ~400 ms after death and on key repeat (held jump)', () => {
    expect(spaceRespawns({ ...base, sinceDeathMs: SPACE_RESPAWN_GUARD_MS - 1 })).toBe(false);
    expect(spaceRespawns({ ...base, sinceDeathMs: SPACE_RESPAWN_GUARD_MS })).toBe(true);
    expect(spaceRespawns({ ...base, repeat: true })).toBe(false);
  });
  it('never while alive, typing in chat, broke, or in sudden death / end screen', () => {
    expect(spaceRespawns({ ...base, alive: true })).toBe(false);
    expect(spaceRespawns({ ...base, typing: true })).toBe(false);
    expect(spaceRespawns({ ...base, broke: true })).toBe(false);
    expect(spaceRespawns({ ...base, phase: 'sudden' })).toBe(false);
    expect(spaceRespawns({ ...base, phase: 'ended' })).toBe(false);
  });
  it('detects chat inputs', () => {
    expect(isTypingTarget({ tagName: 'input' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'CANVAS' } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
