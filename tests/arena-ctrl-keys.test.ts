import { describe, expect, it, vi } from 'vitest';
import { ARENA_GAME_KEYS, LOCK_KEYS, LEAVE_PROMPT, arenaKey, changeSender, crouchHeld, isModifierChord, isModifierRelease, releaseHeld, shouldBlockShortcut, shouldPromptLeave } from '../client/src/lib/arenaInput';

describe('arena Ctrl / key-repeat safety', () => {
  it('blocks Ctrl/Cmd + game-key browser shortcuts only while the Arena is active', () => {
    for (const key of ['w', 'a', 's', 'd', 'r', 'f']) expect(shouldBlockShortcut({ key, ctrlKey: true }, true)).toBe(true);
    expect(shouldBlockShortcut({ key: 'S', metaKey: true }, true)).toBe(true);
    expect(shouldBlockShortcut({ key: '!', code: 'Digit1', ctrlKey: true }, true)).toBe(true);
    expect(shouldBlockShortcut({ key: 'w', ctrlKey: true }, false)).toBe(false);
    expect(shouldBlockShortcut({ key: 'w' }, true)).toBe(false);
    expect(shouldBlockShortcut({ key: 'Control', ctrlKey: true }, true)).toBe(false);
    expect(shouldBlockShortcut({ key: 'l', ctrlKey: true }, true)).toBe(false);
  });
  it('preventDefault is called by a window guard on Ctrl+W/S/D', () => {
    const guard = (e: KeyboardEventLike) => { if (shouldBlockShortcut(e, true)) e.preventDefault(); };
    for (const key of ['w', 's', 'd']) { const e = { key, ctrlKey: true, preventDefault: vi.fn() }; guard(e); expect(e.preventDefault).toHaveBeenCalledOnce(); }
  });
  it('C crouches; Ctrl is not bound to anything', () => {
    expect(crouchHeld(new Set(['control']), false)).toBe(false);
    expect(ARENA_GAME_KEYS.has('control')).toBe(false);
    expect(LOCK_KEYS.some((k) => k.startsWith('Control'))).toBe(false);
    expect(ARENA_GAME_KEYS.has('shift')).toBe(true);
    expect(crouchHeld(new Set(['c']), false)).toBe(true);
    expect(crouchHeld(new Set(['w']), false)).toBe(false);
  });
  it('crouch/sprint state is sent once per change, not on every repeat', () => {
    const send = vi.fn(); const s = changeSender(send);
    for (let i = 0; i < 300; i++) s(true); // held Ctrl/C with auto-repeat for 10 s
    s(false); s(false); s(true);
    expect(send.mock.calls.map((c) => c[0])).toEqual([true, false, true]);
  });
  it('key-repeat is ignored: repeated keydowns do not re-run actions', async () => {
    const src = (await import('node:fs')).readFileSync('client/src/components/ArenaPanel.tsx', 'utf8');
    const body = src.slice(src.indexOf('function onKey('), src.indexOf('function releaseLock'));
    expect(body.indexOf('if (e.repeat) return;')).toBeGreaterThan(-1);
    expect(body.indexOf('if (e.repeat) return;')).toBeLessThan(body.indexOf('keys.current.add(key)'));
    expect(src).toMatch(/wantCrouch !== net\.sentCrouch/);
    expect(src).toMatch(/addEventListener\('beforeunload'/);
    expect(src).toMatch(/(keyboard|kb)\?\.lock\?\.\(LOCK_KEYS\)/);
    expect(src).toMatch(/· C crouch/);
    expect(src).not.toMatch(/Ctrl\/C crouch|protects Ctrl/);
    expect(src).toMatch(/if \(down && isModifierChord\(e\)\) return;/);
    expect(src).toMatch(/addEventListener\('blur', dropAll\)/);
    expect(src).toMatch(/addEventListener\('visibilitychange', dropAll\)/);
    expect(src).toMatch(/isModifierRelease\(e\)\) \{ releaseHeld/);
  });
  it('digits map by physical key and all game keys are known', () => {
    expect(arenaKey({ key: '@', code: 'Digit2' })).toBe('2');
    expect(ARENA_GAME_KEYS.has('c')).toBe(true);
  });
});
describe('arena held-key release + leave prompt', () => {
  it('Ctrl/Cmd chords are not game input; releasing Ctrl/Cmd is detected', () => {
    expect(isModifierChord({ ctrlKey: true })).toBe(true);
    expect(isModifierChord({ metaKey: true })).toBe(true);
    expect(isModifierChord({})).toBe(false);
    for (const key of ['Control', 'Meta']) expect(isModifierRelease({ key })).toBe(true);
    expect(isModifierRelease({ key: 'Shift' })).toBe(false);
  });
  it('releaseHeld clears every held key and movement/fire/sprint state', () => {
    const keys = new Set(['w', 'shift', 'c', 'f']); const m = { firing: true, sprint: true, semiPending: true };
    releaseHeld(keys, m);
    expect(keys.size).toBe(0); expect(m).toEqual({ firing: false, sprint: false, semiPending: false });
  });
  it('asks "Leave the match?" only while a match is active', () => {
    expect(LEAVE_PROMPT).toBe('Leave the match?');
    expect(shouldPromptLeave(true, 'play')).toBe(true);
    expect(shouldPromptLeave(true, 'sudden')).toBe(true);
    expect(shouldPromptLeave(true, 'ended')).toBe(false);
    expect(shouldPromptLeave(false, 'play')).toBe(false);
  });
});
type KeyboardEventLike = { key: string; ctrlKey?: boolean; preventDefault: () => void };

import { applyCrouch, gridMap } from '../shared/fps';
describe('C crouches (keydown → held keys → crouch state)', () => {
  const map = gridMap(['#####', '#...#', '#...#', '#####']);
  const press = (keys: Set<string>, e: { key: string; code: string; ctrlKey?: boolean; shiftKey?: boolean }, down: boolean) => {
    const key = arenaKey(e);
    if (down && isModifierChord(e)) return;
    if (!ARENA_GAME_KEYS.has(key)) return;
    if (down) keys.add(key); else keys.delete(key);
  };
  for (const ev of [{ key: 'c', code: 'KeyC' }, { key: 'C', code: 'KeyC', shiftKey: true }, { key: 'j', code: 'KeyC' } /* Dvorak etc. */]) {
    it(`keydown ${ev.key}/${ev.code} crouches, keyup stands`, () => {
      const keys = new Set<string>(); const body = { x: 2, y: 2, z: 0, vz: 0, grounded: true, crouch: false };
      press(keys, ev, true);
      expect(applyCrouch(body, crouchHeld(keys, false), map)).toBe(true);
      press(keys, ev, false);
      expect(applyCrouch(body, crouchHeld(keys, false), map)).toBe(false);
    });
  }
  it('Shift sprint + C crouch together keep crouch held', () => {
    const keys = new Set<string>(); press(keys, { key: 'Shift', code: 'ShiftLeft' }, true); press(keys, { key: 'C', code: 'KeyC', shiftKey: true }, true);
    expect(crouchHeld(keys, false)).toBe(true);
  });
  it('the Arena shows an on-screen C crouch / Shift sprint hint', async () => {
    const src = (await import('node:fs')).readFileSync('client/src/components/ArenaPanel.tsx', 'utf8');
    expect(src).toMatch(/data-testid="arena-controls-hint"[\s\S]{0,400}<b>C<\/b> crouch · <b>Shift<\/b> sprint/);
  });
});
