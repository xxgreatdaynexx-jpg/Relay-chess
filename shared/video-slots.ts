/**
 * Modern 5x3 video slots: one shared reel engine + payline evaluator, per-machine configs and feature hooks.
 * Pure + deterministic given `rand`, so the server decides every outcome (base game, free spins, bonuses,
 * respins) in a single call and the client only animates the returned script. Play money only.
 */

export const VS_REELS = 5;
export const VS_ROWS = 3;
export const VS_LINES = 20;
export const VS_BETS = [20, 40, 60, 100, 200] as const;
export const VS_MIN_BET = 20;
export const VS_MAX_BET = 200;

/** 20 paylines, row index (0 top .. 2 bottom) per reel. */
export const PAYLINES: number[][] = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2], [1, 0, 1, 2, 1], [1, 2, 1, 0, 1], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
  [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 2, 0, 2, 0], [2, 0, 2, 0, 2], [0, 2, 2, 2, 0],
];

export type MachineId = 'dragon' | 'warzone' | 'goldrush';
export const MACHINE_IDS: MachineId[] = ['dragon', 'warzone', 'goldrush'];
export type SymKind = 'normal' | 'wild' | 'scatter' | 'bonus' | 'coin';

export interface SymDef {
  id: string;
  label: string;
  kind: SymKind;
  /** Pays in line-bet units for 3, 4, 5 of a kind on a line. */
  pays?: [number, number, number];
}

export interface MachineConfig {
  id: MachineId;
  name: string;
  tagline: string;
  symbols: SymDef[];
  /** One-line description of what Buy Bonus gets you. */
  buyNote: string;
  /** weights[reel][symbolIndex]. */
  weights: number[][];
}

/** Grid is grid[reel][row] of symbol ids. */
export type Grid = string[][];

export interface LineWin { line: number; sym: string; count: number; amount: number; cells: [number, number][] }
export interface SpinStep {
  kind: 'base' | 'free';
  /** What the reels land on. */
  grid: Grid;
  /** What is evaluated (after expanding wilds / airstrike). */
  final: Grid;
  wins: LineWin[];
  multiplier: number;
  /** Chips won by this step (after multiplier). */
  win: number;
  expanded?: number[];
  airstrike?: [number, number][];
  /** Free spins left after this step (free kind) / awarded (base kind). */
  freeLeft?: number;
  awarded?: number;
}
export interface CoinValue { mult: number; tier?: 'MINI' | 'MINOR' | 'MAJOR' | 'GRAND' }
export interface ChestBonus { picks: number[]; total: number }
export interface HoldSpin {
  /** Each frame: coins per cell [reel][row] (null empty) and respins left. */
  frames: { coins: (CoinValue | null)[][]; left: number }[];
  grand: boolean;
  total: number;
}
export interface RoundResult {
  machine: MachineId;
  bet: number;
  steps: SpinStep[];
  freeSpins?: { awarded: number; played: number; multiplier: number; total: number };
  chest?: ChestBonus;
  hold?: HoldSpin;
  totalWin: number;
  /** Set when this round was a Buy Bonus purchase. */
  bought?: boolean;
}

// ---------------------------------------------------------------- machines
const S = (id: string, label: string, kind: SymKind, pays?: [number, number, number]): SymDef => ({ id, label, kind, pays });

export const MACHINES: Record<MachineId, MachineConfig> = {
  dragon: {
    id: 'dragon',
    name: 'Dragon Queen',
    tagline: 'Gold queen is wild · 3+ crowns = free spins ×2 · 3 chests = pick-a-chest',
    buyNote: 'A spin that lands 3+ crowns: 8–15 free spins at ×2',
    symbols: [
      S('pawn', 'Pawn', 'normal', [5, 15, 50]),
      S('knight', 'Knight', 'normal', [5, 20, 60]),
      S('bishop', 'Bishop', 'normal', [10, 25, 80]),
      S('rook', 'Rook', 'normal', [15, 40, 120]),
      S('king', 'Black King', 'normal', [25, 80, 250]),
      S('queen', 'Gold Dragon Queen', 'wild', [50, 200, 1000]),
      S('crown', 'Crown (scatter)', 'scatter'),
      S('chest', 'Chest', 'bonus'),
    ],
    weights: [
      [30, 28, 24, 18, 10, 0, 4, 4],
      [30, 28, 24, 18, 10, 3, 4, 4],
      [30, 28, 24, 18, 10, 3, 4, 4],
      [30, 28, 24, 18, 10, 3, 4, 4],
      [30, 28, 24, 18, 10, 2, 4, 4],
    ],
  },
  warzone: {
    id: 'warzone',
    name: 'Warzone',
    tagline: 'Expanding wilds fill the reel · random AIRSTRIKE blasts symbols into wilds',
    buyNote: 'A spin with a guaranteed airstrike: 3–6 symbols blasted into wilds',
    symbols: [
      S('ammo', 'Ammo Box', 'normal', [5, 15, 50]),
      S('tags', 'Dog Tags', 'normal', [5, 20, 60]),
      S('compass', 'Compass', 'normal', [10, 25, 80]),
      S('radio', 'Field Radio', 'normal', [15, 40, 120]),
      S('helmet', 'Helmet', 'normal', [20, 60, 200]),
      S('tank', 'Tank', 'normal', [30, 100, 400]),
      S('star', 'Wild Star', 'wild'),
    ],
    weights: [
      [30, 28, 24, 18, 12, 7, 0],
      [30, 28, 24, 18, 12, 7, 0.5],
      [30, 28, 24, 18, 12, 7, 0.5],
      [30, 28, 24, 18, 12, 7, 0.5],
      [30, 28, 24, 18, 12, 7, 0],
    ],
  },
  goldrush: {
    id: 'goldrush',
    name: 'Gold Rush',
    tagline: 'Classic 7s · 6+ gold coins = HOLD & SPIN · MINI / MINOR / MAJOR / GRAND',
    buyNote: 'A spin that lands 6+ gold coins: Hold & Spin with 3 respins',
    symbols: [
      S('cherry', 'Cherry', 'normal', [7, 20, 70]),
      S('bar', 'BAR', 'normal', [10, 30, 100]),
      S('bar2', 'Double BAR', 'normal', [15, 40, 120]),
      S('bar3', 'Triple BAR', 'normal', [20, 60, 180]),
      S('bell', 'Bell', 'normal', [30, 90, 300]),
      S('seven', 'Red 7', 'normal', [60, 200, 750]),
      S('wild', 'Wild 7', 'wild', [80, 300, 1500]),
      S('coin', 'Gold Coin', 'coin'),
    ],
    weights: [
      [30, 28, 24, 18, 12, 6, 2, 18],
      [30, 28, 24, 18, 12, 6, 2, 18],
      [30, 28, 24, 18, 12, 6, 2, 18],
      [30, 28, 24, 18, 12, 6, 2, 18],
      [30, 28, 24, 18, 12, 6, 2, 18],
    ],
  },
};

// Tunables (validated by tests/video-slots.test.ts simulation).
export const DQ_FREE_SPINS: Record<number, number> = { 3: 8, 4: 12, 5: 15 };
export const DQ_FREE_MULT = 2;
export const DQ_SCATTER_PAY: Record<number, number> = { 3: 2, 4: 10, 5: 50 }; // x total bet
export const DQ_CHEST_PRIZES: { mult: number; w: number }[] = [
  { mult: 0, w: 25 }, // collect
  { mult: 1, w: 30 }, { mult: 2, w: 20 }, { mult: 3, w: 10 }, { mult: 5, w: 7 }, { mult: 10, w: 2.5 }, { mult: 25, w: 0.5 },
];
export const WZ_AIRSTRIKE_CHANCE = 0.04;
export const WZ_AIRSTRIKE_MIN = 3;
export const WZ_AIRSTRIKE_MAX = 6;
export const GR_TRIGGER = 6;
export const GR_RESPINS = 3;
export const GR_LAND_CHANCE = 0.08;
export const GR_COIN_VALUES: { v: CoinValue; w: number }[] = [
  { v: { mult: 1 }, w: 30 }, { v: { mult: 1.5 }, w: 30 }, { v: { mult: 2 }, w: 18 }, { v: { mult: 3 }, w: 10 },
  { v: { mult: 5 }, w: 6 }, { v: { mult: 10, tier: 'MINI' }, w: 3.5 }, { v: { mult: 25, tier: 'MINOR' }, w: 1.8 },
  { v: { mult: 50, tier: 'MAJOR' }, w: 0.4 },
];
export const GR_GRAND_MULT = 500;
export const MAX_FREE_SPINS = 100;

// ---------------------------------------------------------------- engine
function pickWeighted<T>(items: T[], weight: (t: T) => number, r: number): T {
  const total = items.reduce((s, t) => s + weight(t), 0);
  let x = r * total;
  for (const t of items) { x -= weight(t); if (x < 0) return t; }
  return items[items.length - 1]!;
}

export function symOf(cfg: MachineConfig, id: string): SymDef {
  return cfg.symbols.find((s) => s.id === id)!;
}

const cumCache = new WeakMap<MachineConfig, number[][]>();
function cumWeights(cfg: MachineConfig): number[][] {
  let c = cumCache.get(cfg);
  if (!c) {
    c = cfg.weights.map((w) => { let t = 0; return w.map((x) => (t += x)); });
    cumCache.set(cfg, c);
  }
  return c;
}

export function spinGrid(cfg: MachineConfig, rand: () => number): Grid {
  const cum = cumWeights(cfg);
  const grid: Grid = [];
  for (let r = 0; r < VS_REELS; r++) {
    const c = cum[r]!;
    const total = c[c.length - 1]!;
    const reel: string[] = [];
    for (let w = 0; w < VS_ROWS; w++) {
      const x = rand() * total;
      let i = 0;
      while (i < c.length - 1 && x >= c[i]!) i++;
      reel.push(cfg.symbols[i]!.id);
    }
    grid.push(reel);
  }
  return grid;
}

/** Evaluate all paylines left to right. Amounts are in chips for `bet` total (line bet = bet / 20). */
export function evaluateLines(cfg: MachineConfig, grid: Grid, bet: number): LineWin[] {
  const lineBet = bet / VS_LINES;
  const wins: LineWin[] = [];
  const kinds = new Map(cfg.symbols.map((s) => [s.id, s]));
  PAYLINES.forEach((rows, line) => {
    const cells = rows.map((row, reel) => grid[reel]![row]!);
    let target: string | null = null;
    let count = 0;
    for (const c of cells) {
      const k = kinds.get(c)!.kind;
      if (k === 'wild') { count++; continue; }
      if (k !== 'normal') break;
      if (target === null) { target = c; count++; continue; }
      if (c === target) { count++; continue; }
      break;
    }
    let wildRun = 0;
    for (const c of cells) { if (kinds.get(c)!.kind === 'wild') wildRun++; else break; }
    const wildSym = cfg.symbols.find((s) => s.kind === 'wild')!;
    const symPay = target && count >= 3 ? (kinds.get(target)!.pays?.[count - 3] ?? 0) : 0;
    const wildPay = wildRun >= 3 ? (wildSym.pays?.[wildRun - 3] ?? 0) : 0;
    let best: { sym: string; count: number; pay: number } | null = null;
    if (symPay > 0) best = { sym: target!, count, pay: symPay };
    if (wildPay > 0 && (!best || wildPay > best.pay)) best = { sym: wildSym.id, count: wildRun, pay: wildPay };
    if (target === null && count >= 3 && !best && wildPay === 0) best = null;
    if (best) {
      wins.push({ line, sym: best.sym, count: best.count, amount: best.pay * lineBet,
        cells: rows.slice(0, best.count).map((row, reel) => [reel, row] as [number, number]) });
    }
  });
  return wins;
}

function countKind(cfg: MachineConfig, grid: Grid, kind: SymKind): number {
  let n = 0;
  for (const reel of grid) for (const c of reel) if (symOf(cfg, c).kind === kind) n++;
  return n;
}

const cloneGrid = (g: Grid): Grid => g.map((r) => [...r]);
const sumWins = (w: LineWin[]) => w.reduce((s, x) => s + x.amount, 0);

/** Resample until `ok` holds (conditional distribution of a natural trigger). Bounded so it can never hang. */
function spinUntil(cfg: MachineConfig, rand: () => number, ok: (g: Grid) => boolean): Grid {
  for (let i = 0; i < 1_000_000; i++) { const g = spinGrid(cfg, rand); if (ok(g)) return g; }
  throw new Error('Bonus trigger not found.');
}

function playDragon(cfg: MachineConfig, bet: number, rand: () => number, buy = false): RoundResult {
  const steps: SpinStep[] = [];
  const res: RoundResult = { machine: 'dragon', bet, steps, totalWin: 0 };
  const stepFor = (kind: 'base' | 'free', mult: number, forced?: Grid): { step: SpinStep; scatters: number; chests: number } => {
    const grid = forced ?? spinGrid(cfg, rand);
    const wins = evaluateLines(cfg, grid, bet);
    const scatters = countKind(cfg, grid, 'scatter');
    const chests = countKind(cfg, grid, 'bonus');
    let raw = sumWins(wins);
    if (scatters >= 3) raw += DQ_SCATTER_PAY[Math.min(scatters, 5)]! * bet;
    return { step: { kind, grid, final: grid, wins, multiplier: mult, win: Math.floor(raw * mult) }, scatters, chests };
  };
  // Buy bonus: the base spin is drawn from the spins that naturally land 3+ crowns.
  const base = stepFor('base', 1, buy ? spinUntil(cfg, rand, (g) => countKind(cfg, g, 'scatter') >= 3) : undefined);
  steps.push(base.step);
  let total = base.step.win;
  if (base.chests >= 3) {
    const picks: number[] = [];
    for (;;) {
      const p = pickWeighted(DQ_CHEST_PRIZES, (x) => x.w, rand()).mult;
      picks.push(p * bet);
      if (p === 0 || picks.length >= 12) break;
    }
    if (picks[picks.length - 1] !== 0) picks.push(0);
    const t = picks.reduce((a, b) => a + b, 0);
    res.chest = { picks, total: t };
    total += t;
  }
  if (base.scatters >= 3) {
    let left = DQ_FREE_SPINS[Math.min(base.scatters, 5)]!;
    let awarded = left;
    base.step.awarded = left;
    let played = 0;
    let fsTotal = 0;
    while (left > 0 && played < MAX_FREE_SPINS) {
      left--; played++;
      const s = stepFor('free', DQ_FREE_MULT);
      if (s.scatters >= 3) { const add = DQ_FREE_SPINS[Math.min(s.scatters, 5)]!; left += add; awarded += add; s.step.awarded = add; }
      s.step.freeLeft = left;
      steps.push(s.step);
      fsTotal += s.step.win;
    }
    res.freeSpins = { awarded, played, multiplier: DQ_FREE_MULT, total: fsTotal };
    total += fsTotal;
  }
  res.totalWin = total;
  return res;
}

function playWarzone(cfg: MachineConfig, bet: number, rand: () => number, buy = false): RoundResult {
  const grid = spinGrid(cfg, rand);
  const final = cloneGrid(grid);
  const step: SpinStep = { kind: 'base', grid, final, wins: [], multiplier: 1, win: 0 };
  // Buy bonus: the airstrike is guaranteed (same strike size distribution as a natural one).
  if (buy || rand() < WZ_AIRSTRIKE_CHANCE) {
    const n = WZ_AIRSTRIKE_MIN + Math.floor(rand() * (WZ_AIRSTRIKE_MAX - WZ_AIRSTRIKE_MIN + 1));
    const cells: [number, number][] = [];
    const open: [number, number][] = [];
    for (let r = 0; r < VS_REELS; r++) for (let w = 0; w < VS_ROWS; w++) if (final[r]![w] !== 'star') open.push([r, w]);
    for (let i = 0; i < n && open.length; i++) {
      const [c] = open.splice(Math.floor(rand() * open.length), 1);
      cells.push(c!);
      final[c![0]]![c![1]] = 'star';
    }
    step.airstrike = cells;
  }
  const expanded: number[] = [];
  for (let r = 0; r < VS_REELS; r++) {
    if (grid[r]!.includes('star')) { expanded.push(r); final[r] = Array(VS_ROWS).fill('star'); }
  }
  if (expanded.length) step.expanded = expanded;
  step.wins = evaluateLines(cfg, final, bet);
  step.win = Math.floor(sumWins(step.wins));
  return { machine: 'warzone', bet, steps: [step], totalWin: step.win };
}

function coinValue(rand: () => number): CoinValue {
  return { ...pickWeighted(GR_COIN_VALUES, (x) => x.w, rand()).v };
}

function playGoldRush(cfg: MachineConfig, bet: number, rand: () => number, buy = false): RoundResult {
  // Buy bonus: the base spin is drawn from the spins that naturally land 6+ coins.
  const grid = buy ? spinUntil(cfg, rand, (g) => countKind(cfg, g, 'coin') >= GR_TRIGGER) : spinGrid(cfg, rand);
  const wins = evaluateLines(cfg, grid, bet);
  const step: SpinStep = { kind: 'base', grid, final: grid, wins, multiplier: 1, win: Math.floor(sumWins(wins)) };
  const res: RoundResult = { machine: 'goldrush', bet, steps: [step], totalWin: step.win };
  if (countKind(cfg, grid, 'coin') >= GR_TRIGGER) {
    const coins: (CoinValue | null)[][] = grid.map((reel) => reel.map((c) => (c === 'coin' ? coinValue(rand) : null)));
    const frames: HoldSpin['frames'] = [{ coins: coins.map((r) => [...r]), left: GR_RESPINS }];
    let left = GR_RESPINS;
    const full = () => coins.every((r) => r.every((c) => c !== null));
    while (left > 0 && !full()) {
      left--;
      let landed = false;
      for (let r = 0; r < VS_REELS; r++) for (let w = 0; w < VS_ROWS; w++) {
        if (coins[r]![w] === null && rand() < GR_LAND_CHANCE) { coins[r]![w] = coinValue(rand); landed = true; }
      }
      if (landed) left = GR_RESPINS;
      frames.push({ coins: coins.map((r) => [...r]), left });
    }
    const grand = full();
    let mult = 0;
    for (const r of coins) for (const c of r) mult += c!?.mult ?? 0;
    if (grand) mult += GR_GRAND_MULT;
    const total = Math.floor(mult * bet);
    res.hold = { frames, grand, total };
    res.totalWin += total;
  }
  return res;
}

export function playRound(machine: MachineId, bet: number, rand: () => number): RoundResult {
  const cfg = MACHINES[machine];
  if (machine === 'dragon') return playDragon(cfg, bet, rand);
  if (machine === 'warzone') return playWarzone(cfg, bet, rand);
  return playGoldRush(cfg, bet, rand);
}

/**
 * Buy Bonus price as a multiple of the bet. Derived from the seeded simulated average value of a bought
 * round (see tests/video-slots.test.ts `buy-bonus RTP`): multiple ≈ average bonus value / 0.95.
 * Seeded long runs (bet multiples): dragon 16.70 (3M rounds), warzone 9.47 (20M), goldrush 37.57 (6M).
 */
export const BUY_BONUS_MULT: Record<MachineId, number> = { dragon: 17.6, warzone: 10, goldrush: 39.5 };
export const BUY_BONUS_LABEL: Record<MachineId, string> = { dragon: 'Free Spins', warzone: 'Airstrike', goldrush: 'Hold & Spin' };
export const buyBonusPrice = (machine: MachineId, bet: number): number => Math.round(BUY_BONUS_MULT[machine] * bet);

/** A bought round: the machine's bonus is guaranteed to trigger on the (paid-for) spin. */
export function playBuyBonus(machine: MachineId, bet: number, rand: () => number): RoundResult {
  const cfg = MACHINES[machine];
  const r = machine === 'dragon' ? playDragon(cfg, bet, rand, true)
    : machine === 'warzone' ? playWarzone(cfg, bet, rand, true) : playGoldRush(cfg, bet, rand, true);
  r.bought = true;
  return r;
}

/** Average bought-round value in bet multiples. */
export function simulateBuy(machine: MachineId, rounds: number, rand: () => number, bet = 20): { rounds: number; avgMult: number; rtp: number } {
  let paid = 0;
  for (let i = 0; i < rounds; i++) paid += playBuyBonus(machine, bet, rand).totalWin;
  const avgMult = paid / (rounds * bet);
  return { rounds, avgMult, rtp: paid / (rounds * buyBonusPrice(machine, bet)) };
}

export function isMachineId(x: unknown): x is MachineId {
  return typeof x === 'string' && (MACHINE_IDS as string[]).includes(x);
}

export interface SimStats { spins: number; rtp: number; hitRate: number; featureRate: number; bonusRate: number; maxWin: number }

/** Monte-Carlo stats in bet multiples. featureRate: free spins / airstrike / hold-and-spin; bonusRate: chest. */
export function simulate(machine: MachineId, spins: number, rand: () => number, bet = 20): SimStats {
  let paid = 0, hits = 0, feat = 0, bonus = 0, max = 0;
  for (let i = 0; i < spins; i++) {
    const r = playRound(machine, bet, rand);
    paid += r.totalWin;
    if (r.totalWin > 0) hits++;
    if (r.freeSpins || r.hold || r.steps[0]!.airstrike) feat++;
    if (r.chest) bonus++;
    if (r.totalWin > max) max = r.totalWin;
  }
  return { spins, rtp: paid / (spins * bet), hitRate: hits / spins, featureRate: feat / spins, bonusRate: bonus / spins, maxWin: max / bet };
}

/** Small seeded PRNG for simulations/tests (never used for real outcomes). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
