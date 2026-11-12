/**
 * Player-to-player real-estate trades (Bill Chud 3): agreed chip price or a deed swap, within zoning caps,
 * no 30% city sell-back haircut. Purchase wealth tax is not charged (this is not a city purchase).
 */
import pg from 'pg';
import { getAccounts } from './accounts.js';
import { getBank, type CasinoBank } from './casino-store.js';
import { sendPopup } from './popups.js';
import { transferPropertyDerived } from './propertyDerived.js';
export class PropertyTradeError extends Error {}
import { otherLockMsg, selfLockMsg } from '../shared/tradeLock.js';
import { propertyById } from '../shared/realEstate.js';
import { zoneRefusal, zoneUse, zoneOf, type ZoneUse } from '../shared/zoning.js';
import { FACTORY_MONUMENT_ID, PROPERTY_TRADE_EXPIRE_MS, isFactoryPlantId, parseChipOffer, parseDeedList, type PropertyTradeOffer, type PropertyTradeStatus } from '../shared/bill3.js';

export const PROPERTY_TRADE_MIGRATION = `
CREATE TABLE IF NOT EXISTS property_trades (
  id TEXT PRIMARY KEY,
  from_key TEXT NOT NULL,
  from_name TEXT NOT NULL,
  to_key TEXT NOT NULL,
  to_name TEXT NOT NULL,
  give_ids TEXT NOT NULL,
  want_ids TEXT NOT NULL,
  give_chips BIGINT NOT NULL,
  want_chips BIGINT NOT NULL,
  status TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  closed_at BIGINT
);
CREATE INDEX IF NOT EXISTS property_trades_parties ON property_trades (from_key, to_key, status);
`;

const keyOf = (n: string) => n.trim().toLowerCase();
type Pool = { query: pg.Pool['query']; connect: pg.Pool['connect'] };

function asOffer(r: Record<string, unknown>): PropertyTradeOffer {
  return {
    id: String(r.id), fromName: String(r.from_name), toName: String(r.to_name),
    giveIds: JSON.parse(String(r.give_ids)) as string[], wantIds: JSON.parse(String(r.want_ids)) as string[],
    giveChips: Number(r.give_chips), wantChips: Number(r.want_chips),
    status: r.status as PropertyTradeStatus, createdAt: Number(r.created_at),
    ...(r.closed_at != null ? { closedAt: Number(r.closed_at) } : {}),
  };
}

export function tradeability(id: string): string | null {
  if (id === FACTORY_MONUMENT_ID) return 'The Factory monument is retired and cannot be traded.';
  const p = propertyById(id);
  if (!p) return 'Unknown property.';
  if (p.retired) return `${p.label} is retired and cannot be traded.`;
  return null;
}

/** Zone use after dropping `drop` ids, then whether `add` each fits. */
export function tradeZoneRefusal(held: Array<{ id: string }>, drop: string[], add: string[]): string | null {
  const remaining = held.filter((h) => !drop.includes(h.id));
  const props = remaining.map((h) => propertyById(h.id)).filter((x): x is NonNullable<typeof x> => !!x);
  let use: ZoneUse = zoneUse(props);
  for (const id of add) {
    const p = propertyById(id); if (!p) return 'Unknown property.';
    const why = zoneRefusal(use, p); if (why) return why;
    const z = zoneOf(p);
    if (z === 'residential' || z === 'commercial') use = { ...use, [z]: use[z] + 1 };
    else if (z === 'farmland') use = { ...use, farmlandTiles: use.farmlandTiles + (p.tiles ?? 0) };
  }
  return null;
}

export class PropertyTrades {
  onChange?: () => void;
  constructor(
    private readonly pool: Pool,
    private readonly bank: () => CasinoBank = getBank,
    private readonly clock = () => Date.now(),
    private readonly ownedOf: (name: string, cl?: { query: pg.Pool['query'] }) => Promise<Array<{ id: string; owner: string; price: number; arrears: number }>> = async () => [],
  ) {}

  async init() { for (const stmt of PROPERTY_TRADE_MIGRATION.split(';')) if (stmt.trim()) await this.pool.query(stmt); }

  async list(name: string): Promise<{ incoming: PropertyTradeOffer[]; outgoing: PropertyTradeOffer[] }> {
    await this.expire();
    const k = keyOf(name);
    const rows = (await this.pool.query(
      "SELECT * FROM property_trades WHERE status = 'pending' AND (from_key = $1 OR to_key = $1) ORDER BY created_at DESC", [k],
    )).rows as Record<string, unknown>[];
    const incoming: PropertyTradeOffer[] = [], outgoing: PropertyTradeOffer[] = [];
    for (const r of rows) (String(r.to_key) === k ? incoming : outgoing).push(asOffer(r));
    return { incoming, outgoing };
  }

  async offer(from: string, body: Record<string, unknown>): Promise<PropertyTradeOffer> {
    const to = typeof body.to === 'string' ? body.to.trim() : '';
    if (!to) throw new PropertyTradeError('Name the player to trade with.');
    if (keyOf(to) === keyOf(from)) throw new PropertyTradeError('You cannot trade with yourself.');
    const giveIds = parseDeedList(body.giveIds, 'Your side');
    const wantIds = parseDeedList(body.wantIds, 'Their side');
    const giveChips = parseChipOffer(body.giveChips);
    const wantChips = parseChipOffer(body.wantChips);
    if (!giveIds.length && !wantIds.length) throw new PropertyTradeError('A property trade must include at least one deed.');
    if (giveIds.length + wantIds.length > 8) throw new PropertyTradeError('A trade can list at most 8 deeds in total.');
    await this.assertLock(from, to);
    const now = this.clock();
    await this.expire(now);
    await this.assertOwned(from, giveIds, 'You');
    if (wantIds.length) {
      // Recipient must currently own what we ask for; re-checked at accept.
      await this.assertOwned(to, wantIds, to);
    }
    for (const id of [...giveIds, ...wantIds]) {
      const why = tradeability(id); if (why) throw new PropertyTradeError(why);
    }
    // Cap check from the recipient's point of view as if they accepted now.
    const toHeld = await this.ownedOf(to);
    const fromHeld = await this.ownedOf(from);
    const toWhy = tradeZoneRefusal(toHeld, wantIds, giveIds); if (toWhy) throw new PropertyTradeError(`They couldn't receive that: ${toWhy}`);
    const fromWhy = tradeZoneRefusal(fromHeld, giveIds, wantIds); if (fromWhy) throw new PropertyTradeError(fromWhy);
    if (giveChips && !this.bank().canAfford(from, giveChips)) throw new PropertyTradeError('Not enough chips.');
    const id = typeof body.id === 'string' && /^rt:[a-z0-9]+$/i.test(body.id) ? body.id : `rt:${now.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    // Escrow the offerer's chips so they cannot spend them twice.
    const bank = this.bank();
    const cl = await this.pool.connect();
    try {
      await cl.query('BEGIN');
      if (giveChips) {
        const key = `ptrade:escrow:${id}`;
        const w = bank.transferAtomic([{ name: from, amount: -giveChips, key, game: 'property_trade', memo: `Property trade escrow (${id})` }]);
        try {
          await w.after;
          for (const s of w.stmts) await cl.query(s.sql, s.args);
          await cl.query(
            `INSERT INTO property_trades (id, from_key, from_name, to_key, to_name, give_ids, want_ids, give_chips, want_chips, status, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10)`,
            [id, keyOf(from), from.trim(), keyOf(to), to, JSON.stringify(giveIds), JSON.stringify(wantIds), giveChips, wantChips, now],
          );
          await cl.query('COMMIT');
          w.bind(Promise.resolve());
        } catch (e) { w.revert(); await cl.query('ROLLBACK').catch(() => {}); throw e; }
      } else {
        await cl.query(
          `INSERT INTO property_trades (id, from_key, from_name, to_key, to_name, give_ids, want_ids, give_chips, want_chips, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10)`,
          [id, keyOf(from), from.trim(), keyOf(to), to, JSON.stringify(giveIds), JSON.stringify(wantIds), giveChips, wantChips, now],
        );
        await cl.query('COMMIT');
      }
    } catch (e) {
      await cl.query('ROLLBACK').catch(() => {});
      if (e instanceof PropertyTradeError) throw e;
      if (/unique|duplicate/i.test((e as Error).message)) throw new PropertyTradeError('That offer already exists.');
      throw new PropertyTradeError('Could not create the trade offer.');
    } finally { cl.release(); }
    this.onChange?.();
    void sendPopup(to, 'City Hall', `${from.trim()} offered you a property trade. Open the deed or the Real estate panel to review it.`).catch(() => {});
    const rows = (await this.pool.query('SELECT * FROM property_trades WHERE id = $1', [id])).rows;
    return asOffer(rows[0] as Record<string, unknown>);
  }

  async cancel(name: string, id: unknown): Promise<PropertyTradeOffer> {
    return this.close(name, id, 'cancelled', 'You cancelled the property trade.');
  }
  async decline(name: string, id: unknown): Promise<PropertyTradeOffer> {
    return this.close(name, id, 'declined', 'The property trade was declined.');
  }

  private async close(name: string, id: unknown, status: 'cancelled' | 'declined' | 'expired', _memo: string): Promise<PropertyTradeOffer> {
    if (typeof id !== 'string') throw new PropertyTradeError('Invalid trade.');
    const now = this.clock();
    const cl = await this.pool.connect();
    try {
      await cl.query('BEGIN');
      const r = (await cl.query("SELECT * FROM property_trades WHERE id = $1 AND status = 'pending' FOR UPDATE", [id])).rows[0] as Record<string, unknown> | undefined;
      if (!r) { await cl.query('ROLLBACK'); throw new PropertyTradeError('That offer is no longer pending.'); }
      const k = keyOf(name);
      if (status === 'cancelled' && String(r.from_key) !== k) throw new PropertyTradeError('Only the person who made the offer can cancel it.');
      if (status === 'declined' && String(r.to_key) !== k) throw new PropertyTradeError('Only the recipient can decline this offer.');
      const chips = Number(r.give_chips);
      if (chips > 0) {
        const bank = this.bank();
        const key = `ptrade:escrow-return:${id}`;
        const w = bank.transferAtomic([{ name: String(r.from_name), amount: chips, key, game: 'property_trade', memo: `Property trade ${status}: escrow returned` }]);
        try {
          await w.after;
          for (const s of w.stmts) await cl.query(s.sql, s.args);
          await cl.query("UPDATE property_trades SET status = $2, closed_at = $3 WHERE id = $1 AND status = 'pending'", [id, status, now]);
          await cl.query('COMMIT');
          w.bind(Promise.resolve());
        } catch (e) { w.revert(); await cl.query('ROLLBACK').catch(() => {}); throw e; }
      } else {
        await cl.query("UPDATE property_trades SET status = $2, closed_at = $3 WHERE id = $1 AND status = 'pending'", [id, status, now]);
        await cl.query('COMMIT');
      }
    } catch (e) {
      await cl.query('ROLLBACK').catch(() => {});
      if (e instanceof PropertyTradeError) throw e;
      throw new PropertyTradeError('Could not close the trade.');
    } finally { cl.release(); }
    this.onChange?.();
    const rows = (await this.pool.query('SELECT * FROM property_trades WHERE id = $1', [id])).rows;
    return asOffer(rows[0] as Record<string, unknown>);
  }

  async accept(name: string, id: unknown, onTransferred?: (id: string, fromKey: string, toKey: string, toName: string) => Promise<void>): Promise<PropertyTradeOffer> {
    if (typeof id !== 'string') throw new PropertyTradeError('Invalid trade.');
    await this.assertLock(name);
    const now = this.clock();
    const cl = await this.pool.connect();
    const bank = this.bank();
    try {
      await cl.query('BEGIN');
      const r = (await cl.query("SELECT * FROM property_trades WHERE id = $1 AND status = 'pending' FOR UPDATE", [id])).rows[0] as Record<string, unknown> | undefined;
      if (!r) { await cl.query('ROLLBACK'); throw new PropertyTradeError('That offer is no longer pending.'); }
      if (String(r.to_key) !== keyOf(name)) throw new PropertyTradeError('This offer is not for you.');
      if (now - Number(r.created_at) > PROPERTY_TRADE_EXPIRE_MS) {
        await cl.query('ROLLBACK');
        return this.close(String(r.from_name), id, 'expired', 'expired');
      }
      const giveIds = JSON.parse(String(r.give_ids)) as string[];
      const wantIds = JSON.parse(String(r.want_ids)) as string[];
      const giveChips = Number(r.give_chips);
      const wantChips = Number(r.want_chips);
      await this.assertOwned(String(r.from_name), giveIds, 'They', cl);
      await this.assertOwned(name, wantIds, 'You', cl);
      for (const pid of [...giveIds, ...wantIds]) { const why = tradeability(pid); if (why) throw new PropertyTradeError(why); }
      const toHeld = await this.ownedOf(name, cl);
      const fromHeld = await this.ownedOf(String(r.from_name), cl);
      const toWhy = tradeZoneRefusal(toHeld, wantIds, giveIds); if (toWhy) throw new PropertyTradeError(toWhy);
      const fromWhy = tradeZoneRefusal(fromHeld, giveIds, wantIds); if (fromWhy) throw new PropertyTradeError(fromWhy);
      if (wantChips && !bank.canAfford(name, wantChips)) throw new PropertyTradeError('Not enough chips.');
      const moves: Array<{ name: string; amount: number; key: string; game: string; memo?: string }> = [];
      if (wantChips) moves.push({ name, amount: -wantChips, key: `ptrade:pay:${id}`, game: 'property_trade', memo: `Paid for a property trade (${id})` });
      if (wantChips) moves.push({ name: String(r.from_name), amount: wantChips, key: `ptrade:recv:${id}`, game: 'property_trade', memo: `Received from a property trade (${id})` });
      // Escrow already deducted giveChips from the offerer; pay it to the recipient.
      if (giveChips) moves.push({ name, amount: giveChips, key: `ptrade:escrow-release:${id}`, game: 'property_trade', memo: `Received from a property trade (${id})` });
      const w = moves.length ? bank.transferAtomic(moves, { batch: moves.length > 1 }) : null;
      try {
        if (w) await w.after;
        if (w) for (const s of w.stmts) await cl.query(s.sql, s.args);
        for (const pid of giveIds) {
          const u = await cl.query('UPDATE properties SET owner_key = $2, owner_name = $3, price = $4, bought_at = $5, arrears = 0, city_price = COALESCE(city_price, price) WHERE id = $1 AND owner_key = $6 RETURNING id',
            [pid, keyOf(name), name.trim(), wantChips && giveIds.length === 1 ? wantChips : Number((await cl.query('SELECT price FROM properties WHERE id = $1', [pid])).rows[0]?.price ?? 0), now, String(r.from_key)]);
          if (!u.rowCount) throw new PropertyTradeError('A deed was no longer available.');
          await transferPropertyDerived(cl, pid, String(r.from_key), keyOf(name));
          await onTransferred?.(pid, String(r.from_key), keyOf(name), name.trim());
        }
        for (const pid of wantIds) {
          const u = await cl.query('UPDATE properties SET owner_key = $2, owner_name = $3, price = $4, bought_at = $5, arrears = 0, city_price = COALESCE(city_price, price) WHERE id = $1 AND owner_key = $6 RETURNING id',
            [pid, String(r.from_key), String(r.from_name), giveChips && wantIds.length === 1 ? giveChips : Number((await cl.query('SELECT price FROM properties WHERE id = $1', [pid])).rows[0]?.price ?? 0), now, keyOf(name)]);
          if (!u.rowCount) throw new PropertyTradeError('A deed was no longer available.');
          await transferPropertyDerived(cl, pid, keyOf(name), String(r.from_key));
          await onTransferred?.(pid, keyOf(name), String(r.from_key), String(r.from_name));
        }
        await cl.query("UPDATE property_trades SET status = 'accepted', closed_at = $2 WHERE id = $1 AND status = 'pending'", [id, now]);
        await cl.query('COMMIT');
        w?.bind(Promise.resolve());
      } catch (e) { w?.revert(); await cl.query('ROLLBACK').catch(() => {}); throw e; }
    } catch (e) {
      await cl.query('ROLLBACK').catch(() => {});
      if (e instanceof PropertyTradeError) throw e;
      throw new PropertyTradeError('Could not complete the trade.');
    } finally { cl.release(); }
    this.onChange?.();
    const rows = (await this.pool.query('SELECT * FROM property_trades WHERE id = $1', [id])).rows;
    const offer = asOffer(rows[0] as Record<string, unknown>);
    void sendPopup(offer.fromName, 'City Hall', `${name.trim()} accepted your property trade.`).catch(() => {});
    return offer;
  }

  private async expire(now = this.clock()) {
    const stale = (await this.pool.query("SELECT id, from_name FROM property_trades WHERE status = 'pending' AND created_at < $1", [now - PROPERTY_TRADE_EXPIRE_MS])).rows as Array<{ id: string; from_name: string }>;
    for (const r of stale) {
      try { await this.close(r.from_name, r.id, 'expired', 'expired'); } catch { /* next */ }
    }
  }

  private async assertLock(me: string, other?: string) {
    try {
      const a = getAccounts();
      if (typeof a.tradeLockMs !== 'function') return;
      const mine = await a.tradeLockMs(me);
      if (mine > 0) throw new PropertyTradeError(selfLockMsg(mine));
      if (other && keyOf(other) !== keyOf(me)) {
        const o = await a.tradeLockMs(other);
        if (o > 0) throw new PropertyTradeError(otherLockMsg(other.trim(), o));
      }
    } catch (e) {
      if (e instanceof PropertyTradeError) throw e;
      // Accounts store offline (unit tests): no new-account lock.
    }
  }

  private async assertOwned(name: string, ids: string[], who: string, cl: { query: pg.Pool['query'] } = this.pool) {
    for (const id of ids) {
      const r = (await cl.query('SELECT owner_key, arrears FROM properties WHERE id = $1', [id])).rows[0] as { owner_key: string; arrears: number } | undefined;
      if (!r || r.owner_key !== keyOf(name)) throw new PropertyTradeError(`${who} do not own ${propertyById(id)?.label ?? id}.`);
      if (Number(r.arrears) > 0) throw new PropertyTradeError(`${propertyById(id)?.label ?? id} has unpaid tax and cannot be traded.`);
    }
  }
}
