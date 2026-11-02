import { beforeEach, describe, expect, it } from 'vitest';
import { killBonus, RESPAWN_MS, SPAWN_PRICE } from '../shared/fps.js';
import { claimArenaName, getArenaWorld, recordArena, resetArena, armArenaClient, registerArenaClient, setArenaAccountAdultAt, settleKill } from '../server/fps.js';
import { resetBank } from '../server/casino-store.js';
import { chipsLabel, feedParts } from '../client/src/lib/arenaFeed.js';

const live = (...ids: string[]) => { for (const id of ids) { registerArenaClient(id, true); armArenaClient(id); } };
const die = (victimId: string) => { const v = getArenaWorld().fighters.get(victimId)!; v.alive = false; v.hp = 0; v.respawnAt = 1000 + RESPAWN_MS; };
const kill = (killerId: string | null, victimId: string) => {
  die(victimId);
  const ev = { ev: 'fps_kill', data: { killerId, victimId, cause: 'test' } as Record<string, unknown> };
  recordArena([ev]);
  return ev.data;
};
const respawn = (id: string, stake: number) => { const f = getArenaWorld().fighters.get(id)!; f.stake = stake; f.lifeId = `life-${Math.random()}`; f.alive = true; f.hp = 100; };

describe('arena kill bonus', () => {
  beforeEach(() => { resetArena(); resetBank(); live('a', 'b', 'c'); });

  it('formula: +20% round down, min 1, 0 for 0 stake', () => {
    expect(Object.fromEntries(Object.entries(SPAWN_PRICE).map(([k, v]) => [k, killBonus(v)]))).toEqual({ pistol: 2, smg: 3, shotgun: 4, sniper: 5, rocket: 7, ar15: 5, knife: 0 });
    expect(killBonus(3)).toBe(1);
    expect(killBonus(60)).toBe(12);
  });

  it('pays stake + bonus as two ledger entries and counts both in earned', () => {
    const bank = resetBank();
    claimArenaName('a', 'Alice'); claimArenaName('b', 'Bob');
    setArenaAccountAdultAt('Alice', 0); setArenaAccountAdultAt('Bob', 0);
    const w = getArenaWorld();
    w.join('a', 'Alice', 1000, 'sniper'); w.join('b', 'Bob', 1000, 'pistol');
    const d = kill('b', 'a');
    expect(d.bounty).toBe(25); expect(d.bonus).toBe(5);
    expect(bank.account('Bob').chips).toBe(990 + 30);
    expect(w.fighters.get('b')!.earned).toBe(30);
    kill('b', 'a'); // replay: nothing twice
    expect(bank.account('Bob').chips).toBe(1020);
  });

  it('no bonus: young victim, unknown age, self, same account, knife life', () => {
    const bank = resetBank();
    claimArenaName('a', 'Alice'); claimArenaName('b', 'Bob'); claimArenaName('c', 'alice');
    const w = getArenaWorld();
    w.join('a', 'Alice', 1000, 'pistol'); w.join('b', 'Bob', 1000, 'pistol'); w.join('c', 'alice', 1000, 'pistol');
    expect(kill('b', 'a').bonus).toBeUndefined(); // age not looked up: fail closed
    respawn('a', 10); setArenaAccountAdultAt('Alice', Date.now() + 3_600_000);
    const d = kill('b', 'a'); expect(d.bounty).toBe(10); expect(d.bonus).toBeUndefined();
    setArenaAccountAdultAt('Alice', 0);
    respawn('a', 10); expect(kill('a', 'a').bonus).toBeUndefined();
    respawn('a', 10); expect(kill('c', 'a').bounty).toBeUndefined(); // same account
    respawn('a', 0); expect(kill('b', 'a').bonus).toBeUndefined(); // knife-only
    expect(bank.account('Bob').chips).toBe(990 + 20);
  });

  it('only the first 3 kills of a victim per 10 min earn the bonus', () => {
    claimArenaName('a', 'Alice'); claimArenaName('b', 'Bob');
    setArenaAccountAdultAt('Alice', 0);
    const w = getArenaWorld();
    w.join('a', 'Alice', 1000, 'pistol'); w.join('b', 'Bob', 1000, 'pistol');
    const t0 = Date.now(); const got: number[] = [];
    for (let i = 0; i < 4; i++) { respawn('a', 10); die('a'); got.push(settleKill('b', 'a', w, t0 + i * 1000).bonus); }
    expect(got).toEqual([2, 2, 2, 0]);
    respawn('a', 10); die('a');
    expect(settleKill('b', 'a', w, t0 + 10 * 60_000 + 1).bonus).toBe(2);
  });

  it('feed shows the bonus', () => {
    expect(chipsLabel(60, 12)).toBe('+60 +12 bonus');
    expect(chipsLabel(60)).toBe('+60');
    expect(feedParts({ key: 1, killer: 'B', victim: 'A', cause: 'ar15', self: false, mine: true, bounty: 25, bonus: 5 }).pop()).toEqual({ t: 'chips', text: '+25 +5 bonus' });
  });
});
