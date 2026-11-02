/**
 * Mining tools (request #16, Liam): buyable upgrades over the default pickaxe. Owned forever (Postgres mine_tools), one
 * equipped at a time. Pure chip sinks: bought through the atomic wallet + ledger ('mine_tool'), priced in base chips
 * (× price index on the server). Effects are applied server-side in MinesWorld.hit():
 *  - swing time multiplier stacks with the Mining skill perk (up to −35%) but the total never goes below MIN_SWING_MUL (40%)
 *  - top tiers add a small extra-ore chance, capped together with the skill's 15% at MAX_TOTAL_BONUS (20%)
 * Tools never touch the 5% key/chest drop rate and never roll an extra drop.
 */
export type MineToolId = 'pickaxe' | 'steel_pick' | 'hand_drill' | 'power_drill' | 'jackhammer' | 'plasma_cutter';
export interface MineToolDef { id: MineToolId; name: string; tier: number; /** base chips (× price index); 0 = free starter */ price: number; /** swing/break time multiplier (before the skill perk) */ swingMul: number; /** extra-ore chance added to the skill's */ bonus: number; blurb: string; color: string; kind: 'pick' | 'drill' | 'hammer' | 'plasma' }
export const MINE_TOOLS: MineToolDef[] = [
  { id: 'pickaxe',       name: 'Pickaxe',       tier: 0, price: 0,       swingMul: 1,    bonus: 0,    kind: 'pick',   color: '#8d939a', blurb: 'The trusty starter pick.' },
  { id: 'steel_pick',    name: 'Steel Pickaxe', tier: 1, price: 2_500,   swingMul: 0.9,  bonus: 0,    kind: 'pick',   color: '#b8c4d0', blurb: 'Hardened steel head: 10% faster.' },
  { id: 'hand_drill',    name: 'Hand Drill',    tier: 2, price: 10_000,  swingMul: 0.8,  bonus: 0,    kind: 'drill',  color: '#c0563a', blurb: 'Cordless drill: 20% faster.' },
  { id: 'power_drill',   name: 'Power Drill',   tier: 3, price: 30_000,  swingMul: 0.72, bonus: 0.02, kind: 'drill',  color: '#f0b020', blurb: 'Heavy-duty drill: 28% faster, +2% bonus ore.' },
  { id: 'jackhammer',    name: 'Jackhammer',    tier: 4, price: 75_000,  swingMul: 0.64, bonus: 0.03, kind: 'hammer', color: '#e05a20', blurb: 'Pneumatic breaker: 36% faster, +3% bonus ore.' },
  { id: 'plasma_cutter', name: 'Plasma Cutter', tier: 5, price: 200_000, swingMul: 0.56, bonus: 0.05, kind: 'plasma', color: '#4ad8ff', blurb: 'Cuts rock like butter: 44% faster, +5% bonus ore.' },
];
export const DEFAULT_TOOL: MineToolId = 'pickaxe';
/** Floor on the combined (tool × skill) swing time multiplier: never faster than 40% of the base time. */
export const MIN_SWING_MUL = 0.4;
/** Cap on the combined (skill + tool) extra-ore chance. */
export const MAX_TOTAL_BONUS = 0.2;
export const isMineTool = (v: unknown): v is MineToolId => typeof v === 'string' && MINE_TOOLS.some((t) => t.id === v);
export const toolDef = (v: unknown): MineToolDef => MINE_TOOLS.find((t) => t.id === v) ?? MINE_TOOLS[0];
/** Swing time multiplier for a tool on top of the Mining perk multiplier (1 -> 0.65). */
export const combinedSwingMul = (skillMul: number, tool: unknown) => Math.max(MIN_SWING_MUL, skillMul * toolDef(tool).swingMul);
/** Extra-ore chance for a tool on top of the Mining perk chance (0 -> 0.15). */
export const combinedBonus = (skillBonus: number, tool: unknown) => Math.min(MAX_TOTAL_BONUS, Math.max(0, skillBonus) + toolDef(tool).bonus);
/** Tools unlock in order: you need the previous tier to buy the next. */
export const canBuyTool = (owned: readonly string[], id: MineToolId) => { const d = toolDef(id); return d.tier > 0 && !owned.includes(id) && (d.tier === 1 || owned.includes(MINE_TOOLS[d.tier - 1].id)); };
export interface MineToolsView { owned: MineToolId[]; equipped: MineToolId; prices: Record<string, number>; index: number }
