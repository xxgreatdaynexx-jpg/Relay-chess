/** Monument royalties (shared/royalty.ts): mint a cut of other players' earnings at a landmark to its owner. */
import { randomUUID } from 'node:crypto';
import { getBank, type CasinoBank } from './casino-store.js';
import { getRealEstate } from './realEstate.js';
import { LANDMARK_LABEL } from '../shared/realEstate.js';
import { royaltyRate, royaltyPct, ROYALTY_VENUE, HOUSE_GAMES } from '../shared/royalty.js';

type Owner = { key: string; name: string };
const keyOf = (n: string) => n.trim().toLowerCase();

export class Royalties {
  /** Fraction of a chip owed per (landmark, owner); a new owner starts fresh. Casino: running house net (can be < 0). */
  private carry = new Map<string, number>();
  private cache = new Map<string, { o: Owner | null; at: number }>();
  constructor(private readonly owner: (propId: string) => Promise<Owner | null> = async (id) => (await getRealEstate()?.ownerOf(id)) ?? null,
    private readonly bank: () => CasinoBank = getBank, private readonly clock = () => Date.now()) {}
  async ownerOf(lm: string): Promise<Owner | null> {
    const c = this.cache.get(lm); if (c && this.clock() - c.at < 15_000) return c.o;
    let o: Owner | null = null; try { o = await this.owner(`lm:${lm}`); } catch { o = c?.o ?? null; }
    this.cache.set(lm, { o, at: this.clock() }); return o;
  }
  /** Ownership changed: drop the cache so the next earning sees the new owner. */
  forget(lm?: string) { if (lm) this.cache.delete(lm); else this.cache.clear(); }
  /** `earner` earned `base` chips at landmark `lm`. Pays the owner (never the earner themself). Returns chips paid. */
  async earn(lm: string, earner: string | null | undefined, base: number): Promise<number> {
    if (!earner || !(base > 0) || !ROYALTY_VENUE[lm]) return 0;
    const o = await this.ownerOf(lm); if (!o || o.key === keyOf(earner)) return 0;
    return this.accrue(lm, o, base * royaltyRate(lm), `Royalty ${royaltyPct(lm)}: ${earner.trim()} earned 🪙 ${Math.floor(base).toLocaleString('en-US')} at the ${LANDMARK_LABEL[lm] ?? lm}`);
  }
  private accrue(lm: string, o: Owner, owed: number, memo: string): number {
    const k = `${lm}|${o.key}`; const c = (this.carry.get(k) ?? 0) + owed; const pay = Math.floor(c);
    this.carry.set(k, c - Math.max(0, pay)); if (pay < 1) return 0;
    try { this.bank().transfer(o.name, pay, { key: `royalty:${lm}:${randomUUID()}`, game: 'monument_royalty', memo: memo.slice(0, 200) }); return pay; }
    catch (e) { console.error('[royalty] pay failed:', (e as Error).message); this.carry.set(k, c); return 0; }
  }
  /** Casino: one house-game wallet move by `player` (amount from the player's side). The house net is -amount. */
  async house(player: string, amount: number): Promise<number> {
    const lm = 'casino'; const o = await this.ownerOf(lm); if (!o || o.key === keyOf(player) || !amount) return 0;
    const k = `${lm}|${o.key}`; const net = (this.carry.get(k) ?? 0) + -amount * royaltyRate(lm);
    if (net < 1) { this.carry.set(k, net); return 0; }
    this.carry.set(k, net);
    return this.accrue(lm, o, 0, `Royalty ${royaltyPct(lm)} of the Casino house net win`);
  }
}

let roy = new Royalties();
export const getRoyalties = () => roy;
export const setRoyaltiesForTest = (r: Royalties) => { roy = r; };
/** Fire-and-forget helper for earning sites. */
export const royaltyEarn = (lm: string, earner: string | null | undefined, base: number) => { void roy.earn(lm, earner, base).catch(() => {}); };
let unhook: (() => void) | null = null;
/** Wire the casino house-net listener on the live bank. */
export function initRoyalties(): void {
  unhook?.(); unhook = getBank().onChange((a, tx) => { if (HOUSE_GAMES.has(tx.game) && tx.amount) void roy.house(a.name, tx.amount).catch(() => {}); });
}
