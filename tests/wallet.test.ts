import { beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { CasinoBank, PgCasinoStore, getBank, resetBank } from '../server/casino-store.js';
import { createRoom, pruneRooms, resetRooms } from '../server/rooms.js';
import { restoreRoom, snapshotRoom } from '../server/room-snapshot.js';
import { clockPreset } from '../shared/types.js';

const preset = clockPreset('10+0')!;
const solo = { mode: '1v1' as const, pairSide: null };

function table(wager: number, names = ['QA-A', 'QA-B']) {
  const room = createRoom(preset, names.length === 2 ? solo : { mode: '2v2', pairSide: null }, 'chess');
  room.wager = wager;
  const seats = names.length === 2 ? ['white1', 'black1'] : ['white1', 'black1', 'white2', 'black2'];
  const tokens = names.map((n) => room.addMember(n));
  tokens.forEach((t, i) => room.sit(t, seats[i]));
  return { room, tokens };
}
const chips = (n: string) => getBank().account(n).chips;

describe('wallet ledger', () => {
  beforeEach(() => { resetBank(); resetRooms(); });

  it('keyed transfers are idempotent and never go negative', () => {
    const bank = getBank();
    expect(bank.transfer('QA-A', -100, { key: 'k1', game: 'chess' })).toBe(true);
    expect(bank.transfer('QA-A', -100, { key: 'k1', game: 'chess' })).toBe(false);
    expect(chips('QA-A')).toBe(900);
    expect(() => bank.transfer('QA-A', -901, { key: 'k2', game: 'chess' })).toThrow(/Not enough/);
    expect(chips('QA-A')).toBe(900);
  });

  it('escrows at start, pays the winner the pot, and settles once', () => {
    const { room, tokens } = table(50);
    expect(chips('QA-A')).toBe(950);
    expect(chips('QA-B')).toBe(950);
    expect(room.view('x', Date.now()).pot).toBe(100);
    room.resign(tokens[1]); // resign = loss
    room.view('x', Date.now());
    room.view('x', Date.now());
    expect(chips('QA-A')).toBe(1050);
    expect(chips('QA-B')).toBe(950);
    expect(room.wagerResult?.deltas).toEqual({ 'QA-A': 50, 'QA-B': -50 });
  });

  it('splits the pot across the winning team in 2v2', () => {
    const { room, tokens } = table(25, ['QA-A', 'QA-B', 'QA-C', 'QA-D']);
    room.resign(tokens[1]);
    room.view('x', Date.now());
    expect([chips('QA-A'), chips('QA-C')]).toEqual([1025, 1025]);
    expect([chips('QA-B'), chips('QA-D')]).toEqual([975, 975]);
  });

  it('refunds a draw and a table closed before a result', () => {
    const { room, tokens } = table(40);
    room.offerDraw(tokens[0]);
    room.answerDraw(tokens[1], true);
    room.view('x', Date.now());
    expect([chips('QA-A'), chips('QA-B')]).toEqual([1000, 1000]);
    resetRooms();
    const t2 = table(40, ['QA-E', 'QA-F']);
    expect(chips('QA-E')).toBe(960);
    pruneRooms(Date.now() + 13 * 3600_000);
    expect([chips('QA-E'), chips('QA-F')]).toEqual([1000, 1000]);
    expect(t2.room.escrow?.settled).toBe(true);
  });

  it('blocks bots and players who cannot cover the stake', () => {
    const room = createRoom(preset, solo, 'chess');
    room.wager = 10;
    const a = room.addMember('QA-A');
    room.sit(a, 'white1');
    expect(() => room.addBot(a, 'black1')).toThrow(/No bots/);
    getBank().transfer('QA-Poor', -995, { game: 'test' });
    const p = room.addMember('QA-Poor');
    expect(() => room.sit(p, 'black1')).toThrow(/chips/);
    expect(room.game.status).toBe('lobby');
    expect(chips('QA-A')).toBe(1000);
  });

  it('rematch takes a fresh stake', () => {
    const { room, tokens } = table(10);
    room.resign(tokens[0]);
    room.view('x', Date.now());
    room.voteRematch(tokens[0]);
    room.voteRematch(tokens[1]);
    expect(room.game.status).toBe('playing');
    expect(room.escrow?.round).toBe(2);
    expect(chips('QA-A') + chips('QA-B')).toBe(1980);
  });

  it('escrow survives a restart and never pays twice', () => {
    const { room, tokens } = table(30);
    const snap = JSON.parse(JSON.stringify(snapshotRoom(room)));
    const back = restoreRoom(snap);
    expect(back.escrow?.stakes.length).toBe(2);
    expect(back.wager).toBe(30);
    room.resign(tokens[0]);
    room.view('x', Date.now());
    back.resign(tokens[0]);
    back.view('x', Date.now());
    expect([chips('QA-A'), chips('QA-B')]).toEqual([970, 1030]);
  });

  it('refunds stakes the snapshot never saw', () => {
    const room = createRoom(preset, solo, 'chess');
    room.wager = 20;
    const a = room.addMember('QA-A');
    const b = room.addMember('QA-B');
    room.sit(a, 'white1');
    const snap = JSON.parse(JSON.stringify(snapshotRoom(room))); // saved before the game started
    room.sit(b, 'black1');
    expect(chips('QA-A')).toBe(980);
    restoreRoom(snap);
    expect([chips('QA-A'), chips('QA-B')]).toEqual([1000, 1000]);
  });

  it('persists the ledger and its keys in postgres', async () => {
    const db = newDb({ noAstCoverageCheck: true });
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const bank = new CasinoBank();
    await bank.attach(new PgCasinoStore(pool));
    bank.transfer('QA-A', -75, { key: 'wager:X:1:qa-a:stake', game: 'chess' });
    bank.debit('QA-A', 5, 'slots');
    await bank.flush();
    const again = new CasinoBank();
    await again.attach(new PgCasinoStore(pool));
    expect(again.account('QA-A').chips).toBe(920);
    expect(again.hasKey('wager:X:1:qa-a:stake')).toBe(true);
    expect(again.transfer('QA-A', -75, { key: 'wager:X:1:qa-a:stake', game: 'chess' })).toBe(false);
    const hist = await again.recent('QA-A');
    expect(hist.map((t) => [t.game, t.amount])).toEqual([['slots', -5], ['chess', -75]]);
  });
});
