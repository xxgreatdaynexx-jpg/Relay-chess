/**
 * Curated, player-facing changelog. Newest first.
 * RULE: every feature commit adds (or extends) an entry at the top — plain English, no jargon.
 * `commit` is the short SHA ('' = the build this entry ships in, shown as the live build) the change shipped in; `at` is the ISO time (git log) it landed.
 */
export interface ChangelogEntry { commit: string; at: string; title: string; bullets: string[] }

export const CHANGELOG: ChangelogEntry[] = [
  {"commit": "", "at": "2026-11-09T17:35:00-06:00", "title": "Worker cap from property is now unlimited", "bullets": [
    "Requested by Special Characters: owning more buildings and landmarks keeps adding Employment Office hire slots with no +7 ceiling. Your cap is still base 3 plus the sum of each property’s bonus (same tiers as before: +1 / +2 / +3 / +4 by price band). Empty lots, parks, plazas, farmland, barns and plantation plots still add none.",
    "Deed cards no longer say “property bonus max +7”. Wages, hire fees and which property kinds count are unchanged.",
  ]},
  {"commit": "", "at": "2026-11-09T16:50:00-06:00", "title": "Loot Match payouts — small chips with a daily cap", "bullets": [
    "Finished 30-move Loot Match rounds now pay a little: 🪙 1 chip per 500 points, max 300 chips per round, and 1,500 chips per player per America/Regina day. Only completed rounds pay; the server issues a start-round token, requires ~45 seconds of play, and rejects implausible scores.",
    "The game shows Today: X / 1,500. No payouts for rounds played before this update. Personal best and the leaderboard are unchanged.",
  ]},
  {"commit": "", "at": "2026-11-09T16:45:00-06:00", "title": "Delivery trucks on the city map", "bullets": [
    "When goods move around Chud Hub — farm harvests to the Warehouse pantry pool, factory/mine sales to market, grocery runs, Market buys, and worker hauls — a small delivery truck drives the city roads from the source to the destination with the player’s name floating above it, then despawns. Purely cosmetic: inventory, timing and chips are unchanged.",
    "Worker trucks start at the job site (mine entrance, Stone Quarry, or the fishing dock), not the Employment Office, and head to Warehouse storage. Pantry harvests go to the Chud City Warehouse (where pantry food actually lands), not the factory. Cross-map boat/plane legs are skipped (they already have visuals). Caps ~30 trucks, merges bursts, throttles background sweeps; toggle 🚚 Trucks on the city toolbar (or localStorage chud-haul-trucks-off) to hide them.",
  ]},
  {"commit": "", "at": "2026-11-09T16:30:00-06:00", "title": "Loot Match — original hub-themed match-3", "bullets": [
    "A new 💎 Loot Match game is in the top Games bar (and the city casino games list). Swap chips, ores, crops, fish and gems to match 3+. Four-of-a-kind makes a rocket, five makes a prism; cascades keep the score going. Each round has 30 moves.",
    "Built for touch: swipe to swap on phones. Personal best is saved, and signed-in players appear on a Loot Match leaderboard. No chip rewards (same as classic Solitaire) — scores only, with server-side validation so the board can’t be farmed.",
  ]},
  {"commit": "", "at": "2026-11-09T16:25:00-06:00", "title": "Players list shows online first", "bullets": [
    "The Players list in chat now lists everyone who’s online at the top, then offline players by who was last online most recently. Names break ties. Same order on desktop and mobile.",
  ]},
  {"commit": "", "at": "2026-11-09T16:20:00-06:00", "title": "In-game Wiki guide in chat", "bullets": [
    "A new 📘 Wiki button sits next to Requests and Changelog in chat. It opens a searchable, phone-friendly guide to crops, factory and kitchen recipes, ores and mines, employees, fishing, Fort McChud oil, properties, city levers and tax funding, weekly event payouts, and mayor powers.",
    "Tables are generated from the same live game constants the server uses, so wages, sell prices, event Gold (200k), and the no-8-hour worker rule stay in sync when the game changes. Short intros explain the rules in plain language.",
  ]},
  {"commit": "", "at": "2026-11-09T16:10:00-06:00", "title": "Low taxes thin city services; higher taxes strengthen them", "bullets": [
    "City Hall now shows a City funding score from the tax levers vs each default. Below the defaults, policies and treasury projects cost more, civic builds take longer, and festival / road-repair boosts are weaker. Above the defaults, the same things get a modest break — gradual, no cliff.",
    "Freight still can’t go below the default (no discounts). The 25% treasury share, lever cooldowns, and Bill Chud 1 (abolished property surcharge) are unchanged. Nothing is charged retroactively: only new policies, projects and builds, plus live festival/road-repair strength, follow the score.",
  ]},
  {"commit": "", "at": "2026-11-09T15:55:00-06:00", "title": "Weekly event gold reward is now 200,000 chips", "bullets": [
    "When a weekly server event (Mining Rush, Harvest Festival, Fishing Derby, Trade Week, or Hockey Cup) finishes and the goal was reached, the Gold claim is 200,000 chips (was 15,000). Silver is 80,000 and Bronze is 26,667 — the same ratios as before. Half rewards still apply if the server hit 50% but missed the goal; nothing under 50%.",
    "Only weeks from this one onward use the new amounts. Earlier weeks keep the old 15,000 / 6,000 / 2,000 Gold / Silver / Bronze payouts. Claim rules are unchanged: one claim per account after the week ends.",
  ]},
  {"commit": "", "at": "2026-11-09T14:50:00-06:00", "title": "Hired workers keep working overnight and while you’re away", "bullets": [
    "Employment Office workers no longer stop after 8 hours without a visit. As long as their daily wage is paid, they keep mining or fishing around the clock — including during the hub’s overnight sleep (01:00–07:00 America/Edmonton) and after a server restart or deploy.",
    "Opening the office is optional for production. Unpaid workers still stop when you can’t cover wages (no debt). If storage or the cooler is full they hold the haul until there’s room. Workers who were already idle from the old away-cap resume from now without backfilling the gap. Wages and Expected per day are unchanged.",
  ]},
  {"commit": "", "at": "2026-11-09T14:08:00-06:00", "title": "Resort plantations can auto-harvest to the resort pantry", "bullets": [
    "Plantation plots at Chud Resort now support To pantry and Auto-harvest to pantry. Crops go into the Resort Warehouse as kitchen ingredients (the same stock resort kitchens cook from), not the city pantry. Auto-sell and auto-pantry stay alternatives on each plot.",
    "If the Resort Warehouse pantry is full, ripe crops stay on the field. Fertilizer still adds yield the same way as in the city. Resort autos now run offline like city farms; you still need to be at the resort to plant or harvest by hand. Sending plantation crops straight to the city factory is still blocked — ship them instead.",
  ]},
  {"commit": "", "at": "2026-11-09T13:25:00-06:00", "title": "Fertilizer now boosts harvest yield instead of sell price", "bullets": [
    "The Fertilizer farm upgrade (+10% / +20% / +30% at levels 1–3) now grows extra crops on harvest instead of raising the profit on each crop. Manual harvest, auto-sell, and auto-harvest to pantry all use the same yield bonus; crop sell prices stay at the usual seed × 1.5 rule.",
    "Existing Fertilizer levels on your plots keep working — they just pay out as more crops. If the pantry is full, crops still wait on the field. Sprinklers and Greenhouse are unchanged.",
  ]},
  {"commit": "", "at": "2026-11-09T13:10:00-06:00", "title": "Employment Office shows each worker’s expected daily haul", "bullets": [
    "Under every hired miner and fisher you’ll see Expected per day: approximate counts of each ore or fish they’d bring in over a full paid day (for example ~346 iron, ~177 stone, ~66 gold/day), plus an approximate chip value at today’s prices.",
    "Numbers use the same pick tables and catch odds the server already uses — including your miner’s Mine priority — so the display can’t drift from real output. Figures assume a full paid day of work; unpaid time and full storage still cut what you actually get. Workers still don’t use your skill or gear.",
  ]},
  {"commit": "", "at": "2026-11-09T12:15:00-06:00", "title": "Auto-harvest farm crops straight into your pantry", "bullets": [
    "Each farm plot’s Auto section now has Auto-harvest to pantry: ripe crops go into your kitchen ingredient pantry (the same city food stock as 🧺 To pantry) instead of selling for chips. It runs on the same ~30-minute server sweep while you are online or offline.",
    "Sell auto and pantry auto are alternatives — turning one on clears the other. If the pantry is full for that crop, or resort crops can’t move to the city pantry, they stay on the field and are never lost or sold by surprise. Auto-plant is unchanged.",
  ]},
  {"commit": "", "at": "2026-11-09T12:05:00-06:00", "title": "Farm crops pay 50% over seed; each factory food step adds 10%", "bullets": [
    "Harvesting a crop (or its factory raw value) now pays about 50% over the seed cost (was 20%). Example: grapes seed 150 → about 225 chips of value (was 180).",
    "Every Mill & Press / Food Line craft that uses farm or fish inputs is priced at its ingredients plus 10% (no more special wine price). Examples (base chips): wine 495 (was 700), bread 72.6, Banquet Platter 690, Chocolate Cake 568.",
    "Ore, bars, jewelry and machine recipes are unchanged. Kitchen fridge recipe values move only where they use the crop sell list (same 50% crop bases). Existing inventories and daily farm/sale caps are untouched.",
  ]},
  {"commit": "", "at": "2026-11-09T10:15:00-06:00", "title": "Factory Bring-in takes kitchen fridge fish dishes", "bullets": [
    "Bring in → Process city fish now also turns kitchen fridge fish recipes (Pan-Fried Fish, Fish Tacos, Fish & Chips, Mango-Glazed Fine Fish, Coconut Fish Curry) at your city warehouse into Cooked Fish Portions (1 per 10 chips of dish value), same as pan-fried cooler dishes. Raw cooler fish still become Fish Fillets.",
    "Non-fish fridge meals stay in the fridge to sell from the Kitchen. Resort stock still needs shipping to the city first. If nothing qualifies, the factory says so clearly instead of quietly doing nothing.",
  ]},
  {"commit": "", "at": "2026-11-09T10:00:00-06:00", "title": "Tell each miner what ore to prioritize", "bullets": [
    "In the Employment Office, each hired miner has a Mine priority menu: Balanced (the usual mix) or any ore that mine actually produces. Quarry miners stay stone-only. Changing priority is free and applies to new picks going forward; existing haul is unchanged.",
    "Prioritizing shifts the mix toward that ore without increasing how much value they bring in per hour versus Balanced. Online and offline catch-up use the same rule.",
  ]},
  {"commit": "", "at": "2026-11-09T08:35:00-06:00", "title": "Fort McChud oil products sell for about 25% more", "bullets": [
    "Crude, fuels, gas, NGL, sulfur, ethylene and plastics all sell for about 25% more at the warehouse. Well rates, free grid power, build costs and daily sale tiers are unchanged — this is a price-only buff so pipelines are not capped harder.",
    "Existing wells, leases, tanks, inventories and already-paid sales stay as they are; only new sales use the higher prices.",
  ]},
  {"commit": "", "at": "2026-11-09T08:30:00-06:00", "title": "Fort McChud oil pays back faster; starter refinery fits free power", "bullets": [
    "Wells produce twice the wellstream, separators discard 10% water instead of 15%, and crude sells for more. Free grid power is 8 MW and the refinery draws less, so a first well, separator and refinery run without power throttling. Refined fuels also pay a bit more and the refinery costs less to build.",
    "Equipment wears slower and full repairs cost 10% of the build price (was 15%). Existing wells, leases, tanks, inventories and paid history are unchanged — this is forward-looking only. Daily sale tiers and freight fees are the same.",
  ]},
  {"commit": "", "at": "2026-11-08T20:15:00-06:00", "title": "Hockey Stadium materials cut to a week of quarry stone", "bullets": [
    "Stadium foundation brick and concrete, stands concrete, and roof glass targets are much smaller so the stone craft chain is about 45,400 stone (~7 days with 9 quarry workers). Steel beams, steel, steel plate and steel cable stay the same. Removed material value moved into stage chip goals so the whole Stadium still totals 693,211 chips.",
    "Anything already donated still counts in full: stage needs never drop below what players have already given, donor credit and rewards stay, and completed stages stay completed. Requested by chessguy2.",
  ]},
  {"commit": "", "at": "2026-11-08T18:30:00-06:00", "title": "Deeper mine creature drops; Stone Quarry with miners", "bullets": [
    "Creatures in every mine drop more ore the deeper you go: about the same on floors 1–10, then rising to 8 pieces by floor 40 (was 5). Magma Golems and Abyss Wraiths drop a bit more; Deep Bosses drop about half again as much. Drops stay server-checked with the same anti-replay rules. Requested by Conner.",
    "New Stone Quarry north of the Big Farms (top-right on the map, also in the Mines picker): only Stone, denser deeper, no creatures, not a buyable monument. Countryside farm plots keep their original ids and layouts. Hire Miner · Stone Quarry at the Employment Office — same wage/offline rules as other miners, stone-only haul. Requested by chessguy2.",
    "Existing ore mixes, combat difficulty, mining tools, employee wages/buffs and the other three city mines are unchanged.",
  ]},
  {"commit": "", "at": "2026-11-08T14:00:35-06:00", "title": "Recover from profile errors and stalled sign-in connections", "bullets": ["Profile and account render errors now show a recoverable window instead of taking down the whole hub. Partial profile responses are handled more safely, and recovery does not clear saved sign-in details.", "If a sign-in attempt cannot connect to the server within 10 seconds, it now reports the connection problem and makes the button usable again. Wrong-password errors remain visible.", "This contains profile crashes and fixes a reproduced connection-wait bug; the exact cause of the reported phone green screen is not yet confirmed. Crash reports send only classified technical fields, not raw error messages or profile/session data."]},
  {"commit": "d4ed0bd", "at": "2026-11-08T11:16:05-06:00", "title": "Property purchases avoid a busy tax-recipient lookup", "bullets": ["Taxed property purchases prepare the recipient list before reserving a property-database connection, preventing concurrent purchases from blocking each other on that lookup. The locked purchase still checks the current buyer property value, tax rate and recipient eligibility.", "If recipient pricing cannot be prepared safely, the purchase refuses before charging or transferring a deed. Property prices, tax shares, ownership records and sell-back rules are unchanged."]},
  {"commit": "ae67b17", "at": "2026-11-08T09:43:08-06:00", "title": "Fort McChud map stays usable when mobile 3D cannot load", "bullets": ["Fort McChud now respects your saved 2D map setting. If 3D graphics fail to start or the graphics context is lost, it shows a touch-scrollable 2D map instead of staying on the landing screen.", "The map shows all ten lease tracts and the existing Fort sites at their map coordinates, opening the same panels. You can switch to 2D or retry 3D; existing assets, travel rules and production are unchanged."]},
  {"commit":"778c040","at":"2026-11-08T07:41:02-06:00","title":"Place furniture bought inside your home","bullets":["Furniture bought while your home is open now appears in Build without leaving and re-entering. Opening Build refreshes your furniture inventory too.","Placement, moving, rotation and removal wait for the current save instead of overlapping it; failed saves restore the previous layout. Furniture ownership and purchase prices are unchanged."]},
  {"commit":"778c040","at":"2026-11-08T07:41:02-06:00","title":"Excess worker fish refill freed cooler space promptly","bullets":["Existing fish waiting with hired fishers now refill available cooler space after selling, releasing or sending fish to Factory storage, and when you open the cooler, instead of waiting for the five-minute worker sweep.","The normal cooler limit remains. Fish that do not fit stay with the worker; this does not produce extra fish, restart workers, check them in or charge a wage. No storage upgrade or new cost was added."]},
  {"commit":"21a09ee","at":"2026-11-07T21:39:09-06:00","title":"Transfer several goods in one shipment; a roomier private jet menu","bullets":["My places → Transfer to ship: choose different goods and quantities, review the combined capacity, fee and arrival, then confirm one shipment between the City and Resort warehouses.","Goods and the shipping fee move together or not at all. Existing plane, ship, private jet and boat rules still apply; fish and cooked dishes keep their original details.","The Private Jet Hangar uses more of the available screen, with larger controls and a separate close/header above its scrolling content. The Marina is unchanged."]},
  {"commit":"d623c01","at":"2026-11-07T21:35:15-06:00","title":"Switch to your sword inside the mines","bullets":["Inside the Mine and every cave you can now switch between your mining tool and your sword without leaving: tap the ⛏️ / ⚔️ buttons at the bottom-right of the view (phones and desktop), or press 1 for the tool, 2 for the sword, or Q to toggle.","With the sword out it stays in your hand and swings only attack creatures; it no longer flips back to the pickaxe, and it never mines rock. Switch back to your tool to mine. Your choice carries across floors, and your position, floor, backpack and progress are untouched.","It uses the sword you already have equipped from the Weapon Store; nothing is given for free. Weapon damage, reach and swing speed, mining rules, prices, rewards and creature spawns are unchanged."]},
  { commit: '360fb6e', at: '2026-11-07T21:34:00-06:00', title: 'Housing base prices follow employee capacity', bullets: [
    'Homes that add one, two or three employee slots now have base prices of 10,000, 20,000 or 30,000 chips, including city, countryside and resort homes. The price follows the home’s actual employee capacity, not its footprint or bedroom count. Four-slot housing prices are unchanged.',
    'Existing owners keep their homes, furniture and employee capacity. Recorded purchase prices, city-paid sell-back basis and ordinary tax rules are unchanged; this is not a refund or back-tax reassessment.',
    'These are base prices. The normal price index, your existing property surcharge and any purchase tax still apply to the final quote. Farms, barns, businesses, land and landmarks keep their existing prices.',
  ] },
  {"commit": "aceb86b", "at": "2026-11-07T20:48:30-06:00", "title": "Business income and purchasable jail and harbour deeds", "bullets": ["Gas stations and warehouses now earn automatic income while offline: for normal city purchases, the actual deed price paid to the city divided by seven days. Whole chips are credited every 10 minutes, with fractions carried forward. Seven days of accrual repay that income basis before ordinary property tax; the same rate continues without a seven-day cap or new income fees.", "Warehouse buyout exception: income is capped at the amount originally paid to the city, using the same durable basis cap as city sell-back. A premium paid to another player in a hostile buyout never increases income and is not promised seven-day payback. Normal purchases still use their actual indexed, surcharged deed price. Separate purchase and daily property taxes remain unchanged.", "Existing owners begin at this feature’s first activation, not historical ownership. New owners start a fresh clock; selling or a warehouse buyout settles the previous owner’s earned income without transferring backpay or fractional residue to the buyer. Reciprocal buyouts cannot multiply the income rate.", "City Jail and Chud Hub Harbour now have ordinary deeds in Real estate and on their physical buildings. New chosen base prices are 750,000 chips for the jail and 1,500,000 for the harbour, before normal property surcharges and taxes. Normal ownership and 70% sell-back rules apply.", "Both services stay public for everyone: ownership never controls jail enforcement, harbour travel or shipping, adds owner fees, or earns passive income for these two deeds. Existing property deeds, farms, crops, inventories and barn permissions are unchanged."]},
  { commit: 'f8872da', at: '2026-11-07T20:35:00-06:00', title: 'Co-op goals sized for a small group; a one-week stadium budget', bullets: [
    'The Hockey Stadium is now about 693,000 chips including its materials (was 25 million), keeping four stages and the same chip/material split. Existing donations, donor credit and rewards stay intact; the Bridge and completion perks are unchanged.',
    'The rotating server events are weekly, not daily. From the current Trade Week onward: 4,000 ore, 6,000 crops, 300 fish, 1,000 chips traded, or 20 paid hockey wins. One player can fill half the goal, so two players can finish; closed weeks keep their original goals and rewards.',
    'Trade Week counts chips spent on goods trades between eligible players, once for each side—not trips or a number of trades. Reward amounts, the half/full completion bonus, claim windows and already recorded contributions are unchanged. Daily Warehouse Contract Board sizes are unchanged.',
  ] },
  { commit: '0a3cc85', at: '2026-11-07T20:13:30-06:00', title: 'Barn menu shows farm status and harvest countdowns', bullets: [
    'All my farms now shows each owned plot’s empty, growing, ready and withered tile counts, plus crop names and quantities. Mixed fields show their separate counts rather than claiming the whole field is ready.',
    'Growing fields show the time until the next crop is ready and, when different, the last growing crop. Countdowns update while the menu is open and switch to ready automatically, using the same server deadlines as the farm screen. Planting and harvest changes refresh the overview without reopening it.',
    'A separately owned barn is still required. Only your own farms are included, grouped by map; inventories, travel restrictions, ordinary farm access and farm actions are unchanged.',
  ] },
  { commit: 'fbb4b2e', at: '2026-11-07T19:45:00-06:00', title: 'Every barn is sold separately from farms', bullets: [
    'All 30 barns now have their own purchase deed: 2 farm-district barns, 20 countryside barns and 8 beside Big Farms. Tap a barn or find it under Real estate → Barns. Barns are never included with any farm: owning the field beside a barn does not own or unlock that barn.',
    'New base barn prices are 7,000 chips for a countryside barn, 17,500 for the first farm-district barn or a Big Farm barn, and 24,000 for the second farm-district barn. Normal property surcharge, purchase wealth tax where applicable, daily property tax and 70% sell-back rules apply.',
    'A separately purchased barn unlocks All my farms, showing only your farms grouped by map. Existing farm deeds, owners, prices, crops and stock are untouched. The surviving barn beside former jail-area farmland has only its own safe footprint for sale; the removed field is not restored.',
  ] },
  { commit: 'dc2127e', at: '2026-11-07T19:44:44-06:00', title: 'Smoother winter snow across the expanded maps', bullets: [
    'Falling snow now follows your view everywhere on the map, so it no longer stops at a visible edge over the countryside, Big Farms, airport or speedway. The amount of snow on screen is the same as before.',
    'The slushy snow on Chud City roads now also covers the countryside, Big Farms, airport and speedway roads.',
    'The snowy ground lines up across every map section, removing the hard lines where newer sections meet.',
    'The Millionaire Update sign by the airport has been removed.',
  ] },
  { commit: 'fc4aa61', at: '2026-11-07T19:44:41-06:00', title: 'Sell unplaced machines from the Machinist', bullets: [
    'Machines you bought but have not placed can now be sold straight from the 🛒 Machinist menu: press 💰 Sell 1 on that machine\'s row and confirm in the full-page dialog. You do not need to place it first.',
    'Same price as selling a placed machine: half the base Machinist price (for example 200 chips for a Press). Only unplaced machines you hold count; placed machines, belts, chests and storage are untouched.',
  ] },
  { commit: '099b2b3', at: '2026-11-07T19:38:04-06:00', title: 'Factory machine sale confirmation is no longer cut off', bullets: [
    'The "Sell this machine?" confirmation now opens as a full-screen dialog, like Sell all, instead of squeezing into the narrow scrolling Factory side menu where it was clipped. The price, Confirm and Cancel are fully visible on desktop and phones, and Esc or tapping outside cancels.',
    'The sale itself is unchanged: same server price (half the base Machinist price) and the same checks.',
  ] },
  { commit: '7e5e0d9', at: '2026-11-07T18:47:01-06:00', title: 'Barn owners can see all their farms in one menu', bullets: [
    'The barn included with a Big Farm now unlocks All my farms, including for existing owners. Open it from your barn in Chud City, the Big Farm deed, the map menu, or any of your farm screens. A newly purchased Big Farm unlocks the menu without reloading.',
    'Only your farms appear, grouped into Chud City (including countryside) and Chud Resort. Open a farm on your current map; travel first to open one on another map. Each map keeps its own inventory: this menu does not move crops or combine stock.',
    'Normal individual farm access, crops, equipment, planting and harvesting are unchanged. You do not need a barn to keep using your existing farms.',
  ] },
  { commit: 'ee0cb41', at: '2026-11-07T18:45:38-06:00', title: 'Contract Board orders sized for our player base', bullets: [
    'Daily Contract Board orders are now sized for a small group: 250 Steel (was 50,000), 100 Concrete (was 300,000), 250 Steel Plate (was 30,000), 150 Glass (was 500,000), 120 Steel Beams (was 12,000), 250 Bricks (was 600,000), 500 Steel Cable (was 40,000). Each order is about a day of three hired miners\' ore through the factory.',
    'One player can now deliver up to half of an order (was a quarter), so two players can fill one. Pay per unit and the 20% completion bonus are unchanged.',
    'Today\'s order (Glass) uses the new size, and everything already delivered to it still counts and is paid in full. Earlier orders keep the targets they ran with.',
  ] },
  { commit: 'f9f5da3', at: '2026-11-07T18:35:24-06:00', title: 'Sell factory machines; search factory pickers', bullets: [
    'Select a placed machine in your factory and press 💰 Sell. The server shows the price first: half the machine\'s base Machinist price (for example 100 chips for a Smelter). Confirm sale or Cancel. The price is a fixed resale value, not a refund of what you paid, and it never exceeds half of any price the Machinist has charged.',
    'A machine that is still working or holding items cannot be sold until it is idle and empty, so nothing inside is lost. Selling one machine never touches your other machines, belts, chests, kit or banked storage, and the rest keep their places.',
    'The machine recipe picker, the chest and inserter item filters and the Recipes tab product picker now have a search box. Type to filter by name or ingredient, clear with ✕ or Esc. Searching never changes the current pick or production; only choosing from the list does.',
  ] },
  { commit: 'a731fa4', at: '2026-11-07T16:35:00-06:00', title: 'Mining employees work faster', bullets: [
    'Employment Office miners (The Mine, Frostbite Caverns, Magma Depths) now bring in 1 ore every 2 minutes instead of 3: 50% more ore a day. Daily wages and hire fees are unchanged, so each miner earns more profit. Miners you already employ get the faster pace automatically.',
    'Fishers, manual mining, storage limits and the 8-hour away limit are unchanged.',
  ] },
  { commit: 'dfd5cf0', at: '2026-11-07T14:07:45-06:00', title: 'Mobile sheets separate headers from scrolling content', bullets: [
    'Property, farm, venue, resort and furniture sheets keep the original title and close control together in an opaque header, with only the content below it scrolling. Desktop markup and the site-navigation hide/restore behavior are unchanged.',
  ] },
  { commit: 'e26f2e2', at: '2026-11-07T13:54:02-06:00', title: 'Mobile menu titles and close buttons stay reachable', bullets: [
    'Map menus now temporarily hide the site Games/Wallet/chat bar as well as the map controls. Property lists keep their title visible while scrolling, and car, logistics and other map menus use the full phone viewport without starting underneath the site bar. Closing the menu restores navigation. Desktop layouts are unchanged.',
  ] },
  { commit: '258d641', at: '2026-11-07T13:43:00-06:00', title: 'City buildings spread around Chud City', bullets: [
    'The seven City Hall projects (Highway, Park, Police, Transit, Street Lights, Hospital, School) moved out of their row west of the city onto streets that suit them: police by City Hall, hospital in midtown, transit on the north avenue, school among the north-west homes, the park on the east side, the lights depot by the Warehouse and the highway office at the west exit. Build progress and perks are unchanged.',
    'A few unowned houses and lots under the new sites are no longer for sale. No owned property was moved or removed; an owner of such a lot keeps it.',
  ] },
  { commit: '1361aec', at: '2026-11-07T13:36:21-06:00', title: 'Mobile menus stay clear of map controls', bullets: [
    'On phones and short landscape screens, open menus hide the map navigation, clock and Trade Week bar until closed. Property, home, farm, fishing, airport, car, mechanic, logistics, co-op, marina and hangar menus fit the screen with reachable close controls and scrolling content. Desktop layouts are unchanged.',
  ] },
  { commit: "d4c8f89", at: "2026-11-07T12:49:50-06:00", title: "Farming restored; one warehouse inventory per map", bullets: [
    "Farming is back to its pre-Millionaire behavior. Each player shares one inventory per map, with the Chud City Warehouse and Resort Warehouse.",
    "Same-map hauling is no longer required to use your goods. Ships and planes handle cross-map transport.",
    "Items with uncertain old locations remain safely held for review; no held-stock cashout or compensation has been paid.",
  ] },
  { commit: "1ed0d39", at: "2026-11-07T10:35:37-06:00", title: "Lower property surcharge; historical back-tax canceled and refunded", bullets: [
    "The property surcharge is now 1% per 1,000 chips of property already owned, down from 2%.",
    "Unpaid historical back-tax is permanently canceled. Actual paid back-tax has been refunded in full, including its surcharge and wealth-tax portions: 220,145 chips across three original payments.",
    "Ordinary taxes and previously distributed tax shares are unchanged.",
  ] },
  { commit: "cdcea58", at: "2026-11-07T08:39:25-06:00", title: "Larger mobile navigation targets", bullets: [
    "Mobile navigation has larger touch targets, a single-line clock and weekly-event bar, and map tiles begin below the HUD. This does not claim every mobile farm issue is fixed.",
  ] },
  { commit: "f5815ee", at: "2026-11-07T07:43:21-06:00", title: "Map launch notice cleanup", bullets: [
    "Removed the outdated Millionaire Update: soon map badge and stopped repeated prelaunch-notice requests.",
  ] },
  { commit: '', at: '2026-11-06T18:03:00-06:00', title: 'City Hall: pending mayor bills', bullets: [
    'The sitting mayor can submit one public bill per Regina calendar day. Each gets a global Bill Chud number. Bills remain public records and do not change gameplay automatically. The election runner-up serves as vice mayor and can veto a bill submitted today; the sitting mayor can veto bills from earlier days. Vetoed bills stay in the record marked Vetoed. If the mayor is removed, the vice mayor becomes mayor.',
  ] },
  { commit: '', at: '2026-11-06T12:58:00-06:00', title: 'Launch prep: back-tax + mayor rate guard on update', bullets: [
    'Property back-tax (pay under-charged land surcharge / wealth tax before more buys) and the City Hall once-per-day mayor rate Postgres guard are on the Millionaire Update branch, matching live. Per-plot farm auto plant/harvest stays off the update — warehouse auto-sell only.',
  ] },
  { commit: '', at: '2026-11-06T12:51:00-06:00', title: 'Stock charts skip closed-hours flat lines', bullets: [
    'Requested by Dayne: 24h / 7d / 30d stock price charts no longer stretch a flat line across the overnight close (22:00–12:00 Alberta time). The plot compresses to trading hours so you see price action, not the closed gap. Prices and trading are unchanged.',
  ] },
  { commit: '', at: '2026-11-06T08:09:00-06:00', title: 'Mayor election: vote counts hidden while voting', bullets: [
    'Requested by Dayne: City Hall no longer shows how many votes each candidate has during filing or voting. You still see names and slogans and can cast your vote; tallies appear on results day (Sunday).',
  ] },
  { commit: '', at: '2026-11-06T06:55:00-06:00', title: 'Chud Hub sleep ends at 7 AM', bullets: [
    'Overnight lockout is now 1–7 AM Alberta / Regina time (UTC-6), was 1–9 AM. Same message: “Chud Hub sleeps so should you.” Farm overnight pauses with the hub.',
  ] },
  { commit: '', at: '2026-11-05T18:15:00-06:00', title: 'Apology notice for carter2 softened', bullets: [
    'The harsh type-to-dismiss botting notice for carter2 was cancelled. A short sincere apology from Nora is queued instead — no typed apology required.',
  ] },
  { commit: '', at: '2026-11-05T16:45:00-06:00', title: 'Employment Office: workers now bring something in every 3 minutes', bullets: [
    'Requested by Dayne: every hired miner and fisher now brings in one item every 3 minutes (480 a day, up from every 5 minutes / 288). Wages and hire costs are unchanged.',
  ] },
  { commit: '', at: '2026-11-05T15:20:00-06:00', title: "Grandma's Wagon, the cart, Hot Dog Van and Monster Truck get makeovers", bullets: [
    "Requested by Dayne: Grandma's Wagon is a long wood-panelled station wagon with roof rails, the shopping cart gets caster wheels and a front bumper, the Hot Dog Van has a real cab, serving window and awning under a bigger hot dog, and the Monster Truck shows its shocks, roll bar, light bar and exhaust stacks up close.",
  ] },
  { commit: '', at: '2026-11-05T14:28:00-06:00', title: 'Beaters, trucks and the limo look more themselves', bullets: [
    'Requested by Dayne: Rustbucket 88 is sagging and rusty next to the Pizza Hatch (roof sign stays). Trailblazer and Hauler get clearer fronts, the Regent limo shows stretch B-pillars, and wheel shapes differ a bit by body style.',
  ] },
  { commit: '', at: '2026-11-05T14:24:00-06:00', title: 'Supercars and muscle cars get distinct shapes', bullets: [
    'Requested by Dayne: Hypervolt is a smooth closed-front EV, Phantom is a low wedge, and Chudmobile is an ultra-low hypercar with a huge wing. Thunderhorse gets a Mustang-like fastback; Blacktop Hellcharger reads as a longer 4-door widebody.',
  ] },
  { commit: '', at: '2026-11-05T14:21:00-06:00', title: 'Sports coupes look different from each other', bullets: [
    'Requested by Dayne: Zipline GT reads lighter and more compact (Miata/BRZ cues), Neon Fang RS is more aggressive with a long hood and big wing, and Aurelia Coupe has a long-hood luxury stance with gold trim.',
  ] },
  { commit: '', at: '2026-11-05T14:12:00-06:00', title: 'Sedans look different from each other', bullets: [
    'Requested by Dayne: Commuter LX, Executive 500 and Yellow Cab no longer share one generic sedan shape. Commuter reads more like a midsize daily driver, Exec has a longer hood and upright cabin, and the Cab is boxier with a push bar and roof light.',
  ] },
  { commit: '', at: '2026-11-05T14:10:00-06:00', title: 'Engine swaps at Chud Customs', bullets: [
    'Requested by Dayne: every car can now take an engine swap (3-5 choices per car): I4 Turbo, Rotary, Flat-6, Hemi V8, Twin-turbo V6, Supercharged V8, Dual-motor EV, V12, Quad-motor EV, plus a Lawnmower and a Jet engine for the silly ones.',
    'A swap replaces the stock engine, so any car can become worth having: a fully built Rustbucket 88 with a Hemi V8 reaches about 270 km/h (about 310 with nitro). Heavy engines cost some handling. Swaps have a fixed price and putting the stock engine back is free (no refunds).',
    'Two new upgrade parts: Transmission and Weight reduction, both for faster acceleration (weight reduction also sharpens steering).',
  ] },
  { commit: '', at: '2026-11-05T13:18:00-06:00', title: 'Offline players on the player list', bullets: [
    'Requested by Dayne: players with a net worth of 10,000 chips or more now stay on the player list while offline. Their row shows when they were last online; the online count still counts only people connected now.',
  ] },
  { commit: '', at: '2026-11-05T10:40:00-06:00', title: 'Factory storage prices match the payout', bullets: [
    'Requested by carter2: Factory storage now includes the current price index in each item\'s house sell price, matching the quantity preview, Sell all confirmation and actual payout. For example, Pumpkin Pie showed 175.5 before selling but paid about 196; it now shows about 196 too.',
  ] },
  { commit: '', at: '2026-11-04T20:12:00-06:00', title: 'Inactive accounts disabled and tax-sharing floor', bullets: [
    'Chessguy, carter and Jay’s 27 alternate accounts have been disabled reversibly. Their ledger history is retained; chessguy2, carter2 and Jay’s main account are unaffected.',
    'Purchase-tax and daily wealth-tax payouts now go only to eligible active players with a net worth of at least 5,000.',
  ] },
  { commit: '', at: '2026-11-04T20:10:00-06:00', title: 'House price cap moves more gently', bullets: [
    'The daily house cap now follows a quarter of the change in total player wealth, down from half (for example, if wealth rises 10% in a day, the cap rises 2.5%). It never drops below 1.',
  ] },
  { commit: '', at: '2026-11-04T20:05:00-06:00', title: 'Arena winner prize: fair-play rules', bullets: [
    'The 300-chip Arena winner prize now pays at most 5 wins per account per day (resets at 6 PM).',
    'It needs 2 or more signed-in players who each played at least 1 minute of the match, and the winner must have too.',
    'Each match pays its winner once.',
  ] },
  { commit: '', at: '2026-11-04T20:00:00-06:00', title: 'Crop and farm-food prices rebalanced', bullets: [
    'Selling a crop straight from the field now earns 20% of what its seeds cost (for example Wheat: 10 seed, 2 profit).',
    'Turning crops into factory food earns 30% of the seeds used, counted from planting to selling (for example Flour: 2 Wheat, 20 seed, sells for 26). Multi-step foods like Bread, Pumpkin Pie and Chocolate Bar follow the same rule across every crop in them; glass, iron sheets and fish count at their own value.',
    'Wine is the exception: it sells for 700, so 2 Grapes (300 seed) make 400.',
    'Factory food still gets no factory depth bonus, so these are the prices you get.',
  ] },
  { commit: '', at: '2026-11-04T19:20:00-06:00', title: 'Wine price adjusted', bullets: [
    'Wine now sells to the house for 700 (was 760). A bottle uses 2 grape seeds (300), so it makes 400 profit per bottle, 200 per seed. No other items changed.',
  ] },
  { commit: '', at: '2026-11-04T19:20:00-06:00', title: 'Tax shares need 5,000 net worth; abandoned accounts retired', bullets: [
    'Wealth tax shares (the daily tax and the 5% purchase tax) now go only to active players with a net worth of at least 5,000 (chips plus assets).',
    'Abandoned and duplicate accounts can now be retired. They can\'t sign in and drop off boards, the map, bonuses, tax shares and trades. Their history is kept.',
  ] },
  { commit: '', at: '2026-11-04T19:15:00-06:00', title: 'Land surcharge and wealth tax explained', bullets: [
    'Land surcharge: every property buy costs +2% extra for each 1,000 of property you have paid for (price paid plus upgrades). There is no cap.',
    'Wealth tax: once your property is over 100,000, buys of 1,000 or more also cost 5% extra, shared with active players. Items under 1,000 are exempt.',
    'Back-tax: if you underpaid on earlier buys, use "Pay back-tax" (shown on your deeds) before you can buy more property or cars.',
  ] },
  { commit: '', at: '2026-11-04T19:00:00-06:00', title: 'One Big Farm per account', bullets: [
    'Each account can now own at most one of the eight Big Farms east of town (20×20, 24×24 or 30×30).',
    'Trying to buy a second one is refused with a clear message and nothing is charged. Countryside fields, Resort plots and small farm plots are unchanged.',
  ] },
  { commit: '', at: '2026-11-04T18:50:00-06:00', title: 'Cooking pays 50% more', bullets: [
    'Every dish now sells for 50% more, for kitchen recipes and pan-fried fish alike.',
    'The daily cooking cap stays at 100,000. The higher prices count toward it, so you reach the cap in about two thirds of the dishes.',
  ] },
  { commit: '', at: '2026-11-04T18:40:00-06:00', title: 'Fishing pays 15% more', bullets: [
    'Every fish now sells for 15% more at every spot: the pond, the Resort reef pier and the ocean (skiff through superyacht).',
    'Daily fishing caps rise 15% to match: pond 115,000, resort 230,000, ocean 575,000.',
    'Fillets for cooking and fish shipped to the factory are unchanged.',
  ] },
  { commit: '', at: '2026-11-04T18:30:00-06:00', title: 'Factory goods sell for more', bullets: [
    'Non-farm factory goods now sell to the house for more, scaled by how many production steps they take: +5% for first-step goods (bars, cut gems, crude oil), rising evenly to +30% for the deepest products (Excavator, Mech Suit, Wind Turbine).',
    'Covers metal, gem, electronics and machine chains plus Fort McChud oil & gas products. Food and anything made from crops or fish is unchanged.',
    'Only the house sell price goes up. Recipe values, net worth and all buy prices are unchanged.',
  ] },
  { commit: '', at: '2026-11-04T18:00:00-06:00', title: 'Co-op: supply contracts, fishing fleets and weekly server events', bullets: [
    'Supply contracts: agree recurring truck deliveries with another player (every 6, 12 or 24 hours, 2–14 deliveries) at a price within ±30% of the house price. The seller posts a 20% bond, the buyer\'s payment sits in escrow and is paid per delivery. A missed delivery refunds that delivery plus a penalty from the bond; two misses breach the contract. See Co-op → Contracts.',
    'Fishing fleets: sportfishers (1 seat), yachts (3) and superyachts (6) can take crew on 30-minute deep-sea trips from the Resort Marina. Crew fish from the captain\'s boat, crewed boats can land three new species (bigeye tuna, opah, blue marlin), and the captain can take a 0–30% cut of what crew sell. Daily ocean caps still apply.',
    'Weekly server events: every Monday a new event starts (Mining Rush, Harvest Festival, Fishing Derby, Trade Week, Hockey Cup). Everyone fills one goal bar shown on the map; each player\'s share is capped. When the week ends, helpers claim a bronze, silver or gold reward (half if the server got past 50% but missed the goal). Top contributors are listed in Co-op → Event.',
    'Test, bot and jailed accounts can\'t take part, and linked accounts can\'t trade contracts, crew for each other or count each other\'s trades.',
  ] },
  { commit: '', at: '2026-11-04T17:00:00-06:00', title: 'Co-op mine raids', bullets: [
    'Start a raid party from the 🤝 Raid Party box in any mine and share the code; up to 4 friends play the same mine in your own instance.',
    'Creatures scale with party size (more health, a bit more damage), but every member mines their own veins and gets their own ore from every kill.',
    'Party bosses are tougher and drop a group loot roll: everyone on the floor rolls 1-100 and the top roll wins a bonus ore pot. The elevator goes as deep as anyone in the party has reached.',
    'Guests, QA, bot and jailed accounts can’t join raid parties.',
  ] },
  { commit: '', at: '2026-11-04T16:00:00-06:00', title: 'City Hall: treasury, levers, buildings and recall', bullets: [
    'New public city treasury: 25% of property tax and Market / Stock fees go in (the rest is still burned). It can only fund city policies and buildings and never pays out to any player, the mayor included. The full ledger is public in City Hall.',
    'The mayor gets three levers, each with a cooldown: a 0–5% sales tax on the game\'s own shops (cars, trucks, boats, jets, furniture; never trades between players), the purchase wealth tax (3–7%, still 100% shared with players) and warehouse freight fees (80–120%).',
    'Mayors can run one 24-hour policy at a time from the treasury: Farming subsidy, Mining boom, Trade week or Tourism push.',
    'Seven city buildings with 3 stages each now appear in a civic district west of downtown. Each stage adds a city-wide perk: faster trucks, more XP, lower property tax (Police), cheaper tickets, cheaper freight, lower vehicle upkeep and lower trading fees.',
    'Rate the mayor daily. Low approval lets players open a recall vote; if it passes, the runner-up becomes mayor and the levers reset. Test, guest, bot and jailed accounts can\'t vote, rate, run or recall.',
    'Casino odds and payouts are not affected by anything in City Hall.',
  ] },
  { commit: '', at: '2026-11-04T12:30:00-06:00', title: 'Wealth tax threshold now counts property upgrades', bullets: [
    'Wealth tax threshold now counts property upgrades: the 100,000 line for the 5% purchase tax is what you paid for your property plus the farm upgrades you bought for it. Planted crops do not count.',
  ] },
  { commit: '', at: '2026-11-04T12:00:00-06:00', title: 'Sunflower Oil rebalanced', bullets: [
    'Sunflower Oil rebalanced: its house price is down about 11% (645 → 575). It still takes 1 sunflower and is still one of the best farm-to-factory earners.',
  ] },
  { commit: '', at: '2026-11-04T11:50:00-06:00', title: 'Wealth tax on big purchases', bullets: [
    'If you hold more than 100,000 in property (what you paid), property and car purchases cost 5% extra, shared equally with every other player active in the last 7 days. The checkout shows the exact amount and how many players share it; items under 1,000 chips are exempt.',
  ] },
  { commit: '', at: '2026-11-04T11:45:00-06:00', title: 'Net worth counts what you spent on property', bullets: [
    'Property now counts in net worth at what you actually spent on it: the price you paid plus the farm upgrades you bought for it, instead of its list price.',
    'Crops currently planted now count too, at the cost of the seeds. This applies everywhere net worth shows: your profile, the Bank and economy totals, the Daily Report and the wealth tax.',
  ] },
  { commit: '', at: '2026-11-04T11:30:00-06:00', title: 'Farming profit -5%', bullets: [
    'Farming profit -5%: harvested crops now sell for 95% of their listed value. Seed prices are unchanged.',
  ] },
  { commit: '', at: '2026-11-04T11:20:00-06:00', title: 'Sell all asks first', bullets: [
    'Factory Sell all now asks you to confirm, showing how many items and about how many chips (request #39).',
    'Ship & sell to the Warehouse asks too, with the item count, estimated chips and the freight fee.',
  ] },
  { commit: '', at: '2026-11-04T08:30:00-06:00', title: 'Total play time on profiles', bullets: [
    'Player profiles now show total play time (active time only; idle tabs don\'t count).',
  ] },
  { commit: '', at: '2026-11-03T22:10:00-06:00', title: 'Fixed a stock news exploit', bullets: [
    'Fixed a stock news exploit.',
  ] },
  { commit: '', at: '2026-11-03T20:05:00-06:00', title: 'Fixed a stock price manipulation exploit', bullets: [
    'Players can no longer pump a stock far past its market price with a string of small buys. Options are now priced off the market price, not the player-pushed price.',
  ] },
  { commit: '', at: '2026-11-03T20:00:00-06:00', title: 'City Jail', bullets: [
    'There is now a City Jail on the west side of the map between the Speedway and the Airport. Admins can jail a player with a reason and an optional timer.',
    'While jailed you can\'t trade or earn anything. You show up behind bars on the map with your timer and progress. To get out early, type "I\'m sorry grok." 10,000 times, one line at a time. Pasting doesn\'t count. No chips are taken.',
  ] },
  { commit: '', at: '2026-11-03T17:30:00-06:00', title: 'The Millionaire Update', bullets: [
    'Fishing: new bait and fly tiers that make rarer fish more likely, and rod skins you can unbox in Chud Cases.',
    'Nightly 10x event: every night 8 to 9 PM (Alberta time) one game (chess, checkers, arena or poker, picked each day) pays winners a 10x bonus, capped per win and per night. A banner shows which game.',
    'Poker: a full-screen button makes the table fill your screen. Press Esc to exit.',
    'Farm: the seed shop shows your real grow time and profit per tile after your Farming level and plot upgrades.',
    'Farm: your Farming level now gives bonus crops on every harvest, up to +25% at level 99. Bonus crops still count toward the daily farm cap.',
    'Farm on mobile: a new "My farm" button on the map opens your farm, and on phones it opens full screen.',
    'Profiles: a net worth chart shows how your wealth has changed over time.',
    'Stocks: your total dividends earned now show on your portfolio and profile.',
    'Monument royalties: owning a landmark now pays 1% of what other players earn there (mines, factory goods, fishing dock, Speedway prizes, market sales, casino house win), minted on top. Shown on the deed and your profile.',
    'Hostile buyouts: force-buy any monument for 2x what its owner paid (all of it goes to them, with a popup). The buyout price becomes the new price, royalties follow the new owner, and each purchase is protected for 24h.',
  ] },
  { commit: '', at: '2026-11-03T16:30:00-06:00', title: 'House-sell cap now follows total player wealth', bullets: [
    'Each day at the reset (6 PM CST) the daily house-sell cap changes by half the percent that total player assets (cash + holdings, the Bank total) changed over the previous day. If total wealth doubles, the cap goes up 50%; if it drops 20%, the cap drops 10%.',
    'The cap can fall when total wealth falls, but never below 100,000. If a day\'s wealth snapshot is missing, the cap stays the same. Prices and payouts still use the price index as before.',
  ] },
  { commit: '', at: '2026-11-03T15:45:00-06:00', title: 'Farm: every crop takes twice as long to grow', bullets: [
    'All farm and tropical crops now take double their old grow time (for example wheat 5 to 10 minutes, tomatoes 1 to 2 hours, cacao 12 to 24 hours). Seed costs, sell prices, yields, XP and recipes are unchanged.',
  ] },
  { commit: '', at: '2026-11-03T15:30:00-06:00', title: 'Farm: strawberries take twice as long to grow', bullets: [
    'Strawberries now take 4 minutes to grow instead of 2, so Berry Juice is slower to make. Seed cost, sell price, yields, XP and the juice recipe are unchanged.',
  ] },
  { commit: '', at: '2026-11-03T11:59:00-06:00', title: 'Real estate: property panel fits without scrolling sideways', bullets: [
    'Long values on a property deed (the surcharge note, owner, sell-back) now wrap inside the panel instead of being cut off, and the panel no longer scrolls sideways on narrow or normal screens. Prices and rules are unchanged.',
  ] },
  { commit: '', at: '2026-11-03T10:45:00-06:00', title: 'Stocks: no buying shares while you hold a call on them', bullets: [
    'If you hold an open call option on a company, you can\'t buy that company\'s shares until the call expires or you sell it. The Buy button is locked with a short note.',
    'Selling shares, other companies, puts and shorts are unaffected. Prices, fees and payouts are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T23:43:00-06:00', title: 'Wealth tax: median now counts only players worth 10,000+', bullets: [
    'The daily wealth tax median is now taken only over active players with a net worth of 10,000 or more. The threshold is still 2× that median, and anyone under 10,000 never pays.',
    'Every chip collected is still split evenly among all active players below the threshold. If nobody is at 10,000+, no tax is collected.',
  ] },
  { commit: '', at: '2026-11-02T23:18:00-06:00', title: 'House-sell room: most purchases no longer count', bullets: [
    'Only these now free up room under your daily house-sell cap: net casino losses, buying cars and car mods, property tax, resort tickets, race entries, mayor filing, Market seller fees, the wealth tax and admin removals.',
    'Buying property, farm seeds and upgrades, mine tools, factory builds and upgrades, groceries, wages and hiring no longer add room.',
  ] },
  { commit: '', at: '2026-11-02T22:50:00-06:00', title: 'Profiles: house sell room left today', bullets: [
    'Every player profile now shows how much house-sell room that player has left today out of the daily cap (100,000 × price index), plus what they sold to the house today and the room refunded from chips lost to the house.',
    'Visible to everyone. It resets at 6 PM CST (00:00 UTC). Caps, prices and payouts are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T22:29:00-06:00', title: 'Factory: view other players\' factories', bullets: [
    'New 🏭 View factory button on player profiles and next to names on the leaderboard, plus a player picker at the top of your Factory.',
    'See their layout, machines, belts, chests and what each machine is crafting, live. It\'s view only: nothing can be collected, moved, built or edited, and no storage or chip balances are shown.',
  ] },
  { commit: '', at: '2026-11-02T22:12:00-06:00', title: 'Factory: input chests share incoming items fairly', bullets: [
    'When ore, crops or other items trickle into storage, every Input Chest set to that item now gets its turn instead of the first chest you built taking them all.',
    'The chest that has handed out the fewest items goes first; ties take turns, and the starting chest rotates every tick. Inserters pulling from Input Chests share the same way. Caps, recipes and prices are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T21:19:00-06:00', title: 'Mines & Factory: chips you lose free up house-sell room', bullets: [
    'Chips you lose to the house today now add the same amount of room under your daily house-sell cap (100,000 × price index), until the reset at 6 PM CST (00:00 UTC).',
    'What counts: net casino losses (blackjack, roulette, slots, video poker, Solitro, cases), house purchases (property, seeds, farm upgrades, cars and mods, mine tools, factory builds, groceries, resort tickets, race entries, mayor filing, wages and hire fees), property tax, Market fees, the wealth tax and admin removals.',
    'What does not: trades, gifts, tips, transfers, Market purchases from other players, Hold\'em, stocks and wealth tax shares. The Factory sell panel shows the room refunded today. Casino odds and prices are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T20:47:00-06:00', title: 'Wealth tax: the richest share with everyone else', bullets: [
    'Every day at the reset (6 PM CST / 00:00 UTC), players active in the last 7 days with a net worth (chips + assets, same as profiles) above 2× the median pay 1% of the amount above that line.',
    'It comes from chips only: never more than your chip balance, never below 0, and nothing is sold. Every chip collected is split evenly among the active players below the line (ledger: "Wealth tax share"), so nothing is burned.',
    'The Economy panel shows today\'s threshold, your estimated tax or share, and the last payout. The first run is at the next reset.',
  ] },
  { commit: '', at: '2026-11-02T20:41:00-06:00', title: 'Mines & Factory: house cap back to 100,000 a day', bullets: [
    'The daily house-sell cap is back to 100,000 base chips per player (it was 25,000 for a short time tonight), then nothing until the reset at 6 PM CST (00:00 UTC).',
    'It still rises with inflation: 100,000 × the daily price index (about 106,000 today at 1.06), recalculated at each reset. The Factory sell panel shows today\'s cap. Prices and the Market are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T20:22:00-06:00', title: 'Mines & Factory: house buys up to 25,000 a day', bullets: [
    'Selling ore, bars and factory goods to the house now pays full price up to 25,000 base chips per player per day (was 100,000), then nothing until the reset at 6 PM CST (00:00 UTC).',
    'The cap rises with inflation: it is 25,000 × the daily price index (about 26,500 today at index 1.06) and is recalculated at each daily reset. The Factory sell panel shows today\'s cap.',
    'Anyone who already sold more than 25,000 today simply gets nothing more until the reset; nothing is taken back. Farm, fishing and cooking caps, prices and the Market are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T19:45:00-06:00', title: 'Farm: crops sell for 3% less', bullets: [
    'Harvest prices for every farm and plantation crop are down about 3%, for example Potatoes 120 → 115, Pumpkins 190 → 185, Grapes 330 → 320, Sunflowers 560 → 545 and Cacao 540 → 525.',
    'The cheapest crops round to the same price. Seed costs, grow times, yields, ripe windows, Fertilizer and factory/food product prices are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T19:19:00-06:00', title: 'Factory: crafted goods sell for 5% more', bullets: [
    'House prices for everything the factory makes are up about 5%, for example Silver Ring 100 → 105, Crystal Ring 290 → 305, Engine 1,190 → 1,250, Mining Drill 2,040 → 2,140, Sunflower Oil 615 → 645 and Banquet Platter 950 → 1,000.',
    'The cheapest items (Stone Brick, Glass, Screw, Glass Lens) round to the same price. Raw ore, crop and fish prices, recipes, timers, output caps and existing market listings are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T19:10:00-06:00', title: 'Real estate: surcharge now based on what you own', bullets: [
    'Requested by carter2: the old ×1.5-per-property price jump is gone. Your next purchase now costs +2% for every 1,000 chips of property you already own (by list price), with no cap.',
    'Owning nothing means no surcharge. A 5,000 farm adds +10%; 50,000 of property adds +100%; 100,000 adds +200%. The deed panel and Buy button show your current surcharge.',
    'List prices, property tax and the 70% sell-back are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T16:52:00-06:00', title: 'Farm: ripe crops last much longer before withering', bullets: [
    'Requested by carter2: ripe crops now stay harvestable for at least 36 hours, or 3x their grow time if that is longer (it was 12 hours or 2x grow time). Sunflowers and Cacao now last 36 hours instead of 24.',
    'Crops already in the ground get the longer window too, and the Greenhouse still adds on top. Grow times, yields and the daily farm limit are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T16:22:00-06:00', title: 'Stock Exchange: public trade history', bullets: [
    'Every company page now shows its recent trades: who bought or sold, how many shares, the price, the chips and the time (CST).',
    'Short opens, covers and liquidations and option buys (CALL / PUT with strike and expiry) and expiries are listed too, clearly labelled.',
    'The Stocks tab has a "Recent trades" feed for the whole exchange, and each fund shows recent trades in the companies it holds. Read-only: prices and fees are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T15:55:00-06:00', title: 'Factory: pantry crops feed your machines', bullets: [
    'Crops you harvested to the pantry now go into a factory Input Chest set to that crop, so pantry sunflowers feed the Mill & Press and come out as Sunflower Oil.',
    'Pantry food in factory Storage is now labelled "pantry" instead of "craft". It is never sold to the house; cook it, sell it on the Market, or feed crops to the factory.',
  ] },
  { commit: '', at: '2026-11-02T15:47:00-06:00', title: 'Stock Exchange: dividends are 30x bigger', bullets: [
    'Every dividend-paying company now pays 30x its old daily yield (e.g. 0.15%/day is now 4.5%/day). Funds pass the bigger dividends straight through.',
    'Prices, trading fees and fund expense ratios are unchanged. Dividends still pay once a day at 10 AM CST.',
  ] },
  { commit: '', at: '2026-11-02T15:33:00-06:00', title: 'Mines: more iron, less gold', bullets: [
    'Requested by chessguy2: iron was the hardest ore to come by. The Mine is now about 51% Iron Ore, 26% Stone and 10% Gold Ore (was 34%, 28% and 24%), with a little Copper Ore, Silver Ore and Crystal in the rest.',
    'Iron Ore rocks respawn in 6 minutes (was 12m 30s), faster than Copper Ore, so iron is clearly common. Gold Ore stays at 30 minutes.',
    'Frostbite Caverns (about 9% Iron Ore, was none) and Magma Depths (about 3%, was none) now have some iron among their other rocks. Hired miners bring back the same mix as the rocks. Coral Grotto is unchanged.',
  ] },
  { commit: '', at: '2026-11-02T15:24:00-06:00', title: 'Employment Office: workers now bring something in every 5 minutes', bullets: [
    'Every hired worker now brings in one item every 5 minutes, which is 288 a day on a full day.',
    'Miners were 1 ore every 10 minutes (144 a day), so they now bring in twice as much. Fishers were 1 fish an hour (24 a day), so they now bring in 12 times as much.',
    'Hire fees and daily wages are unchanged, so every worker earns a lot more. Each mine\'s ore mix, auto-deposit, the last-24-hour pickup list, the 8-hour check-in, the 3-worker limit and the daily sell caps are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T15:13:00-06:00', title: 'Stock Exchange: funds show their daily % change', bullets: [
    'The Funds table has a new Day % column: how much each fund\'s NAV moved over the last 24 hours, green when up and red when down — same as the 24h column on stocks.',
    'Opening a fund shows its NAV and today\'s change too. Display only: NAV, fees, dividends and trading are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T14:38:00-06:00', title: 'Factory: machines hold just one finished item', bullets: [
    'Every factory machine now holds at most one finished craft. Once it has one ready, it stops and waits ("backed up") until a belt, inserter or chest takes it, then starts the next one.',
    'The machine panel shows output as e.g. "0/1 ready", and says "backed up — waiting for pickup" while it is full.',
    'Machines already holding more than one keep everything: they just finish draining before they craft again. Nothing was deleted.',
  ] },
  { commit: '', at: '2026-11-02T14:35:00-06:00', title: 'Stock Exchange: lifetime returns on your portfolio', bullets: [
    'Stock Exchange → Portfolio now shows your lifetime stock return as a percentage and in chips, green when you\'re up and red when you\'re down, with realized and unrealized parts split out.',
    'Each stock you hold has a new Lifetime column, and stocks you\'ve fully sold show up under Closed positions with their final return.',
    'Lifetime return = chips you got from selling + what your shares are worth now − chips you spent buying, fees included, divided by chips spent buying.',
    'Display only: prices, fees and trading are unchanged. (Liam\'s request)',
  ] },
  { commit: '', at: '2026-11-02T14:30:00-06:00', title: 'Factory: crafted goods sell for about 15% less', bullets: [
    'House prices for factory-made bars and goods are down about 15%, for example Silver Ring 120 → 100, Cut Crystal 100 → 85, Crystal Ring 340 → 290, Machine Part 360 → 305, Diamond Crown 1,100 → 935, Engine 1,400 → 1,190 and Mining Drill 2,400 → 2,040.',
    'Food products made from farm crops and fish drop a little less (about 5–10%) so cooking still pays a small premium over selling the crop. Raw ore, crop and fish prices, recipes, timers, daily caps and existing market listings are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T14:26:00-06:00', title: 'Mines: rocks take 10× longer to respawn', bullets: [
    'Every ore rock in every cave (Coral Grotto too) now takes 10× as long to come back: Stone 2.5m, Coal ~4m, Copper Ore 7.5m, Iron Ore 12.5m, Silver Ore 20m, Gold Ore 30m, Crystal 50m, Diamond 80m.',
    'Hired miners, key and chest drops and Tool Shop bonuses are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T14:20:00-06:00', title: 'Market: sell several cases or keys at once', bullets: [
    'Market → Skins → Sell now has a tick box on every item, plus "All cases" and "All keys" boxes. Tick as many as you like.',
    'With items ticked, the side panel lets you set how many cases and keys to sell, one price each, and shows what you get if they all sell after the 5% fee. One Confirm lists them all.',
    'Each item still becomes its own listing at that price, so buyers can buy one at a time. It is all or nothing: if any ticked item can\'t be listed (already listed, in a trade, or over the 50-listing limit), nothing is listed.',
    'Fees and how buying works are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T14:02:00-06:00', title: 'Mines: much stronger specialities, clearer labels, slower rare respawns, rarer drops', bullets: [
    'Each cave is now mostly its signature ores, by hand and for hired miners alike: The Mine about 86% Iron Ore, Stone & Gold Ore (Gold Ore the lightest), Magma Depths about 85% Coal & Copper Ore, and Frostbite Caverns about 82% Silver Ore & Crystal (Crystal stays rare: it is worth 5× Silver Ore).',
    'Average value per rock and per hired-miner pick stays within 5% of before. Coral Grotto\'s mix is unchanged.',
    'Rock respawn time now climbs with value: Stone 15s, Coal 25s, Copper Ore 45s, Iron Ore 75s, Silver Ore 2m, Gold Ore 3m, Crystal 5m, Diamond 8m (was 20s, 30s, 45s, 1m, 1.5m, 2m, 3m, 5m).',
    'Key and chest drops from breaking a rock are now 1% per rock (was 5%), in every cave. Still 50/50 key or chest.',
    'The mine picker, city map tiles, cave descriptions and Employment Office list now name each mine\'s main ores by their in-game names (e.g. Crystal, Copper Ore).',
  ] },
  { commit: '', at: '2026-11-02T13:45:00-06:00', title: 'Caves now match their miners', bullets: [
    'The ore you find by hand now follows each mine\'s speciality, the same mix your hired miners bring back: The Mine is mostly iron, rock & gold (gold the rarest of the three), Frostbite Caverns mostly silver with some crystal, and Magma Depths mostly coal & copper.',
    'About 60–65% of rocks in each cave are its signature ores. Average value per rock is about the same as before, and the cave layouts, rock spots, respawn times, key and chest drops and Tool Shop bonuses are unchanged. Coral Grotto is unchanged.',
  ] },
  { commit: '', at: '2026-11-02T13:45:00-06:00', title: 'Poker: high-stakes Hold\'em tables', bullets: [
    'The Hold\'em lobby now lets you pick a table: Classic (blinds 5/10, buy-in 100–1,000) or the new High Stakes 5K (blinds 25/50), High Stakes 10K (50/100), High Roller 25K (125/250) and High Roller 100K (500/1,000).',
    'Each high-stakes table has a fixed buy-in of 5K, 10K, 25K or 100K chips, and you can only sit down if you have the full buy-in. Blinds keep the same ratio as the classic table.',
    'Each tier has its own tables, so you only play against people at the same stakes. Hand rules, dealing and payouts are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T13:40:00-06:00', title: 'Countryside farms look like real farms', bullets: [
    'Requested by Dayne: the buyable crop fields around the city (snowy map too) now look like the Farm district: dark soil, furrow rows, a fence, and your crops growing on them instead of flat green and dark stripes.',
  ] },
  { commit: '', at: '2026-11-02T13:40:00-06:00', title: 'Magma Depths: a bit brighter', bullets: [
    'Magma Depths is moderately brighter: more ambient light, a warm glow from above, lighter rock walls and fog that starts further away.',
    'Lava pools glow warmer and stronger and throw more light onto the tunnel around them. Rock stays dark and the lava is still the star.',
  ] },
  { commit: '', at: '2026-11-02T13:35:00-06:00', title: 'Chip icon shows everywhere', bullets: [
    'The chip coin now shows as a proper icon across the whole site (wallet, Market, games, Mines, Farm, Stocks, toasts and chat) instead of an empty box on devices whose fonts lack the coin emoji.',
    'Amounts and prices are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T13:20:00-06:00', title: 'Market: sell section on top + chip icon fix', bullets: [
    'On Market → Resources, Your storage, the sell card and My listings now sit at the top, above the item list.',
    'Chip amounts in the sell card and storage tiles show a proper chip icon instead of an empty box on devices missing the coin emoji.',
  ] },
  { commit: '', at: '2026-11-02T13:15:00-06:00', title: 'Mines: no more head bob', bullets: [
    'Walking and running in the mines no longer bobs or sways your view and held tool: the camera stays at a steady height.',
    'The tool swing animation and the Arena camera are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T13:12:00-06:00', title: 'Market: sell section on top + chip icon fix', bullets: [
    'On Market → Resources, Your storage, the sell card and My listings now sit at the top, above the item list.',
    'Chip amounts in the sell card and storage tiles show a proper chip icon instead of an empty box on devices missing the coin emoji.',
  ] },
  { commit: '', at: '2026-11-02T13:10:00-06:00', title: 'Mines: Tool Shop ore bonus rebalanced', bullets: [
    'Tool Shop extra ore is toned down: Steel Pickaxe +25%, Hand Drill +50%, Power Drill +100%, Jackhammer +150%, Plasma Cutter +200%.',
    'Total extra ore from tool plus Mining skill is now capped at +250%.',
    'Swing speeds (1.2× to 2×), prices, key and chest drops and ownership are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T12:48:00-06:00', title: 'Market: easier resource selling + Resource Inventory', bullets: [
    'Market → Resources now shows "Your storage" as a grid of icon tiles with how many you have, the current lowest listing and the last sale. Tap one to open a sell card.',
    'The sell card has a quantity slider with 25%, 50% and Max, a unit price prefilled to undercut the lowest listing by 1 (with Match lowest, Undercut and Last sale buttons), a clear "You receive X after the 5% fee" line and how your price compares to the house. A new My listings section lets you cancel your listings.',
    'The top bar\'s Inventory is now two buttons: 🎒 Skin Inventory (your skins, as before) and 📦 Resource Inventory (ores, bars, goods, fish, crops and dishes with quantities and a Sell on Market button that opens the sell card).',
    'The Market has a clear ← Back button: it takes you back to the Skin or Resource Inventory you came from, or to the city if you opened the Market directly.',
    'Fees, prices and how listings work are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T12:35:00-06:00', title: 'Hired miners specialise by mine', bullets: [
    'Employment Office miners now bring back mostly their mine\'s signature ores: Magma Depths is mostly coal & copper, Frostbite mostly silver & crystal, and the main Mine mostly iron, rock & gold (gold the rarest of the three).',
    'About 60–65% of picks are those ores; the rest still come from the mine\'s normal mix. Items per hour, value per hour, wages and hire fees stay the same. The hire list shows each mine\'s bias.',
    'Mining by hand is unchanged.',
  ] },
  { commit: '', at: '2026-11-02T12:35:00-06:00', title: 'Mines: Tool Shop tools wear your pickaxe skin', bullets: [
    'Your equipped pickaxe skin now shows on whichever Tool Shop tool you hold: the Steel Pickaxe head, the drill housings, the Jackhammer body and the Plasma Cutter barrel get the skin\'s pattern, colours and finish, in first person and on other miners.',
    'Drill bits, the chisel, the plasma jet and the grips keep their normal look so each tool still reads as itself. With no skin equipped, tools look the same as before.',
    'Tool stats, prices and ownership are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T12:30:00-06:00', title: 'Owning property raises your worker cap', bullets: [
    'Every building or landmark you own adds Employment Office hire slots on top of the base 3: +1 for a detached home (under 25K), +2 for row houses, apartments, gas stations and beach houses (25K–75K), +3 for towers, depots, condos and villas (75K–250K), and +4 for the beach hotel and landmarks (250K+).',
    'Bonuses from all your properties add up, to a max of +7 (10 workers). Empty lots, parks, plazas and farm plots add no slots.',
    'The office shows "Worker cap: X (base 3 + Z from property)", and each property deed shows its bonus.',
    'Sell or lose a property and anyone above your new cap keeps working, you just can\'t hire again until you\'re under it. Nobody gets fired. Wages, rates and prices are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T12:10:00-06:00', title: 'Factory: search recipes by ingredient', bullets: [
    'Requested by Liam: the Factory\'s 📜 Recipes tab has a search box. Type any item or ingredient (partial or loose spelling works, like "cop" or "cpr wire") to see every recipe it\'s used in and the recipe that makes it, with icons and which machine does each one.',
    'Click a recipe to open its full production chain. Recipes, speeds and prices are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T12:06:00-06:00', title: 'Factory gets a makeover', bullets: [
    'The factory floor is now concrete tiles with a painted walkway, steel walls with copper pipes, vents, steam and hazard stripes, and warm work lights.',
    'Belts are rubber with moving cleats and steel rollers; machines have painted housings, bolts, vents, shadows, a glowing status lamp, and their own touches (smelter glow and smoke, sparks on the press). Items cast soft shadows.',
    'The Factory panels are cleaner, with icon tiles on the build palette and a striped inspect panel. The Factory building in the city is rebuilt with a steel shed, sawtooth roof, loading bay, brick chimney and pipes.',
    'Layout, recipes, rates and how everything works are unchanged. Phones and slower devices get a lighter version without the blur shadows, sparks and light pools.',
  ] },
  { commit: '', at: '2026-11-02T02:30:00-06:00', title: 'Nicer skins, characters and fishing anglers', bullets: [
    'Every weapon and pickaxe skin renders smoother: sharper, filtered patterns, softer shading and a subtle rim light in the skin\'s own accent colour. Names, colours, patterns, rarity, prices and ownership are unchanged.',
    'Arena soldiers get bevelled armour, a plate carrier, shoulder and knee pads, boots, a glowing visor and a soft rim light, in your same team colour. Mine workers get rounded gear, a face and a brass belt buckle.',
    'The fishing anglers on the lake dock and the Reef Pier are now proper fishermen: bucket hat, khaki vest with pockets, beard, waders and boots. They breathe, look around and move their arms when casting, reeling and showing off a catch.',
    'Hitboxes, animations, aim and gameplay are unchanged. Phones and low-end devices get a lighter version.',
  ] },
  { commit: '', at: '2026-11-02T02:15:00-06:00', title: 'Chat shows what everyone is doing', bullets: [
    'The Online list in chat now shows each player\'s live activity next to their name, like "⛏️ Mining · Magma Depths", "🌾 Farming · North Field", "🍳 Cooking", "📈 Stock market" or "🎰 Casino · Blackjack". Their chat messages get the same little tag.',
    'Covers mining (which mine), the factory, cooking and the grocery, farming (which farm), fishing (lake or resort reef), the stock market and skin market, every casino game, the arena (which mode), chess and checkers tables, Conquest, solitaire, real estate, City Hall, the job board, the dealership, the mechanic, driving, the airport and racetrack, the resort, skills, inventory and the city. After 5 minutes with no input you show as 💤 Idle.',
    'Status only: nothing gets posted into the chat feed, and nothing about chips changes.',
  ] },
  { commit: '', at: '2026-11-02T02:15:00-06:00', title: 'Employment Office: workers deposit automatically', bullets: [
    'Hired miners now drop their ore straight into your factory storage and fishers put their catch in your cooler. There is no Collect button any more.',
    'The office lists what each crew picked up in the last 24 hours (amount and last pick-up time) with a total. If your storage or cooler is full, workers hold the overflow and deposit it once there is room, so nothing is lost.',
    'Anything workers were already holding gets deposited automatically. Opening the office still counts as your check-in, so the 8-hour away limit still applies. Pay, gather rates and prices are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T02:00:00-06:00', title: 'Farm: ripe crops last 12 hours before withering', bullets: [
    'Requested by carter2: ripe crops now wait at least 12 hours before they wither, instead of twice their grow time (which was only 4 minutes for strawberries and 1 hour for corn). Crops that take longer, like sunflowers, keep their longer window, and the Greenhouse still extends those.',
    'Crops already in the ground get the new window too. Ripe tiles now show a small "withers in" countdown (e.g. 11h). Grow times, yields and the daily farm limit are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T01:50:00-06:00', title: 'Chudhub goes Christmas (through Jan 5)', bullets: [
    'Requested by Liam: snow falls over the city and the resort, rooftops are capped with snow and the streets have a frosty coat.',
    'Twinkling Christmas lights line the buildings, a big decorated tree with presents stands in the central plaza, and smaller trees dress up the casino, the arena, City Hall, every mine entrance and the resort casino. The top bar gets a candy-cane trim and a string of lights.',
    'Phones and low-end devices get lighter snow and fewer lights so the city stays smooth.',
    'Purely cosmetic: no changes to chips, prices, odds or payouts. The theme switches off by itself after January 5, 2027 (Alberta time).',
  ] },
  { commit: '', at: '2026-11-02T01:50:00-06:00', title: 'Request board: Scheduled status', bullets: [
    'Requests can now be marked Scheduled with a planned date, shown as a purple badge like "Scheduled · Nov 7". Scheduled requests sort right after In progress.',
  ] },
  { commit: '', at: '2026-11-02T01:45:00-06:00', title: 'Mines: Tool Shop tools buffed', bullets: [
    'Every Tool Shop upgrade got a big buff, same prices: Steel Pickaxe 1.2× swing speed and +50% ore, Hand Drill 1.4× and +100%, Power Drill 1.6× and +200%, Jackhammer 1.8× and +350%, Plasma Cutter 2× and +500%.',
    'Ore bonus is extra ore per rock on average: +350% means 3 guaranteed extras plus a 50% shot at a 4th (backpack space permitting). Stacks with your Mining level; swings can now reach 4× base speed. Key and chest drops and daily sell caps are unchanged.',
  ] },
  { commit: '', at: '2026-11-02T01:35:00-06:00', title: 'Frostbite Caverns: ice pillar no longer pinches a tunnel', bullets: [
    'An ice pillar in Frostbite Caverns sat in a narrow gap and forced a detour. It has moved into the open hall, so the gap is walkable again.',
  ] },
  { commit: '', at: '2026-11-02T01:25:00-06:00', title: 'Mines: buy faster mining tools in the new Tool Shop', bullets: [
    'Requested by Liam: a 🛠️ Tool Shop in the Mines sidebar sells five upgrades over the starter pickaxe, bought in order and kept forever. At base prices: Steel Pickaxe 2,500 (10% faster), Hand Drill 10,000 (20% faster), Power Drill 30,000 (28% faster, +2% extra ore), Jackhammer 75,000 (36% faster, +3% extra ore), Plasma Cutter 200,000 (44% faster, +5% extra ore).',
    'Tools stack with your Mining level, but a swing is never faster than 40% of the base time, and the extra-ore chance tops out at 20% total. Key and chest drops are unchanged.',
    'Each tool has its own 3D model in your hands and on other miners: drill bits spin and buzz, the jackhammer hammers and the plasma cutter fires a jet while you hold to mine. Switch between owned tools any time with Equip.',
  ] },
  { commit: '', at: '2026-11-02T01:15:00-06:00', title: 'Farm district: solid fields again', bullets: [
    'Fixed: farm plots east of the city showed as thin outlines that flickered. The grass was drawing over the soil; now every plot shows solid soil with its furrow rows and crops on top.',
  ] },
  { commit: '', at: '2026-11-02T01:15:00-06:00', title: 'City Hall: weekly mayor elections', bullets: [
    'Requested by Liam: a new City Hall stands in the middle of town. Every week Chudhub elects a mayor (Alberta time): file Monday to Thursday, vote Friday and Saturday, results Sunday, and the winner serves Monday to Sunday.',
    'Running costs 2,500 chips (burned, not refunded) plus a short slogan. One vote per account; your account must be a day old and have played a few games. Ties go to whoever filed first.',
    'The mayor can move property tax (0.375%–0.625% a day, normally 0.5%) and market and stock trading fees (3.75%–6.25% and 0.75%–1.25%, normally 5% and 1%) by up to 25% either way, once a day. Changes start at the next midnight and every change is logged publicly at City Hall.',
    'The mayor has no salary and cannot touch casino odds, balances, sell limits or anything else.',
  ] },
  { commit: '', at: '2026-11-02T01:00:00-06:00', title: 'Sell picker fits on screen', bullets: [
    "Fixed: tapping Sell… in Factory storage opened the quantity picker squeezed beside the item, so the slider, Half/All and Sell buttons were cut off. It now opens as a full-width row under the item and wraps on narrow screens and phones. The fishing cooler and kitchen fridge pickers fit the same way.",
  ] },
  { commit: '', at: '2026-11-02T01:00:00-06:00', title: 'Magma Depths: lava no longer blocks tunnels', bullets: [
    'Three lava pools in Magma Depths sat across tunnels and forced long detours or dead ends. They now sit in side pockets, so every tunnel can be walked straight through.',
  ] },
  { commit: '', at: '2026-11-02T00:45:00-06:00', title: 'Arena: kills pay a little more than a death costs', bullets: [
    'Requested by Dayne: a kill now pays the victim\'s spawn stake plus a house kill bonus of +20% of it (at least 1 chip). At base prices: pistol +10 +2, SMG +15 +3, shotgun +20 +4, sniper and AR-15 +25 +5, rocket +35 +7.',
    'The kill feed and the chip pop-up show it like "+25 +5 bonus", and the end-of-match earned total includes it.',
    'No bonus for killing bots, free knife-only lives, yourself or your own account, or accounts under 24 hours old, and only the first 3 kills of the same player every 10 minutes earn it (the stake always pays).',
  ] },
  { commit: '', at: '2026-11-02T00:40:00-06:00', title: 'Sell how many you want + request board sorting', bullets: [
    "Requested by carter2: choose how many to sell to the house. Factory storage (tap Sell… on any item, including factory goods and ore), the fishing cooler and the kitchen fridge now have a quantity picker with a number box, a slider and 1 / 10 / Half / All buttons, plus a live payout preview that respects the 100,000-a-day cap. Sell all still works.",
    'The server checks the amount is a whole number you actually own and sells exactly that many through the normal wallet ledger. Double clicks can never sell the same items twice. Fish and dishes sell the most valuable ones first.',
    'Requested by carter2: the change request board sorts by Newest (default), Oldest or Most votes (ties go to the newer one), and every request shows when it was posted in Alberta time.',
  ] },
  { commit: '', at: '2026-11-02T00:30:00-06:00', title: 'Car steering fixed', bullets: [
    'Left (A or ←) now turns the car left and right (D or →) turns it right, in the city and on the Speedway, with every car and Mechanic Shop upgrade. Steering was mirrored.',
  ] },
  { commit: '', at: '2026-11-02T00:30:00-06:00', title: 'Fishing panel can be moved', bullets: [
    'The Fishing Dock and Reef Pier panel can now be dragged by its top bar too.',
  ] },
  { commit: '', at: '2026-11-02T00:20:00-06:00', title: 'Arena: Final Killcam and Nut Shots', bullets: [
    'Request board #10 (Liam): when an Arena match ends (Deathmatch, Search & Destroy or CTF), everyone watches the last kill from the killer\'s view, old-school CoD style. It shows a FINAL KILLCAM banner with killer ➜ victim and the weapon, and slows down on the killing shot. Press Space, K or Skip to go straight to the results. Payouts are not delayed.',
    'Nut shots, inspired by Combat Arms: hitting someone just below the belt does 1.5× damage, pops up NUT SHOT! with a sound, and slows the victim for a moment. The kill feed shows a 🥜 icon.',
    'Headshots and nut shots now each give a little Combat XP (up to 100 per match). The match results show HS and NS columns.',
  ] },
  { commit: '', at: '2026-11-02T00:20:00-06:00', title: 'Arena: hit markers only on real damage', bullets: [
    'Fixed: the hit marker, hit sound and damage number no longer show on a guess. They appear only when the server confirms your shot actually took health off an enemy.',
    'No marker on teammates in Search & Destroy and Capture the Flag, on dead or respawning players, or on hits that did no damage.',
  ] },
  { commit: '', at: '2026-11-02T00:16:00-06:00', title: 'Every panel can be moved', bullets: [
    'Grocery Store, Recipe Kitchen, Chud Customs, Employment Office, Daily Report and every other panel can now be dragged by its top bar (mouse or touch), stays on screen and remembers where you left it.',
  ] },
  { commit: '', at: '2026-11-02T00:15:00-06:00', title: 'Chud Resort: the Reef Pier (tropical fishing)', bullets: [
    'Requested by Dayne: a new Reef Pier sticks out into the ocean at Chud Resort. Fly to the resort, tap the pier, and fish the reef at golden-hour sunset with turquoise water and palms.',
    '15 new tropical species with their own 3D models and icons: Lost Flip-Flop and Drift Coconut (junk); Clownfish, Blue Tang, Sergeant Major (common); Rainbow Parrotfish, Red Snapper, Picasso Triggerfish (uncommon); Mahi-Mahi, Great Barracuda, Coral Grouper (rare); Yellowfin Tuna and Sailfish (epic); Blue Marlin and the Sunset Manta (legendary).',
    'Same casting, bites, reeling, Fishing skill perks, cooler, Top catches board and kitchen fillets as the lake. Rarity odds are unchanged, prices sit in the same ranges as lake fish, and sales share the same 100,000-a-day fishing limit.',
  ] },
  { commit: '', at: '2026-11-02T00:05:00-06:00', title: 'Request board: 20 requests a day', bullets: [
    'Requested by Dayne: you can now post up to 20 requests a day on the request board, up from 3.',
  ] },
  { commit: '', at: '2026-11-01T23:59:00-06:00', title: 'Chat: timestamps in Alberta time', bullets: [
    'Request board (carter2): every chat message now shows a small time in Alberta time (AB), like 11:52 PM AB. Older messages say Yesterday or the date, and hovering shows the full date.',
  ] },
  { commit: '', at: '2026-11-01T23:55:00-06:00', title: 'Factory: splitter ratios', bullets: [
    'Requested by Dayne: click a splitter to set how it divides items between its left, ahead and right outputs — presets like 1:1, 2:1 and 3:1, or any whole-number weights from 0 to 9 (0 shuts that output).',
    'Items go out in a fixed, evenly spread order (2:1 sends left, right, left, …). If the next output is backed up, the item takes the next free one so the line never jams.',
    'Splitters with a custom ratio show it on the tile. Existing splitters stay at an even 1:1:1 split.',
  ] },
  { commit: '', at: '2026-11-01T23:50:00-06:00', title: 'Kitchen: big fish give more fillets', bullets: [
    'Requested by Dayne: the kitchen now cuts each fish into fillets based on its value: 1 fillet per 8 chips (fine fish: 1 per 50), up to 12 per fish. A 99-chip fish gives 12 fillets instead of 1, and each fish recipe uses one fillet.',
    'Leftover fillets stay on your cutting board for the next dish. The recipe book shows how many fillets you have. Dish sales still count toward the 100,000-a-day cooking limit.',
  ] },
  { commit: '', at: '2026-11-01T23:45:00-06:00', title: 'Farm upgrades and a casino turn-timer bar', bullets: [
    'Request board #6 (Farm Upgrades): owned farm plots now have three upgrades, each with 3 levels. Sprinklers make crops grow 10/20/30% faster (stacks with the Farming skill, never below half the grow time). Fertilizer adds +10/20/30% crop profit (still inside the 100,000/day farm limit). Greenhouse keeps ripe crops from withering for longer.',
    'Upgrade prices scale with the plot size and the price index. They belong to whoever bought them; a new owner of the plot starts fresh.',
    'Request board #7: blackjack, roulette and Hold\'em now show a draining progress bar for every betting and turn timer, synced to the server clock. It turns amber, then red and pulses in the last quarter.',
  ] },
  { commit: '', at: '2026-11-01T23:40:00-06:00', title: 'Sharper, calmer building labels', bullets: [
    'City and resort building labels are now crisp on every screen, with softer colours, a thinner border and no glow bleeding from them.',
  ] },
  { commit: '', at: '2026-11-01T23:30:00-06:00', title: 'Arena: crouch is C (on-screen hint)', bullets: [
    'Crouch is now C (Ctrl closed tabs). C works with Shift held, Caps Lock and any keyboard layout, and a corner hint shows C crouch · Shift sprint.',
  ] },
  { commit: '', at: '2026-11-01T23:30:00-06:00', title: 'Much higher daily selling limits', bullets: [
    'Requested by Dayne: selling ore, factory goods, fish, farm crops and cooked dishes to the house now pays full price up to 100,000 a day for each, instead of dropping to half and less after the first few hundred.',
    'Past 100,000 in a day the house stops buying that kind of item until the reset. Limits still scale with the price index and reset at 00:00 UTC (6 PM Alberta time).',
    'Employment Office worker prices are unchanged and still cost about half of what the worker brings in.',
  ] },
  { commit: '', at: '2026-11-01T23:30:00-06:00', title: 'Arena: cleaner clock and a better AR-15 red dot', bullets: [
    'Requested by Dayne: in Search & Destroy and Capture the Flag, the mode label under the round clock no longer overlaps the clock digits. The clock box is a little taller and the label sits cleanly below the time.',
    'Requested by Dayne: the AR-15 red dot is now a small, sharp dot sitting exactly where your shots go when you aim down sights. The sight housing is a thin open frame with a clear window, so it no longer blocks your view.',
  ] },
  { commit: '', at: '2026-11-01T23:25:00-06:00', title: 'Arena: headshots on moving players, no more Ctrl keys', bullets: [
    'Arena headshots now register on strafing players and when you are moving or on a higher ping, for every gun.',
    'Ctrl is no longer an Arena key: crouch is C, sprint is Shift, so Ctrl+W cannot close the tab mid-fight. Letting go of Ctrl/Cmd or switching tabs stops all movement, and closing the tab mid-match asks "Leave the match?" first.',
  ] },
  { commit: '', at: '2026-11-01T23:25:00-06:00', title: 'Arena: Search & Destroy and Capture the Flag', bullets: [
    'Requested by Dayne: the Arena has two new team modes next to the usual Deathmatch. Pick one with the new DM / S&D / CTF buttons beside the map picker. It starts right away if you are alone, otherwise it is queued for the next match, just like maps.',
    'Search & Destroy: Blue and Red take turns attacking and defending bomb sites A and B. Attackers stand still on a site to plant (3 s); defenders stand still on the bomb to defuse (5 s). One life per round, sides swap at halftime, first to 4 rounds wins.',
    'Capture the Flag: grab the enemy flag and bring it to your base while your own flag is home. Dropped flags return on their own after 20 s, or straight away if a teammate touches them. First to 3 captures or the most after 8 minutes wins.',
    'Teams are balanced automatically and bots fill empty spots and play the objective. No friendly fire, and you can always see your teammates. The HUD shows team scores, the round clock, bomb and flag status, and markers for sites, bombs, flags and bases.',
    'Plants, defuses, captures and flag returns give extra Combat XP. Spawn costs and the match prize are unchanged: the prize goes to the top player on the winning team.',
  ] },
  { commit: '', at: '2026-11-01T23:20:00-06:00', title: 'No trading for the first 24 hours', bullets: [
    'Requested by Dayne: new accounts cannot trade with other players for their first 24 hours. That covers trade offers, counters and accepts, and listing or buying on the Market.',
    'It works both ways: nobody can trade with, or buy from, an account that is less than a day old.',
    'The Market and Trades screens show how long is left. Cancelling or declining an offer still works, and the daily bonus is unchanged.',
  ] },
  { commit: '', at: '2026-11-01T23:15:00-06:00', title: 'Employment Office: hire AI miners and fishers', bullets: [
    'Requested by Dayne: a new Employment Office in the city (north of the plaza) lets you hire up to 3 AI workers.',
    'Miners bring in 1 ore every 10 minutes from the mine you pick (The Mine, Frostbite Caverns or Magma Depths), using that mine\'s normal ore mix. Fishers bring in 1 fish every hour from the normal catch table, with no junk.',
    'Each worker has a hire fee plus a daily wage. Together they come to about half of what the worker brings in over their first week, at today\'s prices.',
    'Their haul goes to your mine storage or your cooler and sells under the usual daily limits. You get no skill XP from workers.',
    'Workers stop 8 hours after your last visit, so check in to keep them busy. If you can\'t pay the next day\'s wage they stop working, with no debt. You can fire a worker any time, but nothing is refunded. Accounts must be at least 24 hours old to hire.',
  ] },
  { commit: '', at: '2026-11-01T23:05:00-06:00', title: 'The sky runs on Alberta time', bullets: [
    'Requested by Dayne: the day and night cycle in the city, outskirts and at the lake now follows Alberta time and the real sun over Edmonton instead of Denver.',
    'The game clock is Alberta time, UTC−6 all year with no daylight saving changes.',
    'Expect long summer evenings (sunset after 10 PM in June, with only a short dim night) and short winter days (the sun is up from about 9:50 AM to 5:15 PM in late December).',
    'The clock in the top left now says AB and its tooltip says Alberta time.',
  ] },
  { commit: '', at: '2026-11-01T23:00:00-06:00', title: 'Ore icons show up again', bullets: [
    'Copper, iron, silver and gold ore icons no longer show as broken images in Factory storage, the mine pack and the Market.',
  ] },
  { commit: '', at: '2026-11-01T23:00:00-06:00', title: 'Chud Customs: the Mechanic Shop', bullets: [
    'Requested by Dayne: a new 🔧 Mechanic Shop next to the Car Dealership where you can upgrade and customise the cars you own.',
    'Performance: Engine, Turbo, Tires, Handling and Nitro, each with 3 tiers. They really change how your car drives in the city and at the Speedway. Hold Shift or N (or the 🔥 button on mobile) to fire nitro. Upgrades help, but a maxed cheap car still can\'t catch a top supercar.',
    'Looks: 17 paints (7 metallic), 6 rim styles, 4 body kits and spoilers, and 6 underglow colours. Preview them on the lift before you buy, and everyone sees them when you drive.',
    'Prices scale with the car\'s value. Upgrades are permanent, can\'t be refunded and don\'t raise the sell-back price. Going back to stock looks is free.',
  ] },
  { commit: '', at: '2026-11-01T22:20:00-06:00', title: 'Hold to keep swinging in the mines', bullets: [
    'Requested by Dayne: hold left click (or press and hold on a touch screen) to keep swinging your pickaxe in every mine, including the Coral Grotto.',
    'It swings at your normal speed (faster with a higher Mining level) and hits whatever ore is under your crosshair. Let go, click away or open another window to stop.',
    'Ore, drop chances and XP are unchanged.',
  ] },
  { commit: '', at: '2026-11-01T22:15:00-06:00', title: 'Biggest catches sorted by weight', bullets: [
    'Reported by Dayne: the 🏆 Biggest catches board at the dock was ordered by how much each fish was worth, not how heavy it was. It now lists the heaviest catch first, with ties going to whoever caught it first.',
    'Your own best catch and the 🎣 Biggest fish on player profiles use the same rule.',
  ] },
  { commit: '', at: '2026-11-01T22:10:00-06:00', title: 'See other players fishing, cleaner fishing sounds', bullets: [
    'Requested by Dayne: at the Fishing Dock you now see other anglers cast, their line and bobber in the water, their rod bending while they reel, and the fish they land, live.',
    'Fishing sounds were cleaned up: reel clicks are a soft tick instead of a buzz, sounds no longer stack on top of each other, everything stops when you cancel or leave the dock, and other players\' splashes play quietly.',
  ] },
  { commit: '', at: '2026-11-01T22:00:00-06:00', title: 'Reopen your Daily Report any time', bullets: [
    'Requested by Dayne: a new 📰 button next to your wallet in the top bar opens your Daily Report whenever you want (it is also still in the Wallet).',
    'The report now has a "Past 7 days" list with your cash, net worth and daily change.',
    'Guests get a reminder to sign in. Nothing about chips or the daily bonus changed.',
  ] },
  { commit: '', at: '2026-11-01T21:45:00-06:00', title: 'Cooking and the Grocery Store', bullets: [
    'Requested by Dayne: a new Cooking skill. Open the 🍳 Kitchen from any home you own (city or resort property, farm plot, or tap your own Trailer Park trailer).',
    '21 recipes in a recipe book that unlock as you level, from Pan-Fried Fish at level 1 to a Chocolate Soufflé at 92. They use fish from your cooler, crops from your farm or plantation, and groceries.',
    'Cooking is a timing game: heat, flip, stir and plate. Press when the needle is in the green. Low level or sloppy timing can burn the dish.',
    'Sell dishes from your fridge for a bit more than the ingredients are worth. Earnings are capped each day (full price for the first 500 chips of dishes, then less).',
    'The fish pan from earlier tonight is now the 🐟 Pan-fry a fish tab in the same Kitchen, still opened from 🏠 My home. Your Cooking level, XP and any pan-fried dishes you already have are kept.',
    'All cooking sales now share one daily cap: pan-fried fish dishes (still sold at the Fishing Dock) and recipe dishes count toward the same limit. Raw fish keep their own fish-market limit.',
    'New 🛒 Grocery Store in the city (west midtown) with 30 ingredients on six shelves. Groceries and crops can also be bought and sold on the Market.',
    'Walked away from the stove? Nothing burns: after 2 minutes the ingredients and fish go back to your pantry and cooler. Groceries and dishes have their own drawn icons.',
    'Farms have a new “🧺 To pantry” harvest button that keeps crops for cooking instead of selling them.',
  ] },
  { commit: '923e79b', at: '2026-11-01T21:30:00-06:00', title: 'Your mining backpack is never lost', bullets: [
    'What you carry in the mines (every cave, including the Coral Grotto) is saved as you mine and comes back when you rejoin, even after a server restart or update.',
    'Leaving the mine without the lift no longer throws your haul away. It waits in your backpack until you come back and bank it.',
    'When the server restarts, it now saves every backpack before it shuts down.',
    'Stock Exchange: order buttons stay locked until the trade is done, and "You own" updates straight away instead of briefly showing the old count.',
  ] },
  { commit: 'a05b626', at: '2026-11-01T21:20:00-06:00', title: 'New item icons', bullets: [
    'Requested by Dayne: the plain coloured dots are gone. Every ore, gem, bar, factory part, crop, fish and food product now has its own drawn icon.',
    'You will see them in your mine backpack, factory storage, recipes and machines, on factory belts, and in the Market resources list. Prices and drops are unchanged.',
  ] },
  { commit: '1692572', at: '2026-11-01T21:15:00-06:00', title: 'Fishing: brand-new fish models', bullets: [
    'Requested by Dayne: every fish you catch now has its own proper 3D model: real body shape, fins, tail, eyes, mouth and markings for each species.',
    'Bluegill and Pumpkinseed are round with their dark ear flaps, Yellow Perch has its tiger bars and orange fins, Largemouth Bass gets its big jaw and dark side stripe, Rainbow Trout its pink band and spots.',
    'Catfish have whiskers, Walleye glassy eyes and dark saddles, Northern Pike a long duck-bill snout with pale bean spots, Sturgeon bony plates, barbels and a shark tail, Golden Carp big shiny scales.',
    'Crystal Koi is now a white koi with red patches and long flowing fins (still with its blue glow). Fish swim in your hands: the body waves and the tail and fins move.',
    'Looks only: catch odds, weights, prices and XP are unchanged.',
  ] },
  { commit: 'ce24ecc', at: '2026-11-01T21:10:00-06:00', title: 'Skills now give real perks', bullets: [
    'Requested by Dayne: every skill except Gambling now helps you, a little more each level from 1 to 99. Your current perk shows under each skill in the Skills panel.',
    '⛏️ Mining: up to 35% faster swings and up to a 15% chance of double ore in every mine (Mine, Frostbite, Magma, Coral Grotto, resort). Key and chest drop odds are unchanged.',
    '⚙️ Engineering: factory machines craft up to 25% faster. 🌾 Farming: crops grow up to 25% faster.',
    '🏁 Racing: up to 20% off the Daily Cup entry. ⚔️ Combat: take up to 5% less damage in the Arena.',
    '📈 Trading: up to 30% off stock and Market fees (never below 1 chip). 🏠 Property: up to 20% off daily property tax.',
    '🎣 Fishing: bites come up to 25% sooner and rarer fish are a bit more likely. ♟️ Chess: up to +50 chips on your daily bonus.',
    '🍳 Cooking keeps its perks. 🎰 Gambling is bragging rights only: casino odds and payouts never change. Daily limits are unchanged.',
  ] },
  { commit: '6742cf6', at: '2026-11-01T21:00:00-06:00', title: 'Factory: 23 new recipes and crops & fish as inputs', bullets: [
    'New 🚚 Bring in tab in the Factory: harvest every ready crop on your farm plots straight into factory storage (instead of selling them), and send your fish cooler in: raw fish become Fish Fillets, cooked dishes become Cooked Fish Portions. Plantation crops go while you are at Chud Resort.',
    'Two new machines: 🌾 Mill & Press (flour, cornmeal, sugar, berry and tropical juice, sunflower oil, cocoa, coconut milk) and 🥫 Food Line from building level 2 (wine, bread, chocolate, canned fish, fish oil, pumpkin pie, salsa, veggie soup and the Banquet Platter).',
    'New metal and jewelry chains: Steel Ingot → Ball Bearing → Electric Motor → Generator and Robot, plus the Grotto Bracelet. Ore from every cave (Mine, Frostbite, Magma, Coral Grotto) already feeds the factory.',
    'Each product sells for a bit more than its inputs. Imported crops and fish can not be sold raw to the house, so craft them first. Sales use the usual daily limits and price index.',
    'The 📜 Recipes tab now shows full chains: pick a product (or click a recipe) to see what makes it, down to raw inputs, and what it feeds. Output Chests get an "Only accept" filter.',
    'Food products give Cooking XP and everything else gives Engineering XP.',
  ] },
  { commit: '48d1e91', at: '2026-11-01T20:52:00-06:00', title: 'Countryside crop fields are farms you can buy', bullets: [
    'Requested by Dayne: every striped crop field in the countryside is now a farm you can buy. Click one to open its deed.',
    'They work like the Farm district: plant, grow and harvest crops, pay daily tax, and sell back to the city for 70% of what you paid.',
    'Bigger fields cost more, priced the same way as farmland. They count toward the new price for owning more land.',
  ] },
  { commit: '22ff26c', at: '2026-11-01T20:50:00-06:00', title: 'Cook your catch in your own kitchen', bullets: [
    'Every home now has a 🍳 Kitchen: open it from 🏠 My home on the city map, by clicking your trailer in the Trailer Park, or from the deed of any property you own (city or resort).',
    'Pick a raw fish from your cooler and cook it on the stove: set the heat, flip it at the right moment and plate it when both sides are golden. Too early and it is undercooked, too long and it burns.',
    'Cooking is a new skill (1–99) in the Skills panel and hiscores. Higher levels widen the "done" window so you burn less, and unlock rarer fish: uncommon at 10, rare at 25, epic at 45, legendary at 65.',
    'A nicely cooked dish is worth 30% more than the raw fish (a perfect one 50%); a burnt one is worth a fifth. Sell dishes at the Fishing Dock as usual, and the fish market daily limits still apply.',
  ] },
  { commit: 'aa15f8d', at: '2026-11-01T20:47:00-06:00', title: 'The 3D fishing game looks much better', bullets: [
    'Requested by Dayne: the lake follows the real Mountain Time day and night cycle, with a blue sky by day, golden dusk and a starry night with the moon low over the far shore.',
    'The water has sky reflections, sun or moon glitter, deeper colour in the middle, caustics and foam near the shore, and ripples where the bobber lands.',
    'Mist rolls over the lake, fireflies come out at night, and the reeds and trees sway. The pier has real wood planks, the rod tapers and has a reel, and fish are shaded with fins and eyes.',
    'Splashes are bigger, and a catch rises out of the water with a coloured glow, sparkles and a camera sweep. The meters and catch card got a glassy look. Catches, prices and XP are unchanged, and slower devices get lighter effects.',
  ] },
  { commit: '823ee78', at: '2026-11-01T20:21:00-06:00', title: "Click a player to see what they own", bullets: [
    "Requested by Dayne: click a player's name to open their profile. This works in the online list, chat, trailers on the map, the leaderboards, the mines board, the dock's biggest catches, the race boards and the Arena results.",
    'The profile shows their chips and net worth (the same numbers as the Daily Report), their property and land with a 📍 button that flies the map to each one, their farms and what is growing, their cars and trailer, stocks, funds and options, their best skins, skill levels, biggest fish, and when they joined. It also shows whether they are online right now.',
    'Only public info is shown. Close it with Esc or by clicking outside.',
  ] },
  { commit: '5205c1a', at: '2026-11-01T20:18:44-06:00', title: 'Land gets pricier the more you own', bullets: [
    'Requested by Dayne: every parcel you already own makes your next one 1.5× more expensive. Your 1st costs the list price, the 2nd ×1.5, the 3rd ×2.25, the 4th ×3.38, and so on.',
    'This covers city, outskirts, countryside, farmland, resort properties and plantation plots. Free Trailer Park lots do not count.',
    'The deed shows your price and why, for example "×2.25 because you own 2". Selling back to the city pays 70% of what you actually paid.',
    'Daily tax stays on the list price, and everything you already own keeps the price you paid for it.',
  ] },
  { commit: '1857275', at: '2026-11-01T19:14:03-06:00', title: 'Real day and night in the city', bullets: [
    'Requested by Dayne: the city and outskirts now follow the real time of day on Mountain Time, so everyone sees the same sky.',
    'The sun rises and sets at the real Denver times, with dawn, golden hour and dusk in between. The light, shadows, fog and sky colour all follow it, and the moon and stars come out at night.',
    'Neon signs, street lamps and windows switch on at dusk and off after sunrise, at the same softer neon level as before.',
    'A small clock in the top left shows the Mountain Time and the time of day. The resort and the mines are unchanged.',
  ] },
  { commit: '8bb3762', at: '2026-11-01T19:03:09-06:00', title: 'Runway and Speedway tarmac is back', bullets: [
    'The Airport runway, apron and the Speedway track were hidden under the grass. They show again.',
    'The runway now has edge lines, thresholds, aiming points and blue edge lights, with a parallel taxiway linked at both ends.',
    'The Speedway has red-and-white kerbs, a pit lane with garages, and grandstands along both straights.',
  ] },
  { commit: 'b26a208', at: '2026-11-01T18:48:42-06:00', title: 'Sell options before expiry', bullets: [
    'Requested by Jay: you can now sell a call or put you hold before it expires, from the Options tab. Sell all of it or just part.',
    'You get the current model value of the option, less the 5% house edge and a 1% fee, so you always get back a bit less than it would cost to buy right now.',
    'Whatever you keep still cashes out automatically at expiry, like before.',
  ] },
  { commit: '4ccb717', at: '2026-11-01T16:00:00-06:00', title: 'The resort sunset finally shows', bullets: [
    'Fixed the sky shader, so the gold-to-violet sunset now actually shows behind the town, with the sun setting over the casino.',
  ] },
  { commit: 'e62a864', at: '2026-11-01T15:50:00-06:00', title: 'Brighter resort sunset', bullets: [
    'The sky over the resort glows gold, coral and violet instead of fading to black.',
  ] },
  { commit: '2df229e', at: '2026-11-01T15:40:00-06:00', title: 'Resort view fixed', bullets: [
    'Fixed the resort opening to a blank sunset screen. The camera now starts over the town again.',
  ] },
  { commit: 'da278d9', at: '2026-11-01T15:30:00-06:00', title: 'Resort sunset, now in view', bullets: [
    'The resort opens at a lower golden-hour angle, so you can see the sunset sky over the town.',
    'The Palms casino bar now sits top-right, clear of the table and slot panels.',
  ] },
  { commit: 'f982c73', at: '2026-11-01T15:20:00-06:00', title: 'Clearer order buttons', bullets: [
    'Stock Exchange order buttons now lock and show a spinner the moment you click, and stay locked until the order is done.',
    'A second order placed right after the first one finished always goes through. If a click repeats an order that is still in progress, you now see "Already placed" instead of a second "Sold" message.',
  ] },
  { commit: 'c49dfd2', at: '2026-11-01T15:10:00-06:00', title: 'Chud Resort gets its golden hour', bullets: [
    'A real sunset sky over the resort: gold horizon fading through coral and magenta to night, with a glowing sun.',
    'Deep blue ocean with sun glints, sky reflections and foam rolling onto the beach.',
    'Warmer light, and the lamps and casino dome now glow.',
    'Resort games now open inside the Palms casino rather than over the beach. The airport no longer zooms in too close.',
  ] },
  { commit: 'b2af23f', at: '2026-11-01T15:00:00-06:00', title: 'No more double orders from a double-click', bullets: [
    'A quick double-click on a fund, stock, short or option order now places it only once, and the button locks with a spinner straight away.',
    'Double-clicking a slots spin, a blackjack action or a roulette spot no longer spins, hits or bets twice.',
  ] },
  { commit: 'e19ad20', at: '2026-11-01T14:55:00-06:00', title: 'Arena waits for you to press Play', bullets: [
    'Opening the Arena from the top bar no longer drops you straight into the match or charges a spawn fee. You join as a spectator and pay only when you press Play.',
  ] },
  { commit: '22bec8e', at: '2026-11-01T14:55:00-06:00', title: 'More menu closes cleanly', bullets: [
    'Clicking outside the top bar\'s More menu now only closes it. It no longer also clicks whatever was underneath.',
  ] },
  { commit: '02d126f', at: '2026-11-01T14:50:00-06:00', title: 'Wallet clicks, order spinners and no stuck Mines window', bullets: [
    'Clicking outside the Wallet now only closes it. It no longer also opens the Stock Exchange, Chess Club or whatever was behind it.',
    'Buying or selling stocks, funds, shorts and options shows a spinner on the button while the order goes through, and the button can\'t be clicked twice.',
    'Reloading the page no longer reopens an empty Mines or Arena window that blocked the screen.',
  ] },
  { commit: '0dfea1b', at: '2026-11-01T14:35:00-06:00', title: 'Fairer shorts, safer retries, and tidier panels', bullets: [
    'Opening a short and closing it straight away now costs only the trading fees. Before, rounding on each side could take 2 extra chips on a small short.',
    'Stock, fund, short and option orders wait longer for a slow server and retry once by themselves. A retry can never charge you twice.',
    'Esc now closes Skills.',
    'Switching between the 2D map and the 3D city closes any open panel, such as the Airport.',
    'Clicking outside a panel to close it no longer also clicks whatever was behind it (like a mine on the map).',
  ] },
  { commit: 'a329b14', at: '2026-11-01T14:30:00-06:00', title: 'Chud Resort: fly to a beachfront resort town', bullets: [
    'Chud Resort is a new map you can only reach by plane. Buy a ticket at the Chud Hub Airport for about 500 chips (follows the price index). The flight home is free.',
    'The Palms Resort Casino has 3 exclusive slots, Tiki Lagoon, Yacht Club and Pearl Diver, with the same payout rates as the city machines. Its blackjack and roulette tables have ivory, gold and lagoon-blue felt.',
    'Premium beachfront real estate: beach houses, oceanview condos, hillside villas and beachfront hotels, all priced above the city. Tax, selling back and repossession work the same as in the city.',
    'The plantation grows tropical crops (pineapples, bananas, mangoes, coconuts and cacao). It shares the daily farm limit.',
    'The Coral Grotto is a new mine inside the volcano, with pay similar to The Mine.',
  ] },
  { commit: '9720f77', at: '2026-11-01T14:20:00-06:00', title: 'No more blank screens after an update', bullets: [
    'If an update lands while you have the game open, clicking the Car Dealership, the Airport or any other screen that loads separately now reloads the page once instead of leaving a blank green screen.',
    'Arena spawn fees are now only charged to a game that is open and running on your screen. Old tabs from before an update are never charged.',
  ] },
  { commit: 'b722556', at: '2026-11-01T14:20:00-06:00', title: 'Mines: find Keys and Chests', bullets: [
    'Every ore you break in any mine has a 5% chance to drop a Key or a Chest (50/50) straight into your inventory.',
    'Sign in to get drops; guests don\'t get them.',
  ] },
  { commit: '4226810', at: '2026-11-01T13:50:00-06:00', title: 'Fishing is now a real 3D game', bullets: [
    'At the Fishing Dock, press “🎮 Play 3D fishing” to stand on the pier at night, with moonlight on the water, reeds, lily pads and the glowing boathouse.',
    'Aim with the mouse (or A/D), then hold to charge your cast and let go. Watch the line fly and the bobber splash down, then wait for it to dip and strike fast.',
    'In the fight, the fish runs left and right and the rod bends. Rare fish jump out of the water. Keep an eye on the tension and line strain.',
    'Every species has its own 3D model when you land it. The Crystal Koi glows, and Old Chud is a real monster.',
    'Other anglers at the dock show up with their name tags. It works on phones too: tap and hold.',
    'Catches, prices, the cooler, selling, Fishing XP and the biggest-catch board all work the same as before. The quick 2D game is still there.',
  ] },
  { commit: '988e290', at: '2026-11-01T13:45:00-06:00', title: 'Stocks, Daily Report and Chud Hub map fixes', bullets: [
    'Share and unit boxes no longer quietly drop a minus sign or a decimal point (so "-5" no longer turns into 5). You now get a clear message: whole, positive numbers only (fund units allow 2 decimals). The server checks this too.',
    'The Daily Report now counts your funds, shorts, options, property and cars as assets, the same way the Bank does.',
    'Inflation now reads the same on the Daily Report and the Bank\'s Economy tab: same numbers, same labels, with an "as of" time. Smoothed inflation says "needs a closed day" instead of "—/day".',
    'Fund Buy and Sell buttons show the exact chips you\'ll pay or get, and the shorts table shows what closing pays you, to the chip.',
    '"You own 1 share" (not "1 shares"), and Sell shows no price when you own none.',
    'On the 2D map, "Line up on the grid" and "Get your car at the terminal" now switch to the 3D city and put you in your car (or tell you to buy one first).',
    'Buying property without enough chips now tells you how many more you need. Deeds show the 70% sell-back price.',
    'Airport and Speedway panels no longer overlap the deed and real estate panels, and prices stay on one line. Map popups stay clear of the 🔊 volume button at high zoom.',
    'The 3D city can\'t be dragged far off screen when zoomed out.',
    'Only one map panel is open at a time: buying land or opening a farm no longer brings back the Real estate list, and the Wallet and Real estate panels close each other instead of piling up.',
    'Opening Skills closes any open deed, Airport or Wallet panel, and Esc now closes the Wallet.',
    'Buying or selling property shows a spinner right away and a confirmation when it\'s done, and the deed updates straight away. Buying is also a little faster on the server.',
    'Crops grow live: the farm panel updates when a crop ripens or withers (no reload needed), and crops on the map refresh every 15 seconds.',
  ] },
  { commit: '159ac45', at: '2026-11-01T13:30:00-06:00', title: 'Countryside roads fixed', bullets: [
    'The countryside roads are now one tidy ring around the city and the farm, with no dead ends, doubled roads or random diagonals. Every road ends at a junction or somewhere you can go.',
    'The Speedway road now goes straight north from the boulevard, along the ring road, and up to the track without crossing it. The Airport road and every other crossing has a proper junction with no centre lines through it.',
    'The dirt roads to The Mine, Frostbite Caverns and Magma Depths now branch straight off a paved road, a short road leads down to the Fishing Dock, and the farm lanes run up to the ring road and on to Magma Depths.',
    'The mine yards, the farm and the venue grounds no longer flicker where they meet the grass.',
  ] },
  { commit: '4a47a7c', at: '2026-11-01T12:50:00-06:00', title: 'The big lake looks natural', bullets: [
    'The long lake between downtown and the far-shore fields is no longer a flat slab. It has a winding south shore with coves and points, rounded ends, and a small wooded island.',
    'The water is lighter in the shallows and darker in the middle, with gentle foam and ripples at the edge. It matches the lake by the Fishing Dock.',
    'Sandy banks blend into the grass, with reeds, lily pads, rocks and trees along the shore. The city waterfront and its roads are unchanged.',
  ] },
  { commit: '83d3d4b', at: '2026-11-01T12:25:15-06:00', title: 'Fishing Dock, and a prettier lake', bullets: [
    'The big lake in the north-east has been redone. It has a smooth, natural shoreline, a sandy bank that fades into the grass, reed beds, lily pads, rocks and trees around it.',
    'The new Fishing Dock is on the north shore, with a boathouse and a pier out over the water. Click it on the map, or drive up and press E.',
    'To fish: cast, wait for the bite, then strike. Hold to reel and let go to give the fish line. Keep the hook in the green zone until the catch bar fills. Rarer and bigger fish fight harder.',
    'There are 16 catches, from old boots to the legendary Crystal Koi and Old Chud, the Lake Monster. Each comes in a range of sizes, and bigger ones are worth more.',
    'Your catch goes in your cooler, which holds 40. Sell it to the fishmonger at the dock for chips. Prices follow the price index. You get full price on the first 500 each day, then half, then a tenth, up to about 1,350 a day.',
    'The dock has a board for the biggest catches. Every catch also trains the new 🎣 Fishing skill (more XP for rarer fish).',
  ] },
  { commit: 'c6b3f63', at: '2026-11-01T12:18:38-06:00', title: 'Skills: level up like RuneScape', bullets: [
    'New 🧭 Skills tab: ten skills from level 1 to 99 on the classic RuneScape XP curve, plus your total level and a title.',
    'Every activity trains a skill: Mining (break ore), Engineering (factory output), Farming (harvests), Racing (Speedway laps), Combat (Arena kills and wins), Trading (stocks and Market), Gambling (casino bets), Chess (finished games vs people) and Property (buying real estate, paying tax).',
    'XP drops pop up as you earn it, and you get a level-up fanfare. Hover a skill to see XP to the next level.',
    'Hiscores for every skill and overall, and skills now show on player profiles in the chat list.',
    'Skills are cosmetic (titles and badges). They never change casino odds, payouts or chips.',
  ] },
  { commit: '29be0b6', at: '2026-11-01T12:16:23-06:00', title: 'Arena: head shots fixed, and no spawn fees when the game can’t load', bullets: [
    'Head shots land again on every gun. Players who were running, sprinting or crouching were drawn with their head leaning forward of where it really is, so a shot at the head you could see often missed. Their head is now drawn exactly where it counts.',
    'Shooting while jumping or landing now fires from the height you actually see, so head shots in the air register too.',
    'The head shot ding and the red head shot number now only show when the server confirms a head shot, with the real damage.',
    'The Arena no longer spawns you or charges a spawn fee until the 3D game has loaded and is on your screen. If it stops drawing (a tab left behind after an update), you stop respawning and paying.',
    'After an update, an old tab now reloads itself once to get the new version instead of failing to load the 3D game.',
  ] },
  { commit: 'fe29e3a', at: '2026-11-01T12:07:41-06:00', title: 'Name tags in the mines', bullets: [
    'Other miners now have their name above their head in every mine: The Mine, Frostbite Caverns and Magma Depths.',
    'Tags stay readable from a distance, fade out the farther away someone is, and hide when a rock wall is in the way. You never see your own tag. (Request #4, thanks carter2.)',
  ] },
  { commit: '86d504b', at: '2026-11-01T11:58:10-06:00', title: 'Easier flying from the Airport', bullets: [
    'Drive anywhere on the airport grounds and a “Fly from the Airport” button appears at the bottom of the screen. Click it or press E to pick where to fly.',
    '“Get your car at the terminal” now leaves the Fly menu open, so you can take off right away to downtown or the Speedway.',
    'The Speedway start banner now fades away when you are on the grid, so it no longer blocks your view.',
  ] },
  { commit: 'cea0064', at: '2026-11-01T11:52:52-06:00', title: 'Countryside tidy-up, and country homes for sale', bullets: [
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
