import { describe, expect, it } from 'vitest';
import { ArenaWorld, type MatchResult } from '../server/arena-world.js';
import { layoutFor } from '../server/arena-modes.js';
import { wantedBots } from '../server/arena-bots.js';
import { combatXp } from '../server/skills.js';
import { MAPS } from '../shared/arenaMaps.js';
import { canStand } from '../shared/fps.js';
import {
  CTF_MS, CTF_WIN_CAPS, FLAG_RETURN_MS, OBJ_XP, SND_BOMB_MS, SND_DEFUSE_MS, SND_JOIN_GRACE_MS, SND_PLANT_MS, SND_POST_MS, SND_ROUND_MS, SND_WIN_ROUNDS,
  type TeamId,
} from '../shared/arenaModes.js';

const T0 = 1_000_000;
const human = (id: string) => !id.startsWith('arena-bot-') && !id.startsWith('qa-bot-');

function setup(mode: 'snd' | 'ctf', n = 4, map = 'depot') {
  let seed = 7;
  const w = new ArenaWorld(MAPS[map], () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
  const res: MatchResult[] = [];
  w.onMatchEnd = (r) => res.push(r);
  w.join('h1', 'Hum', T0);
  for (let i = 1; i < n; i++) w.join(`arena-bot-${i}`, `Bot${i}`, T0);
  expect(w.pickMode(mode, 'h1', T0, human)).not.toBeNull();
  const m = w.modes!;
  const ids = [...w.fighters.keys()];
  const team = (t: TeamId) => ids.filter((id) => m.teamOf(id) === t);
  const put = (id: string, p: { x: number; y: number; z: number }) => Object.assign(w.fighters.get(id)!, { x: p.x, y: p.y, z: p.z, vz: 0, grounded: true, alive: true, hp: 100 });
  const kill = (id: string, now: number) => { const f = w.fighters.get(id)!; f.alive = false; f.deaths++; f.respawnAt = now + 1e9; m.onDeath(f, now); };
  return { w, m, res, team, put, kill };
}

describe('arena mode objectives fit every map', () => {
  for (const id of Object.keys(MAPS)) {
    it(`${id}: two spawn sides, two flag bases on opposite halves, bomb sites A/B where a player can stand`, () => {
      const map = MAPS[id];
      const L = layoutFor(map);
      expect(L.sides[0].length).toBeGreaterThanOrEqual(2);
      expect(L.sides[1].length).toBeGreaterThanOrEqual(2);
      expect(L.bases[0].x).toBeLessThan(map.w / 2);
      expect(L.bases[1].x).toBeGreaterThan(map.w / 2);
      for (const p of [...L.bases, ...L.sites]) expect(canStand(p.x, p.y, p.z, map)).toBe(true);
      expect(L.sites.map((s) => s.id)).toEqual(['A', 'B']);
      expect(Math.hypot(L.sites[0].x - L.sites[1].x, L.sites[0].y - L.sites[1].y)).toBeGreaterThan(6);
    });
  }
});

describe('mode pick, teams and friendly fire', () => {
  it('a solo human switches the mode at once; teams are balanced and in the snapshot', () => {
    const { w, team } = setup('ctf', 6);
    expect(w.mode).toBe('ctf');
    expect(team(0).length).toBe(3);
    expect(team(1).length).toBe(3);
    const s = w.snapshot(T0);
    expect(s.mode).toBe('ctf');
    expect(s.mv?.teams?.score).toEqual([0, 0]);
    expect(s.mv?.ctf?.flags.map((f) => f.state)).toEqual(['home', 'home']);
    // fighters are on their team's half
    for (const id of team(0)) expect(w.fighters.get(id)!.x).toBeLessThan(w.map.w / 2);
    for (const id of team(1)) expect(w.fighters.get(id)!.x).toBeGreaterThan(w.map.w / 2);
  });

  it('with two humans the pick waits for the next match; unknown modes are rejected', () => {
    const w = new ArenaWorld(MAPS.depot);
    w.join('h1', 'A', T0); w.join('h2', 'B', T0);
    expect(w.pickMode('nope', 'h1', T0)).toBeNull();
    const ev = w.pickMode('snd', 'h1', T0)!;
    expect(ev[0]).toMatchObject({ ev: 'fps_mode', data: { kind: 'next', mode: 'snd' } });
    expect(w.mode).toBe('dm');
    expect(w.upcomingMode).toBe('snd');
    w.changeMap(MAPS.dunes, T0 + 1);
    expect(w.mode).toBe('snd');
    expect(w.modes).not.toBeNull();
  });

  it('no friendly fire (but enemies and yourself still take damage); teammates always see each other', () => {
    const { w, team } = setup('ctf', 4);
    const [a, b] = team(0); const [e] = team(1);
    const hurt = (by: string, t: string) => (w as unknown as { damage: (...x: unknown[]) => unknown[] }).damage(by, t, 30, T0 + 10, 'smg');
    expect(hurt(a, b)).toEqual([]);
    expect(w.fighters.get(b)!.hp).toBe(100);
    expect(hurt(a, e).length).toBeGreaterThan(0);
    expect(w.fighters.get(e)!.hp).toBeLessThan(100);
    expect(hurt(a, a).length).toBeGreaterThan(0);
    // b is across the map behind walls but still in a's players list
    Object.assign(w.fighters.get(b)!, { x: 2, y: 2 }); Object.assign(w.fighters.get(a)!, { x: w.map.w - 2, y: w.map.d - 2 });
    const snap = w.snapshotFor(a, T0 + 20);
    expect(snap.players.some((p) => p.id === b)).toBe(true);
  });

  it('deathmatch is untouched: no mode state, bots FFA rule', () => {
    const w = new ArenaWorld(MAPS.depot);
    w.join('h1', 'A', T0);
    expect(w.modes).toBeNull();
    expect(w.snapshot(T0).mode).toBe('dm');
    expect(wantedBots(1)).toBe(3);
    expect(wantedBots(2)).toBe(0);
  });

  it('team modes fill both sides with bots (at least 3v3, at most 5 bots)', () => {
    expect(wantedBots(1, true)).toBe(5);
    expect(wantedBots(2, true)).toBe(4);
    expect(wantedBots(4, true)).toBe(2);
    expect(wantedBots(6, true)).toBe(0);
    expect(wantedBots(9, true)).toBe(1);
    expect(wantedBots(0, true)).toBe(0);
  });
});

describe('capture the flag', () => {
  it('take the enemy flag, bring it home, score; 3 captures wins and the MVP of the winning team takes the prize slot', () => {
    const { w, m, res, team, put } = setup('ctf', 4);
    const runner = team(0)[0];
    let t = T0 + 100;
    for (let cap = 1; cap <= CTF_WIN_CAPS; cap++) {
      put(runner, m.flags[1]); w.tick(t += 50);
      expect(m.flags[1].state).toBe('carried');
      expect(m.flags[1].carrier).toBe(runner);
      put(runner, m.layout.bases[0]); w.tick(t += 50);
      expect(m.score[0]).toBe(cap);
      expect(m.flags[1].state).toBe('home');
    }
    w.tick(t += 50);
    expect(w.phase).toBe('ended');
    expect(res).toHaveLength(1);
    expect(res[0].reason).toBe('team');
    expect(res[0].teams).toEqual({ mode: 'ctf', winner: 0, score: [3, 0] });
    expect(res[0].winnerId).toBe(runner);
    expect(res[0].players.find((p) => p.id === runner)?.obj).toBe(3);
  });

  it('a carrier who dies drops the flag; a defender touching it returns it, or it goes home by itself', () => {
    const { w, m, team, put, kill } = setup('ctf', 4);
    const [runner] = team(0); const [def] = team(1);
    put(def, { x: 1, y: 1, z: 0 });
    put(runner, m.flags[1]); w.tick(T0 + 100);
    const mid = { x: w.map.w / 2, y: w.map.d / 2, z: 0 };
    put(runner, { ...m.flags[1], x: m.flags[1].x - 3 }); w.tick(T0 + 150);
    kill(runner, T0 + 160);
    w.tick(T0 + 170);
    expect(m.flags[1].state).toBe('dropped');
    put(def, { x: m.flags[1].x, y: m.flags[1].y, z: m.flags[1].z }); w.tick(T0 + 200);
    expect(m.flags[1].state).toBe('home');
    expect(m.obj.get(def)).toBe(1);
    // auto-return
    const [r2] = team(0).slice(1);
    put(def, { x: 1, y: 1, z: 0 });
    put(r2, m.flags[1]); w.tick(T0 + 300);
    put(r2, { ...mid, z: m.flags[1].z }); w.tick(T0 + 350);
    kill(r2, T0 + 360); w.tick(T0 + 370);
    expect(m.flags[1].state).toBe('dropped');
    w.tick(T0 + 370 + FLAG_RETURN_MS + 10);
    expect(m.flags[1].state).toBe('home');
  });

  it('time limit: the leader wins; a tie gives no team winner', () => {
    const { w, m, res } = setup('ctf', 4);
    m.score = [1, 2];
    w.tick(T0 + CTF_MS + 1);
    expect(res[0].teams?.winner).toBe(1);
  });
});

describe('search and destroy', () => {
  function snd() {
    const s = setup('snd', 4);
    const att = s.team(s.m.attackers); const def = s.team(s.m.attackers === 0 ? 1 : 0);
    return { ...s, att, def };
  }
  it('the bomb starts with an attacker (the human if there is one); planting needs a still 3 s hold on a site', () => {
    const { w, m, att, put } = snd();
    expect(m.bomb.state).toBe('carried');
    expect(att).toContain(m.bomb.carrier);
    if (att.includes('h1')) expect(m.bomb.carrier).toBe('h1');
    const c = m.bomb.carrier!;
    const site = m.layout.sites[0];
    put(c, site); w.tick(T0 + 1000);
    expect(m.hold?.kind).toBe('plant');
    // moving off the spot cancels
    put(c, { ...site, x: site.x + 1 }); w.tick(T0 + 1000 + SND_PLANT_MS - 100);
    expect(m.bomb.state).toBe('carried');
    w.tick(T0 + 2000);
    const start = m.hold!.since;
    w.tick(start + SND_PLANT_MS + 1);
    expect(m.bomb.state).toBe('planted');
    expect(m.bomb.site).toBe('A');
    expect(m.obj.get(c)).toBe(1);
    expect(m.roundPhase).toBe('planted');
  });

  it('defusers win the round with a 5 s hold; the bomb blows for the attackers if nobody does', () => {
    const { w, m, att, def, put } = snd();
    const c = m.bomb.carrier!;
    put(c, m.layout.sites[1]); w.tick(T0 + 1000); w.tick(T0 + 1000 + SND_PLANT_MS + 1);
    expect(m.bomb.state).toBe('planted');
    const d = def[0];
    put(d, m.bomb); const t1 = T0 + 6000; w.tick(t1);
    expect(m.hold?.kind).toBe('defuse');
    w.tick(t1 + SND_DEFUSE_MS + 1);
    expect(m.bomb.state).toBe('defused');
    expect(m.score[m.attackers === 0 ? 1 : 0]).toBe(1);
    expect(m.roundPhase).toBe('post');
    // next round: everyone back, attackers plant again and it explodes
    w.tick(t1 + SND_DEFUSE_MS + SND_POST_MS + 10);
    expect(m.round).toBe(2);
    const c2 = m.bomb.carrier!;
    expect(att).toContain(c2);
    const t2 = t1 + SND_DEFUSE_MS + SND_POST_MS + 100;
    for (const id of def) put(id, { x: 1.5, y: 1.5, z: 0 });
    put(c2, m.layout.sites[0]); w.tick(t2); w.tick(t2 + SND_PLANT_MS + 1);
    put(c2, { x: 1.5, y: w.map.d - 1.5, z: 0 });
    const boom = w.tick(t2 + SND_PLANT_MS + SND_BOMB_MS + 10);
    expect(boom.some((e) => e.ev === 'fps_boom' && (e.data as { cause: string }).cause === 'bomb')).toBe(true);
    expect(m.score[m.attackers]).toBe(1);
  });

  it('one life per round: the dead stay dead until the next round, then respawn at their side', () => {
    const { w, m, def, kill } = snd();
    const d = def[0];
    kill(d, T0 + 3000);
    w.fighters.get(d)!.respawnAt = T0 + 3000;
    w.tick(T0 + SND_JOIN_GRACE_MS + 10);
    expect(w.fighters.get(d)!.alive).toBe(false);
    for (const id of def) kill(id, T0 + SND_JOIN_GRACE_MS + 20);
    w.tick(T0 + SND_JOIN_GRACE_MS + 30);
    expect(m.roundPhase).toBe('post');
    expect(m.lastReason).toBe('eliminated');
    w.tick(T0 + SND_JOIN_GRACE_MS + 30 + SND_POST_MS + 10);
    w.tick(T0 + SND_JOIN_GRACE_MS + 30 + SND_POST_MS + 20);
    expect(w.fighters.get(d)!.alive).toBe(true);
    expect(w.fighters.get(d)!.x).toBeGreaterThan(w.map.w / 2); // defenders spawn east
  });

  it('time runs out without a plant: defenders win; first to 4 rounds wins the match, sides swap at halftime', () => {
    const { w, m, res } = snd();
    let t = T0;
    const firstAtt = m.attackers;
    const roles: TeamId[] = [];
    for (let r = 0; r < 7 && !res.length; r++) {
      roles.push(m.attackers);
      t = m.roundEndsAt + 1; w.tick(t);
      t = m.postUntil + 1; w.tick(t);
    }
    expect(res).toHaveLength(1);
    expect(res[0].teams?.mode).toBe('snd');
    expect(Math.max(...res[0].teams!.score)).toBe(SND_WIN_ROUNDS);
    expect(roles[0]).toBe(firstAtt);
    expect(roles[3]).toBe(firstAtt === 0 ? 1 : 0); // round 4: swapped
    expect(roles).toHaveLength(7);
    expect(SND_ROUND_MS).toBe(90_000);
  });

  it('defenders never get the position of a hidden bomb carrier', () => {
    const { w, m, def } = snd();
    const c = w.fighters.get(m.bomb.carrier!)!;
    Object.assign(c, { x: 1.5, y: 1.5 });
    const v = w.fighters.get(def[0])!; Object.assign(v, { x: w.map.w - 1.5, y: w.map.d - 1.5 });
    w.tick(T0 + 50);
    const s = w.snapshotFor(def[0], T0 + 60);
    if (!s.players.some((p) => p.id === c.id)) expect(s.mv?.snd?.bomb).toMatchObject({ x: 0, y: 0 });
    const own = w.snapshotFor(c.id, T0 + 60);
    expect(own.mv?.snd?.bomb.carrier).toBe(c.id);
  });
});

describe('combat XP for objectives', () => {
  it('each objective adds OBJ_XP, capped', () => {
    expect(combatXp({ kills: 0, participationMs: 70_000, obj: 2 }, false)).toBe(50 + 2 * OBJ_XP);
    expect(combatXp({ kills: 0, participationMs: 70_000, obj: 99 }, false)).toBe(50 + 10 * OBJ_XP);
    expect(combatXp({ kills: 1, participationMs: 70_000 }, true)).toBe(25 + 50 + 150);
  });
});

describe('bots play the objectives', () => {
  for (const mode of ['snd', 'ctf'] as const) {
    it(`${mode}: a solo human gets a 3v3, and bots alone make objective progress without errors`, async () => {
      const { ArenaBots } = await import('../server/arena-bots.js');
      let seed = 11;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const w = new ArenaWorld(MAPS.depot, rand);
      const bots = new ArenaBots(rand);
      w.join('h1', 'Hum', T0);
      w.pickMode(mode, 'h1', T0, human);
      bots.sync(w, T0, human);
      expect(w.fighters.size).toBe(6);
      expect(w.modes!.size(0)).toBe(3);
      expect(w.modes!.size(1)).toBe(3);
      const h = w.fighters.get('h1')!; Object.assign(h, { x: 1.2, y: 1.2 }); // the human idles in a corner
      let t = T0;
      for (let i = 0; i < 30 * 240 && w.phase === 'play'; i++) {
        t += 33;
        bots.sync(w, t, human);
        bots.drive(w, t);
        w.tick(t);
      }
      const m = w.modes ?? null;
      const progress = (w.lastResult?.players.reduce((a, p) => a + (p.obj ?? 0), 0) ?? 0) + (m ? [...m.obj.values()].reduce((a, b) => a + b, 0) + m.score[0] + m.score[1] : 0);
      expect(progress).toBeGreaterThan(0);
    }, 60_000);
  }
});
