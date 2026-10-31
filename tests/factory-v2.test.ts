import { beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { MinesWorld, PgMineStore, resetMines } from '../server/mines';
import { FactoryWorld, resetFactory } from '../server/factory';
import { getBank, resetBank } from '../server/casino-store';
import { GOODS } from '../shared/mines';
import { FRECIPES, KINDS, advance, gridOf, newState, recipeIn, recipeOut, step, TICK_MS, MAX_CATCHUP_MS, type FState, type Storage } from '../shared/factory';

let w: MinesWorld; let f: FactoryWorld;
const rich = (n: string, chips: number) => getBank().transfer(n, chips - getBank().account(n).chips, { game: 'test' });
const bal = (n: string) => getBank().account(n).chips;
beforeEach(() => { resetBank(); w = resetMines(); f = resetFactory(); });

const mem = (init: Record<string, number>): Storage & { m: Record<string, number> } => { const m = { ...init }; return { m, get: (k) => m[k] ?? 0, add: (k, d) => { m[k] = (m[k] ?? 0) + d; } }; };
/** chest_in(iron) -> belt -> smelter -> belt -> press -> belt -> chest_out */
function chain(): FState {
  const s = newState(3, 0);
  let id = 0; const e = (k: any, x: number, y: number, d: any, extra: object = {}) => s.ents.push({ id: ++id, k, x, y, d, ...extra });
  e('chest_in', 0, 0, 0, { f: 'ore:iron' }); e('chest_in', 0, 1, 0, { f: 'ore:coal' });
  e('belt', 1, 0, 0); e('belt', 1, 1, 0);
  e('smelter', 2, 0, 0, { r: 's_iron' });
  e('belt', 4, 0, 0); e('belt', 5, 0, 0);
  e('press', 6, 0, 0, { r: 'p_iron_plate' });
  e('belt', 8, 0, 0); e('chest_out', 9, 0, 0);
  s.seq = id; return s;
}

describe('factory v2 sim', () => {
  it('every recipe adds value, outputs are registered goods', () => {
    for (const r of FRECIPES) {
      expect(recipeOut(r), r.id).toBeGreaterThan(recipeIn(r));
      expect(recipeOut(r) / recipeIn(r), r.id).toBeLessThan(2.6);
      const [t, id] = r.out[0].split(':'); expect(GOODS[id]?.type, r.id).toBe(t);
      expect(KINDS[r.machine].machine).toBe(true);
    }
  });
  it('ore -> smelter -> press -> plates arrive in storage, conserving inputs', () => {
    const s = chain(); const st = mem({ 'ore:iron': 30, 'ore:coal': 10 });
    advance(s, st, 600_000);
    expect(st.m['good:iron_plate']).toBe(10);
    expect(st.m['ore:iron']).toBe(0); expect(st.m['ore:coal']).toBe(0);
    expect(s.made['bar:iron_bar']).toBe(10);
  });
  it('is deterministic and goes quiescent', () => {
    const a = chain(), b = chain(); const sa = mem({ 'ore:iron': 9, 'ore:coal': 3 }), sb = mem({ 'ore:iron': 9, 'ore:coal': 3 });
    for (let i = 0; i < 200; i++) { step(a, gridOf(a), sa); step(b, gridOf(b), sb); }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(step(a, gridOf(a), sa)).toBe(false);
  });
  it('caps offline catch-up', () => {
    const s = chain(); const st = mem({ 'ore:iron': 1e6, 'ore:coal': 1e6 });
    const t0 = performance.now();
    const ran = advance(s, st, 30 * 3600_000);
    expect(ran).toBeLessThanOrEqual(MAX_CATCHUP_MS / TICK_MS);
    expect(s.at).toBe(30 * 3600_000);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(st.m['good:iron_plate']).toBeGreaterThan(1000);
  });
});

describe('factory v2 server', () => {
  it('build, buy, place, run, pick up; chips through the bank', () => {
    const A = 'QA-Fab'; rich(A, 5000);
    expect(() => f.buy(A, 'belt', 1, 0)).toThrow(/Build/);
    f.expand(A, 0); expect(bal(A)).toBe(4750);
    expect(() => f.buy(A, 'assembler', 1, 0)).toThrow(/unlocks/);
    f.buy(A, 'press', 1, 0); expect(bal(A)).toBe(4350);
    expect(() => f.place(A, [{ k: 'smelter', x: 11, y: 0, d: 0 }], 0)).toThrow(/outside/);
    const p = w.packOf(A); p.set('ore:iron', { type: 'ore', id: 'iron', qty: 6 }); p.set('ore:coal', { type: 'ore', id: 'coal', qty: 2 });
    f.place(A, [{ k: 'chest_in', x: 0, y: 0, d: 0, f: 'ore:iron' }, { k: 'chest_in', x: 0, y: 1, d: 0, f: 'ore:coal' }, { k: 'belt', x: 1, y: 0, d: 0 }, { k: 'belt', x: 1, y: 1, d: 0 }, { k: 'smelter', x: 2, y: 0, d: 0, r: 's_iron' }, { k: 'belt', x: 4, y: 0, d: 0 }, { k: 'chest_out', x: 5, y: 0, d: 0 }], 0);
    expect(() => f.place(A, [{ k: 'belt', x: 1, y: 0, d: 0 }], 0)).toThrow(/already/);
    f.get(A, 120_000);
    expect(w.storage(A).find((s) => s.id === 'iron_bar')?.qty).toBe(2);
    const sm = f.get(A, 120_000)!.ents.find((e) => e.k === 'smelter')!;
    f.remove(A, [sm.id], 120_000); expect(f.get(A, 120_000)!.kit.smelter).toBe(1);
  });
  it('migrates old jobs and survives a restart', async () => {
    const db = newDb({ noAstCoverageCheck: true }); const { Pool } = db.adapters.createPg(); const pool = new Pool();
    await w.attach(new PgMineStore(pool));
    const A = 'QA-Mig'; rich(A, 300); w.upgradeFactory(A, 0);
    w.packOf(A).set('bar:iron_bar', { type: 'bar', id: 'iron_bar', qty: 4 });
    w.startJob(A, 'gear', 1, 0);
    const s = f.get(A, 1000)!;
    expect(w.storage(A).find((x) => x.id === 'gear')?.qty).toBe(1);
    expect(w.factories.get('qa-mig')?.jobs.length ?? w.factories.values().next().value!.jobs.length).toBe(0);
    expect(s.kit.press).toBe(1);
    f.place(A, [{ k: 'belt', x: 3, y: 3, d: 1 }], 1000);
    await f.flush(); await w.flush();
    const w2 = resetMines(); await w2.attach(new PgMineStore(pool)); const f2 = resetFactory();
    const s2 = f2.get(A, 2000)!;
    expect(s2.ents.some((e) => e.k === 'belt' && e.x === 3)).toBe(true);
    expect(w2.storage(A).find((x) => x.id === 'gear')?.qty).toBe(1);
  });
});
