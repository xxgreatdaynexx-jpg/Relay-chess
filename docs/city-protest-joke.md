# City drama-club joke (visual only)

Single off switch: `CITY_PROTEST_JOKE_ENABLED` in `client/src/lib/cityProtestJoke.ts`.
Set it to `false`, rebuild/redeploy normally, then reload/reopen the City scene. No database operation, player reset, asset rollback, or unrelated commit revert is needed. The disabled path allocates no scene nodes, materials, geometry or textures. Existing civic/farm protest features are separate baseline features and are not disabled by this switch.

The scene-owned handle also supports immediate `setEnabled(false)` and idempotent `dispose()` for lifecycle use/tests: it detaches the root, disposes every owned instance buffer, shared geometry/material and sign texture once, and has no timers/listeners/network/audio to leave behind. Enabling again creates fresh resources; a disposed handle cannot restart.

Integration is restricted to the City `world3d.ts`: one import, one attach after the existing `cityFill`, one existing-frame `step`, and one early teardown call. No Resort/Fort/interior integration. Open patch geometry is read-only and excludes already retired civic footprints; no owner/account/state is consulted. Rays pass through all gag props; no collision or pickable registration. No building/road/farm placement is changed.

Budgets: low 8 sites × 3 people/2 smoke puffs; mid 12 × 4/3; high 16 × 4/4. Each site has three small cartoon flames and one fake cardboard loot box. Torso/head/arms/legs/boxes/flames/smoke use eight instanced meshes and shared low-poly geometry/materials; no real lights or audio. Low graphics freezes motion; OS/site reduced-motion settings are read in the existing frame loop and also freeze it live. No new RAF, interval or event listener.

No changelog entry by explicit user request. Browser visual QA is separate from structural/unit verification.

## More fires / buildings on fire (visual extension)

The SAME `CITY_PROTEST_JOKE_ENABLED` switch disables the entire joke, including these building flames. The City supplies its actual, non-retired `cityHouses` geometry, not owners, prices or arbitrary floating coordinates. Every selected building gets a roof anchor at its real body top, plus the exact rendered gable ridge height where applicable. Buildings at least 3.3 units tall also get an upper-façade/window anchor (72% of body height), just outside the wall toward the normal City camera. Small homes get roof fires only; no ground-level doorway anchor. No building mesh/material/collision/pickable is modified.

Building budgets are 16 / 32 / 48 (low / mid / high). Selection starts centrally, includes actual roof/building styles, then spreads spatially without consulting ownership. Each anchor has three orange/yellow paired low-poly flame tongues (six cone instances) and 2 / 3 / 4 shared smoke puffs. These reuse the existing flame and smoke batches: still only EIGHT instanced batches for the entire joke, no extra dynamic lights, draw-call-per-flame objects, textures, listeners or timers. Ground flames are also larger. Low/reduced-motion remains static; off/dispose frees the expanded buffers through the same lifecycle.

Roof cones are rooted on the geometry and reach roughly 4–5 world units above it, deliberately larger/brighter for normal City-camera visibility. The visual effect is pretend only: no damage, penalties, theft, service call, treasury connection or gameplay/network action. No changelog or launch popup.
