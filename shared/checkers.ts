/**
 * American / English checkers (8x8, men move diagonally forward, mandatory captures,
 * multi-jumps, kings crowned on the far row, kings move one square any diagonal).
 *
 * Positions use a chess-FEN-shaped string so the existing board renderer can read it:
 * "<placement> <turn> <quietPlies> <fullmove>" where placement uses p/P for men and
 * k/K for kings (upper case = White). White starts on ranks 1-3 and moves first, so the
 * relay seat order (White 1, Black 1, ...) is unchanged. quietPlies counts plies since
 * the last capture or crowning; 80 (40 moves each) is a draw.
 */
export type CColor = 'w' | 'b';
export interface CPiece { c: CColor; king: boolean }
export type CBoard = Map<string, CPiece>;
export interface CPosition { board: CBoard; turn: CColor; quiet: number; full: number }
export interface CMove { from: string; to: string; path: string[]; captures: string[]; crowns: boolean; san: string }

export const QUIET_DRAW_PLIES = 80;
const FILES = 'abcdefgh';

export const sq = (f: number, r: number) => `${FILES[f]}${r + 1}`;
export const fileOf = (s: string) => FILES.indexOf(s[0]!);
export const rankOf = (s: string) => Number(s[1]) - 1;
export const isDark = (s: string) => /^[a-h][1-8]$/.test(s) && (fileOf(s) + rankOf(s)) % 2 === 0;

export function initialPosition(): CPosition {
  const board: CBoard = new Map();
  for (let r = 0; r < 8; r += 1) {
    for (let f = 0; f < 8; f += 1) {
      if ((f + r) % 2 !== 0) continue;
      if (r <= 2) board.set(sq(f, r), { c: 'w', king: false });
      else if (r >= 5) board.set(sq(f, r), { c: 'b', king: false });
    }
  }
  return { board, turn: 'w', quiet: 0, full: 1 };
}

export const INITIAL_CHECKERS_FEN = toFen(initialPosition());

export function toFen(p: CPosition): string {
  const rows: string[] = [];
  for (let r = 7; r >= 0; r -= 1) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f += 1) {
      const piece = p.board.get(sq(f, r));
      if (!piece) { empty += 1; continue; }
      if (empty) { row += String(empty); empty = 0; }
      const ch = piece.king ? 'k' : 'p';
      row += piece.c === 'w' ? ch.toUpperCase() : ch;
    }
    if (empty) row += String(empty);
    rows.push(row);
  }
  return `${rows.join('/')} ${p.turn} ${p.quiet} ${p.full}`;
}

export function parseFen(fen: string): CPosition | null {
  const parts = fen.trim().split(/\s+/);
  const rows = parts[0]?.split('/') ?? [];
  if (rows.length !== 8) return null;
  const board: CBoard = new Map();
  for (let i = 0; i < 8; i += 1) {
    const r = 7 - i;
    let f = 0;
    for (const ch of rows[i]!) {
      if (ch >= '1' && ch <= '8') { f += Number(ch); continue; }
      const low = ch.toLowerCase();
      if ((low !== 'p' && low !== 'k') || f > 7) return null;
      if ((f + r) % 2 !== 0) return null;
      board.set(sq(f, r), { c: ch === low ? 'b' : 'w', king: low === 'k' });
      f += 1;
    }
    if (f !== 8) return null;
  }
  const turn = parts[1] === 'b' ? 'b' : 'w';
  const quiet = Math.max(0, Number(parts[2]) || 0);
  const full = Math.max(1, Number(parts[3]) || 1);
  return { board, turn, quiet, full };
}

function dirs(piece: CPiece): [number, number][] {
  if (piece.king) return [[1, 1], [-1, 1], [1, -1], [-1, -1]];
  const dr = piece.c === 'w' ? 1 : -1;
  return [[1, dr], [-1, dr]];
}

const crownRank = (c: CColor) => (c === 'w' ? 7 : 0);
const onBoard = (f: number, r: number) => f >= 0 && f < 8 && r >= 0 && r < 8;

function jumpsFrom(board: CBoard, start: string, piece: CPiece): CMove[] {
  const out: CMove[] = [];
  const walk = (at: string, path: string[], caps: string[]) => {
    let extended = false;
    const f = fileOf(at), r = rankOf(at);
    for (const [df, dr] of dirs(piece)) {
      const mf = f + df, mr = r + dr, lf = f + 2 * df, lr = r + 2 * dr;
      if (!onBoard(lf, lr)) continue;
      const mid = sq(mf, mr), land = sq(lf, lr);
      const victim = board.get(mid);
      if (!victim || victim.c === piece.c || caps.includes(mid)) continue;
      if (land !== start && board.has(land)) continue;
      extended = true;
      const nextPath = [...path, land];
      const nextCaps = [...caps, mid];
      // A man that reaches the crown row ends its move there (American rules).
      if (!piece.king && lr === crownRank(piece.c)) out.push(finish(start, nextPath, nextCaps, true));
      else walk(land, nextPath, nextCaps);
    }
    if (!extended && caps.length > 0) out.push(finish(start, path, caps, false));
  };
  walk(start, [], []);
  return out;
}

function finish(from: string, path: string[], captures: string[], crowns: boolean): CMove {
  const to = path[path.length - 1]!;
  return { from, to, path, captures, crowns, san: [from, ...path].join('x') };
}

export function legalMoves(p: CPosition): CMove[] {
  const caps: CMove[] = [];
  const steps: CMove[] = [];
  for (const [at, piece] of p.board) {
    if (piece.c !== p.turn) continue;
    caps.push(...jumpsFrom(p.board, at, piece));
    if (caps.length) continue;
    const f = fileOf(at), r = rankOf(at);
    for (const [df, dr] of dirs(piece)) {
      if (!onBoard(f + df, r + dr)) continue;
      const to = sq(f + df, r + dr);
      if (p.board.has(to)) continue;
      steps.push({ from: at, to, path: [to], captures: [], crowns: !piece.king && r + dr === crownRank(piece.c), san: `${at}-${to}` });
    }
  }
  return caps.length ? caps : steps;
}

export function applyMove(p: CPosition, m: CMove): CPosition {
  const board: CBoard = new Map(p.board);
  const piece = board.get(m.from)!;
  board.delete(m.from);
  for (const c of m.captures) board.delete(c);
  board.set(m.to, { c: piece.c, king: piece.king || m.crowns });
  const reset = m.captures.length > 0 || m.crowns;
  return { board, turn: p.turn === 'w' ? 'b' : 'w', quiet: reset ? 0 : p.quiet + 1, full: p.turn === 'b' ? p.full + 1 : p.full };
}

/** Find the legal move for a from/to (and optional intermediate landing squares). */
export function findMove(p: CPosition, from: string, to: string, via?: readonly string[]): CMove | null {
  const options = legalMoves(p).filter((m) => m.from === from && m.to === to);
  if (via && via.length) return options.find((m) => m.path.slice(0, -1).join() === via.join()) ?? null;
  return options[0] ?? null;
}

export const positionKey = (p: CPosition) => toFen(p).split(' ').slice(0, 2).join(' ');
export const countPieces = (p: CPosition, c: CColor) => [...p.board.values()].filter((x) => x.c === c).length;

/** The side to move loses when it has no pieces or no legal moves. */
export function checkersLoser(p: CPosition): CColor | null {
  if (countPieces(p, 'w') === 0) return 'w';
  if (countPieces(p, 'b') === 0) return 'b';
  return legalMoves(p).length === 0 ? p.turn : null;
}

/** Moves that end the game at once (the opponent is left with no pieces or no legal moves). */
export function winningMoves(p: CPosition): CMove[] {
  return legalMoves(p).filter((m) => checkersLoser(applyMove(p, m)) === (p.turn === 'w' ? 'b' : 'w'));
}

/**
 * Missed winning move house rule (checkers twin of missed mate-in-one): if the mover had a move that
 * won on the spot and played something else, every piece that could have won is taken off.
 * A piece that just moved is removed from its new square. Returns null when the rule does not apply.
 */
export function applyMissedWin(before: CPosition, played: CMove, after: CPosition, wins: readonly CMove[]): { position: CPosition; removed: string[]; missed: string[] } | null {
  if (wins.length === 0 || wins.some((w) => w.san === played.san)) return null;
  const origins = new Set(wins.map((w) => w.from));
  const board: CBoard = new Map(after.board);
  const removed: string[] = [];
  for (const origin of origins) {
    const square = origin === played.from ? played.to : origin;
    const piece = board.get(square);
    if (piece && piece.c === before.turn) { board.delete(square); removed.push(square); }
  }
  if (!removed.length) return null;
  return { position: { ...after, board }, removed, missed: wins.map((w) => w.san) };
}
