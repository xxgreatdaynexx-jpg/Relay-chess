/** Chud City Warehouse sale log (one row per ship-to-sell load, keyed by the shipment id: written once). */
import type { Shipment } from './logistics.js';

export const WAREHOUSE_MIGRATION = `
CREATE TABLE IF NOT EXISTS building_inv (player_key TEXT NOT NULL, name TEXT NOT NULL, building TEXT NOT NULL, item TEXT NOT NULL, qty BIGINT NOT NULL, PRIMARY KEY (player_key, building, item));
CREATE TABLE IF NOT EXISTS autosell_cfg (player_key TEXT NOT NULL, name TEXT NOT NULL, building TEXT NOT NULL, item TEXT NOT NULL, on_ BOOLEAN NOT NULL DEFAULT false, reserve BIGINT NOT NULL DEFAULT 0, keep_recipe BOOLEAN NOT NULL DEFAULT false, updated_at BIGINT NOT NULL, PRIMARY KEY (player_key, building, item));
CREATE TABLE IF NOT EXISTS warehouse_sales (id TEXT PRIMARY KEY, player_key TEXT NOT NULL, name TEXT NOT NULL, building TEXT NOT NULL, item_type TEXT NOT NULL, item_id TEXT NOT NULL, qty BIGINT NOT NULL, fee BIGINT NOT NULL, paid BIGINT NOT NULL, auto BOOLEAN NOT NULL, status TEXT NOT NULL, note TEXT, at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS warehouse_sales_player ON warehouse_sales (player_key, at);`;

export const saleLogStmt = (s: Shipment, status: 'sold' | 'stored', paid: number, note: string | null, at = Date.now()) => ({
  sql: `INSERT INTO warehouse_sales (id, player_key, name, building, item_type, item_id, qty, fee, paid, auto, status, note, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, paid = EXCLUDED.paid, note = EXCLUDED.note`,
  args: [s.id, s.owner, s.ownerName, s.src ?? s.from, s.type, s.itemId, s.qty, s.fee, paid, !!s.auto, status, note, at] as unknown[],
});
/** `sql` that inserts/adds to a building inventory row (same transaction as the producing write). */
export const binAddStmt = (key: string, name: string, building: string, item: string, qty: number) => ({
  sql: `INSERT INTO building_inv (player_key, name, building, item, qty) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (player_key, building, item) DO UPDATE SET qty = building_inv.qty + EXCLUDED.qty, name = EXCLUDED.name`,
  args: [key, name, building, item, qty] as unknown[],
});
