# City drama-club joke (visual only)

Single off switch: `CITY_PROTEST_JOKE_ENABLED` in `client/src/lib/cityProtestJoke.ts`.
Set it to `false`, rebuild/redeploy normally, then reload/reopen the City scene. No database operation, player reset, asset rollback, or unrelated commit revert is needed. The disabled path allocates no scene nodes, materials, geometry or textures. Existing civic/farm protest features are separate baseline features and are not disabled by this switch.

The scene-owned handle also supports immediate `setEnabled(false)` and idempotent `dispose()` for lifecycle use/tests: it detaches the root, disposes every owned instance buffer, shared geometry/material and sign texture once, and has no timers/listeners/network/audio to leave behind. Enabling again creates fresh resources; a disposed handle cannot restart.

Integration is restricted to the City `world3d.ts`: one import, one attach after the existing `cityFill`, one existing-frame `step`, and one early teardown call. No Resort/Fort/interior integration. Open patch geometry is read-only and excludes already retired civic footprints; no owner/account/state is consulted. Rays pass through all gag props; no collision or pickable registration. No building/road/farm placement is changed.

Budgets: low 8 sites × 3 people/2 smoke puffs; mid 12 × 4/3; high 16 × 4/4. Each site has three small cartoon flames and one fake cardboard loot box. Torso/head/arms/legs/boxes/flames/smoke use eight instanced meshes and shared low-poly geometry/materials; no real lights or audio. Low graphics freezes motion; OS/site reduced-motion settings are read in the existing frame loop and also freeze it live. No new RAF, interval or event listener.

No changelog entry by explicit user request. Browser visual QA is separate from structural/unit verification.

## More fires / buildings on fire (visual extension)

The SAME `CITY_PROTEST_JOKE_ENABLED` switch disables the entire joke, including these building flames. The City supplies its actual, non-retired `cityHouses` geometry, not owners, prices or arbitrary floating coordinates. Every selected building gets a roof anchor at its real body top, plus the exact rendered gable ridge height where applicable. Buildings at least 3.3 units tall also get an upper-façade/window anchor (72% of body height), just outside the wall toward the normal City camera. Small homes get roof fires only; no ground-level doorway anchor. No building mesh/material/collision/pickable is modified.

Building budgets are 16 / 32 / 48 (low / mid / high). Selection starts centrally, includes actual roof/building styles, then spreads spatially without consulting ownership. Each anchor has three orange/yellow paired low-poly flame tongues (six cone instances) and 2 / 3 / 4 shared smoke puffs. These reuse the existing flame and smoke batches: still only EIGHT instanced batches for the crowd/fire subsystem (sixteen including the shield-wall addition below), no extra dynamic lights, draw-call-per-flame objects, textures, listeners or timers. Ground flames are also larger. Low/reduced-motion remains static; off/dispose frees the expanded buffers through the same lifecycle.

Roof cones are rooted on the geometry and reach roughly 4–5 world units above it, deliberately larger/brighter for normal City-camera visibility. The visual effect is pretend only: no damage, penalties, theft, service call, treasury connection or gameplay/network action. No changelog or launch popup.

## Decorative marching shield walls

Entire-joke off remains `CITY_PROTEST_JOKE_ENABLED=false` in `cityProtestJoke.ts`. Police-only easy off: `CITY_SHIELD_WALLS_ENABLED=false` in `client/src/lib/cityShieldWalls.ts`, followed by the normal rebuild/redeploy/reopen City. No data change or unrelated feature rollback. Existing crowds, fires and pretend loot are unchanged.

The new child scene is helmeted blue-uniform officers with opaque blue visors, white-rimmed large POLICE shields, two coordinated ranks of three, shared walking cadence and near-touching shield edges. There are no weapons, interactions, arrest/combat rules or enforcement/network/service hooks. Models and one shared procedural shield texture are self-owned, with eight instanced batches total for all officers, not per person. The crowd/fire + police baseline uses sixteen instanced batches (27 including the citywide addition below); fire/smoke batches and budgets remain unchanged.

Low/mid/high budgets: 2/4/6 formations, 6 officers each (12/24/36 officers). Actual `CAR_ROUTES` street polylines supply the arc distances, tangents and widths; selected streets are at least 4.5 units wide. Exact selected roads are `ring`, `nsblvd`, and `ewblvd`; extra mid/high formations share the closed ring at separated phases, never duplicate a reversing wall. Rank rows follow the curve independently and columns sit ±1.05 from the centreline; shields are 1.12 wide. Open-road formations reverse five units inside the ends; ring-road formations loop. These are purely visual and do not collide with or stop vehicles/players. No path is drawn through a building or shortcut across a block.

The existing City frame drives the child; no RAF/timer/listener is added. Low tier stays still. Reduced motion freezes the current marching pose without catching up/jumping when disabled again. Whole-joke off/dispose first disposes the police child including instance buffers, four shared geometries, six shared materials and one texture. No new changelog or popup.

## Protesters everywhere (crowd-only expansion)

`CITY_PROTEST_JOKE_ENABLED` and the existing `setEnabled(false)` handle still remove EVERYTHING, now including the scene-owned `citywide-protesters` child. No independent scene renderer/timer/listener exists. The extra layer is entirely procedural, decorative and City-only, with no gameplay/network/ownership input or collision/picking.

The additional crowds sample **all actual City roads** (including small neighbourhood lanes), plus open public patches. Farthest-point sampling starts centrally and spreads to all quadrants and peripheral districts before filling gaps; the high tier covers all 31 roads. Actual rendered house/landmark footprints are passed from `world3d.ts`; a three-unit expanded exclusion keeps bodies and raised signs away from buildings/entrances. No roads/buildings are changed.

Low/mid/high add 80/144/224 groups of three colorful figures = 240/432/672 additional people, with one raised silly sign per group. With the eight original pockets the actual full-catalog totals are 264/464/704 protesters across 23/30/31 roads, respectively. The original patch protesters, fake loot, **ground/building fires and smoke budgets stay unchanged**. Signs are six shared textured instanced batches rather than per-sign sprites; bodies/heads/arms/legs/poles add five more batches. Extra layer: eleven instanced batches, three geometries, nine materials, six textures; entire joke now has 27 instanced batches including police. Low/reduced-motion freezes animation; resource disposal and parent off/on remain idempotent. No changelog or popup. No actual browser visual QA is implied by geometry/render-object tests.
