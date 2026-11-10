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

