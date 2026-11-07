# Historical property back-tax cancellation / full refunds

Policy approved by Dayne Nov 7, 2026: property surcharge is **1% per 1,000 of owned paid property value**, unpaid historical back-tax is permanently canceled, and actual paid back-tax is refunded **in full** (surcharge plus wealth-tax component). Previously distributed wealth-tax shares are not clawed back. Normal property/daily/purchase wealth taxes and mayor rules remain unchanged.

## Release gates (not an automatic migration)

1. Review the isolated patch, types, full tests and production build. Integrate alongside restoration without losing either branch's WorldMap/launchPopup/app edits.
2. Publishing requires the parent/operator's release review. No boot code issues refunds. No production ledger was accessible while preparing this patch.
3. Once released, verify exact live build, the 1% rate, and zero debt on quotes / cached `re_backtax_pay` (zero paid). Ensure all old replicas are gone; an old server must not keep charging back-tax. Quiesce alternative manual back-tax compensation/grants while executing the reviewed refund manifest. Never roll back to an old version that revives canceled debt.
4. Authenticate with the existing admin bearer through the normal admin authorization. Do not print secrets. No database connection/token extraction is needed.

## Read-only audit

`GET /api/admin/backtax-refunds/audit` (existing admin Bearer authorization).

No writes. Returns a snapshot/hash, every original negative `property_backtax` row (immutable ID, key, player/name, full amount, memo/date, optional memo component breakdown), per-source refund marker/status, all potentially related prior positive compensation rows, generic admin credits to affected players, blockers, total pending amount and count. Shares to prior recipients are excluded from compensation candidates. Historical debt estimates, unpaid assessments, ordinary property/tax debits are NOT refund inputs.

Review the exact manifest before any refund. Check original identities, source amounts, duplicate/reversal/prior-compensation history and all `priorCredits`. Null source keys are okay: immutable source ledger ID is the refund identity. Multiple real debit rows (partial/repeated real payments) remain separate; a retried original tx_key cannot create a second original debit because of the existing UNIQUE index. Memo components are explanatory only; never replace the full actual debit amount with a recalculated debt.

Known possible back-tax compensation is a hard blocker, even if the pending amount appears obvious. No override exists. Do not assume this implies zero prior refunds: generic admin credits require explicit human review too. Unlabeled non-admin compensation cannot be identified automatically; stop if relevant external history is unresolved.

## Explicit one-source execution

Only after exact manifest/prior-credit review:

`POST /api/admin/backtax-refunds/refund-one`

```json
{
  "sourceId": "<one original debit ledger ID>",
  "manifestHash": "<latest reviewed audit hash>",
  "confirm": "REFUND ONE VERIFIED BACKTAX DEBIT IN FULL",
  "reviewedUnrelatedCreditIds": ["<every generic admin credit ID proven unrelated>"]
}
```

One actual original debit per call; no blind batch loop, grant chunking or manual SQL credits. `reviewedUnrelatedCreditIds` must exactly match the audit's unclassified IDs; never label a real or ambiguous back-tax refund as unrelated. A changed manifest rejects execution. A known possible compensation blocker requires separate explicit reconciliation work, not guessing/exclusion.

The existing wallet store atomically commits balance increment and UNIQUE ledger key `backtax_refund_v1:<sourceId>` with game `property_backtax_refund_v1`. The marker is the credit itself. Global advisory locking serializes independent operators; the wallet UNIQUE key is the durable race/restart backstop. Original rows remain untouched. Refund memo includes original ID and reviewed manifest hash. A missing payer wallet is blocked transactionally, never silently created/funded. Existing wallet names are preserved even if the historical ledger display name differs.

After each response, GET a fresh audit; verify the marker's owner/amount/game, remaining totals and no blockers. Re-review before the next source. A repeated source using a fresh hash is a verified no-op. Cache refresh failure does not reverse durable credits. Lost COMMIT replies trigger marker checks, not another grant; if readback is unavailable the outcome stays unknown. Recover connection and GET a new audit before retrying. Do not manufacture a compensating debit or claim nothing was credited.

Final acceptance: all verified eligible debits have matching refund markers, no unresolved compensation blockers, exact sums conserved, no new back-tax debits after old instances are gone, no re-assessment after ordinary purchases, and independent live wallet checks. No player counts/amounts are asserted until the real audit is obtained.

## Local validation

`BACKTAX_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55482/postgres npx vitest run tests/backtax-refund-postgres.test.ts`

This creates/drops only its unique disposable database. Never stop/drop the shared instance. Covers two independent processes, restart, >10,000 full credit, multiple actual payments, immutable originals, no recipient clawback, manifest staleness, lost COMMIT with and without readback, rollback after wallet UPDATE, prior-compensation blocks and generic admin review. Additional tests cover rate/base/ordinary taxes, cached pay no-op, property/car access and admin authorization.
