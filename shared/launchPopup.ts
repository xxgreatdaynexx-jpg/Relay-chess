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
    { icon: '🎣', title: 'Fishing upgrades', text: 'New bait and fly tiers that pull rarer fish, plus rod skins you can unbox in Chud Cases.' },
    { icon: '🌙', title: 'Nightly 10x event', text: 'Every night 8–9 PM (Alberta time) one game (chess, checkers, arena or poker) pays winners 10x. Check the banner to see which.' },
    { icon: '🃏', title: 'Poker full-screen', text: 'Hit the full-screen button at the poker table to fill your whole screen. Esc exits.' },
    { icon: '🌾', title: 'Farm profit preview', text: 'The seed shop now shows your real grow time and profit per tile after your Farming level and plot upgrades.' },
    { icon: '🌱', title: 'Farming level = bonus crops', text: 'Your Farming level now gives bonus yield on harvests, up to +25% more crops at level 99.' },
    { icon: '📱', title: 'Farm on mobile', text: 'Tap “🌾 My farm” on the map to open your farm. On phones it opens full screen.' },
    { icon: '📈', title: 'Net worth charts', text: 'Player profiles now chart net worth over time.' },
    { icon: '🛢️', title: 'Fort McChud', text: 'Fly from the airport to a new oil-sands map. Lease tracts, drill wells, lay pipelines and run a refinery, gas plant and cracker to make fuel and plastics. Or build the very expensive Deep Ore Mine.' },
    { icon: '💰', title: 'Dividend totals', text: 'See every chip you\'ve earned from dividends on your Stocks portfolio and profile.' },
    { icon: '🛥️', title: 'Resort Marina', text: 'Buy a skiff, sportfisher, yacht or superyacht at the Chud Resort Marina. Boats unlock deep-sea fishing and count toward your net worth.' },
    { icon: '🌊', title: 'Deep-sea fishing', text: 'Own a boat? Head out from the Marina to the Outer Banks, Blue Water and the Abyss for 16 new species, including the Black Marlin, Giant Squid and Coelacanth. Bigger boats reach farther and get faster bites.' },
    { icon: '💎', title: 'Premium Coral Grotto', text: 'The resort Grotto now runs rich in Gold Ore, Crystal and Diamond, and has two ores found nowhere else: Fire Opal and Abyssal Pearl. Craft them into Cut Fire Opal, Pearl Necklaces and the Tidecrown at the Jeweler.' },
  ],
};
