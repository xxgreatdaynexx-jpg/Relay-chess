# Billionaire Update — changelog draft (do not wire into the game)

Player-facing text, ready to paste into `shared/changelog.ts` on launch. Keep this file off the live changelog and launch popup until there is an explicit go.

## Luxury yacht upkeep

Title: Yacht and superyacht daily upkeep

- Yachts now cost 3,000 chips a day and superyachts 15,000, following the daily price index (crew and dock). The first bill is the UTC day after you buy one. Skiffs and sportfishers have no daily luxury upkeep.
- If a bill cannot be paid, the wallet is left as-is (it is never pushed negative) and you get a private warning. After 3 unpaid days in a row the boat is repossessed with no refund. The Marina and your Daily Report show the next charge and any arrears.
- Upkeep is a chip sink. Freight's existing per-day-used cargo fee is unchanged.

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
- Cargo `useUpkeep` on the first freight trip of a day still applies on top of luxury daily upkeep.
- Vanity and patronage have no sales tax, so the indexed list price is what you pay.
- Patronage terms are 7 days with no mid-term buyout.
