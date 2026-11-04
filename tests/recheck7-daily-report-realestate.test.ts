import { beforeEach, describe, expect, it, vi } from 'vitest';
// recheck #7: the Daily Report's real-estate line uses what the player actually paid (as the Real estate panel shows),
// while net-worth totals / wealth tax keep the Bank's list-price valuation.
vi.mock('../server/realEstate.js', () => ({ getRealEstate: () => ({ mine: async () => [{ id: 'a', value: 500_000, paid: 950_000 }, { id: 'b', value: 253_500, paid: 253_500 }, { id: 'c', value: 0, paid: 0 }] }) }));
import { resetBank } from '../server/casino-store';
import { Economy, setEconomyForTest, type EconSource } from '../server/economy';
import { MemorySnapshots, buildDailyReport, setSnapshotStore } from '../server/daily-report';
const T0 = Date.parse('2026-11-01T12:00:00Z');
function src(): EconSource {
  const empty = { skins: [], stacks: [], machines: [] };
  return { cash: async () => 50_000, holdings: async () => empty, holdingsOf: async () => ({ ...empty }), sales: async () => [], flows: async () => [], cashAt: async () => 40_000,
    firstLedgerAt: async () => null, days: async () => [], saveDay: async () => {} };
}
describe('recheck #7 daily report real estate = price paid', () => {
  let econ: Economy;
  beforeEach(() => { resetBank(); setSnapshotStore(new MemorySnapshots()); econ = new Economy(src(), () => T0); setEconomyForTest(econ); });
  it('playerAssets: list price by default, paid price on request', async () => {
    const list = await econ.playerAssets('Qa Re', T0); const paid = await econ.playerAssets('Qa Re', T0, { property: 'paid' });
    expect(JSON.stringify(list)).toContain('753500'); expect(JSON.stringify(paid)).toContain('1203500');
  });
  it('the Daily Report shows the paid total (1,203,500), matching the Real estate panel', async () => {
    const r = JSON.stringify(await buildDailyReport('Qa Re', null, T0)); expect(r).toContain('1203500'); expect(r).not.toContain('753500');
  });
});
