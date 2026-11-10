/**
 * In-game Wiki/Guide (pt2100u / Liam #56): sections built from live shared constants so the page
 * stays in sync with crops, recipes, ores, employees, fishing, Fort McChud, levers, events, etc.
 * Short hand-written intros only; numbers always come from the same modules the server uses.
 */
import { CROPS, CROP_SEED_MUL, FARM_TIERS, cropSellValue } from './farm.js';
import { TROPICAL_CROPS } from './resort.js';
import { fertilizerYieldBonus, MAX_UPGRADE_LEVEL } from './farmUpgrades.js';
import { ORES, CAVES, RECIPES as MINE_RECIPES, type CaveId } from './mines.js';
import { FOOD_STEP_MARKUP } from './factory.js';
import { RECIPES as KITCHEN_RECIPES } from './cooking.js';
import { JOBS, OFFLINE_CAP_MS, MAX_WORKERS, baseWage, baseHire, dayValue, itemsPerDay, expectedDayHaul, formatExpectedDay, MINER_EVERY_MS, WORKER_EVERY_MS } from './employment.js';
import { FISH, RARITY_ODDS, FISH_SPOT_CAP, FISH_SELL_MUL, COOLER_MAX, type FishSpot } from './fishing.js';
import { PRODUCTS, PRODUCT_ORDER, WELL_RATE, PUMPJACK_MULT, TRACTS, LEASE_BASE, WELL_COST, PUMPJACK_COST, FORTMC_TICKET_BASE } from './fortmc.js';
import { properties, TAX_RATE } from './realEstate.js';
import { LEVERS, LEVER_IDS, POLICIES, POLICY_IDS, BUILDINGS, BUILDING_IDS, PROJECTS, PROJECT_IDS, TREASURY_SHARE, fundingView, FUNDING_LEVER_IDS, leverText, RIOT_STOP_COST } from './city.js';
import { DAILY_EVENTS, DAILY_EVENT_TIERS, DAILY_EVENT_TIERS_RETUNE, EVENT_ORDER, LEGACY_EVENT_TIERS, EVENT_PAYOUT_FROM, EVENT_DAILY_FROM, EVENT_RETUNE_FROM, EVENT_TIERS, goalMul, EVENT_CLAIM_MS } from './coop3.js';

export interface WikiRow { cells: string[] }
export interface WikiSection {
  id: string; title: string; icon: string; intro: string;
  /** Free-text bullets (rules, notes). */
  bullets?: string[];
  /** Optional table. */
  headers?: string[]; rows?: WikiRow[];
  /** Search haystack (auto-filled). */
  text: string;
}

const chips = (n: number) => Math.round(n).toLocaleString('en-US');
const hrs = (ms: number) => {
  const h = ms / 3_600_000; return h >= 24 ? `${+(h / 24).toFixed(h % 24 === 0 ? 0 : 1)}d` : h >= 1 ? `${+h.toFixed(h % 1 === 0 ? 0 : 1)}h` : `${Math.round(ms / 60_000)}m`;
};
const pct = (n: number) => `${+(n * 100).toFixed(2)}%`;

function section(s: Omit<WikiSection, 'text'>): WikiSection {
  const bits = [s.title, s.intro, ...(s.bullets ?? []), ...(s.headers ?? []), ...(s.rows ?? []).flatMap((r) => r.cells)];
  return { ...s, text: bits.join(' · ').toLowerCase() };
}

export function buildWiki(): WikiSection[] {
  const fertNotes = [
    `Fertilizer levels 1–${MAX_UPGRADE_LEVEL}: ${[1, 2, 3].map((l) => `+${Math.round(fertilizerYieldBonus(l) * 100)}%`).join(' / ')} crop yield (not sell price).`,
  ];

  const recipeRows = MINE_RECIPES.map((r) => ({
    cells: [r.name, r.machine, r.in.map((x) => `${x.qty} ${x.id}`).join(', '), `${r.out.qty} ${r.out.id}`, hrs(r.ms)],
  }));

  const kitchenRows = KITCHEN_RECIPES.map((r) => ({
    cells: [r.emoji, r.label, `Lv ${r.level}`, Object.entries(r.ings).map(([k, q]) => `${q}× ${k}`).join(', ')],
  }));

  const oreRows = (Object.values(ORES) as Array<typeof ORES[keyof typeof ORES]>).map((o) => ({
    cells: [o.name, chips(o.price), String(o.hits), `F${o.minDepth}+`, String(o.spawnWeight)],
  }));
  const caveRows = (Object.keys(CAVES) as CaveId[]).map((id) => {
    const c = CAVES[id];
    const mix = new Map<string, number>();
    for (const n of c.nodes) mix.set(n.ore, (mix.get(n.ore) ?? 0) + 1);
    const total = c.nodes.length || 1;
    const parts = [...mix.entries()].sort((a, b) => b[1] - a[1]).map(([ore, n]) => `${ore} ${Math.round(n / total * 100)}%`);
    return { cells: [c.name, id, String(c.nodes.length), parts.slice(0, 6).join(', ')] };
  });

  const jobRows = JOBS.map((j) => {
    const haul = expectedDayHaul(j, null);
    return { cells: [`${j.emoji} ${j.label}`, `${itemsPerDay(j)}/day`, chips(baseWage(j)), chips(baseHire(j)), chips(Math.round(dayValue(j))), formatExpectedDay(haul)] };
  });

  const fishRows = (['lake', 'reef', 'deep'] as FishSpot[]).map((spot) => ({
    cells: [spot, chips(FISH_SPOT_CAP[spot]), String(FISH.filter((f) => (f.spot ?? 'lake') === spot).length)],
  }));

  const oilProductRows = PRODUCT_ORDER.filter((id) => PRODUCTS[id].sellable).map((id) => {
    const p = PRODUCTS[id]; return { cells: [`${p.icon} ${p.name}`, chips(p.price)] };
  });

  const propSample = properties().slice(0, 40).map((p) => ({ cells: [p.label, p.id, chips(p.price)] }));

  const leverRows = LEVER_IDS.map((id) => {
    const L = LEVERS[id];
    return { cells: [L.label, leverText(id, L.base), `${leverText(id, L.min)}–${leverText(id, L.max)}`, hrs(L.cooldownMs), L.blurb] };
  });
  const fund = fundingView(Object.fromEntries(FUNDING_LEVER_IDS.map((id) => [id, LEVERS[id].base])));

  const eventRows = EVENT_ORDER.map((id) => {
    const e = DAILY_EVENTS[id];
    return { cells: [`${e.icon} ${e.name}`, chips(e.goal) + ' ' + e.unit, e.blurb] };
  });
  const tierRows = DAILY_EVENT_TIERS_RETUNE.map((t) => ({ cells: [`${t.icon} ${t.name}`, pct(t.at) + ' of your cap', chips(t.chips)] }));

  const policyRows = POLICY_IDS.map((id) => { const p = POLICIES[id]; return { cells: [`${p.icon} ${p.label}`, chips(p.cost), p.blurb] }; });
  const buildingRows = BUILDING_IDS.map((id) => { const b = BUILDINGS[id]; return { cells: [`${b.icon} ${b.label}`, b.stages.map(chips).join(' / '), b.perkText] }; });
  const projectRows = PROJECT_IDS.map((id) => { const p = PROJECTS[id]; return { cells: [`${p.icon} ${p.label}`, chips(p.cost), hrs(p.durationMs), p.blurb] }; });

  return [
    section({
      id: 'about', title: 'About this wiki', icon: '📘',
      intro: 'Numbers on this page are generated from the same live game data the server uses, so they stay current when crops, wages, recipes or event payouts change.',
      bullets: [
        'Use the search box to filter sections. Built for phone and desktop.',
        'Hand-written intros explain the rules; tables always pull from shared constants.',
      ],
    }),
    section({
      id: 'crops', title: 'Crops & farming', icon: '🌾',
      intro: `City and resort crops. Sell value is about ${CROP_SEED_MUL}× seed (list price before the small house fee). Fertilizer boosts harvest yield, not sell price.`,
      bullets: [
        ...fertNotes,
        `Daily farm sell cap (base): full price up to ${chips(FARM_TIERS[0]!.upTo)} chips/day, then nothing.`,
        'Auto-harvest to pantry sends ripe crops to kitchen ingredients (city pantry or Resort Warehouse on plantations).',
      ],
      headers: ['', 'Crop', 'Seed', 'Sell', 'Grow', 'Where'],
      rows: [...CROPS.map((c) => ({ cells: [c.emoji, c.label, chips(c.seed), chips(cropSellValue(c)), hrs(c.grow), 'City'] })),
        ...TROPICAL_CROPS.map((c) => ({ cells: [c.emoji, c.label, chips(c.seed), chips(cropSellValue(c)), hrs(c.grow), 'Resort'] }))],
    }),
    section({
      id: 'factory', title: 'Factory & food recipes', icon: '🏭',
      intro: `Factory crafts that use farm or fish inputs are priced at ingredients plus ${Math.round((FOOD_STEP_MARKUP - 1) * 100)}% per food step. Ore/bar/jewelry recipes keep their listed prices.`,
      bullets: [
        `Food step markup constant: ×${FOOD_STEP_MARKUP}.`,
        'Kitchen fridge recipes (below) are cooked meals; Bring-in can turn fish dishes into Cooked Fish Portions.',
      ],
      headers: ['Recipe', 'Machine', 'Inputs', 'Output', 'Time'],
      rows: recipeRows,
    }),
    section({
      id: 'kitchen', title: 'Kitchen recipes', icon: '🍳',
      intro: 'Cooked dishes from the Kitchen using pantry ingredients and cooler fish.',
      headers: ['', 'Dish', 'Level', 'Ingredients'],
      rows: kitchenRows,
    }),
    section({
      id: 'ores', title: 'Ores & mines', icon: '⛏️',
      intro: 'Four player mines: The Mine, Frost Hollow, Magma Depths, and Stone Quarry (stone-only). Depth raises creature loot; quarry has no hostiles.',
      bullets: [
        'Hired miners can work mine / frost / magma / quarry with Mine priority. Manual mining uses cave nodes directly.',
      ],
      headers: ['Ore', 'Price', 'Hits', 'Min floor', 'Weight'],
      rows: oreRows,
    }),
    section({
      id: 'caves', title: 'Mine node mix', icon: '🪨',
      intro: 'Share of nodes per ore in each cave (what you see while mining by hand).',
      headers: ['Mine', 'Id', 'Nodes', 'Mix'],
      rows: caveRows,
    }),
    section({
      id: 'employees', title: 'Employment Office', icon: '🧑‍🏭',
      intro: `Hire AI workers — base cap ${MAX_WORKERS}, plus uncapped bonuses from owned buildings and landmarks. Miners pick every ${MINER_EVERY_MS / 60_000} min; fishers every ${WORKER_EVERY_MS / 60_000} min.`,
      bullets: [
        OFFLINE_CAP_MS === 0
          ? 'Workers keep working around the clock — including overnight hub sleep — as long as wages are paid. No 8-hour away stop.'
          : `Away cap: ${hrs(OFFLINE_CAP_MS)}.`,
        'Wages charge once a day; unpaid workers stop (no debt). Haul auto-deposits to mine storage / cooler. No skill XP.',
        'Expected per day matches the server pick tables (including miner priority).',
      ],
      headers: ['Job', 'Picks/day', 'Wage', 'Hire', 'Day value', 'Expected'],
      rows: jobRows,
    }),
    section({
      id: 'fishing', title: 'Fishing', icon: '🎣',
      intro: `Fish sell at ×${FISH_SELL_MUL} the base catch value. Cooler holds ${COOLER_MAX} fish.`,
      bullets: [
        `Rarity odds: ${Object.entries(RARITY_ODDS).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
        'Hired fishers use the lake table (no junk) and deposit to your cooler.',
      ],
      headers: ['Spot', 'Daily cap', '# species'],
      rows: fishRows,
    }),
    section({
      id: 'fortmc', title: 'Fort McChud oil', icon: '🛢️',
      intro: `Oilfield with ${TRACTS} tracts. Ticket ${chips(FORTMC_TICKET_BASE)} (base). Wells produce wellstream; process through separator → products.`,
      bullets: [
        `Well rate ${WELL_RATE}/h at richness 1; pumpjack ×${PUMPJACK_MULT}. Lease from ~${chips(LEASE_BASE)}, well ${chips(WELL_COST)}, pumpjack ${chips(PUMPJACK_COST)}.`,
      ],
      headers: ['Product', 'Price'],
      rows: oilProductRows,
    }),
    section({
      id: 'property', title: 'Properties & worker cap', icon: '🏠',
      intro: `Base property tax (upkeep) ${pct(TAX_RATE)} of list price. Owning landmarks and buildings raises your Employment worker cap above ${MAX_WORKERS} with no hard max — bonuses from every counted property add up.`,
      bullets: [
        'Bill Chud 1 abolished the purchase surcharge. Purchase wealth tax and daily wealth tax are mayor levers (see City levers).',
        'Sample of deeded properties (live list is longer on the map):',
      ],
      headers: ['Property', 'Id', 'Price'],
      rows: propSample,
    }),
    section({
      id: 'levers', title: 'City levers & taxes', icon: '🎚️',
      intro: 'The sitting mayor sets these within hard bounds. Cooldowns apply per lever. Casino odds are never a lever.',
      bullets: [
        `${pct(TREASURY_SHARE)} of wealth taxes and trading fees go to the city treasury.`,
        'Freight fees cannot go below the default (no discounts).',
        `At default levers, City funding is “${fund.label}”. Below defaults: policies/projects cost more, builds take longer, festival/road-repair boosts weaken. Above defaults: the reverse. Gradual — no cliff.`,
      ],
      headers: ['Lever', 'Default', 'Range', 'Cooldown', 'Notes'],
      rows: leverRows,
    }),
    section({
      id: 'events', title: 'Daily server events', icon: '🏆',
      intro: 'One rotating event per America/Regina day (UTC-6 midnight): Mining Rush → Harvest Festival → Fishing Derby → Trade Week → Hockey Cup.',
      bullets: [
        `After the day ends, claim Bronze / Silver / Gold from your personal share of the goal (full reward if the server hit 100%, half from 50%, nothing under 50%). Claim window ${hrs(EVENT_CLAIM_MS)}.`,
        `Current Gold payout ${chips(DAILY_EVENT_TIERS_RETUNE.find((t) => t.id === 'gold')!.chips)} (daily periods ≥ ${EVENT_RETUNE_FROM}). Periods ${EVENT_DAILY_FROM}–${EVENT_RETUNE_FROM - 1} kept Gold ${chips(DAILY_EVENT_TIERS.find((t) => t.id === 'gold')!.chips)}. Weekly eras kept Gold ${chips(EVENT_TIERS.find((t) => t.id === 'gold')!.chips)} from week ${EVENT_PAYOUT_FROM}; earlier weeks keep Gold ${chips(LEGACY_EVENT_TIERS.find((t) => t.id === 'gold')!.chips)}.`,
        `At 50% server progress, rewards are ×${goalMul(0.5)}.`,
      ],
      headers: ['Event', 'Goal', 'How'],
      rows: eventRows,
    }),
    section({
      id: 'event-tiers', title: 'Event claim tiers', icon: '🥇',
      intro: 'Personal contribution vs your cap unlocks a tier. Same table for every daily event.',
      headers: ['Tier', 'Need', 'Chips'],
      rows: tierRows,
    }),
    section({
      id: 'mayor', title: 'Mayor powers', icon: '🏛️',
      intro: 'Mayors set levers, start 24h economic policies, fund civic buildings and short treasury projects, and can end the decorative city riot.',
      bullets: [
        `Riot stop cost: exactly ${chips(RIOT_STOP_COST)} from the treasury (not price-indexed).`,
        'Treasury never pays a player wallet. Approval and recall rules live under City Hall.',
        'Policy / project / build costs scale with City funding (see City levers).',
      ],
      headers: ['Policy', 'Cost', 'Effect'],
      rows: policyRows,
    }),
    section({
      id: 'buildings', title: 'Civic buildings', icon: '🏗️',
      intro: 'Three stages each, paid from the treasury. One construction at a time. Build time scales with City funding.',
      headers: ['Building', 'Stage costs', 'Perk'],
      rows: buildingRows,
    }),
    section({
      id: 'projects', title: 'Treasury projects', icon: '🧰',
      intro: 'Short city-wide boosts on top of an existing civic perk. Strength scales with City funding; never exceeds the fully-built perk cap.',
      headers: ['Project', 'Cost', 'Duration', 'Effect'],
      rows: projectRows,
    }),
  ];
}

export const wikiSections = (): WikiSection[] => buildWiki();
export function filterWiki(q: string, sections = buildWiki()): WikiSection[] {
  const s = q.trim().toLowerCase();
  if (!s) return sections;
  return sections.filter((sec) => sec.text.includes(s) || sec.id.includes(s));
}
