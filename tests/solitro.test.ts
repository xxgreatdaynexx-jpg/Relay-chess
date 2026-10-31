import { newDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';
import type { Card, GameState } from '../shared/klondike';
import {
  act, ANTE_BASE, blindTarget, BOSSES, interestFor, JOKERS, newRun, OMENS, payoutFor, sellValue, viewRun, BASE_PLAYS, BASE_REDEALS,
  JOKER_SLOTS, MAX_ANTE, type Run, type JokerId, type Action,
} from '../shared/solitro';
import { PgSolitroStore, SolitroHall } from '../server/solitro';
import { boardFor } from '../shared/qa';

const c = (id: string, faceUp = true): Card => ({ id, suit: id[0] as Card['suit'], rank: Number(id.slice(1)), faceUp });
function board(p: Partial<GameState> = {}): GameState {
  return { stock: [], waste: [], foundations: [[], [], [], []], tableau: [[], [], [], [], [], [], []], moves: 0, startedAt: 0, ...p };
}
function run(p: Partial<Run> = {}, b: Partial<GameState> = {}): Run {
  const r = newRun(1);
  return { ...r, target: 1e9, ...p, board: board(b) };
}
const toF = (i = 0): Action => ({ t: 'move', from: { kind: 'waste' }, to: { kind: 'foundation', index: i } });
const jk = (...ids: JokerId[]) => ids.map((id) => ({ id }));

describe('solitro content', () => {
  it('has 20+ original jokers, bosses and omens with unique ids', () => {
    expect(JOKERS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(JOKERS.map((j) => j.id)).size).toBe(JOKERS.length);
    expect(BOSSES.length).toBeGreaterThanOrEqual(8);
    expect(OMENS.length).toBeGreaterThanOrEqual(6);
    for (const j of JOKERS) expect(j.text.length).toBeGreaterThan(5);
  });
  it('blind targets escalate: small < big < boss and ante over ante; The Wall is ×3', () => {
    for (let a = 1; a <= MAX_ANTE; a++) {
      expect(blindTarget(a, 0)).toBe(ANTE_BASE[a]);
      expect(blindTarget(a, 1)).toBe(ANTE_BASE[a] * 1.5);
      expect(blindTarget(a, 2)).toBe(ANTE_BASE[a] * 2);
      expect(blindTarget(a, 2, 'wall')).toBe(ANTE_BASE[a] * 3);
      if (a > 1) expect(blindTarget(a, 0)).toBeGreaterThan(blindTarget(a - 1, 2) / 2);
    }
  });
});

describe('solitro new run', () => {
  it('starts at ante 1 small blind with a full Klondike deal', () => {
    const r = newRun(42);
    expect(r).toMatchObject({ ante: 1, blind: 0, phase: 'blind', money: 4, plays: BASE_PLAYS, redeals: BASE_REDEALS, score: 0, target: 300 });
    expect([...r.board.stock, ...r.board.tableau.flat()]).toHaveLength(52);
  });
  it('is deterministic per seed and differs across seeds', () => {
    expect(newRun(5, 0)).toEqual(newRun(5, 0));
    expect(newRun(5, 0).board).not.toEqual(newRun(6, 0).board);
  });
  it('view hides face-down cards, stock order and the seed', () => {
    const v = viewRun(newRun(9));
    expect(v.seed).toBe(0);
    expect(v.board.stock.every((x) => x.rank === 0 && !x.faceUp)).toBe(true);
    for (const p of v.board.tableau) for (const x of p) if (!x.faceUp) expect(x.rank).toBe(0);
    expect(v.board.tableau.map((p) => p[p.length - 1].rank > 0)).toEqual([true, true, true, true, true, true, true]);
  });
});

describe('solitro scoring engine', () => {
  it('foundation play: chips = 5 + rank chips, mult 1; Ace counts 11', () => {
    const r = act(run({}, { waste: [c('H1')] }), toF());
    expect(r.last).toMatchObject({ chips: 16, mult: 1, total: 16 });
    expect(r.score).toBe(16);
    expect(r.plays).toBe(BASE_PLAYS - 1);
  });
  it('streaks of foundation plays add +1 mult each; a scoreless tableau move breaks it', () => {
    let r = run({}, { waste: [c('S2'), c('S1')], tableau: [[c('H5')], [c('C6')], [], [], [], [], []] });
    r = act(r, toF());
    r = act(r, toF());
    expect(r.last).toMatchObject({ chips: 7, mult: 2, total: 14 });
    expect(r.streak).toBe(2);
    r = act(r, { t: 'move', from: { kind: 'tableau', index: 0, cardIndex: 0 }, to: { kind: 'tableau', index: 1 } });
    expect(r.streak).toBe(0);
  });
  it('Tightrope keeps the streak through tableau moves', () => {
    let r = run({ jokers: jk('tightrope') }, { waste: [c('S1')], tableau: [[c('H5')], [c('C6')], [], [], [], [], []] });
    r = act(r, toF());
    r = act(r, { t: 'move', from: { kind: 'tableau', index: 0, cardIndex: 0 }, to: { kind: 'tableau', index: 1 } });
    expect(r.streak).toBe(1);
  });
  it('reveal, cascade and column clear score; each only once per blind', () => {
    let r = run({}, { tableau: [[c('D9', false), c('H5'), c('S4'), c('D3')], [c('C6')], [], [], [], [], []] });
    r = act(r, { t: 'move', from: { kind: 'tableau', index: 0, cardIndex: 1 }, to: { kind: 'tableau', index: 1 } });
    // reveal (15, +1) + cascade of 3 (30, +2) → 45 × 3
    expect(r.last).toMatchObject({ chips: 45, mult: 3, total: 135 });
    expect(r.board.tableau[0][0].faceUp).toBe(true);
    const clear = act(run({}, { tableau: [[c('S13')], [], [], [], [], [], []] }), { t: 'move', from: { kind: 'tableau', index: 0, cardIndex: 0 }, to: { kind: 'tableau', index: 1 } });
    expect(clear.last).toMatchObject({ chips: 40, mult: 2, total: 80 });
    const back = act(clear, { t: 'move', from: { kind: 'tableau', index: 1, cardIndex: 0 }, to: { kind: 'tableau', index: 0 } });
    expect(back.last).toMatchObject({ chips: 40 }); // column 1 clears for the first time
    const again = act(back, { t: 'move', from: { kind: 'tableau', index: 0, cardIndex: 0 }, to: { kind: 'tableau', index: 1 } });
    expect(again.last).toBeNull(); // column 0 already scored its clear
  });
  it('a card scores on a foundation only the first time (no farming by moving it down and up)', () => {
    let r = run({}, { waste: [c('H1')], tableau: [[], [], [], [], [], [], []], foundations: [[], [], [], []] });
    r = act(r, toF());
    r.board.tableau[0] = [c('S2')];
    const s1 = r.score;
    r = act(r, { t: 'move', from: { kind: 'foundation', index: 0 }, to: { kind: 'tableau', index: 0 } });
    r = act(r, { t: 'move', from: { kind: 'tableau', index: 0, cardIndex: 1 }, to: { kind: 'foundation', index: 0 } });
    expect(r.score).toBe(s1);
  });
  it('completing a suit adds +100 chips and ×2 mult', () => {
    const f = Array.from({ length: 12 }, (_, i) => c(`C${i + 1}`));
    const r = act(run({}, { waste: [c('C13')], foundations: [f, [], [], []] }), toF());
    expect(r.last).toMatchObject({ chips: 115, mult: 2, total: 230 });
  });
  it('winning the target ends the blind immediately and pays out', () => {
    const r = act(run({ target: 10, money: 4 }, { waste: [c('H1')] }), toF());
    expect(r.phase).toBe('shop');
    expect(r.blind).toBe(1);
    expect(r.payout).toMatchObject({ reward: 3, leftover: Math.floor((BASE_PLAYS - 1) / 5), interest: 0 });
    expect(r.money).toBe(4 + r.payout!.total);
    expect(r.shop.length).toBe(3);
  });
  it('running out of plays below target ends the run', () => {
    const r = act(run({ plays: 1, target: 1000 }, { waste: [c('H1')] }), toF());
    expect(r.phase).toBe('over');
    expect(() => act(r, toF())).toThrow(/over/);
  });
  it('rejects illegal moves without spending a play', () => {
    const r = run({}, { waste: [c('H5')] });
    expect(() => act(r, toF())).toThrow();
    expect(r.plays).toBe(BASE_PLAYS);
  });
  it('draws are free; recycling the waste uses a redeal and is capped', () => {
    let r = run({}, { stock: [c('S5', false)] });
    r = act(r, { t: 'draw' });
    expect(r.plays).toBe(BASE_PLAYS);
    r = act(r, { t: 'draw' });
    expect(r.redeals).toBe(BASE_REDEALS - 1);
    r = act(r, { t: 'draw' }); r = act(r, { t: 'draw' }); r = act(r, { t: 'draw' });
    expect(r.redeals).toBe(0);
    expect(() => act(act(r, { t: 'draw' }), { t: 'draw' })).toThrow(/redeal/i);
  });
});

describe('solitro jokers', () => {
  const one = (ids: JokerId[], card: string, extra: Partial<Run> = {}) => act(run({ jokers: jk(...ids), ...extra }, { waste: [c(card)] }), toF()).last!;
  it('chip and mult jokers', () => {
    expect(one(['ember'], 'H1')).toMatchObject({ chips: 16, mult: 5 });
    expect(one(['ledger'], 'H1')).toMatchObject({ chips: 46, mult: 1 });
    expect(one(['redtide'], 'H1').mult).toBe(5);
    expect(one(['redtide'], 'S1').mult).toBe(1);
    expect(one(['blackwater'], 'S1').mult).toBe(5);
    expect(one(['firstlight'], 'C1').mult).toBe(16);
    expect(one(['oddduck'], 'C1').chips).toBe(41);
    expect(one(['luckyseven'], 'C1').mult).toBe(1);
  });
  it('rank-based jokers', () => {
    const f6 = Array.from({ length: 6 }, (_, i) => c(`D${i + 1}`));
    expect(act(run({ jokers: jk('luckyseven') }, { waste: [c('D7')], foundations: [f6, [], [], []] }), toF()).last!.mult).toBe(2);
    const f1 = [c('D1')];
    expect(act(run({ jokers: jk('evenkeel') }, { waste: [c('D2')], foundations: [f1, [], [], []] }), toF()).last!.mult).toBe(5);
    const f10 = Array.from({ length: 10 }, (_, i) => c(`D${i + 1}`));
    const r = act(run({ jokers: jk('crown', 'magpie'), money: 0 }, { waste: [c('D11')], foundations: [f10, [], [], []] }), toF());
    expect(r.last!.chips).toBe(15 + 40);
    expect(r.money).toBe(1);
  });
  it('xmult jokers apply in order after additive ones', () => {
    expect(one(['ember', 'hourglass'], 'H1')).toMatchObject({ mult: 15 });
    expect(one(['hourglass', 'ember'], 'H1')).toMatchObject({ mult: 7 });
  });
  it('Minimalist scales with empty slots; Fat Wallet with money', () => {
    expect(one(['minimalist'], 'H1').mult).toBe(2); // 4 empty slots → ×2
    expect(one(['fatwallet'], 'H1', { money: 23 }).mult).toBe(5);
  });
  it('Snowball grows across plays and keeps its count', () => {
    let r = run({ jokers: jk('snowball') }, { waste: [c('S2'), c('S1')] });
    r = act(r, toF());
    expect(r.last!.mult).toBe(2);
    r = act(r, toF());
    expect(r.jokers[0].n).toBe(2);
    expect(r.last!.mult).toBe(1 + 1 + 2);
  });
  it('Domino doubles streak bonus; Avalanche, Sweeper and Completist multiply', () => {
    let r = run({ jokers: jk('domino') }, { waste: [c('S2'), c('S1')] });
    r = act(act(r, toF()), toF());
    expect(r.last!.mult).toBe(3);
    const av = act(run({ jokers: jk('avalanche') }, { tableau: [[c('H5'), c('S4'), c('D3')], [c('C6')], [], [], [], [], []] }), { t: 'move', from: { kind: 'tableau', index: 0, cardIndex: 0 }, to: { kind: 'tableau', index: 1 } });
    // cascade 3 (30, +2) + clear (40, +2) → mult 4 ×2 = 8
    expect(av.last).toMatchObject({ chips: 70, mult: 8 });
    const sw = act(run({ jokers: jk('sweeper') }, { tableau: [[c('S13')], [], [], [], [], [], []] }), { t: 'move', from: { kind: 'tableau', index: 0, cardIndex: 0 }, to: { kind: 'tableau', index: 1 } });
    expect(sw.last!.mult).toBe(6);
    const f = Array.from({ length: 12 }, (_, i) => c(`C${i + 1}`));
    expect(act(run({ jokers: jk('completist') }, { waste: [c('C13')], foundations: [f, [], [], []] }), toF()).last!.mult).toBe(6);
  });
  it('Lamplighter boosts reveals', () => {
    const r = act(run({ jokers: jk('lamplighter') }, { tableau: [[c('D9', false), c('H5')], [c('C6')], [], [], [], [], []] }), { t: 'move', from: { kind: 'tableau', index: 0, cardIndex: 1 }, to: { kind: 'tableau', index: 1 } });
    expect(r.last).toMatchObject({ chips: 55, mult: 4 });
  });
  it('plays/redeals jokers change the next blind', () => {
    const base = run({ phase: 'shop', jokers: jk('pocketwatch', 'secondwind') });
    const r = act(base, { t: 'next' });
    expect(r.plays).toBe(BASE_PLAYS + 8);
    expect(r.redeals).toBe(BASE_REDEALS + 1);
    expect(act(run({ phase: 'shop', jokers: jk('hourglass') }), { t: 'next' }).plays).toBe(BASE_PLAYS - 10);
  });
  it('editions: Gilt +50 chips, Neon +10 mult, Opal ×1.5', () => {
    const r = act(run({ jokers: [{ id: 'thriftjar', ed: 'gilt' }, { id: 'thriftjar', ed: 'neon' }, { id: 'thriftjar', ed: 'opal' }] }, { waste: [c('H1')] }), toF());
    expect(r.last).toMatchObject({ chips: 66, mult: 16.5, total: Math.floor(66 * 16.5) });
  });
});

describe('solitro enhancements and omens', () => {
  it('Etched, Inked, Iron and Gilded cards', () => {
    const play = (e: Run['enh'][string]) => act(run({ enh: { H1: e }, money: 0 }, { waste: [c('H1')] }), toF());
    expect(play('etched').last!.chips).toBe(46);
    expect(play('inked').last!.mult).toBe(5);
    expect(play('iron').last!.mult).toBe(1.5);
    expect(play('gilded').money).toBe(2);
  });
  it('enhancing omens change random cards and are consumed', () => {
    const r = act(run({ omens: ['anvil'] }), { t: 'use', i: 0 });
    expect(Object.values(r.enh).filter((e) => e === 'etched')).toHaveLength(3);
    expect(r.omens).toEqual([]);
  });
  it('omen messages never name face-down cards', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const base = newRun(seed);
      const r0: Run = { ...base, omens: ['anvil'] };
      const r = act(r0, { t: 'use', i: 0 });
      const hidden = new Set([...r.board.stock, ...r.board.tableau.flat()].filter((x) => !x.faceUp).map((x) => x.id));
      const lab = (id: string) => `${['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][Number(id.slice(1))]}${{ S: '♠', H: '♥', D: '♦', C: '♣' }[id[0]]}`;
      for (const id of Object.keys(r.enh)) if (hidden.has(id)) expect(r.note).not.toContain(lab(id));
      expect(r.note).toMatch(/became Etched/);
    }
  });
  it('flags a blind with no moves left, and ending it says so', () => {
    const stuckRun = act(run({ redeals: 0, omens: ['windfall'] }, { waste: [c('H5'), c('D9')], tableau: [[c('S7', false), c('C3')], [c('H12')], [], [], [], [], []] }), { t: 'use', i: 0 });
    expect(stuckRun.stuck).toBe(true);
    const ended = act(stuckRun, { t: 'forfeit' });
    expect(ended.phase).toBe('over');
    expect(ended.note).toBe('No moves left.');
    const ok = act(run({ redeals: 1, omens: ['windfall'] }, { waste: [c('S1'), c('D9')], tableau: [[c('C3')], [], [], [], [], [], []] }), { t: 'use', i: 0 });
    expect(ok.stuck).toBe(false);
  });
  it('a held Wellspring is not a deadlock: it can buy the redeal that reaches a buried card', () => {
    const r = act(run({ redeals: 0, omens: ['wellspring', 'windfall'] }, { stock: [], waste: [c('S1'), c('D9')], tableau: [[c('S7', false), c('C3')], [c('H12')], [], [], [], [], []] }), { t: 'use', i: 1 });
    expect(r.omens).toEqual(['wellspring']);
    expect(r.stuck).toBe(false);
    const gone = act(run({ redeals: 0, omens: ['windfall'] }, { stock: [], waste: [c('S1'), c('D9')], tableau: [[c('S7', false), c('C3')], [c('H12')], [], [], [], [], []] }), { t: 'use', i: 0 });
    expect(gone.stuck).toBe(true);
  });
  it('no enhancing omen names a face-down card', () => {
    const lab = (id: string) => `${['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][Number(id.slice(1))]}${{ S: '♠', H: '♥', D: '♦', C: '♣' }[id[0]]}`;
    for (const om of ['anvil', 'kiln', 'geode', 'gild', 'horseshoe', 'forge'] as const) {
      for (let seed = 1; seed <= 15; seed++) {
        const base = newRun(seed);
        const r = act({ ...base, omens: [om] }, { t: 'use', i: 0 });
        const hidden = new Set([...r.board.stock, ...r.board.tableau.flat()].filter((x) => !x.faceUp).map((x) => x.id));
        for (const id of Object.keys(r.enh)) if (hidden.has(id)) expect(r.note).not.toContain(lab(id));
      }
    }
  });
  it('Windfall doubles money up to +$20; blind-only omens refuse in the shop', () => {
    expect(act(run({ omens: ['windfall'], money: 7 }), { t: 'use', i: 0 }).money).toBe(14);
    expect(act(run({ omens: ['windfall'], money: 40 }), { t: 'use', i: 0 }).money).toBe(60);
    expect(() => act(run({ phase: 'shop', omens: ['sundial'] }), { t: 'use', i: 0 })).toThrow(/during a blind/);
    expect(act(run({ omens: ['sundial'] }), { t: 'use', i: 0 }).plays).toBe(BASE_PLAYS + 10);
  });
});

describe('solitro shop economy', () => {
  it('interest is $1 per $5, capped at $5 (Compound Owl raises to $10)', () => {
    expect(interestFor(run({ money: 4 }))).toBe(0);
    expect(interestFor(run({ money: 14 }))).toBe(2);
    expect(interestFor(run({ money: 99 }))).toBe(5);
    expect(interestFor(run({ money: 99, jokers: jk('compound') }))).toBe(10);
  });
  it('leftover plays pay $1 per 5 (Thrift Jar: per 3); reward grows by blind', () => {
    expect(payoutFor(run({ plays: 14, blind: 0, money: 0 }))).toMatchObject({ reward: 3, leftover: 2, interest: 0, total: 5 });
    expect(payoutFor(run({ plays: 14, blind: 2, money: 10, jokers: jk('thriftjar') }))).toMatchObject({ reward: 5, leftover: 4, interest: 2, total: 11 });
  });
  it('buy, sell, slots, reroll cost rising and reset per shop', () => {
    let r = act(run({ target: 1, money: 100 }, { waste: [c('H1')] }), toF());
    expect(r.phase).toBe('shop');
    const jokerIdx = r.shop.findIndex((x) => x.kind === 'joker');
    const cost = r.shop[jokerIdx].cost;
    const before = r.money;
    r = act(r, { t: 'buy', i: jokerIdx });
    expect(r.money).toBe(before - cost);
    expect(r.jokers).toHaveLength(1);
    expect(() => act(r, { t: 'buy', i: jokerIdx })).toThrow(/Already/);
    const m = r.money;
    r = act(r, { t: 'reroll' });
    expect(r.money).toBe(m - 5);
    r = act(r, { t: 'reroll' });
    expect(r.money).toBe(m - 11);
    expect(r.rerollCost).toBe(7);
    expect(r.shop.every((x) => x.kind === 'omen' || !r.jokers.some((j) => j.id === x.id))).toBe(true);
    const sv = sellValue(r.jokers[0]);
    const m2 = r.money;
    r = act(r, { t: 'sell', i: 0 });
    expect(r.money).toBe(m2 + sv);
    r = act(r, { t: 'next' });
    expect(r.phase).toBe('blind');
    r.target = 1; r.board = board({ waste: [c('S1')] });
    r = act(r, toF());
    expect(r.phase).toBe('shop');
    expect(r.rerollCost).toBe(5);
  });
  it('cannot buy without money or with full slots', () => {
    const r = act(run({ target: 1, money: 0 }, { waste: [c('H1')] }), toF());
    const poor = { ...r, money: 0 };
    expect(() => act(poor, { t: 'buy', i: 0 })).toThrow(/money/);
    const full = { ...r, money: 99, jokers: jk('ember', 'ledger', 'redtide', 'blackwater', 'crown').slice(0, JOKER_SLOTS) };
    const ji = full.shop.findIndex((x) => x.kind === 'joker');
    expect(() => act(full, { t: 'buy', i: ji })).toThrow(/slots full/);
  });
  it('sell value is half the cost, at least $1', () => {
    expect(sellValue({ id: 'ember' })).toBe(2);
    expect(sellValue({ id: 'hourglass', ed: 'opal' })).toBe(6);
  });
});

describe('solitro boss blinds', () => {
  const bossRun = (boss: Run['boss'], p: Partial<Run> = {}, b: Partial<GameState> = {}) => run({ blind: 2, boss, ...p }, b);
  it('suit bosses make that suit score nothing (and skip its jokers)', () => {
    const r = act(bossRun('thorn', { jokers: jk('redtide') }, { waste: [c('H1')] }), toF());
    expect(r.last).toBeNull();
    expect(r.score).toBe(0);
    expect(act(bossRun('thorn', {}, { waste: [c('S1')] }), toF()).last!.total).toBe(16);
    expect(act(bossRun('gloom', {}, { waste: [c('S1')] }), toF()).last).toBeNull();
  });
  it('The Veil silences face cards; The Stall stops streaks', () => {
    const f10 = Array.from({ length: 10 }, (_, i) => c(`D${i + 1}`));
    expect(act(bossRun('veil', {}, { waste: [c('D11')], foundations: [f10, [], [], []] }), toF()).last).toBeNull();
    let r = bossRun('stall', {}, { waste: [c('S2'), c('S1')] });
    r = act(act(r, toF()), toF());
    expect(r.last!.mult).toBe(1);
  });
  it('The Hush disables the leftmost joker', () => {
    expect(act(bossRun('hush', { jokers: jk('ember', 'ledger') }, { waste: [c('H1')] }), toF()).last).toMatchObject({ chips: 46, mult: 1 });
  });
  it('The Drought removes redeals; The Vise removes 15 plays; The Wall triples the target', () => {
    const at = (boss: Run['boss']) => act({ ...run({ phase: 'shop', blind: 2, boss, ante: 4 }) }, { t: 'next' });
    expect(at('drought').redeals).toBe(0);
    expect(at('vise').plays).toBe(BASE_PLAYS - 15);
    expect(at('wall').target).toBe(ANTE_BASE[4] * 3);
    expect(at('thorn').target).toBe(ANTE_BASE[4] * 2);
  });
  it('beating the boss advances the ante and rolls a new boss; ante 8 boss wins the run', () => {
    const r = act(bossRun('thorn', { target: 1, ante: 1 }, { waste: [c('S1')] }), toF());
    expect(r).toMatchObject({ phase: 'shop', ante: 2, blind: 0 });
    const won = act(bossRun('thorn', { target: 1, ante: MAX_ANTE }, { waste: [c('S1')] }), toF());
    expect(won.phase).toBe('won');
  });
  it('bosses respect their minimum ante', () => {
    for (let s = 0; s < 200; s++) expect(['thorn', 'rust', 'gloom', 'bramble', 'drought']).toContain(newRun(s).boss);
  });
});

describe('solitro persistence and best-ante board', () => {
  const pool = () => new (newDb({ noAstCoverageCheck: true }).adapters.createPg().Pool)();
  it('server owns the run; it survives a restart via Postgres', async () => {
    const p = pool();
    const a = new SolitroHall(() => 1234);
    expect(await a.attach(new PgSolitroStore(p))).toBe(true);
    const v = a.start('Dayne');
    expect(v.seed).toBe(0);
    a.act('Dayne', { t: 'draw' });
    const raw = a.rawRun('Dayne')!;
    await a.flush();
    const b = new SolitroHall();
    await b.attach(new PgSolitroStore(p));
    expect(b.rawRun('Dayne')).toEqual(raw);
    expect(b.state('dayne').best).toMatchObject({ runs: 1, bestAnte: 1 });
  });
  it('records highest ante, wins and hides QA names from non-QA viewers', () => {
    const h = new SolitroHall(() => 7);
    h.start('Ann'); h.start('QA-Tess');
    const raw = h.rawRun('Ann')!;
    raw.ante = 3; raw.blind = 2; raw.target = 1; raw.board = board({ waste: [c('S1')] });
    h.act('Ann', toF());
    const rows = h.standings();
    expect(rows.find((x) => x.name === 'Ann')).toMatchObject({ bestAnte: 4, runs: 1 });
    expect(boardFor(rows, false).map((x) => x.name)).toEqual(['Ann']);
    expect(boardFor(rows, true).map((x) => x.name)).toContain('QA-Tess');
  });
  it('a new run counts runs but never lowers the best ante', () => {
    const h = new SolitroHall(() => 7);
    h.start('Bo');
    h.rawRun('Bo')!.ante = 5;
    h.act('Bo', { t: 'forfeit' });
    h.start('Bo');
    expect(h.state('Bo').best).toMatchObject({ bestAnte: 5, runs: 2 });
  });
  it('refuses actions without a run', () => {
    expect(() => new SolitroHall().act('Nobody', { t: 'draw' })).toThrow(/Start a run/);
  });
});
