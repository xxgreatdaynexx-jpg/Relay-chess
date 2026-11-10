/**
 * Co-op 3 (mu-coop3): supply chain contracts, fishing fleets and weekly server events. Rules + sizing live here so
 * the server and every client preview agree.
 *
 * Supply contracts: a seller offers a buyer a recurring truck delivery (item, qty per delivery, unit price, interval,
 * number of deliveries). The unit price must sit within ±30% of today's house price. The seller posts a bond (20% of
 * the contract value) when proposing; the buyer escrows the full price when accepting. Each delivery leaves the
 * seller's Warehouse on one of their trucks, lands in the buyer's Warehouse and releases that delivery's escrow to the
 * seller. A delivery not dispatched by its due time + grace is MISSED: the buyer gets that delivery's escrow back plus
 * a share of the bond as a penalty. Two misses (or the seller walking away) is a BREACH: the buyer keeps the rest of
 * the bond and gets the rest of the escrow back.
 *
 * Fishing fleets: a boat owner opens a real-time trip from the Chud Resort Marina; seats by boat tier. Crew fish deep
 * sea from the owner's boat (its zone) and, with at least one crew aboard, can land crew-only deep-sea species. The
 * owner sets a captain's cut (0–30%) taken from what crew earn selling trip catches. Every daily ocean cap still applies.
 *
 * Server events: one rotating event (mining rush → harvest festival → fishing derby → trade → hockey cup). Through
 * week 44 they were weekly (Monday 00:00 MST). From period 45 onward they are daily at America/Regina midnight
 * (UTC-6), with day-sized goals and half the prior payouts. Everyone fills one server goal; after the period ends
 * contributors claim a tiered, capped reward (bigger if the goal was reached).
 */
import { priceOf, type ItemType } from './mines.js';
import { abDayStart, DAY_MS as AB_DAY_MS } from './mayor.js';

const H = 3_600_000; const DAY = 24 * H;
const round = (x: number) => Math.round(x);

// ------------------------------------------------------------ supply contracts
export const SC_BAND = 0.3;
export const SC_INTERVALS_H = [6, 12, 24] as const;
export const SC_MIN_DELIVERIES = 2;
export const SC_MAX_DELIVERIES = 14;
export const SC_MAX_QTY = 5_000;
export const SC_BOND_RATE = 0.2;
export const SC_MAX_MISSES = 2;
export const SC_GRACE_MS = 2 * H;
export const SC_OFFER_TTL_MS = DAY;
export const SC_MAX_OPEN = 5;
/** Buyer walking away from an active contract pays the seller this share of the remaining escrow. */
export const SC_BUYER_CANCEL_FEE = 0.1;
export const SC_MIN_VALUE = 1_000;
export type ScStatus = 'pending' | 'active' | 'done' | 'cancelled' | 'breached' | 'declined' | 'expired' | 'withdrawn';
/** House reference price for one unit today. */
export const scRef = (s: { type: ItemType; id: string }, index = 1) => Math.max(0, round(priceOf(s) * index));
export const scBand = (ref: number) => ({ lo: Math.max(1, Math.ceil(ref * (1 - SC_BAND))), hi: Math.floor(ref * (1 + SC_BAND)) });
export const scPriceOk = (unit: number, ref: number) => { const b = scBand(ref); return Number.isInteger(unit) && unit >= b.lo && unit <= b.hi; };
export const scValue = (unit: number, qty: number, n: number) => unit * qty * n;
export const scBond = (unit: number, qty: number, n: number) => Math.ceil(scValue(unit, qty, n) * SC_BOND_RATE);
/** Bond share paid to the buyer for ONE missed delivery (the last miss before a breach gets the rest of the bond). */
export const scPenalty = (bond: number, n: number) => Math.floor(bond / n);
export const scDueAt = (startAt: number, intervalMs: number, k: number) => startAt + (k + 1) * intervalMs;
export interface ScView {
  id: string; seller: string; buyer: string; type: ItemType; itemId: string; name: string; qty: number; unit: number; n: number; intervalMs: number;
  status: ScStatus; createdAt: number; startAt: number | null; k: number; delivered: number; missed: number; escrow: number; bond: number;
  nextDue: number | null; transit: { k: number; arriveAt: number; truck: string } | null; cancelReq: 'seller' | 'buyer' | null; role: 'seller' | 'buyer' | null; endedAt: number | null; ref: number;
}

// ------------------------------------------------------------ fishing fleets
/** Crew seats (besides the captain) by boat model. Skiffs are too small to crew. */
export const CREW_SEATS: Record<string, number> = { skiff: 0, sportfisher: 1, yacht: 3, superyacht: 6 };
export const crewSeats = (model: string | null | undefined) => (model ? CREW_SEATS[model] ?? 0 : 0);
export const FLEET_TRIP_MS = 30 * 60_000;
export const FLEET_MAX_CUT = 0.3;
export const FLEET_REQUEST_TTL_MS = 5 * 60_000;
export const cutOk = (c: number) => Number.isFinite(c) && c >= 0 && c <= FLEET_MAX_CUT;
/** Captain's share of a crew member's payout (floored, so the seller never loses a fraction of a chip). */
export const captainShare = (paid: number, cut: number) => Math.max(0, Math.floor(paid * Math.min(FLEET_MAX_CUT, Math.max(0, cut))));
export interface FleetTripView {
  id: string; captain: string; boat: string; boatName: string; zone: number; seats: number; cut: number; startAt: number; endsAt: number;
  crew: string[]; requests: string[]; mine: 'captain' | 'crew' | 'requested' | null;
  /** Trip log (catches + captain's cuts), shown to the captain and crew only. */
  log: FleetLogEntry[];
}
export interface FleetLogEntry { at: number; name: string; kind: 'catch' | 'cut'; fish?: string; grams?: number; chips?: number }
export const FLEET_LOG_MAX = 8;

// ------------------------------------------------------------ weekly events
export type EventKind = 'mining' | 'harvest' | 'fishing' | 'trade' | 'hockey';
export interface EventDef { id: EventKind; name: string; icon: string; unit: string; goal: number; playerShare?: number; blurb: string; color: string }
/**
 * Historical goals and 10% player caps, retained for weeks that closed before the rebalance.
 */
export const LEGACY_EVENTS: Record<EventKind, EventDef> = {
  mining: { id: 'mining', name: 'Mining Rush', icon: '⛏️', unit: 'ore mined', goal: 25_000, blurb: 'Break ore veins in any mine.', color: '#f59e0b' },
  harvest: { id: 'harvest', name: 'Harvest Festival', icon: '🌾', unit: 'crops harvested', goal: 30_000, blurb: 'Harvest crops on any farm.', color: '#84cc16' },
  fishing: { id: 'fishing', name: 'Fishing Derby', icon: '🎣', unit: 'fish landed', goal: 4_000, blurb: 'Land fish at the pond, reef or deep sea.', color: '#38bdf8' },
  trade: { id: 'trade', name: 'Trade Week', icon: '🤝', unit: 'chips traded', goal: 3_000_000, blurb: 'Buy and sell goods on the Market with other players.', color: '#a78bfa' },
  hockey: { id: 'hockey', name: 'Hockey Cup', icon: '🏒', unit: 'hockey wins', goal: 400, blurb: 'Win paid hockey matches.', color: '#ef4444' },
};
/** Small-community WEEKLY targets from the live Trade Week onward (through week 44). Closed weeks retain
 * their exact old goals/caps. Daily targets live in DAILY_EVENT_GOALS (pt2113u / #63).
 */
export const EVENT_REBALANCE_FROM = 43; // Nov 2 2026 00:00 MST; current week when requested
export const EVENT_PLAYER_SHARE = 0.5;
/** Weekly goals (274ea368 / small-community). Kept for weeks EVENT_REBALANCE_FROM .. EVENT_DAILY_FROM-1. */
export const WEEKLY_EVENT_GOALS: Record<EventKind, number> = { mining: 4_000, harvest: 6_000, fishing: 300, trade: 1_000, hockey: 20 };
/** Daily goals ≈ weekly/7, rounded sensibly so one Regina day can finish (pt2113u / #63). */
export const DAILY_EVENT_GOALS: Record<EventKind, number> = { mining: 600, harvest: 850, fishing: 45, trade: 150, hockey: 3 };
const tradeBlurb = { blurb: 'Trade goods on the Market with other players. Chips spent count for both sides, not trips.' };
export const EVENTS = Object.fromEntries(Object.entries(LEGACY_EVENTS).map(([kind, e]) => [kind, {
  ...e, goal: WEEKLY_EVENT_GOALS[kind as EventKind], playerShare: EVENT_PLAYER_SHARE,
  ...(kind === 'trade' ? tradeBlurb : {}),
}])) as Record<EventKind, EventDef>;
/** Current (daily) defs — same names/icons, day-sized goals. */
export const DAILY_EVENTS = Object.fromEntries(Object.entries(EVENTS).map(([kind, e]) => [kind, {
  ...e, goal: DAILY_EVENT_GOALS[kind as EventKind],
}])) as Record<EventKind, EventDef>;
export const EVENT_ORDER: EventKind[] = ['mining', 'harvest', 'fishing', 'trade', 'hockey'];
export const WEEK_MS = 7 * DAY;
/** Monday 2026-01-05 00:00 MST (07:00 UTC). Weeks start every Monday 00:00 MST. */
export const EVENT_EPOCH = Date.UTC(2026, 0, 5, 7);
export const weekIndex = (ms: number) => Math.floor((ms - EVENT_EPOCH) / WEEK_MS);
export const weekStart = (w: number) => EVENT_EPOCH + w * WEEK_MS;
/**
 * First daily period id (pt2113u / #63). Week 44 (Hockey Cup) finishes under weekly rules/goals/payouts;
 * period 45+ are daily at America/Regina midnight with day goals and half payouts. No wipe of week-44 contrib.
 */
export const EVENT_DAILY_FROM = 45;
/** Regina (UTC-6) midnight of the Monday week 45 would have started — first daily boundary. */
export const eventDailyEpoch = () => abDayStart(weekStart(EVENT_DAILY_FROM));
/** Period id: weekly index until EVENT_DAILY_FROM, then one id per Regina day. */
export const periodIndex = (ms: number) => {
  const d0 = eventDailyEpoch();
  if (ms < d0) return weekIndex(ms);
  return EVENT_DAILY_FROM + Math.floor((ms - d0) / AB_DAY_MS);
};
export const periodStart = (p: number) => {
  if (p < EVENT_DAILY_FROM) return weekStart(p);
  return eventDailyEpoch() + (p - EVENT_DAILY_FROM) * AB_DAY_MS;
};
export const eventKindAt = (w: number): EventKind => EVENT_ORDER[((w % EVENT_ORDER.length) + EVENT_ORDER.length) % EVENT_ORDER.length]!;
export const eventFor = (w: number): EventDef => {
  const kind = eventKindAt(w);
  if (w < EVENT_REBALANCE_FROM) return LEGACY_EVENTS[kind]!;
  if (w >= EVENT_DAILY_FROM) return DAILY_EVENTS[kind]!;
  return EVENTS[kind]!;
};
export const playerEventCap = (e: EventDef) => Math.ceil(e.goal * (e.playerShare ?? 0.1));
/** Most one trade can count for in a trade event (so one huge wash trade can't fill the bar). */
export const TRADE_COUNT_CAP = 50_000;
/** Claim window after a period ends (still a week of wall time so nobody misses a daily claim). */
export const EVENT_CLAIM_MS = 7 * DAY;
/** Reward tiers by personal (capped) contribution as a share of the player cap. Chips are price-indexed at claim.
 * Gold = "first place" payout when the period completed the goal; silver/bronze keep the same ratios to gold.
 * Closed weeks before EVENT_PAYOUT_FROM keep the legacy chip amounts (no retroactive bump). */
export const LEGACY_EVENT_TIERS = [
  { id: 'bronze', name: 'Bronze', icon: '🥉', at: 0.05, chips: 2_000 },
  { id: 'silver', name: 'Silver', icon: '🥈', at: 0.25, chips: 6_000 },
  { id: 'gold', name: 'Gold', icon: '🥇', at: 0.6, chips: 15_000 },
] as const;
/** pt2098u (chessguy2 #55): gold / first place → 200,000; silver & bronze scale by prior ratios (6/15, 2/15). Weekly eras only. */
export const EVENT_TIERS = [
  { id: 'bronze', name: 'Bronze', icon: '🥉', at: 0.05, chips: 26_667 },
  { id: 'silver', name: 'Silver', icon: '🥈', at: 0.25, chips: 80_000 },
  { id: 'gold', name: 'Gold', icon: '🥇', at: 0.6, chips: 200_000 },
] as const;
/** pt2113u / #63: daily events — every payout cut 50% vs EVENT_TIERS. */
export const DAILY_EVENT_TIERS = [
  { id: 'bronze', name: 'Bronze', icon: '🥉', at: 0.05, chips: 13_333 },
  { id: 'silver', name: 'Silver', icon: '🥈', at: 0.25, chips: 40_000 },
  { id: 'gold', name: 'Gold', icon: '🥇', at: 0.6, chips: 100_000 },
] as const;
export type EventTier = { id: 'bronze' | 'silver' | 'gold'; name: string; icon: string; at: number; chips: number };
/** Weeks ≥ this index use EVENT_TIERS; earlier closed weeks keep LEGACY_EVENT_TIERS. */
export const EVENT_PAYOUT_FROM = 44;
export const eventTiersFor = (week: number): readonly EventTier[] => (
  week >= EVENT_DAILY_FROM ? DAILY_EVENT_TIERS : week >= EVENT_PAYOUT_FROM ? EVENT_TIERS : LEGACY_EVENT_TIERS
);
/** Reward multiplier by server progress: the full tier if the goal was reached, half from 50%, nothing below. */
export const goalMul = (pct: number) => (pct >= 1 ? 1 : pct >= 0.5 ? 0.5 : 0);
export function eventTier(e: EventDef, mine: number, week = EVENT_PAYOUT_FROM) {
  const tiers = eventTiersFor(week);
  const f = Math.min(mine, playerEventCap(e)) / playerEventCap(e);
  let t: EventTier | null = null; for (const x of tiers) if (f >= x.at) t = x; return t;
}
export function eventReward(e: EventDef, mine: number, serverPct: number, index = 1, week = EVENT_PAYOUT_FROM) {
  const t = eventTier(e, mine, week); return t ? round(t.chips * goalMul(serverPct) * index) : 0;
}
export interface EventView {
  week: number; kind: EventKind; name: string; icon: string; unit: string; blurb: string; color: string; goal: number; progress: number; pct: number;
  startAt: number; endsAt: number; top: Array<{ name: string; amount: number }>; playerCap: number; next: { name: string; icon: string; startAt: number };
  me?: { amount: number; tier: string | null; excluded?: string };
  past?: { week: number; name: string; icon: string; pct: number; amount: number; reward: number; claimed: boolean; claimUntil: number } | null;
}
