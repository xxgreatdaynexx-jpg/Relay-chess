import { newDb } from 'pg-mem';
import { describe, expect, it, beforeEach } from 'vitest';
import { ArenaLedger, PgArenaStore, resetArenaLedger, getArenaLedger } from '../server/arena-store';
import { recordArena, claimArenaName, resetArena } from '../server/fps';
import { ArenaWorld } from '../server/arena-world';
import { sortArena, type ArenaRow } from '../shared/arenaBoard';

const pool = () => new (newDb({ noAstCoverageCheck: true }).adapters.createPg().Pool)();

describe('arena lifetime leaderboard', () => {
  beforeEach(() => { resetArena(); resetArenaLedger(); });

  it('persists to arena_players and reloads', async () => {
    const p = pool();
    const a = new ArenaLedger();
    expect(await a.attach(new PgArenaStore(p))).toBe(true);
    a.match('Dayne'); a.kill('Dayne', 3); a.kill('Dayne', 5); a.death('Dayne'); a.nuke('Dayne'); a.round('Dayne');
    await a.flush();
    const b = new ArenaLedger();
    await b.attach(new PgArenaStore(p));
    expect(b.standings()[0]).toMatchObject({ name: 'Dayne', kills: 2, deaths: 1, kd: 2, bestStreak: 5, nukes: 1, matches: 1, rounds: 1 });
  });

  it('migration is idempotent', async () => {
    const p = pool();
    await new PgArenaStore(p).init();
    await new PgArenaStore(p).init();
  });

  it('records only claimed names; nuke deaths count, nuke kills do not', () => {
    const w = new ArenaWorld();
    claimArenaName('a', 'Ann'); claimArenaName('b', null);
    recordArena([{ ev: 'fps_kill', data: { killerId: 'a', victimId: 'b', cause: 'gun' } }], w);
    recordArena([{ ev: 'fps_kill', data: { killerId: 'b', victimId: 'a', cause: 'gun' } }], w);
    recordArena([{ ev: 'fps_kill', data: { killerId: null, victimId: 'a', cause: 'nuke' } }], w);
    recordArena([{ ev: 'fps_streak', data: { id: 'a', kind: 'nuke' } }], w);
    const rows = getArenaLedger().standings();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Ann', kills: 1, deaths: 2, nukes: 1, kd: 0.5 });
  });

  it('case-insensitive names merge', () => {
    const l = getArenaLedger(); l.kill('Ann', 1); l.kill('ann', 2);
    expect(l.standings()).toHaveLength(1);
    expect(l.standings()[0].kills).toBe(2);
  });

  it('sorts by any column; deaths lowest first', () => {
    const r = (name: string, kills: number, deaths: number): ArenaRow => ({ name, kills, deaths, kd: kills / Math.max(1, deaths), bestStreak: 0, nukes: 0, matches: 1, rounds: 0 });
    const rows = [r('A', 10, 10), r('B', 5, 1), r('C', 1, 0)];
    expect(sortArena(rows, 'kills').map((x) => x.name)).toEqual(['A', 'B', 'C']);
    expect(sortArena(rows, 'kd').map((x) => x.name)).toEqual(['B', 'A', 'C']);
    expect(sortArena(rows, 'deaths').map((x) => x.name)).toEqual(['C', 'B', 'A']);
  });
});
