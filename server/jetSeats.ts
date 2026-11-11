/**
 * Jet passenger seats (shared/jetSeats.ts). In memory: a boarding lives only minutes and its money moves through keyed
 * (idempotent) wallet transfers, so a retry/double-click never charges twice.
 * Race safety: every check-and-change below is synchronous between awaits (one Node event loop), so two requests can
 * never both take the last seat, and one player can hold at most one pending request or seat across all boardings.
 */
import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { getBank } from './casino-store.js';
import { px } from './price-index.js';
import { getFleet } from './fleet.js';
import { getTravel } from './travel.js';
import { isJailed } from './jail.js';
import { isBotName } from './bots.js';
import { roomOf } from './wallet-sockets.js';
import { isQaName } from '../shared/qa.js';
import { fleetModel } from '../shared/fleet.js';
import { BOARDING_TTL_MS, MAX_SEAT_PRICE, SEAT_REQUEST_TTL_MS, jetSeats, type BoardingView } from '../shared/jetSeats.js';
import { isDestination, type Location } from '../shared/resort.js';

export class SeatError extends Error {}
const keyOf = (n: string) => n.trim().toLowerCase();
/** QA accounts and bots are kept out of seat sharing. Tests (and the dev shot server) can swap this. */
let excluded: (name: string) => boolean = (n) => isQaName(n) || isBotName(n);
export function setSeatExclusion(fn: ((name: string) => boolean) | null) { excluded = fn ?? ((n) => isQaName(n) || isBotName(n)); }
if (process.env.NODE_ENV !== 'production' && process.env.JET_SEATS_ALLOW_QA === '1') excluded = (n) => isBotName(n);

interface Req { name: string; at: number; seq: number }
interface Seat { name: string; paid: number; key: string }
type JetLoc = Exclude<Location, 'voyage'>;
interface Boarding { id: string; owner: string; model: string; jet: string; from: JetLoc; to: JetLoc; seats: number; price: number; openedAt: number; reqs: Map<string, Req>; seated: Map<string, Seat>; holding: Set<string> }

export class JetSeats {
  onChange?: (b: BoardingView | null, event: string, who?: string[]) => void;
  private boards = new Map<string, Boarding>();
  /** player key -> boarding id for every pending request or seat (the double-boarding guard). */
  private inUse = new Map<string, string>();
  /** one ledger key per request, so re-joining after a refund is charged again but a retry never is */
  private seq = 0;
  constructor(private readonly clock = () => Date.now()) {}

  private view(b: Boarding): BoardingView {
    return { id: b.id, owner: b.owner, jet: b.jet, model: b.model, from: b.from, to: b.to, seats: b.seats, price: b.price, openedAt: b.openedAt, expiresAt: b.openedAt + BOARDING_TTL_MS,
      seated: [...b.seated.values()].map((s) => s.name), pending: [...b.reqs.values()].map((r) => ({ name: r.name, at: r.at, expiresAt: r.at + SEAT_REQUEST_TTL_MS })) };
  }
  private ofOwner(owner: string) { const k = keyOf(owner); return [...this.boards.values()].find((b) => keyOf(b.owner) === k); }
  /** Drop expired requests and boardings (refunding seats). Called before every operation and by the ticker. */
  sweep() {
    const now = this.clock();
    for (const b of [...this.boards.values()]) {
      if (now >= b.openedAt + BOARDING_TTL_MS) { this.close(b, 'expired'); continue; }
      for (const [k, r] of [...b.reqs]) if (now >= r.at + SEAT_REQUEST_TTL_MS) { b.reqs.delete(k); this.inUse.delete(k); this.onChange?.(this.view(b), 'request_expired', [r.name]); }
    }
  }
  list(): BoardingView[] { this.sweep(); return [...this.boards.values()].map((b) => this.view(b)); }
  /** Boardings this player could request (same airport as them), plus their own. */
  visibleTo(name: string | null): BoardingView[] { const here = getTravel().where(name); return this.list().filter((b) => b.from === here || (name && keyOf(b.owner) === keyOf(name))); }

  async open(owner: string, dest: unknown, price: unknown = 0) {
    this.sweep();
    if (excluded(owner)) throw new SeatError('Seat sharing is not available on this account.');
    if (isJailed(owner)) throw new SeatError('You are in jail.');
    const from0 = getTravel().where(owner); if (from0 === 'voyage') throw new SeatError('You cannot open jet boarding at sea.'); const from: JetLoc = from0; const to: JetLoc = dest === 'city' ? 'city' : isDestination(dest) ? dest : (() => { throw new SeatError('Unknown destination.'); })();
    if (from === to) throw new SeatError('You are already there.');
    if (from !== 'city' && to !== 'city') throw new SeatError('Fly home to Chud City first.');
    if (this.ofOwner(owner)) throw new SeatError('You already have boarding open.');
    if (this.inUse.has(keyOf(owner))) throw new SeatError('You have a seat on another jet. Cancel it first.');
    const cap = px(MAX_SEAT_PRICE); const p = price === undefined || price === null || price === '' ? 0 : Number(price);
    if (!Number.isInteger(p) || p < 0) throw new SeatError('Seat price must be a whole number of chips.');
    if (p > cap) throw new SeatError(`Seat price is capped at ${cap.toLocaleString('en-US')} chips.`);
    const jets = (await getFleet()?.owned(owner, 'jet')) ?? [];
    const best = jets.map((c) => fleetModel(c.model, 'jet')).filter((m) => !!m).sort((a, b) => jetSeats(b!.id) - jetSeats(a!.id))[0];
    if (!best) throw new SeatError('You need a private jet to take passengers.');
    if (this.ofOwner(owner)) throw new SeatError('You already have boarding open.'); // re-check after the await
    const b: Boarding = { id: randomUUID(), owner: owner.trim(), model: best.id, jet: best.name, from, to, seats: jetSeats(best.id), price: p, openedAt: this.clock(), reqs: new Map(), seated: new Map(), holding: new Set() };
    this.boards.set(b.id, b); this.onChange?.(this.view(b), 'open'); return { boarding: this.view(b) };
  }

  request(name: string, boardingId: unknown) {
    this.sweep(); const k = keyOf(name);
    const b = typeof boardingId === 'string' ? this.boards.get(boardingId) : undefined; if (!b) throw new SeatError('That boarding has closed.');
    if (keyOf(b.owner) === k) throw new SeatError('It is your jet.');
    if (excluded(name)) throw new SeatError('Seat sharing is not available on this account.');
    if (isJailed(name)) throw new SeatError('You are in jail.');
    if (getTravel().where(name) !== b.from) throw new SeatError('You need to be at the same airport as the jet.');
    if (this.ofOwner(name)) throw new SeatError('You have your own boarding open.');
    const cur = this.inUse.get(k); if (cur === b.id) return { status: b.seated.has(k) ? 'seated' : 'pending', boarding: this.view(b) }; // idempotent re-request
    if (cur) throw new SeatError('You already asked for a seat on another jet.');
    if (b.seated.size + b.holding.size >= b.seats) throw new SeatError('That jet is full.');
    if (b.price > 0 && !getBank().canAfford(name, b.price)) throw new SeatError(`Not enough chips: a seat costs ${b.price.toLocaleString('en-US')}.`);
    b.reqs.set(k, { name: name.trim(), at: this.clock(), seq: ++this.seq }); this.inUse.set(k, b.id);
    this.onChange?.(this.view(b), 'request', [b.owner]); return { status: 'pending', boarding: this.view(b) };
  }

  /** Owner accepts/declines one request. Accept charges the seat price (keyed: never twice) and seats the passenger. */
  respond(owner: string, passenger: unknown, accept: unknown) {
    this.sweep(); const b = this.ofOwner(owner); if (!b) throw new SeatError('You have no boarding open.');
    if (typeof passenger !== 'string') throw new SeatError('Who?'); const k = keyOf(passenger);
    if (b.seated.has(k)) return { status: 'seated', boarding: this.view(b) }; // already accepted: idempotent
    const r = b.reqs.get(k); if (!r) throw new SeatError('That request has expired or was withdrawn.');
    b.reqs.delete(k);
    if (!accept) { this.inUse.delete(k); this.onChange?.(this.view(b), 'declined', [r.name]); return { status: 'declined', boarding: this.view(b) }; }
    if (b.seated.size >= b.seats) { this.inUse.delete(k); this.onChange?.(this.view(b), 'full', [r.name]); throw new SeatError('Every seat is taken.'); }
    if (isJailed(r.name) || getTravel().where(r.name) !== b.from) { this.inUse.delete(k); throw new SeatError(`${r.name} can no longer board.`); }
    let paid = 0;
    if (b.price > 0) {
      const bank = getBank(); const key = `jet_seat:${b.id}:${k}:${r.seq}`;
      if (!bank.hasKey(`${key}:pay`)) {
        try { bank.transfer(r.name, -b.price, { key: `${key}:pay`, game: 'jet_seat', memo: `Seat on ${b.owner}'s ${b.jet}` }); }
        catch { this.inUse.delete(k); this.onChange?.(this.view(b), 'declined', [r.name]); throw new SeatError(`${r.name} cannot afford the seat.`); }
        bank.transfer(b.owner, b.price, { key: `${key}:earn`, game: 'jet_seat', memo: `Seat fare from ${r.name}` });
      }
      paid = b.price;
    }
    b.seated.set(k, { name: r.name, paid, key: `jet_seat:${b.id}:${k}:${r.seq}` }); this.onChange?.(this.view(b), 'accepted', [r.name]); return { status: 'seated', boarding: this.view(b) };
  }

  /** Passenger withdraws a request or gives up a seat (refunded). */
  leave(name: string) {
    const k = keyOf(name); const id = this.inUse.get(k); const b = id ? this.boards.get(id) : undefined; if (!b) { this.inUse.delete(k); return { left: false }; }
    b.reqs.delete(k); const s = b.seated.get(k); if (s) { b.seated.delete(k); this.refund(b, s); }
    this.inUse.delete(k); this.onChange?.(this.view(b), 'left', [b.owner]); return { left: true };
  }
  private refund(b: Boarding, s: Seat) {
    if (!s.paid) return; const bank = getBank(); const key = s.key;
    if (bank.hasKey(`${key}:refund`)) return;
    // the owner returns the fare; if they already spent it, the house covers it so the passenger is always made whole
    try { bank.transfer(b.owner, -s.paid, { key: `${key}:refund_owner`, game: 'jet_seat', memo: `Seat refund to ${s.name}` }); } catch { /* owner short: covered below */ }
    bank.transfer(s.name, s.paid, { key: `${key}:refund`, game: 'jet_seat', memo: `Seat refund: ${b.owner}'s ${b.jet}` });
  }
  private close(b: Boarding, why: string) {
    if (!this.boards.delete(b.id)) return;
    for (const s of b.seated.values()) this.refund(b, s);
    const who = [...b.seated.values(), ...b.reqs.values()].map((x) => x.name);
    for (const n of who) this.inUse.delete(keyOf(n));
    this.onChange?.({ ...this.view(b), seated: [], pending: [] }, why === 'expired' ? 'expired' : 'cancelled', who);
  }
  cancel(owner: string) { const b = this.ofOwner(owner); if (!b) throw new SeatError('You have no boarding open.'); this.close(b, 'cancelled'); return { cancelled: true }; }

  /** Owner takes off: owner and every seated passenger arrive together. A passenger who wandered off or got jailed is refunded and stays. */
  async depart(owner: string) {
    this.sweep(); const b = this.ofOwner(owner); if (!b) throw new SeatError('You have no boarding open.');
    if (isJailed(owner)) throw new SeatError('You are in jail.');
    if (getTravel().where(owner) !== b.from) { this.close(b, 'cancelled'); throw new SeatError('You left the airport. Boarding closed and seats were refunded.'); }
    this.boards.delete(b.id); // nobody can join or be accepted from here on
    const t = getTravel();
    try { if (b.to === 'city') await t.home(owner); else await t.fly(owner, b.to); }
    catch (e) { this.boards.set(b.id, b); throw e; }
    const flew: string[] = []; const stayed: string[] = [];
    for (const s of b.seated.values()) {
      const k = keyOf(s.name); this.inUse.delete(k);
      if (isJailed(s.name) || t.where(s.name) !== b.from) { this.refund(b, s); stayed.push(s.name); continue; }
      await t.carry(s.name, b.to); flew.push(s.name);
    }
    for (const r of b.reqs.values()) this.inUse.delete(keyOf(r.name));
    const v = { ...this.view(b), seated: flew, pending: [] };
    this.onChange?.(v, 'departed', [b.owner, ...flew, ...[...b.reqs.values()].map((r) => r.name)]);
    return { to: b.to, jet: b.jet, passengers: flew, stayed, boarding: v };
  }
  start() { const t = setInterval(() => this.sweep(), 5_000); t.unref?.(); }
}

let seats = new JetSeats();
export const getJetSeats = () => seats;
export function setJetSeats(s: JetSeats) { seats = s; }

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
let wiredIo: Server | null = null;
export function registerJetSeats(io: Server, socket: Socket): void {
  if (wiredIo !== io) {
    wiredIo = io; seats.start();
    seats.onChange = (b, event, who = []) => {
      io.emit('jet_boardings', { changed: b?.id ?? null }); // everyone re-pulls the list they can see
      for (const n of who) io.to(roomOf(n)).emit('jet_seat_event', { event, boarding: b });
    };
  }
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const need = () => { const n = nameOf(); if (!n) throw new SeatError('Sign in first.'); return n; };
  const on = (ev: string, fn: (b: Record<string, unknown>) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    if (typeof payload === 'function') { ack = payload as Ack; payload = undefined; }
    try { const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; ack?.({ ok: true, ...((await fn(b)) as object ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof SeatError || /^(Not enough chips\.|You are already at)/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); }
  });
  on('jet_board_list', () => ({ boardings: seats.visibleTo(nameOf()), me: nameOf(), cap: px(MAX_SEAT_PRICE) }));
  on('jet_board_open', (b) => seats.open(need(), b.dest, b.price));
  on('jet_board_cancel', () => seats.cancel(need()));
  on('jet_board_depart', () => seats.depart(need()));
  on('jet_seat_request', (b) => seats.request(need(), b.id));
  on('jet_seat_respond', (b) => seats.respond(need(), b.name, b.accept));
  on('jet_seat_leave', () => seats.leave(need()));
}
