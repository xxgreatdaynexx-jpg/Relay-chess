/**
 * Dependency-free hooks for co-op perks (server/coop.ts installs them at import). Lets mines / travel / hockey / house-room
 * read perks without importing coop.ts (which imports mines + the wallet) and creating an import cycle.
 */
import type { ProjectId } from '../shared/coop.js';

let perkFn: (id: ProjectId) => boolean = () => false;
let mulFn: (name: string) => number = () => 1;
export function setCoopPerkHooks(perk: typeof perkFn, sellMul: typeof mulFn) { perkFn = perk; mulFn = sellMul; }
/** Lasting project perks (stadium: 6th paid hockey win + spectating; bridge: half-price Fort McChud tickets). */
export const coopPerk = (id: ProjectId) => perkFn(id);
/** Per-player multiplier on the daily house-sell cap from Hockey Stadium donations (1 = none, max 1.5). */
export const sellCapMul = (name: string | null | undefined) => (name ? mulFn(name) : 1);
