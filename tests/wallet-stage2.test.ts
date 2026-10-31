import { beforeEach, describe, expect, it } from 'vitest';
import { getBank, resetBank } from '../server/casino-store.js';
import { resetConquest } from '../server/conquest.js';
import { resetSolitro } from '../server/solitro.js';
import { solitroPayout, SOLITRO_MULT } from '../shared/solitro.js';

const chips = (n: string) => getBank().account(n).chips;

describe('conquest wagers', () => {
  beforeEach(() => { resetBank(); });

  it('escrows at start, winner takes all, resign counts as a loss', () => {
    const hub = resetConquest();
    const t = hub.create('QA-CqA');
    hub.configure(t.code, 'QA-CqA', { wager: 50 });
    expect(() => hub.addBot(t.code, 'QA-CqA')).toThrow(/No bots/);
    hub.join(t.code, 'QA-CqB');
    hub.join(t.code, 'QA-CqC');
    hub.start(t.code, 'QA-CqA');
    expect(chips('QA-CqA')).toBe(950);
    expect(chips('QA-CqB')).toBe(950);
    hub.leave(t.code, 'QA-CqB');
    hub.leave(t.code, 'QA-CqC');
    expect(t.game?.phase).toBe('over');
    expect(chips('QA-CqA')).toBe(1100);
    expect(chips('QA-CqB')).toBe(950);
    expect(t.wagerResult?.pot).toBe(150);
    hub.drop(t.code); // already settled: no double refund
    expect(chips('QA-CqB')).toBe(950);
    hub.stop();
  });

  it('refunds when a started war is dropped, and blocks broke joiners', () => {
    const hub = resetConquest();
    const t = hub.create('QA-CqA');
    hub.configure(t.code, 'QA-CqA', { wager: 100 });
    getBank().transfer('QA-Poor', -950, { game: 'test' });
    expect(() => hub.join(t.code, 'QA-Poor')).toThrow(/100 chips/);
    hub.join(t.code, 'QA-CqB');
    hub.start(t.code, 'QA-CqA');
    expect(chips('QA-CqA')).toBe(900);
    hub.drop(t.code);
    expect(chips('QA-CqA')).toBe(1000);
    expect(chips('QA-CqB')).toBe(1000);
    hub.stop();
  });

  it('cannot set a wager with bots seated', () => {
    const hub = resetConquest();
    const t = hub.create('QA-CqA');
    hub.addBot(t.code, 'QA-CqA');
    expect(() => hub.configure(t.code, 'QA-CqA', { wager: 10 })).toThrow(/No bots/);
    hub.stop();
  });
});

describe('solitro buy-in', () => {
  beforeEach(() => { resetBank(); });

  it('free mode moves no chips', () => {
    const hall = resetSolitro(() => 7);
    hall.start('QA-Sol');
    hall.act('QA-Sol', { t: 'forfeit' });
    expect(chips('QA-Sol')).toBe(1000);
  });

  it('buy-in is taken up front and paid by ante reached, once', () => {
    const hall = resetSolitro(() => 7);
    const run = hall.start('QA-Sol', Date.now(), 50);
    expect(run.buyIn).toBe(50);
    expect(chips('QA-Sol')).toBe(950);
    hall.act('QA-Sol', { t: 'forfeit' }); // ante 1 pays x0
    expect(chips('QA-Sol')).toBe(950);
    expect(hall.rawRun('QA-Sol')?.paidOut).toBe(0);
    expect(() => hall.start('QA-Sol', Date.now(), 33)).toThrow(/buy-in/);
    getBank().transfer('QA-Sol', -940, { game: 'test' });
    expect(() => hall.start('QA-Sol', Date.now(), 25)).toThrow(/25 chips/);
  });

  it('payout schedule scales with ante', () => {
    const base = { buyIn: 100, phase: 'over' } as never as Parameters<typeof solitroPayout>[0];
    expect(solitroPayout({ ...base, ante: 3 })).toBe(100 * SOLITRO_MULT[3]);
    expect(solitroPayout({ ...base, ante: 8, phase: 'won' })).toBe(1000);
    expect(solitroPayout({ ...base, buyIn: 0, ante: 5 })).toBe(0);
  });

  it('replacing a live staked run cashes it out', () => {
    const hall = resetSolitro(() => 7);
    hall.start('QA-Sol', Date.now(), 10);
    hall.start('QA-Sol');
    expect(chips('QA-Sol')).toBe(990);
  });
});
