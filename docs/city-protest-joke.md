# City drama-club joke (visual only)

Single off switch: `CITY_PROTEST_JOKE_ENABLED` in `client/src/lib/cityProtestJoke.ts`.
Set it to `false`, rebuild/redeploy normally, then reload/reopen the City scene. No database operation, player reset, asset rollback, or unrelated commit revert is needed. The disabled path allocates no scene nodes, materials, geometry or textures. Existing civic/farm protest features are separate baseline features and are not disabled by this switch.

The scene-owned handle also supports immediate `setEnabled(false)` and idempotent `dispose()` for lifecycle use/tests: it detaches the root, disposes every owned instance buffer, shared geometry/material and sign texture once, and has no timers/listeners/network/audio to leave behind. Enabling again creates fresh resources; a disposed handle cannot restart.

Integration is restricted to the City `world3d.ts`: one import, one attach after the existing `cityFill`, one existing-frame `step`, and one early teardown call. No Resort/Fort/interior integration. Open patch geometry is read-only and excludes already retired civic footprints; no owner/account/state is consulted. Rays pass through all gag props; no collision or pickable registration. No building/road/farm placement is changed.

Budgets: low 8 sites × 3 people/2 smoke puffs; mid 12 × 4/3; high 16 × 4/4. Each site has three small cartoon flames and one fake cardboard loot box. Torso/head/arms/legs/boxes/flames/smoke use eight instanced meshes and shared low-poly geometry/materials; no real lights or audio. Low graphics freezes motion; OS/site reduced-motion settings are read in the existing frame loop and also freeze it live. No new RAF, interval or event listener.

No changelog entry by explicit user request. Browser visual QA is separate from structural/unit verification.
