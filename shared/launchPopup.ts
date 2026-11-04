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
    { icon: '🛢️', title: 'Fort McChud', text: 'Fly from the airport to a new oil-sands map. Lease tracts, drill wells, lay pipelines and run a refinery, gas plant and cracker to make fuel and plastics. Or build the very expensive Deep Ore Mine.' },
    { icon: '💰', title: 'Dividend totals', text: 'See every chip you\'ve earned from dividends on your Stocks portfolio and profile.' },
    { icon: '📦', title: 'Logistics', text: 'Ship goods map to map from the 📦 Logistics button: cargo ships every 2 hours from each map\'s new ocean port (cheapest), freight planes every hour, your own trucks (free), or hire a truck for a fee. Every load shows on the map while it moves, trucks with their owner\'s name.' },
    { icon: '🚚', title: 'Truck store', text: 'Buy a Pickup, Box Truck, Big Rig or Gold Tanker. Owned trucks haul your goods for free; sell back for 50%.' },
  ],
};
