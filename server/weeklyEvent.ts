/**
 * Weekly server events (rules: shared/coop3.ts). One event a week, rotating mining → harvest → fishing → trade → hockey.
 * The whole server fills one goal bar; each player's counted contribution is capped (EVENT_PLAYER_SHARE of the goal),
 * so the bar takes a crowd. When the week ends, contributors claim a tiered reward (bronze/silver/gold, halved if the
 * server got past 50% but missed the goal, nothing under 50%) for EVENT_CLAIM_MS.
 *
 * Counting: a single UPSERT per credit (capped with LEAST in SQL), so a count is never half-written. Rewards: one
 * transferAtomic keyed `wev_claim:<week>:<key>` plus a guard row in wev_claims (PK) in the same transaction.
 * Announced through the changelog and a City notice (`wev:<week>`), never chat. QA, bot and jailed accounts don't count.
 */
import { getBank } from './casino-store.js';
import { priceIndex } from './price-index.js';
import { getCity } from './city.js';
import { getLinks } from './linked.js';
import { Coop3Error, Guard, openPool, runTx, friendly, type PoolLike } from './coop3-gate.js';
import { playerKey } from './skins.js';
import { EVENT_CLAIM_MS, EVENTS, TRADE_COUNT_CAP, eventFor, eventReward, eventTier, playerEventCap, weekIndex, weekStart, type EventKind, type EventView } from '../shared/coop3.js';

const MIGRATION = `
CREATE TABLE IF NOT EXISTS wev_contrib (week INTEGER NOT NULL, player_key TEXT NOT NULL, name TEXT NOT NULL, amount BIGINT NOT NULL, PRIMARY KEY (week, player_key));
CREATE TABLE IF NOT EXISTS wev_claims (id TEXT PRIMARY KEY, week INTEGER NOT NULL, player_key TEXT NOT NULL, amount BIGINT NOT NULL, at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS wev_refs (ref TEXT PRIMARY KEY, week INTEGER NOT NULL);
`;
interface Week { contrib: Map<string, { name: string; amount: number }>; total: number; claimed: Set<string> }

export class WeeklyEvents {
  guard = new Guard(null);
  private weeks = new Map<number, Week>();
  private refs = new Set<string>();
  private q: Promise<unknown> = Promise.resolve();
  onChange?: (week: number) => void; // throttled 'wev_changed' broadcast (wired in registerFishFleet)
  constructor(private readonly pool: PoolLike | null, private readonly clock = () => Date.now()) {}
  async init() {
    if (!this.pool) return; await this.pool.query(MIGRATION);
    const w = weekIndex(this.clock());
    const c = await this.pool.query('SELECT week, player_key, name, amount FROM wev_contrib WHERE week >= $1', [w - 2]);
    for (const r of c.rows as Array<Record<string, unknown>>) { const wk = this.wk(Number(r.week)); const a = Number(r.amount); wk.contrib.set(String(r.player_key), { name: String(r.name), amount: a }); wk.total += a; }
    const k = await this.pool.query('SELECT week, player_key FROM wev_claims WHERE week >= $1', [w - 2]);
    for (const r of k.rows as Array<Record<string, unknown>>) this.wk(Number(r.week)).claimed.add(String(r.player_key));
    const f = await this.pool.query('SELECT ref FROM wev_refs WHERE week >= $1', [w]); // ref dedup survives a restart
    for (const r of f.rows as Array<Record<string, unknown>>) this.refs.add(String(r.ref));
  }
  private wk(w: number): Week { let x = this.weeks.get(w); if (!x) { x = { contrib: new Map(), total: 0, claimed: new Set() }; this.weeks.set(w, x); } return x; }
  current() { const w = weekIndex(this.clock()); return { week: w, e: eventFor(w) }; }

  /** Count `amount` toward this week's event if it is `kind`. `ref` (optional) makes a credit count once. Returns what counted. */
  credit(kind: EventKind, name: string | null | undefined, amount: number, ref?: string): number {
    if (!name || !(amount > 0)) return 0;
    const { week, e } = this.current(); if (e.id !== kind) return 0;
    if (this.guard.excluded(name)) return 0;
    const rk = ref ? `${week}:${ref}:${playerKey(name)}` : null;
    if (rk) { if (this.refs.has(rk)) return 0; this.refs.add(rk); if (this.refs.size > 200_000) this.refs.delete(this.refs.values().next().value as string); }
    const key = playerKey(name); const wk = this.wk(week); const cap = playerEventCap(e);
    const cur = wk.contrib.get(key)?.amount ?? 0; const add = Math.min(Math.floor(amount), cap - cur); if (add <= 0) return 0;
    wk.contrib.set(key, { name: name.trim(), amount: cur + add }); wk.total += add;
    if (this.pool) {
      const p = this.pool;
      this.q = this.q.then(async () => {
        // Persisted dedup: the ref row (PK) is claimed first; if another instance / an earlier run already counted it, undo.
        if (rk && !(await p.query('INSERT INTO wev_refs (ref, week) VALUES ($1,$2) ON CONFLICT DO NOTHING', [rk, week])).rowCount) {
          const c = wk.contrib.get(key); if (c) c.amount = Math.max(0, c.amount - add); wk.total = Math.max(0, wk.total - add); return;
        }
        await p.query('INSERT INTO wev_contrib (week, player_key, name, amount) VALUES ($1,$2,$3,$4) ON CONFLICT (week, player_key) DO UPDATE SET amount = GREATEST(wev_contrib.amount, LEAST($5, wev_contrib.amount + $4)), name = $3', [week, key, name.trim(), add, cap]);
      }).catch((err) => console.error('[weekly] credit write failed:', (err as Error).message));
    }
    this.onChange?.(week); return add;
  }
  /** Trade Week: both sides of a Market trade between two different, unlinked accounts, each capped per trade. */
  creditTrade(buyer: string, seller: string, chips: number, ref: string) {
    if (!buyer || !seller || playerKey(buyer) === playerKey(seller)) return;
    try { if (getLinks().linked(buyer, seller)) return; } catch { /* registry not ready: count it */ }
    const n = Math.min(TRADE_COUNT_CAP, Math.floor(chips));
    this.credit('trade', buyer, n, `${ref}:b`); this.credit('trade', seller, n, `${ref}:s`);
  }
  flush() { return this.q; }

  view(viewer: string | null): EventView {
    const { week, e } = this.current(); const wk = this.wk(week); const nx = eventFor(week + 1);
    const top = [...wk.contrib.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)).slice(0, 10);
    const v: EventView = { week, kind: e.id, name: e.name, icon: e.icon, unit: e.unit, blurb: e.blurb, color: e.color, goal: e.goal, progress: Math.min(e.goal, wk.total), pct: Math.min(1, wk.total / e.goal),
      startAt: weekStart(week), endsAt: weekStart(week + 1), top, playerCap: playerEventCap(e), next: { name: nx.name, icon: nx.icon, startAt: weekStart(week + 1) } };
    if (viewer) {
      const k = playerKey(viewer); const mine = wk.contrib.get(k)?.amount ?? 0; const ex = this.guard.excluded(viewer);
      v.me = { amount: mine, tier: eventTier(e, mine, week)?.id ?? null, ...(ex ? { excluded: ex } : {}) };
      const pw = week - 1, pe = eventFor(pw), pk = this.weeks.get(pw);
      if (pk) { const amt = pk.contrib.get(k)?.amount ?? 0; const pct = Math.min(1, pk.total / pe.goal);
        if (amt > 0) v.past = { week: pw, name: pe.name, icon: pe.icon, pct, amount: amt, reward: eventReward(pe, amt, pct, priceIndex(), pw), claimed: pk.claimed.has(k), claimUntil: weekStart(week) + EVENT_CLAIM_MS }; }
    }
    return v;
  }

  /** Claim last week's reward. Once per account per week (ledger key + guard row, one transaction). */
  async claim(name: string): Promise<{ amount: number; week: number }> {
    this.guard.gate(name);
    const { week } = this.current(); const pw = week - 1; const pe = eventFor(pw); const pk = this.weeks.get(pw); const k = playerKey(name);
    if (this.clock() > weekStart(week) + EVENT_CLAIM_MS) throw new Coop3Error('That claim window has closed.');
    const amt = pk?.contrib.get(k)?.amount ?? 0; if (!pk || amt <= 0) throw new Coop3Error('You didn’t take part in last week’s event.');
    if (pk.claimed.has(k)) throw new Coop3Error('Already claimed.');
    const reward = eventReward(pe, amt, Math.min(1, pk.total / pe.goal), priceIndex(), pw);
    if (reward <= 0) throw new Coop3Error(pk.total / pe.goal < 0.5 ? 'The server didn’t reach 50% of the goal, so there’s no reward this time.' : 'You didn’t reach the bronze tier.');
    const bank = getBank(); let w: ReturnType<typeof bank.transferAtomic>;
    pk.claimed.add(k); // reserve synchronously so a double click can't race
    try { w = bank.transferAtomic([{ name, amount: reward, key: `wev_claim:${pw}:${k}`, game: 'weekly_event', memo: `${pe.icon} ${pe.name} reward (week ${pw})` }]); }
    catch { throw new Coop3Error('Already claimed.'); }
    const p = (async () => { await w.after; await runTx(this.pool, [{ sql: 'INSERT INTO wev_claims (id, week, player_key, amount, at) VALUES ($1,$2,$3,$4,$5)', args: [`wev_claim:${pw}:${k}`, pw, k, reward, this.clock()] }, ...w.stmts]); })(); w.bind(p);
    try { await p; } catch (e) { w.revert(); pk.claimed.delete(k); throw new Coop3Error(friendly(e)); }
    this.onChange?.(pw); return { amount: reward, week: pw };
  }

  /** Post the City notice for the current week (idempotent by id). */
  async announce(): Promise<boolean> {
    const { week, e } = this.current();
    const c = getCity(); if (!c?.notice) return false;
    return c.notice(`wev:${week}`, `${e.icon} This week’s server event: ${e.name}! ${e.blurb} Goal: ${e.goal.toLocaleString('en-US')} ${e.unit}. Rewards up to 🥇 gold for top helpers. Open Co-op → Event.`, weekStart(week)).catch(() => false);
  }
}

let wev = new WeeklyEvents(null);
export const getWeekly = () => wev;
export function resetWeekly(w?: WeeklyEvents) { wev = w ?? new WeeklyEvents(null); return wev; }
/** Fire-and-forget hooks for the game modules (never throw into the caller's flow). */
export function eventCredit(kind: EventKind, name: string | null | undefined, amount: number, ref?: string) { try { return wev.credit(kind, name, amount, ref); } catch (e) { console.error('[weekly] credit failed:', (e as Error).message); return 0; } }
export function eventTrade(buyer: string, seller: string, chips: number, ref: string) { try { wev.creditTrade(buyer, seller, chips, ref); } catch (e) { console.error('[weekly] trade credit failed:', (e as Error).message); } }

export async function initWeekly() {
  wev = new WeeklyEvents(openPool('weekly')); await wev.init();
  const tick = () => void wev.announce();
  setTimeout(tick, 5_000).unref?.(); setInterval(tick, 10 * 60_000).unref?.();
}
export { EVENTS };
