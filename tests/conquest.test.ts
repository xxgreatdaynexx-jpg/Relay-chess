import { describe, expect, it } from 'vitest';
import { ADJ, act, botAction, CONTINENTS, connectedOwned, findSet, newGame, reinforcements, resolveDice, RuleError, START_ARMIES, TERRITORIES, tradeValue, validSet, type CqState } from '../shared/conquest';
import { ConquestHub, MemoryCqStore } from '../server/conquest';

const seq = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]!; };
const dieRng = (faces: number[]) => seq(faces.map((f) => (f - 1) / 6 + 0.01));
let r = 42;
const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
const two = () => newGame([{ name: 'A', bot: false }, { name: 'B', bot: false }], rnd);

/** Give territories explicitly: owner list, armies 1 everywhere unless set. */
function fixed(owner: (t: number) => number): CqState {
  const s = two();
  s.owner = TERRITORIES.map((t) => owner(t.id));
  s.armies = TERRITORIES.map(() => 1);
  return s;
}

describe('Chud Conquest map', () => {
  it('has symmetric adjacency and every territory reachable', () => {
    for (const [a, list] of ADJ.entries()) for (const b of list) expect(ADJ[b]).toContain(a);
    const seen = new Set([0]); const q = [0];
    while (q.length) for (const n of ADJ[q.pop()!]!) if (!seen.has(n)) { seen.add(n); q.push(n); }
    expect(seen.size).toBe(TERRITORIES.length);
    expect(CONTINENTS.every((c) => TERRITORIES.some((t) => t.continent === c.id))).toBe(true);
  });
});

describe('setup', () => {
  it.each([2, 3, 4, 5, 6])('deals all territories and the starting armies for %i players', (n) => {
    const s = newGame(Array.from({ length: n }, (_, i) => ({ name: `P${i}`, bot: false })), rnd);
    for (let p = 0; p < n; p++) {
      const mine = s.owner.map((o, t) => (o === p ? t : -1)).filter((t) => t >= 0);
      expect(mine.length).toBeGreaterThanOrEqual(Math.floor(TERRITORIES.length / n));
      expect(mine.reduce((k, t) => k + s.armies[t]!, 0)).toBe(START_ARMIES[n]);
    }
    expect(s.armies.every((a) => a >= 1)).toBe(true);
    expect(s.phase).toBe('reinforce');
  });
  it('rejects 1 or 7 players', () => {
    expect(() => newGame([{ name: 'A', bot: false }])).toThrow(RuleError);
    expect(() => newGame(Array.from({ length: 7 }, (_, i) => ({ name: `P${i}`, bot: false })))).toThrow(RuleError);
  });
});

describe('reinforcement', () => {
  it('is territories ÷ 3, minimum 3, plus continent bonuses', () => {
    const s = fixed((t) => (t < 4 ? 0 : 1));
    expect(reinforcements(s, 0)).toBe(3);
    const bog = fixed((t) => (TERRITORIES[t]!.continent === 'bog' || t < 8 ? 0 : 1)); // north(5)+bog(4) = 9 territories
    expect(reinforcements(bog, 0)).toBe(3 + 3 + 2);
    const salt = fixed((t) => (TERRITORIES[t]!.continent === 'salt' ? 1 : 0));
    expect(reinforcements(salt, 1)).toBe(3 + 5);
    expect(reinforcements(salt, 0)).toBe(Math.floor(22 / 3) + 3 + 2 + 2 + 3 + 2);
  });
  it('escalates trade values and validates sets', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(tradeValue)).toEqual([4, 6, 8, 10, 12, 15, 20]);
    expect(validSet([{ t: 0, s: 0 }, { t: 1, s: 0 }, { t: 2, s: 0 }])).toBe(true);
    expect(validSet([{ t: 0, s: 0 }, { t: 1, s: 1 }, { t: 2, s: 2 }])).toBe(true);
    expect(validSet([{ t: 0, s: 0 }, { t: 1, s: 0 }, { t: 2, s: 1 }])).toBe(false);
    expect(validSet([{ t: 0, s: 0 }, { t: 1, s: 0 }, { t: -1, s: 3 }])).toBe(true);
    const s = two();
    s.players[0]!.cards = [{ t: 0, s: 0 }, { t: 1, s: 0 }, { t: 2, s: 0 }, { t: 3, s: 1 }, { t: 4, s: 2 }];
    expect(() => act(s, 0, { type: 'place', t: s.owner.indexOf(0), n: s.reserve })).toThrow(/trade/);
    const before = s.reserve;
    act(s, 0, { type: 'trade', cards: findSet(s.players[0]!.cards)! });
    expect(s.reserve).toBe(before + 4);
    expect(s.players[0]!.cards).toHaveLength(2);
    expect(s.trades).toBe(1);
  });
});

describe('dice', () => {
  it('compares highest pairs and the defender wins ties', () => {
    expect(resolveDice([6, 1, 1], [5, 5])).toEqual({ attLost: 1, defLost: 1 });
    expect(resolveDice([4, 4, 2], [4, 3])).toEqual({ attLost: 1, defLost: 1 });
    expect(resolveDice([6, 6], [5, 5])).toEqual({ attLost: 0, defLost: 2 });
    expect(resolveDice([3], [3, 1])).toEqual({ attLost: 1, defLost: 0 });
  });
  it('caps attacker dice at armies-1 and conquers with a move-in', () => {
    const s = fixed((t) => (t === 1 ? 1 : 0));
    s.phase = 'attack'; s.reserve = 0; s.armies[0] = 4;
    act(s, 0, { type: 'attack', from: 0, to: 1, dice: 3 }, dieRng([6, 6, 6, 1]));
    expect(s.lastRoll!.att).toHaveLength(3);
    expect(s.lastRoll!.def).toHaveLength(1);
    expect(s.owner[1]).toBe(0);
    expect(s.phase).toBe('over'); // B had one territory
    expect(s.winner).toBe(0);
  });
  it('moves at least the dice rolled after a conquest', () => {
    const s = fixed((t) => (t === 1 || t === 20 ? 1 : 0));
    s.phase = 'attack'; s.reserve = 0; s.armies[0] = 6;
    act(s, 0, { type: 'attack', from: 0, to: 1, dice: 3 }, dieRng([6, 6, 6, 1]));
    expect(s.pending).toEqual({ from: 0, to: 1, min: 3 });
    expect(() => act(s, 0, { type: 'move', n: 2 })).toThrow();
    expect(() => act(s, 0, { type: 'attack', from: 0, to: 1, dice: 1 })).toThrow();
    act(s, 0, { type: 'move', n: 5 });
    expect(s.armies[0]).toBe(1); expect(s.armies[1]).toBe(5);
    act(s, 0, { type: 'endTurn' });
    expect(s.players[0]!.cards).toHaveLength(1); // a card for a turn with a conquest
    expect(s.turn).toBe(1);
  });
  it('eliminating a player takes their cards', () => {
    const s = fixed((t) => (t === 1 || t === 2 ? 1 : 0));
    s.players.push({ name: 'C', bot: false, alive: true, cards: [] });
    s.owner[2] = 2; s.armies[2] = 1;
    s.players[1]!.cards = [{ t: 5, s: 1 }, { t: 6, s: 2 }];
    s.phase = 'attack'; s.armies[0] = 5;
    act(s, 0, { type: 'attack', from: 0, to: 1, dice: 3 }, dieRng([6, 6, 6, 1]));
    expect(s.players[1]!.alive).toBe(false);
    expect(s.players[0]!.cards).toHaveLength(2);
    expect(s.phase).toBe('attack');
  });
  it('rejects attacks on non-neighbours and own land', () => {
    const s = fixed((t) => (t === 27 ? 1 : 0));
    s.phase = 'attack'; s.armies[0] = 5;
    expect(() => act(s, 0, { type: 'attack', from: 0, to: 27, dice: 3 })).toThrow(/neighbouring/);
    expect(() => act(s, 0, { type: 'attack', from: 0, to: 1, dice: 3 })).toThrow(/neighbouring/);
  });
});

describe('fortify', () => {
  it('only moves along a connected path of your own territories', () => {
    // A owns Hollowmere(0), Gristle(1), Thornwick(2); B owns everything else.
    const s = fixed((t) => (t <= 2 ? 0 : 1));
    s.phase = 'fortify'; s.armies[0] = 5;
    expect([...connectedOwned(s, 0)].sort()).toEqual([0, 1, 2]);
    act(s, 0, { type: 'fortify', from: 0, to: 2, n: 4 });
    expect(s.armies[2]).toBe(5);
    expect(s.turn).toBe(1); // fortify ends the turn
    const cut = fixed((t) => (t === 0 || t === 2 ? 0 : 1));
    cut.phase = 'fortify'; cut.armies[0] = 5;
    expect(() => act(cut, 0, { type: 'fortify', from: 0, to: 2, n: 1 })).toThrow(/connected/);
    expect(() => act(cut, 0, { type: 'fortify', from: 0, to: 0, n: 1 })).toThrow();
  });
});

describe('bots and tables', () => {
  it('a bot-only war runs to a winner', () => {
    const s = newGame([{ name: 'X', bot: true }, { name: 'Y', bot: true }, { name: 'Z', bot: true }], rnd);
    for (let i = 0; i < 20000 && s.phase !== 'over'; i++) act(s, s.turn, botAction(s, s.turn), rnd);
    expect(s.phase).toBe('over');
    expect(s.owner.every((o) => o === s.winner)).toBe(true);
  });
  it('hub: create, join, add bot, start, act, timer expiry, snapshot restore; bot games skip the board', async () => {
    const hub = new ConquestHub(rnd);
    const store = new MemoryCqStore();
    await hub.attach(store);
    const t = hub.create('QA-Ann');
    hub.join(t.code, 'QA-Bob');
    expect(() => hub.addBot(t.code, 'QA-Bob')).toThrow(/host/);
    expect(() => hub.start(t.code, 'QA-Bob')).toThrow(/host/);
    hub.start(t.code, 'QA-Ann');
    const g = t.game!;
    const who = g.turn === 0 ? 'QA-Ann' : 'QA-Bob';
    expect(() => hub.action(t.code, g.turn === 0 ? 'QA-Bob' : 'QA-Ann', { type: 'endTurn' })).toThrow(/turn/);
    hub.action(t.code, who, { type: 'place', t: g.owner.indexOf(g.turn), n: g.reserve });
    expect(g.phase).toBe('attack');
    hub.expire(t.code);
    expect(g.turn).not.toBe(0);
    await new Promise((r) => setTimeout(r, 5));
    const back = new ConquestHub(rnd);
    await back.attach(store);
    expect(back.tables.get(t.code)!.game!.turn).toBe(g.turn);
    const v = back.view(back.tables.get(t.code)!, 'QA-Ann');
    expect(v.game!.players[1]!.cards).toBeUndefined();
    hub.stop(); back.stop();

    const b = new ConquestHub(rnd);
    const bt = b.create('Solo');
    b.addBot(bt.code, 'Solo');
    b.start(bt.code, 'Solo');
    b.leave(bt.code, 'Solo');
    expect(bt.game!.phase).toBe('over');
    expect(b.board.standings()).toHaveLength(0);
    b.stop();
  });
  it('records a human-only win on the conquest leaderboard', () => {
    const hub = new ConquestHub(rnd);
    const t = hub.create('Ann'); hub.join(t.code, 'Bob'); hub.start(t.code, 'Ann');
    hub.leave(t.code, 'Bob');
    const rows = hub.board.standings();
    expect(rows.find((x) => x.name === 'Ann')!.wins).toBe(1);
    expect(rows.find((x) => x.name === 'Bob')!.losses).toBe(1);
    hub.stop();
  });
});
