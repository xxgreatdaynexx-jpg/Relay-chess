/**
 * One-time launch popup ("The Millionaire Update"). Data-driven: add a feature by adding to LAUNCH.items (its `section` picks the popup page).
 * Each player sees a given LAUNCH.id once; the seen flag is stored server-side (server/popups.ts, launch_seen).
 * Bump `id` for a future launch popup.
 */
export interface LaunchItem { section: string; icon: string; title: string; text: string }
export interface LaunchPopup { id: string; title: string; subtitle: string; items: LaunchItem[] }

/** Items grouped into pages by `section`, in first-appearance order (the popup shows one page at a time). */
export function launchPages(l: LaunchPopup): { section: string; items: LaunchItem[] }[] {
  const out: { section: string; items: LaunchItem[] }[] = [];
  for (const it of l.items) { const last = out[out.length - 1]; if (last && last.section === it.section) last.items.push(it); else out.push({ section: it.section, items: [it] }); }
  return out;
}

export const LAUNCH: LaunchPopup = {
  id: 'millionaire-update-launch-trailer',
  title: 'The Millionaire Update',
  subtitle: 'A big one. Here\'s everything new:',
  items: [
    { section: 'Headlines', icon: '⚡', title: '+20% XP on every skill', text: 'Every skill now earns 20% more XP from every activity: mining, fishing, farming, cooking, racing, the Arena and the rest. XP drops show the boosted amount.' },
    { section: 'Headlines', icon: '🗺️', title: 'Two new places to fly', text: 'Fort McChud (oil sands) and a much bigger Chud Resort are a flight away from Chud Hub International, and Logistics moves your goods between all three maps.' },
    { section: 'Fort McChud', icon: '🛢️', title: 'Fort McChud oil & gas', text: 'Fly from the airport to a new oil-sands map. Lease tracts, drill wells, lay pipelines and run a refinery, gas plant and cracker to make fuel and plastics. Or build the very expensive Deep Ore Mine.' },
    { section: 'Fort McChud', icon: '⛏️', title: 'Your own Deep Ore Mine', text: 'Build the very expensive Deep Ore Mine at Fort McChud. It digs a fixed ore mix every hour, upgrades through 3 levels for more ore, and needs plenty of power.' },
    { section: 'Fort McChud', icon: '🪨', title: 'Walk into the Fort McChud Mine', text: 'A walk-in oil-sands mine at Fort McChud: 40 floors with an elevator, tougher creatures deeper down and its own weapon store. Dig Oil Sand, Gas Shale, Tar Rock and Condensate Geodes, then unload them at the mine to feed your refinery, gas plant, coker and steam cracker.' },
    { section: 'Fort McChud', icon: '⚡', title: 'Power & gas', text: 'Gas turbines turn natural gas into power for your units. Only running units are billed for power, and the header warns you when turbines sit idle with no gas.' },
    { section: 'Buffs', icon: '🏭', title: 'Factory goods sell for more', text: 'Non-farm factory goods (metals, gems, machines, electronics) now sell to the house for 5% to 30% more, by how deep the production chain is: +5% for first-step goods like bars, up to +30% for Drills, Generators and Robots. Food and anything made from crops or fish is unchanged.' },
    { section: 'Buffs', icon: '🎣', title: 'Fishing pays 15% more', text: 'Every fish sells for 15% more, at the pond and the Resort reef pier. The daily fishing cap rises 15% too, to 115,000.' },
    { section: 'Buffs', icon: '🍳', title: 'Cooking pays 50% more', text: 'Every dish now sells for 50% more: kitchen recipes and pan-fried fish. The daily cooking cap stays at 100,000, so you reach it in about two thirds of the dishes it used to take.' },
    { section: 'Homes', icon: '🏠', title: 'Enter & decorate your home', text: 'Walk into any house you own, decorate it Sims-style with furniture from the new Furniture Store on the map, and invite friends over to hang out and chat.' },
    { section: 'Homes', icon: '🛋️', title: 'Furniture Store', text: 'A new Furniture Store landmark on the map sells beds, sofas, kitchens, lamps and more, with a 3D showroom preview of every piece.' },
    { section: 'Homes', icon: '👋', title: 'Visit friends', text: 'Open your door to friends or keep it private. Visitors walk in, see each other live and chat, and your layout is saved.' },
    { section: 'Homes', icon: '🧾', title: 'My home panel', text: 'Lists each property you own once (homes, farms, businesses and your Factory), with property tax at the price you actually paid.' },
    { section: 'The Mine', icon: '🪜', title: 'Every mine goes 40 floors deep', text: 'The Mine, the Coral Grotto and the new Fort McChud Mine all go 40 floors down, with richer ore the deeper you go and an elevator every 5 floors.' },
    { section: 'The Mine', icon: '🛗', title: 'Elevator', text: 'The lift stops every 5 floors. Once you have reached a stop, ride straight to it instead of walking back down.' },
    { section: 'The Mine', icon: '🦇', title: 'Themed monsters & bosses', text: 'Every mine has its own creatures to match its theme, and the deepest floors hide a boss: the Granite Colossus, Yeti King, Magma Titan, The Kraken and The Mega Driller.' },
    { section: 'The Mine', icon: '🧠', title: 'Smarter monsters', text: 'Monsters now spot you, chase you around rocks and fight in their own style: some swoop, some charge, some hang back and shoot. Watch for the wind-up and dodge. Bosses change tactics as they weaken.' },
    { section: 'The Mine', icon: '⚔️', title: 'Weapon Store', text: 'Buy swords from Rusty to Diamond Saber, plus armor, at the ⚔️ Weapon Store. Gear is yours forever, and locked gear tells you what you need.' },
    { section: 'The Mine', icon: '🗡️', title: 'New weapon models', text: 'Every sword and piece of gear has a new, more detailed 3D model, so you can see what you are swinging.' },
    { section: 'Farming', icon: '🚜', title: 'Real farming', text: 'Plough, seed, fertilize and harvest your fields yourself. Buy a tractor, seed drill, front loader or combine to work the whole field in one pass. Fertilizer and your Farming level now add yield (more crops), not a higher price.' },
    { section: 'Farming', icon: '🌱', title: 'Farming level = bonus crops', text: 'Your Farming level now gives bonus yield on harvests, up to +25% more crops at level 99.' },
    { section: 'Farming', icon: '🏡', title: 'Big Farms east of town', text: 'The map now reaches past the east road: eight big fenced farms (20×20, 24×24 and 30×30 tiles), each with its own barn, farmhouse, silo and machinery yard. Prices run from 145,000 to 450,000 and count toward your net worth.' },
    { section: 'Farming', icon: '🌾', title: 'Farm profit preview', text: 'The seed shop now shows your real grow time and profit per tile after your Farming level and plot upgrades.' },
    { section: 'Farming', icon: '📱', title: 'Farm on mobile', text: 'Tap “🌾 My farm” on the map to open your farm. On phones it opens full screen.' },
    { section: 'Farming', icon: '🧪', title: 'Fertilizer (#27)', text: 'New yield fertilizers add crops per harvest. The old Fertilizer farm upgrade is retired and what you paid for it is refunded automatically.' },
    { section: 'Stocks & money', icon: '🕯', title: 'Stock market overhaul', text: 'The exchange now looks like a real trading app: candlestick charts with volume bars, a Markets home, Movers, a Watchlist, a Screener, your Order history, and per-company tabs for Chart, Key stats, News, Options chain, Dividends and Top holders.' },
    { section: 'Stocks & money', icon: '📚', title: 'Learn the market', text: 'Tap any (i) next to a number for a plain-English explainer, or open the new Learn tab for every stock word in one glossary.' },
    { section: 'Stocks & money', icon: '💰', title: 'Dividend totals', text: 'See every chip you\'ve earned from dividends on your Stocks portfolio and profile.' },
    { section: 'Stocks & money', icon: '📈', title: 'Net worth charts', text: 'Player profiles now chart net worth over time.' },
    { section: 'Stocks & money', icon: '🏛', title: 'Monument royalties', text: 'Own a monument? Earn 1% of what other players make there: ore from the mines, factory goods, fish at the dock, Speedway prizes, market sales and the casino\'s house win. Paid on top, nobody loses a chip.' },
    { section: 'Stocks & money', icon: '⚔️', title: 'Hostile buyouts', text: 'Want someone\'s monument? Force-buy it for 2x what they paid; every chip goes to them and the royalties become yours. Each purchase is protected for 24 hours.' },
    { section: 'Stocks & money', icon: '🏦', title: 'Value = price paid', text: 'Your Bank, profile, wealth tax, Daily Report and property tax all value real estate at the price you actually paid.' },
    { section: 'Chud Resort', icon: '🏝️', title: 'Bigger Chud Resort', text: 'The island doubled: Banyan Bay to the west and Sapphire Heights to the east, with Oceanfront estates, Clifftop mansions, Penthouse skyrises and six big Estate plantation plots. Priced for millionaires.' },
    { section: 'Chud Resort', icon: '🛥️', title: 'Resort Marina', text: 'Buy a skiff, sportfisher, yacht or superyacht at the Chud Resort Marina. Boats unlock deep-sea fishing and count toward your net worth.' },
    { section: 'Chud Resort', icon: '🌊', title: 'Deep-sea fishing', text: 'Own a boat? Head out from the Marina to the Outer Banks, Blue Water and the Abyss for 16 new species, including the Black Marlin, Giant Squid and Coelacanth. Bigger boats reach farther and get faster bites.' },
    { section: 'Chud Resort', icon: '💎', title: 'Premium Coral Grotto', text: 'The resort Grotto now runs rich in Gold Ore, Crystal and Diamond, and has two ores found nowhere else: Fire Opal and Abyssal Pearl. Craft them into Cut Fire Opal, Pearl Necklaces and the Tidecrown at the Jeweler.' },
    { section: 'Chud Resort', icon: '🌅', title: 'Chud Resort glow-up', text: 'The resort got a big visual upgrade: a volcanic ridge, new avenues with street lamps and traffic, sailboats and jet skis on the bay, a private jet overhead and a lighthouse on the point. Fire Opal and Abyssal Pearl now glow in the Grotto.' },
    { section: 'Chud Resort', icon: '🌴', title: 'Tropical all year', text: 'The resort stays warm and snow-free all year, even when Chud Hub and Fort McChud get snow.' },
    { section: 'Travel & freight', icon: '🛩️', title: 'Private jets', text: 'The Private Jet Hangar at Chud Hub International sells three jets. If you own one, you never buy a ticket again. Upkeep is steep and charged every day. Unpaid days pile up as arrears, and too many in a row gets the jet repossessed.' },
    { section: 'Travel & freight', icon: '🛬', title: 'Fly your jet to Fort McChud', text: 'Own a private jet? Pick “Fly my jet” at Chud Hub International to fly it to Fort McChud with no ticket, and watch it land and take off at the YMC airstrip. The flight home is free and the normal jet upkeep still applies. No jet? Fort McChud tickets work as before.' },
    { section: 'Travel & freight', icon: '🧾', title: 'Jet upkeep at a glance', text: 'The Hangar and Daily Report show upkeep per day, the next charge, arrears and what you have paid. Jets waive every ticket; only the daily upkeep applies.' },
    { section: 'Travel & freight', icon: '📦', title: 'Logistics', text: 'Ship goods map to map from the 📦 Logistics button: cargo ships every 2 hours from each map\'s new ocean port (cheapest), freight planes every hour, your own trucks (free), or hire a truck for a fee. Every load shows on the map while it moves, trucks with their owner\'s name.' },
    { section: 'Travel & freight', icon: '🚚', title: 'Truck store', text: 'Buy a Pickup, Box Truck, Big Rig or Gold Tanker. Owned trucks haul your goods for free; sell back for 50%.' },
    { section: 'Travel & freight', icon: '💺', title: 'Jet passenger seats', text: 'Flying your jet somewhere? Open boarding and other players can request a seat. You accept or decline each one, bigger jets carry more people, and everyone flies there and back together.' },
    { section: 'Travel & freight', icon: '🚛', title: 'Bigger vehicles haul more', text: 'Trucks, boats and jets now have a cargo capacity that grows with their size, so bigger ones carry more per trip with lower shipping fees per unit. Capacity is shown in every store listing.' },
    { section: 'Travel & freight', icon: '🤖', title: 'Auto-sell & building inventories', text: 'Every building keeps its own inventory. Fort McChud, the Coral Grotto and your resort plantation have no market: Ship & sell sends goods by truck to the Chud City Warehouse, where they sell on arrival. Turn on auto-sell per item with a reserve and keep-for-recipes, and watch your labelled trucks drive to market.' },
    { section: 'Games & skills', icon: '🎣', title: 'Fishing upgrades', text: 'New bait and fly tiers that pull rarer fish, plus rod skins you can unbox in Chud Cases.' },
    { section: 'Games & skills', icon: '🐟', title: 'Fishing pays more away from home', text: 'Resort fishing now pays about twice what the pond does, and ocean fishing from a boat about five times as much. Each spot has its own daily limit.' },
    { section: 'Games & skills', icon: '🏒', title: 'PvP Hockey', text: 'A new 🏒 Hockey rink, like the Arena but on ice. Control one skater (or take the net if it\'s open), bots fill the rest of each 4 v 4 team. Real puck physics, passing, shots, saves, three periods and sudden-death overtime. Free to play; winners of matches with real players on both teams earn a few chips. Works on phones with touch controls.' },
    { section: 'Games & skills', icon: '🏁', title: 'Speedway racing overhaul', text: 'Real car physics at the Speedway: grip, weight transfer, wall and car collisions, and Space / HB handbrake drifts with skid marks and tyre smoke. Tyre and suspension mods now change how your car handles.' },
    { section: 'Games & skills', icon: '🏭', title: 'Twice the factory recipes', text: 'The factory now has 114 recipes, double what it had: bronze, electrum and crystal glass, steel beams and cables, batteries, microchips and solar panels, new jewelry, and huge builds like tractors, drones, satellites, excavators and mech suits. The food line adds cake, jam, pasta, smoothies and more.' },
    { section: 'Games & skills', icon: '🌙', title: 'Nightly 10x event', text: 'Every night 8–9 PM (Alberta time) one game (chess, checkers, arena or poker) pays winners 10x. Check the banner to see which.' },
    { section: 'Games & skills', icon: '🃏', title: 'Poker full-screen', text: 'Hit the full-screen button at the poker table to fill your whole screen. Esc exits.' },
    { section: 'Play together', icon: '🤝', title: 'Co-op mine raids', text: 'Form a party with friends and head into any mine together in real time. Monsters scale with your party, everyone gets their own ore, and bosses have a party version with a group loot roll.' },
    { section: 'Play together', icon: '🏟️', title: 'Hockey Stadium megaproject', text: 'The whole server builds a Hockey Stadium together. Donate chips and goods and watch the construction site grow on the map, stage by stage. When it is done, everyone gets a hockey perk, and donating permanently raises your warehouse sell cap.' },
    { section: 'Play together', icon: '📋', title: 'Group contracts', text: 'Big delivery orders on the warehouse contract board. Anyone can deliver part of an order by truck, get paid for their share, and earn a bonus if the order is filled in time.' },
    { section: 'Looks & settings', icon: '⚓', title: 'A real ocean & visual glow-up', text: 'Chud Hub now has a real ocean with waves, a beach, a breakwater and a harbour with docks, cranes and containers. Fort McChud got day/night lighting, lit roads and a coastline, and oil units, ships, planes, jets, boats, furniture, the Furniture Store and the jail all got new, more detailed models.' },
    { section: 'Looks & settings', icon: '✈️', title: 'New planes, ships & machines', text: 'Jets with real engines, noses and tails, container ships at the quay, detailed yachts and trucks, and farm machinery parked in the farm yards.' },
    { section: 'Looks & settings', icon: '🎛️', title: 'Graphics setting', text: 'Add ?lowgfx (or ?gfx=low, mid, high or auto) to the address to pick a graphics level on slower phones. It is remembered.' },
    { section: 'Looks & settings', icon: '📱', title: 'Phone polish', text: 'Phone map chips stay on one line and scroll, and the Stocks and Furniture Store screens fit small screens.' },
  ],
};
