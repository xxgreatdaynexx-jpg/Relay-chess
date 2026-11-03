import { beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { resetMines, type MinesWorld } from '../server/mines';
import { factoryViewRouter, publicFactoryView, resetFactory, type FactoryWorld } from '../server/factory';
import { getBank, resetBank } from '../server/casino-store';

let w: MinesWorld; let f: FactoryWorld;
const rich = (n: string, chips: number) => getBank().transfer(n, chips - getBank().account(n).chips, { game: 'test' });
beforeEach(() => { resetBank(); w = resetMines(); f = resetFactory(); });

function build(A: string) {
  rich(A, 5000); f.expand(A, 0); f.buy(A, 'smelter', 1, 0); f.buy(A, 'belt', 3, 0);
  const p = w.packOf(A); p.set('ore:iron', { type: 'ore', id: 'iron', qty: 6 }); p.set('ore:coal', { type: 'ore', id: 'coal', qty: 2 });
  f.place(A, [{ k: 'chest_in', x: 0, y: 0, d: 0, f: 'ore:iron' }, { k: 'chest_in', x: 0, y: 1, d: 0, f: 'ore:coal' }, { k: 'belt', x: 1, y: 0, d: 0 }, { k: 'belt', x: 1, y: 1, d: 0 }, { k: 'smelter', x: 2, y: 0, d: 0, r: 's_iron' }, { k: 'belt', x: 4, y: 0, d: 0 }, { k: 'chest_out', x: 5, y: 0, d: 0 }], 0);
}

describe('read-only factory view', () => {
  it('shows layout + recipes but no storage, kit, stored totals or chips', () => {
    const A = 'QA-Viewed'; build(A);
    const v = publicFactoryView(A, 1000)!;
    expect(v.state.ents.find((e) => e.k === 'smelter')?.r).toBe('s_iron');
    expect(v.state.ents.filter((e) => e.k === 'chest_in')).toHaveLength(2);
    expect(v.state.kit).toEqual({}); expect(v.state.stored).toEqual({}); expect(v.state.seen).toBeUndefined();
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/chips|storage|wallet/i);
    expect(v.machines).toBe(1);
  });
  it('viewing does not refresh the owner clock or change the layout, and mutating the view does nothing', () => {
    const A = 'QA-Viewed2'; build(A);
    const before = f.get(A, 0)!; const seen = before.seen; const ents = JSON.stringify(before.ents);
    const v = publicFactoryView(A, 500)!;
    v.state.ents.length = 0; v.state.ents.push({ id: 99, k: 'belt', x: 9, y: 9, d: 0 });
    const after = f.get(A, 500, false)!;
    expect(after.seen).toBe(seen); expect(after.ents.length).toBe(JSON.parse(ents).length);
  });
  it('no factory -> null; HTTP is GET-only', async () => {
    expect(publicFactoryView('QA-Nobody', 0)).toBeNull();
    build('QA-Http');
    const app = express(); app.use(factoryViewRouter());
    const srv = app.listen(0); const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      const g = await fetch(`${base}/api/factory/view/QA-Http`); expect(g.status).toBe(200); const j = await g.json(); expect(j.ok).toBe(true); expect(j.state.ents.length).toBeGreaterThan(0);
      const p = await fetch(`${base}/api/factory/view/QA-Http`, { method: 'POST' }); expect(p.status).toBe(405);
      const n = await fetch(`${base}/api/factory/view/QA-Nobody`); expect(n.status).toBe(404);
    } finally { srv.close(); }
  });
});
