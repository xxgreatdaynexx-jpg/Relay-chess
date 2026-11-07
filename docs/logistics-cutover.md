# Truck logistics cutover (per-location stock): operator procedure

Inventory writes are fenced (server/invFence.ts): only the process holding the fence (its own crypto-random
`chud-inv-<uuid>` token, sent as Postgres `application_name`) can write the inventory tables (FENCED_TABLES).
Production topology already matches: ONE Render instance, no autoscaling.

## 0. Preconditions (must all hold, else do not deploy)
1. Over the production Neon **pooler** URL, read-only: a client started with application_name `chud-inv-probe` runs
   `BEGIN; SHOW application_name; COMMIT;` and gets `chud-inv-probe` back. (If not, the new server refuses to boot:
   fail closed, fence untouched, old server keeps running.)
2. Players are told about the short inventory pause (the parent relays this before cutover).
3. Render health check path is `/health` (render.yaml): it returns 503 until the inventory boot is complete and
   whenever this process does not hold the fence.

## 1. Deploy (forward)
Render starts the new instance while the old one still serves. The new instance:
1. verifies its token reaches Postgres; creates missing fence triggers only (never drops; lock_timeout + retry, so an
   old writer mid-transaction is waited for, never deadlocked);
2. takes the fence (waits for in-flight old writes to finish). From here the old instance's inventory writes fail
   ("inventory fenced"): players on it see errors, nothing is lost or doubled. Chips-only actions keep working;
3. marks `inv_fence.migrated = true` (sticky), migrates legacy shared stock into each owner's factory (conservation
   checked; owners without a unique factory are HELD untouched and reported), bounded to LM_MIGRATE_TRIES attempts;
4. marks ready, listens; `/health` turns 200; Render switches traffic and stops the old instance.

**Measured outage** (inventory writes refused, from fence-take to ready), local Postgres 16:
- migration of 1,000 owners (50,000 fish, 5,000 fillet stacks, 1,000 dishes, 3,000 barn crops): **1.9 s**; 100 owners: 0.2 s.
- the migration is ~8 sequential round trips per owner with fillet/barn rows, so on Neon expect about
  `owners_with_fillets_or_barn x 8 x RTT` (e.g. 500 owners at 3 ms = 12 s) plus the rest of the server boot after
  the fence (all module inits up to listen). Production row counts could not be read from this box (see report).

Check the log: `[locmoves] legacy -> factory: {...conserved: true}` and `[locmoves] migration took N ms`;
table `loc_migrations` row `legacy-to-factory-v1` has the held owners and held in-flight freight.

## 2. If the new instance fails before it is ready
Boot deadline (INV_BOOT_DEADLINE_MS, default 8 min), a fatal boot error, or SIGTERM before ready all run
`releaseIfPreReady`, conditional on still holding the fence (same token and epoch):
- **nothing migrated yet** (`migrated = false`): the fence goes back to its previous state (`open`) and the OLD instance,
  which Render keeps serving, writes normally again. Proven safe: the new code wrote no inventory before `migrated`.
- **migration started** (`migrated = true`): the fence is KEPT. The old code must never write again (it would see
  fish in transit, miss loc_stock and moving legs, and could sell/cook goods twice). The game keeps running, inventory
  writes stay refused (maintenance) until **forward recovery**: fix and redeploy the new code (or redeploy the same
  build); a fresh boot re-takes the fence, re-runs the idempotent migration and serves.
Tested: tests/logistics-safety-postgres.test.ts (deadline, SIGTERM, pre-migration failure, mid-migration failure,
forward recovery).

## 3. Rollback policy
Rolling back to 14bad00 after the migration started is NOT a supported fallback (it would serve stale legacy
quantities). The known-good recovery is forward: redeploy the new build (or a fixed one). Emergency stop-writes:
leave the fence as is (any non-holder is refused) and scale/stop the web service; data stays consistent in Postgres.
Only before `migrated = true` may the operator return to the old code (that is what step 2 does automatically).
