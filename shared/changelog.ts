/**
 * Curated, player-facing changelog. Newest first.
 * RULE: every feature commit adds (or extends) an entry at the top — plain English, no jargon.
 * `commit` is the short SHA ('' = the build this entry ships in, shown as the live build) the change shipped in; `at` is the ISO time (git log) it landed.
 */
export interface ChangelogEntry { commit: string; at: string; title: string; bullets: string[] }

export const CHANGELOG: ChangelogEntry[] = [
  { commit: '', at: '2026-11-01T12:00:00-06:00', title: 'Countryside tidy-up, and country homes for sale', bullets: [
    'The countryside now matches the city: the same grass, asphalt roads with centre lines, trees and street lamps, and fields with crop rows like the farm.',
    'The lake has been fixed. It now has a proper shoreline and the same water as the river.',
    'Country homes are for sale: 63 detached homes in the hamlet and beside the fields, priced and taxed like city homes. You can also buy the 3 gas stations and 3 industrial warehouses. Click one on the map to see its deed.',
  ] },
  { commit: '64ca84e', at: '2026-11-01T11:42:56-06:00', title: 'Airport & Speedway', bullets: [
    'Chud Hub International Airport is open in the west outskirts, at the end of the west shore road. It has a terminal, a control tower and a runway, and airliners take off, circle and land. Drive up to the terminal in your car and fly to downtown or the Speedway for free.',
    'The Chud Hub Speedway is an oval track in the north-west outskirts, between The Mine and Frostbite Caverns. Line up on the grid in any car you own and set time-trial laps. The server times every lap through 4 gates, and a lap doesn\'t count if you leave the asphalt. Today\'s fastest laps and the all-time board are shown at the track.',
    'Daily Cup: enter for about 250 chips (follows the price index). Your fastest lap after entering counts. At the end of the UTC day the top 3 split the pool 50/30/20. The pool is every entry fee plus 2,000 chips from the house.',
    'Both are landmark deeds you can buy: the Airport for about 3,000,000 chips and the Speedway for about 1,500,000.',
  ] },
  { commit: '34c8def', at: '2026-11-01T11:34:25-06:00', title: 'The countryside fills in', bullets: [
    'The open ground between the city and the mines is now countryside: forests, crop fields with farmhouses and barns, hills, rocky ground around the mines and a lake in the north-east.',
    'New country roads with street lamps link all three mines, plus a little hamlet on the far shore, three gas stations and an industrial yard beside The Mine.',
    'The outskirts are better lit at night, so the mines are easy to spot. Space has been kept free in the west and north-west for what comes next.',
  ] },
  { commit: 'd15b260', at: '2026-11-01T11:18:43-06:00', title: 'Three mines on the outskirts', bullets: [
    'The Mine has moved out of the city to the west outskirts, at the end of a dirt haul track off the east–west boulevard.',
    'Two new mines have opened. Frostbite Caverns is north of the city: wide frozen halls with ice pillars, heavier on iron, silver and crystal. Magma Depths is south-east past the farm: a narrow, winding lava tube with pools you can’t cross, heavier on coal and gold.',
    'Click any mine on the map to go down, or switch mines from the picker at the top of the Mines window. All three pay about the same over time, and your storage, factory and daily selling limit are shared between them.',
    'Fixed: the building name tooltip no longer stays on screen after you drag the map.',
  ] },
  { commit: '1f083cf', at: '2026-11-01T11:06:44-06:00', title: 'Pan around the city map', bullets: [
    'Drag the city map with the mouse, or with one finger on a phone, to slide it around. You can reach every corner, from the Trailer Park to the farm district on the east edge.',
    'You can also pan with the arrow keys or WASD. They don\'t pan while you\'re typing in a box or driving a car, because driving uses those keys.',
    'Right-drag, or two fingers, to rotate. Use the mouse wheel or pinch to zoom. A short click still opens buildings and plots, and a drag never does.',
  ] },
  { commit: '28a7674', at: '2026-11-01T03:35:00-06:00', title: 'More bet sizes', bullets: [
    'Roulette and Blackjack now have 1, 50 and 1000 chip bets alongside the usual 5, 25, 100 and 500 (thanks Larry!).',
  ] },
  { commit: '7c97354', at: '2026-11-01T03:30:00-06:00', title: 'Farm district', bullets: [
    'A new farm district sits on the east edge of the map, with fenced fields, barns and silos. Its 20 farm plots are farmland you can buy, from 4×4 plots at about 3,500 chips up to a 12×10 field at about 22,000. Prices follow the daily price index, and farmland pays the usual property tax.',
    'Click a plot you own to open your farm. Pick a seed from the shop and plant tiles one at a time or all at once. Crops grow in real time on the server clock.',
    'There are 9 crops, from strawberries (2 minutes) to sunflowers (12 hours). Slower crops are worth more. Harvest within twice the grow time, or the crop withers and is lost.',
    'A harvest always gives back what the seeds cost. Profit pays in full for the first 500 chips each day, then at half rate, then at a tenth, so the daily cap is about 1,350 chips. Owned fields show their crops on the map, and you can visit anyone\'s farm to look around.',
  ] },
  { commit: '4f82d28', at: '2026-11-01T01:45:00-06:00', title: 'Car dealership & driving', bullets: [
    'Chud Motors is open on the city map: 20 cars from a stolen shopping cart (800 chips) to the Chudmobile hypercar (250,000), each with colour options, stats and a 3D preview. Prices follow the inflation index.',
    'Own as many cars as you like (up to 12) and pick your active one. Cars count toward your Bank assets, and you can sell one back for 60% of today\'s price (down 0.5% a day, never below 40%).',
    'Hit Drive on the city map to drive your car around town: WASD or arrow keys, or the on-screen pad on phones. Roll up to a building and press E to go in, Esc to park.',
    'Everyone on the city map sees other players driving, with name tags.',
  ] },
  { commit: '13ff030', at: '2026-11-01T01:45:00-06:00', title: 'City real estate', bullets: [
    'Every building, empty lot, park and plaza on the city map is now for sale. Click one to see its deed: price, owner, daily property tax, and a Buy button.',
    'Prices are steep and follow the daily price index: empty lots from about 6,500 chips, homes 9,500 to 23,000, row houses 20,000 to 42,000, apartment blocks 42,000 to 90,000 and towers 100,000 to 180,000.',
    'Landmarks are trophy deeds from 500,000 up to 2,000,000 chips. Owning one is bragging rights only, and the building stays open to everyone.',
    'Owners pay property tax of 0.5% of the price every day (UTC), and those chips are burned. Miss 3 days in a row and the city takes the property back with no refund.',
    'You can sell any property back to the city for 70% of its price. The Trailer Park stays free.',
    'Owned properties get a small gold marker, and the Bank counts real estate in net worth and shows the property tax burned.',
  ] },
  { commit: '26ffec9', at: '2026-11-01T01:30:00-06:00', title: 'Stock Exchange: dividends, funds, shorts and options', bullets: [
    'Dividends: real estate, finance, energy, food and some industrial, retail, healthcare and defense companies now pay holders a small dividend every day at 10 AM CST. Each company shows its daily yield.',
    'Index funds (CH100, Tech, Mining, Finance, Energy, Entertainment) hold a basket of companies for a 0.25% fee and pass their dividends through.',
    'Mutual funds (Rocket Growth, Dividend Income, Crypto Degen) are hand-picked baskets with a 0.5% fee and a small daily expense.',
    'Shorts: bet a stock goes down. You lock 150% of the position as collateral, pay a small daily borrow fee, and get auto-closed if it rises too far, so you can never lose more than you put in.',
    'Options: buy calls or puts with 1, 3 or 7-day expiry. You pay the premium up front, and they cash out automatically at expiry.',
    'The Portfolio tab now shows stocks, funds, shorts and options together, and all of it counts toward your assets in the Bank.',
  ] },
  { commit: '2f4c56e', at: '2026-11-01T01:30:00-06:00', title: 'Prices & payouts follow inflation', bullets: [
    'Arena prizes and spawn costs, Mines ore prices, Factory buildings and machines, and the daily bonus now move with the economy\'s inflation, so your chips keep their buying power.',
    'The index updates once a day (midnight UTC), smoothed and capped at 3% a day. See it in the Bank: "Prices & payouts: x1.00".',
    'Casino odds and payouts are unchanged. Player market prices and stocks are not indexed.',
  ] },
  { commit: 'f85ce47', at: '2026-11-01T00:45:00-06:00', title: 'Daily login bonus + Daily Report', bullets: [
    'Sign in (or just show up signed in) once a day and you get 1,000 free chips, with a "+1,000 daily bonus" pop-up.',
    'One bonus per account per day; the day resets at midnight UTC (6 PM Saskatchewan time).',
    'Your first sign-in each day also opens a Daily Report: the economy (cash, asset worth, inflation, the prices & payouts index, top stock movers) and your own wallet, assets by category, and how your net worth changed since your last report.',
    'Reopen it any time from the Wallet with the "Daily report" button.',
  ] },
  { commit: '9e0eae1', at: '2026-10-31T11:40:00-06:00', title: 'Two more trailers', bullets: [
    'Special Characters and poonhound now have trailers in the park too.',
  ] },
  { commit: '7389b4b', at: '2026-10-31T11:30:00-06:00', title: 'Trailer Park', bullets: [
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
