# Separate tax release: historical back-tax cancellation and full refunds

Dayne's confirmed policy: surcharge **1% per 1,000 of owned paid property value**; permanently cancel unpaid historical back-tax; refund actual paid back-tax **in full**, including surcharge and wealth-tax components. No clawback from prior tax-share recipients. Ordinary daily/property/purchase wealth taxes and mayor rules remain unchanged.

## Release and execution are separate gates

1. Review/publish this as a **separate tax release**, not a farming/logistics/restoration bundle. Revalidate any integration conflicts without importing unrelated gameplay work.
2. No boot refunds or automatic guard installation. `GET /api/admin/backtax-refunds/audit` is read-only. Without a proved protected, frozen database gate, the credit route refuses execution. No production names/counts/amounts were available during preparation.
3. Use the existing admin Bearer authorization through these purpose-built routes. Never expose the token or connect around the server to the private database.
4. Verify exact live build, 1% rate, and zero historical debt / zero paid for cached `re_backtax_pay`. Do not roll back to code reviving canceled debt. No ordinary tax arrears or historical ledger rows are erased.

## Explicit database-enforced freeze

`POST /api/admin/backtax-refunds/gate`

```json
{"action":"freeze","confirm":"FREEZE ADMIN CREDITS FOR BACKTAX REFUNDS"}
```

This explicit action transactionally installs/verifies an ALWAYS BEFORE INSERT ledger trigger, drains transactions already writing the ledger during initial activation, closes a durable gate row and rotates its admission generation. Later freeze transitions wait for already-admitted positive admin-credit transactions holding the gate row SHARE lock to finish. The HTTP response also waits for this instance's queued wallet writes to drain/refuse.

The database trigger covers **positive `admin` and `admin_refund` credits**, including old atomic wallet/ledger writers and direct atomic ledger paths. Closed gate means rollback, not an optimistic credit. Ordinary gameplay credits, ordinary refunds in other game namespaces and negative admin movements remain unaffected.

New admin API requests capture the gate generation **before queueing**; the wallet transaction supplies that internal generation to the trigger. Freeze/thaw rotates it. A queued pre-freeze request cannot become valid after thaw: its stale generation is refused terminally, without automatic retries or a credit. Legacy/untagged positive admin writers also remain refused after activation, including after thaw; updated ordinary `/api/admin/grant` transparently supplies current admission. No client-supplied generation, new grant eligibility rule, amount limit or token permission is introduced.

Check response/audit: `gate.installed=true`, `gate.protected=true`, `gate.frozen=true`, actual generation present. Protection checks exact trigger event/enabled state and function body. If activation reply is lost, read the audit; do not assume rollback or automatically thaw. Gate state persists across process restarts.

## Read-only real manifest

`GET /api/admin/backtax-refunds/audit`

Returns exact original negative `property_backtax` ledger IDs/keys, player/name, full amount, memo/date, optional explanatory component breakdown, per-source refund marker, prior-credit candidates, blockers, pending sum/count, gate proof and manifest hash. It never estimates refunds from assessments, ordinary purchase/daily tax rows, or current balances. Multiple actual debit rows (including partial/repeated real payments) stay separate; immutable ID is the refund identity even when source key is null.

Review/save the real manifest. Known possible earlier back-tax compensation is a **hard blocker**; no exclusion override exists. Generic admin credits require positive proof they are unrelated and exact `reviewedUnrelatedCreditIds`. Unlabeled non-admin compensation cannot be identified automatically: unresolved outside history must stop the operation, not be guessed away.

## One reviewed source per execution

`POST /api/admin/backtax-refunds/refund-one`

```json
{
  "sourceId":"<one original debit ID>",
  "manifestHash":"<fresh reviewed audit hash>",
  "confirm":"REFUND ONE VERIFIED BACKTAX DEBIT IN FULL",
  "reviewedUnrelatedCreditIds":["<each generic admin credit ID proved unrelated>"]
}
```

The gate must still be protected/frozen, and its generation is hash-bound. The same advisory mutex serializes refund execution and freeze/thaw, so reopening cannot slip between final validation and credit. The database gate prevents alternative positive admin compensation from committing in that interval; this is enforced, not an operator warning.

The existing atomic wallet writer commits the full immutable debit amount and UNIQUE marker `backtax_refund_v1:<sourceId>` / game `property_backtax_refund_v1` together. Marker owner/amount/game must match exactly. No arbitrary amount/recipient, grant chunking, raw production SQL or blind batch loop. Existing wallet required under transaction lock; current names preserved; unsafe wallet integer balances refused. Originals and previously distributed shares remain untouched.

After **every** credit obtain/review a new audit: each credit changes the global hash. An old hash is refused. Fresh-hash repeat of an already-refunded source is a no-op. Lost COMMIT replies are reconciled with the exact durable marker; unavailable readback leaves outcome unknown. Never compensate manually or regrant because a response/cache refresh failed.

`cacheRefreshed=true` is emitted only for an explicit successful persistent read and cache update (`refreshConfirmed`), not the legacy swallowing refresh API. On actual read failure it is false, while the committed refund/marker stay intact; retry with fresh audit is still a no-op. Verify live wallets independently.

## Finish / resume ordinary admin credits

Only after the exact real sources/markers/totals and prior-compensation checks are reconciled:

`POST /api/admin/backtax-refunds/gate`

```json
{"action":"thaw","confirm":"RESUME ORDINARY ADMIN CREDITS"}
```

Thaw waits for any active refund mutex, rotates admission generation, and permits fresh updated admin API requests again. Stale queued requests remain invalid. If pausing before all sources finish, thaw also disables the refund credit route; resumption needs another explicit freeze and a fresh reviewed manifest. No hidden auto-thaw.

## Local evidence

Actual isolated local PostgreSQL tests cover HTTP admin requests queued before freeze, direct atomic competing ledger inserts, independent OS-process refusal, delayed requests released only after thaw, already-admitted writer drain, thaw vs final validation serialization, preserved prior-review IDs, unchanged ordinary economy/debits, and actual cache-read failure (cache 1090 / persisted 1100 / response false / marker retained / repeat no-op). Other tests cover full payments over 10,000, partial payments, unique keys, restart, unknown COMMIT, rollback and prior-compensation blockers.

Use only disposable local databases on shared port 55482; never stop/drop the shared instance. Fixture teardown closes pools, drains only its own unique database's sessions and drops without FORCE. No blanket exception suppression or skips.
