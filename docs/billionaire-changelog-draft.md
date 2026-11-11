# Billionaire Update — changelog draft (do not wire into the game)

Player-facing text, ready to paste into `shared/changelog.ts` on launch. Keep this file off the live changelog and launch popup until there is an explicit go.

## Luxury yacht upkeep

Title: Yacht and superyacht daily upkeep

- Yachts now cost 3,000 chips a day and superyachts 15,000, following the daily price index (crew and dock). The first bill is the UTC day after you buy one. Skiffs and sportfishers have no daily luxury upkeep.
- If a bill cannot be paid, the wallet is left as-is (it is never pushed negative) and you get a private warning. After 3 unpaid days in a row the boat is repossessed with no refund. The Marina and your Daily Report show the next charge and any arrears.
- Upkeep is a chip sink. For yachts and superyachts this daily bill replaces the old per-day-used cargo freight fee (no double charge). Skiffs and sportfishers still pay that freight fee on the first trip of a day.

## Vanity Desk

Title: Vanity Desk at City Hall

- City Hall has a Prestige Desk where you can buy titles (Tycoon 50,000, Magnate 150,000, Billionaire 500,000), launch fireworks (5,000 / 25,000 / 100,000), buy vehicle liveries (40,000 each) for a yacht or jet you own, or post a city shout-out (15,000, once an hour).
- Titles can be worn in city chat. Fireworks are a city-wide show, not a chat post. All of these purchases are chip sinks and cannot be resold. Prices follow the daily price index.

## City patronage

Title: City patronage naming rights

- Sponsor the City Plaza (500,000), Fireworks Dock (250,000), a weekly City Festival (150,000), or a Patron Monument (1,000,000) for a week. Your name is listed as the patron. The current patron can renew; anyone else waits until the term ends. There are no refunds.
- Patronage is a pure chip sink — the mayor and the city treasury are not paid. Prices follow the daily price index.

## Balance notes (internal)

- Yacht 3,000 / superyacht 15,000 daily base; 3-day grace; hospital `vehicle_upkeep` perk applies, same as jets.
- Existing yacht and superyacht owners are billed on the first UTC day after launch (they were bought before today).
- Yacht and superyacht cargo `useUpkeep` is 0; daily luxury upkeep is the only daily bill. Skiff and sportfisher first-trip cargo fees are unchanged.
- Vanity and patronage have no sales tax, so the indexed list price is what you pay.
- Patronage terms are 7 days with no mid-term buyout.

## Private jet missed-bill notices

Title: Private warnings for unpaid jet upkeep

- Jet upkeep already used the same billing and grace rules as luxury boats. Missed bills now also send a private warning from the Hangar (not public chat), the same way the Marina warns yacht owners. The wallet is never pushed negative.

## Vehicle liveries in 3D

Title: Liveries show on your yacht or jet

- A livery applied at the Prestige Desk now paints that yacht or jet in the Marina and Hangar 3D previews.


## Hypercars and a fourth jet

Title: Nightshade, Apex One, and the Chud Global Express

- Chud Motors adds two hypercars above the Chudmobile: the Nightshade (400,000) and the Apex One (850,000). Prices follow the daily price index.
- The Hangar adds the Chud Global Express (3,000,000, 8 seats, 36,000 a day upkeep), sitting between the Gulfstream G700 and Chud One.

## Megayacht

Title: The Sovereign Megayacht

- The Marina now sells the Sovereign Megayacht (8,000,000, 40,000 a day upkeep, 120,000 cargo units). Daily luxury upkeep replaces any cargo use fee. It reaches every deep-sea zone, takes 10 crew, and is the boat that sails to the private island.


## Billionaire's Club

Title: The Billionaire's Club opens on the beach

- A civic Billionaire's Club now stands on the ocean beach west of the Harbour. The Prestige Desk has moved here from City Hall. Current city patrons are listed on plaques in the Club, and you can still sponsor a plaque from the desk.

## Private Island

Title: A private island for megayachts and jets

- Own a Sovereign Megayacht or any private jet and you can sail or fly to a Private Island off the coast. Four estates (2.5–6 million) are for sale there. The return trip is free. The island is not a freight hub and cannot be reached with an ordinary plane ticket.

## Sky penthouses

Title: Sky Tower penthouses

- Six sky penthouses (2–4.5 million) sit around a civic tower next to the Club. They use the normal home interiors, furniture, tax and 70% sell-back rules.

## Art auction

Title: An art auction at the Club

- The Club runs a house art auction. Bids are held in escrow and a higher bid refunds the previous bidder. The winner's payment is a chip sink, and the piece can be placed in a home but cannot be resold. A bid in the last 30 seconds extends the clock.


## High-stakes tables

Title: High-stakes tables at the Club

- The Billionaire's Club opens high-limit rooms of the games you already know. Blackjack adds High Stakes (1,000–100,000) and Whale (10,000–1,000,000) tables. Roulette adds a High Limit wheel (up to 1,000,000 a spin). Hold'em adds Billionaire 500K and 1M buy-ins. Jacks or Better can be played at 100–50,000. House rules are unchanged; only the stakes go up.

## Prestige factory line

Title: A prestige line at the factory

- The Jeweler's Bench and Fabricator can now make prestige pieces (cufflinks, a signet ring, an imperial diadem, a sovereign laurel, a crystal chandelier, a coachbuilt limousine, a city seal, a grand clock, and a vault door). They take longer and sell for about 25% more than their inputs, and they never out-earn the older recipes per second.


## Yacht models

Title: Distinct yacht and megayacht models

- The Azure 60 Yacht, Chud Royale Superyacht and Sovereign Megayacht now each have their own 3D model at the Marina. The megayacht is a longer, four-deck hull with a helipad, not just a scaled superyacht.

## Yacht boarding

Title: Board a friend's yacht

- Yacht, superyacht and megayacht owners can open boarding for a voyage or (megayacht) the Private Island, the same way jet owners open boarding. Friends request a seat; the captain accepts. Seats can be free or a capped fare paid to the captain.

## Voyages

Title: Ocean voyages from the Marina

- From the Marina you can sail timed voyages to destinations like Coral Atoll, the Outer Banks, Blue Water Crossing, the Southern Isles, Abyss Watch and Midnight Reef. A boat can only sail a voyage in its deep-sea range. Boarded crew travel with the captain and return together. Voyages are not plane tickets.

## Ship combat

Title: Opt-in ship combat at sea

- Captains who have arrived on a voyage can opt in to ship combat and challenge another opted-in captain. Fights are turn-based shots at the hull. A stake is optional and held in escrow; the winner takes the pot minus a 5% rake (a chip sink). The loser may owe a hull repair bill (also a sink). Combat is never forced, and the wallet is never pushed negative.


## Private construction sites

Title: Buy land and raise your own works

- Vacant lots in the East Estates can be bought and used as private construction sites. The owner chooses a data center, bitcoin farm, personal monument, mansion, highrise or power plant. Each project has four material-and-chip stages, and the building on the lot changes as each stage is finished, the same way the co-op hockey stadium does.
- You can also demolish a house, farm or other non-monument structure you own and start one of these projects on the lot. Landmarks, civic buildings, the harbour, jail, Sky Tower penthouses and island estates cannot be demolished. There is no chip refund for the old structure — sell it back first if you want the 70% sell-back. Furniture returns to your locker; growing crops return as seeds and ripe crops go to your warehouse. Demolish asks for a clear confirmation and shows these rules first.
- Two turnkey power plants are also for sale, already built, if you would rather buy pre-existing stock than construct your own.

## Data centers and bitcoin farms

Title: Racks, GPUs and a power bill

- A finished data center takes up to 8 server racks (120,000 chips and 3 MW each, about 400 chips an hour). A finished bitcoin farm takes up to 16 GPU rigs (45,000 chips and 1.5 MW each, about 200 chips an hour). Both draw power from a utility contract or from a plant you own. Combined digital income is capped (200,000 chips a day, then indexed). Surplus plant power can be sold back to the grid at 45% of the utility rate.

## Power plants

Title: Build or buy your own plant

- A four-stage power plant delivers 40 MW when fueled (8,000 chips a day, or coal). You can also buy a utility contract for grid power at 1,200 chips per MW per day, or purchase a turnkey plant already standing in the East Estates.

## Map expansion and Goldwood

Title: New land east of the city, and a rich community to the north

- The map grows east of the Big Farms and north of the city. Ten new farms and sixteen vacant lots sit in the East Estates. Goldwood, a small community of eight mansions, stands north of town, with its own road in. Existing city blocks, farms and deeds are not moved.

## Wineries

Title: Vineyards with an on-site press

- Five wineries are for sale in Goldwood and the East Estates. Grapes there grow in a little over half the usual time and yield more, and the on-site press makes one wine from one grape (the city cannery still needs two).

## International airport

Title: A larger international airport

- The airport is now an international terminal with a larger hall and a second runway west of the original one. The original runway, hangars and jets stay where they were.

## More furniture

Title: A larger furniture catalogue

- The furniture store's catalogue is more than twice as large, with new pieces for mansions and highrises as well as ordinary homes.

## Hyper farms

Title: Convert a farm into a Dutch glasshouse

- Owners can convert a farm they own into a hyper farm, a four-stage Dutch-style greenhouse. Ordinary crops still grow while you build. When it is finished, flowers and other difficult crops (tulips, roses, orchids, saffron, wasabi, vanilla) can be planted there, and everything in the glasshouse grows faster.

## Offshore rigs

Title: Build a rig on the shore and launch it

- A shoreline construction dock east of the harbour lets you assemble an offshore rig in four stages, then launch it for a fee. Launched rigs pump crude to your Fort McChud tanks (about 90 units an hour, up to three rigs per player).

## Plastics plant

Title: A plastics plant in Chud City

- A plastics plant on the east edge of Chud City imports naphtha, ethylene or plastics from Fort McChud and can make resin, computers, graphics cards and equipment cases, which feed private works and furniture.

## Future Features sign

Title: The coming-soon sign opens a Future Features look

- The gold Coming Soon sign still shows no date. Clicking it opens a Future Features popup with a short, date-free teaser and a few screenshots from the work in progress.

## Orchard Ridge

A buyable orchard district on the expanded east map. Plant fruit trees once (apples, cherries, peaches, oranges, pears, plums). Trees take several real days to mature, then fruit on a repeating cycle with no replanting. Fruit sells at the same +35% raw margin as other crops (the sapling is a one-time cost and counts toward the house-cap planting bonus). Juice, cider, pies and jam craft at the usual +8% food-step markup. Auto-harvest and pantry rules match ordinary farms.

## Camera zoom on the expanded map

Title: Zoom out far enough to see the whole 2x map

- The city camera's max zoom, far plane and fog were still sized for the original plate, so a fully zoomed-out view could not show East Estates, Goldwood and the shoreline together. Zoom, fog and the far plane now scale with the expanded map, and you can tilt a little more overhead for an overview.
