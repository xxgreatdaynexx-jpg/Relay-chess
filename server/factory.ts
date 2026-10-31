/** Factory v2 (grid builder): server-authoritative sim per player, catch-up on load, persisted with the banked pack. */
import type { Server, Socket } from 'socket.io';
import { getMines, MineError } from './mines.js';
import { getBank } from './casino-store.js';
import { playerKey } from './skins.js';
import { stackKey, recipeById, type Stack, type ItemType } from '../shared/mines.js';
import { MAX_CATCHUP_MS, TICK_MS, advance, canPlace, contents, FLOOR_LEVELS, frecipe, gridOf, isItemKey, isKind, KINDS, MAX_ENTS, newState, type Dir, type Ent, type FState, type Kind, type Storage } from '../shared/factory.js';

const SAVE_MS = 4000;
const upsert = (k: string, name: string, s: FState) => ({ sql: `INSERT INTO factory_v2 (player_key, owner_name, data, updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (player_key) DO UPDATE SET owner_name = EXCLUDED.owner_name, data = EXCLUDED.data, updated_at = now()`, args: [k, name, JSON.stringify(s)] });

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
    const seen = s.seen ?? s.at; const until = Math.min(now, seen + MAX_CATCHUP_MS);
    const before = s.at;
    if (until > s.at) advance(s, this.storage(account), until, MAX_CATCHUP_MS);
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
    const k = playerKey(account); const mines = getMines(); const f = mines.factories.get(k);
    const next = FLOOR_LEVELS[f ? f.level : 0]; if (!next) throw new MineError('Your building is already as big as it gets.');
    if (!getBank().canAfford(account, next.cost)) throw new MineError(`You need ${next.cost} chips.`);
    if (f) this.get(account, now);
    getBank().transfer(account, -next.cost, { key: `factory:floor:${k}:L${next.level}`, game: 'mines', memo: next.level === 1 ? 'Factory: built the building' : `Factory: expanded to ${next.size}x${next.size}` });
    if (f) f.level = next.level; else mines.factories.set(k, { level: 1, builtAt: now, jobs: [] });
    const s = this.get(account, now)!; s.floor = next.level;
    this.markNow(account, s, true);
    return { level: next.level, size: next.size, cost: next.cost };
  }
  buy(account: string | null, kind: unknown, nIn: unknown, now: number) {
    const { s } = this.need(account, now);
    if (!isKind(kind)) throw new MineError('Unknown part.');
    const n = typeof nIn === 'number' && Number.isInteger(nIn) && nIn >= 1 && nIn <= 100 ? nIn : 1;
    const def = KINDS[kind]; if (s.floor < def.minFloor) throw new MineError(`${def.name} unlocks at building level ${def.minFloor}.`);
    const cost = def.cost * n;
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
      if ((k === 'chest_in' || k === 'inserter') && isItemKey(b.f)) e.f = b.f;
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
      if (e.k !== 'chest_in' && e.k !== 'inserter') throw new MineError('Only input chests and inserters take a filter.');
      if (b.f !== null && !isItemKey(b.f)) throw new MineError('Unknown item.');
      e.f = (b.f as string | null) ?? undefined;
    }
    this.markNow(account!, s);
    return { id: e.id };
  }
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
  const view = () => {
    const a = account(); const now = Date.now(); const s = world.get(a, now);
    const storage: Stack[] = a ? getMines().storage(a) : [];
    return { state: s, level: a ? getMines().factories.get(playerKey(a))?.level ?? 0 : 0, storage, guest: !a, now };
  };
  const op = (fn: (b: Record<string, unknown>) => unknown) => (p: unknown, ack?: Ack) => {
    try { const r = fn(body(p)); ack?.({ ok: true, result: r, ...view() }); }
    catch (e) { ack?.({ ok: false, error: e instanceof MineError ? e.message : 'Factory error.', ...view() }); if (!(e instanceof MineError)) console.error('[factory]', e); }
  };
  socket.on('fac_state', op(() => null));
  socket.on('fac_expand', op(() => world.expand(account(), Date.now())));
  socket.on('fac_buy', op((b) => world.buy(account(), b.kind, b.n, Date.now())));
  socket.on('fac_place', op((b) => world.place(account(), b.items, Date.now())));
  socket.on('fac_remove', op((b) => world.remove(account(), b.ids, Date.now())));
  socket.on('fac_edit', op((b) => world.edit(account(), b, Date.now())));
}
export type { Kind };
