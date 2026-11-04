/**
 * One-time launch popup ("The Millionaire Update"). Data-driven: add a feature by appending to LAUNCH.items.
 * Each player sees a given LAUNCH.id once; the seen flag is stored server-side (server/popups.ts, launch_seen).
 * Bump `id` for a future launch popup.
 */
export interface LaunchItem { icon: string; title: string; text: string }
export interface LaunchPopup { id: string; title: string; subtitle: string; items: LaunchItem[] }

export const LAUNCH: LaunchPopup = {
  id: 'millionaire-update',
  title: 'The Millionaire Update',
  subtitle: 'A big one. Here\'s everything new:',
  items: [
    { icon: '🏠', title: 'Enter & decorate your home', text: 'Walk into any house you own, decorate it Sims-style with furniture from the new Furniture Store on the map, and invite friends over to hang out and chat.' },
    { icon: '🎣', title: 'Fishing upgrades', text: 'New bait and fly tiers that pull rarer fish, plus rod skins you can unbox in Chud Cases.' },
    { icon: '🌙', title: 'Nightly 10x event', text: 'Every night 8–9 PM (Alberta time) one game (chess, checkers, arena or poker) pays winners 10x. Check the banner to see which.' },
    { icon: '🃏', title: 'Poker full-screen', text: 'Hit the full-screen button at the poker table to fill your whole screen. Esc exits.' },
    { icon: '🌾', title: 'Farm profit preview', text: 'The seed shop now shows your real grow time and profit per tile after your Farming level and plot upgrades.' },
    { icon: '🌱', title: 'Farming level = bonus crops', text: 'Your Farming level now gives bonus yield on harvests, up to +25% more crops at level 99.' },
    { icon: '🚜', title: 'Real farming', text: 'Plough, seed, fertilize and harvest your fields yourself. Buy a tractor, seed drill, front loader or combine to work the whole field in one pass. Fertilizer and your Farming level now add yield (more crops), not a higher price.' },
    { icon: '📱', title: 'Farm on mobile', text: 'Tap “🌾 My farm” on the map to open your farm. On phones it opens full screen.' },
    { icon: '📈', title: 'Net worth charts', text: 'Player profiles now chart net worth over time.' },
    { icon: '🏛', title: 'Monument royalties', text: 'Own a monument? Earn 1% of what other players make there: ore from the mines, factory goods, fish at the dock, Speedway prizes, market sales and the casino\'s house win. Paid on top, nobody loses a chip.' },
    { icon: '⚔️', title: 'Hostile buyouts', text: 'Want someone\'s monument? Force-buy it for 2x what they paid; every chip goes to them and the royalties become yours. Each purchase is protected for 24 hours.' },
    { icon: '🕯', title: 'Stock market overhaul', text: 'The exchange now looks like a real trading app: candlestick charts with volume bars, a Markets home, Movers, a Watchlist, a Screener, your Order history, and per-company tabs for Chart, Key stats, News, Options chain, Dividends and Top holders.' },
    { icon: '📚', title: 'Learn the market', text: 'Tap any (i) next to a number for a plain-English explainer, or open the new Learn tab for every stock word in one glossary.' },
    { icon: '🏁', title: 'Speedway racing overhaul', text: 'Real car physics at the Speedway: grip, weight transfer, wall and car collisions, and Space / HB handbrake drifts with skid marks and tyre smoke. Tyre and suspension mods now change how your car handles.' },
    { icon: '🪜', title: 'The Mine goes deep', text: '40 floors under The Mine with richer ore the deeper you go, an elevator every 5 floors, creatures to fight and a ⚔️ Weapon Store.' },
    { icon: '🛢️', title: 'Fort McChud', text: 'Fly from the airport to a new oil-sands map. Lease tracts, drill wells, lay pipelines and run a refinery, gas plant and cracker to make fuel and plastics. Or build the very expensive Deep Ore Mine.' },
    { icon: '💰', title: 'Dividend totals', text: 'See every chip you\'ve earned from dividends on your Stocks portfolio and profile.' },
    { icon: '🏭', title: 'Twice the factory recipes', text: 'The factory now has 114 recipes, double what it had: bronze, electrum and crystal glass, steel beams and cables, batteries, microchips and solar panels, new jewelry, and huge builds like tractors, drones, satellites, excavators and mech suits. The food line adds cake, jam, pasta, smoothies and more.' },
    { icon: '🛥️', title: 'Resort Marina', text: 'Buy a skiff, sportfisher, yacht or superyacht at the Chud Resort Marina. Boats unlock deep-sea fishing and count toward your net worth.' },
    { icon: '🌊', title: 'Deep-sea fishing', text: 'Own a boat? Head out from the Marina to the Outer Banks, Blue Water and the Abyss for 16 new species, including the Black Marlin, Giant Squid and Coelacanth. Bigger boats reach farther and get faster bites.' },
    { icon: '💎', title: 'Premium Coral Grotto', text: 'The resort Grotto now runs rich in Gold Ore, Crystal and Diamond, and has two ores found nowhere else: Fire Opal and Abyssal Pearl. Craft them into Cut Fire Opal, Pearl Necklaces and the Tidecrown at the Jeweler.' },
    { icon: '🏝️', title: 'Bigger Chud Resort', text: 'The island doubled: Banyan Bay to the west and Sapphire Heights to the east, with Oceanfront estates, Clifftop mansions, Penthouse skyrises and six big Estate plantation plots. Priced for millionaires.' },
    { icon: '🛩️', title: 'Private jets', text: 'The Private Jet Hangar at Chud Hub International sells three jets. If you own one, you never buy a resort ticket again. Upkeep is steep and charged every day. Unpaid days pile up as arrears, and too many in a row gets the jet repossessed.' },
    { icon: '🌅', title: 'Chud Resort glow-up', text: 'The resort got a big visual upgrade: a volcanic ridge, new avenues with street lamps and traffic, sailboats and jet skis on the bay, a private jet overhead and a lighthouse on the point. Fire Opal and Abyssal Pearl now glow in the Grotto.' },
    { icon: '📦', title: 'Logistics', text: 'Ship goods map to map from the 📦 Logistics button: cargo ships every 2 hours from each map\'s new ocean port (cheapest), freight planes every hour, your own trucks (free), or hire a truck for a fee. Every load shows on the map while it moves, trucks with their owner\'s name.' },
    { icon: '🚚', title: 'Truck store', text: 'Buy a Pickup, Box Truck, Big Rig or Gold Tanker. Owned trucks haul your goods for free; sell back for 50%.' },
    { icon: '⚓', title: 'A real ocean & visual glow-up', text: 'Chud Hub now has a real ocean with waves, a beach, a breakwater and a harbour with docks, cranes and containers. Fort McChud got day/night lighting, lit roads and a coastline, and oil units, ships, planes, jets, boats, furniture, the Furniture Store and the jail all got new, more detailed models.' },
  ],
};
