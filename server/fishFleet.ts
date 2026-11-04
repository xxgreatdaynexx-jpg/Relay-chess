/**
 * Fishing fleets (rules: shared/coop3.ts). A boat owner opens a real-time trip at the Chud Resort Marina and crews it.
 * Crew fish the deep sea from the captain's boat (its zone and bite speed) and a crewed boat can land the crew-only
 * species. What crew sell from a trip pays the captain their cut inside the fish sale's own transaction
 * (server/fishing.ts sell); every daily ocean cap still applies to the seller.
 *
 * Trips live in memory (minutes long, no chips held). Every check-and-change is synchronous between awaits, so two
 * requests can't both take the last seat and a player is on at most one trip (or one pending request) at a time.
 */
import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { getFleet } from './fleet.js';
import { isAtResort } from './travel.js';
import { setFishCrewHook, type CrewInfo } from './fishing.js';
import { playerKey } from './skins.js';
import { roomOf } from './wallet-sockets.js';
import { getLinks, socketSigs } from './linked.js';
import { Coop3Error, Guard } from './coop3-gate.js';
import { fleetModel } from '../shared/fleet.js';
import { FLEET_MAX_CUT, FLEET_REQUEST_TTL_MS, FLEET_TRIP_MS, crewSeats, cutOk, type FleetTripView } from '../shared/coop3.js';

interface Trip { id: string; captain: string; boat: string; boatName: string; zone: number; biteMul: number; seats: number; cut: number; startAt: number; endsAt: number; crew: Map<string, string>; reqs: Map<string, { name: string; at: number }> }

export class FishFleet {
  private trips = new Map<string, Trip>();
  guard = new Guard(null);
  boatsOf: (name: string) => Promise<string[]> = async (n) => { const f = getFleet(); return f ? (await f.owned(n, 'boat')).map((c) => c.model) : []; };
  atResort: (name: string) => boolean = isAtResort;
  onChange?: (t: Trip | null, event: string, who: string[]) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly clock = () => Date.now()) {}
  start(ms = 10_000) { if (!this.timer) { this.timer = setInterval(() => this.tick(), ms); this.timer.unref?.(); } }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private live(t: Trip | undefined) { return t && this.clock() < t.endsAt ? t : undefined; }
  private tripOf(name: string): { t: Trip; role: 'captain' | 'crew' | 'requested' } | null {
    const k = playerKey(name);
    for (const t of this.trips.values()) { if (!this.live(t)) continue; if (playerKey(t.captain) === k) return { t, role: 'captain' }; if (t.crew.has(k)) return { t, role: 'crew' }; if (t.reqs.has(k)) return { t, role: 'requested' }; }
    return null;
  }
  /** Hook for server/fishing.ts cast: which boat this player fishes from, and whether the crew-only species can bite. */
  crewInfo(name: string): CrewInfo | null {
    const m = this.tripOf(name); if (!m || m.role === 'requested') return null; const t = m.t;
    if (m.role === 'captain') return t.crew.size ? { tripId: t.id, captain: null, cut: 0, zone: t.zone, biteMul: t.biteMul, crewed: true } : null;
    return { tripId: t.id, captain: t.captain, cut: t.cut, zone: t.zone, biteMul: t.biteMul, crewed: true };
  }

  async open(captain: string, cutIn: unknown): Promise<FleetTripView> {
    this.guard.gate(captain);
    if (!this.atResort(captain)) throw new Coop3Error('Fleet trips leave from the Chud Resort Marina. Fly there first.');
    const cut = Number(cutIn); if (!cutOk(cut)) throw new Coop3Error(`Captain’s cut is 0–${Math.round(FLEET_MAX_CUT * 100)}%.`);
    const models = await this.boatsOf(captain);
    const best = models.map((id) => fleetModel(id, 'boat')).filter((m): m is NonNullable<typeof m> => !!m && crewSeats(m.id) > 0)
      .sort((a, b) => crewSeats(b.id) - crewSeats(a.id) || (b.zone ?? 0) - (a.zone ?? 0))[0];
    if (!best) throw new Coop3Error('You need a sportfisher, yacht or superyacht to crew a boat (skiffs fit only you).');
    if (this.tripOf(captain)) throw new Coop3Error('You are already on a fleet trip.');
    const now = this.clock();
    const t: Trip = { id: randomUUID(), captain: captain.trim(), boat: best.id, boatName: best.name, zone: best.zone ?? 1, biteMul: best.biteMul ?? 1, seats: crewSeats(best.id), cut, startAt: now, endsAt: now + FLEET_TRIP_MS, crew: new Map(), reqs: new Map() };
    this.trips.set(t.id, t); this.onChange?.(t, 'opened', [t.captain]);
    return this.view(t, captain);
  }
  /** Change the cut, only before anyone has joined (so crew never sail under a cut they didn't see). */
  setCut(captain: string, cutIn: unknown) {
    const m = this.tripOf(captain); if (!m || m.role !== 'captain') throw new Coop3Error('You are not captaining a trip.');
    const cut = Number(cutIn); if (!cutOk(cut)) throw new Coop3Error(`Captain’s cut is 0–${Math.round(FLEET_MAX_CUT * 100)}%.`);
    if (m.t.crew.size || m.t.reqs.size) throw new Coop3Error('You can’t change the cut once crew have asked to join.');
    m.t.cut = cut; this.onChange?.(m.t, 'cut', [m.t.captain]); return this.view(m.t, captain);
  }
  async request(name: string, tripId: unknown): Promise<FleetTripView> {
    const t = this.live(typeof tripId === 'string' ? this.trips.get(tripId) : undefined); if (!t) throw new Coop3Error('That trip has ended.');
    this.guard.gate(name); this.guard.noLink(t.captain, name);
    if (!this.atResort(name)) throw new Coop3Error('Fly to the Chud Resort first to join a crew.');
    await this.guard.eligible(name);
    // re-check after the await: everything below is synchronous
    if (!this.live(t)) throw new Coop3Error('That trip has ended.');
    if (this.tripOf(name)) throw new Coop3Error('You are already on (or asking to join) a fleet trip.');
    if (t.crew.size >= t.seats) throw new Coop3Error('That boat is full.');
    t.reqs.set(playerKey(name), { name: name.trim(), at: this.clock() }); this.onChange?.(t, 'request', [t.captain, name]);
    return this.view(t, name);
  }
  respond(captain: string, who: unknown, accept: unknown): FleetTripView {
    const m = this.tripOf(captain); if (!m || m.role !== 'captain') throw new Coop3Error('You are not captaining a trip.'); const t = m.t;
    const k = typeof who === 'string' ? playerKey(who) : ''; const r = t.reqs.get(k); if (!r) throw new Coop3Error('That request has gone.');
    t.reqs.delete(k);
    if (accept === true) {
      if (t.crew.size >= t.seats) { this.onChange?.(t, 'rejected', [r.name]); throw new Coop3Error('Your boat is full.'); }
      const why = this.guard.excluded(r.name); if (why || !this.atResort(r.name)) { this.onChange?.(t, 'rejected', [r.name]); throw new Coop3Error(`${r.name} can’t join right now.`); }
      t.crew.set(k, r.name); this.onChange?.(t, 'joined', [t.captain, r.name, ...t.crew.values()]);
    } else this.onChange?.(t, 'rejected', [r.name]);
    return this.view(t, captain);
  }
  leave(name: string): { ok: true } {
    const m = this.tripOf(name); if (!m) throw new Coop3Error('You are not on a fleet trip.'); const t = m.t; const k = playerKey(name);
    if (m.role === 'captain') { this.end(t, 'ended'); return { ok: true }; }
    t.crew.delete(k); t.reqs.delete(k); this.onChange?.(t, 'left', [t.captain, name]); return { ok: true };
  }
  private end(t: Trip, event: string) { this.trips.delete(t.id); this.onChange?.(null, event, [t.captain, ...t.crew.values(), ...[...t.reqs.values()].map((r) => r.name)]); }
  tick() {
    const now = this.clock();
    for (const t of [...this.trips.values()]) {
      if (now >= t.endsAt) { this.end(t, 'ended'); continue; }
      for (const [k, r] of t.reqs) if (now - r.at > FLEET_REQUEST_TTL_MS) { t.reqs.delete(k); this.onChange?.(t, 'expired', [r.name]); }
      // jailed crew are put ashore
      for (const [k, n] of t.crew) if (this.guard.excluded(n)) { t.crew.delete(k); this.onChange?.(t, 'left', [t.captain, n]); }
      if (this.guard.excluded(t.captain)) this.end(t, 'ended');
    }
  }
  view(t: Trip, viewer: string | null): FleetTripView {
    const k = viewer ? playerKey(viewer) : '';
    const mine = !viewer ? null : playerKey(t.captain) === k ? 'captain' : t.crew.has(k) ? 'crew' : t.reqs.has(k) ? 'requested' : null;
    return { id: t.id, captain: t.captain, boat: t.boat, boatName: t.boatName, zone: t.zone, seats: t.seats, cut: t.cut, startAt: t.startAt, endsAt: t.endsAt, crew: [...t.crew.values()],
      requests: mine === 'captain' ? [...t.reqs.values()].map((r) => r.name) : [], mine };
  }
  list(viewer: string | null): FleetTripView[] { return [...this.trips.values()].filter((t) => this.live(t)).map((t) => this.view(t, viewer)).sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || a.endsAt - b.endsAt); }
  mine(viewer: string) { const m = this.tripOf(viewer); return m ? this.view(m.t, viewer) : null; }
}

let fleetTrips = new FishFleet();
setFishCrewHook((n) => fleetTrips.crewInfo(n));
export const getFishFleet = () => fleetTrips;
export function resetFishFleet(f?: FishFleet) { fleetTrips = f ?? new FishFleet(); return fleetTrips; }

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;
let wiredIo: Server | null = null;
export function registerFishFleet(io: Server, socket: Socket): void {
  if (wiredIo !== io) { wiredIo = io; fleetTrips.start(); }
  fleetTrips.onChange = (t, event, who) => { wiredIo?.emit('fleet_trips', { changed: t?.id ?? null }); for (const n of who) wiredIo?.to(roomOf(n)).emit('fleet_event', { event, trip: t ? fleetTrips.view(t, n) : null }); };
  const nameOf_ = () => (socket.data as { account?: { name: string } }).account?.name ?? null;
  const need = () => { const n = nameOf_(); if (!n) throw new Coop3Error('Sign in first.'); const s = socketSigs(socket); getLinks().record(n, s.ip, s.device); return n; };
  const on = (ev: string, fn: (b: Record<string, unknown>) => unknown) => socket.on(ev, async (payload: unknown, ack?: Ack) => {
    try { const b = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}; ack?.({ ok: true, ...((await fn(b)) as object ?? {}) }); }
    catch (e) { ack?.({ ok: false, error: e instanceof Coop3Error ? (e as Error).message : 'Something went wrong.' }); if (!(e instanceof Coop3Error)) console.error(`[fleet] ${ev} failed:`, (e as Error).message); }
  });
  const all = (n: string | null) => ({ trips: fleetTrips.list(n), mine: n ? fleetTrips.mine(n) : null, me: n });
  on('fleet_list', () => all(nameOf_()));
  on('fleet_open', async (b) => { const n = need(); await fleetTrips.open(n, b.cut); return all(n); });
  on('fleet_cut', (b) => { const n = need(); fleetTrips.setCut(n, b.cut); return all(n); });
  on('fleet_request', async (b) => { const n = need(); await fleetTrips.request(n, b.id); return all(n); });
  on('fleet_respond', (b) => { const n = need(); fleetTrips.respond(n, b.name, b.accept); return all(n); });
  on('fleet_leave', () => { const n = need(); fleetTrips.leave(n); return all(n); });
}
