/**
 * Co-op economy (mu-coop-econ): server megaprojects and group contracts.
 *
 * Megaprojects: everyone donates chips and real goods to one server-wide build. Each project has 4 stages; a stage
 * needs its chips AND its goods before the next one opens. Finishing a project unlocks a lasting perk for everyone and
 * opens the next project. Donor rewards are small, scale with what you gave, are capped per player per project and are
 * ALWAYS worth less than the donation (a net sink). Order: Hockey Stadium first, then the Fort McChud Bridge.
 *
 * Group contracts: a 24 h board at the Chud City Warehouse with one big delivery order. Anyone eligible delivers part of
 * it from their Warehouse storage (a warehouse truck hauls it to the yard). After the deadline each player claims pay in
 * proportion to what they delivered, plus a completion bonus if the order was filled in time. Per-player caps and
 * anti-alt rules (account age + play time; QA, bot and jailed accounts are excluded).
 */
import { GOODS, type ItemType } from './mines.js';

export type ProjectId = 'stadium' | 'bridge';
export interface StagePlan { id: string; name: string; /** goods for this stage: item id (shared/mines GOODS) + share of the stage's goods value */ goods: Array<[string, number]> }
export interface ProjectPlan { id: ProjectId; name: string; icon: string; /** total chips-equivalent cost (chips + goods at house price) */ total: number; /** share of each stage paid in chips; the rest is goods */ chipShare: number; stages: StagePlan[]; perk: string }

/**
 * Stadium sizing (Dayne, Nov 7 2026): about seven days at 25% of observed combined operating cashflow
 * (~98,974 chips/day). Keep the 60/40 chips/goods split and all four stages. Goods round up at house prices;
 * actual rounded value is projectValue(), not exactly the nominal total. Existing donation rows are never rewritten.
 */
export const COOP_PLAN: Record<ProjectId, ProjectPlan> = {
  stadium: {
    id: 'stadium', name: 'Chud Hub Hockey Stadium', icon: '🏟️', total: 693_000, chipShare: 0.6,
    stages: [
      { id: 'foundation', name: 'Foundation', goods: [['concrete', 0.6], ['brick', 0.4]] },
      { id: 'frame', name: 'Steel frame', goods: [['steel_beam', 0.76], ['steel', 0.24]] },
      { id: 'stands', name: 'Stands', goods: [['concrete', 0.48], ['steel_plate', 0.52]] },
      { id: 'roof', name: 'Roof', goods: [['glass', 0.48], ['steel_cable', 0.52]] },
    ],
    perk: 'Live spectating at the Stadium, and every player gets a 6th paid hockey win a day (was 5).',
  },
  bridge: {
    id: 'bridge', name: 'Fort McChud Bridge', icon: '🌉', total: 10_000_000, chipShare: 0.6,
    stages: [
      { id: 'piers', name: 'Piers', goods: [['concrete', 0.7], ['brick', 0.3]] },
      { id: 'deck', name: 'Deck', goods: [['steel_beam', 0.6], ['steel_plate', 0.4]] },
      { id: 'cables', name: 'Cables', goods: [['steel_cable', 0.8], ['steel', 0.2]] },
      { id: 'lights', name: 'Lights & road', goods: [['glass', 0.5], ['concrete', 0.5]] },
    ],
    perk: 'Fort McChud tickets cost half for everyone.',
  },
};
export const PROJECT_ORDER: ProjectId[] = ['stadium', 'bridge'];

export interface StageNeed { id: string; name: string; chips: number; goods: Array<{ type: ItemType; id: string; name: string; qty: number; price: number }> }
/** Chips and goods quantities per stage, derived from the plan (goods qty = value share / house price, rounded up). */
export function projectStages(p: ProjectPlan): StageNeed[] {
  const per = p.total / p.stages.length;
  return p.stages.map((s) => ({
    id: s.id, name: s.name, chips: Math.round(per * p.chipShare),
    goods: s.goods.map(([id, share]) => { const g = GOODS[id]!; return { type: g.type, id, name: g.name, price: g.price, qty: Math.ceil((per * (1 - p.chipShare) * share) / g.price) }; }),
  }));
}
/** Chips-equivalent value of a stage / a project at house prices. */
export const stageValue = (s: StageNeed) => s.chips + s.goods.reduce((a, g) => a + g.qty * g.price, 0);
export const projectValue = (p: ProjectPlan) => projectStages(p).reduce((a, s) => a + stageValue(s), 0);

/** Donor reward: 10% of donated value, capped per player per project. Always strictly below the donation. */
export const DONOR_REWARD_RATE = 0.1;
export const DONOR_REWARD_CAP = 50_000;
export const MIN_DONATION_VALUE = 100;
export function donorReward(value: number, alreadyRewarded: number): number {
  if (!(value > 0)) return 0;
  const room = Math.max(0, DONOR_REWARD_CAP - Math.max(0, alreadyRewarded));
  return Math.max(0, Math.min(room, Math.floor(value * DONOR_REWARD_RATE)));
}

/** Map key for a donation part: 'chips' or 'type:id'. */
export type PartKey = string;
export const partKey = (g: { type: ItemType; id: string } | 'chips'): PartKey => (g === 'chips' ? 'chips' : `${g.type}:${g.id}`);

export interface StageView extends StageNeed { done: Record<PartKey, number>; pct: number }
export interface ProjectView { id: ProjectId; name: string; icon: string; total: number; perk: string; state: 'locked' | 'active' | 'complete'; stage: number; pct: number; stages: StageView[]; top: Array<{ name: string; value: number }> }
export interface CoopView { projects: ProjectView[]; active: ProjectId | null; perks: { stadium: boolean; bridge: boolean }; me?: { value: number; rewarded: number; cap: number }; sellBonus?: number; stadiumDonated?: number; stadiumRecent?: number }

/** Overall % of a project (by chips-equivalent value, each part clamped to its need). */
export function stagePct(s: StageNeed, done: Record<PartKey, number>): number {
  const v = stageValue(s); if (!v) return 1;
  let got = Math.min(s.chips, done.chips ?? 0);
  for (const g of s.goods) got += Math.min(g.qty, done[partKey(g)] ?? 0) * g.price;
  return Math.min(1, got / v);
}
export const stageFull = (s: StageNeed, done: Record<PartKey, number>) => (done.chips ?? 0) >= s.chips && s.goods.every((g) => (done[partKey(g)] ?? 0) >= g.qty);
/** Build stage for the map: 0 site, 1 foundation, 2 frame, 3 stands, 4 roof/complete (0/25/50/75/100%). */
export const buildStage = (stagesDone: number) => Math.max(0, Math.min(4, stagesDone));

// ---------------------------------------------------------------- group contracts
export const CONTRACT_MS = 24 * 3_600_000;
export interface ContractSpec { id: string; type: ItemType; item: string; qty: number }
/** Rotating board: one big order per 24 h window (UTC days). Pre-rebalance sizes: kept so contracts that closed before
 *  CONTRACT_REBALANCE_FROM keep exactly the targets (and filled/bonus status) they ran with. */
export const CONTRACT_ROTATION_V1: Array<{ item: string; qty: number }> = [
  { item: 'steel', qty: 50_000 }, { item: 'concrete', qty: 300_000 }, { item: 'steel_plate', qty: 30_000 },
  { item: 'glass', qty: 500_000 }, { item: 'steel_beam', qty: 12_000 }, { item: 'brick', qty: 600_000 }, { item: 'steel_cable', qty: 40_000 },
];
/**
 * pt1969u (Dayne 2026-11-07 "contract board is impossible to complete with the player base we have"): sized for a small
 * community. Each order needs about 2,400-3,150 raw ore through the factory chain (e.g. 250 steel = 1,500 iron + 1,000 coal),
 * about one day of a player's 3 hired miners (3 x 720 ore) plus some mining, so two or three regulars can fill it in a day.
 * Same items, order and per-unit pay. Applies from the contract running when this shipped (CONTRACT_REBALANCE_FROM).
 */
export const CONTRACT_ROTATION: Array<{ item: string; qty: number }> = [
  { item: 'steel', qty: 250 }, { item: 'concrete', qty: 100 }, { item: 'steel_plate', qty: 250 },
  { item: 'glass', qty: 150 }, { item: 'steel_beam', qty: 120 }, { item: 'brick', qty: 250 }, { item: 'steel_cable', qty: 500 },
];
/** First contract index (UTC day 2026-11-08, the one live at 2026-11-07 18:xx UTC-6) on the small-community sizes. */
export const CONTRACT_REBALANCE_FROM = 20_765;
/** Pay per unit delivered = house price x this (a hauling premium; goods are consumed). */
export const CONTRACT_UNIT_MUL = 1.15;
/** Completion bonus (filled before the deadline) = this share of the player's base pay. */
export const CONTRACT_BONUS = 0.2;
/** One player may deliver at most this share of an order: two players can fill it (was 0.25, i.e. at least four). */
export const CONTRACT_PLAYER_SHARE = 0.5;
/** And claim at most this many chips from one contract. */
export const CONTRACT_CLAIM_CAP = 1_000_000;
/** Anti-alt: account age and play time to take part. */
export const CONTRACT_MIN_AGE_MS = 3 * 24 * 3_600_000;
export const CONTRACT_MIN_PLAY_MS = 2 * 3_600_000;
/** Claims stay open this long after the deadline. */
export const CONTRACT_CLAIM_MS = 7 * 24 * 3_600_000;

export const contractIndex = (now: number) => Math.floor(now / CONTRACT_MS);
export function contractAt(index: number): ContractSpec & { start: number; deadline: number } {
  const rot = index >= CONTRACT_REBALANCE_FROM ? CONTRACT_ROTATION : CONTRACT_ROTATION_V1;
  const r = rot[((index % rot.length) + rot.length) % rot.length]!;
  const g = GOODS[r.item]!;
  return { id: `c${index}`, type: g.type, item: r.item, qty: r.qty, start: index * CONTRACT_MS, deadline: (index + 1) * CONTRACT_MS };
}
export const playerCap = (c: { qty: number }) => Math.floor(c.qty * CONTRACT_PLAYER_SHARE);
/** What a player gets for `mine` units of a contract `filled` in time or not. Never more than CONTRACT_CLAIM_CAP. */
export function contractPay(c: { item: string }, mine: number, filled: boolean): { base: number; bonus: number; total: number } {
  const unit = (GOODS[c.item]?.price ?? 0) * CONTRACT_UNIT_MUL;
  const base = Math.floor(mine * unit); const bonus = filled ? Math.floor(base * CONTRACT_BONUS) : 0;
  const total = Math.min(CONTRACT_CLAIM_CAP, base + bonus);
  return { base: Math.min(base, total), bonus: total - Math.min(base, total), total };
}
export interface ContractView { id: string; item: string; type: ItemType; name: string; qty: number; delivered: number; start: number; deadline: number; filled: boolean; myDelivered: number; myCap: number; top: Array<{ name: string; qty: number }>; claimable?: { total: number; bonus: number; claimed: boolean } }

// ---------------------------------------------------------------- stadium donor perk: higher daily sell-to-house cap
/**
 * Hockey Stadium chips-equivalent a player gave in the LAST 60 DAYS (D) raises THEIR daily house-sell cap; older gifts roll off:
 *   bonus(D) = 50% x (1 - e^(-D / K)),  K = 60 days x the day's full house cap (100,000 base x house cap index).
 * At cap index 1: K = 6,000,000 -> 100k: +0.8%, 1M: +7.7%, 3M: +19.7%, 5M: +28.3%, hard max +50%.
 * No-profit check (worst case: the extra room fully used every day at 100% margin, on top of ANY other donations, since
 * the curve is concave the marginal gain of a gift d is <= 0.5 x C x d / K per day), over its whole 60-day life:
 *   60 x 0.5 x C x d / (60 x C) = 0.5 d;  plus the 10% rebate -> <= 0.60 x d (Dayne's cap).
 * (With the old K = 30 days and a 60-day window it would have been 1.0 d + 0.2 d = 1.2x, so K was raised to 40 days; then capped at 0.60x: K 60 days, rebate 20% -> 10%.)
 */
export const SELL_BONUS_WINDOW_DAYS = 60;
export const SELL_BONUS_WINDOW_MS = SELL_BONUS_WINDOW_DAYS * 86_400_000;
/** Sum of donations made within the window ending at `now` (at > now - window). */
export function recentDonated(log: ReadonlyArray<{ at: number; value: number }>, now: number): number {
  let t = 0; for (const e of log) if (e.at > now - SELL_BONUS_WINDOW_MS && e.at <= now) t += e.value; return t;
}
export const SELL_BONUS_MAX = 0.5;
export const SELL_BONUS_K_DAYS = 60;
export const SELL_BONUS_BASE_CAP = 100_000; // = HOUSE_DAILY_BASE (shared/mines.ts)
export const sellBonusK = (capIndex = 1) => SELL_BONUS_K_DAYS * SELL_BONUS_BASE_CAP * (capIndex > 1 ? capIndex : 1);
export function sellCapBonus(donated: number, capIndex = 1): number {
  if (!(donated > 0)) return 0;
  return Math.min(SELL_BONUS_MAX, SELL_BONUS_MAX * (1 - Math.exp(-donated / sellBonusK(capIndex))));
}
/** Bonus as a whole-tenth percent for display (e.g. 14.2). */
export const sellBonusPct = (b: number) => Math.floor(b * 1000) / 10;

/** Map site of the Hockey Stadium (outskirts, north of the city by the north road; clear of buildings and fields). */
export const STADIUM_SITE = { x: 4, z: -156, w: 36, d: 28 } as const;
/** Decor (trees/rocks) clearance around the site edge: the finished arena + its forecourt need a clear ring. */
export const STADIUM_CLEAR_PAD = 12;
export const inStadiumSite = (x: number, z: number, pad = STADIUM_CLEAR_PAD) => Math.abs(x - STADIUM_SITE.x) <= STADIUM_SITE.w / 2 + pad && Math.abs(z - STADIUM_SITE.z) <= STADIUM_SITE.d / 2 + pad;
