import { beforeEach, describe, expect, it } from 'vitest';
import { affordableLoadout, canHold, cheapestSpawn, RESPAWN_MS, SPAWN_EXTRAS, SPAWN_PRICE, spawnCost } from '../shared/fps.js';
import { claimArenaName, holdPaidLife, getArenaWorld, recordArena, resetArena } from '../server/fps.js';
import { resetBank } from '../server/casino-store.js';

const kill = (killerId: string | null, victimId: string) => {
  const w = getArenaWorld();
  const v = w.fighters.get(victimId)!;
  v.alive = false; v.hp = 0; v.respawnAt = 1000 + RESPAWN_MS;
  const ev = { ev: 'fps_kill', data: { killerId, victimId, cause: 'test' } as Record<string, unknown> };
  recordArena([ev]);
  return ev.data;
};

describe('arena paid spawns', () => {
  beforeEach(() => { resetArena(); resetBank(); });

  it('prices: one table, pistol cheapest, extras pluggable', () => {
    expect(SPAWN_PRICE).toEqual({ pistol: 10, smg: 15, shotgun: 20, sniper: 25, rocket: 35, ar15: 25, knife: 0 });
    expect(cheapestSpawn()).toBe(10);
    SPAWN_EXTRAS.grenades = 5;
    expect(spawnCost('pistol')).toBe(15);
    delete SPAWN_EXTRAS.grenades;
    expect(affordableLoadout('rocket', 30)).toBe('sniper');
    expect(affordableLoadout('pistol', 9)).toBe('knife'); // broke: free knife-only spawn
    expect(canHold('sniper', 'pistol') && canHold('sniper', 'sniper') && !canHold('sniper', 'rocket')).toBe(true);
  });

  it('charges the spawn, pays the stake to the killer once, and limits weapons', () => {
    const bank = resetBank();
    claimArenaName('a', 'Alice'); claimArenaName('b', 'Bob');
    const w = getArenaWorld();
    const a = w.join('a', 'Alice', 1000, 'sniper');
    w.join('b', 'Bob', 1000, 'pistol');
    expect(bank.account('Alice').chips).toBe(1000 - 25);
    expect(bank.account('Bob').chips).toBe(990);
    expect(a.weapon).toBe('sniper');
    expect(a.stake).toBe(25);
    expect(w.switchWeapon('a', 'rocket', 2000)).toBe(false);
    const d = kill('b', 'a');
    expect(d.bounty).toBe(25);
    expect(bank.account('Bob').chips).toBe(990 + 25);
    kill('b', 'a'); // replayed kill: no double pay
    expect(bank.account('Bob').chips).toBe(1015);
    // respawn charges again
    w.tick(1000 + RESPAWN_MS + 10);
    expect(a.alive).toBe(true);
    expect(bank.account('Alice').chips).toBe(1000 - 50);
  });

  it('suicide and bot kills burn the stake to the house; guests and bots play free', () => {
    const bank = resetBank();
    claimArenaName('a', 'Alice');
    const w = getArenaWorld();
    w.join('a', 'Alice', 1000, 'rocket');
    w.join('g', 'Guest 1', 1000, 'rocket');
    expect(w.fighters.get('g')!.stake).toBe(0);
    expect(kill('a', 'a').bounty).toBeUndefined();
    expect(bank.account('Alice').chips).toBe(965);
    // guest killing Alice earns nothing; Alice killing the guest earns nothing
    w.tick(1000 + RESPAWN_MS + 10);
    expect(kill('g', 'a').bounty).toBeUndefined();
    expect(kill('a', 'g').bounty).toBeUndefined();
    expect(bank.account('Alice').chips).toBe(930);
  });

  it('broke players respawn knife-only for free (never negative)', () => {
    const bank = resetBank();
    claimArenaName('a', 'Alice');
    bank.transfer('Alice', -995, { game: 'test' });
    const w = getArenaWorld();
    const a = w.join('a', 'Alice', 1000, 'rocket');
    expect(a.alive).toBe(true);
    expect(a.weapon).toBe('knife');
    expect(a.stake).toBe(0);
    expect(bank.account('Alice').chips).toBe(5);
  });

  it('reconnecting within the window resumes the paid life without a second charge', () => {
    const bank = resetBank();
    claimArenaName('a', 'Alice');
    const w = getArenaWorld();
    w.join('a', 'Alice', Date.now(), 'smg');
    expect(bank.account('Alice').chips).toBe(985);
    const lifeId = w.fighters.get('a')!.lifeId;
    holdPaidLife('a');
    w.leave('a');
    claimArenaName('a', null);
    claimArenaName('a2', 'alice');
    const back = w.join('a2', 'alice', Date.now(), 'rocket');
    expect(bank.account('Alice').chips).toBe(985);
    expect(back.lifeId).toBe(lifeId);
    expect(back.weapon).toBe('smg');
  });
});

describe('knife-only free spawn', () => {
  beforeEach(() => { resetArena(); resetBank(); });
  it('is live now that the knife ships, and never hands out a free pistol', async () => {
    const f = await import('../shared/fps.js');
    expect(f.knifeOnlyAvailable()).toBe(true);
    expect(f.affordableLoadout('pistol', 5)).toBe('knife');
  });
  it('once the knife lands: free, knife only, 0 bounty, and the broke fallback', async () => {
    const f = await import('../shared/fps.js');
    {
      expect(f.spawnCost('knife' as never)).toBe(0);
      expect(f.cheapestSpawn()).toBe(10);
      expect(f.affordableLoadout('rocket', 3)).toBe('knife');
      const bank = resetBank();
      claimArenaName('a', 'Alice'); claimArenaName('b', 'Bob');
      bank.transfer('Alice', -1000, { game: 'test' });
      const w = getArenaWorld();
      const a = w.join('a', 'Alice', 1000, 'sniper');
      w.join('b', 'Bob', 1000, 'pistol');
      expect(a.alive).toBe(true);
      expect(a.weapon).toBe('knife');
      expect(a.stake).toBe(0);
      expect(bank.account('Alice').chips).toBe(0);
      expect(w.switchWeapon('a', 'pistol', 5000)).toBe(false);
      const bob = bank.account('Bob').chips;
      expect(kill('b', 'a').bounty).toBeUndefined();
      expect(bank.account('Bob').chips).toBe(bob);
    }
  });
});
