# Truck logistics cutover (per-location stock) — operator procedure

Inventory writes are fenced: only the newest server process (its `chud-inv-<uuid>` token, sent as Postgres
`application_name`) can write inventory tables (see server/invFence.ts FENCED_TABLES). Others fail closed.

## Before
1. Over the SAME (Neon pooler) URL production uses, read-only: `SHOW application_name;` from a client started with
   `PGAPPNAME=chud-inv-probe` must return `chud-inv-probe`. If not, do not deploy (the server would refuse to boot).
2. Run exactly ONE web instance for the new release (no permanent second writer; a second one gets fenced out).

## Deploy
3. Deploy. On boot the new server: takes the fence (advisory lock; waits for in-flight old writes to finish), from
   that moment the old instance's inventory writes are rejected (players on it see errors, nothing is lost or doubled);
   migrates legacy shared stock into each owner's factory (idempotent, conservation-checked, retried until it succeeds);
   only then listens. Expect an inventory outage from fence-take until listen.
4. Check the log line `[locmoves] legacy -> factory:` (conserved=true) and `loc_migrations` row
   `legacy-to-factory-v1`: `held` = owners without a unique factory (left untouched), `freightHeld` = legacy in-flight
   loads waiting at the dock for a recipient factory.

## Rollback (to 14bad00)
5. `UPDATE inv_fence SET mode = 'open';` then deploy 14bad00. Old code never loads `kind='loc'` legs (stored as
   status `moving`) nor loc_stock; that stock is invisible to it but kept, and reappears on re-deploy (which re-fences).
