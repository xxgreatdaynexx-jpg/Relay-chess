import { describe, expect, it } from 'vitest';
import { act, botAction, CQ_MAPS, FACTIONS, MAX_PLAYERS, mapById, newGame, publicView, reinforcements, SEAT_COMP, startArmies, type CqState } from '../shared/conquest';
import { ConquestHub, MemoryCqStore } from '../server/conquest';

let r = 7;
const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
const seq = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]!; };
const dieRng = (faces: number[]) => seq(faces.map((f) => (f - 1) / 6 + 0.01));

describe('Chud war maps', () => {
  it('ships the Chudlands, a 42-territory classic world and bigger extra maps', () => {
    expect(CQ_MAPS.map((m) => m.id)).toEqual(expect.arrayContaining(['chud', 'world']));
    expect(mapById('world').territories).toHaveLength(42);
    expect(mapById('world').continents).toHaveLength(6);
    expect(mapById('chud').territories).toHaveLength(28);
    const extra = CQ_MAPS.filter((m) => m.id !== 'chud' && m.id !== 'world');
    expect(extra.length).toBeGreaterThanOrEqual(2);
    for (const m of extra) expect(m.territories.length).toBeGreaterThan(28);
    expect(mapById('nope').id).toBe('chud');
  });
  it.each(CQ_MAPS.map((m) => m.id))('%s: symmetric, connected, no dead ends, every cell drawn', (id) => {
    const m = mapById(id);
    for (const [a, list] of m.adj.entries()) for (const b of list) expect(m.adj[b]).toContain(a);
    const seen = new Set([0]); const q = [0];
    while (q.length) for (const n of m.adj[q.pop()!]!) if (!seen.has(n)) { seen.add(n); q.push(n); }
    expect(seen.size).toBe(m.territories.length);
    for (const l of m.adj) expect(l.length).toBeGreaterThanOrEqual(2);
    for (const c of m.cells) expect(c.length).toBeGreaterThanOrEqual(3);
    for (const c of m.continents) expect(m.territories.some((t) => t.continent === c.id)).toBe(true);
    for (const t of m.territories) { expect(t.at[0]).toBeGreaterThan(0); expect(t.at[0]).toBeLessThan(m.w); expect(t.at[1]).toBeLessThan(m.h); }
  });
  it.each(CQ_MAPS.map((m) => m.id))('%s: a 4-bot war runs to a winner', (id) => {
    const s = newGame(['W', 'X', 'Y', 'Z'].map((name) => ({ name, bot: true })), rnd, { map: id, perks: true });
    expect(s.owner).toHaveLength(mapById(id).territories.length);
    for (let i = 0; i < 60000 && s.phase !== 'over'; i++) act(s, s.turn, botAction(s, s.turn), rnd);
    expect(s.phase).toBe('over');
    expect(s.owner.every((o) => o === s.winner)).toBe(true);
    expect(publicView(s, -1).map).toBe(id);
  });
});

function duel(map = 'chud', factions: [string, string] = ['grande', 'redcoat'], perks = true): CqState {
  const s = newGame([{ name: 'A', bot: false, faction: factions[0] }, { name: 'B', bot: false, faction: factions[1] }], rnd, { map, perks });
  s.phase = 'attack'; s.turn = 0; s.reserve = 0;
  s.owner = s.owner.map(() => 1); s.armies = s.armies.map(() => 1);
  return s;
}
const edge = (s: CqState, sea: boolean) => mapById(s.map).edges.find((e) => e[2] === sea)!;

describe('faction perks', () => {
  it('Élan: 3-dice attacker wins the top tie only with perks on', () => {
    for (const perks of [true, false]) {
      const s = duel('chud', ['grande', 'cossack'], perks);
      const [a, b] = edge(s, false);
      s.owner[a] = 0; s.armies[a] = 10; s.armies[b] = 5;
      act(s, 0, { type: 'attack', from: a, to: b, dice: 3 }, dieRng([6, 2, 2, 6, 1]));
      expect(s.lastRoll!.defLost).toBe(perks ? 2 : 1);
    }
  });
  it('Thin Red Line: +1 on the top defence die for 3+ armies', () => {
    const s = duel('chud', ['cossack', 'redcoat']);
    const [a, b] = edge(s, false);
    s.owner[a] = 0; s.armies[a] = 10; s.armies[b] = 5;
    act(s, 0, { type: 'attack', from: a, to: b, dice: 1 }, dieRng([5, 4, 1]));
    expect(s.lastRoll!.def).toContain(5);
    expect(s.lastRoll!.attLost).toBe(1);
  });
  it('Amphibious: marines +1 across sea lanes', () => {
    const s = duel('chud', ['marines', 'cossack']);
    const [a, b] = edge(s, true);
    s.owner[a] = 0; s.armies[a] = 10; s.armies[b] = 3;
    act(s, 0, { type: 'attack', from: a, to: b, dice: 1 }, dieRng([4, 4, 1]));
    expect(s.lastRoll!.att).toEqual([5]);
    expect(s.lastRoll!.defLost).toBe(1);
  });
  it('Raiders: first conquest each turn adds an army; Robots +1 reinforcement; Samurai +2 trades', () => {
    const s = duel('chud', ['cossack', 'robots']);
    const [a, b] = edge(s, false);
    s.owner[a] = 0; s.armies[a] = 10; s.armies[b] = 1;
    act(s, 0, { type: 'attack', from: a, to: b, dice: 3 }, dieRng([6, 6, 6, 1]));
    act(s, 0, { type: 'move', n: 3 }, rnd);
    expect(s.armies[b]).toBe(4);
    expect(reinforcements(s, 1)).toBe(reinforcements({ ...s, perks: false }, 1)); // holds continents: no bonus
    const split = { ...s, owner: s.owner.map((_, i) => i % 2) };
    expect(reinforcements(split, 1)).toBe(reinforcements({ ...split, perks: false }, 1) + 1);

    const k = duel('chud', ['samurai', 'grande']);
    k.phase = 'reinforce'; k.players[0]!.cards = [{ t: -1, s: 3 }, { t: -1, s: 3 }, { t: -1, s: 3 }];
    const before = k.reserve;
    act(k, 0, { type: 'trade', cards: [0, 1, 2] }, rnd);
    expect(k.reserve - before).toBe(4 + 3);
  });
});

describe('8 factions, 2-8 players', () => {
  it('has 8 unique factions with unique colours', () => {
    expect(FACTIONS).toHaveLength(8);
    expect(new Set(FACTIONS.map((f) => f.color)).size).toBe(8);
    expect(MAX_PLAYERS).toBe(8);
  });
  it.each(CQ_MAPS.flatMap((m) => [2, 5, 8].map((n) => [m.id, n] as const)))('%s with %i bots: dealt fairly and runs to a winner', (id, n) => {
    const fs = FACTIONS.slice(0, n).map((f) => f.id);
    const s = newGame(fs.map((f, i) => ({ name: `B${i}`, bot: true, faction: f })), rnd, { map: id, perks: true });
    const T = mapById(id).territories.length;
    const counts = Array.from({ length: n }, (_, p) => s.owner.filter((o) => o === p).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    // leftover territories go to the later seats
    for (let p = 1; p < n; p++) expect(counts[p]).toBeGreaterThanOrEqual(counts[p - 1]!);
    for (let p = 1; p < n; p++) expect(startArmies(n, T, p, id)).toBeGreaterThanOrEqual(startArmies(n, T, p - 1, id));
    for (let i = 0; i < 200000 && s.phase !== 'over'; i++) act(s, s.turn, botAction(s, s.turn), rnd);
    expect(s.phase).toBe('over');
  });
  it('has a tuned seat table for every map and player count', () => {
    for (const m of CQ_MAPS) for (let n = 2; n <= 8; n++) {
      expect(SEAT_COMP[m.id]?.[n]).toBeTypeOf('number');
      expect(startArmies(n, m.territories.length, 0, m.id)).toBeGreaterThan(Math.ceil(m.territories.length / n));
    }
  });
  it('Forced March and Last Stand perks', () => {
    const s = duel('chud', ['legion', 'clans']);
    const [a, b] = edge(s, false);
    s.owner[a] = 0; s.armies[a] = 10; s.armies[b] = 1;
    act(s, 0, { type: 'attack', from: a, to: b, dice: 1 }, dieRng([5, 5]));
    expect(s.lastRoll!.def).toEqual([6]);
    expect(s.lastRoll!.attLost).toBe(1);
    const g = duel('chud', ['legion', 'clans']);
    const [x, y] = edge(g, false);
    g.owner[x] = 0; g.owner[y] = 0; g.armies[x] = 6; g.armies[y] = 1; g.phase = 'fortify';
    act(g, 0, { type: 'fortify', from: x, to: y, n: 3 }, rnd);
    expect(g.armies[y]).toBe(6);
    expect(g.armies[x]).toBe(3);
  });
});

describe('war tables', () => {
  it('seats up to 8 commanders and refuses a 9th', () => {
    const hub = new ConquestHub(rnd);
    const t = hub.create('QA-Host');
    for (let i = 0; i < 7; i++) hub.addBot(t.code, 'QA-Host');
    expect(t.seats).toHaveLength(8);
    expect(new Set(t.seats.map((s) => s.faction)).size).toBe(8);
    expect(new Set(t.seats.map((s) => s.color)).size).toBe(8);
    expect(t.seats.every((s) => s.name.length > 0)).toBe(true);
    expect(new Set(t.seats.map((s) => s.name)).size).toBe(8);
    expect(() => hub.addBot(t.code, 'QA-Host')).toThrow(/full/);
    expect(() => hub.join(t.code, 'QA-Late')).toThrow(/full/);
    hub.start(t.code, 'QA-Host');
    expect(t.game!.players).toHaveLength(8);
    hub.stop();
  });
  it('factions are unique, bots pick one, map/perks settings flow into the game', () => {
    const hub = new ConquestHub(rnd);
    const t = hub.create('QA-Ann');
    hub.join(t.code, 'QA-Bob');
    hub.addBot(t.code, 'QA-Ann');
    expect(new Set(t.seats.map((s) => s.faction)).size).toBe(3);
    expect(() => hub.setFaction(t.code, 'QA-Bob', t.seats[0]!.faction)).toThrow(/already/);
    expect(() => hub.setFaction(t.code, 'QA-Bob', 'aliens')).toThrow(/factions/);
    const free = FACTIONS.find((f) => !t.seats.some((s) => s.faction === f.id))!;
    hub.setFaction(t.code, 'QA-Bob', free.id);
    expect(t.seats[1]!.faction).toBe(free.id);
    expect(() => hub.configure(t.code, 'QA-Bob', { map: 'world' })).toThrow(/host/);
    expect(() => hub.configure(t.code, 'QA-Ann', { map: 'atlantis' })).toThrow(/map/);
    hub.configure(t.code, 'QA-Ann', { map: 'world', perks: false, manualSetup: false });
    hub.start(t.code, 'QA-Ann');
    expect(t.game!.map).toBe('world');
    expect(t.game!.perks).toBeUndefined();
    expect(t.game!.owner).toHaveLength(42);
    expect(t.game!.players.map((p) => p.faction)).toEqual(t.seats.map((s) => s.faction));
    expect(() => hub.setFaction(t.code, 'QA-Ann', free.id)).toThrow(/locked/);
    hub.stop();
  });

  it('versioned snapshots: a stale instance adopts the newer state instead of rolling back', async () => {
    const store = new MemoryCqStore();
    const a = new ConquestHub(rnd);
    await a.attach(store);
    const t = a.create('QA-Ann');
    a.join(t.code, 'QA-Bob');
    a.configure(t.code, 'QA-Ann', { manualSetup: false });
    a.start(t.code, 'QA-Ann');
    await a.flush();
    // A second instance boots from the same store (a deploy overlap) while the first keeps playing.
    const b = new ConquestHub(rnd);
    await b.attach(store);
    const g = a.tables.get(t.code)!.game!;
    const who = g.turn === 0 ? 'QA-Ann' : 'QA-Bob';
    a.action(t.code, who, { type: 'place', t: g.owner.indexOf(g.turn), n: g.reserve });
    await new Promise((res) => setTimeout(res, 10));
    expect(b.tables.get(t.code)!.game!.phase).toBe('reinforce');
    expect(await b.sync(t.code)).toBe(false);
    expect(b.tables.get(t.code)!.game!.phase).toBe('attack');
    // An old write can never overwrite a newer one.
    const stale = { ...JSON.parse(store.rows.get(t.code)!), v: 1 };
    expect(await store.save(stale)).toBe(false);
    expect(JSON.parse(store.rows.get(t.code)!).game.phase).toBe('attack');
    // Pending move-in survives a restart.
    const bt = b.tables.get(t.code)!;
    expect(bt.v).toBeGreaterThan(1);
    a.stop(); b.stop();
  });

  it('a conflicting save from the losing instance reloads the winner', async () => {
    const store = new MemoryCqStore();
    const a = new ConquestHub(rnd); await a.attach(store);
    const t = a.create('QA-Ann'); a.join(t.code, 'QA-Bob'); a.configure(t.code, 'QA-Ann', { manualSetup: false }); a.start(t.code, 'QA-Ann');
    await a.flush();
    const b = new ConquestHub(rnd); await b.attach(store);
    const ga = a.tables.get(t.code)!.game!;
    const who = ga.turn === 0 ? 'QA-Ann' : 'QA-Bob';
    a.action(t.code, who, { type: 'place', t: ga.owner.indexOf(ga.turn), n: 1 });
    await new Promise((res) => setTimeout(res, 10));
    const gb = b.tables.get(t.code)!.game!;
    b.action(t.code, who, { type: 'place', t: gb.owner.indexOf(gb.turn), n: gb.reserve }); // same version number: rejected
    await new Promise((res) => setTimeout(res, 20));
    expect(b.tables.get(t.code)!.game!.reserve).toBe(ga.reserve);
    a.stop(); b.stop();
  });
});
