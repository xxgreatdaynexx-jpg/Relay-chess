/** Factory v2 (grid builder): server-authoritative sim per player, catch-up on load, persisted with the banked pack. */
import { Router as expressRouter } from 'express';
import { px } from './price-index.js';
import type { Server, Socket } from 'socket.io';
import { getMines, MineError, MINES_OFFLINE_MSG } from './mines.js';
import { getBank } from './casino-store.js';
import { awardXp, skillLevel } from './skills.js';
import { engineeringTimeMul } from '../shared/skillPerks.js';
import { getFarm, FarmError, type ImportSink } from './farm.js';
import { getFishing, FishError } from './fishing.js';
import { requireResort } from './travel.js';
import { playerKey } from './skins.js';
import { MAX_BANKED_STACK, stackKey, isFood, recipeById, type Stack, type ItemType } from '../shared/mines.js';
import { MAX_CATCHUP_MS, TICK_MS, advance, canPlace, contents, FLOOR_LEVELS, frecipe, gridOf, isItemKey, isKind, isSplitWeights, MAX_SPLIT_W, KINDS, MAX_ENTS, newState, type Dir, type Ent, type FState, type Kind, type Storage } from '../shared/factory.js';

const SAVE_MS = 4000;
const upsert = (k: string, name: string, s: FState) => ({ sql: `INSERT INTO factory_v2 (player_key, owner_name, data, updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (player_key) DO UPDATE SET owner_name = EXCLUDED.owner_name, data = EXCLUDED.data, updated_at = now()`, args: [k, name, JSON.stringify(s)] });

const isFoodKey = (k: string) => { const [t, id] = k.split(':'); return isFood({ type: t as ItemType, id }); };

export class FactoryWorld {
  states = new Map<string, FState>();
  private dirty = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private buySeq = 0;

  storage(account: string): Storage {
    const p = getMines().packOf(account);
    return {
      get: (key) => p.get(key)?.qty ?? 0,
      add: (key, d) => { const cur = p.get(key); const q = (cur?.qty ?? 0) + d; const [t, id] = key.split(':'); if (q <= 0) p.delete(key); else if (cur) cur.qty = q; else p.set(key, { type: t as ItemType, id, qty: q }); },
    };
  }
  private level(account: string) { return getMines().factories.get(playerKey(account))?.level ?? 0; }

  /**
   * Load (or create, migrating old furnace/workbench jobs) and catch up. Null when no factory is built yet.
   * A factory runs for up to 8h after its owner last touched it (factory, storage or market): `owner` refreshes that clock;
   * the background sweep catches up without refreshing it, so storage stays current even if they never come back.
   */
  get(account: string | null, now: number, owner = true): FState | null {
    if (!account) return null;
    // Never build a fresh state (and later save it over the real row) while the stored rows are not loaded.
    if (getMines().offline) throw new MineError(MINES_OFFLINE_MSG);
    const k = playerKey(account); const lv = this.level(account);
    let s = this.states.get(k);
    if (!s) {
      const row = getMines().fv2.get(k) as FState | undefined;
      if (row && row.v === 1) s = row;
      else {
        if (!lv) return null;
        // migration clears old jobs: persist the factory row in the same transaction so they can never be paid twice
        s = newState(lv, now); this.migrateJobs(account, s); this.states.set(k, s); this.markNow(account, s, true);
      }
      this.states.set(k, s);
    }
    s.floor = Math.max(1, lv);
    s.spd = engineeringTimeMul(skillLevel(account, 'engineering')); // Engineering perk: faster crafts
    const seen = s.seen ?? s.at; const until = Math.min(now, seen + MAX_CATCHUP_MS);
    const before = s.at;
    if (until > s.at) {
      // Engineering XP: 2 per bar/good the factory adds to storage while catching up (capped per hour/day in skills.ts)
      const st = this.storage(account); let made = 0, food = 0;
      advance(s, { get: st.get, add: (key, d) => { if (d > 0 && !key.startsWith('ore:')) { if (isFoodKey(key)) food += d; else made += d; } st.add(key, d); } }, until, MAX_CATCHUP_MS);
      if (made > 0) awardXp(account, 'engineering', made * 2);
      if (food > 0) awardXp(account, 'cooking', food * 2);
    }
    if (now - s.at >= TICK_MS) s.at = now - ((now - s.at) % TICK_MS); // idle past the 8h window: skip, no production
    if (owner) s.seen = now;
    if (s.at !== before || owner) this.mark(account);
    return s;
  }
  /** Old timed jobs: every job (finished or not) is paid out as finished output, so nobody loses a batch. */
  private migrateJobs(account: string, s: FState) {
    const f = getMines().factories.get(playerKey(account)); if (!f || !f.jobs.length) return;
    const st = this.storage(account);
    for (const j of f.jobs) { const r = recipeById(j.recipe); if (r) { st.add(stackKey(r.out), r.out.qty * j.qty); s.stored[stackKey(r.out)] = (s.stored[stackKey(r.out)] ?? 0) + r.out.qty * j.qty; } }
    f.jobs = [];
    // furnace + workbench become a smelter + press + roller + wire drawer starter
    s.kit.press = (s.kit.press ?? 0) + 1; s.kit.roller = (s.kit.roller ?? 0) + 1; s.kit.drawer = (s.kit.drawer ?? 0) + 1;
  }
  mark(account: string) {
    this.dirty.set(playerKey(account), account.trim());
    if (!this.timer) { this.timer = setTimeout(() => { this.timer = null; void this.saveDirty(); }, SAVE_MS); this.timer.unref?.(); }
  }
  markNow(account: string, s: FState, withFactory = false) { this.dirty.delete(playerKey(account)); void getMines().savePack(account, [upsert(playerKey(account), account.trim(), s)], withFactory); }
  async saveDirty() {
    const jobs: Promise<void>[] = [];
    for (const [k, name] of [...this.dirty]) { const s = this.states.get(k); this.dirty.delete(k); if (s) jobs.push(getMines().savePack(name, [upsert(k, name, s)])); }
    await Promise.all(jobs);
  }
  /** Background catch-up for every built factory (loaded or not). Low frequency; cheap when quiescent. */
  sweep(now: number) {
    const mines = getMines(); let n = 0;
    for (const k of new Set([...mines.fv2Names.keys(), ...this.states.keys()])) {
      const name = mines.fv2Names.get(k) ?? mines.names.get(k); if (!name) continue;
      if (this.get(name, now, false)) n++;
    }
    return n;
  }
  private sweeper: ReturnType<typeof setInterval> | null = null;
  startSweep(ms = 120_000) { if (this.sweeper) return; this.sweeper = setInterval(() => { try { this.sweep(Date.now()); } catch (e) { console.error('[factory] sweep failed:', (e as Error).message); } }, ms); this.sweeper.unref?.(); }
  stopSweep() { if (this.sweeper) { clearInterval(this.sweeper); this.sweeper = null; } }
  async flush() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } await this.saveDirty(); }

  private need(account: string | null, now: number) { if (!account) throw new MineError('Sign in to build a factory.'); const s = this.get(account, now); if (!s) throw new MineError('Build your factory first.'); return { account, s }; }

  /** Build (level 1) or expand the building. Same chips as old levels 1..3. */
  expand(account: string | null, now: number) {
    if (!account) throw new MineError('Sign in to build a factory.');
    if (getMines().offline) throw new MineError(MINES_OFFLINE_MSG);
    const k = playerKey(account); const mines = getMines(); const f = mines.factories.get(k);
    const next = FLOOR_LEVELS[f ? f.level : 0]; if (!next) throw new MineError('Your building is already as big as it gets.');
    const cost = px(next.cost);
    if (!getBank().canAfford(account, cost)) throw new MineError(`You need ${cost} chips.`);
    if (f) this.get(account, now);
    getBank().transfer(account, -cost, { key: `factory:floor:${k}:L${next.level}`, game: 'mines', memo: next.level === 1 ? 'Factory: built the building' : `Factory: expanded to ${next.size}x${next.size}` });
    if (f) f.level = next.level; else mines.factories.set(k, { level: 1, builtAt: now, jobs: [] });
    const s = this.get(account, now)!; s.floor = next.level;
    this.markNow(account, s, true);
    return { level: next.level, size: next.size, cost };
  }
  buy(account: string | null, kind: unknown, nIn: unknown, now: number) {
    const { s } = this.need(account, now);
    if (!isKind(kind)) throw new MineError('Unknown part.');
    const n = typeof nIn === 'number' && Number.isInteger(nIn) && nIn >= 1 && nIn <= 100 ? nIn : 1;
    const def = KINDS[kind]; if (s.floor < def.minFloor) throw new MineError(`${def.name} unlocks at building level ${def.minFloor}.`);
    const cost = px(def.cost) * n;
    if (!getBank().canAfford(account!, cost)) throw new MineError(`You need ${cost} chips.`);
    getBank().transfer(account!, -cost, { key: `factory:buy:${playerKey(account!)}:${now}:${++this.buySeq}`, game: 'mines', memo: `Machinist: ${n}x ${def.name}` });
    s.kit[kind] = (s.kit[kind] ?? 0) + n;
    this.markNow(account!, s);
    return { kind, n, cost };
  }
  place(account: string | null, items: unknown, now: number) {
    const { s } = this.need(account, now);
    const list = Array.isArray(items) ? items.slice(0, 64) : [];
    if (!list.length) throw new MineError('Nothing to place.');
    const g = gridOf(s); let placed = 0; let err = '';
    for (const raw of list) {
      const b = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const k = b.k; if (!isKind(k)) { err = 'Unknown part.'; continue; }
      if ((s.kit[k] ?? 0) < 1) { err = `Buy a ${KINDS[k].name} from the Machinist first.`; break; }
      if (s.ents.length >= MAX_ENTS) { err = 'Too many parts.'; break; }
      const x = b.x as number, y = b.y as number, d = b.d as number;
      const bad = canPlace(s, g, k, x, y, d); if (bad) { err = bad; continue; }
      const e: Ent = { id: ++s.seq, k, x, y, d: d as Dir };
      if (KINDS[k].machine) { const r = typeof b.r === 'string' && frecipe(b.r)?.machine === k ? b.r : undefined; if (r) e.r = r; }
      if ((k === 'chest_in' || k === 'inserter' || k === 'chest_out') && isItemKey(b.f)) e.f = b.f;
      s.ents.push(e); for (const [cx, cy] of [[x, y], ...(KINDS[k].size === 2 ? [[x + 1, y], [x, y + 1], [x + 1, y + 1]] : [])]) g.set(cy * 1000 + cx, e);
      s.kit[k] = (s.kit[k] ?? 0) - 1; placed++;
    }
    if (!placed) throw new MineError(err || 'Could not place that.');
    this.markNow(account!, s);
    return { placed, error: err || undefined };
  }
  /** Pick up: part back to your kit, anything inside back to banked storage. */
  remove(account: string | null, ids: unknown, now: number) {
    const { s } = this.need(account, now);
    const want = new Set((Array.isArray(ids) ? ids : [ids]).filter((v) => typeof v === 'number').slice(0, 200) as number[]);
    const st = this.storage(account!); let n = 0;
    s.ents = s.ents.filter((e) => { if (!want.has(e.id)) return true; for (const [k, q] of contents(e)) st.add(k, q); s.kit[e.k] = (s.kit[e.k] ?? 0) + 1; n++; return false; });
    if (!n) throw new MineError('Nothing there.');
    this.markNow(account!, s);
    return { removed: n };
  }
  /** Rotate, move, set recipe, set chest filter. */
  edit(account: string | null, b: Record<string, unknown>, now: number) {
    const { s } = this.need(account, now);
    const e = s.ents.find((x) => x.id === b.id); if (!e) throw new MineError('Nothing there.');
    const st = this.storage(account!);
    if (typeof b.d === 'number' || typeof b.x === 'number') {
      const x = typeof b.x === 'number' ? b.x : e.x, y = typeof b.y === 'number' ? b.y : e.y, d = typeof b.d === 'number' ? b.d : e.d;
      const bad = canPlace(s, gridOf(s), e.k, x, y, d, e.id); if (bad) throw new MineError(bad);
      e.x = x; e.y = y; e.d = d as Dir;
    }
    if ('r' in b) {
      if (!KINDS[e.k].machine) throw new MineError('Only machines take recipes.');
      const r = frecipe(b.r); if (!r || r.machine !== e.k) throw new MineError('That machine cannot make that.');
      if (e.r !== r.id) { for (const [k, q] of contents({ ...e, it: null })) st.add(k, q); e.ib = {}; e.ob = 0; e.p = 0; e.r = r.id; }
    }
    if ('f' in b) {
      if (e.k !== 'chest_in' && e.k !== 'inserter' && e.k !== 'chest_out') throw new MineError('Only chests and inserters take a filter.');
      if (b.f !== null && !isItemKey(b.f)) throw new MineError('Unknown item.');
      e.f = (b.f as string | null) ?? undefined;
    }
    if ('w' in b) {
      if (e.k !== 'splitter') throw new MineError('Only splitters take a ratio.');
      if (b.w !== null && !isSplitWeights(b.w)) throw new MineError(`Ratio weights must be whole numbers 0-${MAX_SPLIT_W}, at least one above 0.`);
      const w = b.w as [number, number, number] | null;
      e.w = w && !(w[0] === 1 && w[1] === 1 && w[2] === 1) ? [w[0], w[1], w[2]] : undefined; e.rr = 0;
    }
    this.markNow(account!, s);
    return { id: e.id };
  }
}

/** pt1252u: a sink that lands imported crops/fish in this player's banked storage (mine_items) inside the caller's
 * DB transaction (so the source rows and the storage row commit together), then mirrors it into the in-memory pack
 * and queues a full pack save behind any in-flight one (the chain is serialized, so the last write wins with it). */
export async function writeImport(cl: { query: (sql: string, args: unknown[]) => Promise<unknown> }, account: string, items: Array<[string, number]>) {
  for (const [id, n] of items) await cl.query('INSERT INTO mine_items (player_key, owner_name, item_type, item_id, qty) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (player_key, item_type, item_id) DO UPDATE SET qty = mine_items.qty + EXCLUDED.qty, updated_at = now()', [playerKey(account), account.trim(), 'good', id, n]);
}
export function factorySink(account: string): ImportSink {
  const m = getMines(); if (m.offline) throw new MineError(MINES_OFFLINE_MSG);
  world.get(account, Date.now()); // settle the sim first (throws while offline)
  const pack = m.packOf(account);
  return {
    async write(cl, items) {
      for (const [id, n] of items) {
        const cur = pack.get(stackKey({ type: 'good', id }))?.qty ?? 0;
        if (cur + n > MAX_BANKED_STACK) throw new MineError('Your factory storage is full for that item.');
      }
      await writeImport(cl, account, items);
    },
    after(items) {
      for (const [id, n] of items) { const k = stackKey({ type: 'good', id }); const s = pack.get(k); if (s) s.qty += n; else pack.set(k, { type: 'good', id, qty: n }); }
      void m.savePack(account, []).catch(() => {});
    },
  };
}

let world = new FactoryWorld();
export const getFactory = () => world;
let busy = false;
const hook = (a: string) => { if (busy) return; busy = true; try { world.get(a, Date.now()); } finally { busy = false; } };
export function resetFactory() { world.stopSweep(); world = new FactoryWorld(); getMines().beforeStorage = hook; return world; }
export function initFactory(sweep = true) { getMines().beforeStorage = hook; if (sweep) world.startSweep(); }

type Ack = (r: Record<string, unknown>) => void;
const body = (p: unknown) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {});
export function registerFactory(_io: Server, socket: Socket): void {
  const account = () => (socket.data.account as { name?: string } | undefined)?.name ?? null;
  const view = () => { try { return view0(); } catch (e) { return { guest: !account(), now: Date.now(), offline: getMines().offline, error: (e as Error).message /* no state/level/storage: the client keeps what it shows and never offers 'build' */ }; } };
  const view0 = () => {
    const a = account(); const now = Date.now(); const s = world.get(a, now);
    const storage: Stack[] = a ? getMines().storage(a) : [];
    return { state: s, level: a ? getMines().factories.get(playerKey(a))?.level ?? 0 : 0, storage, guest: !a, now };
  };
  const op = (fn: (b: Record<string, unknown>) => unknown) => (p: unknown, ack?: Ack) => {
    try { if (getMines().offline) throw new MineError(MINES_OFFLINE_MSG); const r = fn(body(p)); ack?.({ ok: true, result: r, ...view() }); }
    catch (e) { ack?.({ ok: false, error: e instanceof MineError ? e.message : 'Factory error.', ...view() }); if (!(e instanceof MineError)) console.error('[factory]', e); }
  };
  // Bring crops / fish in from the rest of the game (async: DB transaction with the source rows).
  const aop = (fn: (a: string, b: Record<string, unknown>) => Promise<unknown>) => async (p: unknown, ack?: Ack) => {
    try {
      const a = account(); if (!a) throw new MineError('Sign in to use the factory.');
      if (getMines().offline) throw new MineError(MINES_OFFLINE_MSG);
      const r = await fn(a, body(p)); ack?.({ ok: true, result: r, ...view() });
    } catch (e) {
      const known = e instanceof MineError || e instanceof FarmError || e instanceof FishError;
      ack?.({ ok: false, error: known ? (e as Error).message : 'Factory error.', ...view() }); if (!known) console.error('[factory import]', e);
    }
  };
  // Truck logistics: no instant farm -> factory import. Harvest (crops stay at the plot), then truck them to the factory.
  socket.on('fac_import_farm', aop(async () => { throw new MineError('Crops reach your factory by truck now: harvest them, then send them from the plot in your Logistics panel.'); }));
  socket.on('fac_import_fish', aop(async (a, b) => {
    const f = getFishing(); if (!f) throw new MineError('Fishing is offline right now.');
    return f.toFactory(a, b.ids, factorySink(a));
  }));
  socket.on('fac_state', op(() => null));
  socket.on('fac_expand', op(() => world.expand(account(), Date.now())));
  socket.on('fac_buy', op((b) => world.buy(account(), b.kind, b.n, Date.now())));
  socket.on('fac_place', op((b) => world.place(account(), b.items, Date.now())));
  socket.on('fac_remove', op((b) => world.remove(account(), b.ids, Date.now())));
  socket.on('fac_edit', op((b) => world.edit(account(), b, Date.now())));
}
export type { Kind };

/**
 * Read-only view of another player's factory (pt1409u). GET only: no socket op, no owner clock refresh (owner=false),
 * nothing a viewer can change. Returns layout, machines, belts/chests, recipes and level, never storage, chips, the
 * unplaced kit or the owner's stored totals.
 */
export function publicFactoryView(name: string, now = Date.now()) {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 40); if (!clean) return null;
  const level = getMines().factories.get(playerKey(clean))?.level ?? 0;
  const s = world.get(clean, now, false); if (!s) return null;
  const state = JSON.parse(JSON.stringify({ v: s.v, floor: s.floor, tick: s.tick, at: s.at, ents: s.ents, seq: s.seq, made: s.made, spd: s.spd, kit: {}, stored: {} })) as FState;
  return { name: clean, level, state, machines: s.ents.filter((e) => KINDS[e.k] && !['belt', 'underground', 'splitter', 'inserter', 'chest_in', 'chest_out'].includes(e.k)).length, now };
}
export function factoryViewRouter(): ReturnType<typeof expressRouter> {
  const r = expressRouter();
  const cache = new Map<string, { t: number; v: ReturnType<typeof publicFactoryView> }>(); // 1s per-player cache: cheap polling, one catch-up per second
  r.get('/api/factory/view/:name', (req, res) => {
    try {
      if (getMines().offline) return res.status(503).json({ ok: false, error: MINES_OFFLINE_MSG });
      const key = playerKey(String(req.params.name ?? '')); const t = Date.now(); const hit = cache.get(key);
      const v = hit && hit.t > t - 1000 ? hit.v : publicFactoryView(String(req.params.name ?? ''), t);
      if (!hit || hit.v !== v) { if (cache.size > 2000) cache.clear(); cache.set(key, { t, v }); }
      if (!v) return res.status(404).json({ ok: false, error: 'That player has no factory yet.' });
      res.set('Cache-Control', 'no-store'); res.json({ ok: true, ...v });
    } catch (e) { res.status(e instanceof MineError ? 503 : 500).json({ ok: false, error: e instanceof MineError ? e.message : 'Could not load that factory.' }); }
  });
  r.all('/api/factory/view/:name', (_req, res) => res.status(405).json({ ok: false, error: 'Read-only.' }));
  return r;
}
