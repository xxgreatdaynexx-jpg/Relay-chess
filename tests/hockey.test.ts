import { beforeEach, describe, expect, it } from 'vitest';
import {
  CARRY_MAX, FACEOFF_S, GOAL_HALF, GOAL_X, GOAL_PAUSE_S, HK_DAILY_PAID_WINS, HK_DT, HK_WIN_CHIPS, HockeyGame, INTERMISSION_S, LOBBY_S, OT_S, RINK_HALF_L, RINK_HALF_W,
  SKATE_MAX, TEAM_SIZE, cleanInput, driveBots, hkClock, hockeyBot, prizeWinners, rinkContain, type HkPlayer,
} from '../shared/hockey.js';
import { claimHockeyName, resetHockey, settleHockey } from '../server/hockey.js';
import { resetBank } from '../server/casino-store.js';
import { LAUNCH } from '../shared/launchPopup.js';

const run = (g: HockeyGame, s: number) => { const ev = []; for (let t = 0; t < s; t += HK_DT) ev.push(...g.tick()); return ev; };
/** A game already in live play with one human (team 0 skater). */
function live(seed = 1, o: { periodS?: number } = {}) {
  const g = new HockeyGame({ seed, ...o });
  g.join('h1', 'Liam');
  g.fillBots();
  run(g, LOBBY_S + FACEOFF_S + HK_DT * 2);
  expect(g.phase).toBe('play');
  return g;
}
const freeze = (g: HockeyGame) => { for (const p of g.players.values()) { p.x = p.team === 0 ? -20 : 20; p.y = p.slot * 3 - 4; p.vx = p.vy = 0; if (p.role === 'G') { p.y = 12; } } };

describe('hockey: roster and bot fill', () => {
  it('fills both teams to 4 (1 goalie + 3 skaters) with bots and a human replaces a bot', () => {
    const g = new HockeyGame({ seed: 1 });
    expect(g.fillBots()).toBe(TEAM_SIZE * 2);
    expect([...g.players.values()].filter((p) => p.role === 'G')).toHaveLength(2);
    const h = g.join('h1', 'Liam')!;
    expect(h.role).toBe('S');
    expect(g.players.size).toBe(8);
    expect(g.players.has(`hk-bot-${h.team}-${h.slot}`)).toBe(false);
    // second human goes to the other team
    const h2 = g.join('h2', 'Dayne')!;
    expect(h2.team).not.toBe(h.team);
  });
  it('goalie only if open; bots never displace humans; leaving refills with a bot', () => {
    const g = new HockeyGame({ seed: 2 }); g.fillBots();
    const a = g.join('a', 'A', { team: 0, goalie: true })!;
    expect(a.role).toBe('G');
    const b = g.join('b', 'B', { team: 0, goalie: true })!;
    expect(b.role).toBe('S'); // net taken by a human
    expect(g.takeGoalie('b')).toBe(false);
    g.leave('a');
    expect(g.slotOwner(0, 0)?.bot).toBe(true);
    expect(g.takeGoalie('b')).toBe(true);
    expect(g.players.get('b')!.role).toBe('G');
    expect(g.players.size).toBe(8);
  });
  it('caps at 8 humans', () => {
    const g = new HockeyGame({ seed: 3 }); g.fillBots();
    for (let i = 0; i < 8; i++) expect(g.join(`h${i}`, `H${i}`)).not.toBeNull();
    expect(g.join('h9', 'H9')).toBeNull();
    expect([...g.players.values()].every((p) => !p.bot)).toBe(true);
  });
  it('last human leaving resets to the lobby', () => {
    const g = live();
    g.leave('h1');
    expect(g.phase).toBe('lobby');
    expect(g.score).toEqual([0, 0]);
  });
});

describe('hockey: physics', () => {
  it('skating keeps momentum (glides), caps speed, and stays inside the boards', () => {
    const g = live(); freeze(g);
    const p = g.players.get('h1')!; p.x = 0; p.y = 0;
    g.setInput('h1', { x: 1, y: 0, aim: 0 });
    run(g, 2);
    expect(Math.hypot(p.vx, p.vy)).toBeLessThanOrEqual(Math.max(SKATE_MAX, CARRY_MAX) + 1e-6);
    expect(p.vx).toBeGreaterThan(5);
    g.setInput('h1', { x: 0, y: 0, aim: 0 });
    const v0 = p.vx; run(g, 0.5);
    expect(p.vx).toBeGreaterThan(v0 * 0.6); // ice: slows gently
    g.setInput('h1', { x: 1, y: 1, aim: 0 }); run(g, 6);
    expect(Math.abs(p.x)).toBeLessThanOrEqual(RINK_HALF_L);
    expect(Math.abs(p.y)).toBeLessThanOrEqual(RINK_HALF_W);
  });
  it('rinkContain handles rounded corners', () => {
    const o = { x: RINK_HALF_L, y: RINK_HALF_W };
    const n = rinkContain(o, 0.1)!;
    expect(n.nx).toBeGreaterThan(0); expect(n.ny).toBeGreaterThan(0);
    expect(Math.hypot(o.x, o.y)).toBeLessThan(Math.hypot(RINK_HALF_L, RINK_HALF_W) - 1);
    expect(rinkContain({ x: 0, y: 0 }, 0.1)).toBeNull();
  });
  it('puck bounces off the boards and slows with friction', () => {
    const g = live(); freeze(g);
    Object.assign(g.puck, { x: 0, y: 8, vx: 0, vy: 15, carrier: null });
    run(g, 0.5);
    expect(g.puck.vy).toBeLessThan(0);
    const s0 = Math.hypot(g.puck.vx, g.puck.vy); run(g, 1);
    expect(Math.hypot(g.puck.vx, g.puck.vy)).toBeLessThan(s0);
  });
  it('picks up a loose puck, carries it, shoots and passes', () => {
    const g = live(); freeze(g);
    const p = g.players.get('h1')!; p.x = 0; p.y = 0; p.a = 0;
    Object.assign(g.puck, { x: 0.5, y: 0, vx: 0, vy: 0, carrier: null });
    g.setInput('h1', { x: 0, y: 0, aim: 0 }); run(g, HK_DT * 2);
    expect(g.puck.carrier).toBe('h1');
    g.setInput('h1', { x: 0, y: 0, aim: 0, shoot: 1 }); g.tick();
    expect(g.puck.carrier).toBeNull();
    expect(g.puck.vx).toBeGreaterThan(25);
    expect(p.shots).toBe(0); // SOG only count once the shot is saved or scores
  });
  it('rejects junk input', () => {
    expect(cleanInput({ x: 9, y: 9, aim: 'x', shoot: 7 })).toMatchObject({ aim: 0, shoot: 1 });
    const i = cleanInput({ x: 9, y: 9 }); expect(Math.hypot(i.x, i.y)).toBeCloseTo(1);
    expect(cleanInput(null)).toMatchObject({ x: 0, y: 0 });
  });
});

describe('hockey: scoring, saves and goals', () => {
  it('a puck across the goal line between the posts scores, credits scorer + assist, then faceoff', () => {
    const g = live(); freeze(g);
    const h = g.players.get('h1')!; const mate = [...g.players.values()].find((p) => p.team === h.team && p.role === 'S' && p.id !== 'h1')!;
    const gx = h.team === 0 ? GOAL_X : -GOAL_X;
    Object.assign(g.puck, { x: gx - Math.sign(gx) * 2, y: 0.2, vx: Math.sign(gx) * 20, vy: 0, carrier: null, lastTouch: 'h1', prevTouch: mate.id });
    const ev = run(g, 0.3);
    expect(ev.find((e) => e.ev === 'hk_goal')).toBeTruthy();
    expect(g.score[h.team]).toBe(1);
    expect(h.goals).toBe(1); expect(mate.assists).toBe(1);
    expect(g.phase).toBe('goal');
    run(g, GOAL_PAUSE_S + HK_DT);
    expect(g.phase).toBe('faceoff');
    expect(g.puck.x).toBe(0);
  });
  it('wide of the post does not score; from behind the net does not score', () => {
    const g = live(); freeze(g);
    Object.assign(g.puck, { x: GOAL_X - 2, y: GOAL_HALF + 1, vx: 20, vy: 0, carrier: null, lastTouch: 'h1' });
    run(g, 0.3); expect(g.score).toEqual([0, 0]);
    Object.assign(g.puck, { x: GOAL_X + 2.5, y: 0, vx: -15, vy: 0, carrier: null, lastTouch: 'h1' });
    run(g, 0.3); expect(g.score).toEqual([0, 0]);
  });
  it('a goalie in the way saves a shot and it rebounds', () => {
    const g = live(); freeze(g);
    const goalie = g.slotOwner(1, 0)!; goalie.x = GOAL_X - 1; goalie.y = 0;
    const shooter = [...g.players.values()].find((p) => p.team === 0 && p.role === 'S')!;
    Object.assign(g.puck, { x: GOAL_X - 6, y: 0, vx: 22, vy: 0, carrier: null, lastTouch: shooter.id });
    const ev = run(g, 0.4);
    expect(ev.some((e) => e.ev === 'hk_save')).toBe(true);
    expect(g.score).toEqual([0, 0]);
    expect(goalie.saves).toBeGreaterThan(0);
  });
});

describe('hockey: clock, periods and overtime', () => {
  it('runs 3 periods with intermissions and ends with a winner', () => {
    const g = live(1, { periodS: 5 }); freeze(g);
    g.score = [2, 1];
    const startClock = g.clock; run(g, 1);
    expect(g.clock).toBeLessThan(startClock);
    expect(hkClock(65.2)).toBe('1:06');
    for (let i = 0; i < 2; i++) { while (g.phase === 'play' || g.phase === 'faceoff') { g.tick(); for (const p of g.players.values()) { p.input = { x: 0, y: 0, aim: 0 }; } g.puck.carrier = null; Object.assign(g.puck, { x: 0, y: 12, vx: 0, vy: 0 }); } expect(g.phase).toBe('intermission'); run(g, INTERMISSION_S + FACEOFF_S + HK_DT * 2); }
    expect(g.period).toBe(3);
    while (g.phase !== 'ended') { g.tick(); Object.assign(g.puck, { x: 0, y: 12, vx: 0, vy: 0, carrier: null }); }
    expect(g.result!.winner).toBe(0);
    expect(g.result!.stars.length).toBe(3);
  });
  it('a tie after regulation goes to sudden-death OT; first goal ends it', () => {
    const g = live(1, { periodS: 2 }); freeze(g);
    while (g.period <= 3) { g.tick(); Object.assign(g.puck, { x: 0, y: 12, vx: 0, vy: 0, carrier: null }); }
    expect(g.period).toBe(4);
    run(g, INTERMISSION_S + FACEOFF_S + HK_DT * 2);
    expect(g.clock).toBeLessThanOrEqual(OT_S);
    Object.assign(g.puck, { x: -GOAL_X + 2, y: 0, vx: -20, vy: 0, carrier: null, lastTouch: g.slotOwner(1, 1)!.id });
    for (const p of g.players.values()) if (p.role === 'G') p.y = 3;
    run(g, 0.3);
    expect(g.phase).toBe('ended');
    expect(g.result!.winner).toBe(1);
  });
});

describe('hockey: bots', () => {
  it('bots play a full match on their own and score', () => {
    const g = new HockeyGame({ seed: 7, periodS: 60 });
    g.join('h1', 'Liam'); g.fillBots();
    let goals = 0, maxSpeed = 0;
    for (let t = 0; t < 400 && g.phase !== 'ended'; t += HK_DT) {
      driveBots(g);
      goals += g.tick().filter((e) => e.ev === 'hk_goal').length;
      maxSpeed = Math.max(maxSpeed, Math.hypot(g.puck.vx, g.puck.vy));
      for (const p of g.players.values()) { expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true); }
    }
    expect(g.phase).toBe('ended');
    expect(goals).toBeGreaterThan(0);
    expect(maxSpeed).toBeGreaterThan(12);
  });
  it('a bot goalie tracks the puck along its crease', () => {
    const g = live(); const goalie = g.slotOwner(0, 0) as HkPlayer;
    Object.assign(g.puck, { x: -15, y: 8, carrier: null });
    expect(hockeyBot(g, goalie).y).toBeGreaterThan(0);
  });
});

describe('hockey: prizes (wallet + ledger, conservative)', () => {
  beforeEach(() => { resetHockey(1); resetBank(); });
  const players = (a: string, b: string) => [
    { team: 0 as const, bot: false, playS: 100, account: a },
    { team: 1 as const, bot: false, playS: 100, account: b },
    { team: 0 as const, bot: true, playS: 100 },
  ];
  it('no prize vs bots only, for ties, for short shifts, or for one account on both teams', () => {
    expect(prizeWinners({ winner: 0, players: [{ team: 0, bot: false, playS: 100, account: 'Liam' }], totalPlayS: 100 })).toEqual([]);
    expect(prizeWinners({ winner: null, players: players('Liam', 'Dayne'), totalPlayS: 100 })).toEqual([]);
    expect(prizeWinners({ winner: 0, players: [{ team: 0, bot: false, playS: 100, account: 'Liam' }, { team: 1, bot: false, playS: 10, account: 'Dayne' }], totalPlayS: 100 })).toEqual([]);
    expect(prizeWinners({ winner: 0, players: [...players('Liam', 'Dayne'), { team: 1, bot: false, playS: 100, account: 'liam' }], totalPlayS: 100 })).toEqual(['Dayne'].filter(() => false));
    expect(prizeWinners({ winner: 0, players: players('Liam', 'Dayne'), totalPlayS: 100 })).toEqual(['Liam']);
  });
  it('pays winners through the ledger once per match, capped per day', () => {
    const bank = resetBank();
    claimHockeyName('s1', 'Liam'); claimHockeyName('s2', 'Dayne');
    const before = bank.account('Liam').chips;
    const res = (id: string) => ({ matchId: id, score: [3, 1] as [number, number], winner: 0 as const, stars: [], players: [
      { id: 's1', name: 'Liam', team: 0 as const, role: 'S' as const, bot: false, goals: 1, assists: 0, shots: 2, saves: 0, playS: 100 },
      { id: 's2', name: 'Dayne', team: 1 as const, role: 'S' as const, bot: false, goals: 0, assists: 0, shots: 1, saves: 0, playS: 100 },
    ] });
    const r = settleHockey(res('m1'));
    expect(r.prize).toEqual({ names: ['Liam'], amount: HK_WIN_CHIPS });
    settleHockey(res('m1'));
    expect(bank.account('Liam').chips).toBe(before + HK_WIN_CHIPS);
    for (let i = 2; i < 10; i++) settleHockey(res(`m${i}`));
    expect(bank.account('Liam').chips).toBe(before + HK_WIN_CHIPS * HK_DAILY_PAID_WINS);
    expect(bank.account('Dayne').chips).toBe(1000);
  });
});

describe('hockey: launch popup', () => {
  it('lists PvP Hockey on the Games & skills page', () => {
    const it = LAUNCH.items.find((i) => i.title === 'PvP Hockey');
    expect(it?.section).toBe('Games & skills');
  });
});
