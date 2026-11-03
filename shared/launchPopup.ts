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
    { icon: '🪜', title: 'The Mine goes deep', text: '40 floors under The Mine with richer ore the deeper you go, an elevator every 5 floors, creatures to fight and a ⚔️ Weapon Store.' },
    { icon: '💰', title: 'Dividend totals', text: 'See every chip you\'ve earned from dividends on your Stocks portfolio and profile.' },
  ],
};
