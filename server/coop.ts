import { isOutcomeUnknown } from './locstock.js';
/**
 * Co-op economy server (rules + sizing: shared/coop.ts).
 *
 * Exploit safety
 *  - Every chip move goes through the wallet (transferAtomic / ledger), inside the SAME Postgres transaction as the co-op row
 *    it pays for; goods move through Mines.adjustStack with the co-op row (and any reward credit) in one transaction.
 *  - Every mutation runs on ONE serial lock, so progress can't over-fill and two donations can't race the same need.
 *  - Idempotency: a donation / delivery id is `coop:<player>:<client nonce>` (PK + wallet keys coop_don:/coop_rwd:), a claim
 *    is keyed `coop_claim:<contract>:<player>` (PK + wallet key). A replay is a no-op that returns the first result.
 *  - QA, bot and jailed accounts can't take part; contracts also need account age + play time (anti-alt, fail closed).
 */
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { databaseUrl } from './leaderboard-store.js';
import { getBank } from './casino-store.js';
import { getLocStore } from './locstock.js';
import { WAREHOUSE } from '../shared/inventoryLocations.js';
import { isJailed } from './jail.js';
import { houseCapIndex } from './house-cap-index.js';
import { getPlayTime } from './playtime.js';
import { playerKey } from './skins.js';
import { setCoopPerkHooks } from './coop-perks.js';
import { isQaName } from '../shared/qa.js';
import { GOODS, nameOf } from '../shared/mines.js';
import {
  COOP_PLAN, PROJECT_ORDER, projectStages, stageFull, stagePct, stageValue, partKey, donorReward, DONOR_REWARD_CAP, MIN_DONATION_VALUE,
  sellCapBonus, recentDonated, contractAt, contractIndex, contractPay, playerCap, CONTRACT_MIN_AGE_MS, CONTRACT_MIN_PLAY_MS, CONTRACT_CLAIM_MS,
  type ProjectId, type StageNeed, type CoopView, type ProjectView, type ContractView,
} from '../shared/coop.js';

export class CoopError extends Error {}
type Stmt = { sql: string; args: unknown[] };
type Q = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };
type PoolLike = Q & { connect: () => Promise<Q & { release: () => void }> };

export const COOP_MIGRATION = `
CREATE TABLE IF NOT EXISTS coop_donations (id TEXT PRIMARY KEY, project TEXT NOT NULL, stage INT NOT NULL, player_key TEXT NOT NULL, name TEXT NOT NULL, part TEXT NOT NULL, qty BIGINT NOT NULL, value BIGINT NOT NULL, reward BIGINT NOT NULL, at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS coop_deliveries (id TEXT PRIMARY KEY, contract TEXT NOT NULL, player_key TEXT NOT NULL, name TEXT NOT NULL, item TEXT NOT NULL, qty BIGINT NOT NULL, at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS coop_claims (contract TEXT NOT NULL, player_key TEXT NOT NULL, amount BIGINT NOT NULL, bonus BIGINT NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (contract, player_key));
`;

const NONCE = /^[A-Za-z0-9_-]{6,64}$/;
const BOT = /^(qa-bot-|bot[-_ ]|cpu[-_ ])/i;
export interface AccountInfo { ageMs: number; playMs: number }
interface Donor { name: string; value: number; rewarded: number }
interface Contract { id: string; item: string; type: string; qty: number; start: number; deadline: number; delivered: number; filledAt: number | null; by: Map<string, { name: string; qty: number }>; claimed: Set<string> }
type DonResult = { id: string; project: ProjectId; stage: number; part: string; qty: number; value: number; reward: number };

export class Coop {
  private done: Record<ProjectId, Array<Record<string, number>>>;
  private donors: Record<ProjectId, Map<string, Donor>>;
  private stadiumLog = new Map<string, Array<{ at: number; value: number }>>();
  private seen = new Map<string, DonResult | { id: string; contract: string; qty: number }>();
  private contracts = new Map<string, Contract>();
  private chain: Promise<unknown> = Promise.resolve();
  /** Dev/QA screenshots only: lets qa- accounts take part when there is NO database. Never on prod. */
  allowQa = false;
  /** Anti-alt lookup (account age from players.created_at, play time from player_playtime). Injectable for tests. */
  accountInfo: (name: string) => Promise<AccountInfo>;
  onChange?: () => void;
  constructor(private readonly pool: PoolLike | null, private readonly clock = () => Date.now()) {
    this.done = { stadium: COOP_PLAN.stadium.stages.map(() => ({})), bridge: COOP_PLAN.bridge.stages.map(() => ({})) };
    this.donors = { stadium: new Map(), bridge: new Map() };
    this.accountInfo = async (name) => {
      const playMs = await getPlayTime().total(name);
      if (!this.pool) return { ageMs: Number.POSITIVE_INFINITY, playMs };
      const r = await this.pool.query('SELECT created_at FROM players WHERE player_key = $1', [playerKey(name)]); const t = r.rows[0]?.created_at;
      const ms = t ? new Date(t as string).getTime() : NaN; return { ageMs: Number.isFinite(ms) ? this.clock() - ms : 0, playMs };
    };
  }

  async init(): Promise<void> {
    if (!this.pool) return;
    await this.pool.query(COOP_MIGRATION);
    for (const r of (await this.pool.query('SELECT * FROM coop_donations')).rows) this.applyDonation({ id: String(r.id), project: r.project as ProjectId, stage: Number(r.stage), part: String(r.part), qty: Number(r.qty), value: Number(r.value), reward: Number(r.reward) }, String(r.player_key), String(r.name), Number(r.at));
    for (const r of (await this.pool.query('SELECT * FROM coop_deliveries')).rows) this.applyDelivery(String(r.id), String(r.contract), String(r.player_key), String(r.name), Number(r.qty), Number(r.at));
    for (const r of (await this.pool.query('SELECT contract, player_key FROM coop_claims')).rows) this.contract(String(r.contract))?.claimed.add(String(r.player_key));
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> { const p = this.chain.then(fn, fn); this.chain = p.catch(() => {}); return p; }

  // ------------------------------------------------------------ projects
  /** Index of the first project that isn't complete (null = all done). */
  activeProject(): ProjectId | null { for (const id of PROJECT_ORDER) if (this.stagesDone(id) < COOP_PLAN[id].stages.length) return id; return null; }
  stagesDone(id: ProjectId): number { const st = projectStages(COOP_PLAN[id]); let n = 0; while (n < st.length && stageFull(st[n]!, this.done[id][n]!)) n++; return n; }
  /** Total chips-equivalent this player has given the Hockey Stadium (drives their sell-cap bonus). */
  stadiumDonated(name: string): number { return this.donors.stadium.get(playerKey(name))?.value ?? 0; }
  /** Stadium value donated in the last SELL_BONUS_WINDOW_DAYS (only this drives the sell-cap bonus; older gifts roll off). */
  stadiumRecent(name: string, now = this.clock()): number { return recentDonated(this.stadiumLog.get(playerKey(name)) ?? [], now); }
  sellBonus(name: string): number { return sellCapBonus(this.stadiumRecent(name), houseCapIndex()); }
  perk(id: ProjectId): boolean { return this.stagesDone(id) >= COOP_PLAN[id].stages.length; }

  private applyDonation(d: DonResult, k: string, name: string, at: number) {
    this.seen.set(d.id, d);
    if (d.project === 'stadium' && d.value > 0) { const l = this.stadiumLog.get(k) ?? []; l.push({ at, value: d.value }); this.stadiumLog.set(k, l); }
    const row = this.done[d.project]?.[d.stage]; if (!row) return; row[d.part] = (row[d.part] ?? 0) + d.qty;
    const m = this.donors[d.project]; const cur = m.get(k) ?? { name, value: 0, rewarded: 0 }; cur.name = name; cur.value += d.value; cur.rewarded += d.reward; m.set(k, cur);
  }

  private gate(name: string) {
    if ((isQaName(name) && !this.allowQa) || BOT.test(name.trim())) throw new CoopError('QA and bot accounts can’t take part in co-op projects.');
    if (isJailed(name)) throw new CoopError('You can’t do that from jail.');
  }

  /** Donate chips (`part` = 'chips', qty = chips) or goods from your Warehouse storage (`part` = 'type:id'). */
  donate(name: string, input: { project?: unknown; part?: unknown; qty?: unknown; nonce?: unknown }): Promise<DonResult & { replay?: true }> {
    return this.serial(async () => {
      this.gate(name);
      if (typeof input.nonce !== 'string' || !NONCE.test(input.nonce)) throw new CoopError('Bad request.');
      const k = playerKey(name); const id = `coop:${k}:${input.nonce}`;
      const prev = this.seen.get(id); if (prev) { if ('project' in prev) return { ...prev, replay: true as const }; throw new CoopError('Already applied.'); }
      const project = this.activeProject(); if (!project || input.project !== project) throw new CoopError('That project isn’t taking donations.');
      const stage = this.stagesDone(project); const need = projectStages(COOP_PLAN[project])[stage]!; const row = this.done[project][stage]!;
      const part = String(input.part ?? ''); const q = Number(input.qty);
      if (!Number.isInteger(q) || q < 1) throw new CoopError('Pick an amount.');
      const g = part === 'chips' ? null : need.goods.find((x) => partKey(x) === part);
      if (part !== 'chips' && !g) throw new CoopError(`${need.name} doesn’t need that.`);
      const left = (g ? g.qty : need.chips) - (row[part] ?? 0); if (left <= 0) throw new CoopError('That part of this stage is already full.');
      const qty = Math.min(q, left); const value = g ? qty * g.price : qty;
      if (value < Math.min(MIN_DONATION_VALUE, g ? g.price * left : left)) throw new CoopError(`Donate at least 🪙 ${MIN_DONATION_VALUE} worth.`);
      const donor = this.donors[project].get(k); const reward = donorReward(value, donor?.rewarded ?? 0);
      const P = COOP_PLAN[project]; const what = g ? `${qty.toLocaleString('en-US')} ${g.name}` : `🪙 ${qty.toLocaleString('en-US')}`;
      const res: DonResult = { id, project, stage, part, qty, value, reward };
      const rowStmt: Stmt = { sql: 'INSERT INTO coop_donations (id, project, stage, player_key, name, part, qty, value, reward, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', args: [id, project, stage, k, name.trim(), part, qty, value, reward, this.clock()] };
      const bank = getBank(); if (this.pool) await bank.refresh(name);
      const moves = [
        ...(g ? [] : [{ name, amount: -qty, key: `coop_don:${id}`, game: 'coop', memo: `${P.icon} ${P.name}: donated ${what} (${need.name})` }]),
        ...(reward > 0 ? [{ name, amount: reward, key: `coop_rwd:${id}`, game: 'coop', memo: `${P.icon} ${P.name}: donor reward` }] : []),
      ];
      if (!g && !bank.canAfford(name, qty)) throw new CoopError('Not enough chips.');
      let w: ReturnType<typeof bank.transferAtomic> | null;
      try { w = moves.length ? bank.transferAtomic(moves) : null; } catch (e) { throw new CoopError(/Already/.test((e as Error).message) ? 'Already applied.' : 'Not enough chips.'); }
      if (!g) {
        const p = (async () => { await w?.after; if (!this.pool) return; await this.tx([...(w?.stmts ?? []), rowStmt]); })(); w?.bind(p);
        try { await p; } catch (e) { w?.revert(); throw new CoopError(/duplicate|unique|Already/i.test((e as Error).message) ? 'Already applied.' : /chips|balance|null value/i.test((e as Error).message) ? 'Not enough chips.' : 'That didn’t go through. Nothing was taken.'); }
      } else {
        // Goods leave your Warehouse storage; the donation row (+ reward credit) commit in the same pack transaction.
        // Truck logistics: co-op goods come only from stock AT the Chud City Warehouse (loc_stock 'warehouse').
        const r = getLocStore().adjust(name, [{ loc: WAREHOUSE, item: `${g.type}:${g.id}`, delta: -qty }], [{ sql: rowStmt.sql.replace(/\)$/, ') ON CONFLICT (id) DO NOTHING'), args: rowStmt.args }, ...(w?.stmts ?? [])], { after: w?.after,
          marker: { sql: 'SELECT 1 FROM coop_donations WHERE id = $1', args: [id] }, // lost-ack reconcile: the donation row exists iff it committed
          onLate: (ok) => { if (ok) { w?.confirm(); this.applyDonation(res, k, name.trim(), this.clock()); this.onChange?.(); } else w?.revert(); } });
        if (r === false) { w?.revert(); throw new CoopError(`You don’t have ${qty.toLocaleString('en-US')} ${g.name} at the Chud City Warehouse. Move it there from your factory (instant) or ship it from the resort.`); }
        w?.bind(r);
        try { await r; } catch (e) { if (isOutcomeUnknown(e)) throw new CoopError('Still confirming that donation. Nothing will be taken twice; check again in a minute.'); w?.revert(); throw new CoopError('That didn’t go through. Nothing was taken.'); }
      }
      this.applyDonation(res, k, name.trim(), this.clock()); this.onChange?.();
      return res;
    });
  }

  private async tx(rows: Stmt[]): Promise<void> {
    if (!this.pool) return; const cl = await this.pool.connect();
    try { await cl.query('BEGIN'); for (const s of rows) await cl.query(s.sql, s.args); await cl.query('COMMIT'); }
    catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
  }

  projectView(id: ProjectId, viewer?: string | null): ProjectView {
    const P = COOP_PLAN[id]; const st = projectStages(P); const doneN = this.stagesDone(id); const active = this.activeProject();
    const total = st.reduce((a, s) => a + stageValue(s), 0);
    const got = st.reduce((a, s, i) => a + stagePct(s, this.done[id][i]!) * stageValue(s), 0);
    void viewer;
    return {
      id, name: P.name, icon: P.icon, total: P.total, perk: P.perk, state: doneN >= st.length ? 'complete' : active === id ? 'active' : 'locked', stage: doneN, pct: total ? got / total : 0,
      stages: st.map((s: StageNeed, i) => ({ ...s, done: { ...this.done[id][i]! }, pct: stagePct(s, this.done[id][i]!) })),
      top: [...this.donors[id].values()].sort((a, b) => b.value - a.value).slice(0, 10).map((d) => ({ name: d.name, value: d.value })),
    };
  }
  view(viewer?: string | null): CoopView {
    const active = this.activeProject(); const me = viewer && active ? this.donors[active].get(playerKey(viewer)) : undefined;
    return { projects: PROJECT_ORDER.map((id) => this.projectView(id, viewer)), active, perks: { stadium: this.perk('stadium'), bridge: this.perk('bridge') },
      ...(viewer && active ? { me: { value: me?.value ?? 0, rewarded: me?.rewarded ?? 0, cap: DONOR_REWARD_CAP } } : {}),
      ...(viewer ? { sellBonus: this.sellBonus(viewer), stadiumDonated: this.stadiumDonated(viewer), stadiumRecent: this.stadiumRecent(viewer) } : {}) };
  }

  // ------------------------------------------------------------ group contracts
  private contract(id: string): Contract | null {
    const m = /^c(-?\d+)$/.exec(id); if (!m) return null; const c = this.contracts.get(id); if (c) return c;
    const s = contractAt(Number(m[1])); const n: Contract = { ...s, delivered: 0, filledAt: null, by: new Map(), claimed: new Set() }; this.contracts.set(id, n); return n;
  }
  private applyDelivery(id: string, cid: string, k: string, name: string, qty: number, at: number) {
    const c = this.contract(cid); if (!c) return; this.seen.set(id, { id, contract: cid, qty });
    c.delivered += qty; const b = c.by.get(k) ?? { name, qty: 0 }; b.qty += qty; c.by.set(k, b); if (c.filledAt == null && c.delivered >= c.qty) c.filledAt = at;
  }
  current(): Contract { return this.contract(`c${contractIndex(this.clock())}`)!; }

  private async eligible(name: string) {
    this.gate(name); if (this.allowQa && isQaName(name)) return;
    let a: AccountInfo; try { a = await this.accountInfo(name); } catch { throw new CoopError('Can’t check your account right now.'); }
    if (!(a.ageMs >= CONTRACT_MIN_AGE_MS)) throw new CoopError('Contracts need an account at least 3 days old.');
    if (!(a.playMs >= CONTRACT_MIN_PLAY_MS)) throw new CoopError('Contracts need at least 2 hours of play time.');
  }

  /** Deliver part of the current order from your Chud City Warehouse storage (a warehouse truck hauls it to the yard). */
  deliver(name: string, input: { contract?: unknown; qty?: unknown; nonce?: unknown }): Promise<{ id: string; contract: string; qty: number; replay?: true }> {
    return this.serial(async () => {
      if (typeof input.nonce !== 'string' || !NONCE.test(input.nonce)) throw new CoopError('Bad request.');
      const k = playerKey(name); const id = `coop:${k}:${input.nonce}`;
      const prev = this.seen.get(id); if (prev) { if ('contract' in prev) return { ...prev, replay: true as const }; throw new CoopError('Already applied.'); }
      await this.eligible(name);
      const c = this.current(); if (input.contract !== c.id) throw new CoopError('That contract has closed.');
      const now = this.clock(); if (now >= c.deadline) throw new CoopError('That contract has closed.');
      const q = Number(input.qty); if (!Number.isInteger(q) || q < 1) throw new CoopError('Pick an amount.');
      const mine = c.by.get(k)?.qty ?? 0; const capLeft = playerCap(c) - mine; if (capLeft <= 0) throw new CoopError('You’ve hit your share of this order.');
      const left = c.qty - c.delivered; if (left <= 0) throw new CoopError('This order is already filled.');
      const qty = Math.min(q, capLeft, left); const g = GOODS[c.item]!;
      const rowStmt: Stmt = { sql: 'INSERT INTO coop_deliveries (id, contract, player_key, name, item, qty, at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING', args: [id, c.id, k, name.trim(), c.item, qty, now] };
      const r = getLocStore().adjust(name, [{ loc: WAREHOUSE, item: `${g.type}:${g.id}`, delta: -qty }], [rowStmt], {
        marker: { sql: 'SELECT 1 FROM coop_deliveries WHERE id = $1', args: [id] }, onLate: (ok) => { if (ok) { this.applyDelivery(id, c.id, k, name.trim(), qty, now); this.onChange?.(); } } });
      if (r === false) throw new CoopError(`You don’t have ${qty.toLocaleString('en-US')} ${nameOf(g)} at the Chud City Warehouse. Move it there from your factory (instant) or ship it from the resort.`);
      try { await r; } catch (e) { if (isOutcomeUnknown(e)) throw new CoopError('Still confirming that delivery. Nothing will be taken twice; check again in a minute.'); throw new CoopError('That didn’t go through. Nothing was taken.'); }
      this.applyDelivery(id, c.id, k, name.trim(), qty, now); this.onChange?.();
      return { id, contract: c.id, qty };
    });
  }

  /** Claim your pay for a contract: once it's filled, or after its deadline (no completion bonus if it wasn't filled). */
  claim(name: string, cid: unknown): Promise<{ total: number; bonus: number; chips: number | null }> {
    return this.serial(async () => {
      this.gate(name);
      const c = typeof cid === 'string' ? this.contract(cid) : null; if (!c) throw new CoopError('No such contract.');
      const now = this.clock(); const k = playerKey(name);
      if (c.filledAt == null && now < c.deadline) throw new CoopError('Pay opens when the order is filled or the deadline passes.');
      if (now > c.deadline + CONTRACT_CLAIM_MS) throw new CoopError('That contract’s claim window has closed.');
      if (c.claimed.has(k)) throw new CoopError('Already claimed.');
      const mine = c.by.get(k)?.qty ?? 0; if (!mine) throw new CoopError('You didn’t deliver to this order.');
      const pay = contractPay(c, mine, c.filledAt != null && c.filledAt <= c.deadline);
      const bank = getBank(); if (this.pool) await bank.refresh(name);
      let w: ReturnType<typeof bank.transferAtomic>;
      try { w = bank.transferAtomic([{ name, amount: pay.total, key: `coop_claim:${c.id}:${k}`, game: 'coop', memo: `📋 Contract ${c.id}: ${mine.toLocaleString('en-US')} ${nameOf({ type: c.type as never, id: c.item })} delivered${pay.bonus ? ' + completion bonus' : ''}` }]); }
      catch (e) { if (/Already/.test((e as Error).message)) { c.claimed.add(k); throw new CoopError('Already claimed.'); } throw e; }
      const p = (async () => { await w.after; await this.tx([{ sql: 'INSERT INTO coop_claims (contract, player_key, amount, bonus, at) VALUES ($1,$2,$3,$4,$5)', args: [c.id, k, pay.total, pay.bonus, now] }, ...w.stmts]); })(); w.bind(p);
      try { await p; } catch (e) { w.revert(); throw new CoopError(/duplicate|unique|Already/i.test((e as Error).message) ? 'Already claimed.' : 'That didn’t go through. Try again.'); }
      c.claimed.add(k); this.onChange?.();
      return { total: pay.total, bonus: pay.bonus, chips: bank.ready ? bank.account(name).chips : null };
    });
  }

  contractView(c: Contract, viewer?: string | null): ContractView {
    const k = viewer ? playerKey(viewer) : ''; const mine = c.by.get(k)?.qty ?? 0; const filled = c.filledAt != null; const now = this.clock();
    const open = filled || now >= c.deadline;
    return { id: c.id, item: c.item, type: c.type as ContractView['type'], name: GOODS[c.item]?.name ?? c.item, qty: c.qty, delivered: c.delivered, start: c.start, deadline: c.deadline, filled, myDelivered: mine, myCap: playerCap(c),
      top: [...c.by.values()].sort((a, b) => b.qty - a.qty).slice(0, 8).map((x) => ({ name: x.name, qty: x.qty })),
      ...(mine && open ? { claimable: { ...contractPay(c, mine, filled && (c.filledAt ?? 0) <= c.deadline), claimed: c.claimed.has(k) } } : {}) };
  }
  /** DEV/QA screenshots only (no database + COOP_ALLOW_QA=1): fill the active project to `pct` of its total, no wallet moves. */
  devFill(project: ProjectId, pct: number, donors: Array<[string, number]> = []): void {
    if (this.pool || !this.allowQa) throw new CoopError('Not available.');
    const st = projectStages(COOP_PLAN[project]); const tgt = Math.max(0, Math.min(1, pct)) * st.length;
    st.forEach((s, i) => { const f = Math.max(0, Math.min(1, tgt - i)); const row: Record<string, number> = { chips: Math.floor(s.chips * f) }; for (const g of s.goods) row[partKey(g)] = Math.floor(g.qty * f); this.done[project][i] = row; });
    for (const [name, value] of donors) { const k = playerKey(name); const cur = this.donors[project].get(k) ?? { name, value: 0, rewarded: 0 }; cur.value += value; this.donors[project].set(k, cur); }
    this.onChange?.();
  }
  contractsView(viewer?: string | null) {
    const cur = this.current(); const now = this.clock();
    const past = [...this.contracts.values()].filter((c) => c.id !== cur.id && c.deadline <= now && now <= c.deadline + CONTRACT_CLAIM_MS && viewer && c.by.has(playerKey(viewer))).sort((a, b) => b.deadline - a.deadline).slice(0, 5);
    return { current: this.contractView(cur, viewer), past: past.map((c) => this.contractView(c, viewer)) };
  }
}

let coop = new Coop(null);
export const getCoop = () => coop;
export function resetCoop(c?: Coop): Coop { coop = c ?? new Coop(null); return coop; }
setCoopPerkHooks((id) => coop.perk(id), (name) => 1 + coop.sellBonus(name));
export { coopPerk, sellCapMul } from './coop-perks.js';

export async function initCoop(): Promise<void> {
  const url = databaseUrl();
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
    pool.on('error', (e) => console.error('[coop] pool error:', e.message));
    try { const c = new Coop(pool as unknown as PoolLike); await c.init(); coop = c; console.log('[coop] ready'); } catch (e) { console.error('[coop] init failed:', (e as Error).message); }
  } else coop.allowQa = process.env.COOP_ALLOW_QA === '1';
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
let wiredIo: Server | null = null;
export function registerCoop(io: Server, socket: Socket): void {
  if (wiredIo !== io) { wiredIo = io; coop.onChange = () => io.emit('coop_changed'); }
  const nameOf_ = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const need = () => { const n = nameOf_(); if (!n) throw new CoopError('Sign in first.'); return n; };
  const on = (ev: string, fn: (b: Record<string, unknown>) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try { const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; ack?.({ ok: true, ...((await fn(b)) as object ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof CoopError || /^Not enough chips\./.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); if (!(e instanceof CoopError)) console.error(`[coop] ${ev} failed:`, (e as Error).message); }
  });
  const have = (n: string | null) => { if (!n) return {}; const out: Record<string, number> = {}; const ls = getLocStore(); // Warehouse stock only (co-op source)
    for (const id of PROJECT_ORDER) for (const s of projectStages(COOP_PLAN[id])) for (const g of s.goods) out[partKey(g)] = ls.qty(n, WAREHOUSE, `${g.type}:${g.id}`);
    const c = coop.current(); out[`${c.type}:${c.item}`] = ls.qty(n, WAREHOUSE, `${c.type}:${c.item}`); return out; };
  const chips = (n: string | null) => (n && getBank().ready ? getBank().account(n).chips : null);
  on('coop_view', async () => ({ ...coop.view(nameOf_()), contracts: coop.contractsView(nameOf_()), have: have(nameOf_()), chips: chips(nameOf_()) }));
  on('coop_donate', async (b) => { const n = need(); const r = await coop.donate(n, b); return { result: r, ...coop.view(n), contracts: coop.contractsView(n), have: have(n), chips: chips(n) }; });
  on('coop_deliver', async (b) => { const n = need(); const r = await coop.deliver(n, b); return { result: r, ...coop.view(n), contracts: coop.contractsView(n), have: have(n), chips: chips(n) }; });
  if (coop.allowQa && !databaseUrl()) { // local screenshots only; never registered with a database
    on('coop_dev_fill', async (b) => { coop.devFill(b.project === 'bridge' ? 'bridge' : 'stadium', Number(b.pct) || 0, Array.isArray(b.donors) ? (b.donors as Array<[string, number]>) : []); return {}; });
    on('coop_dev_stock', async (b) => { const n = need(); const c = coop.current(); await getLocStore().adjust(n, [{ loc: WAREHOUSE, item: `${c.type}:${c.item}`, delta: Math.min(100_000, Number(b.qty) || 0) }]); return {}; });
    on('coop_dev_deliver', async (b) => { const c = coop.current(); const ppl = Array.isArray(b.names) ? (b.names as string[]) : []; for (const x of ppl) { await getLocStore().adjust(x, [{ loc: WAREHOUSE, item: `${c.type}:${c.item}`, delta: playerCap(c) }]); await coop.deliver(x, { contract: c.id, qty: Math.floor(playerCap(c) * (Number(b.frac) || 0.5)), nonce: `devdeliver${Math.random().toString(36).slice(2, 10)}` }); } return {}; });
  }
  on('coop_claim', async (b) => { const n = need(); const r = await coop.claim(n, b.contract); return { result: r, ...coop.view(n), contracts: coop.contractsView(n), have: have(n), chips: chips(n) }; });
}

/** Public map summary for the stadium site / bridge (GET /api/coop). */
export function coopMapSummary() {
  return PROJECT_ORDER.map((id) => { const v = coop.projectView(id); return { id, name: v.name, icon: v.icon, state: v.state, stage: v.stage, pct: v.pct }; });
}
