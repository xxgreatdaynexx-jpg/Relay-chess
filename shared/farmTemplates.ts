/**
 * Named crop layouts and box-select helpers for farm plots. Templates are a plan of which crop
 * goes on which tile; applying one plants only empty tiles and charges seeds the same way as
 * planting by hand (so the house-cap planting bonus also applies).
 */
import { cropById } from './farm.js';
import { isTropical } from './resort.js';

export const FARM_TEMPLATE_MAX = 20;
export const FARM_TEMPLATE_NAME_MAX = 32;
/** Enough for the largest current plots (30×30) with room to grow. */
export const FARM_TEMPLATE_CELLS_MAX = 1600;
/** Must match `.farm-grid` padding / gap in client/src/index.css. */
export const FARM_GRID_PAD = 6;
export const FARM_GRID_GAP = 3;

export interface FarmTemplateCell { tile: number; crop: string }
export interface FarmTemplateLayout { cols: number; rows: number; cells: FarmTemplateCell[] }
export interface FarmTemplate extends FarmTemplateLayout { id: string; name: string; updatedAt: number }

/** Inclusive axis-aligned tile box on a `cols`×`rows` plot, in row-major order. */
export function boxTiles(cols: number, rows: number, a: number, b: number): number[] {
  const n = cols * rows;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return [];
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= n || b >= n) return [];
  const c0 = Math.min(a % cols, b % cols), c1 = Math.max(a % cols, b % cols);
  const r0 = Math.min(Math.floor(a / cols), Math.floor(b / cols));
  const r1 = Math.max(Math.floor(a / cols), Math.floor(b / cols));
  const out: number[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(r * cols + c);
  return out;
}

/** Top-left tile of the bounding box covering `tiles` (for stamping a template into a selection). */
export function boxOrigin(cols: number, tiles: number[]): number {
  if (!tiles.length || cols < 1) return 0;
  const c0 = Math.min(...tiles.map((t) => ((t % cols) + cols) % cols));
  const r0 = Math.min(...tiles.map((t) => Math.floor(t / cols)));
  return r0 * cols + c0;
}

/** Which tile of a CSS farm grid a pointer is over, or null if it is in the padding / gap / outside. */
export function tileAtPoint(cols: number, rows: number, rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): number | null {
  if (cols < 1 || rows < 1 || rect.width <= 0 || rect.height <= 0) return null;
  const pad = FARM_GRID_PAD, gap = FARM_GRID_GAP;
  const x = clientX - rect.left - pad, y = clientY - rect.top - pad;
  const cw = (rect.width - 2 * pad - gap * (cols - 1)) / cols;
  const ch = (rect.height - 2 * pad - gap * (rows - 1)) / rows;
  if (cw <= 0 || ch <= 0) return null;
  const c = Math.floor(x / (cw + gap)), r = Math.floor(y / (ch + gap));
  if (c < 0 || r < 0 || c >= cols || r >= rows) return null;
  const lx = x - c * (cw + gap), ly = y - r * (ch + gap);
  if (lx < 0 || ly < 0 || lx > cw || ly > ch) return null;
  return r * cols + c;
}

export function normalizeTemplateName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s || s.length > FARM_TEMPLATE_NAME_MAX) return null;
  if (/[\u0000-\u001f]/.test(s)) return null;
  return s;
}

/** Validate a saved or applied layout. Returns a player-facing error string on failure. */
export function normalizeLayout(raw: { cols?: unknown; rows?: unknown; cells?: unknown }): FarmTemplateLayout | string {
  const cols = raw.cols, rows = raw.rows;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || (cols as number) < 1 || (rows as number) < 1) return 'That template has an invalid size.';
  if ((cols as number) > 80 || (rows as number) > 80) return 'That template is too large.';
  if (!Array.isArray(raw.cells) || !raw.cells.length) return 'Plant or select tiles first.';
  if (raw.cells.length > FARM_TEMPLATE_CELLS_MAX) return 'That template has too many tiles.';
  const n = (cols as number) * (rows as number);
  const seen = new Map<number, string>();
  for (const cell of raw.cells) {
    if (!cell || typeof cell !== 'object') return 'That template is damaged.';
    const tile = (cell as FarmTemplateCell).tile, crop = (cell as FarmTemplateCell).crop;
    if (!Number.isInteger(tile) || tile < 0 || tile >= n) return 'That template has a tile outside the field.';
    const c = cropById(crop); if (!c) return 'That template has an unknown crop.';
    const prev = seen.get(tile);
    if (prev && prev !== c.id) return 'That template lists two crops on the same tile.';
    seen.set(tile, c.id);
  }
  const cells = [...seen].map(([tile, crop]) => ({ tile, crop }));
  const trop = cells.filter((c) => isTropical(c.crop));
  if (trop.length && trop.length !== cells.length) return 'A template cannot mix city crops and tropical resort crops.';
  return { cols: cols as number, rows: rows as number, cells };
}

/**
 * Shrink a set of plot-absolute cells to a tight rectangle whose local tile 0 is the top-left of
 * the selection. Used when saving a selected region so it can be stamped elsewhere.
 */
export function packSelection(plotCols: number, plotRows: number, cells: FarmTemplateCell[]): FarmTemplateLayout | string {
  const n = plotCols * plotRows;
  if (!Number.isInteger(plotCols) || !Number.isInteger(plotRows) || plotCols < 1 || plotRows < 1) return 'Unknown farm plot.';
  const onPlot = cells.filter((c) => Number.isInteger(c.tile) && c.tile >= 0 && c.tile < n);
  if (!onPlot.length) return 'Plant or select tiles first.';
  const c0 = Math.min(...onPlot.map((c) => c.tile % plotCols));
  const c1 = Math.max(...onPlot.map((c) => c.tile % plotCols));
  const r0 = Math.min(...onPlot.map((c) => Math.floor(c.tile / plotCols)));
  const r1 = Math.max(...onPlot.map((c) => Math.floor(c.tile / plotCols)));
  const cols = c1 - c0 + 1, rows = r1 - r0 + 1;
  return normalizeLayout({
    cols, rows,
    cells: onPlot.map((c) => ({ tile: (Math.floor(c.tile / plotCols) - r0) * cols + (c.tile % plotCols - c0), crop: c.crop })),
  });
}

/** Place a layout onto a plot. `originTile` is the plot tile under the layout's top-left cell; out-of-bounds cells are dropped. */
export function stampLayout(layout: FarmTemplateLayout, plotCols: number, plotRows: number, originTile = 0): FarmTemplateCell[] {
  if (!Number.isInteger(plotCols) || !Number.isInteger(plotRows) || plotCols < 1 || plotRows < 1) return [];
  const n = plotCols * plotRows;
  const origin = Number.isInteger(originTile) && originTile >= 0 && originTile < n ? originTile : 0;
  const oc = origin % plotCols, or_ = Math.floor(origin / plotCols);
  const out: FarmTemplateCell[] = [];
  const seen = new Set<number>();
  for (const cell of layout.cells) {
    const lc = cell.tile % layout.cols, lr = Math.floor(cell.tile / layout.cols);
    if (lc < 0 || lr < 0 || lc >= layout.cols || lr >= layout.rows) continue;
    const c = oc + lc, r = or_ + lr;
    if (c < 0 || r < 0 || c >= plotCols || r >= plotRows) continue;
    const tile = r * plotCols + c;
    if (seen.has(tile)) continue;
    seen.add(tile);
    out.push({ tile, crop: cell.crop });
  }
  return out;
}
