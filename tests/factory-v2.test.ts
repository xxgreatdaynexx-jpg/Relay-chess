import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newDb } from 'pg-mem';
import { MinesWorld, PgMineStore, registerMines, resetMines } from '../server/mines';
import type { Server, Socket } from 'socket.io';
import { FactoryWorld, resetFactory } from '../server/factory';
import { getBank, resetBank } from '../server/casino-store';
import { GOODS, MAX_BANKED_STACK } from '../shared/mines';
import { FRECIPES, KINDS, advance, gridOf, newState, undergroundPairs, recipeIn, recipeOut, step, TICK_MS, MAX_CATCHUP_MS, type FState, type Storage } from '../shared/factory';

let w: MinesWorld; let f: FactoryWorld;
const rich = (n: string, chips: number) => getBank().transfer(n, chips - getBank().account(n).chips, { game: 'test' });
const bal = (n: string) => getBank().account(n).chips;
afterEach(() => { vi.useRealTimers(); });
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
    // the cleared old jobs were persisted with the factory row: nothing left to collect twice
    expect([...w2.factories.values()].every((x) => x.jobs.length === 0)).toBe(true);
    expect(() => w2.collect(A, 10_000_000)).toThrow(/Nothing finished/);
    expect(w2.storage(A).find((x) => x.id === 'gear')?.qty).toBe(1);
  });
});

function sock(name: string | null) {
  const h = new Map<string, (p: unknown, ack?: (r: any) => void) => void>();
  const socket = { id: 'sock-' + (name ?? 'guest'), data: { account: name ? { name } : undefined }, on: (ev: string, fn: any) => { h.set(ev, fn); }, emit() {}, join() {}, leave() {}, to: () => ({ emit() {} }) } as unknown as Socket;
  const io = { to: () => ({ emit() {} }), emit() {}, sockets: { sockets: new Map() } } as unknown as Server;
  registerMines(io, socket);
  return (ev: string, p: unknown = {}) => new Promise<any>((res) => h.get(ev)!(p, res));
}

describe('factory v2 stage 2', () => {
  it('old factory endpoints are retired (410) and migrate instead of starting jobs', async () => {
    const A = 'QA-Stale'; rich(A, 1000); w.upgradeFactory(A, 0);
    w.packOf(A).set('bar:iron_bar', { type: 'bar', id: 'iron_bar', qty: 8 });
    w.startJob(A, 'gear', 1, 0); // pre-migration job
    const emit = sock(A);
    for (const ev of ['mines_craft', 'mines_collect', 'mines_factory_upgrade']) {
      const r = await emit(ev, { recipe: 'gear', qty: 1 });
      expect(r.ok, ev).toBe(false); expect(r.gone).toBe(true); expect(r.status).toBe(410);
    }
    // the old job was paid out exactly once by migration, no new job started, bars untouched by the stale craft
    expect(w.storage(A).find((x) => x.id === 'gear')?.qty).toBe(1);
    expect([...w.factories.values()].every((x) => x.jobs.length === 0)).toBe(true);
    expect(w.storage(A).find((x) => x.id === 'iron_bar')?.qty).toBe(6);
    expect(f.get(A, Date.now())).not.toBeNull();
  });
  it('underground belts tunnel past obstacles and pair within range', () => {
    const s = newState(3, 0); let id = 0; const e = (k: any, x: number, y: number, d: any, extra: object = {}) => s.ents.push({ id: ++id, k, x, y, d, ...extra });
    e('chest_in', 0, 0, 0, { f: 'ore:iron' }); e('underground', 1, 0, 0);
    e('belt', 2, 0, 1); e('belt', 3, 0, 1); // a crossing line between the pair (runs down, empty)
    e('underground', 4, 0, 0); e('chest_out', 5, 0, 0);
    e('underground', 1, 5, 0); e('underground', 9, 5, 0); // 8 apart: too far, unpaired
    s.seq = id; const st = mem({ 'ore:iron': 5 });
    const pairs = undergroundPairs(s, gridOf(s));
    expect(pairs.get(2)?.id).toBe(5); expect(pairs.has(7)).toBe(false);
    advance(s, st, 60_000);
    const inFlight = s.ents.filter((x) => x.it === 'ore:iron').length;
    expect(st.m['ore:iron'] + inFlight).toBe(5); // conserved: chest_in -> tunnel -> chest_out loop
    expect(s.stored['ore:iron']).toBeGreaterThan(50); // it really flows through the tunnel
    expect(s.ents.filter((x) => x.k === 'belt').every((x) => !x.it)).toBe(true); // nothing leaked onto the crossing belts
  });
  it('inserter filters only move the chosen item', () => {
    const s = newState(3, 0); let id = 0; const e = (k: any, x: number, y: number, d: any, extra: object = {}) => s.ents.push({ id: ++id, k, x, y, d, ...extra });
    e('chest_in', 0, 0, 0, { f: 'ore:iron' }); e('chest_in', 0, 1, 0, { f: 'ore:coal' });
    e('belt', 1, 0, 1); e('belt', 1, 1, 0); e('belt', 2, 1, 0); e('belt', 3, 1, 0); e('chest_out', 4, 1, 0); // mixed main line
    e('inserter', 2, 2, 1, { f: 'ore:coal' }); e('belt', 2, 3, 0); e('belt', 3, 3, 0); // side line: coal only, dead end
    s.seq = id; const st = mem({ 'ore:iron': 50, 'ore:coal': 50 });
    advance(s, st, 120_000);
    const side = s.ents.filter((x) => x.y === 3).map((x) => x.it);
    expect(side).toContain('ore:coal'); expect(side).not.toContain('ore:iron');
    expect(s.ents.find((x) => x.k === 'inserter')!.it ?? 'ore:coal').toBe('ore:coal');
    expect(s.stored['ore:iron']).toBeGreaterThan(10); // iron passes by on the main line
  });
  it('output chests back up at the banked-stack cap instead of overflowing', () => {
    const s = chain(); const st = mem({ 'ore:iron': 30, 'ore:coal': 10, 'good:iron_plate': MAX_BANKED_STACK - 2 });
    advance(s, st, 600_000);
    expect(st.m['good:iron_plate']).toBe(MAX_BANKED_STACK);
    expect(s.ents.some((x) => x.it === 'good:iron_plate' || (x.ob ?? 0) > 0)).toBe(true);
  });
  it('background sweep and storage access catch the sim up; 8h window counts from last owner activity', () => {
    vi.useFakeTimers(); const t0 = 1_800_000_000_000; vi.setSystemTime(t0);
    const A = 'QA-Sweep'; rich(A, 100_000);
    f.expand(A, t0); const s = f.get(A, t0)!;
    w.packOf(A).set('ore:iron', { type: 'ore', id: 'iron', qty: 20 });
    w.packOf(A).set('ore:coal', { type: 'ore', id: 'coal', qty: 10 });
    s.ents = chain().ents.map((e) => ({ ...e })); s.seq = 20; s.kit = {}; s.at = t0; s.seen = t0;
    // market-style access (stackQty) by someone else's purchase path catches up without the owner opening anything
    vi.setSystemTime(t0 + 300_000);
    expect(w.stackQty(A, 'good', 'iron_plate')).toBeGreaterThan(0); // a buyer's stackQty check catches the seller up
    expect(s.seen).toBe(t0 + 300_000);
    vi.setSystemTime(t0); s.seen = t0;
    f.sweep(t0 + 300_000);
    expect(w.storage(A).find((x) => x.id === 'iron_plate')?.qty ?? 0).toBeGreaterThan(0);
    expect(s.seen).toBe(t0); // the sweep does not count as owner activity
    const plates = w.storage(A).find((x) => x.id === 'iron_plate')?.qty ?? 0;
    w.packOf(A).set('ore:iron', { type: 'ore', id: 'iron', qty: 100_000 }); w.packOf(A).set('ore:coal', { type: 'ore', id: 'coal', qty: 100_000 });
    f.sweep(t0 + MAX_CATCHUP_MS * 3);
    const p2 = w.storage(A).find((x) => x.id === 'iron_plate')?.qty ?? 0;
    expect(p2).toBeGreaterThan(plates);
    f.sweep(t0 + MAX_CATCHUP_MS * 5); // still idle: nothing more past the 8h window
    expect(w.storage(A).find((x) => x.id === 'iron_plate')?.qty ?? 0).toBe(p2);
    vi.useRealTimers();
  });
});
