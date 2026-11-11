/**
 * Ocean voyages, yacht boarding and opt-in ship combat. In memory (trips last minutes). Chips move through
 * keyed ledger rows; the wallet is never pushed negative. Combat is opt-in only.
 */
import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { getBank } from './casino-store.js';
import { getFleet } from './fleet.js';
import { getTravel } from './travel.js';
import { px } from './price-index.js';
import { roomOf } from './wallet-sockets.js';
import { playerKey } from './skins.js';
import { fleetModel } from '../shared/fleet.js';
import {
  BOARDING_TTL_MS, COMBAT_RAKE, FLEE_DAMAGE, FIRE_MAX, FIRE_MIN, MAX_COMBAT_STAKE, MAX_YACHT_SEAT_PRICE,
  REPAIR_RATE, SEAT_REQUEST_TTL_MS, VOYAGES, canSailVoyage, crewSeats, hullHp, voyageById,
  type FightView, type VoyageId, type VoyagePhase, type VoyageView, type YachtBoardingView,
} from '../shared/voyages.js';

export class OceanError extends Error {}
const keyOf = (n: string) => n.trim().toLowerCase();

type Seat = { name: string; paid: number; key: string };
interface Boarding {
  id: string; owner: string; boat: string; boatName: string; dest: VoyageId | 'island';
  seats: number; price: number; openedAt: number; expiresAt: number;
  seated: Map<string, Seat>; pending: Map<string, { name: string; at: number }>;
}
interface Trip {
  id: string; dest: VoyageId; captain: string; boat: string; boatName: string; zone: number; fishZone: number;
  phase: VoyagePhase; startedAt: number; arrivesAt: number; crew: Map<string, string>;
}
interface Fight {
  id: string; a: string; aName: string; aBoat: string; aHp: number; aMax: number;
  b: string; bName: string; bBoat: string; bHp: number; bMax: number;
  stake: number; rake: number; toAct: string; startedAt: number;
}

export class OceanPlay {
  private boards = new Map<string, Boarding>();
  private inUse = new Map<string, string>(); // player -> boarding id
  private trips = new Map<string, Trip>();
  private onTrip = new Map<string, string>(); // player -> trip id
  private opted = new Set<string>();
  private damaged = new Map<string, number>(); // player -> repair owed (base, charged with px at pay time)
  private challenges = new Map<string, { from: string; fromName: string; stake: number; at: number }>();
  private fights = new Map<string, Fight>();
  private inFight = new Map<string, string>();
  onChange?: (kind: string, payload: unknown, who: string[]) => void;
  constructor(private readonly clock = () => Date.now()) {}

  private fleetBoat = async (name: string) => {
    const f = getFleet(); if (!f) return null;
    const owned = await f.owned(name, 'boat');
    if (!owned.length) return null;
    const best = owned.map((c) => fleetModel(c.model, 'boat')).filter(Boolean).sort((a, b) => (b!.zone ?? 0) - (a!.zone ?? 0) || b!.price - a!.price)[0];
    return best ? { model: best.id, name: best.name, zone: best.zone ?? 1, price: best.price } : null;
  };

  private tripOf(name: string): Trip | undefined { const id = this.onTrip.get(keyOf(name)); return id ? this.trips.get(id) : undefined; }
  private fightOf(name: string): Fight | undefined { const id = this.inFight.get(keyOf(name)); return id ? this.fights.get(id) : undefined; }
  isAtSea(name: string) { return !!this.tripOf(name); }
  optedIn(name: string) { return this.opted.has(keyOf(name)); }
  repairOwed(name: string) { return this.damaged.get(keyOf(name)) ?? 0; }

  sweep() {
    const now = this.clock();
    for (const b of [...this.boards.values()]) {
      for (const [k, r] of b.pending) if (now - r.at >= SEAT_REQUEST_TTL_MS) { b.pending.delete(k); this.inUse.delete(k); }
      if (now >= b.expiresAt) this.closeBoard(b, 'expired');
    }
    for (const t of [...this.trips.values()]) {
      if (t.phase === 'underway' && now >= t.arrivesAt) { t.phase = 'arrived'; this.emit('voyage', this.voyageView(t), [t.captain, ...t.crew.values()]); }
      if (t.phase === 'returning' && now >= t.arrivesAt) this.finishReturn(t);
    }
    for (const [k, c] of this.challenges) if (now - c.at > 60_000) this.challenges.delete(k);
  }

  // ---- boarding
  async openBoard(owner: string, dest: unknown, price: unknown) {
    this.sweep();
    if (this.ofOwnerBoard(owner) || this.tripOf(owner)) throw new OceanError('You already have a trip or boarding open.');
    if (this.repairOwed(owner)) throw new OceanError('Repair your hull before leaving the dock.');
    const boat = await this.fleetBoat(owner); if (!boat) throw new OceanError('You need a boat.');
    const seats = crewSeats(boat.model); if (seats < 1) throw new OceanError('That boat has no passenger seats.');
    const d = dest === 'island' ? 'island' as const : voyageById(dest)?.id;
    if (!d) throw new OceanError('Pick a destination.');
    if (d !== 'island' && !canSailVoyage(boat.zone, d)) throw new OceanError('Your boat cannot reach that voyage.');
    if (d === 'island' && boat.model !== 'megayacht') throw new OceanError('The private island is reached by Sovereign Megayacht.');
    const amt = Math.floor(Number(price) || 0);
    if (!Number.isInteger(amt) || amt < 0 || amt > px(MAX_YACHT_SEAT_PRICE)) throw new OceanError(`Seat price is 0–${px(MAX_YACHT_SEAT_PRICE).toLocaleString('en-US')}.`);
    const now = this.clock();
    const b: Boarding = { id: randomUUID(), owner: owner.trim(), boat: boat.model, boatName: boat.name, dest: d, seats, price: amt, openedAt: now, expiresAt: now + BOARDING_TTL_MS, seated: new Map(), pending: new Map() };
    this.boards.set(b.id, b); this.emit('board', this.boardView(b), [b.owner]);
    return { boarding: this.boardView(b) };
  }
  private ofOwnerBoard(owner: string) { const k = keyOf(owner); return [...this.boards.values()].find((b) => keyOf(b.owner) === k); }
  requestSeat(name: string, boardingId: unknown) {
    this.sweep();
    const b = typeof boardingId === 'string' ? this.boards.get(boardingId) : undefined; if (!b) throw new OceanError('That boarding has closed.');
    if (keyOf(name) === keyOf(b.owner)) throw new OceanError('You are the captain.');
    if (this.tripOf(name) || this.ofOwnerBoard(name)) throw new OceanError('You already have a trip or boarding.');
    const k = keyOf(name); const cur = this.inUse.get(k);
    if (cur === b.id) return { status: b.seated.has(k) ? 'seated' : 'pending', boarding: this.boardView(b) };
    if (cur) throw new OceanError('You already have a seat or request.');
    if (getTravel().where(name) !== getTravel().where(b.owner)) throw new OceanError('You need to be in the same place as the captain.');
    b.pending.set(k, { name: name.trim(), at: this.clock() }); this.inUse.set(k, b.id);
    this.emit('board', this.boardView(b), [b.owner]); return { status: 'pending', boarding: this.boardView(b) };
  }
  async respondSeat(owner: string, who: unknown, accept: unknown) {
    this.sweep();
    const b = this.ofOwnerBoard(owner); if (!b) throw new OceanError('You have no boarding open.');
    if (typeof who !== 'string') throw new OceanError('Pick a passenger.');
    const k = keyOf(who); const r = b.pending.get(k); if (!r) throw new OceanError('No request from that player.');
    b.pending.delete(k);
    if (!accept) { this.inUse.delete(k); this.emit('board', this.boardView(b), [r.name]); return { status: 'declined', boarding: this.boardView(b) }; }
    if (b.seated.size >= b.seats) throw new OceanError('The boat is full.');
    if (getTravel().where(r.name) !== getTravel().where(b.owner)) { this.inUse.delete(k); throw new OceanError(`${r.name} can no longer board.`); }
    let paid = 0;
    if (b.price > 0) {
      const bank = getBank(); if (!bank.canAfford(r.name, b.price)) { this.inUse.delete(k); throw new OceanError('They cannot afford the seat.'); }
      const bid = randomUUID();
      const w = bank.transferAtomic([
        { name: r.name, amount: -b.price, key: `yacht_seat:${b.id}:${k}:${bid}`, game: 'yacht_seat', memo: `Yacht seat: ${b.boatName}` },
        { name: b.owner, amount: b.price, key: `yacht_seat_fare:${b.id}:${k}:${bid}`, game: 'yacht_seat', memo: `Yacht fare from ${r.name}` },
      ]);
      try { await w.after; } catch { this.inUse.delete(k); throw new OceanError('They cannot afford the seat.'); }
      paid = b.price;
    }
    b.seated.set(k, { name: r.name, paid, key: `yacht_seat:${b.id}:${k}` });
    this.inUse.set(k, b.id);
    this.emit('board', this.boardView(b), [r.name]); return { status: 'seated', boarding: this.boardView(b) };
  }
  cancelBoard(owner: string) { const b = this.ofOwnerBoard(owner); if (!b) throw new OceanError('You have no boarding open.'); this.closeBoard(b, 'cancelled'); return { cancelled: true }; }
  leaveBoard(name: string) {
    const k = keyOf(name); const id = this.inUse.get(k); const b = id ? this.boards.get(id) : undefined;
    if (!b) { this.inUse.delete(k); return { left: false }; }
    const seat = b.seated.get(k);
    if (seat?.paid) getBank().transferAtomic([{ name, amount: seat.paid, key: `${seat.key}:refund`, game: 'yacht_seat', memo: 'Yacht seat refund' }]).after.catch(() => {});
    b.seated.delete(k); b.pending.delete(k); this.inUse.delete(k);
    this.emit('board', this.boardView(b), [b.owner]); return { left: true };
  }
  private closeBoard(b: Boarding, why: string) {
    if (!this.boards.delete(b.id)) return;
    for (const [k, s] of b.seated) {
      this.inUse.delete(k);
      if (s.paid) getBank().transferAtomic([{ name: s.name, amount: s.paid, key: `${s.key}:refund`, game: 'yacht_seat', memo: 'Yacht seat refund' }]).after.catch(() => {});
    }
    for (const k of b.pending.keys()) this.inUse.delete(k);
    this.emit('board', null, [b.owner, ...[...b.seated.values()].map((s) => s.name)]);
    void why;
  }
  listBoards(): YachtBoardingView[] { this.sweep(); return [...this.boards.values()].map((b) => this.boardView(b)); }
  private boardView(b: Boarding): YachtBoardingView {
    return { id: b.id, owner: b.owner, boat: b.boat, boatName: b.boatName, dest: b.dest, seats: b.seats, price: b.price, openedAt: b.openedAt, expiresAt: b.expiresAt, seated: [...b.seated.values()].map((s) => s.name), pending: [...b.pending.values()].map((r) => ({ name: r.name, at: r.at, expiresAt: r.at + SEAT_REQUEST_TTL_MS })) };
  }

  // ---- voyages
  async depart(owner: string, dest?: unknown) {
    this.sweep();
    if (this.repairOwed(owner)) throw new OceanError('Repair your hull before leaving the dock.');
    if (this.tripOf(owner)) throw new OceanError('You are already at sea.');
    const boat = await this.fleetBoat(owner); if (!boat) throw new OceanError('You need a boat.');
    const board = this.ofOwnerBoard(owner);
    const d = (board ? board.dest : dest) as VoyageId | 'island' | undefined;
    if (!d) throw new OceanError('Pick a destination.');
    const travel = getTravel();
    if (d === 'island') {
      if (boat.model !== 'megayacht') throw new OceanError('The private island is reached by Sovereign Megayacht.');
      const r = await travel.fly(owner, 'island');
      const passengers: string[] = [];
      if (board) {
        for (const s of board.seated.values()) { await travel.carry(s.name, 'island'); passengers.push(s.name); this.inUse.delete(keyOf(s.name)); }
        this.boards.delete(board.id);
      }
      return { loc: 'island' as const, fee: r.fee, passengers };
    }
    if (!voyageById(d) || !canSailVoyage(boat.zone, d)) throw new OceanError('Your boat cannot reach that voyage.');
    const now = this.clock(); const v = voyageById(d)!;
    const trip: Trip = { id: randomUUID(), dest: d, captain: owner.trim(), boat: boat.model, boatName: boat.name, zone: boat.zone, fishZone: v.fishZone, phase: 'underway', startedAt: now, arrivesAt: now + v.travelMs, crew: new Map() };
    this.trips.set(trip.id, trip); this.onTrip.set(keyOf(owner), trip.id);
    await travel.carry(owner, 'voyage');
    const passengers: string[] = [];
    if (board) {
      for (const s of board.seated.values()) { trip.crew.set(keyOf(s.name), s.name); this.onTrip.set(keyOf(s.name), trip.id); this.inUse.delete(keyOf(s.name)); await travel.carry(s.name, 'voyage'); passengers.push(s.name); }
      this.boards.delete(board.id);
    }
    this.emit('voyage', this.voyageView(trip), [trip.captain, ...passengers]);
    return { voyage: this.voyageView(trip), passengers };
  }
  async headHome(name: string) {
    this.sweep();
    const t = this.tripOf(name); if (!t) throw new OceanError('You are not on a voyage.');
    if (keyOf(name) !== keyOf(t.captain)) throw new OceanError('Only the captain can set course for home.');
    if (this.fightOf(name)) throw new OceanError('Finish or flee the fight first.');
    const v = voyageById(t.dest)!; const now = this.clock();
    t.phase = 'returning'; t.arrivesAt = now + v.travelMs;
    this.emit('voyage', this.voyageView(t), [t.captain, ...t.crew.values()]);
    return { voyage: this.voyageView(t) };
  }
  private finishReturn(t: Trip) {
    const travel = getTravel();
    const names = [t.captain, ...t.crew.values()];
    for (const n of names) { void travel.home(n); this.onTrip.delete(keyOf(n)); }
    this.trips.delete(t.id);
    this.emit('voyage', null, names);
  }
  voyageOf(name: string): VoyageView | null { this.sweep(); const t = this.tripOf(name); return t ? this.voyageView(t) : null; }
  private voyageView(t: Trip): VoyageView {
    const v = voyageById(t.dest)!;
    return { id: t.id, dest: t.dest, destName: v.name, phase: t.phase, captain: t.captain, boat: t.boat, boatName: t.boatName, crew: [...t.crew.values()], startedAt: t.startedAt, arrivesAt: t.arrivesAt, fishZone: t.fishZone };
  }

  // ---- combat
  setOptIn(name: string, on: unknown) {
    const k = keyOf(name);
    if (on) this.opted.add(k); else {
      this.opted.delete(k); this.challenges.delete(k);
    }
    return { opted: this.opted.has(k) };
  }
  async challenge(name: string, target: unknown, stake: unknown) {
    this.sweep();
    if (typeof target !== 'string') throw new OceanError('Pick a captain.');
    if (keyOf(name) === keyOf(target)) throw new OceanError('You cannot challenge yourself.');
    const mine = this.tripOf(name); const theirs = this.tripOf(target);
    if (!mine || !theirs) throw new OceanError('Both boats must be at sea.');
    if (mine.phase !== 'arrived' || theirs.phase !== 'arrived') throw new OceanError('Both boats must have arrived before a fight.');
    if (keyOf(name) !== keyOf(mine.captain) || keyOf(target) !== keyOf(theirs.captain)) throw new OceanError('Only captains can fight.');
    if (!this.opted.has(keyOf(name)) || !this.opted.has(keyOf(target))) throw new OceanError('Both captains must opt in to ship combat.');
    if (this.fightOf(name) || this.fightOf(target)) throw new OceanError('A fight is already on.');
    const amt = Math.floor(Number(stake) || 0);
    if (!Number.isInteger(amt) || amt < 0 || amt > MAX_COMBAT_STAKE) throw new OceanError(`Stake is 0–${MAX_COMBAT_STAKE.toLocaleString('en-US')}.`);
    if (amt > 0 && !getBank().canAfford(name, amt)) throw new OceanError('Not enough chips.');
    this.challenges.set(keyOf(target), { from: keyOf(name), fromName: name.trim(), stake: amt, at: this.clock() });
    this.emit('challenge', { from: name.trim(), stake: amt }, [target]);
    return { challenged: target.trim(), stake: amt };
  }
  async answer(name: string, accept: unknown) {
    this.sweep();
    const k = keyOf(name); const ch = this.challenges.get(k); if (!ch) throw new OceanError('No challenge waiting.');
    this.challenges.delete(k);
    if (!accept) { this.emit('challenge', { declined: true, by: name.trim() }, [ch.fromName]); return { declined: true }; }
    if (!this.opted.has(k) || !this.opted.has(ch.from)) throw new OceanError('Both captains must still be opted in.');
    const mine = this.tripOf(name); const theirs = this.tripOf(ch.fromName);
    if (!mine || !theirs || mine.phase !== 'arrived' || theirs.phase !== 'arrived') throw new OceanError('Both boats must still be at sea.');
    const stake = ch.stake;
    if (stake > 0) {
      const bank = getBank();
      if (!bank.canAfford(name, stake) || !bank.canAfford(ch.fromName, stake)) throw new OceanError('A captain can no longer cover the stake.');
      const id = randomUUID();
      const w = bank.transferAtomic([
        { name, amount: -stake, key: `ship_combat:escrow:${id}:b`, game: 'ship_combat', memo: 'Ship combat stake' },
        { name: ch.fromName, amount: -stake, key: `ship_combat:escrow:${id}:a`, game: 'ship_combat', memo: 'Ship combat stake' },
      ]);
      try { await w.after; } catch { throw new OceanError('Not enough chips.'); }
    }
    const aBoat = theirs.boat, bBoat = mine.boat;
    const f: Fight = {
      id: randomUUID(), a: ch.from, aName: ch.fromName, aBoat, aHp: hullHp(aBoat), aMax: hullHp(aBoat),
      b: k, bName: name.trim(), bBoat, bHp: hullHp(bBoat), bMax: hullHp(bBoat),
      stake, rake: Math.floor(stake * 2 * COMBAT_RAKE), toAct: ch.from, startedAt: this.clock(),
    };
    this.fights.set(f.id, f); this.inFight.set(f.a, f.id); this.inFight.set(f.b, f.id);
    this.emit('fight', this.fightView(f), [f.aName, f.bName]);
    return { fight: this.fightView(f) };
  }
  async fire(name: string, roll?: number) {
    const f = this.fightOf(name); if (!f) throw new OceanError('You are not in a fight.');
    if (keyOf(name) !== f.toAct) throw new OceanError('It is not your shot.');
    const dmg = Math.max(FIRE_MIN, Math.min(FIRE_MAX, Math.floor(roll ?? (FIRE_MIN + Math.random() * (FIRE_MAX - FIRE_MIN + 1)))));
    const foe = keyOf(name) === f.a ? 'b' : 'a';
    if (foe === 'b') f.bHp = Math.max(0, f.bHp - dmg); else f.aHp = Math.max(0, f.aHp - dmg);
    if (f.aHp <= 0 || f.bHp <= 0) return this.resolve(f, f.aHp <= 0 ? f.bName : f.aName);
    f.toAct = foe === 'b' ? f.b : f.a;
    this.emit('fight', this.fightView(f), [f.aName, f.bName]);
    return { fight: this.fightView(f), damage: dmg };
  }
  async flee(name: string) {
    const f = this.fightOf(name); if (!f) throw new OceanError('You are not in a fight.');
    if (keyOf(name) === f.a) f.aHp = Math.max(0, f.aHp - FLEE_DAMAGE); else f.bHp = Math.max(0, f.bHp - FLEE_DAMAGE);
    const winner = keyOf(name) === f.a ? f.bName : f.aName;
    return this.resolve(f, winner, true);
  }
  private async resolve(f: Fight, winner: string, fled = false) {
    const loser = keyOf(winner) === f.a ? f.bName : f.aName;
    const loserKey = keyOf(loser);
    const boatPrice = fleetModel(keyOf(winner) === f.a ? f.bBoat : f.aBoat, 'boat')?.price ?? 0;
    // Owed is stored in chips at the moment of damage so a later price-index change cannot resize the bill.
    const repair = px(Math.max(0, Math.round(boatPrice * REPAIR_RATE)));
    if (repair > 0) this.damaged.set(loserKey, (this.damaged.get(loserKey) ?? 0) + repair);
    const pot = f.stake * 2; const rake = f.rake; const prize = pot - rake;
    if (prize > 0) {
      const w = getBank().transferAtomic([{ name: winner, amount: prize, key: `ship_combat:win:${f.id}`, game: 'ship_combat', memo: 'Ship combat purse' }]);
      try { await w.after; } catch { /* prize is already applied in memory; Postgres retry is keyed */ }
    }
    this.fights.delete(f.id); this.inFight.delete(f.a); this.inFight.delete(f.b);
    const view = { ...this.fightView(f), winner, fled, repair, prize };
    this.emit('fight', view, [f.aName, f.bName]);
    return { fight: view, winner, fled, repair, prize };
  }
  async payRepair(name: string) {
    const k = keyOf(name); const due = this.damaged.get(k) ?? 0;
    if (due <= 0) return { paid: 0, owed: 0 };
    const bank = getBank(); const chips = bank.account(name).chips;
    const pay = Math.min(due, Math.max(0, chips));
    if (pay <= 0) throw new OceanError('Not enough chips to repair. The wallet is never pushed negative.');
    const w = bank.transferAtomic([{ name, amount: -pay, key: `hull_repair:${k}:${this.clock()}`, game: 'hull_repair', memo: 'Hull repair' }]);
    try { await w.after; } catch { throw new OceanError('Wallet temporarily unavailable.'); }
    if (pay >= due) this.damaged.delete(k); else this.damaged.set(k, due - pay);
    return { paid: pay, owed: this.damaged.get(k) ?? 0 };
  }
  view(name: string | null) {
    this.sweep();
    const n = name ?? '';
    return {
      signedIn: !!name,
      voyages: VOYAGES,
      opted: name ? this.opted.has(keyOf(n)) : false,
      repair: name ? this.repairOwed(n) : 0,
      repairChips: name ? this.repairOwed(n) : 0,
      voyage: name ? this.voyageOf(n) : null,
      boarding: name ? (this.ofOwnerBoard(n) ? this.boardView(this.ofOwnerBoard(n)!) : this.listBoards().find((b) => b.seated.includes(n) || b.pending.some((p) => keyOf(p.name) === keyOf(n))) ?? null) : null,
      boardings: this.listBoards(),
      challenge: name ? this.challenges.get(keyOf(n)) ?? null : null,
      fight: name && this.fightOf(n) ? this.fightView(this.fightOf(n)!) : null,
      atSea: this.tripsAtSea(),
      cap: px(MAX_YACHT_SEAT_PRICE),
    };
  }
  private tripsAtSea() {
    return [...this.trips.values()].filter((t) => t.phase === 'arrived').map((t) => ({ captain: t.captain, boatName: t.boatName, dest: t.dest, opted: this.opted.has(keyOf(t.captain)) }));
  }
  private fightView(f: Fight): FightView {
    return { id: f.id, a: { name: f.aName, boat: f.aBoat, hp: f.aHp, max: f.aMax }, b: { name: f.bName, boat: f.bBoat, hp: f.bHp, max: f.bMax }, stake: f.stake, rake: f.rake, toAct: f.toAct === f.a ? f.aName : f.bName, startedAt: f.startedAt };
  }
  private emit(kind: string, payload: unknown, who: string[]) { this.onChange?.(kind, payload, who); }
}

let ocean: OceanPlay = new OceanPlay();
export const getOcean = () => ocean;
export const setOcean = (o: OceanPlay) => { ocean = o; };
export const isAtVoyage = (name: string | null | undefined) => !!name && ocean.isAtSea(name);

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
export function registerOcean(io: Server, socket: Socket): void {
  ocean.sweep();
  const nameOf = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const need = () => { const n = nameOf(); if (!n) throw new OceanError('Sign in first.'); return n; };
  if (!(registerOcean as { wired?: boolean }).wired) {
    (registerOcean as { wired?: boolean }).wired = true;
    setInterval(() => ocean.sweep(), 5_000).unref?.();
    ocean.onChange = (kind, payload, who) => { for (const n of who) io.to(roomOf(n)).emit('ocean_event', { kind, payload }); io.emit('ocean_ping'); };
  }
  const on = (ev: string, fn: (b: Record<string, unknown>) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    if (typeof payload === 'function') { ack = payload as Ack; payload = undefined; }
    try { const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; ack?.({ ok: true, ...((await fn(b)) as object ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof OceanError || /^(Not enough chips\.|Wallet temporarily unavailable\.)$/.test((e as Error).message) ? (e as Error).message : 'Something went wrong.' }); }
  });
  on('ocean_view', () => ocean.view(nameOf()));
  on('yacht_board_open', (b) => ocean.openBoard(need(), b.dest, b.price));
  on('yacht_board_cancel', () => ocean.cancelBoard(need()));
  on('yacht_seat_request', (b) => ocean.requestSeat(need(), b.id));
  on('yacht_seat_respond', (b) => ocean.respondSeat(need(), b.name, b.accept));
  on('yacht_seat_leave', () => ocean.leaveBoard(need()));
  on('voyage_start', (b) => ocean.depart(need(), b.dest));
  on('voyage_home', () => ocean.headHome(need()));
  on('ship_opt_in', (b) => ocean.setOptIn(need(), b.on));
  on('ship_challenge', (b) => ocean.challenge(need(), b.name, b.stake));
  on('ship_answer', (b) => ocean.answer(need(), b.accept));
  on('ship_fire', () => ocean.fire(need()));
  on('ship_flee', () => ocean.flee(need()));
  on('hull_repair', () => ocean.payRepair(need()));
}
