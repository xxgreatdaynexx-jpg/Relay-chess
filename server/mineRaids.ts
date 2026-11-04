/**
 * Co-op mine raids: real-time parties (rules: shared/mineRaids.ts, instances: server/mines.ts).
 *  - Create a party (5-letter code), friends join with the code; up to RAID_MAX. Leader can kick; leaving the last seat disbands.
 *  - Every member in any mine is moved into the party's instance `p:<id>`: creatures scale with party size, veins are personal,
 *    kills drop loot for every member on the floor, and party bosses add a group loot roll (server/mines.ts commitRaid).
 *  - Signed-in only; QA, bot and jailed accounts are refused (QA allowed only for local screenshots, never with a remote database).
 * All state changes are synchronous (one Node tick each), so two joins can't overfill a party.
 */
import crypto from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { getMines, syncRaids } from './mines.js';
import { isJailed } from './jail.js';
import { playerKey } from './skins.js';
import { databaseUrl } from './leaderboard-store.js';
import { isQaName } from '../shared/qa.js';
import { RAID_MAX, RAID_CODE, raidBlockReason, type RaidView } from '../shared/mineRaids.js';

export class RaidError extends Error {}
interface Party { id: string; code: string; leader: string; members: Map<string, string> /* playerKey -> display name */ }

export class RaidParties {
  allowQa = false;
  jailed: (name: string) => boolean = (n) => isJailed(n);
  parties = new Map<string, Party>();
  byKey = new Map<string, string>();
  byCode = new Map<string, string>();
  onChange: ((partyIds: string[], dropped: string[]) => void) | null = null;
  private seq = 0;
  gate(name: string | null): string {
    const why = raidBlockReason(name, { qa: !!name && isQaName(name) && !this.allowQa, jailed: !!name && this.jailed(name) });
    if (why) throw new RaidError(why); return name!.trim();
  }
  partyOf(name: string | null): Party | undefined { if (!name) return undefined; const id = this.byKey.get(playerKey(name)); return id ? this.parties.get(id) : undefined; }
  inst(name: string | null): string | undefined { const p = this.partyOf(name); return p && p.members.size > 1 ? `p:${p.id}` : undefined; }
  size(inst: string): number { return this.parties.get(inst.replace(/^p:/, ''))?.members.size ?? 1; }
  private newCode(): string { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; for (;;) { const c = Array.from(crypto.randomBytes(5), (b) => A[b % A.length]).join(''); if (!this.byCode.has(c)) return c; } }
  create(nameIn: string | null): Party {
    const name = this.gate(nameIn); const k = playerKey(name);
    if (this.byKey.has(k)) throw new RaidError('You’re already in a raid party. Leave it first.');
    const p: Party = { id: `${Date.now().toString(36)}${(++this.seq).toString(36)}`, code: this.newCode(), leader: k, members: new Map([[k, name]]) };
    this.parties.set(p.id, p); this.byKey.set(k, p.id); this.byCode.set(p.code, p.id); this.onChange?.([p.id], []); return p;
  }
  join(nameIn: string | null, codeIn: unknown): Party {
    const name = this.gate(nameIn); const k = playerKey(name);
    const code = typeof codeIn === 'string' ? codeIn.trim().toUpperCase() : '';
    if (!RAID_CODE.test(code)) throw new RaidError('Enter a 5-character party code.');
    const p = this.parties.get(this.byCode.get(code) ?? ''); if (!p) throw new RaidError('No raid party with that code.');
    if (p.members.has(k)) return p; // replay: already in
    if (this.byKey.has(k)) throw new RaidError('You’re already in a raid party. Leave it first.');
    if (p.members.size >= RAID_MAX) throw new RaidError(`That party is full (${RAID_MAX} max).`);
    p.members.set(k, name); this.byKey.set(k, p.id); this.onChange?.([p.id], []); return p;
  }
  leave(name: string | null): void {
    if (!name) return; const k = playerKey(name); const p = this.partyOf(name); if (!p) return;
    p.members.delete(k); this.byKey.delete(k);
    const dropped: string[] = [];
    if (p.members.size <= 1) dropped.push(`p:${p.id}`); // a party of one plays the public mine again
    if (!p.members.size) { this.parties.delete(p.id); this.byCode.delete(p.code); }
    else if (p.leader === k) p.leader = [...p.members.keys()][0];
    this.onChange?.([p.id], dropped);
  }
  kick(leaderName: string | null, who: unknown): void {
    const p = this.partyOf(leaderName); if (!p || p.leader !== playerKey(leaderName!)) throw new RaidError('Only the party leader can remove members.');
    const k = typeof who === 'string' ? playerKey(who) : ''; const nm = p.members.get(k);
    if (!nm || k === p.leader) throw new RaidError('Pick a member to remove.');
    this.leave(nm);
  }
  view(name: string | null): RaidView | null {
    const p = this.partyOf(name); if (!p) return null; const w = getMines();
    return { id: p.id, code: p.code, leader: p.members.get(p.leader) ?? '', size: p.members.size,
      members: [...p.members].map(([k, nm]) => { const m = [...w.miners.values()].find((x) => x.account && playerKey(x.account) === k); return { name: nm, online: !!m, cave: m?.cave ?? null, floor: m?.floor ?? null }; }) };
  }
}

let raids = new RaidParties();
export const getRaids = () => raids;
export function resetRaids(r?: RaidParties) { raids = r ?? new RaidParties(); hook(); return raids; }
function hook() { const w = getMines(); w.raidOf = (a) => raids.inst(a); w.raidSize = (i) => raids.size(i); }
hook();
/** Local screenshots only: QA allowed when the database (if any) is on this machine. */
const localDb = () => { const u = databaseUrl(); return !u || /@(127\.0\.0\.1|localhost)[:/]/.test(u); };
export function initRaids() { raids.allowQa = process.env.RAIDS_ALLOW_QA === '1' && localDb(); hook(); }

type Ack = (r: Record<string, unknown>) => void;
let wiredIo: Server | null = null;
export function registerRaids(io: Server, socket: Socket): void {
  hook();
  if (wiredIo !== io) {
    wiredIo = io;
    raids.onChange = (ids, dropped) => { syncRaids(io, dropped); for (const id of ids) io.to(`raid:${id}`).emit('raid_changed'); };
  }
  const name = () => (socket.data.account as { name?: string } | undefined)?.name ?? null;
  const rejoinRoom = () => { for (const r of socket.rooms) if (r.startsWith('raid:')) void socket.leave(r); const p = raids.partyOf(name()); if (p) void socket.join(`raid:${p.id}`); };
  const on = (ev: string, fn: (b: Record<string, unknown>) => void) => socket.on(ev, (payload: unknown, ack?: Ack) => {
    try { const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; fn(b); rejoinRoom(); ack?.({ ok: true, party: raids.view(name()), max: RAID_MAX }); }
    catch (e) { ack?.({ ok: false, error: e instanceof RaidError ? e.message : 'Something went wrong.' }); if (!(e instanceof RaidError)) console.error(`[raids] ${ev} failed:`, (e as Error).message); }
  });
  on('raid_view', () => {});
  on('raid_create', () => { raids.create(name()); });
  on('raid_join', (b) => { raids.join(name(), b.code); });
  on('raid_leave', () => { raids.leave(name()); });
  on('raid_kick', (b) => { raids.kick(name(), b.name); });
  if (raids.allowQa && localDb()) { // local screenshots only: stand-in party members next to you (never with a remote database)
    on('raid_dev_buddies', (b) => {
      const p = raids.partyOf(name()); const w = getMines(); const me = w.miners.get(socket.id); if (!p || !me) throw new RaidError('Create a party and join a mine first.');
      const names = (Array.isArray(b.names) ? b.names : []).filter((x): x is string => typeof x === 'string').slice(0, 3);
      names.forEach((nm, i) => {
        const k = playerKey(nm); if (!p.members.has(k) && p.members.size < RAID_MAX) { p.members.set(k, nm); raids.byKey.set(k, p.id); }
        const id = `dev:${k}`; const m = w.miners.get(id) ?? w.join(id, nm, Date.now(), me.cave);
        Object.assign(m, { cave: me.cave, floor: me.floor, inst: raids.inst(name()), x: me.x + 1.2 + i * 0.9, y: me.y + (i % 2 ? 0.8 : -0.8), a: me.a });
      });
      raids.onChange?.([p.id], []);
    });
  }
}
