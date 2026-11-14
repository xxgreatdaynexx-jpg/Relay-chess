# Space program — draft changelog (not wired to release)

Do not copy this into `shared/changelog.ts` until this feature is shipped. The player-facing entry, when it ships:

```
  {"commit": "", "at": "2026-11-13T16:00:00-06:00", "title": "Space Center: design a rocket and put a satellite in orbit", "bullets": [
    "The Space Center in the northwest corner of the city is now a working space program. Walk in (or tap it on the 2D map) to open the Vehicle Assembly Building and Mission Control.",
    "In the VAB you stack command pods, tanks, engines, decouplers, fairings and satellite payloads, with a live mass, cost, thrust-to-weight and per-stage delta-v readout (vacuum and sea level, from the Tsiolkovsky equation).",
    "The home world is a Kerbin-like body: 600 km radius, 9.81 m/s² surface gravity, a 6-hour day and a 70 km atmosphere. A stable low orbit takes about 3,400 m/s of vacuum delta-v, including gravity and drag. Mission Control shows altitude, speed, apoapsis, periapsis, stage delta-v and a CAPCOM flight log. Guidance can fly a stock Courier I for you, or you can pitch, throttle and stage yourself.",
    "Parts are paid for when you roll out to the pad. A successful satellite deploy pays a small one-time bounty, capped at five paid flights per player; after that, satellites still count on the orbit leaderboard. Your chips, items and existing property are otherwise unchanged.",
  ]},
```

  {"commit": "", "at": "2026-11-13T16:30:00-06:00", "title": "Space Center: a better planet, and contracts you can fly for a payout", "bullets": [
    "Mission Control's home world is now a procedurally drawn planet: continents and biomes, drifting clouds, a day/night terminator with city lights, a 70 km atmospheric limb, ocean sun glint, a starfield, and a 6-hour-day rotation. The same surface texture is used on the equatorial ground-track map. During early ascent the view is a curved horizon with an atmosphere-gradient sky.",
    "A Contracts tab in the Space Center offers a rotating daily mission board (UTC). Accept up to three contracts at a time, fly them on a paid launch, and claim a chip payout that scales with difficulty — sounding flights, orbit, circular and targeted deploy altitudes, twin-satellite launches, and a budget-orbit challenge. Payouts are sized to clear a typical launch cost with a conservative net of about 1,000–15,000 chips, with a 30,000 chip daily cap per player. The existing five-flight satellite bounty is unchanged and is paid separately; one flight can collect both.",
    "Contract claims are checked on the server against the launch ticket filed for that mission: flight duration, vacuum Δv versus a vis-viva / Hohmann estimate, and reported orbit figures that a design could actually reach.",
  ]},

  {"commit": "", "at": "2026-11-13T18:00:00-06:00", "title": "Space Center: planetary mapping, science experiments and an R&D tree", "bullets": [
    "Five survey scanners map the planet from orbit: Visual imagery, radar Altimetry, multispectral Biome, Resource (ore) and Weather. Each has its own best altitude band and swath width. Deploy one like a satellite and it keeps mapping along its ground track as the planet turns, even while you are away (each download plays back at most 18 hours of orbit).",
    "A new Survey tab shows each map as it is revealed, with % complete. Reaching 25, 50, 75 and 100% on a map pays a one-time milestone bounty of 1,000, 1,500, 2,000 and 3,000 chips. That is 7,500 per map and 37,500 for all five, once per player.",
    "Eight science experiments (thermometer, barometer, Geiger counter, magnetometer, atmospheric sampler, gravity scanner, materials bay and seismic accelerometer) can be run on the pad, flying low or high, suborbital, and in low or high orbit. Some results also depend on the biome below. Repeating a result is worth half as much each time, and the Science archive keeps everything you have learned.",
    "Science points buy R&D nodes that unlock bigger tanks, new engines (Skipper, Poodle, Nerv), the Kickback booster, more experiments and the advanced scanners. Every part you already had stays unlocked. Results also pay a small research grant of 20 chips a point, capped at 2,000 chips a day.",
    "The daily contract board now always includes one survey and one science contract. Results are checked on the server against the launch ticket: the part must be on the launched design, and the situation must fit the flight time and the rocket's Δv. Launch tickets now stay valid for 30 minutes.",
  ]},

  {"commit": "", "at": "2026-11-13T20:10:00-06:00", "title": "Space Center: a cleaner flight view, nicer rockets, and other players in orbit with you", "bullets": [
    "The ascent view is now one continuous camera, from the pad complex to orbit. The ground has terrain detail, field patterns, coastlines and aerial haze. The horizon curves naturally through the 40–55 km band, and the view pulls back smoothly to the globe without a jump.",
    "Rockets, satellites and plumes have new art. Parts are shaded and engines have proper bells. The payload fairing is a clamshell that splits in two on staging. Spent stages and boosters fall away, the exhaust plume widens as the air thins, and a small inset shows the satellite separating and unfolding its panels.",
    "Survey maps blend smoothly between scan passes instead of showing blocky squares, and the starfield, globe halo and night-side city lights are sharper on high-resolution screens.",
    "On phones, the VAB keeps the cost, Δv and Roll out button in a bar pinned to the bottom of the screen. The Hangar no longer cuts off its panels, and the flight controls fit short landscape screens.",
    "Other players' satellites now show on the orbit map and the ground track. Mission Control has a Recent launches feed, and the Hangar has leaderboards for satellites, science and map coverage. Shared data refreshes every 90 seconds, only while the tab is open.",
    "Launches, deploys, contract claims, science and survey payouts are processed one at a time per player. Two tabs on one account can no longer double-launch or double-claim.",
  ]},
