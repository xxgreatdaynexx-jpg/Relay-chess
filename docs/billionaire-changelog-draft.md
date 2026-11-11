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

