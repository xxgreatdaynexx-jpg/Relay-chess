/**
 * Chud Conquest: an original territory-conquest board game for 2–6 players.
 * Pure, server-authoritative rules. The map (the Chudlands) and all names are original.
 */
import { CQ_MAPS, mapById, type Continent, type CqMap } from './conquest-maps.js';
export { CQ_MAPS, mapById, type Continent, type CqMap, type Pt, type Territory } from './conquest-maps.js';
const CHUD = mapById('chud');
/** The original Chudlands map (kept as top-level exports for older callers). */
export const CONTINENTS = CHUD.continents;
export const TERRITORIES = CHUD.territories;
export const EDGES = CHUD.edges;
export const ADJ = CHUD.adj;
export const adjacent = (a: number, b: number, m: CqMap = CHUD) => m.adj[a]?.includes(b) ?? false;
export const mapOf = (s: { map?: string }): CqMap => mapById(s.map);

/** Original factions. Each has its own unit art (client), default colour and an optional perk. */
export interface Faction { id: string; name: string; short: string; color: number; motto: string; perk: string; perkText: string }
export const FACTIONS: Faction[] = [
  { id: 'grande', name: 'Grande Armée du Chud', short: 'Grande Armée', color: 2, motto: 'Shakos, bayonets and eagles.', perk: 'Élan', perkText: 'Attacking with 3 dice, your highest die wins ties.' },
  { id: 'redcoat', name: 'Chudshire Redcoats', short: 'Redcoats', color: 1, motto: 'Volley fire and the thin red line.', perk: 'Thin Red Line', perkText: 'Defending a territory of 5+ armies, your highest die gets +1 (max 6).' },
  { id: 'cossack', name: 'Steppe Cossacks', short: 'Cossacks', color: 4, motto: 'Sabres, fur hats and fast horses.', perk: 'Raiders', perkText: 'Your first conquest each turn adds 1 free army to the land you took.' },
  { id: 'samurai', name: 'Kuro Samurai', short: 'Samurai', color: 6, motto: 'Katana, kabuto and the rising sun.', perk: 'Bushido', perkText: 'Card trades give you 2 extra armies.' },
  { id: 'marines', name: 'Iron Tide Marines', short: 'Marines', color: 5, motto: 'Helmets, rifles and tanks off the landing craft.', perk: 'Amphibious', perkText: 'Attacking across a sea lane, your highest die gets +1 (max 6).' },
  { id: 'robots', name: 'Robot Legion', short: 'Robots', color: 7, motto: 'Chrome, lasers and the assembly line.', perk: 'Assembly Line', perkText: '+1 reinforcement every turn.' },
];
export const factionById = (id: string | undefined) => FACTIONS.find((f) => f.id === id);

/** Army colours a table can pick from (index into this list). */
export const CQ_PALETTE = ['#d9ae66', '#b23b3b', '#4f8fc0', '#8a5fb5', '#e9e2d4', '#4fa36b', '#d9773a', '#3fb3a8'];
export const CQ_PALETTE_NAMES = ['Gold', 'Crimson', 'Sky', 'Violet', 'Bone', 'Moss', 'Rust', 'Teal'];
export type Phase = 'setup' | 'reinforce' | 'attack' | 'fortify' | 'over';
/** s: 0 foot, 1 horse, 2 cannon, 3 wild. t: territory or -1. */
export interface Card { t: number; s: 0 | 1 | 2 | 3 }
export interface CqPlayer { name: string; bot: boolean; alive: boolean; cards: Card[]; color?: number; faction?: string }
export interface Roll { from: number; to: number; att: number[]; def: number[]; attLost: number; defLost: number; conquered: boolean }
export interface CqState {
  players: CqPlayer[];
  owner: number[];
  armies: number[];
  turn: number;
  phase: Phase;
  reserve: number;
  conquered: boolean;
  pending: { from: number; to: number; min: number } | null;
  trades: number;
  deck: Card[];
  winner: number | null;
  lastRoll: Roll | null;
  fortified: boolean;
  log: string[];
  round: number;
  /** Starting armies each player still has to place (setup phase only). */
  setup?: number[];
  /** Map id (absent = the Chudlands). */
  map?: string;
  /** Faction perks on (absent/false = pure classic rules). */
  perks?: boolean;
  /** Conquests this turn (for perks). */
  took?: number;
}
export type Rng = () => number;

export const START_ARMIES: Record<number, number> = { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 };
export const tradeValue = (n: number) => (n < 5 ? 4 + 2 * n : 15 + 5 * (n - 5));

function shuffle<X>(a: X[], rng: Rng): X[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}

export class RuleError extends Error {}
const need = (ok: unknown, msg: string): void => { if (!ok) throw new RuleError(msg); };

/** Deal territories round-robin, one army each, then spread the remaining starting armies randomly. */
export interface NewGameOpts { manualSetup?: boolean; map?: string; perks?: boolean }
export function newGame(players: Array<{ name: string; bot: boolean; color?: number; faction?: string }>, rng: Rng = Math.random, opts: NewGameOpts = {}): CqState {
  need(players.length >= 2 && players.length <= 6, 'Conquest needs 2–6 players.');
  const n = players.length;
  const m = mapById(opts.map);
  const TERRITORIES = m.territories;
  const order = shuffle(TERRITORIES.map((t) => t.id), rng);
  const owner = new Array<number>(TERRITORIES.length).fill(0);
  order.forEach((t, i) => { owner[t] = i % n; });
  const armies = new Array<number>(TERRITORIES.length).fill(1);
  const setup = players.map((_, p) => START_ARMIES[n]! - owner.filter((o) => o === p).length);
  const deck = shuffle<Card>([...TERRITORIES.map((t) => ({ t: t.id, s: (t.id % 3) as 0 | 1 | 2 })), { t: -1, s: 3 }, { t: -1, s: 3 }], rng);
  const s: CqState = {
    players: players.map((p, i) => ({ name: p.name, bot: p.bot, alive: true, cards: [], color: p.color ?? i, ...(p.faction ? { faction: p.faction } : {}) })), owner, armies, turn: 0, phase: 'reinforce', reserve: 0,
    conquered: false, pending: null, trades: 0, deck, winner: null, lastRoll: null, fortified: false, log: [], round: 1,
  };
  s.setup = setup;
  if (m.id !== 'chud') s.map = m.id;
  if (opts.perks) s.perks = true;
  if (opts.manualSetup) {
    s.phase = 'setup';
    s.log.push('Place your starting armies.');
    s.players.forEach((pl, p) => { if (pl.bot) autoPlace(s, p, rng); });
    if (s.setup.every((x) => x === 0)) beginWar(s);
  } else {
    s.players.forEach((_, p) => autoPlace(s, p, rng));
    beginWar(s);
  }
  return s;
}

/** Spread a player's remaining starting armies: mostly onto border territories, a few at random. */
export function autoPlace(s: CqState, p: number, rng: Rng = Math.random): void {
  const left = s.setup?.[p] ?? 0;
  const mine = s.owner.map((o, t) => (o === p ? t : -1)).filter((t) => t >= 0);
  const border = mine.filter((t) => mapOf(s).adj[t]!.some((n) => s.owner[n] !== p));
  const pool = border.length ? border : mine;
  for (let i = 0; i < left; i++) { const from = rng() < 0.75 ? pool : mine; s.armies[from[Math.floor(rng() * from.length)]!]! += 1; }
  if (s.setup) s.setup[p] = 0;
}

function beginWar(s: CqState): void {
  s.phase = 'reinforce'; s.turn = Math.max(0, s.players.findIndex((x) => x.alive));
  s.reserve = reinforcements(s, s.turn);
  s.log.push(`${s.players[s.turn]!.name} starts.`);
}

export const owned = (s: CqState, p: number) => s.owner.reduce((k, o) => k + (o === p ? 1 : 0), 0);
export function continentsHeld(s: CqState, p: number): Continent[] {
  const m = mapOf(s);
  return m.continents.filter((c) => m.territories.every((t) => t.continent !== c.id || s.owner[t.id] === p));
}
/** max(3, territories ÷ 3) plus continent bonuses. */
export function reinforcements(s: CqState, p: number): number {
  return Math.max(3, Math.floor(owned(s, p) / 3)) + continentsHeld(s, p).reduce((k, c) => k + c.bonus, 0) + (perk(s, p, 'robots') ? 1 : 0);
}

export function validSet(cards: Card[]): boolean {
  if (cards.length !== 3) return false;
  const wild = cards.filter((c) => c.s === 3).length;
  if (wild > 0) return true;
  const kinds = new Set(cards.map((c) => c.s));
  return kinds.size === 1 || kinds.size === 3;
}
/** Index triple of some tradeable set in a hand, or null. */
export function findSet(cards: Card[]): number[] | null {
  for (let a = 0; a < cards.length; a++) for (let b = a + 1; b < cards.length; b++) for (let c = b + 1; c < cards.length; c++) {
    if (validSet([cards[a]!, cards[b]!, cards[c]!])) return [a, b, c];
  }
  return null;
}

/** Whether player p's faction perk applies (perks on and they play that faction). */
export const perk = (s: CqState, p: number, faction: string) => Boolean(s.perks && s.players[p]?.faction === faction);

/** Compare highest dice pairwise; defender wins ties. */
export function resolveDice(att: number[], def: number[], attWinsTopTie = false): { attLost: number; defLost: number } {
  const a = [...att].sort((x, y) => y - x), d = [...def].sort((x, y) => y - x);
  let attLost = 0, defLost = 0;
  for (let i = 0; i < Math.min(a.length, d.length); i++) { if (a[i]! > d[i]! || (i === 0 && attWinsTopTie && a[i] === d[i])) defLost++; else attLost++; }
  return { attLost, defLost };
}

/** Territories reachable from `from` through territories owned by the same player. */
export function connectedOwned(s: CqState, from: number): Set<number> {
  const p = s.owner[from];
  const seen = new Set([from]);
  const q = [from];
  const adj = mapOf(s).adj;
  while (q.length) { const t = q.pop()!; for (const n of adj[t]!) if (!seen.has(n) && s.owner[n] === p) { seen.add(n); q.push(n); } }
  return seen;
}

export type CqAction =
  | { type: 'place'; t: number; n: number }
  | { type: 'trade'; cards: number[] }
  | { type: 'attack'; from: number; to: number; dice: number }
  | { type: 'move'; n: number }
  | { type: 'endAttack' }
  | { type: 'fortify'; from: number; to: number; n: number }
  | { type: 'endTurn' }
  | { type: 'setupPlace'; t: number; n: number }
  | { type: 'autoPlace' };

const die = (rng: Rng) => 1 + Math.floor(rng() * 6);

/** Apply one action for player p. Mutates and returns s. Throws RuleError with a plain message. */
export function act(s: CqState, p: number, a: CqAction, rng: Rng = Math.random): CqState {
  need(s.phase !== 'over', 'The game is over.');
  const int = (x: unknown) => Number.isInteger(x) ? (x as number) : NaN;
  if (s.phase === 'setup') {
    // Everyone places their starting armies at the same time; the war begins when all are down.
    need(s.players[p]?.alive, 'You are not in this war.');
    const left = s.setup![p]!;
    if (a.type === 'autoPlace') autoPlace(s, p, rng);
    else {
      need(a.type === 'setupPlace', 'Place your starting armies first.');
      const { t: tt, n: nn } = a as { t: number; n: number };
      const t = int(tt), n = int(nn);
      need(s.owner[t] === p, 'Place armies on your own territory.');
      need(n >= 1 && n <= left, left ? `You have ${left} left to place.` : 'All your armies are placed. Waiting for the others.');
      s.armies[t]! += n; s.setup![p] = left - n;
    }
    if (s.setup!.every((x) => x === 0)) beginWar(s);
    return s;
  }
  need(p === s.turn, 'It is not your turn.');
  const me = s.players[p]!;
  switch (a.type) {
    case 'trade': {
      need(s.phase === 'reinforce', 'Trade cards during reinforcement.');
      const ix = [...new Set((a.cards ?? []).map(int))];
      need(ix.length === 3 && ix.every((i) => i >= 0 && i < me.cards.length), 'Pick three cards.');
      const set = ix.map((i) => me.cards[i]!);
      need(validSet(set), 'That is not a set: three alike, one of each, or any with a wild.');
      const value = tradeValue(s.trades++) + (perk(s, p, 'samurai') ? 2 : 0);
      s.reserve += value;
      const bonusT = set.find((c) => c.t >= 0 && s.owner[c.t] === p);
      if (bonusT) s.armies[bonusT.t]! += 2;
      me.cards = me.cards.filter((_, i) => !ix.includes(i));
      s.deck.push(...set);
      s.log.push(`${me.name} traded cards for ${value} armies.`);
      return s;
    }
    case 'place': {
      need(s.phase === 'reinforce', 'Not the reinforce phase.');
      const t = int(a.t), n = int(a.n);
      need(s.owner[t] === p, 'Place armies on your own territory.');
      need(n >= 1 && n <= s.reserve, `You have ${s.reserve} to place.`);
      need(n < s.reserve || me.cards.length < 5, 'You hold 5 or more cards: trade a set first.');
      s.armies[t]! += n; s.reserve -= n;
      if (s.reserve === 0) s.phase = 'attack';
      return s;
    }
    case 'attack': {
      need(s.phase === 'attack' && !s.pending, s.pending ? 'Move armies into the territory you took first.' : 'Not the attack phase.');
      const from = int(a.from), to = int(a.to);
      const m = mapOf(s);
      need(s.owner[from] === p && s.owner[to] !== p && adjacent(from, to, m), 'Attack a neighbouring enemy territory from one of yours.');
      const dice = Math.min(int(a.dice) || 3, 3, s.armies[from]! - 1);
      need(dice >= 1, 'You need at least 2 armies to attack.');
      const defender = s.owner[to]!;
      const att = Array.from({ length: dice }, () => die(rng));
      const def = Array.from({ length: Math.min(2, s.armies[to]!) }, () => die(rng));
      // Perks only lift a die already rolled (the shown dice are the ones that count).
      const sea = m.edges.some(([x, y, sw]) => sw && ((x === from && y === to) || (x === to && y === from)));
      const bump = (d: number[]) => { const i = d.indexOf(Math.max(...d)); d[i] = Math.min(6, d[i]! + 1); };
      if (sea && perk(s, p, 'marines')) bump(att);
      if (s.armies[to]! >= 5 && perk(s, defender, 'redcoat')) bump(def);
      const { attLost, defLost } = resolveDice(att, def, dice === 3 && perk(s, p, 'grande'));
      s.armies[from]! -= attLost; s.armies[to]! -= defLost;
      const conquered = s.armies[to] === 0;
      s.lastRoll = { from, to, att, def, attLost, defLost, conquered };
      if (conquered) {
        const loser = s.owner[to]!;
        s.owner[to] = p; s.conquered = true;
        s.pending = { from, to, min: dice };
        s.log.push(`${me.name} took ${m.territories[to]!.name}.`);
        s.took = (s.took ?? 0) + 1;
        if (owned(s, loser) === 0) {
          const victim = s.players[loser]!;
          victim.alive = false;
          me.cards.push(...victim.cards); victim.cards = [];
          s.log.push(`${victim.name} was eliminated by ${me.name}.`);
          if (s.players.filter((x) => x.alive).length === 1) {
            s.armies[to] = s.armies[from]! - 1; s.armies[from] = 1; s.pending = null;
            s.phase = 'over'; s.winner = p;
            s.log.push(`${me.name} conquered ${m.id === 'chud' ? 'the Chudlands' : m.name}!`);
            return s;
          }
          // Holding 6+ after an elimination: trade down now (back to reinforce until under 5).
          if (me.cards.length >= 6) s.log.push(`${me.name} must trade cards.`);
        }
      }
      return s;
    }
    case 'move': {
      need(s.pending, 'Nothing to move.');
      const { from, to, min } = s.pending!;
      const n = int(a.n);
      need(n >= min && n <= s.armies[from]! - 1, `Move between ${min} and ${s.armies[from]! - 1}.`);
      s.armies[from]! -= n; s.armies[to] = n; s.pending = null;
      if (s.took === 1 && perk(s, p, 'cossack')) { s.armies[to]! += 1; s.log.push(`${me.name}'s raiders add 1 army.`); }
      if (me.cards.length >= 6) { s.phase = 'reinforce'; s.reserve = 0; }
      return s;
    }
    case 'endAttack': {
      need(s.phase === 'attack' && !s.pending, 'Finish the move first.');
      s.phase = 'fortify';
      return s;
    }
    case 'fortify': {
      need(s.phase === 'fortify' || (s.phase === 'attack' && !s.pending), 'Not the fortify phase.');
      const from = int(a.from), to = int(a.to), n = int(a.n);
      need(from !== to && s.owner[from] === p && s.owner[to] === p, 'Fortify between your own territories.');
      need(connectedOwned(s, from).has(to), 'Those territories are not connected through yours.');
      need(n >= 1 && n <= s.armies[from]! - 1, 'Leave at least one army behind.');
      s.armies[from]! -= n; s.armies[to]! += n;
      return endTurn(s, rng);
    }
    case 'endTurn': {
      need(s.phase === 'attack' || s.phase === 'fortify', 'Place your reinforcements first.');
      need(!s.pending, 'Finish the move first.');
      return endTurn(s, rng);
    }
  }
  throw new RuleError('Unknown action.');
}

function endTurn(s: CqState, _rng: Rng): CqState {
  const me = s.players[s.turn]!;
  if (s.conquered && s.deck.length) me.cards.push(s.deck.shift()!);
  let next = s.turn;
  do { next = (next + 1) % s.players.length; if (next === 0) s.round++; } while (!s.players[next]!.alive);
  s.turn = next; s.phase = 'reinforce'; s.conquered = false; s.pending = null; s.fortified = false; s.took = 0;
  s.reserve = reinforcements(s, next);
  return s;
}

/** Remove a player who left mid-game: their territories stay with their armies but they are skipped (counts as a loss). */
export function resign(s: CqState, p: number, rng: Rng = Math.random): CqState {
  const pl = s.players[p];
  if (!pl || !pl.alive || s.phase === 'over') return s;
  const wasSetup = s.phase === 'setup';
  if (wasSetup) autoPlace(s, p, rng);
  pl.alive = false; pl.bot = true;
  s.log.push(`${pl.name} left the war.`);
  const alive = s.players.map((x, i) => (x.alive ? i : -1)).filter((i) => i >= 0);
  if (alive.length === 1) { s.phase = 'over'; s.winner = alive[0]!; return s; }
  if (wasSetup) { if (s.setup!.every((x) => x === 0)) beginWar(s); return s; }
  if (s.turn === p) { s.pending = null; endTurn(s, rng); }
  return s;
}

/** Chance-ish strength of an attack: attackers that can roll vs. defenders. */
const odds = (att: number, def: number) => (att - 1) / Math.max(1, def);

/**
 * One step of the house bot. Strategy: pick a target continent (the one it is closest to holding, weighted by bonus),
 * stack reinforcements on the border that attacks into it, attack at good odds (bolder to finish a continent or
 * knock out a weak player), always move the bigger stack forward, then fortify interior armies to the most threatened border.
 */
export function botAction(s: CqState, p: number): CqAction {
  if (s.phase === 'setup') return { type: 'autoPlace' };
  const me = s.players[p]!;
  const mine = s.owner.map((o, t) => (o === p ? t : -1)).filter((t) => t >= 0);
  const m = mapOf(s);
  const TERRITORIES = m.territories;
  const enemyN = (t: number) => m.adj[t]!.filter((n) => s.owner[n] !== p);
  const threat = (t: number) => enemyN(t).reduce((k, n) => k + s.armies[n]!, 0);
  const share = (c: Continent) => { const ts = TERRITORIES.filter((x) => x.continent === c.id); return ts.filter((x) => s.owner[x.id] === p).length / ts.length; };
  const goal = m.continents.filter((c) => share(c) < 1).sort((a, b) => (share(b) + b.bonus / 20) - (share(a) + a.bonus / 20))[0];
  const inGoal = (t: number) => goal !== undefined && TERRITORIES[t]!.continent === goal.id;
  const weakPlayer = (o: number) => owned(s, o) <= 2;

  if (s.pending) {
    const { from, to } = s.pending;
    // Keep defenders behind only if the source still borders enemies.
    const keep = threat(from) > 0 ? Math.min(Math.ceil(threat(from) / 3), s.armies[from]! - 1 - s.pending.min) : 0;
    void to;
    return { type: 'move', n: Math.max(s.pending.min, s.armies[from]! - 1 - Math.max(0, keep)) };
  }
  if (s.phase === 'reinforce') {
    const set = findSet(me.cards);
    if (set && (me.cards.length >= 4 || s.reserve === 0 || tradeValue(s.trades) >= 8)) return { type: 'trade', cards: set };
    if (s.reserve === 0) return set ? { type: 'trade', cards: set } : { type: 'endTurn' };
    const border = mine.filter((t) => threat(t) > 0);
    const score = (t: number) => {
      const targets = enemyN(t);
      const best = Math.max(0, ...targets.map((n) => (inGoal(n) ? 6 : 0) + (weakPlayer(s.owner[n]!) ? 4 : 0) + 8 - Math.min(8, s.armies[n]!)));
      return best + s.armies[t]! * 0.4 + (inGoal(t) ? 3 : 0);
    };
    const best = (border.length ? border : mine).sort((a, b) => score(b) - score(a))[0]!;
    return { type: 'place', t: best, n: s.reserve };
  }
  if (s.phase === 'attack') {
    let pick: [number, number, number] | null = null;
    for (const f of mine) for (const n of enemyN(f)) {
      if (s.armies[f]! < 2) continue;
      const r = odds(s.armies[f]!, s.armies[n]!);
      const bonus = (inGoal(n) ? 0.35 : 0) + (weakPlayer(s.owner[n]!) ? 0.4 : 0);
      const v = r + bonus;
      const ok = s.armies[f]! >= 3 ? v >= 1.25 : v >= 1.6 && s.armies[n] === 1;
      if (ok && (!pick || v > pick[2])) pick = [f, n, v];
    }
    if (pick) return { type: 'attack', from: pick[0], to: pick[1], dice: 3 };
    return { type: 'endAttack' };
  }
  if (s.phase === 'fortify') {
    const inner = mine.filter((t) => threat(t) === 0 && s.armies[t]! > 1).sort((a, b) => s.armies[b]! - s.armies[a]!)[0];
    if (inner !== undefined) {
      const reach = [...connectedOwned(s, inner)].filter((t) => threat(t) > 0).sort((a, b) => (threat(b) - s.armies[b]!) - (threat(a) - s.armies[a]!))[0];
      if (reach !== undefined) return { type: 'fortify', from: inner, to: reach, n: s.armies[inner]! - 1 };
    }
    return { type: 'endTurn' };
  }
  return { type: 'endTurn' };
}

/** What a client sees: other players' cards are hidden (count only), the deck is hidden. */
export function publicView(s: CqState, viewer: number) {
  return {
    ...s, map: mapOf(s).id, perks: Boolean(s.perks), deck: undefined, deckLeft: s.deck.length,
    players: s.players.map((pl, i) => ({ name: pl.name, bot: pl.bot, alive: pl.alive, color: pl.color ?? i, faction: pl.faction, setupLeft: s.setup?.[i] ?? 0, cardCount: pl.cards.length, cards: i === viewer ? pl.cards : undefined, territories: owned(s, i), armies: s.armies.reduce((k, a, t) => k + (s.owner[t] === i ? a : 0), 0) })),
    nextTrade: tradeValue(s.trades), log: s.log.slice(-12),
  };
}
export type CqView = ReturnType<typeof publicView>;
