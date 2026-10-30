import { describe, expect, it } from 'vitest';
import { Room } from '../server/rooms';
import { scrambleSeats, type Arrangement } from '../shared/scramble';
import { clockPreset, seatsFor, seatSide, teamSizes, type Seat, type TableSetup } from '../shared/types';

function seeded(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 0x1_0000_0000;
  };
}

function filled(setup: TableSetup): Arrangement<string> {
  const out: Arrangement<string> = {};
  seatsFor(setup).forEach((seat, index) => {
    out[seat] = `p${index}`;
  });
  return out;
}

const SETUPS: TableSetup[] = [
  { mode: '1v1', pairSide: null },
  { mode: '2v2', pairSide: null },
  { mode: '3v3', pairSide: null },
  { mode: '2v1', pairSide: 'white' },
  { mode: '2v1', pairSide: 'black' },
  { mode: '3v2', pairSide: 'white' },
  { mode: '3v2', pairSide: 'black' },
];

describe('scramble teams on rematch', () => {
  for (const setup of SETUPS) {
    it(`keeps team sizes and places everyone once in ${setup.mode} ${setup.pairSide ?? ''}`, () => {
      for (let seed = 1; seed < 40; seed += 1) {
        const before = filled(setup);
        const after = scrambleSeats(before, setup, seeded(seed));
        const seats = Object.keys(after) as Seat[];
        expect(seats.sort()).toEqual(seatsFor(setup).sort());
        expect(Object.values(after).sort()).toEqual(Object.values(before).sort());
        const sizes = teamSizes(setup);
        expect(seats.filter((seat) => seatSide(seat) === 'white')).toHaveLength(sizes.white);
        expect(seats.filter((seat) => seatSide(seat) === 'black')).toHaveLength(sizes.black);
        expect(seatsFor(setup).map((s) => after[s])).not.toEqual(seatsFor(setup).map((s) => before[s]));
      }
    });
  }

  it('changes the teams, not just seat order, when it can', () => {
    const setup: TableSetup = { mode: '2v2', pairSide: null };
    for (let seed = 1; seed < 40; seed += 1) {
      const after = scrambleSeats(filled(setup), setup, seeded(seed));
      const white = [after.white1, after.white2].sort();
      expect(white).not.toEqual(['p0', 'p2']);
    }
  });

  it('swaps colors in 1v1 even with an unlucky random source', () => {
    const setup: TableSetup = { mode: '1v1', pairSide: null };
    const after = scrambleSeats({ white1: 'a', black1: 'b' }, setup, () => 0.999);
    expect(after).toEqual({ white1: 'b', black1: 'a' });
  });

  it('reseats a room on rematch and announces the new teams', () => {
    const room = new Room('SCRAM1', clockPreset('off')!);
    expect(room.scrambleRematch).toBe(true);
    room.random = seeded(7);
    const names = ['Ada', 'Ben', 'Cy', 'Di'];
    const seats: Seat[] = ['white1', 'black1', 'white2', 'black2'];
    const tokens = names.map((name, index) => {
      const token = room.addMember(name);
      room.sit(token, seats[index], 1);
      return token;
    });
    room.resign(tokens[0]);
    for (const token of tokens) room.voteRematch(token, 2);
    const view = room.view('nobody', 3);
    expect(view.status).toBe('playing');
    expect(view.teams?.scrambled).toBe(true);
    const placed = [...view.teams!.white, ...view.teams!.black].sort();
    expect(placed).toEqual([...names].sort());
    expect([...view.teams!.white].sort()).not.toEqual(['Ada', 'Cy']);
    expect(new Room('SOLO01', clockPreset('off')!, { mode: '1v1', pairSide: null }).scrambleRematch).toBe(false);
  });
});
