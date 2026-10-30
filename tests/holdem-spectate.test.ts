import { describe, expect, it } from 'vitest';
import { equity, HE_SPECTATE_DELAY_MS } from '../shared/holdem.js';
import type { CasinoCard, Suit } from '../shared/casino.js';
import { CasinoBank } from '../server/casino-store.js';
import { HoldemTable } from '../server/holdem.js';
import { HoldemSpectators, type Viewer } from '../server/holdem-spectate.js';

const card = (s: string): CasinoCard => {
  const r = s.slice(0, -1);
  const rank = r === 'A' ? 1 : r === 'K' ? 13 : r === 'Q' ? 12 : r === 'J' ? 11 : r === 'T' ? 10 : Number(r);
  return { id: s, rank, suit: s.slice(-1) as Suit, faceUp: true };
};
const cards = (s: string) => s.split(' ').map(card);
const DECK = 'AS KD AH KC 2C 7D 9H JS 3D QS QH 4C 5D 6H 8C';

function setup(delay = HE_SPECTATE_DELAY_MS) {
  const bank = new CasinoBank();
  const t = new HoldemTable('T1', bank, Math.random, () => cards(DECK));
  t.sit('Ann', 500, 0);
  t.sit('Bob', 500, 0);
  t.startHand(1000);
  const sp = new HoldemSpectators(delay, () => 0.5);
  sp.noteIdentity({ id: 'sa', name: 'Ann', ip: '1.1.1.1', device: 'dev-ann-123' });
  sp.noteIdentity({ id: 'sb', name: 'Bob', ip: '2.2.2.2', device: 'dev-bob-123' });
  return { t, sp };
}
const guest = (o: Partial<Viewer> = {}): Viewer => ({ id: 'g', name: 'Cy', ip: '9.9.9.9', device: 'dev-cy-1234', ...o });
const shown = (v: { seats: ({ cards: (CasinoCard | null)[] } | null)[] }) => v.seats.flatMap((s) => s?.cards ?? []).filter(Boolean).length;

describe("hold'em card visibility", () => {
  it('seated players see only their own hole cards before showdown', () => {
    const { t } = setup();
    const v = t.view('Ann', 1000);
    expect(v.seats[v.you!]!.cards.every(Boolean)).toBe(true);
    for (const s of v.seats) if (s && !s.you) expect(s.cards.every((c) => c === null)).toBe(true);
    expect(shown(t.view(null, 1000))).toBe(0);
    expect(JSON.stringify(t.view('Bob', 1000))).not.toContain('"AS"');
  });
  it('the default delay is 2 seconds', () => expect(HE_SPECTATE_DELAY_MS).toBe(2000));
  it('spectators see every hand with odds, but only after the delay', () => {
    const { t, sp } = setup();
    expect(sp.watch(t, guest(), 1000)).toBeNull(); // nothing until the delay passes
    expect(sp.due([t], 2500)[0]!.view).toBeNull();
    const out = sp.due([t], 3100);
    const v = out[0]!.view!;
    expect(shown(v)).toBe(4);
    expect(v.spectator).toBe(true);
    expect(v.watchers).toBe(1);
    const odds = Object.values(v.odds);
    expect(odds).toHaveLength(2);
    expect(odds.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1);
  });
  it('the delayed feed lags the action as well as the cards', () => {
    const { t, sp } = setup();
    sp.watch(t, guest(), 1000);
    const toAct = t.seats[t.toAct!]!.name;
    t.act(toAct, 'call', 0, 5000);
    sp.record(t, 5000);
    const early = sp.frameFor('T1', 6000)!;
    expect(early.seats.find((s) => s?.name === toAct)!.lastAction).not.toMatch(/Call/);
    const late = sp.frameFor('T1', 7100)!;
    expect(late.seats.find((s) => s?.name === toAct)!.lastAction).toMatch(/Call/);
  });
  it('blocks a seated name or device, but not a shared IP alone, from spectating the same table', () => {
    const { t, sp } = setup();
    expect(() => sp.watch(t, guest({ name: 'ann' }), 1000)).toThrow(/seated/);
    expect(() => sp.watch(t, guest({ name: null, ip: '1.1.1.1', device: 'dev-ann-123' }), 1000)).toThrow(/device/);
    expect(() => sp.watch(t, guest({ id: 'h', name: 'Housemate', ip: '1.1.1.1', device: 'dev-house-1' }), 1000)).not.toThrow(); // same Wi-Fi is fine
    expect(() => sp.watch(t, guest({ name: null, device: 'dev-bob-123' }), 1000)).toThrow(/device/);
    expect(() => sp.watch(t, guest(), 1000)).not.toThrow();
  });
  it('kicks a spectator whose name sits down at the table later', () => {
    const { t, sp } = setup();
    sp.watch(t, guest(), 1000);
    expect(sp.count('T1')).toBe(1);
    t.sit('Cy', 500, 2000);
    const out = sp.due([t], 10_000);
    expect(out[0]!.kicked).toMatch(/seated/);
    expect(sp.count('T1')).toBe(0);
  });
  it('equity: aces beat kings about 4 in 5; the river is exact', () => {
    const e = equity([cards('AS AH'), cards('KD KC')], [], 2000, Math.random);
    expect(e[0]!).toBeGreaterThan(0.75);
    expect(e[0]!).toBeLessThan(0.88);
    expect(equity([cards('AS AH'), cards('KD KC')], cards('KS 2C 7D 9H 3D'))).toEqual([0, 1]);
  });
});
