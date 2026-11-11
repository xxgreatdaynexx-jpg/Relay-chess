import { describe, expect, it, beforeEach } from 'vitest';
import { CasinoBank } from '../server/casino-store';
import { Cigarettes, grantFishingCigarette, payCigaretteBonus, setCigarettesForTest, resetCigarettesForTest } from '../server/cigarettes';
import { LocStore, setDefaultCityPack, setLocStore, type CityPack } from '../server/locstock';
import { CIGARETTE_BUFF_MAX_MS, CIGARETTE_BUFF_MS, CIGARETTE_BUFF_RATE, CIGARETTE_DAILY_CAP, CIGARETTE_DROP_RATE, CIGARETTE_ID, CIGARETTE_ITEM, CIGARETTE_PRICE, cigaretteBonus, extendCigaretteBuff } from '../shared/cigarettes';
import { GOODS, priceOf, sellable } from '../shared/mines';
import { hasItemIcon, itemIconSvg } from '../shared/itemIcons';
import { changelogEntry } from './helpers/changelog';
import { RESORT_WAREHOUSE, WAREHOUSE } from '../shared/inventoryLocations';

function memPack(): CityPack {
  const data = new Map<string, number>();
  const k = (n: string, t: string, id: string) => `${n.trim().toLowerCase()}\0${t}:${id}`;
  return {
    qty(name, type, id) { return data.get(k(name, type, id)) ?? 0; },
    stacks(name) {
      const out: Array<{ type: string; id: string; qty: number }> = [];
      for (const [key, qty] of data) {
        const [n, item] = key.split('\0') as [string, string];
        if (n !== name.trim().toLowerCase() || qty <= 0) continue;
        const [type, id] = item.split(':') as [string, string];
        out.push({ type, id, qty });
      }
      return out;
    },
    adjust(name, deltas) {
      for (const d of deltas) { if ((data.get(k(name, d.type, d.id)) ?? 0) + d.delta < 0) return false; }
      for (const d of deltas) {
        const key = k(name, d.type, d.id);
        const n = (data.get(key) ?? 0) + d.delta;
        if (n > 0) data.set(key, n); else data.delete(key);
      }
      return Promise.resolve();
    },
  };
}

async function wired() {
  const ls = new LocStore(null);
  await ls.init();
  ls.cityPack = memPack();
  setLocStore(ls);
  setDefaultCityPack(ls.cityPack);
  return ls;
}

describe('cigarette item', () => {
  it('is a stackable, house-sellable, market-tradeable good with an icon', () => {
    expect(GOODS[CIGARETTE_ID]?.name).toBe('Cigarette');
    expect(GOODS[CIGARETTE_ID]?.price).toBeCloseTo(CIGARETTE_PRICE, 8);
    expect(priceOf({ type: 'good', id: CIGARETTE_ID })).toBeCloseTo(CIGARETTE_PRICE, 8);
    expect(CIGARETTE_PRICE).toBeCloseTo(43.74, 8);
    expect(sellable({ type: 'good', id: CIGARETTE_ID })).toBe(true);
    expect(GOODS[CIGARETTE_ID]?.type).toBe('good');
    expect(hasItemIcon('good', CIGARETTE_ID)).toBe(true);
    expect(itemIconSvg('good', CIGARETTE_ID)).toMatch(/^<svg /);
    expect(CIGARETTE_ITEM).toBe('good:cigarette');
  });
  it('drops at 1.5% and the buff numbers stay modest', () => {
    expect(CIGARETTE_DROP_RATE).toBe(0.015);
    expect(CIGARETTE_BUFF_MS).toBe(180_000);
    expect(CIGARETTE_BUFF_MAX_MS).toBe(900_000);
    expect(CIGARETTE_BUFF_RATE).toBe(0.10);
    expect(CIGARETTE_DAILY_CAP).toBe(25_000);
  });
});

describe('cigarette bonus math', () => {
  it('pays 10% of a net win, floored, and nothing on a loss or push', () => {
    expect(cigaretteBonus(100, 0)).toBe(10);
    expect(cigaretteBonus(109, 0)).toBe(10);
    expect(cigaretteBonus(0, 0)).toBe(0);
    expect(cigaretteBonus(-80, 0)).toBe(0);
  });
  it('respects the daily cap', () => {
    expect(cigaretteBonus(1_000_000, 0)).toBe(CIGARETTE_DAILY_CAP);
    expect(cigaretteBonus(1000, 24_995)).toBe(5);
    expect(cigaretteBonus(1000, 25_000)).toBe(0);
  });
  it('extends duration by 3 minutes and caps remaining time at 15', () => {
    const now = 10_000_000;
    expect(extendCigaretteBuff(0, now) - now).toBe(CIGARETTE_BUFF_MS);
    expect(extendCigaretteBuff(now + 60_000, now) - now).toBe(60_000 + CIGARETTE_BUFF_MS);
    expect(extendCigaretteBuff(now + CIGARETTE_BUFF_MAX_MS, now) - now).toBe(CIGARETTE_BUFF_MAX_MS);
    let until = 0;
    for (let i = 0; i < 8; i++) until = extendCigaretteBuff(until, now);
    expect(until - now).toBe(CIGARETTE_BUFF_MAX_MS);
  });
});

describe('smoking and house-paid casino bonus', () => {
  beforeEach(async () => {
    await wired();
    resetCigarettesForTest();
  });

  it('grants a cigarette into the map warehouse on a successful drop roll, and not otherwise', async () => {
    const ls = await wired();
    expect(await grantFishingCigarette('Ada', 'lake', () => 0)).toBe(true);
    expect(ls.qty('Ada', WAREHOUSE, CIGARETTE_ITEM)).toBe(1);
    expect(await grantFishingCigarette('Ada', 'reef', () => 0.015)).toBe(false);
    expect(ls.qty('Ada', RESORT_WAREHOUSE, CIGARETTE_ITEM)).toBe(0);
    expect(await grantFishingCigarette('Ada', 'reef', () => 0.0149)).toBe(true);
    expect(ls.qty('Ada', RESORT_WAREHOUSE, CIGARETTE_ITEM)).toBe(1);
  });

  it('smokes one cigarette, extends the buff, and will not consume another at the 15-minute cap', async () => {
    let now = 5_000_000;
    const cig = new Cigarettes(null, () => now);
    setCigarettesForTest(cig);
    const ls = await wired();
    for (let i = 0; i < 6; i++) {
      const p = ls.adjust('Ada', [{ loc: WAREHOUSE, item: CIGARETTE_ITEM, delta: 1 }]);
      if (p) await p;
    }
    expect(cig.qty('Ada')).toBe(6);
    const first = await cig.smoke('Ada');
    expect(first.until).toBe(now + CIGARETTE_BUFF_MS);
    expect(cig.qty('Ada')).toBe(5);
    await cig.smoke('Ada');
    await cig.smoke('Ada');
    await cig.smoke('Ada');
    const fifth = await cig.smoke('Ada');
    expect(fifth.until).toBe(now + CIGARETTE_BUFF_MAX_MS);
    expect(cig.qty('Ada')).toBe(1);
    await expect(cig.smoke('Ada')).rejects.toThrow(/15-minute maximum/);
    expect(cig.qty('Ada')).toBe(1);
  });

  it('pays +10% of net winnings from the house while the buff is on, never on a loss, and stops at the daily cap', async () => {
    let now = 5_000_000;
    const cig = new Cigarettes(null, () => now);
    setCigarettesForTest(cig);
    const ls = await wired();
    const p = ls.adjust('Ada', [{ loc: WAREHOUSE, item: CIGARETTE_ITEM, delta: 1 }]);
    if (p) await p;
    await cig.smoke('Ada');
    const bank = new CasinoBank();
    expect(bank.account('Ada').chips).toBe(1000);

    bank.settle('Ada', 200, 100, 'hand', 'blackjack');
    expect(payCigaretteBonus('Ada', 100, 'blackjack', 'h1', bank)).toBe(10);
    expect(bank.account('Ada').chips).toBe(1210);

    bank.settle('Ada', 0, -50, 'hand', 'blackjack');
    expect(payCigaretteBonus('Ada', -50, 'blackjack', 'h2', bank)).toBe(0);
    expect(bank.account('Ada').chips).toBe(1210);

    // same ref is idempotent
    expect(payCigaretteBonus('Ada', 100, 'blackjack', 'h1', bank)).toBe(0);

    // Hold'em net pot win is also paid by the house, not taken from another player
    expect(payCigaretteBonus('Ada', 500, 'holdem', 'he1', bank)).toBe(50);
    expect(bank.account('Ada').chips).toBe(1260);
    expect(bank.account('Bo').chips).toBe(1000);

    // expire the buff
    now += CIGARETTE_BUFF_MS + 1;
    expect(payCigaretteBonus('Ada', 1000, 'slots', 's1', bank)).toBe(0);

    // new cigarette, then hit the daily cap
    const p2 = ls.adjust('Ada', [{ loc: WAREHOUSE, item: CIGARETTE_ITEM, delta: 1 }]);
    if (p2) await p2;
    await cig.smoke('Ada');
    expect(payCigaretteBonus('Ada', 1_000_000, 'roulette', 'r1', bank)).toBe(CIGARETTE_DAILY_CAP - 60);
    expect(payCigaretteBonus('Ada', 1000, 'roulette', 'r2', bank)).toBe(0);
    expect(bank.account('Ada').chips).toBe(1260 + (CIGARETTE_DAILY_CAP - 60));
  });

  it('does not apply the bonus to unknown games or a push', async () => {
    let now = 5_000_000;
    const cig = new Cigarettes(null, () => now);
    setCigarettesForTest(cig);
    const ls = await wired();
    const p = ls.adjust('Ada', [{ loc: WAREHOUSE, item: CIGARETTE_ITEM, delta: 1 }]);
    if (p) await p;
    await cig.smoke('Ada');
    const bank = new CasinoBank();
    expect(payCigaretteBonus('Ada', 100, 'chess', 'c1', bank)).toBe(0);
    expect(payCigaretteBonus('Ada', 0, 'blackjack', 'b0', bank)).toBe(0);
    expect(bank.account('Ada').chips).toBe(1000);
  });
});

describe('cigarette changelog', () => {
  it('credits Amber and describes the drop, buff, and cap', () => {
    const { entry } = changelogEntry(/Cigarettes at the casino \(requested by Amber\)/);
    expect(entry.bullets.join(' ')).toMatch(/1\.5%/);
    expect(entry.bullets.join(' ')).toMatch(/3 minutes/);
    expect(entry.bullets.join(' ')).toMatch(/10%/);
    expect(entry.bullets.join(' ')).toMatch(/25,000/);
    expect(entry.title).toMatch(/requested by Amber/);
  });
});
