import { invReady } from './invFence.js';
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
import { MAX_CATCHUP_MS, TICK_MS, advance, canPlace, cells, contents, FLOOR_LEVELS, frecipe, gridOf, machineBusy, machineSalePrice, isItemKey, isKind, isSplitWeights, MAX_SPLIT_W, KINDS, MAX_ENTS, newState, stacksInChest, takePayableHouseSale, sellableKey, type Dir, type Ent, type FState, type Kind, type Storage } from '../shared/factory.js';
import { awakeDeadline } from '../shared/hubSleep.js';
import { collectCarbonTax, carbonUnpaid, carbonRate, resetCarbonTax } from './carbon-tax.js';
import { isFactoryPlantId } from '../shared/bill3.js';
import { getRealEstate } from './realEstate.js';

const SAVE_MS = 4000;
const upsert = (k: string, name: string, s: FState) => ({ sql: `INSERT INTO factory_v2 (player_key, owner_name, data, updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (player_key) DO UPDATE SET owner_name = EXCLUDED.owner_name, data = EXCLUDED.data, updated_at = now()`, args: [k, name, JSON.stringify(s)] });

const isFoodKey = (k: string) => { const [t, id] = k.split(':'); return isFood({ type: t as ItemType, id }); };

export class FactoryWorld {
  states = new Map<string, FState>();
  private dirty = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private buySeq = 0;
  /** Starter factory is keyed by the player; additional plants (Bill Chud 3) are keyed by the deed id. */
  private plantKey(account: string, plant?: string | null) { return plant && isFactoryPlantId(plant) ? plant : playerKey(account); }
  private async assertPlantOwner(account: string, plant?: string | null) {
    if (!plant || !isFactoryPlantId(plant)) return;
    const re = getRealEstate();
    if (!re) throw new MineError('Real estate is offline right now.');
    const o = await re.ownerOf(plant);
    if (!o || o.key !== playerKey(account)) throw new MineError('You do not own that factory plant.');
  }


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
  get(account: string | null, now: number, owner = true, plant?: string | null): FState | null {
    if (!account) return null;
    // Never build a fresh state (and later save it over the real row) while the stored rows are not loaded.
    if (getMines().offline) throw new MineError(MINES_OFFLINE_MSG);
    if (plant && isFactoryPlantId(plant)) {
      const re = getRealEstate();
      // Ownership is enforced by callers (sockets) before get; here we just refuse a plant with no deed when we can ask.
    }
    const k = this.plantKey(account, plant);
    // The sale serializes factory_v2 before adjustStacks snapshots the city pack. Its storage hook,
    // sweep and views must not advance production between those two halves of the same commit.
    if (this.selling.has(k)) return this.states.get(k) ?? null;
    const isPlant = !!(plant && isFactoryPlantId(plant));
    const lv = isPlant ? Math.max(1, (this.states.get(k) as FState | undefined)?.floor ?? (getMines().fv2.get(k) as FState | undefined)?.floor ?? 1) : this.level(account);
    let s = this.states.get(k);
    if (!s) {
      const row = getMines().fv2.get(k) as FState | undefined;
      if (row && row.v === 1) s = row;
      else {
        if (!isPlant && !lv) return null;
        // migration clears old jobs: persist the factory row in the same transaction so they can never be paid twice
        s = newState(isPlant ? 1 : lv, now);
        if (!isPlant) this.migrateJobs(account, s);
        this.states.set(k, s); this.markNow(account, s, true, plant);
      }
      this.states.set(k, s);
    }
    if (!isPlant) s.floor = Math.max(1, lv);
    s.spd = engineeringTimeMul(skillLevel(account, 'engineering')); // Engineering perk: faster crafts
    const seen = s.seen ?? s.at; const capEnd = awakeDeadline(seen, MAX_CATCHUP_MS); const until = Math.min(now, capEnd); // overnight lockout doesn't count toward the 8h away cap
    const before = s.at;
    if (until > s.at) {
      // Engineering XP: 2 per bar/good the factory adds to storage while catching up (capped per hour/day in skills.ts)
      const st = this.storage(account); let made = 0, food = 0, coal = 0;
      advance(s, { get: st.get, add: (key, d) => { if (d > 0 && !key.startsWith('ore:')) { if (isFoodKey(key)) food += d; else made += d; } st.add(key, d); } }, until, Math.max(MAX_CATCHUP_MS, capEnd - seen), (n) => { coal += n; });
      if (made > 0) awardXp(account, 'engineering', made * 2);
      if (food > 0) awardXp(account, 'cooking', food * 2);
      if (coal > 0 || carbonUnpaid(account) > 0) collectCarbonTax(account, coal);
    } else if (carbonUnpaid(account) > 0) collectCarbonTax(account, 0);
    if (now - s.at >= TICK_MS) s.at = now - ((now - s.at) % TICK_MS); // idle past the 8h window: skip, no production
    if (owner) s.seen = now;
    if (s.at !== before || owner) this.mark(account, plant);
    this.scheduleAutoSell(account, s, now);
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
  mark(account: string, plant?: string | null) {
    this.dirty.set(this.plantKey(account, plant), account.trim());
    if (!this.timer) { this.timer = setTimeout(() => { this.timer = null; void this.saveDirty(); }, SAVE_MS); this.timer.unref?.(); }
  }
  markNow(account: string, s: FState, withFactory = false, plant?: string | null) { const k = this.plantKey(account, plant); this.dirty.delete(k); void getMines().savePack(account, [upsert(k, account.trim(), s)], withFactory); }
  async saveDirty() {
    const jobs: Promise<void>[] = [];
    for (const [k, name] of [...this.dirty]) { if (this.selling.has(k)) continue; /* the sale's own transaction carries this state; saved after */ const s = this.states.get(k); this.dirty.delete(k); if (s) jobs.push(getMines().savePack(name, [upsert(k, name, s)])); }
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
  startSweep(ms = 120_000) { if (this.sweeper) return; this.sweeper = setInterval(() => { if (!invReady()) return; try { this.sweep(Date.now()); } catch (e) { console.error('[factory] sweep failed:', (e as Error).message); } }, ms); this.sweeper.unref?.(); }
  stopSweep() { if (this.sweeper) { clearInterval(this.sweeper); this.sweeper = null; } }
  async flush() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } await this.saveDirty(); }

  private need(account: string | null, now: number, plant?: string | null) { if (!account) throw new MineError('Sign in to build a factory.'); if (this.selling.has(this.plantKey(account, plant))) throw new MineError('Finishing your machine sale. Try again in a moment.'); const s = this.get(account, now, true, plant); if (!s) throw new MineError('Build your factory first.'); return { account, s }; }

  /** Build (level 1) or expand the building. Same chips as old levels 1..3. */
  expand(account: string | null, now: number, plant?: string | null) {
    if (!account) throw new MineError('Sign in to build a factory.');
    if (getMines().offline) throw new MineError(MINES_OFFLINE_MSG);
    if (this.selling.has(this.plantKey(account, plant))) throw new MineError('Finishing your machine sale. Try again in a moment.');
    const isPlant = !!(plant && isFactoryPlantId(plant));
    const k = this.plantKey(account, plant); const mines = getMines(); const f = isPlant ? null : mines.factories.get(playerKey(account));
    const cur = isPlant ? (this.get(account, now, true, plant)?.floor ?? 1) : (f ? f.level : 0);
    const next = FLOOR_LEVELS[isPlant ? cur : (f ? f.level : 0)]; if (!next) throw new MineError('Your building is already as big as it gets.');
    const cost = px(next.cost);
    if (!getBank().canAfford(account, cost)) throw new MineError(`You need ${cost} chips.`);
    if (f || isPlant) this.get(account, now, true, plant);
    getBank().transfer(account, -cost, { key: `factory:floor:${k}:L${next.level}`, game: 'mines', memo: next.level === 1 ? 'Factory: built the building' : `Factory: expanded to ${next.size}x${next.size}` });
    if (!isPlant) { if (f) f.level = next.level; else mines.factories.set(playerKey(account), { level: 1, builtAt: now, jobs: [] }); }
    const s = this.get(account, now, true, plant)!; s.floor = next.level;
    this.markNow(account, s, true, plant);
    return { level: next.level, size: next.size, cost };
  }
  buy(account: string | null, kind: unknown, nIn: unknown, now: number, plant?: string | null) {
    const { s } = this.need(account, now, plant);
    if (!isKind(kind)) throw new MineError('Unknown part.');
    const n = typeof nIn === 'number' && Number.isInteger(nIn) && nIn >= 1 && nIn <= 100 ? nIn : 1;
    const def = KINDS[kind]; if (s.floor < def.minFloor) throw new MineError(`${def.name} unlocks at building level ${def.minFloor}.`);
    const cost = px(def.cost) * n;
    if (!getBank().canAfford(account!, cost)) throw new MineError(`You need ${cost} chips.`);
    getBank().transfer(account!, -cost, { key: `factory:buy:${playerKey(account!)}:${now}:${++this.buySeq}`, game: 'mines', memo: `Machinist: ${n}x ${def.name}` });
    s.kit[kind] = (s.kit[kind] ?? 0) + n;
    this.markNow(account!, s, false, plant);
    return { kind, n, cost };
  }
  place(account: string | null, items: unknown, now: number, plant?: string | null) {
    const { s } = this.need(account, now, plant);
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
      if ((k === 'chest_in' || k === 'inserter' || k === 'chest_out' || k === 'chest_sell') && isItemKey(b.f)) e.f = b.f;
      s.ents.push(e); for (const [cx, cy] of [[x, y], ...(KINDS[k].size === 2 ? [[x + 1, y], [x, y + 1], [x + 1, y + 1]] : [])]) g.set(cy * 1000 + cx, e);
      s.kit[k] = (s.kit[k] ?? 0) - 1; placed++;
    }
    if (!placed) throw new MineError(err || 'Could not place that.');
    this.markNow(account!, s, false, plant);
    return { placed, error: err || undefined };
  }
  /** Pick up: part back to your kit, anything inside back to banked storage. */
  /** In-flight auto-sell (separate from machine resale) so two get()s never sell the same chest twice. */
  private autoSelling = new Set<string>();
  private autoSellTail = new Map<string, Promise<unknown>>();
  /** Test hook: wait until a scheduled auto-sell for this account finishes (or is already idle). */
  async waitAutoSell(account: string) { const p = this.autoSellTail.get(playerKey(account)); if (p) await p; }

  private scheduleAutoSell(account: string, s: FState, now: number) {
    const k = playerKey(account);
    if (this.autoSelling.has(k) || this.selling.has(k)) return;
    if (!s.ents.some((e) => e.k === 'chest_sell' && stacksInChest(e).length)) return;
    const p = this.flushAutoSell(account, s, now).catch((err) => { console.error('[factory] auto-sell failed:', (err as Error).message); });
    this.autoSellTail.set(k, p);
    void p.finally(() => { if (this.autoSellTail.get(k) === p) this.autoSellTail.delete(k); });
  }

  /**
   * Sell whatever auto-sell chests currently hold, up to the remaining daily house cap. Leftovers stay in the chest.
   * Chips, the daily cap, and the factory_v2 row commit in one transaction (same fail-closed pattern as machine sales).
   */
  private async flushAutoSell(account: string, s: FState, now: number): Promise<{ paid: number; sold: Stack[] } | null> {
    const k = playerKey(account);
    if (this.autoSelling.has(k) || this.selling.has(k)) return null;
    const chests = s.ents.filter((e) => e.k === 'chest_sell');
    if (!chests.length) return null;
    const items = chests.flatMap((e) => stacksInChest(e));
    if (!items.length) return null;
    const mines = getMines();
    if (mines.offline) return null;
    let slice: Stack[] = [];
    try { slice = takePayableHouseSale(items, (xs) => mines.quoteItems(account, now, xs).paid); }
    catch { return null; }
    if (!slice.length) return null;

    this.autoSelling.add(k);
    const snap = chests.map((e) => ({ e, ib: { ...(e.ib ?? {}) } }));
    const restore = () => { for (const { e, ib } of snap) e.ib = { ...ib }; };
    // Pull sold qty out of the chests (any chest holding that item).
    for (const st of slice) {
      let left = st.qty;
      const key = stackKey(st);
      for (const e of chests) {
        if (left < 1) break;
        const have = e.ib?.[key] ?? 0;
        const q = Math.min(left, have);
        if (q < 1) continue;
        e.ib = e.ib ?? {};
        e.ib[key] = have - q;
        if (e.ib[key] <= 0) delete e.ib[key];
        left -= q;
      }
    }

    let sale: ReturnType<ReturnType<typeof getMines>['houseSale']>;
    try { sale = mines.houseSale(account, now, slice, 'Factory auto-sell'); }
    catch {
      restore();
      this.autoSelling.delete(k);
      return null;
    }

    this.selling.add(k); this.dirty.delete(k);
    const store = mines.store as (MinesStoreLike | null);
    let applied = false;
    const applyOnce = () => {
      if (applied) return;
      applied = true;
      sale.apply();
      let made = 0, food = 0;
      for (const st of sale.q.items) {
        if (st.type === 'ore') continue;
        if (isFood(st) || st.type === 'food') food += st.qty; else made += st.qty;
      }
      if (made > 0) awardXp(account, 'engineering', made * 2);
      if (food > 0) awardXp(account, 'cooking', food * 2);
    };
    const unlock = () => { this.selling.delete(k); this.autoSelling.delete(k); this.mark(account); };
    let done: Promise<unknown> = Promise.resolve(); let failed: Error | null = null; let unknown = false; let late: boolean | null = null; let rows: unknown[] | null = null;
    const ok = mines.adjustStacks(account, [], [upsert(k, account.trim(), s), ...sale.stmts], (r) => { rows = r; }, {
      after: sale.w.after,
      bind: (p) => { done = p; sale.w.bind(p); },
      onFail: (err) => { failed = err; restore(); sale.w.revert(); },
      onUnknown: () => { unknown = true; },
      onLate: (committed) => { late = committed; if (committed) applyOnce(); else restore(); unlock(); },
      committed: store?.txCommitted ? () => store.txCommitted!(sale.ledgerKey) : undefined,
    });
    if (!ok) { restore(); sale.w.revert(); this.selling.delete(k); this.autoSelling.delete(k); return null; }
    if (rows) { sale.w.bind(Promise.resolve()); applyOnce(); unlock(); return { paid: sale.q.paid, sold: sale.q.items }; }
    await done;
    if (unknown) { if (late) return { paid: sale.q.paid, sold: sale.q.items }; return null; }
    if (!failed) applyOnce();
    unlock();
    if (failed) return null;
    return { paid: sale.q.paid, sold: sale.q.items };
  }

    /** Accounts with a machine sale in flight: every other factory op and background save for them waits (one writer). */
  readonly selling = new Set<string>();
  private saleSeq = 0;
  /** Server quote for selling one placed machine (t1967u). Refuses non-machines, busy machines and other people's ids. */
  sellQuote(account: string | null, idIn: unknown, now: number, plant?: string | null) {
    const { s } = this.need(account, now, plant);
    const e = typeof idIn === 'number' ? s.ents.find((x) => x.id === idIn) : undefined;
    if (!e) throw new MineError('That machine is not in your factory any more (already sold or picked up).');
    const def = KINDS[e.k];
    if (!def.machine) throw new MineError(`A ${def.name} is not a machine. Pick it up instead; it goes back to your kit.`);
    if (machineBusy(e)) throw new MineError(`That ${def.name} is still working or holding items. Wait until it is idle and empty (stop feeding it), or change its recipe to send its items to storage, then sell.`);
    return { s, e, def, pay: machineSalePrice(e.k) };
  }
  /**
   * Sell one idle, empty, placed machine for machineSalePrice(). The machine leaves the in-memory state first (so a
   * double click, a retry, a start or an edit all see it gone), and the factory_v2 row + wallet credit commit in ONE
   * Mines store transaction (adjustStacks with no item deltas). Definite failure: machine restored, credit reverted.
   * Unknown outcome: the account stays locked until the ledger key answers, then kept or restored. Never both, never neither.
   */
  async sell(account: string | null, b: Record<string, unknown>, now: number, plant?: string | null) {
    const { s, e, def, pay } = this.sellQuote(account, b.id, now, plant);
    if (b.kind !== undefined && b.kind !== e.k) throw new MineError('Your selection changed. Pick the machine again.');
    if (b.quote !== pay) throw new MineError(`The price is ${pay} chips. Check it and confirm again.`);
    const a = account!; const k = playerKey(a);
    const idx = s.ents.indexOf(e); s.ents.splice(idx, 1);
    const restore = () => { if (!s.ents.some((x) => x.id === e.id)) s.ents.splice(Math.min(idx, s.ents.length), 0, e); };
    const key = `factory:sell:${k}:${e.id}:${now}:${++this.saleSeq}`;
    await this.commitSale(a, s, pay, key, `Machinist: sold a ${def.name} back (${pay} chips)`, restore, 'Your machine is still there and nothing was paid.', plant);
    return { sold: e.id, kind: e.k, paid: pay };
  }
  /** Server quote for selling unplaced machines from your kit (Machinist menu). Only machines you hold unplaced count. */
  kitSellQuote(account: string | null, kindIn: unknown, nIn: unknown, now: number, plant?: string | null) {
    const { s } = this.need(account, now, plant);
    if (!isKind(kindIn)) throw new MineError('Unknown part.');
    const def = KINDS[kindIn]; if (!def.machine) throw new MineError(`A ${def.name} is not a machine.`);
    const n = nIn === undefined ? 1 : nIn; if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 100) throw new MineError('Pick how many to sell.');
    const have = s.kit[kindIn] ?? 0; if (have < n) throw new MineError(have ? `You only have ${have} unplaced ${def.name}${have === 1 ? '' : 's'}.` : `You have no unplaced ${def.name}. Placed machines are sold from the factory floor.`);
    return { s, kind: kindIn, def, n, pay: machineSalePrice(kindIn) * n };
  }
  /** Sell unplaced machine(s) from the kit: same price rule and the same one-transaction kit+chips commit as sell(). */
  async sellKit(account: string | null, b: Record<string, unknown>, now: number, plant?: string | null) {
    const { s, kind, def, n, pay } = this.kitSellQuote(account, b.kind, b.n, now, plant);
    if (b.quote !== pay) throw new MineError(`The price is ${pay} chips. Check it and confirm again.`);
    const a = account!; const k = playerKey(a);
    s.kit[kind] = (s.kit[kind] ?? 0) - n;
    const restore = () => { s.kit[kind] = (s.kit[kind] ?? 0) + n; };
    const key = `factory:sellkit:${k}:${kind}:${now}:${++this.saleSeq}`;
    await this.commitSale(a, s, pay, key, `Machinist: sold ${n}x unplaced ${def.name} back (${pay} chips)`, restore, 'Your machine is still in your kit and nothing was paid.', plant);
    return { kind, n, paid: pay, left: s.kit[kind] ?? 0 };
  }
  /**
   * The state change (already applied in memory by the caller, undone by `restore`) and the chip credit commit in ONE
   * Mines store transaction. Definite failure: restored + credit reverted. Unknown outcome: the account stays locked
   * until the ledger key answers, then kept or restored. Never both, never neither.
   */
  private async commitSale(a: string, s: FState, pay: number, key: string, memo: string, restore: () => void, keptMsg: string, plant?: string | null) {
    const k = this.plantKey(a, plant); const mines = getMines();
    let w: ReturnType<ReturnType<typeof getBank>['transferAtomic']>;
    try { w = getBank().transferAtomic([{ name: a, amount: pay, key, game: 'mines', memo }]); }
    catch (err) { restore(); throw new MineError((err as Error).message || 'The bank is busy. Try again.'); }
    this.selling.add(k); this.dirty.delete(k);
    const store = mines.store as (MinesStoreLike | null);
    const unlock = () => { this.selling.delete(k); this.mark(a, plant); };
    let done: Promise<unknown> = Promise.resolve(); let failed: Error | null = null; let unknown = false; let late: boolean | null = null; let rows: unknown[] | null = null;
    const ok = mines.adjustStacks(a, [], [upsert(k, a, s), ...w.stmts], (r) => { rows = r; }, {
      after: w.after,
      bind: (p) => { done = p; w.bind(p); },
      onFail: (err) => { failed = err; restore(); w.revert(); },
      onUnknown: () => { unknown = true; },
      onLate: (committed) => { late = committed; if (!committed) restore(); unlock(); },
      committed: store?.txCommitted ? () => store.txCommitted!(key) : undefined,
    });
    if (!ok) { restore(); w.revert(); this.selling.delete(k); throw new MineError('That sale did not go through. Nothing changed.'); }
    if (rows) { w.bind(Promise.resolve()); unlock(); return; } // no Mines store (dev/tests): memory only
    await done;
    if (unknown) { if (late) return; throw new MineError(`That sale did not go through. ${keptMsg}`); }
    unlock();
    if (failed) throw new MineError(`That sale did not go through. ${keptMsg}`);
  }
  remove(account: string | null, ids: unknown, now: number, plant?: string | null) {
    const { s } = this.need(account, now, plant);
    const want = new Set((Array.isArray(ids) ? ids : [ids]).filter((v) => typeof v === 'number').slice(0, 200) as number[]);
    const st = this.storage(account!); let n = 0;
    s.ents = s.ents.filter((e) => { if (!want.has(e.id)) return true; for (const [k, q] of contents(e)) st.add(k, q); s.kit[e.k] = (s.kit[e.k] ?? 0) + 1; n++; return false; });
    if (!n) throw new MineError('Nothing there.');
    this.markNow(account!, s, false, plant);
    return { removed: n };
  }
  /**
   * Move many placed parts by the same dx/dy (area-select move). Validates every new footprint first
   * against a grid with the movers removed, so the group can slide into its own old cells.
   */
  moveMany(account: string | null, b: Record<string, unknown>, now: number, plant?: string | null) {
    const { s } = this.need(account, now, plant);
    const ids = (Array.isArray(b.ids) ? b.ids : []).filter((v): v is number => typeof v === 'number').slice(0, 200);
    const dx = b.dx, dy = b.dy;
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) throw new MineError('Bad move.');
    if (!ids.length) throw new MineError('Nothing selected.');
    if (dx === 0 && dy === 0) return { moved: 0 };
    const want = new Set(ids);
    const moving = s.ents.filter((e) => want.has(e.id));
    if (moving.length !== ids.length) throw new MineError('Selection changed — try again.');
    const g = gridOf(s);
    for (const e of moving) for (const [cx, cy] of cells(e)) g.delete(cy * 1000 + cx);
    for (const e of moving) {
      const nx = e.x + (dx as number), ny = e.y + (dy as number);
      const bad = canPlace(s, g, e.k, nx, ny, e.d, e.id);
      if (bad) throw new MineError(bad);
      for (const [cx, cy] of cells({ k: e.k, x: nx, y: ny })) g.set(cy * 1000 + cx, e);
    }
    for (const e of moving) { e.x += dx as number; e.y += dy as number; }
    this.markNow(account!, s, false, plant);
    return { moved: moving.length };
  }
  /** Rotate, move, set recipe, set chest filter. */
  edit(account: string | null, b: Record<string, unknown>, now: number, plant?: string | null) {
    const { s } = this.need(account, now, plant);
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
      if (e.k !== 'chest_in' && e.k !== 'inserter' && e.k !== 'chest_out' && e.k !== 'chest_sell') throw new MineError('Only chests and inserters take a filter.');
      if (b.f !== null && !isItemKey(b.f)) throw new MineError('Unknown item.');
      if (e.k === 'chest_sell' && b.f !== null && !sellableKey(String(b.f))) throw new MineError('That item cannot be sold to the house.');
      e.f = (b.f as string | null) ?? undefined;
    }
    if ('w' in b) {
      if (e.k !== 'splitter') throw new MineError('Only splitters take a ratio.');
      if (b.w !== null && !isSplitWeights(b.w)) throw new MineError(`Ratio weights must be whole numbers 0-${MAX_SPLIT_W}, at least one above 0.`);
      const w = b.w as [number, number, number] | null;
      e.w = w && !(w[0] === 1 && w[1] === 1 && w[2] === 1) ? [w[0], w[1], w[2]] : undefined; e.rr = 0;
    }
    this.markNow(account!, s, false, plant);
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

type MinesStoreLike = { txCommitted?: (key: string) => Promise<boolean> };
let world = new FactoryWorld();
export const getFactory = () => world;
let busy = false;
const hook = (a: string) => { if (busy) return; busy = true; try { world.get(a, Date.now()); } finally { busy = false; } };
export function resetFactory() { world.stopSweep(); resetCarbonTax(); world = new FactoryWorld(); getMines().beforeStorage = hook; return world; }
export function initFactory(sweep = true) { getMines().beforeStorage = hook; if (sweep) world.startSweep(); }

type Ack = (r: Record<string, unknown>) => void;
const body = (p: unknown) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {});
export function registerFactory(_io: Server, socket: Socket): void {
  const account = () => (socket.data.account as { name?: string } | undefined)?.name ?? null;
  const plantOf = (b: Record<string, unknown>) => (isFactoryPlantId(b.plant) ? String(b.plant) : undefined);
  const view = (plant?: string) => { try { return view0(plant); } catch (e) { return { guest: !account(), now: Date.now(), offline: getMines().offline, error: (e as Error).message /* no state/level/storage: the client keeps what it shows and never offers 'build' */ }; } };
  const view0 = (plant?: string) => {
    const a = account(); const now = Date.now(); const s = world.get(a, now, true, plant);
    const storage: Stack[] = a ? getMines().storage(a) : [];
    const level = s?.floor ?? (a && !plant ? getMines().factories.get(playerKey(a))?.level ?? 0 : 0);
    return { state: s, level, plant: plant ?? null, storage, guest: !a, now, carbonTax: { rate: carbonRate(), unpaid: a ? carbonUnpaid(a) : 0 } };
  };
  const op = (fn: (b: Record<string, unknown>) => unknown) => (p: unknown, ack?: Ack) => {
    try { if (getMines().offline) throw new MineError(MINES_OFFLINE_MSG); const b = body(p); const plant = plantOf(b); const r = fn(b); ack?.({ ok: true, result: r, ...view(plant) }); }
    catch (e) { const b = body(p); ack?.({ ok: false, error: e instanceof MineError ? e.message : 'Factory error.', ...view(plantOf(b)) }); if (!(e instanceof MineError)) console.error('[factory]', e); }
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
  // Pre-Millionaire behaviour restored (map pools): ready city crops go straight into your factory. Resort plantation
  // crops are on another map, so they are never imported here (sell them at the plantation or ship them).
  socket.on('fac_import_farm', aop(async (a, b) => {
    const f = getFarm(); if (!f) throw new MineError('The farm is offline right now.');
    if (typeof b.plot === 'string') { if (b.plot.startsWith('rf:')) throw new MineError('Plantation crops are on the resort map: sell them there or ship them.'); return f.harvest(a, b.plot, b.tiles, factorySink(a)); }
    const got: Array<[string, number]> = []; let harvested = 0; let skippedResort = false;
    for (const pid of await f.myPlots(a)) {
      if (pid.startsWith('rf:')) { skippedResort = true; continue; }
      try { const r = await f.harvest(a, pid, undefined, factorySink(a)); harvested += r.harvested; for (const [id, n] of r.toFactory ?? []) { const x = got.find((g) => g[0] === id); if (x) x[1] += n; else got.push([id, n]); } }
      catch (e) { if (!(e instanceof FarmError)) throw e; }
    }
    if (!harvested) throw new MineError(skippedResort ? 'No ready crops on your city plots. (Plantation crops stay on the resort map.)' : 'No ready crops on your farm plots.');
    return { harvested, toFactory: got, skippedResort };
  }));
  socket.on('fac_import_fish', aop(async (a, b) => {
    const f = getFishing(); if (!f) throw new MineError('Fishing is offline right now.');
    return f.toFactory(a, b.ids, factorySink(a));
  }));
  socket.on('fac_state', op(() => null));
  socket.on('fac_expand', op((b) => world.expand(account(), Date.now(), plantOf(b))));
  socket.on('fac_buy', op((b) => world.buy(account(), b.kind, b.n, Date.now(), plantOf(b))));
  socket.on('fac_place', op((b) => world.place(account(), b.items, Date.now(), plantOf(b))));
  socket.on('fac_sell_quote', op((b) => { const q = world.sellQuote(account(), b.id, Date.now(), plantOf(b)); return { id: q.e.id, kind: q.e.k, name: q.def.name, pay: q.pay }; }));
  socket.on('fac_sellkit_quote', op((b) => { const q = world.kitSellQuote(account(), b.kind, b.n, Date.now(), plantOf(b)); return { kind: q.kind, n: q.n, name: q.def.name, pay: q.pay }; }));
  socket.on('fac_sellkit', aop((a, b) => world.sellKit(a, b, Date.now(), plantOf(b))));
  socket.on('fac_sell', aop((a, b) => world.sell(a, b, Date.now(), plantOf(b))));
  socket.on('fac_remove', op((b) => world.remove(account(), b.ids, Date.now(), plantOf(b))));
  socket.on('fac_edit', op((b) => world.edit(account(), b, Date.now(), plantOf(b))));
  socket.on('fac_move', op((b) => world.moveMany(account(), b, Date.now(), plantOf(b))));
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
  return { name: clean, level, state, machines: s.ents.filter((e) => KINDS[e.k] && !['belt', 'underground', 'splitter', 'inserter', 'chest_in', 'chest_out', 'chest_sell'].includes(e.k)).length, now };
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
