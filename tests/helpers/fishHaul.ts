/** Test helper: before each sale, the player's unsold fish are trucked to the Warehouse (the only place fish sell). */
type Q = { query: (sql: string, args?: unknown[]) => Promise<unknown> };
export function sellsAfterHaul<T extends { sell: (...a: never[]) => Promise<unknown> }>(f: T, pool: Q): T {
  const s0 = f.sell.bind(f) as (...a: unknown[]) => Promise<unknown>;
  (f as unknown as { sell: (...a: unknown[]) => Promise<unknown> }).sell = async (...a: unknown[]) => { await pool.query("UPDATE fish_catches SET loc = 'warehouse' WHERE sold_at IS NULL AND (loc IS NULL OR loc NOT LIKE 'transit:%')"); return s0(...a); };
  return f;
}
