/**
 * Loot Match (pt2101u): original Chud Hub match-3. Tiles are hub loot (chips, ores, crops, fish) —
 * original design — not a clone of any commercial puzzle title. Pure rules for client + tests; scores are local /
 * leaderboard only (no chip payouts — classic Solitaire also pays nothing).
 */
export const LM_SIZE = 8;
export const LM_MOVES = 30;
export const LM_KINDS = ['chip', 'iron', 'gold', 'wheat', 'fish', 'gem'] as const;
export type LmKind = (typeof LM_KINDS)[number];
export type LmSpecial = null | 'rocket' | 'bomb' | 'prism';
export interface LmTile { id: number; kind: LmKind; special: LmSpecial }
export type LmBoard = Array<Array<LmTile | null>>;
export interface LmState {
  board: LmBoard; movesLeft: number; score: number; combo: number; nextId: number;
  status: 'playing' | 'won' | 'lost'; seed: number;
}
export const LM_LABEL: Record<LmKind, { emoji: string; name: string }> = {
  chip: { emoji: '🪙', name: 'Chip' },
  iron: { emoji: '⛏️', name: 'Iron' },
  gold: { emoji: '✨', name: 'Gold' },
  wheat: { emoji: '🌾', name: 'Wheat' },
  fish: { emoji: '🐟', name: 'Fish' },
  gem: { emoji: '💎', name: 'Gem' },
};
/** Conservative hard cap for a 30-move round (used by server validation). */
export const LM_SCORE_CAP = 250_000;

type Rng = () => number;
export function mulberry(seed: number): Rng {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

const inb = (r: number, c: number) => r >= 0 && c >= 0 && r < LM_SIZE && c < LM_SIZE;
function kindAt(b: LmBoard, r: number, c: number) { return inb(r, c) ? b[r]![c]?.kind ?? null : null; }

function makeTile(kind: LmKind, id: number, special: LmSpecial = null): LmTile {
  return { id, kind, special };
}
function randomKind(rng: Rng, forbid: Array<LmKind | null> = []): LmKind {
  for (let i = 0; i < 20; i++) {
    const k = LM_KINDS[Math.floor(rng() * LM_KINDS.length)]!;
    if (!forbid.includes(k)) return k;
  }
  return LM_KINDS[Math.floor(rng() * LM_KINDS.length)]!;
}

/** Fresh board with no opening matches. */
export function newLootMatch(seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0): LmState {
  const rng = mulberry(seed);
  let nextId = 1;
  const board: LmBoard = Array.from({ length: LM_SIZE }, () => Array.from({ length: LM_SIZE }, () => null));
  for (let r = 0; r < LM_SIZE; r++) for (let c = 0; c < LM_SIZE; c++) {
    const forbid: Array<LmKind | null> = [];
    if (kindAt(board, r, c - 1) && kindAt(board, r, c - 1) === kindAt(board, r, c - 2)) forbid.push(kindAt(board, r, c - 1));
    if (kindAt(board, r - 1, c) && kindAt(board, r - 1, c) === kindAt(board, r - 2, c)) forbid.push(kindAt(board, r - 1, c));
    board[r]![c] = makeTile(randomKind(rng, forbid), nextId++);
  }
  return { board, movesLeft: LM_MOVES, score: 0, combo: 0, nextId, status: 'playing', seed };
}

export function findGroups(board: LmBoard): Array<{ cells: Array<[number, number]>; kind: LmKind }> {
  const seen = Array.from({ length: LM_SIZE }, () => Array(LM_SIZE).fill(false));
  const groups: Array<{ cells: Array<[number, number]>; kind: LmKind }> = [];
  // Horizontal runs
  for (let r = 0; r < LM_SIZE; r++) {
    let c = 0;
    while (c < LM_SIZE) {
      const t = board[r]![c]; if (!t) { c++; continue; }
      let n = 1; while (c + n < LM_SIZE && board[r]![c + n]?.kind === t.kind) n++;
      if (n >= 3) {
        const cells: Array<[number, number]> = [];
        for (let i = 0; i < n; i++) { cells.push([r, c + i]); seen[r]![c + i] = true; }
        groups.push({ cells, kind: t.kind });
      }
      c += n;
    }
  }
  // Vertical runs (merge into existing cell sets via a cell map)
  const cellToGroup = new Map<string, number>();
  groups.forEach((g, i) => g.cells.forEach(([r, c]) => cellToGroup.set(`${r},${c}`, i)));
  for (let c = 0; c < LM_SIZE; c++) {
    let r = 0;
    while (r < LM_SIZE) {
      const t = board[r]![c]; if (!t) { r++; continue; }
      let n = 1; while (r + n < LM_SIZE && board[r + n]![c]?.kind === t.kind) n++;
      if (n >= 3) {
        const cells: Array<[number, number]> = [];
        for (let i = 0; i < n; i++) cells.push([r + i, c]);
        // Merge with any horizontal group sharing a cell
        const idxs = new Set<number>();
        for (const [rr, cc] of cells) { const i = cellToGroup.get(`${rr},${cc}`); if (i != null) idxs.add(i); }
        if (idxs.size === 0) {
          const gi = groups.length; groups.push({ cells: [...cells], kind: t.kind });
          cells.forEach(([rr, cc]) => cellToGroup.set(`${rr},${cc}`, gi));
        } else {
          const primary = Math.min(...idxs);
          const g = groups[primary]!;
          const have = new Set(g.cells.map(([rr, cc]) => `${rr},${cc}`));
          for (const [rr, cc] of cells) if (!have.has(`${rr},${cc}`)) { g.cells.push([rr, cc]); cellToGroup.set(`${rr},${cc}`, primary); }
          for (const oi of idxs) if (oi !== primary) {
            for (const [rr, cc] of groups[oi]!.cells) if (!have.has(`${rr},${cc}`)) { g.cells.push([rr, cc]); have.add(`${rr},${cc}`); cellToGroup.set(`${rr},${cc}`, primary); }
            groups[oi]!.cells = [];
          }
        }
      }
      r += n;
    }
  }
  return groups.filter((g) => g.cells.length >= 3);
}

function gravity(board: LmBoard, nextId: { n: number }, rng: Rng): void {
  for (let c = 0; c < LM_SIZE; c++) {
    let write = LM_SIZE - 1;
    for (let r = LM_SIZE - 1; r >= 0; r--) {
      const t = board[r]![c];
      if (t) { board[write]![c] = t; if (write !== r) board[r]![c] = null; write--; }
    }
    for (let r = write; r >= 0; r--) board[r]![c] = makeTile(randomKind(rng), nextId.n++);
  }
}

function clearCells(board: LmBoard, cells: Array<[number, number]>): number {
  let n = 0;
  for (const [r, c] of cells) if (board[r]![c]) { board[r]![c] = null; n++; }
  return n;
}

function activateSpecial(board: LmBoard, r: number, c: number, out: Set<string>): void {
  const t = board[r]![c]; if (!t?.special) return;
  if (t.special === 'rocket') {
    for (let i = 0; i < LM_SIZE; i++) { out.add(`${r},${i}`); out.add(`${i},${c}`); }
  } else if (t.special === 'bomb') {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (inb(r + dr, c + dc)) out.add(`${r + dr},${c + dc}`);
  } else if (t.special === 'prism') {
    for (let rr = 0; rr < LM_SIZE; rr++) for (let cc = 0; cc < LM_SIZE; cc++) if (board[rr]![cc]?.kind === t.kind) out.add(`${rr},${cc}`);
  }
}

function resolveOnce(state: LmState, rng: Rng): boolean {
  const groups = findGroups(state.board);
  if (!groups.length) return false;
  const clear = new Set<string>();
  const specials: Array<{ r: number; c: number; special: LmSpecial; kind: LmKind }> = [];
  for (const g of groups) {
    for (const [r, c] of g.cells) {
      clear.add(`${r},${c}`);
      const t = state.board[r]![c];
      if (t?.special) activateSpecial(state.board, r, c, clear);
    }
    // Spawn special on a matched cell for 4+/5+
    if (g.cells.length >= 5) {
      const [r, c] = g.cells[Math.floor(g.cells.length / 2)]!;
      specials.push({ r, c, special: 'prism', kind: g.kind });
    } else if (g.cells.length === 4) {
      const [r, c] = g.cells[1]!;
      specials.push({ r, c, special: 'rocket', kind: g.kind });
    }
  }
  // Chain specials that got pulled into clear
  let grew = true;
  while (grew) {
    grew = false;
    for (const key of [...clear]) {
      const [r, c] = key.split(',').map(Number) as [number, number];
      const t = state.board[r]![c];
      if (t?.special) {
        const before = clear.size;
        activateSpecial(state.board, r, c, clear);
        if (clear.size > before) grew = true;
      }
    }
  }
  const cells = [...clear].map((k) => k.split(',').map(Number) as [number, number]);
  const n = clearCells(state.board, cells);
  state.combo += 1;
  const base = n * 10 * state.combo;
  state.score += base;
  // Place specials after clear
  for (const s of specials) {
    if (!state.board[s.r]![s.c]) state.board[s.r]![s.c] = makeTile(s.kind, state.nextId++, s.special);
  }
  const id = { n: state.nextId };
  gravity(state.board, id, rng);
  state.nextId = id.n;
  return true;
}

export function resolveBoard(state: LmState): LmState {
  const rng = mulberry(state.seed ^ (state.score + 1) ^ (state.movesLeft << 8));
  const next: LmState = { ...state, board: state.board.map((row) => row.map((t) => (t ? { ...t } : null))) };
  next.combo = 0;
  let guard = 0;
  while (resolveOnce(next, rng) && guard++ < 40) { /* cascades */ }
  next.combo = 0;
  if (next.movesLeft <= 0 && next.status === 'playing') next.status = 'lost';
  return next;
}

export function canSwap(a: [number, number], b: [number, number]): boolean {
  const [r1, c1] = a, [r2, c2] = b;
  return inb(r1, c1) && inb(r2, c2) && Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1;
}

/** Attempt a swap; returns null if illegal / no match created. */
export function trySwap(state: LmState, a: [number, number], b: [number, number]): LmState | null {
  if (state.status !== 'playing' || state.movesLeft <= 0 || !canSwap(a, b)) return null;
  const board = state.board.map((row) => row.map((t) => (t ? { ...t } : null)));
  const [r1, c1] = a, [r2, c2] = b;
  const t = board[r1]![c1]; board[r1]![c1] = board[r2]![c2]!; board[r2]![c2] = t!;
  if (!findGroups(board).length) return null; // must create a match
  const next: LmState = { ...state, board, movesLeft: state.movesLeft - 1, combo: 0 };
  return resolveBoard(next);
}

/** Max plausible score for server validation (moves used ≤ LM_MOVES). */
export function plausibleScore(score: number, movesUsed: number): boolean {
  if (!Number.isFinite(score) || score < 0 || score > LM_SCORE_CAP) return false;
  if (!Number.isInteger(movesUsed) || movesUsed < 0 || movesUsed > LM_MOVES) return false;
  // Rough upper bound: ~80 clears/move * 10 * combo growth capped
  const soft = movesUsed * 800 + 5_000;
  return score <= Math.min(LM_SCORE_CAP, Math.max(soft, 1_000));
}
