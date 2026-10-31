/** Chud Hub Stock Exchange: 100 fictional companies (names and tickers are made up for the game; tickers are exchange-local). */
export type Sector = 'tech' | 'energy' | 'mining' | 'finance' | 'healthcare' | 'retail' | 'transport' | 'entertainment' | 'food' | 'realestate' | 'defense' | 'crypto' | 'industrials';
export interface SectorInfo { id: Sector; label: string; icon: string; /** how strongly chip inflation lifts it (1 = in line) */ infl: number; /** in-game activity signal that drives it */ activity: ActivityKey; }
export type ActivityKey = 'mines' | 'casino' | 'arena' | 'factory' | 'market' | 'flow' | 'players';
export const SECTORS: SectorInfo[] = [
  { id: 'tech', label: 'Tech', icon: '💻', infl: 0.6, activity: 'players' },
  { id: 'energy', label: 'Energy', icon: '⚡', infl: 1.1, activity: 'factory' },
  { id: 'mining', label: 'Mining', icon: '⛏', infl: 1.3, activity: 'mines' },
  { id: 'finance', label: 'Finance', icon: '🏦', infl: 1.0, activity: 'flow' },
  { id: 'healthcare', label: 'Healthcare', icon: '🩺', infl: 0.4, activity: 'players' },
  { id: 'retail', label: 'Retail', icon: '🛍', infl: 0.9, activity: 'market' },
  { id: 'transport', label: 'Transport', icon: '🚚', infl: 0.8, activity: 'market' },
  { id: 'entertainment', label: 'Entertainment & Gaming', icon: '🎰', infl: 0.7, activity: 'casino' },
  { id: 'food', label: 'Food', icon: '🍔', infl: 0.8, activity: 'players' },
  { id: 'realestate', label: 'Real Estate', icon: '🏢', infl: 1.2, activity: 'flow' },
  { id: 'defense', label: 'Defense', icon: '🛡', infl: 0.5, activity: 'arena' },
  { id: 'crypto', label: 'Crypto-ish', icon: '🪙', infl: 1.5, activity: 'casino' },
  { id: 'industrials', label: 'Industrials', icon: '🏭', infl: 1.0, activity: 'factory' },
];
export const SECTOR_BY_ID = new Map(SECTORS.map((s) => [s.id, s]));

export interface Company { ticker: string; name: string; sector: Sector; blurb: string; start: number; /** daily volatility (fraction) */ vol: number; beta: number; shares: number; /** chips of trade that move the price ~100% (impact = value / liquidity) */ liquidity: number }

// [ticker, name, what they do]
const RAW: Record<Sector, Array<[string, string, string]>> = {
  tech: [['QRKL', 'Quarkline Systems', 'quantum-ish routers nobody fully understands'], ['BYTZ', 'Bytezilla', 'cloud servers in a converted bowling alley'], ['PIXF', 'Pixelforge Labs', 'graphics chips for potato PCs'], ['NRVQ', 'Nervaqua AI', 'chatbots that apologize a lot'], ['SKBX', 'Skybox Orbital', 'cheap satellites, occasionally in orbit'], ['GLTC', 'Glitchcore', 'bug bounties and the bugs themselves'], ['MNFR', 'Mainframe Rex', 'legacy software for legacy banks'], ['VXLW', 'Voxelwave', 'VR headsets with fewer headaches'], ['CDLM', 'Codelamp', 'IDE plugins that autocomplete your excuses'], ['HXPN', 'Hexapane', 'smart windows that judge the weather']],
  energy: [['SLRX', 'Solarix Grid', 'solar farms on retired parking lots'], ['VLTR', 'Voltara Power', 'city grid and suspicious meters'], ['GSHK', 'Geyshark Thermal', 'geothermal wells under the bay'], ['WNDL', 'Windle Turbines', 'wind turbines that also play music'], ['FUZN', 'Fuzion Dynamics', 'fusion, coming any decade now'], ['PTRB', 'Petrobolt', 'old-school oil with a neon logo'], ['HYDQ', 'Hydroquill', 'hydro dams and fancy fountains']],
  mining: [['ORGT', 'Oregut Mining', 'deep ore shafts under the Mine'], ['CPRK', 'Copperkin', 'copper veins and copper cables'], ['GLDV', 'Goldvane Holdings', 'gold, mostly'], ['IRNF', 'Ironfang Quarries', 'iron ore by the truckload'], ['CRYZ', 'Crystallo', 'gem-grade crystals for skins'], ['SLTE', 'Slatewick', 'rock, gravel, and more rock'], ['DPCR', 'Deep Crater Co', 'open-pit mines you can see from orbit'], ['TNGN', 'Tungstone', 'rare metals for drill bits'], ['PKXL', 'Pickaxel', 'pickaxes, carts and mine lamps']],
  finance: [['CHPB', 'Chipbank Trust', 'savings accounts for chips'], ['LDGR', 'Ledgerline', 'payments and wallet rails'], ['VLTX', 'Vaultex', 'safes, vaults, and insurance on both'], ['BRKY', 'Brokerly', 'zero-fee trading, lots of fees'], ['CRDT', 'Creditopia', 'loans with very small print'], ['HDHG', 'Hedgehog Capital', 'a hedge fund run by one guy'], ['PWNX', 'Pawnex', 'pawn shops for rare skins'], ['ISRQ', 'Insurequick', 'insurance against bad beats']],
  healthcare: [['MDBY', 'Medibyte', 'telehealth for gamer thumbs'], ['VTLS', 'Vitalis Pharma', 'energy drinks with paperwork'], ['GNSX', 'Genosix', 'gene research, mostly on yeast'], ['CLNQ', 'Cliniq', 'urgent care next to the Arena'], ['OPTK', 'Optika Vision', 'blue-light glasses'], ['BNDG', 'Bandage Bros', 'bandages and bad puns'], ['NRLX', 'Neuralux', 'brain scanners for chess players']],
  retail: [['MKTR', 'Marketeer', 'the big-box store on Main'], ['SKNS', 'Skinsy', 'cosmetic skins and case openings'], ['THFT', 'Thriftopia', 'secondhand everything'], ['BGLS', 'Bagels & Bolts', 'hardware store with a bakery'], ['CRTX', 'Cartex', 'shopping carts and checkout lanes'], ['DSCN', 'Discountopolis', 'everything for 99 chips'], ['GLMR', 'Glamora', 'fashion for avatars'], ['PKGE', 'Parcelgo', 'online orders, fast-ish delivery']],
  transport: [['RLWY', 'Railwyze', 'trains to the edge of the map'], ['TXQL', 'Taxiquill', 'yellow cabs in the city loop'], ['FRTX', 'Freightrix', 'trucks hauling ore and bars'], ['AIRB', 'Airbolt Lines', 'a two-plane airline'], ['SHPD', 'Shipyard Dock Co', 'cargo ships on the bay'], ['SCTR', 'Scootera', 'electric scooters left everywhere'], ['TNLR', 'Tunnelra', 'tunnels under traffic']],
  entertainment: [['NEOC', 'Neon Casino Group', 'the casino with the dome'], ['CRDS', 'Cardshark Studios', 'card games and poker tables'], ['SPNX', 'Spinnex', 'slot machines and jackpots'], ['ARCD', 'Arcadian', 'retro arcades'], ['SMRA', 'Streamora', 'live streams of other people playing'], ['FLMX', 'Filmax Pictures', 'action movies about mining'], ['DCHS', 'Dicehouse', 'dice, tables and felt'], ['TNWV', 'Tunewave Records', 'music for elevators and lobbies'], ['ESPX', 'Esportix', 'tournaments and team jerseys']],
  food: [['BRGR', 'Burgatron', 'robot-flipped burgers'], ['NODL', 'Noodlenaut', 'ramen in space-themed bowls'], ['TACQ', 'Tacoquake', 'tacos with a seismic kick'], ['BRWQ', 'Brewquarry', 'coffee for miners'], ['FRMS', 'Farmstead Fresh', 'greenhouse veggies'], ['SNKR', 'Snackrite', 'chips (the edible kind)'], ['PZNV', 'Pizzanova', 'pizza delivered by scooter']],
  realestate: [['TWRS', 'Towerstack REIT', 'the skyscrapers downtown'], ['PLZA', 'Plazaworks', 'the plaza and its fountain'], ['DCKS', 'Dockside Lofts', 'waterfront apartments'], ['BLKR', 'Blockrent', 'city-block landlords'], ['SBRB', 'Suburbia Homes', 'houses with identical lawns'], ['WHSE', 'Warehaus Logistics REIT', 'warehouses near the docks']],
  defense: [['ARMR', 'Armorex', 'body armor for the Arena'], ['RCOL', 'Recoilworks', 'sights, grips and recoil pads'], ['SHCR', 'Shieldcore', 'energy shields (prototype)'], ['DRNZ', 'Dronez Defense', 'surveillance drones'], ['BNKR', 'Bunkerline', 'bunkers and panic rooms'], ['RDRX', 'Radarix', 'radar and night vision']],
  crypto: [['MNCN', 'Mooncoin Labs', 'a token that only goes up (citation needed)'], ['HDLB', 'Hodlbank', 'a wallet you cannot withdraw from quickly'], ['NFTZ', 'Nifty Zoo', 'pictures of monkeys, again'], ['CHNX', 'Chainex', 'a blockchain for leaderboards'], ['GASP', 'Gasper Network', 'fees that make you gasp'], ['MEMQ', 'Memequity', 'meme coins as a service'], ['RUGG', 'Rugg Pull Partners', 'trust us']],
  industrials: [['SMLT', 'Smeltworks', 'smelters turning ore into bars'], ['GRHS', 'Gearhaus', 'gears, belts and conveyors'], ['WLDM', 'Weldmore', 'welding rigs and sparks'], ['FRGL', 'Forgeline', 'forges for tools and blades'], ['ASMX', 'Assemblix', 'assembly lines for the Factory'], ['BLTC', 'Boltcraft', 'nuts, bolts and big machines'], ['CNCR', 'Concreto', 'concrete for every pad in town'], ['ROBX', 'Robotix Arms', 'factory robot arms'], ['PPWR', 'Pipewright', 'pipes and valves that mostly hold']],
};

/** Deterministic per-company parameters (seeded by ticker), so every instance agrees. */
export const hash32 = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const seeded = (seed: number) => () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const SECTOR_VOL: Record<Sector, number> = { tech: 0.035, energy: 0.025, mining: 0.035, finance: 0.02, healthcare: 0.025, retail: 0.02, transport: 0.022, entertainment: 0.03, food: 0.015, realestate: 0.018, defense: 0.018, crypto: 0.07, industrials: 0.022 };
export const COMPANIES: Company[] = SECTORS.flatMap(({ id }) => RAW[id].map(([ticker, name, what]) => {
  const r = seeded(hash32(ticker));
  const start = Math.round((8 + Math.pow(r(), 2) * 240) * 100) / 100;
  return { ticker, name, sector: id, blurb: `${name}: ${what}.`, start, vol: Math.round(SECTOR_VOL[id] * (0.7 + r() * 0.6) * 10000) / 10000, beta: Math.round((0.6 + r() * 0.9) * 100) / 100, shares: Math.round((5 + r() * 45)) * 1000, liquidity: Math.round(30_000 + r() * 120_000) };
}));
export const COMPANY_BY_TICKER = new Map(COMPANIES.map((c) => [c.ticker, c]));

// Trading rules (shared by server and UI).
export const STOCK_FEE = 0.01; // 1% (min 1 chip) burned on every trade
export const STOCK_SPREAD = 0.005; // buys pay +0.25%, sells get -0.25%
export const MAX_TRADE_IMPACT = 0.02; // one order moves a price at most 2%
export const MAX_TICK_IMPACT = 0.05; // all orders in one tick move a price at most 5%
export const TICK_MS = 30_000;
export const IMPACT_HALF_LIFE_MS = 2 * 3_600_000;
export const feeOf = (chips: number) => Math.max(1, Math.ceil(chips * STOCK_FEE));
/** Price impact (log-fraction) of an order worth `value` chips, capped per trade. */
export const impactOf = (c: Company, value: number) => Math.min(MAX_TRADE_IMPACT, value / c.liquidity);
/** Largest order (chips) a single trade can be. */
export const maxOrderChips = (c: Company) => Math.floor(MAX_TRADE_IMPACT * c.liquidity);
/** Quote: average fill price over the impact, plus half the spread. */
export function quote(c: Company, price: number, side: 'buy' | 'sell', shares: number) {
  const value = price * shares; const imp = impactOf(c, value) * (side === 'buy' ? 1 : -1);
  const fill = price * (1 + imp / 2) * (side === 'buy' ? 1 + STOCK_SPREAD / 2 : 1 - STOCK_SPREAD / 2);
  const gross = side === 'buy' ? Math.ceil(fill * shares) : Math.floor(fill * shares);
  const fee = feeOf(gross);
  return { imp, fill, gross, fee, total: side === 'buy' ? gross + fee : gross - fee };
}

export interface NewsItem { id: string; ticker: string; at: number; headline: string; move: number; good: boolean }
const GOOD = ['beats earnings estimates', 'wins a big city contract', 'unveils a hit new product', 'is the subject of a merger rumor', 'gets an analyst upgrade', 'reports record quarterly sales', 'announces a share buyback', 'lands a celebrity endorsement'];
const BAD = ['misses earnings estimates', 'is hit by an accounting scandal', 'issues a product recall', 'loses a major contract', 'gets an analyst downgrade', 'CEO resigns abruptly', 'faces a regulator investigation', 'suffers a warehouse fire'];
/** The day's scheduled events for one company (seeded by ticker + UTC day): 1-2 events at fixed times, shock scaled by volatility. */
export function dailyEvents(c: Company, day: string): NewsItem[] {
  const r = seeded(hash32(`${c.ticker}:${day}`)); const t0 = Date.parse(`${day}T00:00:00Z`);
  const n = r() < 0.25 ? 2 : 1; const out: NewsItem[] = [];
  for (let i = 0; i < n; i++) {
    const good = r() < 0.52; const list = good ? GOOD : BAD; const what = list[Math.floor(r() * list.length)]!;
    const size = c.vol * (0.8 + r() * 1.7); // ~1-2.5 daily sigmas
    out.push({ id: `${c.ticker}:${day}:${i}`, ticker: c.ticker, at: t0 + Math.floor(r() * 86_400_000), headline: `${c.name} ${what}`, move: Math.round((good ? size : -size) * 10000) / 10000, good });
  }
  return out.sort((a, b) => a.at - b.at);
}
