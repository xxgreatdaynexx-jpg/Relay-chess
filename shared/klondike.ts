/** Pure Klondike solitaire logic (draw 1). No DOM, no React. */
export type Suit = 'S' | 'H' | 'D' | 'C';
export interface Card {
  id: string;
  suit: Suit;
  rank: number; // 1 = Ace ... 13 = King
  faceUp: boolean;
}
export interface GameState {
  stock: Card[];
  waste: Card[];
  foundations: Card[][]; // 4
  tableau: Card[][]; // 7
  moves: number;
  startedAt: number;
}
export type Loc =
  | { kind: 'waste' }
  | { kind: 'foundation'; index: number }
  | { kind: 'tableau'; index: number; cardIndex: number };
export type Target = { kind: 'foundation'; index: number } | { kind: 'tableau'; index: number };

export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
export const isRed = (s: Suit) => s === 'H' || s === 'D';

export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (let rank = 1; rank <= 13; rank++) deck.push({ id: `${suit}${rank}`, suit, rank, faceUp: false });
  return deck;
}

/** Deterministic PRNG so tests can seed deals. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function deal(seed = Math.floor(Math.random() * 2 ** 31), now = Date.now()): GameState {
  const rand = mulberry32(seed);
  const deck = makeDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const tableau: Card[][] = [];
  let k = 0;
  for (let p = 0; p < 7; p++) {
    const pile: Card[] = [];
    for (let c = 0; c <= p; c++) pile.push({ ...deck[k++], faceUp: c === p });
    tableau.push(pile);
  }
  return { stock: deck.slice(k).map((c) => ({ ...c, faceUp: false })), waste: [], foundations: [[], [], [], []], tableau, moves: 0, startedAt: now };
}

function clone(s: GameState): GameState {
  return {
    ...s,
    stock: s.stock.map((c) => ({ ...c })),
    waste: s.waste.map((c) => ({ ...c })),
    foundations: s.foundations.map((p) => p.map((c) => ({ ...c }))),
    tableau: s.tableau.map((p) => p.map((c) => ({ ...c }))),
  };
}

export function canPlaceOnFoundation(card: Card, pile: Card[]): boolean {
  const top = pile[pile.length - 1];
  if (!top) return card.rank === 1;
  return top.suit === card.suit && card.rank === top.rank + 1;
}

export function canPlaceOnTableau(card: Card, pile: Card[]): boolean {
  const top = pile[pile.length - 1];
  if (!top) return card.rank === 13;
  return top.faceUp && isRed(top.suit) !== isRed(card.suit) && card.rank === top.rank - 1;
}

/** Cards that would be picked up from a location, or null if not a legal pickup. */
export function pickup(s: GameState, from: Loc): Card[] | null {
  if (from.kind === 'waste') return s.waste.length ? [s.waste[s.waste.length - 1]] : null;
  if (from.kind === 'foundation') {
    const p = s.foundations[from.index];
    return p.length ? [p[p.length - 1]] : null;
  }
  const pile = s.tableau[from.index];
  if (from.cardIndex < 0 || from.cardIndex >= pile.length) return null;
  const run = pile.slice(from.cardIndex);
  if (!run.every((c) => c.faceUp)) return null;
  for (let i = 1; i < run.length; i++) {
    if (isRed(run[i].suit) === isRed(run[i - 1].suit) || run[i].rank !== run[i - 1].rank - 1) return null;
  }
  return run;
}

export function canMove(s: GameState, from: Loc, to: Target): boolean {
  const cards = pickup(s, from);
  if (!cards) return false;
  if (to.kind === 'foundation') {
    if (cards.length !== 1) return false;
    if (from.kind === 'foundation' && from.index === to.index) return false;
    return canPlaceOnFoundation(cards[0], s.foundations[to.index]);
  }
  if (from.kind === 'tableau' && from.index === to.index) return false;
  return canPlaceOnTableau(cards[0], s.tableau[to.index]);
}

/** Returns a new state, or null if illegal. Auto-flips the newly exposed tableau card. */
export function move(s: GameState, from: Loc, to: Target): GameState | null {
  if (!canMove(s, from, to)) return null;
  const n = clone(s);
  let cards: Card[];
  if (from.kind === 'waste') cards = [n.waste.pop()!];
  else if (from.kind === 'foundation') cards = [n.foundations[from.index].pop()!];
  else {
    const pile = n.tableau[from.index];
    cards = pile.splice(from.cardIndex);
    const top = pile[pile.length - 1];
    if (top) top.faceUp = true;
  }
  const dest = to.kind === 'foundation' ? n.foundations[to.index] : n.tableau[to.index];
  dest.push(...cards);
  n.moves++;
  return n;
}

/** Draw one from stock to waste; recycle waste when stock is empty. Null if both empty. */
export function draw(s: GameState): GameState | null {
  if (!s.stock.length && !s.waste.length) return null;
  const n = clone(s);
  if (n.stock.length) {
    const c = n.stock.pop()!;
    c.faceUp = true;
    n.waste.push(c);
  } else {
    n.stock = n.waste.reverse().map((c) => ({ ...c, faceUp: false }));
    n.waste = [];
  }
  n.moves++;
  return n;
}

/** Find a foundation the top card at `from` can go to. */
export function foundationTarget(s: GameState, from: Loc): Target | null {
  for (let i = 0; i < 4; i++) if (canMove(s, from, { kind: 'foundation', index: i })) return { kind: 'foundation', index: i };
  return null;
}

/** Best auto-move for a click: foundation first (single top card), else first legal tableau. */
export function autoTarget(s: GameState, from: Loc): Target | null {
  const cards = pickup(s, from);
  if (!cards) return null;
  if (cards.length === 1 && from.kind !== 'foundation') {
    const f = foundationTarget(s, from);
    if (f) return f;
  }
  return bestTableauTarget(s, from);
}

/** Best tableau target: a non-empty column first; an empty column only if the move frees something (never a king already at the bottom). */
export function bestTableauTarget(s: GameState, from: Loc): Target | null {
  let empty: Target | null = null;
  for (let i = 0; i < 7; i++) {
    if (!canMove(s, from, { kind: 'tableau', index: i })) continue;
    if (s.tableau[i].length) return { kind: 'tableau', index: i };
    if (!empty && !(from.kind === 'tableau' && from.cardIndex === 0)) empty = { kind: 'tableau', index: i };
  }
  return empty;
}

/**
 * True when the game can't make progress: no card the player can still reach (waste top, the cards left to draw, and the
 * whole waste if it can be recycled) fits anywhere, and no board move does anything useful. Useful board moves are any
 * tableau → foundation play, or a tableau → tableau move that turns a card over, empties a column, or uncovers a card
 * that can then go up or take a reachable card. Foundation → tableau moves and shuffling a king between empty columns
 * don't count (they can't break a deadlock on their own).
 */
export function isStuck(s: GameState, canRecycle: boolean): boolean {
  if (isWon(s)) return false;
  const fits = (c: Card) => s.foundations.some((f) => canPlaceOnFoundation(c, f)) || s.tableau.some((p) => canPlaceOnTableau(c, p));
  const reachable: Card[] = [...s.stock];
  if (canRecycle) reachable.push(...s.waste);
  else if (s.waste.length) reachable.push(s.waste[s.waste.length - 1]);
  if (reachable.some(fits)) return false;
  for (let i = 0; i < 7; i++) {
    const pile = s.tableau[i];
    for (let j = 0; j < pile.length; j++) {
      if (!pile[j].faceUp) continue;
      const from: Loc = { kind: 'tableau', index: i, cardIndex: j };
      const cards = pickup(s, from);
      if (!cards) continue;
      if (j === pile.length - 1 && foundationTarget(s, from)) return false;
      for (let k = 0; k < 7; k++) {
        if (!canMove(s, from, { kind: 'tableau', index: k })) continue;
        if (j === 0) { if (s.tableau[k].length) return false; continue; } // empties a column (a king to an empty column is pointless)
        const below = pile[j - 1];
        if (!below.faceUp) return false; // turns a card over
        if (s.foundations.some((f) => canPlaceOnFoundation(below, f))) return false;
        if (reachable.some((c) => canPlaceOnTableau(c, [below]))) return false;
      }
    }
  }
  return true;
}

export function isWon(s: GameState): boolean {
  return s.foundations.every((p) => p.length === 13);
}

export function isValidState(x: unknown): x is GameState {
  if (!x || typeof x !== 'object') return false;
  const s = x as GameState;
  if (!Array.isArray(s.stock) || !Array.isArray(s.waste) || !Array.isArray(s.foundations) || !Array.isArray(s.tableau)) return false;
  if (s.foundations.length !== 4 || s.tableau.length !== 7) return false;
  const all = [...s.stock, ...s.waste, ...s.foundations.flat(), ...s.tableau.flat()];
  return all.length === 52 && new Set(all.map((c) => c.id)).size === 52 && typeof s.moves === 'number';
}
