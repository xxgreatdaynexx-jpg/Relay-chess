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
