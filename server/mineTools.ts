/**
 * Mining tools shop (request #16). Ownership + equipped tool live in Postgres; chips move only through the atomic wallet
 * (CasinoBank.transferAtomic, ledger game 'mine_tool') in the same transaction as the ownership row, so a double click
 * buys once and a failed write charges nothing. MinesWorld reads the equipped tool synchronously from the in-memory
 * cache (`equippedOf`), loaded at boot and updated on every buy/equip.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Server, Socket } from 'socket.io';
import { bootAttach, setBootState } from './boot-retry.js';
import { databaseUrl } from './leaderboard-store.js';
import { getBank, type CasinoBank } from './casino-store.js';
import { px, priceIndex } from './price-index.js';
import { getMines, setMineToolHook } from './mines.js';
import { canBuyTool, DEFAULT_TOOL, isMineTool, MINE_TOOLS, toolDef, type MineToolId, type MineToolsView } from '../shared/mineTools.js';

export const MINE_TOOLS_MIGRATION = `
CREATE TABLE IF NOT EXISTS mine_tools (player_key TEXT NOT NULL, tool_id TEXT NOT NULL, price BIGINT NOT NULL, bought_at BIGINT NOT NULL, PRIMARY KEY (player_key, tool_id));
CREATE TABLE IF NOT EXISTS mine_tool_equipped (player_key TEXT PRIMARY KEY, tool_id TEXT NOT NULL);
`;
export class MineToolError extends Error {}
const keyOf = (n: string) => n.trim().toLowerCase();

export class MineTools {
  owned = new Map<string, Set<MineToolId>>();
  equipped = new Map<string, MineToolId>();
  private locks = new Map<string, Promise<unknown>>();
  constructor(private readonly pool: pg.Pool, private readonly bank: () => CasinoBank = getBank, private readonly clock = () => Date.now()) {}
  async init() {
    await this.pool.query(MINE_TOOLS_MIGRATION);
    for (const r of (await this.pool.query('SELECT player_key, tool_id FROM mine_tools')).rows as Array<{ player_key: string; tool_id: string }>) if (isMineTool(r.tool_id)) this.set(r.player_key).add(r.tool_id);
    for (const r of (await this.pool.query('SELECT player_key, tool_id FROM mine_tool_equipped')).rows as Array<{ player_key: string; tool_id: string }>) if (isMineTool(r.tool_id)) this.equipped.set(r.player_key, r.tool_id);
  }
  private set(k: string) { let s = this.owned.get(k); if (!s) { s = new Set(); this.owned.set(k, s); } return s; }
  private lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve(); const p = prev.then(fn, fn); const tail = p.catch(() => {});
    this.locks.set(id, tail); void tail.then(() => { if (this.locks.get(id) === tail) this.locks.delete(id); }); return p;
  }
  ownedOf(name: string): MineToolId[] { const s = this.owned.get(keyOf(name)); return [DEFAULT_TOOL, ...MINE_TOOLS.filter((t) => s?.has(t.id)).map((t) => t.id)]; }
  /** Equipped tool for an account (guests and unknown = starter pickaxe). Only ever returns a tool the player owns. */
  equippedOf(name: string | null): MineToolId {
    if (!name) return DEFAULT_TOOL; const k = keyOf(name); const e = this.equipped.get(k);
    return e && (e === DEFAULT_TOOL || this.owned.get(k)?.has(e)) ? e : DEFAULT_TOOL;
  }
  view(name: string | null): MineToolsView {
    return { owned: name ? this.ownedOf(name) : [DEFAULT_TOOL], equipped: this.equippedOf(name), prices: Object.fromEntries(MINE_TOOLS.map((t) => [t.id, px(t.price)])), index: priceIndex() };
  }

  async buy(name: string, id: unknown) {
    if (!isMineTool(id) || id === DEFAULT_TOOL) throw new MineToolError('Unknown tool.');
    const d = toolDef(id); const k = keyOf(name);
    return this.lock(k, async () => {
      const owned = this.ownedOf(name);
      if (owned.includes(id)) throw new MineToolError(`You already own the ${d.name}.`);
      if (!canBuyTool(owned, id)) throw new MineToolError(`Buy the ${MINE_TOOLS[d.tier - 1].name} first.`);
      const cost = px(d.price); const bank = this.bank(); await bank.refresh(name);
      if (bank.account(name).chips < cost) throw new MineToolError(`Not enough chips: the ${d.name} costs ${cost.toLocaleString('en-US')}.`);
      const w = bank.transferAtomic([{ name, amount: -cost, key: `mine_tool:${k}:${id}:${randomUUID()}`, game: 'mine_tool', memo: `Mines: bought a ${d.name}` }]);
      const run = async () => {
        await w.after; const cl = await this.pool.connect();
        try {
          await cl.query('BEGIN');
          const ins = await cl.query('INSERT INTO mine_tools (player_key, tool_id, price, bought_at) VALUES ($1,$2,$3,$4) ON CONFLICT (player_key, tool_id) DO NOTHING', [k, id, cost, this.clock()]);
          if (!ins.rowCount) throw new MineToolError(`You already own the ${d.name}. Nothing was charged.`);
          await cl.query('INSERT INTO mine_tool_equipped (player_key, tool_id) VALUES ($1,$2) ON CONFLICT (player_key) DO UPDATE SET tool_id = EXCLUDED.tool_id', [k, id]);
          for (const s of w.stmts) await cl.query(s.sql, s.args);
          await cl.query('COMMIT');
        } catch (e) { await cl.query('ROLLBACK').catch(() => {}); throw e; } finally { cl.release(); }
      };
      const p = run(); w.bind(p);
      try { await p; } catch (e) { w.revert(); if (e instanceof MineToolError) throw e; console.error('[mine-tools] buy failed:', (e as Error).message); throw new MineToolError(/chips|balance|null value/i.test((e as Error).message) ? 'Not enough chips.' : 'Something went wrong. Nothing was charged.'); }
      this.set(k).add(id); this.equipped.set(k, id);
      return { tool: id, cost, chips: bank.account(name).chips };
    });
  }

  async equip(name: string, id: unknown) {
    if (!isMineTool(id)) throw new MineToolError('Unknown tool.');
    const k = keyOf(name);
    return this.lock(k, async () => {
      if (!this.ownedOf(name).includes(id)) throw new MineToolError(`You don't own the ${toolDef(id).name}.`);
      await this.pool.query('INSERT INTO mine_tool_equipped (player_key, tool_id) VALUES ($1,$2) ON CONFLICT (player_key) DO UPDATE SET tool_id = EXCLUDED.tool_id', [k, id]);
      this.equipped.set(k, id);
      return { tool: id };
    });
  }
}

let tools: MineTools | null = null;
export const getMineTools = () => tools;
export function setMineTools(t: MineTools | null) { tools = t; setMineToolHook((a) => (tools ? tools.equippedOf(a) : DEFAULT_TOOL)); }
export async function initMineTools(): Promise<void> {
  const url = databaseUrl(); if (!url) { setBootState('mine-tools', 'memory'); return; }
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[mine-tools] pool error:', e.message));
  await bootAttach('mine-tools', async () => { try { const t = new MineTools(pool); await t.init(); setMineTools(t); console.log('[mine-tools] ready'); return true; } catch (e) { console.error('[mine-tools] init failed:', (e as Error).message); return false; } });
}

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerMineTools(_io: Server, socket: Socket): void {
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const swingMs = () => getMines().swingMsFor(nameOf());
  const on = (ev: string, fn: (b: Record<string, unknown>, t: MineTools) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try {
      if (!tools) throw new MineToolError('The tool shop is offline right now.');
      const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      const r = (await fn(b, tools)) as object | undefined;
      ack?.({ ok: true, ...(r ?? {}), tools: tools.view(nameOf()), swingMs: swingMs() });
    } catch (e) { ack?.({ ok: false, error: e instanceof MineToolError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); }
  });
  const need = () => { const n = nameOf(); if (!n) throw new MineToolError('Sign in to buy mining tools.'); return n; };
  on('mine_tools_view', () => undefined);
  on('mine_tools_buy', (b, t) => t.buy(need(), b.tool));
  on('mine_tools_equip', (b, t) => t.equip(need(), b.tool));
}
