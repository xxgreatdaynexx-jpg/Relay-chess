/**
 * Solitro: an original roguelike run built on Klondike. Pure and deterministic (seeded), so the server can be the
 * authority for signed-in players while guests run the same engine locally. All names and rules here are original.
 *
 * A run is 8 antes of 3 blinds (small, big, boss). Each blind deals a fresh Klondike board; every card play is scored
 * as chips × mult. Reach the target before your plays run out. Between blinds you shop for jokers and omens.
 */
import { canMove, deal as kDeal, draw as kDraw, isStuck, move as kMove, mulberry32, pickup, type Card, type GameState as Board, type Loc, type Target } from './klondike.js';

export const MAX_ANTE = 8;
export const JOKER_SLOTS = 5;
export const OMEN_SLOTS = 2;
export const BASE_PLAYS = 40;
export const BASE_REDEALS = 2;
export const START_MONEY = 4;
export const REROLL_BASE = 5;
export const INTEREST_PER = 5;
export const INTEREST_CAP = 5;
/** Score target for the small blind of each ante (index = ante). Big = ×1.5, boss = ×2. */
export const ANTE_BASE = [0, 300, 800, 2000, 4000, 7500, 12500, 20000, 32000];
export const BLIND_MULT = [1, 1.5, 2] as const;
export const BLIND_REWARD = [3, 4, 5] as const;
export const BLIND_NAMES = ['Small blind', 'Big blind', 'Boss blind'] as const;

export type Enh = 'etched' | 'inked' | 'crystal' | 'gilded' | 'iron' | 'charmed';
export type Edition = 'gilt' | 'neon' | 'opal';
export const ENH_INFO: Record<Enh, { name: string; text: string }> = {
  etched: { name: 'Etched', text: '+30 chips when played to a foundation' },
  inked: { name: 'Inked', text: '+4 mult when played to a foundation' },
  crystal: { name: 'Crystal', text: '×2 mult when played; 1 in 4 chance to shatter' },
  gilded: { name: 'Gilded', text: '+$2 when played to a foundation' },
  iron: { name: 'Iron', text: '×1.5 mult when played to a foundation' },
  charmed: { name: 'Charmed', text: '1 in 5: +20 mult · 1 in 15: +$10' },
};
export const EDITION_INFO: Record<Edition, { name: string; text: string; cost: number }> = {
  gilt: { name: 'Gilt', text: '+50 chips', cost: 2 },
  neon: { name: 'Neon', text: '+10 mult', cost: 3 },
  opal: { name: 'Opal', text: '×1.5 mult', cost: 5 },
};

/** What one scored play did, handed to every joker. */
export interface PlayCtx {
  card: Card | null; // card played to a foundation (null for tableau moves)
  debuffed: boolean; // boss says this card scores nothing
  reveal: boolean;
  cascade: number; // cards moved together onto the tableau (0 if <2 or not a cascade)
  clear: boolean;
  suitDone: boolean;
  streak: number;
  money: number;
  emptySlots: number;
}
type Fx = { chips?: number; mult?: number; xmult?: number; money?: number } | null;
const face = (c: Card | null) => !!c && c.rank >= 11;
const red = (c: Card) => c.suit === 'H' || c.suit === 'D';

export type JokerId =
  | 'ember' | 'ledger' | 'redtide' | 'blackwater' | 'crown' | 'firstlight' | 'domino' | 'lamplighter' | 'avalanche'
  | 'sweeper' | 'completist' | 'thriftjar' | 'compound' | 'pocketwatch' | 'secondwind' | 'snowball' | 'hourglass'
  | 'luckyseven' | 'oddduck' | 'evenkeel' | 'magpie' | 'tightrope' | 'fatwallet' | 'minimalist';
export interface JokerDef { id: JokerId; name: string; icon: string; text: string; cost: number; rarity: 1 | 2 | 3; fx?: (c: PlayCtx, j: JokerInst) => Fx }
const fnd = (c: PlayCtx) => !!c.card && !c.debuffed;
export const JOKERS: JokerDef[] = [
  { id: 'ember', name: 'Ember', icon: '🔥', text: '+4 mult on every scoring play', cost: 4, rarity: 1, fx: () => ({ mult: 4 }) },
  { id: 'ledger', name: 'Ledger', icon: '📒', text: '+30 chips on every foundation play', cost: 4, rarity: 1, fx: (c) => (fnd(c) ? { chips: 30 } : null) },
  { id: 'redtide', name: 'Red Tide', icon: '🌊', text: '♥/♦ foundation plays give +4 mult', cost: 5, rarity: 1, fx: (c) => (fnd(c) && red(c.card!) ? { mult: 4 } : null) },
  { id: 'blackwater', name: 'Blackwater', icon: '🖤', text: '♠/♣ foundation plays give +4 mult', cost: 5, rarity: 1, fx: (c) => (fnd(c) && !red(c.card!) ? { mult: 4 } : null) },
  { id: 'crown', name: 'Paper Crown', icon: '👑', text: 'J, Q, K foundation plays give +40 chips', cost: 5, rarity: 1, fx: (c) => (fnd(c) && face(c.card) ? { chips: 40 } : null) },
  { id: 'firstlight', name: 'First Light', icon: '🌅', text: 'Aces played to a foundation give +15 mult', cost: 4, rarity: 1, fx: (c) => (fnd(c) && c.card!.rank === 1 ? { mult: 15 } : null) },
  { id: 'domino', name: 'Domino', icon: '🁫', text: 'Streak bonus counts double', cost: 6, rarity: 2, fx: (c) => (fnd(c) && c.streak > 0 ? { mult: c.streak } : null) },
  { id: 'lamplighter', name: 'Lamplighter', icon: '🏮', text: 'Revealing a face-down card gives +40 chips and +3 mult', cost: 5, rarity: 1, fx: (c) => (c.reveal ? { chips: 40, mult: 3 } : null) },
  { id: 'avalanche', name: 'Avalanche', icon: '🏔️', text: '×2 mult when you move 3+ cards at once', cost: 6, rarity: 2, fx: (c) => (c.cascade >= 3 ? { xmult: 2 } : null) },
  { id: 'sweeper', name: 'Sweeper', icon: '🧹', text: '×3 mult when a play empties a column', cost: 6, rarity: 2, fx: (c) => (c.clear ? { xmult: 3 } : null) },
  { id: 'completist', name: 'Completist', icon: '🏁', text: '×3 mult when a play completes a suit', cost: 6, rarity: 2, fx: (c) => (c.suitDone ? { xmult: 3 } : null) },
  { id: 'thriftjar', name: 'Thrift Jar', icon: '🫙', text: 'Leftover plays pay $1 per 3 (not 5)', cost: 5, rarity: 1 },
  { id: 'compound', name: 'Compound Owl', icon: '🦉', text: 'Interest cap raised to $10', cost: 6, rarity: 2 },
  { id: 'pocketwatch', name: 'Pocket Watch', icon: '⌚', text: '+8 plays every blind', cost: 6, rarity: 2 },
  { id: 'secondwind', name: 'Second Wind', icon: '🌬️', text: '+1 redeal every blind', cost: 5, rarity: 1 },
  { id: 'snowball', name: 'Snowball', icon: '☃️', text: 'Gains +1 mult per foundation play this run', cost: 7, rarity: 3, fx: (c, j) => (fnd(c) ? { mult: (j.n = (j.n ?? 0) + 1) } : (j.n ? { mult: j.n } : null)) },
  { id: 'hourglass', name: 'Hourglass', icon: '⏳', text: '×3 mult on every scoring play, but −10 plays', cost: 7, rarity: 3, fx: () => ({ xmult: 3 }) },
  { id: 'luckyseven', name: 'Lucky Seven', icon: '🎰', text: '7s played to a foundation give ×2 mult', cost: 5, rarity: 1, fx: (c) => (fnd(c) && c.card!.rank === 7 ? { xmult: 2 } : null) },
  { id: 'oddduck', name: 'Odd Duck', icon: '🦆', text: 'Odd ranks (A,3,5,7,9) give +25 chips', cost: 4, rarity: 1, fx: (c) => (fnd(c) && c.card!.rank % 2 === 1 && c.card!.rank <= 9 ? { chips: 25 } : null) },
  { id: 'evenkeel', name: 'Even Keel', icon: '⚓', text: 'Even ranks (2–10) give +4 mult', cost: 4, rarity: 1, fx: (c) => (fnd(c) && c.card!.rank % 2 === 0 && c.card!.rank <= 10 ? { mult: 4 } : null) },
  { id: 'magpie', name: 'Magpie', icon: '🐦‍⬛', text: '+$1 for each J, Q, K played to a foundation', cost: 5, rarity: 1, fx: (c) => (fnd(c) && face(c.card) ? { money: 1 } : null) },
  { id: 'tightrope', name: 'Tightrope', icon: '🎪', text: 'Tableau moves no longer break your streak', cost: 6, rarity: 2 },
  { id: 'fatwallet', name: 'Fat Wallet', icon: '👛', text: '+1 mult for every $5 you hold', cost: 6, rarity: 2, fx: (c) => (c.money >= 5 ? { mult: Math.floor(c.money / 5) } : null) },
  { id: 'minimalist', name: 'Minimalist', icon: '◻️', text: '×0.25 mult for each empty joker slot (on top of ×1)', cost: 5, rarity: 2, fx: (c) => (c.emptySlots > 0 ? { xmult: 1 + 0.25 * c.emptySlots } : null) },
];
export const JOKER = Object.fromEntries(JOKERS.map((j) => [j.id, j])) as Record<JokerId, JokerDef>;

export type BossId = 'thorn' | 'rust' | 'gloom' | 'bramble' | 'drought' | 'vise' | 'veil' | 'stall' | 'hush' | 'wall';
export interface BossDef { id: BossId; name: string; icon: string; text: string; minAnte: number }
export const BOSSES: BossDef[] = [
  { id: 'thorn', name: 'The Thorn', icon: '🥀', text: '♥ cards score nothing', minAnte: 1 },
  { id: 'rust', name: 'The Rust', icon: '🟫', text: '♦ cards score nothing', minAnte: 1 },
  { id: 'gloom', name: 'The Gloom', icon: '🌑', text: '♠ cards score nothing', minAnte: 1 },
  { id: 'bramble', name: 'The Bramble', icon: '🌿', text: '♣ cards score nothing', minAnte: 1 },
  { id: 'drought', name: 'The Drought', icon: '🏜️', text: 'No redeals', minAnte: 1 },
  { id: 'vise', name: 'The Vise', icon: '🗜️', text: '−15 plays', minAnte: 2 },
  { id: 'veil', name: 'The Veil', icon: '🎭', text: 'J, Q, K score nothing', minAnte: 2 },
  { id: 'stall', name: 'The Stall', icon: '🧱', text: 'Streaks never build', minAnte: 2 },
  { id: 'hush', name: 'The Hush', icon: '🤫', text: 'Your leftmost joker is disabled', minAnte: 3 },
  { id: 'wall', name: 'The Wall', icon: '🏯', text: 'Target is ×3 instead of ×2', minAnte: 4 },
];
export const BOSS = Object.fromEntries(BOSSES.map((b) => [b.id, b])) as Record<BossId, BossDef>;

export type OmenId = 'anvil' | 'kiln' | 'geode' | 'gild' | 'horseshoe' | 'forge' | 'windfall' | 'sundial' | 'wellspring';
export interface OmenDef { id: OmenId; name: string; icon: string; text: string; cost: number; blindOnly?: boolean; enh?: Enh; count?: number }
export const OMENS: OmenDef[] = [
  { id: 'anvil', name: 'The Anvil', icon: '⚒️', text: '3 random cards become Etched (+30 chips)', cost: 3, enh: 'etched', count: 3 },
  { id: 'kiln', name: 'The Kiln', icon: '🏺', text: '2 random cards become Inked (+4 mult)', cost: 3, enh: 'inked', count: 2 },
  { id: 'geode', name: 'The Geode', icon: '💎', text: '1 random card becomes Crystal (×2 mult, may shatter)', cost: 3, enh: 'crystal', count: 1 },
  { id: 'gild', name: 'The Gild', icon: '🪙', text: '2 random cards become Gilded (+$2 when played)', cost: 3, enh: 'gilded', count: 2 },
  { id: 'horseshoe', name: 'The Horseshoe', icon: '🧲', text: '2 random cards become Charmed', cost: 3, enh: 'charmed', count: 2 },
  { id: 'forge', name: 'The Forge', icon: '⚙️', text: '1 random card becomes Iron (×1.5 mult)', cost: 3, enh: 'iron', count: 1 },
  { id: 'windfall', name: 'Windfall', icon: '💰', text: 'Double your money (max +$20)', cost: 4 },
  { id: 'sundial', name: 'The Sundial', icon: '☀️', text: '+10 plays this blind (use during a blind)', cost: 3, blindOnly: true },
  { id: 'wellspring', name: 'Wellspring', icon: '⛲', text: '+1 redeal this blind (use during a blind)', cost: 3, blindOnly: true },
];
export const OMEN = Object.fromEntries(OMENS.map((o) => [o.id, o])) as Record<OmenId, OmenDef>;

export interface JokerInst { id: JokerId; ed?: Edition; n?: number }
export type ShopItem = ({ kind: 'joker'; id: JokerId; ed?: Edition } | { kind: 'omen'; id: OmenId }) & { cost: number; sold?: boolean };
export interface ScoreStep { label: string; icon?: string; chips?: number; mult?: number; xmult?: number; money?: number; joker?: number; card?: string }
export interface ScoreEvent { id: number; steps: ScoreStep[]; chips: number; mult: number; total: number }
export interface Payout { reward: number; leftover: number; interest: number; total: number }
export interface RunStats { bestPlay: number; blindsWon: number; plays: number }
export interface Run {
  v: 1;
  seed: number;
  rngN: number;
  ante: number;
  blind: 0 | 1 | 2;
  phase: 'blind' | 'shop' | 'over' | 'won';
  money: number;
  jokers: JokerInst[];
  omens: OmenId[];
  enh: Record<string, Enh>;
  boss: BossId;
  board: Board;
  score: number;
  target: number;
  plays: number;
  redeals: number;
  streak: number;
  scored: string[];
  cascaded: string[];
  cleared: number[];
  shop: ShopItem[];
  rerollCost: number;
  last: ScoreEvent | null;
  payout: Payout | null;
  note: string | null;
  /** Set during a blind when no reachable card or useful move is left (computed with full information, so it doesn't leak hidden cards). */
  stuck?: boolean;
  stats: RunStats;
  startedAt: number;
}
export type Action =
  | { t: 'move'; from: Loc; to: Target }
  | { t: 'draw' }
  | { t: 'buy'; i: number }
  | { t: 'sell'; i: number }
  | { t: 'reroll' }
  | { t: 'use'; i: number }
  | { t: 'next' }
  | { t: 'shift'; i: number; dir: -1 | 1 }
  | { t: 'forfeit' };

function rnd(r: Run): number {
  r.rngN = (r.rngN + 1) >>> 0;
  return mulberry32((r.seed ^ Math.imul(r.rngN, 0x9e3779b1)) >>> 0)();
}
const pick = <T,>(r: Run, xs: readonly T[]): T => xs[Math.floor(rnd(r) * xs.length)];

export function blindTarget(ante: number, blind: 0 | 1 | 2, boss?: BossId): number {
  const base = ANTE_BASE[Math.min(ante, MAX_ANTE)] ?? ANTE_BASE[MAX_ANTE];
  const m = blind === 2 && boss === 'wall' ? 3 : BLIND_MULT[blind];
  return Math.round(base * m);
}
const has = (r: Run, id: JokerId) => activeJokers(r).some((j) => j.id === id);
/** Jokers that work right now (the Hush boss switches off the leftmost one). */
export function activeJokers(r: Run): JokerInst[] {
  return r.phase === 'blind' && r.blind === 2 && r.boss === 'hush' ? r.jokers.slice(1) : r.jokers;
}
export function interestCap(r: Run): number { return r.jokers.some((j) => j.id === 'compound') ? 10 : INTEREST_CAP; }
export function interestFor(r: Run): number { return Math.min(interestCap(r), Math.floor(Math.max(0, r.money) / INTEREST_PER)); }

function rollBoss(r: Run): BossId {
  const pool = BOSSES.filter((b) => b.minAnte <= r.ante);
  return pick(r, pool).id;
}

function startBlind(r: Run): void {
  r.phase = 'blind';
  r.board = kDeal(Math.floor(rnd(r) * 2 ** 31), 0);
  r.target = blindTarget(r.ante, r.blind, r.boss);
  const boss = r.blind === 2 ? r.boss : null;
  r.plays = BASE_PLAYS + (has(r, 'pocketwatch') ? 8 : 0) - (has(r, 'hourglass') ? 10 : 0) - (boss === 'vise' ? 15 : 0);
  r.redeals = boss === 'drought' ? 0 : BASE_REDEALS + (has(r, 'secondwind') ? 1 : 0);
  r.score = 0;
  r.streak = 0;
  r.scored = [];
  r.cascaded = [];
  r.cleared = [];
  r.last = null;
}

export function newRun(seed: number, now = Date.now()): Run {
  const r: Run = {
    v: 1, seed: seed >>> 0, rngN: 0, ante: 1, blind: 0, phase: 'blind', money: START_MONEY, jokers: [], omens: [], enh: {},
    boss: 'thorn', board: kDeal(0, 0), score: 0, target: 0, plays: 0, redeals: 0, streak: 0, scored: [], cascaded: [], cleared: [],
    shop: [], rerollCost: REROLL_BASE, last: null, payout: null, note: null, stats: { bestPlay: 0, blindsWon: 0, plays: 0 }, startedAt: now,
  };
  r.boss = rollBoss(r);
  startBlind(r);
  r.stuck = isStuck(r.board, r.redeals > 0);
  return r;
}

function rollEdition(r: Run): Edition | undefined {
  const x = rnd(r);
  return x < 0.02 ? 'opal' : x < 0.06 ? 'neon' : x < 0.14 ? 'gilt' : undefined;
}
function rollJoker(r: Run, taken: Set<JokerId>): ShopItem | null {
  const pool = JOKERS.filter((j) => !taken.has(j.id));
  if (!pool.length) return null;
  const weights = pool.map((j) => (j.rarity === 1 ? 6 : j.rarity === 2 ? 3 : 1));
  let x = rnd(r) * weights.reduce((a, b) => a + b, 0);
  let def = pool[pool.length - 1];
  for (let i = 0; i < pool.length; i++) { x -= weights[i]; if (x < 0) { def = pool[i]; break; } }
  taken.add(def.id);
  const ed = rollEdition(r);
  return { kind: 'joker', id: def.id, ...(ed ? { ed } : {}), cost: def.cost + (ed ? EDITION_INFO[ed].cost : 0) };
}
function rollShop(r: Run): void {
  const taken = new Set<JokerId>(r.jokers.map((j) => j.id));
  const items: ShopItem[] = [];
  for (let i = 0; i < 2; i++) { const j = rollJoker(r, taken); if (j) items.push(j); }
  const o = pick(r, OMENS);
  items.push({ kind: 'omen', id: o.id, cost: o.cost });
  r.shop = items;
}

export function sellValue(j: JokerInst): number {
  return Math.max(1, Math.floor((JOKER[j.id].cost + (j.ed ? EDITION_INFO[j.ed].cost : 0)) / 2));
}
export function payoutFor(r: Run): Payout {
  const reward = BLIND_REWARD[r.blind];
  const leftover = Math.floor(Math.max(0, r.plays) / (r.jokers.some((j) => j.id === 'thriftjar') ? 3 : 5));
  const interest = interestFor(r);
  return { reward, leftover, interest, total: reward + leftover + interest };
}

function winBlind(r: Run): void {
  const p = payoutFor(r);
  r.payout = p;
  r.money += p.total;
  r.stats.blindsWon++;
  if (r.blind === 2 && r.ante >= MAX_ANTE) { r.phase = 'won'; return; }
  r.phase = 'shop';
  r.rerollCost = REROLL_BASE;
  if (r.blind === 2) { r.ante++; r.blind = 0; r.boss = rollBoss(r); } else r.blind = (r.blind + 1) as 0 | 1 | 2;
  rollShop(r);
}

/** Does this card score nothing in the current boss blind? */
export function isDebuffed(r: Run, c: Card): boolean {
  if (r.phase !== 'blind' || r.blind !== 2) return false;
  switch (r.boss) {
    case 'thorn': return c.suit === 'H';
    case 'rust': return c.suit === 'D';
    case 'gloom': return c.suit === 'S';
    case 'bramble': return c.suit === 'C';
    case 'veil': return c.rank >= 11;
    default: return false;
  }
}
const RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUIT_SYM: Record<Card['suit'], string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const cardLabel = (c: Card) => `${RANK_LABEL[c.rank]}${SUIT_SYM[c.suit]}`;
export const rankChips = (rank: number) => (rank === 1 ? 11 : Math.min(10, rank));

let eventSeq = 0;
/** Score one play. Mutates r (score, money, joker counters, enhancements). Returns the event, or null if it scored nothing. */
export function scorePlay(r: Run, ctx: Omit<PlayCtx, 'streak' | 'money' | 'emptySlots' | 'debuffed'>): ScoreEvent | null {
  const card = ctx.card;
  const debuffed = !!card && isDebuffed(r, card);
  const streak = r.blind === 2 && r.boss === 'stall' ? 0 : r.streak;
  const full: PlayCtx = { ...ctx, debuffed, streak, money: r.money, emptySlots: JOKER_SLOTS - r.jokers.length };
  const steps: ScoreStep[] = [];
  let chips = 0, mult = 0;
  if (card) {
    if (debuffed) steps.push({ label: `${cardLabel(card)} debuffed`, icon: BOSS[r.boss].icon, card: card.id });
    else {
      const ch = 5 + rankChips(card.rank);
      chips += ch; mult += 1 + streak;
      steps.push({ label: `Foundation ${cardLabel(card)}`, chips: ch, mult: 1 + streak, card: card.id });
      if (streak) steps[steps.length - 1].label += ` · streak ${streak}`;
    }
  }
  if (ctx.reveal) { chips += 15; mult += 1; steps.push({ label: 'Reveal', chips: 15, mult: 1 }); }
  if (ctx.cascade >= 2) { chips += 10 * ctx.cascade; mult += ctx.cascade - 1; steps.push({ label: `Cascade ×${ctx.cascade}`, chips: 10 * ctx.cascade, mult: ctx.cascade - 1 }); }
  if (ctx.clear) { chips += 40; mult += 2; steps.push({ label: 'Column cleared', chips: 40, mult: 2 }); }
  if (ctx.suitDone) { chips += 100; steps.push({ label: 'Suit complete', chips: 100, xmult: 2 }); }
  if (chips <= 0) return null;
  mult = Math.max(1, mult);
  if (ctx.suitDone) mult *= 2;
  // card enhancement
  const e = card && !debuffed ? r.enh[card.id] : undefined;
  if (e && card) {
    const lab = `${ENH_INFO[e].name} ${cardLabel(card)}`;
    if (e === 'etched') { chips += 30; steps.push({ label: lab, chips: 30, card: card.id }); }
    else if (e === 'inked') { mult += 4; steps.push({ label: lab, mult: 4, card: card.id }); }
    else if (e === 'iron') { mult *= 1.5; steps.push({ label: lab, xmult: 1.5, card: card.id }); }
    else if (e === 'gilded') { r.money += 2; steps.push({ label: lab, money: 2, card: card.id }); }
    else if (e === 'crystal') {
      mult *= 2; steps.push({ label: lab, xmult: 2, card: card.id });
      if (rnd(r) < 0.25) { delete r.enh[card.id]; steps.push({ label: `${cardLabel(card)} shattered!`, icon: '💥' }); }
    } else if (e === 'charmed') {
      if (rnd(r) < 0.2) { mult += 20; steps.push({ label: `${lab} lucky!`, mult: 20, card: card.id }); }
      if (rnd(r) < 1 / 15) { r.money += 10; steps.push({ label: `${lab} jackpot!`, money: 10, card: card.id }); }
    }
  }
  // jokers, left to right (edition bonuses apply with their joker)
  const active = activeJokers(r);
  const offset = r.jokers.length - active.length;
  active.forEach((j, k) => {
    const def = JOKER[j.id];
    const idx = k + offset;
    if (j.ed === 'gilt') { chips += 50; steps.push({ label: `${def.name} · Gilt`, icon: def.icon, chips: 50, joker: idx }); }
    if (j.ed === 'neon') { mult += 10; steps.push({ label: `${def.name} · Neon`, icon: def.icon, mult: 10, joker: idx }); }
    const fx = def.fx?.(full, j);
    if (fx) {
      if (fx.chips) chips += fx.chips;
      if (fx.mult) mult += fx.mult;
      if (fx.xmult) mult *= fx.xmult;
      if (fx.money) r.money += fx.money;
      steps.push({ label: def.name, icon: def.icon, ...fx, joker: idx });
    }
    if (j.ed === 'opal') { mult *= 1.5; steps.push({ label: `${def.name} · Opal`, icon: def.icon, xmult: 1.5, joker: idx }); }
  });
  mult = Math.round(mult * 100) / 100;
  const total = Math.floor(chips * mult);
  r.score += total;
  r.stats.bestPlay = Math.max(r.stats.bestPlay, total);
  return { id: ++eventSeq, steps, chips, mult, total };
}

function fail(msg: string): never { throw new Error(msg); }

/** One card move: checks plays, scores it once per card per blind, then settles the blind (won / out of plays). */
function applyMove(r: Run, from: Loc, to: Target): void {
  if (r.plays <= 0) fail('No plays left.');
  if (!canMove(r.board, from, to)) fail('That move is not allowed.');
  const cards = pickup(r.board, from)!;
  if (to.kind === 'tableau' && from.kind === 'foundation') { /* allowed, scores nothing */ }
  const srcPile = from.kind === 'tableau' ? r.board.tableau[from.index] : null;
  const willReveal = !!srcPile && from.kind === 'tableau' && from.cardIndex > 0 && !srcPile[from.cardIndex - 1].faceUp;
  const willClear = !!srcPile && from.kind === 'tableau' && from.cardIndex === 0 && !r.cleared.includes(from.index);
  const next = kMove(r.board, from, to)!;
  r.board = next;
  r.plays--;
  r.stats.plays++;
  const toFoundation = to.kind === 'foundation';
  const head = cards[0];
  const firstTime = toFoundation && !r.scored.includes(head.id);
  if (firstTime) r.scored.push(head.id);
  let cascade = 0;
  if (!toFoundation && cards.length >= 2 && !r.cascaded.includes(head.id)) { cascade = cards.length; r.cascaded.push(head.id); }
  if (willClear) r.cleared.push(from.index);
  const suitDone = toFoundation && firstTime && next.foundations[to.index].length === 13;
  const ev = scorePlay(r, { card: firstTime ? head : null, reveal: willReveal, cascade, clear: willClear, suitDone });
  r.last = ev;
  if (firstTime) r.streak++;
  else if (!has(r, 'tightrope')) r.streak = 0;
  if (r.score >= r.target) winBlind(r);
  else if (r.plays <= 0) { r.phase = 'over'; r.note = 'Out of plays.'; }
}

function applyDraw(r: Run): void {
  const b = r.board;
  if (!b.stock.length) {
    if (!b.waste.length) fail('The stock is empty.');
    if (r.redeals <= 0) fail('No redeals left.');
    r.redeals--;
  }
  r.board = kDraw(b)!;
  r.last = null;
}

function enhanceRandom(r: Run, e: Enh, n: number): string[] {
  const ids: string[] = [];
  for (const s of ['S', 'H', 'D', 'C']) for (let k = 1; k <= 13; k++) ids.push(`${s}${k}`);
  const pool = ids.filter((id) => !r.enh[id]);
  const out: string[] = [];
  for (let i = 0; i < n && pool.length; i++) {
    const id = pool.splice(Math.floor(rnd(r) * pool.length), 1)[0];
    r.enh[id] = e;
    out.push(id);
  }
  return out;
}

/** Names only the enhanced cards the player can already see; hidden ones are just counted. */
export function enhanceNote(r: Run, omen: string, ids: string[], enh: string): string {
  const seen = new Set<string>();
  if (r.phase === 'blind') {
    const b = r.board;
    for (const c of [...b.waste, ...b.foundations.flat(), ...b.tableau.flat()]) if (c.faceUp) seen.add(c.id);
  }
  const shown = ids.filter((x) => seen.has(x)).map((x) => cardLabel({ id: x, suit: x[0] as Card['suit'], rank: Number(x.slice(1)), faceUp: true }));
  const hidden = ids.length - shown.length;
  const parts = [...shown];
  if (hidden) parts.push(shown.length ? `${hidden} hidden card${hidden > 1 ? 's' : ''}` : `${hidden} card${hidden > 1 ? 's' : ''}`);
  return `${omen}: ${parts.join(' and ')} became ${enh}.`;
}

function useOmen(r: Run, i: number): void {
  const id = r.omens[i] ?? fail('No omen there.');
  const o = OMEN[id];
  if (o.blindOnly && r.phase !== 'blind') fail('Use that during a blind.');
  if (o.enh) {
    const ids = enhanceRandom(r, o.enh, o.count ?? 1);
    r.note = enhanceNote(r, o.name, ids, ENH_INFO[o.enh].name);
  } else if (id === 'windfall') { const add = Math.min(20, Math.max(0, r.money)); r.money += add; r.note = `Windfall: +$${add}.`; }
  else if (id === 'sundial') { r.plays += 10; r.note = '+10 plays.'; }
  else if (id === 'wellspring') { r.redeals += 1; r.note = '+1 redeal.'; }
  r.omens.splice(i, 1);
}

/** Apply one player action to a copy of the run. Throws Error with a player-facing message if illegal. */
export function act(run: Run, a: Action): Run {
  const r: Run = structuredClone(run);
  r.note = null;
  if (!a || typeof a !== 'object') fail('Bad action.');
  if (r.phase === 'over' || r.phase === 'won') fail('This run is over. Start a new one.');
  switch (a.t) {
    case 'move':
      if (r.phase !== 'blind') fail('Not in a blind.');
      r.payout = null;
      applyMove(r, a.from, a.to);
      break;
    case 'draw':
      if (r.phase !== 'blind') fail('Not in a blind.');
      applyDraw(r);
      break;
    case 'forfeit':
      r.phase = 'over'; r.note = r.stuck ? 'No moves left.' : 'Run abandoned.';
      break;
    case 'use':
      useOmen(r, a.i);
      if (r.phase === 'blind' && r.score >= r.target) winBlind(r);
      break;
    case 'sell': {
      const j = r.jokers[a.i] ?? fail('No joker there.');
      r.money += sellValue(j);
      r.jokers.splice(a.i, 1);
      if (r.phase === 'blind') r.plays = Math.max(1, r.plays + (j.id === 'hourglass' ? 10 : 0));
      break;
    }
    case 'shift': {
      const k = a.i + a.dir;
      if (!r.jokers[a.i] || !r.jokers[k]) fail('Cannot move that joker.');
      [r.jokers[a.i], r.jokers[k]] = [r.jokers[k], r.jokers[a.i]];
      break;
    }
    case 'buy': {
      if (r.phase !== 'shop') fail('The shop is closed.');
      const it = r.shop[a.i] ?? fail('Nothing there.');
      if (it.sold) fail('Already bought.');
      if (r.money < it.cost) fail('Not enough money.');
      if (it.kind === 'joker') {
        if (r.jokers.length >= JOKER_SLOTS) fail('Joker slots full. Sell one first.');
        r.jokers.push({ id: it.id, ...(it.ed ? { ed: it.ed } : {}) });
      } else {
        if (r.omens.length >= OMEN_SLOTS) fail('Omen slots full. Use one first.');
        r.omens.push(it.id);
      }
      r.money -= it.cost;
      it.sold = true;
      break;
    }
    case 'reroll':
      if (r.phase !== 'shop') fail('The shop is closed.');
      if (r.money < r.rerollCost) fail('Not enough money.');
      r.money -= r.rerollCost;
      r.rerollCost++;
      rollShop(r);
      break;
    case 'next':
      if (r.phase !== 'shop') fail('Not in the shop.');
      r.payout = null;
      startBlind(r);
      break;
    default:
      fail('Unknown action.');
  }
  r.stuck = r.phase === 'blind' ? isStuck(r.board, r.redeals > 0) : false;
  return r;
}

/** The highest ante a run has reached (a won run counts as MAX_ANTE). */
export const anteReached = (r: Run) => Math.min(MAX_ANTE, r.ante);

/** What a client is allowed to see: face-down cards and the stock order are hidden, and the seed is withheld. */
export function viewRun(r: Run): Run {
  const hide = (c: Card, i: number): Card => (c.faceUp ? c : { id: `x${i}`, suit: 'S', rank: 0, faceUp: false });
  let n = 0;
  return {
    ...r,
    seed: 0,
    rngN: 0,
    board: {
      ...r.board,
      stock: r.board.stock.map((c) => hide(c, n++)),
      tableau: r.board.tableau.map((p) => p.map((c) => hide(c, n++))),
    },
  };
}

export function isRun(x: unknown): x is Run {
  if (!x || typeof x !== 'object') return false;
  const r = x as Run;
  return r.v === 1 && typeof r.seed === 'number' && typeof r.ante === 'number' && Array.isArray(r.jokers) && !!r.board && Array.isArray(r.board?.tableau);
}

/** Leaderboard row for Solitro (humans only; QA rows filtered by the shared boardFor rule). */
export interface SolitroStanding { name: string; bestAnte: number; bestPlay: number; runs: number; wins: number; qa?: true }
