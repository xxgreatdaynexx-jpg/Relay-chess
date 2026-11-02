/**
 * Mining tools (request #16, Liam): buyable upgrades over the default pickaxe. Owned forever (Postgres mine_tools), one
 * equipped at a time. Pure chip sinks: bought through the atomic wallet + ledger ('mine_tool'), priced in base chips
 * (× price index on the server). Effects are applied server-side in MinesWorld.hit():
 *  - swing time multiplier stacks with the Mining skill perk (up to −35%) but the total never goes below MIN_SWING_MUL (25%)
 *  - tools add expected extra ore per hit (0.5 = +50%: whole part guaranteed, fraction is a chance), stacked with the skill's 15%, capped at MAX_TOTAL_BONUS (+600%)
 * Tools never touch the 5% key/chest drop rate and never roll an extra drop.
 */
export type MineToolId = 'pickaxe' | 'steel_pick' | 'hand_drill' | 'power_drill' | 'jackhammer' | 'plasma_cutter';
export interface MineToolDef { id: MineToolId; name: string; tier: number; /** base chips (× price index); 0 = free starter */ price: number; /** swing/break time multiplier (before the skill perk) */ swingMul: number; /** extra-ore chance added to the skill's */ bonus: number; blurb: string; color: string; kind: 'pick' | 'drill' | 'hammer' | 'plasma' }
export const MINE_TOOLS: MineToolDef[] = [
  { id: 'pickaxe',       name: 'Pickaxe',       tier: 0, price: 0,       swingMul: 1,    bonus: 0,    kind: 'pick',   color: '#8d939a', blurb: 'The trusty starter pick.' },
  { id: 'steel_pick',    name: 'Steel Pickaxe', tier: 1, price: 2_500,   swingMul: 1 / 1.2, bonus: 0.5,    kind: 'pick',   color: '#b8c4d0', blurb: 'Hardened steel head: 1.2× swing speed, +50% ore.' },
  { id: 'hand_drill',    name: 'Hand Drill',    tier: 2, price: 10_000,  swingMul: 1 / 1.4, bonus: 1, kind: 'drill',  color: '#c0563a', blurb: 'Cordless drill: 1.4× swing speed, +100% ore.' },
  { id: 'power_drill',   name: 'Power Drill',   tier: 3, price: 30_000,  swingMul: 1 / 1.6, bonus: 2, kind: 'drill',  color: '#f0b020', blurb: 'Heavy-duty drill: 1.6× swing speed, +200% ore.' },
  { id: 'jackhammer',    name: 'Jackhammer',    tier: 4, price: 75_000,  swingMul: 1 / 1.8, bonus: 3.5, kind: 'hammer', color: '#e05a20', blurb: 'Pneumatic breaker: 1.8× swing speed, +350% ore.' },
  { id: 'plasma_cutter', name: 'Plasma Cutter', tier: 5, price: 200_000, swingMul: 1 / 2, bonus: 5,  kind: 'plasma', color: '#4ad8ff', blurb: 'Cuts rock like butter: 2× swing speed, +500% ore.' },
];
export const DEFAULT_TOOL: MineToolId = 'pickaxe';
/** Floor on the combined (tool × skill) swing time multiplier: never faster than 25% of (4× speed) the base time. */
export const MIN_SWING_MUL = 0.25;
/** Cap on the combined (skill + tool) expected extra ore per hit. */
export const MAX_TOTAL_BONUS = 6;
export const isMineTool = (v: unknown): v is MineToolId => typeof v === 'string' && MINE_TOOLS.some((t) => t.id === v);
export const toolDef = (v: unknown): MineToolDef => MINE_TOOLS.find((t) => t.id === v) ?? MINE_TOOLS[0];
/** Swing time multiplier for a tool on top of the Mining perk multiplier (1 -> 0.65). */
export const combinedSwingMul = (skillMul: number, tool: unknown) => Math.max(MIN_SWING_MUL, skillMul * toolDef(tool).swingMul);
/** Extra-ore chance for a tool on top of the Mining perk chance (0 -> 0.15). */
export const combinedBonus = (skillBonus: number, tool: unknown) => Math.min(MAX_TOTAL_BONUS, Math.max(0, skillBonus) + toolDef(tool).bonus);
/** Tools unlock in order: you need the previous tier to buy the next. */
export const canBuyTool = (owned: readonly string[], id: MineToolId) => { const d = toolDef(id); return d.tier > 0 && !owned.includes(id) && (d.tier === 1 || owned.includes(MINE_TOOLS[d.tier - 1].id)); };
export interface MineToolsView { owned: MineToolId[]; equipped: MineToolId; prices: Record<string, number>; index: number }

/** Extra ore for one hit: floor(bonus) guaranteed plus one more with chance frac(bonus). Expected value = bonus. */
export const extraOreRoll = (bonus: number, r: number) => { const b = Math.max(0, bonus); const w = Math.floor(b); return w + (r < b - w ? 1 : 0); };
