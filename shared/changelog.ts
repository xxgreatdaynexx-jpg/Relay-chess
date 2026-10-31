/**
 * Curated, player-facing changelog. Newest first.
 * RULE: every feature commit adds (or extends) an entry at the top — plain English, no jargon.
 * `commit` is the short SHA ('' = the build this entry ships in, shown as the live build) the change shipped in; `at` is the ISO time (git log) it landed.
 */
export interface ChangelogEntry { commit: string; at: string; title: string; bullets: string[] }

export const CHANGELOG: ChangelogEntry[] = [
  { commit: '', at: '2026-10-31T11:30:00-06:00', title: 'Trailer Park', bullets: [
    'A new Trailer Park, Chud Acres, on the north-west edge of the city, with gravel lanes off the north boulevard and an entrance sign.',
    'Every player gets their own trailer with a lot that stays theirs. New players get one automatically, and the park grows new rows as it fills up.',
    'Hover over a trailer to see whose it is. Clicking your own just shows "Your trailer".',
  ] },
  { commit: 'f21ca6e', at: '2026-10-31T11:15:00-06:00', title: 'Tidier streets', bullets: [
    'Rebuilt the road network like a real city: a ring road with big smooth corners, two straight boulevards that cross in the middle, a neat downtown grid, and a waterfront drive that follows the shore.',
    'Suburbs get orderly streets with gentle curves and a few cul-de-sacs, and the city is a bit bigger with new land on every side.',
    'Landmarks and buildings sit neatly in their blocks facing the street, with nothing squeezed between roads.',
    'New-build notes no longer show up in chat; they only live here in the Changelog.',
  ] },
  { commit: 'a657e5e', at: '2026-10-31T10:45:00-06:00', title: 'Softer neon in the city', bullets: [
    'Toned down the city glow: neon signs, landmark trim, lit windows and fountains are about a third dimmer, with less bloom, so it still feels like a night city without the glare.',
  ] },
  { commit: '4ea19da', at: '2026-10-31T02:40:00-06:00', title: 'A city that feels lived-in', bullets: [
    'The streets now curve and flow: a bending ring road, sweeping boulevards, a diagonal avenue, winding suburb lanes and cul-de-sacs, with a curving waterfront along the south.',
    'Buildings line up along their street and turn with it — packed tight downtown, more spread out in the suburbs.',
    'Landmarks sit on prominent corners, plazas and the waterfront, each facing its street.',
    'Cars follow the curves of the road in their own lane.',
  ] },
  { commit: 'bfd24f8', at: '2026-10-31T01:55:00-06:00', title: 'Stock Exchange', bullets: [
    'New Stocks tab and a Stock Exchange building in the city: trade shares in 100 made-up companies across 13 sectors.',
    'Prices move every 30 seconds, follow Bank inflation and what players are doing (mining, casino, arena, factory, market), and react to big trades.',
    'Every company gets at least one news event a day that moves its price; see the news feed on the exchange and each company page.',
    'Buying and selling costs a 1% fee (burned) plus a small spread. Your shares count as assets in the Bank; shares nobody owns show as Offshore assets.',
  ] },
  { commit: 'f93b0f6', at: '2026-10-31T01:45:00-06:00', title: 'A much bigger city', bullets: [
    'The city is now about four times bigger, with the landmarks spread out across it and more streets to explore.',
    'New neighbourhoods fill the space in between: residential towers downtown, apartment blocks and row houses, and little detached homes with pitched roofs out in the suburbs, plus parks, plazas with fountains and empty lots.',
    'Zoom out further to take in the whole city. Traffic grew with the road network, so the streets stay calm.',
  ] },
  { commit: 'fda4436', at: '2026-10-31T01:05:00-06:00', title: 'Economy stats in the Bank', bullets: [
    'New 🌍 Economy tab in the Bank (your wallet): how many chips everyone holds, what all the skins, cases, ore, goods and factory machines are worth, and the total.',
    'See daily inflation — today vs yesterday plus 7- and 30-day averages — with a chart and where today’s chips came from and went.',
    'Items that have never sold get an estimated value from similar items (same rarity and type), marked “est.”.',
  ] },
  { commit: 'efcf66c', at: '2026-10-31T00:30:00-06:00', title: 'City polish', bullets: [
    'The Chess Club is now a landmark: a checkerboard plaza and a glowing king you can spot from anywhere.',
    'Animated water around the city, plus a soft glow on fast devices.',
    'Building names stay readable at every zoom level, and grow a little when you hover them.',
    'The “Back to city” button no longer hides under the volume slider.',
  ] },
  { commit: 'f473469', at: '2026-10-31T00:10:00-06:00', title: 'Change requests', bullets: [
    'New 💡 Requests menu in chat: suggest a change, upvote the ideas you want, and follow them from Open to Shipped.',
  ] },
  { commit: '847b749', at: '2026-10-30T23:45:00-06:00', title: 'Changelog in chat', bullets: [
    'New 📜 Changelog menu in the chat drawer — see what changed and which build you’re on.',
    'Chat header shows the live build number.',
    'Each new build posts a short “what’s new” note in chat.',
  ] },
  { commit: '7668bf2', at: '2026-10-30T23:37:00-06:00', title: 'Cleaner city map', bullets: [
    'The row of shortcut buttons along the bottom of the city is gone — click a building or use the top bar.',
  ] },
  { commit: '6c01bbd', at: '2026-10-30T23:30:00-06:00', title: 'City map freeze fixed', bullets: [
    'The city no longer freezes when chat or your wallet is open.',
  ] },
  { commit: '0d495cb', at: '2026-10-30T23:21:00-06:00', title: 'Mining leaderboard', bullets: [
    'New Mining leaderboard: see who’s earned the most chips, mined the most ore, and banked the biggest haul, today, this week, or all time. Find it in the Mines panel or the Leaderboard’s Mining tab.',
  ] },
  { commit: '65bf548', at: '2026-10-30T23:20:00-06:00', title: 'Market fixes', bullets: [
    'Skin previews always show the right item and retry if they fail to load.',
  ] },
  { commit: 'de5b002', at: '2026-10-30T23:17:00-06:00', title: 'Factory v2', bullets: [
    'Build your own factory on a grid: belts, inserters, splitters and machines.',
    'Machinist shop, floor expansions and a 32-recipe tech tree.',
    'Your factory keeps producing while you’re away.',
  ] },
  { commit: '71ac7df', at: '2026-10-30T23:14:00-06:00', title: 'Market tab', bullets: [
    'The Market has its own tab: every skin, case, key, ore and good is listed — even ones nobody is selling yet — with the last sale price.',
    'Price charts and recent sales for each item, plus your own buy and sell history.',
    'Search, filter by weapon and rarity, sort, and a “Listed only” switch.',
  ] },
  { commit: '0dc4f99', at: '2026-10-30T23:12:00-06:00', title: 'The city is home', bullets: [
    'Closing any building takes you back to the city. Relay Chess now lives in the Chess Club.',
    'Roomier city layout, and cars stay in their lanes.',
  ] },
  { commit: '567c20b', at: '2026-10-30T23:11:00-06:00', title: 'Mines: see other miners', bullets: [
    'Other players in the mine show up as miners — hard hat, headlamp, hi-vis vest — swinging their equipped pickaxe skin.',
  ] },
  { commit: '71ac7df', at: '2026-10-30T23:07:00-06:00', title: 'Market tab', bullets: [
    'New Market tab with Skins and Resources: full catalog, search, filters and sorting.',
    'Price charts for every item.',
  ] },
  { commit: '5c486f9', at: '2026-10-30T22:58:00-06:00', title: 'Mines: new pickaxe', bullets: [
    'Redesigned skinnable pickaxe with a proper wind-up, strike and follow-through.',
  ] },
  { commit: 'ea14883', at: '2026-10-30T22:55:00-06:00', title: 'World Map home', bullets: [
    'The home screen is now a 3D night city — click a building to go there.',
    'Casino, Chess Club, Mine, Arena, Factory, Warehouse, Bank, Market, Leaderboard tower and Plaza Chat.',
    '2D map for weaker devices, and a 🗺 Map button to get back.',
  ] },
  { commit: '0d4feca', at: '2026-10-30T22:51:00-06:00', title: 'Mines: haul survives deploys', bullets: [
    'What you’re carrying in the mine is saved, so a server update no longer wipes your backpack.',
  ] },
  { commit: '2eb02d1', at: '2026-10-30T22:50:00-06:00', title: 'Arena: instant-feel netcode', bullets: [
    'Server runs twice as fast (30 Hz) and fire/reload/switch feel instant.',
    'Your own rockets launch the moment you fire.',
  ] },
  { commit: 'dfe9773', at: '2026-10-30T22:35:00-06:00', title: 'Mines extraction + Factory tab', bullets: [
    'Haul your goods out through the EXIT lift to bank them.',
    'Factory is now its own top tab.',
  ] },
  { commit: 'bb855ba', at: '2026-10-30T22:35:00-06:00', title: 'Pickaxe skins', bullets: [
    '55 mining-themed pickaxe skins in cases, plus a ⛏ Pickaxe equip slot.',
  ] },
  { commit: '2ef2d97', at: '2026-10-30T22:33:00-06:00', title: 'Mines: mouse fix', bullets: ['Mouse look in the mine is no longer inverted.'] },
  { commit: 'd3d0fdc', at: '2026-10-30T22:30:00-06:00', title: 'Arena: headshot fix', bullets: ['Headshots land and do damage again (AR-15 recoil bug).'] },
  { commit: '621272f', at: '2026-10-30T22:29:00-06:00', title: 'Materials market', bullets: ['Buy and sell ore, bars and goods with partial buys (5% fee).'] },
  { commit: 'ba2e3a3', at: '2026-10-30T22:20:00-06:00', title: 'Factory', bullets: ['Smelt ore in the furnace and craft goods at the workbench for more chips.'] },
  { commit: '253c035', at: '2026-10-30T22:17:00-06:00', title: 'Arena: grenades', bullets: ['Frag grenades on G — two per life, bounce and 2.5s fuse.'] },
  { commit: '2af3269', at: '2026-10-30T22:10:00-06:00', title: 'The Mines', bullets: ['New first-person mine: dig ore and rock and sell it. Same engine as the Arena.'] },
  { commit: '31931a9', at: '2026-10-30T22:05:00-06:00', title: 'Arena: predicted hit markers', bullets: ['Tracers, hit markers and damage numbers show instantly; the server still confirms.'] },
  { commit: 'f3bbb4b', at: '2026-10-30T21:59:00-06:00', title: 'Arena: AR-15', bullets: ['New semi-auto AR-15 with a red-dot sight, plus a 55-skin AR-15 set.'] },
  { commit: '2a3b24c', at: '2026-10-30T21:54:00-06:00', title: 'Arena: kill cam v2', bullets: ['Much smoother kill cam replay from the killer’s eyes.'] },
  { commit: 'cff38c6', at: '2026-10-30T21:52:00-06:00', title: 'Arena: 360 NO-SCOPE', bullets: ['Spin 360° and land an unscoped sniper kill for the announcement.'] },
  { commit: '779a220', at: '2026-10-30T21:48:00-06:00', title: 'Arena: knife buffs', bullets: ['Knife reaches further, swings faster and you move quicker with it out.'] },
  { commit: 'ce98b79', at: '2026-10-30T21:47:00-06:00', title: 'Arena: weapon drops', bullets: ['Dead players drop their gun — walk over it to pick it up if you don’t have one.'] },
  { commit: '2df01e4', at: '2026-10-30T21:40:00-06:00', title: 'Arena: Space to respawn', bullets: ['Press Space on the death screen to respawn.'] },
  { commit: '30cee81', at: '2026-10-30T21:14:00-06:00', title: '3D inventory', bullets: ['Skins show on the real 3D gun models; drag to rotate.'] },
  { commit: '8334d57', at: '2026-10-30T21:01:00-06:00', title: 'Arena: skins stick', bullets: ['Equipped skins stay on across matches, respawns and reconnects.'] },
  { commit: 'e05c9c2', at: '2026-10-30T20:59:00-06:00', title: 'Arena: loadout picker', bullets: ['Pick your loadout on an 8s respawn screen.', 'Health regenerates after a few seconds out of combat.'] },
  { commit: '074008c', at: '2026-10-30T20:45:00-06:00', title: '55 skins per weapon', bullets: ['Every weapon has 55 skins: 30 common, 20 rare, 5 ultra.'] },
  { commit: 'dff8413', at: '2026-10-30T20:43:00-06:00', title: 'Arena: combat knife', bullets: ['Knife on 6/V — slash, stab and backstab kills.'] },
  { commit: '246dc0f', at: '2026-10-30T20:43:00-06:00', title: 'Arena: homing RPG', bullets: ['Heat-seeking RPG perk with a lock-on warning.'] },
];

export const changelogBullets = (n = 3): string[] => CHANGELOG.flatMap((e) => e.bullets).slice(0, n);
