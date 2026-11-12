/**
 * One-time launch popup ("The Billionaire Update"). Data-driven: add a feature by adding to LAUNCH.items (its `section` picks the popup page).
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
  id: 'billionaire-update-launch',
  title: 'The Billionaire Update',
  subtitle: "It's live. Here's what's new:",
  items: [
    { section: 'The map', icon: '🗺️', title: 'A city twice as large', text: 'The map grows east of the Big Farms and north of town. East Estates lots and farms, Goldwood mansions, Orchard Ridge, a larger international airport with a second runway, and a continuous snowy landscape down to a full southern beach. Existing city blocks and deeds are not moved. Zoom out far enough to see it all.' },
    { section: 'The map', icon: '🏡', title: 'Goldwood and the East Estates', text: 'Goldwood is a community of eight mansions north of town, with its own road in. Sixteen vacant lots and ten new farms sit in the East Estates, ready to buy.' },
    { section: 'The map', icon: '🍎', title: 'Orchard Ridge', text: 'Plant fruit trees once — apples, cherries, peaches, oranges, pears or plums. They take several real days to mature, then fruit on a repeating cycle with no replanting. Juice, cider, pies and jam craft at the usual food-step markup.' },
    { section: 'The map', icon: '🍷', title: 'Wineries with an on-site press', text: 'Five wineries in Goldwood and the East Estates grow grapes faster and yield more. The on-site press makes one wine from one grape (the city cannery still needs two).' },
    { section: 'Private works', icon: '🏗️', title: 'Buy land and raise your own works', text: 'Buy a vacant East Estates lot — or demolish a house or farm you already own — and choose a data center, bitcoin farm, personal monument, mansion, highrise or power plant. Each project has four material-and-chip stages, and the building on the lot changes as you finish each one.' },
    { section: 'Private works', icon: '🖥️', title: 'Data centers and bitcoin farms', text: 'A finished data center takes up to 8 server racks (1,105 chips an hour each). A finished bitcoin farm takes up to 16 GPU rigs (454 chips an hour each). They draw power from a utility contract or a plant you own. Combined digital income is capped at 400,000 chips a day so one full farm and one full data center both run. An unpaid utility bill shuts the grid off until you pay.' },
    { section: 'Private works', icon: '⚡', title: 'Your own power plant', text: 'Build a four-stage plant (40 MW when fueled, on coal or a daily fuel contract) or buy a turnkey plant already standing in the East Estates. Surplus power can be sold back to the grid.' },
    { section: 'Private works', icon: '🌿', title: 'Hyper farms, rigs and plastics', text: 'Convert a farm you own into a Dutch glasshouse for flowers and difficult crops. Assemble an offshore rig at the shoreline dock and launch it to pump crude to Fort McChud. A city plastics plant turns Fort naphtha, ethylene or plastics into resin, computers and graphics cards.' },
    { section: 'Luxury', icon: '🥂', title: "The Billionaire's Club", text: "A civic club on the ocean beach west of the Harbour. The Prestige Desk has moved here from City Hall. High-stakes blackjack, roulette, Hold'em and Jacks or Better rooms, a house art auction, and plaques for city patrons." },
    { section: 'Luxury', icon: '🏝️', title: 'A Private Island and sky penthouses', text: 'Own a Sovereign Megayacht or any private jet and you can sail or fly to a Private Island with four estates for sale. Six sky penthouses sit around a civic tower next to the Club. Return trips are free.' },
    { section: 'Luxury', icon: '🛥️', title: 'The Sovereign Megayacht and new rides', text: 'The Marina sells the Sovereign Megayacht (8 million, the boat that sails to the island). Chud Motors adds the Nightshade and Apex One hypercars, and the Hangar adds the Chud Global Express. Yachts and superyachts now pay a daily luxury upkeep.' },
    { section: 'Luxury', icon: '🏠', title: 'Homes with real rooms', text: 'Every enterable home has a floor plan that scales with the property — real walls, doorways, trim and warmer lighting. Existing furniture is remapped into a valid room when a wall would cut through it, and is never deleted. The furniture catalogue is more than twice as large.' },
    { section: 'At sea', icon: '🌊', title: 'Voyages, boarding and opt-in combat', text: 'Sail timed voyages from the Marina. Yacht owners can open boarding for friends, the same way jet owners do. Captains who have arrived can opt in to ship combat; it is never forced, and the wallet is never pushed negative.' },
    { section: 'Monuments', icon: '🏛', title: 'Monument royalties', text: 'Own a monument? Earn a 1% cut of what other players make there: ore from the mines, fish at the dock, Speedway prizes, market sales and the casino\'s house win. Paid on top, nobody loses a chip. The Factory is a public workplace and no longer a royalty monument.' },
  ],
};

