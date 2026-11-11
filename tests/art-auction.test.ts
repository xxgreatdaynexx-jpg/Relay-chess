import { beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { PgCasinoStore, START_CHIPS, getBank, resetBank } from '../server/casino-store';
import { Homes, setHomes } from '../server/homes';
import { ArtAuction } from '../server/artAuction';
import { setPriceIndexForTest } from '../server/price-index';
import { ANTI_SNIPE_MS, ART_PIECES, openingBid } from '../shared/artAuction';
import { SINK_DEBIT_GAMES, sinkLoss } from '../shared/sinkRoom';
import { FURN_BY_ID, shopItem } from '../shared/homes';

const fund = (n: string, amt: number) => getBank().transferConfirmed(n, amt, { key: `test_fund:${n}:${Math.random()}`, game: 'admin' });

describe('Art auction', () => {
  beforeEach(() => { resetBank(); setPriceIndexForTest(1); setHomes(null); });

  it('auction pieces exist as placeable furniture but are not sold in the store, and bids are a sink', () => {
    expect(ART_PIECES.length).toBeGreaterThanOrEqual(6);
    for (const a of ART_PIECES) { expect(FURN_BY_ID.get(a.id)?.auction).toBe(true); expect(shopItem(a.id)).toBeNull(); }
    expect(SINK_DEBIT_GAMES.has('auction')).toBe(true);
    expect(sinkLoss([{ game: 'auction', amount: -80_000 }, { game: 'auction', amount: 40_000 }])).toBe(80_000);
  });

  it('escrows a bid, refunds the previous bidder, extends on a late bid, and grants the winner the art', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    getBank().retryMs = []; await getBank().attach(new PgCasinoStore(pool));
    const homes = new Homes(null); setHomes(homes);
    let now = Date.parse('2026-11-10T18:00:00Z');
    const a = new ArtAuction(pool, () => now); await a.init();
    const view = await a.view('QA-A');
    expect(view.lot).toBeTruthy();
    const lotId = view.lot!.id;
    const floor = view.lot!.floor;
    expect(floor).toBe(openingBid(view.lot!.item.estimate));
    await fund('QA-A', floor);
    const b1 = await a.bid('QA-A', lotId, floor);
    expect(b1.amount).toBe(floor);
    expect(getBank().account('QA-A').chips).toBe(START_CHIPS);
    await fund('QA-B', floor + 5_000);
    const b2 = await a.bid('QA-B', lotId, floor + 5_000);
    expect(b2.amount).toBe(floor + 5_000);
    expect(getBank().account('QA-A').chips).toBe(START_CHIPS + floor); // refunded
    expect(getBank().account('QA-B').chips).toBe(START_CHIPS);

    now = view.lot!.endsAt - 5_000;
    await fund('QA-A', floor + 10_000);
    const late = await a.bid('QA-A', lotId, floor + 10_000);
    expect(late.endsAt).toBe(now + ANTI_SNIPE_MS);

    now = late.endsAt;
    const settled = await a.settle(lotId);
    expect(settled).toMatchObject({ settled: true, winner: 'QA-A' });
    const inv = await homes.inventory('QA-A');
    expect(inv.get(view.lot!.item.id)).toBe(1);
    await expect(homes.buy('QA-A', view.lot!.item.id, 1)).rejects.toThrow(/not in the store/);
  });

  it('refuses a bid the wallet cannot cover', async () => {
    const a = new ArtAuction(null, () => Date.parse('2026-11-10T18:00:00Z')); await a.init();
    const v = await a.view('QA-Broke');
    const before = getBank().account('QA-Broke').chips;
    await expect(a.bid('QA-Broke', v.lot!.id, v.lot!.floor + 1_000_000)).rejects.toThrow(/Not enough chips/);
    expect(getBank().account('QA-Broke').chips).toBe(before);
  });
});
