/**
 * Building inventories + the Chud City Warehouse market (Millionaire Update, Dayne 2026-11-04).
 *
 * Rules
 *  - Every production building keeps its output in ITS OWN inventory: Fort McChud (tank farm + ore bin), the Coral Grotto
 *    (resort mine: hauls bank into the grotto, not into your city storage) and your Resort plantations (crops go into the
 *    plantation barn instead of being cashed at the field).
 *  - Selling only happens at the Chud City Warehouse. Off-map goods must be SHIPPED there (own truck, hired rig, freight
 *    plane or cargo ship, existing fees); a "ship & sell" load sells at the warehouse price when it arrives.
 *    City production (city mines, city farms, the factory) is already in Chud City: it lands in / sells at the warehouse.
 *  - Auto-sell (per building, per output): a sweep dispatches loads from the building inventory to the warehouse,
 *    keeping a reserve and (optionally) anything your own recipes / running units still need.
 * Balance: no extra haircut. The cost of auto-sell is the real freight (hired-rig fee, or tying up your own truck), the
 * same daily sale tiers as a manual sale apply, and the sweep only sends a load when it is worth it (min load, fee cap).
 */
import type { Mode } from './logistics.js';

export type BuildingId = 'fortmc' | 'coral' | 'resort_farm' | 'farm';
export const BUILDINGS: Record<BuildingId, { label: string; icon: string; hub: 'city' | 'resort' | 'fortmc'; blurb: string }> = {
  fortmc: { label: 'Fort McChud', icon: '🛢️', hub: 'fortmc', blurb: 'Tank farm + Deep Ore Mine bin. Ship to the Chud City Warehouse to sell.' },
  coral: { label: 'Coral Grotto', icon: '🐚', hub: 'resort', blurb: 'Hauls from the resort mine bank here. Ship to the Chud City Warehouse to sell.' },
  resort_farm: { label: 'Resort plantation barn', icon: '🌴', hub: 'resort', blurb: 'Resort harvests are stored here. Ship to the Chud City Warehouse to sell.' },
  farm: { label: 'City farms', icon: '🌾', hub: 'city', blurb: 'Chud City fields: auto-harvest sends the crop straight to the Warehouse market.' },
};
export const isBuilding = (v: unknown): v is BuildingId => typeof v === 'string' && v in BUILDINGS;
/** Item key inside a building: 'fort:crude', 'ore:gold', 'crop:wheat'. City farms use the single key 'harvest'. */
export type InvType = 'fort' | 'ore' | 'crop';
export const invKey = (type: InvType, id: string) => `${type}:${id}`;
export const splitKey = (k: string): [InvType, string] => { const i = k.indexOf(':'); return [k.slice(0, i) as InvType, k.slice(i + 1)]; };

export interface AutoCfg { on: boolean; reserve: number; keepRecipe: boolean }
export const AUTO_DEFAULT: AutoCfg = { on: false, reserve: 0, keepRecipe: false };
export const MAX_RESERVE = 1_000_000;
/** Sweep cadence, minimum load and the fee cap for hired rigs (fee may be at most this share of the load's value). */
export const AUTO_SWEEP_MS = 60_000;
export const AUTO_MIN_LOAD = 50;
export const AUTO_MAX_FEE_SHARE = 0.4;

/** How much of `have` an auto-sell sweep may send: everything above the reserve, nothing if kept for recipes. */
export function autoQty(have: number, cfg: AutoCfg, neededByRecipe: boolean): number {
  if (!cfg.on || (cfg.keepRecipe && neededByRecipe)) return 0;
  const n = Math.floor(have) - Math.max(0, Math.floor(cfg.reserve));
  return n >= AUTO_MIN_LOAD ? n : 0;
}
/** Pick the carrier for an auto load: an idle own truck (free) first, else a hired rig if its fee is worth it; null = wait. */
export function autoCarrier(opts: { idleTruckCap: number | null; qty: number; value: number; hiredFee: (q: number) => number; hiredCap: number }): { mode: Mode; qty: number } | null {
  if (opts.idleTruckCap && opts.idleTruckCap > 0) return { mode: 'truck', qty: Math.min(opts.qty, opts.idleTruckCap) };
  const q = Math.min(opts.qty, opts.hiredCap); if (q < AUTO_MIN_LOAD) return null;
  const unit = opts.qty > 0 ? opts.value / opts.qty : 0;
  return opts.hiredFee(q) <= AUTO_MAX_FEE_SHARE * unit * q ? { mode: 'hired', qty: q } : null;
}

export interface SaleLogRow { id: string; building: BuildingId; type: InvType; item: string; qty: number; fee: number; paid: number; auto: boolean; status: 'sold' | 'stored'; note: string | null; at: number }
