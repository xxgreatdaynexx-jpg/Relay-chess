import { describe, expect, it } from 'vitest';
import { cleanName, loadName, MAX_NAME_LENGTH, NAME_KEY, saveName } from '../client/src/lib/playerName.js';
import { becameYourTurn } from '../shared/alerts.js';

function memory(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('saved player name', () => {
  it('trims and caps like the server', () => {
    expect(cleanName('  Dayne  ')).toBe('Dayne');
    expect(cleanName('x'.repeat(30))).toHaveLength(MAX_NAME_LENGTH);
    expect(cleanName(42)).toBe('');
  });

  it('saves and reloads under one key', () => {
    const store = memory();
    expect(saveName('  Ada ', store)).toBe('Ada');
    expect(store.data.get(NAME_KEY)).toBe('Ada');
    expect(loadName(store)).toBe('Ada');
  });

  it('ignores blank input and keeps the old name', () => {
    const store = memory({ [NAME_KEY]: 'Ada' });
    saveName('   ', store);
    expect(loadName(store)).toBe('Ada');
  });

  it('adopts the name from an older table session', () => {
    const store = memory({ 'relay-chess-session': JSON.stringify({ token: 't', code: 'c', name: ' Jules ' }) });
    expect(loadName(store)).toBe('Jules');
    expect(store.data.get(NAME_KEY)).toBe('Jules');
  });

  it('survives broken or missing storage', () => {
    expect(loadName(null)).toBe('');
    expect(loadName(memory({ 'relay-chess-session': '{oops' }))).toBe('');
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadName(throwing)).toBe('');
    expect(saveName('Ada', throwing)).toBe('Ada');
  });
});

describe('your-turn flash trigger (same as chime)', () => {
  it('fires only on a false → true change', () => {
    expect(becameYourTurn(null, true)).toBe(false);
    expect(becameYourTurn(false, true)).toBe(true);
    expect(becameYourTurn(true, true)).toBe(false);
    expect(becameYourTurn(true, false)).toBe(false);
  });
});
