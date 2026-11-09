/**
 * Cooking (rules in shared/cooking.ts). A kitchen in any home you own: a city/resort property, a farmhouse (farm plot)
 * or your Trailer Park trailer. Server-authoritative:
 *  - Groceries are bought at the Grocery Store (px-indexed): chips (ledger game 'grocery', client nonce = dedupe key)
 *    and the pantry stack commit in ONE transaction (Mines' generic stack table, type 'food', also the Market hook).
 *  - cook_start consumes every ingredient atomically: the pantry stacks, the cheapest matching fish from the cooler
 *    (claimed with a NOT NULL guard row so a fish sold/used elsewhere aborts the whole transaction) and the cook row.
 *  - cook_finish replays the four press times against the seed, rolls the burn chance from the Cooking level and
 *    stores the dish (exactly once: UPDATE ... WHERE NOT done). Wall time must cover the presses (no speed-ups).
 *  - Selling dishes credits chips through the atomic wallet (ledger 'cook_sell') with the daily tier, like fishing.
 */
import { emitHaul } from './haulVisual.js';
import { randomInt, randomUUID } from 'node:crypto';
import { parseSellQty, pickForQty } from '../shared/sellQty.js';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { getBank, type CasinoBank } from './casino-store.js';
import { px, priceIndex } from './price-index.js';
import { awayFromMarket } from './travel.js';
import { awardXp, getSkills } from './skills.js';
import { getMines } from './mines.js';
import { isOutcomeUnknown, getLocStore, LOC_MIGRATION } from './locstock.js';
import { getLocMoves } from './locmoves.js';
import { kitchenLoc, WAREHOUSE, FACTORY, isPool } from '../shared/inventoryLocations.js';
import { getFishing } from './fishing.js';
import { databaseUrl } from './leaderboard-store.js';
import { fishById } from '../shared/fishing.js';
import {
  COOK_EXPIRE_MS, DISHES_MAX, FISH_ING, PANTRY_MAX, RECIPES, STAPLES, burnChance, cookPayout, cookSellValue, cookSteps, cookXp, dishValue, foodInfo,
  filletsFrom, isFishIng, judgeCook, recipeById, stapleById, type Dish, type FishIng, type KitchenView,
} from '../shared/cooking.js';

export const COOK_MIGRATION = `
CREATE TABLE IF NOT EXISTS kitchen_cooks (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, recipe TEXT NOT NULL, seed BIGINT NOT NULL, started_at BIGINT NOT NULL, done BOOLEAN NOT NULL DEFAULT false, quality REAL, burnt BOOLEAN);
CREATE INDEX IF NOT EXISTS kitchen_cooks_player ON kitchen_cooks (player_key, done);
CREATE TABLE IF NOT EXISTS kitchen_fish_used (fish_id TEXT PRIMARY KEY NOT NULL, cook_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS kitchen_fillets (player_key TEXT NOT NULL, kind TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0), PRIMARY KEY (player_key, kind));
ALTER TABLE kitchen_cooks ADD COLUMN IF NOT EXISTS fillet_kind TEXT;
ALTER TABLE kitchen_cooks ADD COLUMN IF NOT EXISTS fillets INTEGER;
CREATE TABLE IF NOT EXISTS kitchen_harvests (tile_key TEXT PRIMARY KEY NOT NULL, at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS kitchen_dishes (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, name TEXT NOT NULL, recipe TEXT NOT NULL, quality REAL NOT NULL, value INTEGER NOT NULL, cooked_at BIGINT NOT NULL, sold_at BIGINT);
CREATE INDEX IF NOT EXISTS kitchen_dishes_player ON kitchen_dishes (player_key, sold_at);
CREATE TABLE IF NOT EXISTS kitchen_daily (player_key TEXT NOT NULL, day TEXT NOT NULL, gross BIGINT NOT NULL DEFAULT 0, paid BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (player_key, day));
ALTER TABLE kitchen_dishes ADD COLUMN IF NOT EXISTS loc TEXT;
ALTER TABLE kitchen_cooks ADD COLUMN IF NOT EXISTS home TEXT;
`;
export class CookError extends Error {}
const keyOf = (n: string) => n.trim().toLowerCase();
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
type Stmt = { sql: string; args: unknown[] };

export class Cooking {
  private locks = new Map<string, Promise<unknown>>();
  private lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve(); const p = prev.then(fn, fn); const tail = p.catch(() => {});
    this.locks.set(id, tail); void tail.then(() => { if (this.locks.get(id) === tail) this.locks.delete(id); }); return p;
  }
  constructor(readonly pool: pg.Pool, private readonly bank: () => CasinoBank = getBank, private readonly clock = () => Date.now(), private readonly devHome = false) {}
  async init() { await this.pool.query(COOK_MIGRATION); await this.pool.query(LOC_MIGRATION); }

  /**
   * Truck logistics: every kitchen (home) has its own pantry, fish and cutting board (loc_stock 'kitchen:<home>',
   * items 'food:<id>' incl. 'food:fillet_<kind>'). Deltas + extra rows commit in ONE transaction.
   */
  /** Kitchen stock (loc_stock kitchen:<home>) + `extra` rows (wallet, fish, cooks) in ONE transaction on our pool. Memory is
   *  checked and applied first (no oversell), DB rows are guarded (never negative); a failed commit reverts memory and chips. */
  private async kitchenTx(name: string, home: string, deltas: Array<{ id: string; delta: number }>, extra: Stmt[], chips?: { after: Promise<unknown>; bind: (p: Promise<unknown>) => void; revert: () => void }) {
    const ls = getLocStore(); if (!ls.loaded) { chips?.revert(); throw new CookError('Storage is reconnecting. Your goods are safe, try again in a minute.'); }
    const loc = kitchenLoc(home); const d = deltas.filter((x) => x.delta).map((x) => ({ loc, item: `food:${x.id}`, delta: x.delta }));
    if (!ls.check(name, d)) { chips?.revert(); throw new CookError("You don't have all the ingredients in this kitchen."); }
    // Map pools: the city pantry is the one city store (banked food stacks); LocStore routes it and commits `extra` with it.
    let r: Promise<void> | false;
    try { r = ls.adjust(name, d, extra, { after: chips?.after, pool: this.pool }); } catch (e) { chips?.revert(); throw new CookError((e as Error).message || 'Storage is reconnecting. Your goods are safe, try again in a minute.'); }
    if (r === false) { chips?.revert(); throw new CookError("You don't have all the ingredients in this kitchen."); }
    chips?.bind(r);
    try { await r; } catch (e) { if (!isOutcomeUnknown(e)) chips?.revert(); console.error('[cooking] tx failed:', (e as Error).message); throw new CookError(isOutcomeUnknown(e) ? 'Storage hiccup: confirming that one. Nothing will be lost or doubled.' : 'That did not go through. Nothing was used or charged.'); }
  }
  /** Which of your homes this kitchen is: the requested one (must be yours), else your first home. */
  async homeOf(name: string, want?: unknown): Promise<string> {
    const homes = this.devHome ? new Map([['dev', false]]) : await getLocMoves().homes(name, this.pool);
    if (typeof want === 'string' && want) { if (!homes.has(want)) throw new CookError('That kitchen is not in a home you own.'); return want; }
    const first = [...homes.keys()].sort()[0]; if (!first) throw new CookError('You need a home with a kitchen: buy a property or a farm plot, or get a Trailer Park trailer.'); return first;
  }
  /** Rows that go with a pack change: in Mines' transaction when it has a store, else (dev) in ours. */
  private async packTx(name: string, deltas: Array<{ id: string; delta: number }>, extra: Stmt[], chips?: { after: Promise<unknown>; bind: (p: Promise<unknown>) => void; revert: () => void }) {
    const mines = getMines(); let failed: Error | null = null; let done: Promise<unknown> = Promise.resolve(); let rows: Stmt[] | null = null;
    let ok: boolean;
    try {
      ok = mines.adjustStacks(name, deltas.map((d) => ({ type: 'food' as const, id: d.id, delta: d.delta })), extra, (r) => { rows = r; },
        { after: chips?.after, bind: (p) => { done = p; chips?.bind(p); }, onFail: (e) => { failed = e; chips?.revert(); } });
    } catch (e) { chips?.revert(); throw new CookError((e as Error).message || 'Storage is offline right now.'); }
    if (!ok) { chips?.revert(); throw new CookError("You don't have all the ingredients."); }
    if (rows) { // no Mines store (local dev): run the rows ourselves; undo the pack on failure
      const cl = await this.pool.connect();
      try { await chips?.after; await cl.query('BEGIN'); for (const s of rows as Stmt[]) await cl.query(s.sql, s.args); await cl.query('COMMIT'); chips?.bind(Promise.resolve()); }
      catch (e) { await cl.query('ROLLBACK').catch(() => {}); mines.adjustStacks(name, deltas.map((d) => ({ type: 'food' as const, id: d.id, delta: -d.delta }))); chips?.revert(); failed = e as Error; }
      finally { cl.release(); }
    } else await done;
    if (failed) { console.error('[cooking] tx failed:', (failed as Error).message); throw new CookError('That did not go through. Nothing was used or charged.'); }
  }

  async hasHome(name: string): Promise<boolean> {
    if (this.devHome) return true; const key = keyOf(name);
    try { if ((await this.pool.query('SELECT 1 FROM properties WHERE owner_key = $1 LIMIT 1', [key])).rows.length) return true; } catch { /* no table */ }
    try { if ((await this.pool.query('SELECT 1 FROM trailer_lots WHERE player_key = $1 LIMIT 1', [key])).rows.length) return true; } catch { /* no table */ }
    return false;
  }
  private async level(name: string): Promise<{ level: number; xp: number }> {
    try { const p = await getSkills().profile(name); const s = p.skills.find((x) => x.id === 'cooking'); return { level: s?.level ?? 1, xp: s?.xp ?? 0 }; } catch { return { level: 1, xp: 0 }; }
  }
  private pantry(name: string, home: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const x of getLocStore().at(name, kitchenLoc(home))) if (x.item.startsWith('food:') && !x.item.startsWith('food:fillet_')) out[x.item.slice(5)] = x.qty;
    return out;
  }
  private async fishRows(key: string, home: string) {
    const r = await this.pool.query('SELECT id, species, value FROM fish_catches WHERE player_key = $1 AND loc = $2 AND sold_at IS NULL AND dish IS NULL ORDER BY value ASC, caught_at ASC', [key, kitchenLoc(home)]).catch(() => ({ rows: [] }));
    return (r.rows as Array<{ id: string; species: string; value: number }>).map((x) => ({ id: String(x.id), rarity: fishById(x.species)?.rarity ?? 'junk', value: Number(x.value) }));
  }
  /** Fillets already cut and waiting on the cutting board (pt1299u). */
  private fillets(name: string, home: string): { fish: number; fish_fine: number } {
    const ls = getLocStore(); const loc = kitchenLoc(home);
    return { fish: ls.qty(name, loc, 'food:fillet_fish'), fish_fine: ls.qty(name, loc, 'food:fillet_fish_fine') };
  }
  private async dishes(key: string, loc?: string): Promise<Dish[]> {
    const r = await this.pool.query(`SELECT id, recipe, quality, value, cooked_at, loc FROM kitchen_dishes WHERE player_key = $1 AND sold_at IS NULL ${loc ? 'AND loc = $2' : ''} ORDER BY cooked_at DESC`, loc ? [key, loc] : [key]);
    return r.rows.map((x) => ({ id: String(x.id), recipe: String(x.recipe), quality: Number(x.quality), value: Number(x.value), at: Number(x.cooked_at), loc: x.loc == null ? null : String(x.loc) }));
  }
  private async today(key: string) {
    const r = await this.pool.query('SELECT gross, paid FROM kitchen_daily WHERE player_key = $1 AND day = $2', [key, utcDay(this.clock())]);
    return { gross: Number(r.rows[0]?.gross ?? 0), paid: Number(r.rows[0]?.paid ?? 0) };
  }
  /** Walked away mid-cook: a cook left on the stove past COOK_EXPIRE_MS is refunded (pantry items + fish back), never burnt.
   *  The marker row (NOT NULL guard) makes the refund happen at most once and never after a plate. */
  async refundStale(name: string): Promise<number> {
    const key = keyOf(name); const now = this.clock();
    const stale = (await this.pool.query('SELECT id, recipe, fillet_kind, fillets, home FROM kitchen_cooks WHERE player_key = $1 AND done = false AND started_at <= $2', [key, now - COOK_EXPIRE_MS])).rows as Array<{ id: string; recipe: string; fillet_kind: string | null; fillets: number | null; home: string | null }>;
    let n = 0;
    for (const c of stale) {
      const r = recipeById(c.recipe);
      const deltas = r ? Object.entries(r.ings).filter(([i]) => !isFishIng(i)).map(([id, q]) => ({ id, delta: q })) : [];
      const fishIds = ((await this.pool.query('SELECT fish_id FROM kitchen_fish_used WHERE cook_id = $1', [c.id])).rows as Array<{ fish_id: string }>).map((x) => x.fish_id).filter((f) => !f.startsWith('refund:') && !c.fillet_kind); // new cooks: the fish was cut, refund the fillets instead
      const extra: Stmt[] = [
        { sql: "INSERT INTO kitchen_fish_used (fish_id, cook_id) VALUES ((SELECT 'refund:' || id FROM kitchen_cooks WHERE id = $1 AND player_key = $2 AND done = false), $1)", args: [c.id, key] },
        ...fishIds.flatMap((f) => [
          { sql: 'DELETE FROM kitchen_fish_used WHERE fish_id = $1 AND cook_id = $2', args: [f, c.id] },
          { sql: 'UPDATE fish_catches SET sold_at = NULL WHERE id = $1 AND player_key = $2', args: [f.replace(/^\((.*)\)$/, '$1'), key] } // pg-mem stores the scalar subquery as '(id)',
        ]),
        { sql: 'UPDATE kitchen_cooks SET done = true, quality = NULL, burnt = NULL WHERE id = $1', args: [c.id] },
      ];
      // Refund to the kitchen the cook used (fillets back on its board); legacy cooks refund to the factory store as before.
      // Legacy cooks (started before the cutover) refund into the factory store, never the retired shared fillet board.
      if (c.fillet_kind && Number(c.fillets) > 0) deltas.push({ id: `fillet_${c.fillet_kind}`, delta: Number(c.fillets) });
      try { if (c.home) await this.kitchenTx(name, c.home, deltas, extra); else await this.packTx(name, deltas, extra); n++; } catch (e) { console.error('[cooking] refund failed:', (e as Error).message); }
    }
    return n;
  }

  async view(name: string, want?: unknown): Promise<KitchenView> {
    const key = keyOf(name);
    await this.lock(`c:${key}`, () => this.refundStale(name)).catch(() => 0);
    let home = ''; try { home = await this.homeOf(name, want); } catch { home = ''; }
    const homes = this.devHome ? ['dev'] : [...(await getLocMoves().homes(name, this.pool).catch(() => new Map())).keys()].sort();
    const fish = home ? await this.fishRows(key, home) : []; const lv = await this.level(name);
    const fine = (FISH_ING.fish_fine.rarities as readonly string[]); const board = home ? this.fillets(name, home) : { fish: 0, fish_fine: 0 };
    const cut = (ing: FishIng) => fish.filter((f) => (FISH_ING[ing].rarities as readonly string[]).includes(f.rarity)).reduce((a, f) => a + filletsFrom(ing, f.value), 0);
    void fine;
    return {
      pantry: home ? this.pantry(name, home) : {}, fish: { fish: board.fish + cut('fish'), fish_fine: board.fish_fine + cut('fish_fine') }, fillets: board,
      dishes: await this.dishes(key), today: await this.today(key), index: priceIndex(), level: lv.level, xp: lv.xp, hasHome: await this.hasHome(name),
      home: home || null, homes, loc: home ? kitchenLoc(home) : null,
    };
  }

  /** Grocery Store: buy qty of a grocery at px(base) each. `nonce` makes a double-click a no-op (same ledger key). */
  async buy(name: string, item: unknown, qty: unknown, nonce: unknown, want?: unknown) {
    const s = stapleById(item); if (!s) throw new CookError('The store does not sell that.');
    const n = Number(qty); if (!Number.isInteger(n) || n < 1 || n > 50) throw new CookError('Buy 1 to 50 at a time.');
    if (typeof nonce !== 'string' || !/^[\w-]{8,64}$/.test(nonce)) throw new CookError('Bad request.');
    const key = keyOf(name);
    return this.lock(`c:${key}`, async () => {
      const home = await this.homeOf(name, want); // groceries are delivered to the kitchen you're shopping for
      if ((this.pantry(name, home)[s.id] ?? 0) + n > PANTRY_MAX) throw new CookError(`Your pantry holds at most ${PANTRY_MAX} ${s.label}.`);
      const unit = px(s.base); const cost = unit * n;
      let w;
      try { w = this.bank().transferAtomic([{ name, amount: -cost, key: `grocery:${key}:${nonce}`, game: 'grocery', memo: `Grocery Store: ${n} ${s.label}` }]); }
      catch (e) { const m = (e as Error).message; throw new CookError(m === 'Already applied.' ? 'Already bought.' : m); }
      await this.kitchenTx(name, home, [{ id: s.id, delta: n }], w.stmts, w);
      try { emitHaul({ name, from: 'grocery', to: 'warehouse', kind: 'grocery' }); } catch { /* visual */ }
      return { bought: n, item: s.id, cost, chips: this.bank().account(name).chips, pantry: this.pantry(name, home), home };
    });
  }

  async start(name: string, recipeId: unknown, want?: unknown) {
    const r = recipeById(recipeId); if (!r) throw new CookError('Unknown recipe.');
    const key = keyOf(name);
    return this.lock(`c:${key}`, async () => {
      if (!(await this.hasHome(name))) throw new CookError('You need a home with a kitchen: buy a property or a farm plot, or get a Trailer Park trailer.');
      const home = await this.homeOf(name, want); const loc = kitchenLoc(home);
      const { level } = await this.level(name); if (level < r.level) throw new CookError(`${r.label} needs Cooking level ${r.level}.`);
      await this.refundStale(name);
      const now = this.clock();
      const busy = await this.pool.query('SELECT id FROM kitchen_cooks WHERE player_key = $1 AND done = false AND started_at > $2 LIMIT 1', [key, now - COOK_EXPIRE_MS]);
      if (busy.rows.length) throw new CookError('Finish the dish on the stove first.');
      const nd = Number((await this.pool.query('SELECT count(*) AS n FROM kitchen_dishes WHERE player_key = $1 AND sold_at IS NULL', [key])).rows[0]?.n ?? 0);
      if (nd >= DISHES_MAX) throw new CookError(`Your fridge is full (${DISHES_MAX} dishes). Sell some first.`);
      const id = randomUUID(); const seed = randomInt(1, 2 ** 31);
      const extra: Stmt[] = []; const deltas: Array<{ id: string; delta: number }> = [];
      let pool = await this.fishRows(key, home); const board = this.fillets(name, home); let filletKind: FishIng | null = null, filletsUsed = 0;
      for (const [ing, q] of Object.entries(r.ings)) {
        if (isFishIng(ing)) {
          // pt1299u: use fillets on the cutting board first; cut the cheapest matching fish into fillets as needed.
          const ok = FISH_ING[ing].rarities as readonly string[]; let stock = board[ing], cutN = 0;
          while (stock + cutN < q) {
            const f = pool.find((x) => ok.includes(x.rarity)); if (!f) throw new CookError(`You need ${FISH_ING[ing].label.toLowerCase()} on this map. Ship resort fish here first if they are at the resort.`);
            pool = pool.filter((x) => x !== f); cutN += filletsFrom(ing, f.value);
            extra.push({ sql: 'INSERT INTO kitchen_fish_used (fish_id, cook_id) VALUES ((SELECT id FROM fish_catches WHERE id = $1 AND player_key = $2 AND sold_at IS NULL AND dish IS NULL AND loc = $4), $3)', args: [f.id, key, id, loc] });
            extra.push({ sql: 'UPDATE fish_catches SET sold_at = $2 WHERE id = $1', args: [f.id, now] });
          }
          stock = stock + cutN - q; board[ing] = stock; filletKind = ing; filletsUsed = q;
          if (cutN - q) deltas.push({ id: `fillet_${ing}`, delta: cutN - q }); // this kitchen's cutting board (guarded: never below 0)
        } else deltas.push({ id: ing, delta: -q });
      }
      const have = this.pantry(name, home); const miss = deltas.filter((d) => !d.id.startsWith('fillet_') && (have[d.id] ?? 0) < -d.delta).map((d) => foodInfo(d.id)?.label ?? d.id);
      if (miss.length) throw new CookError(`Missing: ${miss.join(', ')}.`);
      extra.push({ sql: 'INSERT INTO kitchen_cooks (id, player_key, recipe, seed, started_at, fillet_kind, fillets, home) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', args: [id, key, r.id, seed, now, filletKind, filletKind ? filletsUsed : null, home] });
      await this.kitchenTx(name, home, deltas, extra);
      return { cook: { id, recipe: r.id, seed, diff: r.diff, steps: cookSteps(seed, r.diff) }, pantry: this.pantry(name, home), home };
    });
  }

  async finish(name: string, cookId: unknown, presses: unknown) {
    if (typeof cookId !== 'string') throw new CookError('Nothing on the stove.');
    const key = keyOf(name);
    return this.lock(`c:${key}`, async () => {
      const row = (await this.pool.query('SELECT recipe, seed, started_at, home FROM kitchen_cooks WHERE id = $1 AND player_key = $2 AND done = false', [cookId, key])).rows[0];
      if (!row) throw new CookError('Nothing on the stove.');
      const r = recipeById(row.recipe)!; const now = this.clock(); const elapsed = now - Number(row.started_at);
      if (elapsed > COOK_EXPIRE_MS) { await this.refundStale(name); throw new CookError('You left it on the stove too long. Your ingredients went back to the pantry.'); }
      let q = judgeCook(Number(row.seed), r.diff, presses);
      const total = Array.isArray(presses) ? (presses as number[]).reduce((a, b) => a + (Number(b) || 0), 0) : 0;
      if (q === null || elapsed < total - 400) q = 0; // impossible / faster than real time
      const { level } = await this.level(name);
      const burnt = q === 0 || randomInt(0, 1_000_000) / 1_000_000 < burnChance(level, r, q);
      const dish: Dish | null = burnt ? null : { id: randomUUID(), recipe: r.id, quality: Math.round(q * 1000) / 1000, value: dishValue(r, q), at: now };
      const cl = await this.pool.connect();
      try {
        await cl.query('BEGIN');
        const u = await cl.query('UPDATE kitchen_cooks SET done = true, quality = $3, burnt = $4 WHERE id = $1 AND player_key = $2 AND done = false', [cookId, key, q, burnt]);
        if (u.rowCount !== 1) throw new CookError('Already plated.');
        if (dish) await cl.query('INSERT INTO kitchen_dishes (id, player_key, name, recipe, quality, value, cooked_at, loc) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [dish.id, key, name, r.id, dish.quality, dish.value, now, row.home ? kitchenLoc(String(row.home)) : FACTORY]); // plated in this kitchen (legacy cooks: factory, like all legacy stock)
        await cl.query('COMMIT');
      } catch (e) { await cl.query('ROLLBACK').catch(() => {}); if (e instanceof CookError) throw e; console.error('[cooking] finish failed:', (e as Error).message); throw new CookError('Something went wrong.'); }
      finally { cl.release(); }
      const xp = cookXp(r, q, burnt); awardXp(name, 'cooking', xp);
      return { burnt, quality: q, dish, xp };
    });
  }

  async sell(name: string, ids?: unknown, qtyIn?: unknown) {
    const key = keyOf(name);
    return this.lock(`c:${key}`, async () => {
      const any = await this.dishes(key); let rows = any.filter((d) => !!d.loc && isPool(d.loc)); // map pools: either map's warehouse sells
      if (Array.isArray(ids)) { const want = new Set(ids.filter((x): x is string => typeof x === 'string').slice(0, DISHES_MAX)); rows = rows.filter((r) => want.has(r.id)); }
      if (!rows.length) throw new CookError(any.length ? 'Move those dishes from your factory to a map warehouse to sell them.' : 'Nothing to sell.');
      if (qtyIn !== undefined && qtyIn !== null) { const v = parseSellQty(qtyIn, rows.length); if (!v.ok) throw new CookError(v.error); rows = pickForQty(rows, v.qty); }
      const day = utcDay(this.clock()); const t = await this.today(key);
      const gross = cookSellValue(rows.reduce((a, r) => a + r.value, 0)); // +50% cooking buff
      const paid = Math.floor(cookPayout(gross, t.gross) * priceIndex());
      if (paid <= 0) throw new CookError('The diner has bought all the dishes it can from you today. Come back after 00:00 UTC (6 PM CST).');
      const counts = new Map<string, number>(); for (const r of rows) { const l = recipeById(r.recipe)?.label ?? r.recipe; counts.set(l, (counts.get(l) ?? 0) + 1); }
      const memo = `Kitchen: sold ${[...counts].map(([l, n]) => `${n} ${l}`).join(', ')}`.slice(0, 200);
      const w = this.bank().transferAtomic([{ name, amount: paid, key: `cook_sell:${randomUUID()}`, game: 'cook_sell', memo }]);
      const run = async () => {
        await w.after; const cl = await this.pool.connect();
        try {
          await cl.query('BEGIN');
          const ph = rows.map((_, i) => `$${i + 3}`).join(',');
          const u = await cl.query(`UPDATE kitchen_dishes SET sold_at = $1 WHERE player_key = $2 AND sold_at IS NULL AND loc IN ('warehouse', 'resort') AND id IN (${ph})`, [this.clock(), key, ...rows.map((r) => r.id)]);
          if (u.rowCount !== rows.length) throw new CookError('Already sold.');
          await cl.query('INSERT INTO kitchen_daily (player_key, day, gross, paid) VALUES ($1,$2,0,0) ON CONFLICT (player_key, day) DO NOTHING', [key, day]);
          const d = await cl.query('UPDATE kitchen_daily SET gross = gross + $3, paid = paid + $4 WHERE player_key = $1 AND day = $2 AND gross = $5', [key, day, gross, paid, t.gross]);
          if (d.rowCount !== 1) throw new CookError('Busy — try again.');
          for (const s of w.stmts) await cl.query(s.sql, s.args);
          await cl.query('COMMIT');
        } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
      };
      const p = run(); w.bind(p);
      try { await p; } catch (e) { w.revert(); if (e instanceof CookError) throw e; console.error('[cooking] sell failed:', (e as Error).message); throw new CookError('Something went wrong. Nothing was sold.'); }
      return { sold: rows.length, gross, paid, chips: this.bank().account(name).chips };
    });
  }
}

let cooking: Cooking | null = null;
export const getCooking = () => cooking;
export const setCooking = (c: Cooking | null) => { cooking = c; };
/** Shares the fishing pool (same database; in local dev the same in-memory one, so fish can be cooked). */
export async function initCooking(): Promise<void> {
  const f = getFishing(); if (!f) { console.error('[cooking] fishing pool missing; kitchen offline'); return; }
  try { const c = new Cooking(f.pool, getBank, () => Date.now(), process.env.NODE_ENV !== 'production' && !databaseUrl()); await c.init(); cooking = c; console.log('[cooking] ready'); }
  catch (e) { console.error('[cooking] init failed:', (e as Error).message); }
}

function bucket(cap = 8, perSec = 4) { let tok = cap, at = Date.now(); return () => { const n = Date.now(); tok = Math.min(cap, tok + ((n - at) / 1000) * perSec); at = n; if (tok < 1) return false; tok -= 1; return true; }; }
type Ack = (r: Record<string, unknown>) => void;
export function registerCooking(_io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const take = bucket();
  const on = (ev: string, fn: (b: Record<string, unknown>, c: Cooking, name: string) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try {
      if (!take()) throw new CookError('Slow down.');
      if (!cooking) throw new CookError('The kitchen is closed right now.');
      const name = nameOf(); if (!name) throw new CookError('Sign in to cook.');
      const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      ack?.({ ok: true, ...((await fn(b, cooking, name)) as object ?? {}) });
    } catch (e) { ack?.({ ok: false, error: e instanceof CookError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); if (!(e instanceof CookError)) console.error(`[cooking] ${ev}:`, (e as Error).message); }
  });
  on('cook_state', async (b, c, n) => ({ state: await c.view(n, b.home), prices: Object.fromEntries(STAPLES.map((s) => [s.id, px(s.base)])), recipes: RECIPES.map((r) => r.id) }));
  on('grocery_buy', (b, c, n) => c.buy(n, b.item, b.qty, b.nonce, b.home));
  on('cook_start', (b, c, n) => c.start(n, b.recipe, b.home));
  on('cook_finish', (b, c, n) => c.finish(n, b.id, b.presses));
  on('cook_sell', (b, c, n) => { awayFromMarket(n, CookError); return c.sell(n, b.ids, b.qty); });
}
