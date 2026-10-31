import { describe, expect, it, vi } from 'vitest';
import { ARENA_GAME_KEYS, arenaKey, changeSender, crouchHeld, shouldBlockShortcut } from '../client/src/lib/arenaInput';

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
  it('Ctrl crouches (default), C is the alternate', () => {
    expect(crouchHeld(new Set(['control']), false)).toBe(true);
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
    expect(src).toMatch(/keyboard\?\.lock\?\.\(LOCK_KEYS\)/);
    expect(src).toMatch(/Ctrl\/C crouch/);
  });
  it('digits map by physical key and all game keys are known', () => {
    expect(arenaKey({ key: '@', code: 'Digit2' })).toBe('2');
    expect(ARENA_GAME_KEYS.has('c')).toBe(true);
  });
});
type KeyboardEventLike = { key: string; ctrlKey?: boolean; preventDefault: () => void };
