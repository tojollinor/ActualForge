# Airtable bridge

ActualForge can optionally mirror finance-engine data to Airtable so ChatGPT can
analyze the structured ActualForge interpretation layer through the Airtable app.

## Safety boundary

- Actual and the finance-engine remain authoritative.
- The Airtable bridge is disabled by default.
- The bridge is export-only in this first version.
- No Airtable record is written back to ActualForge.
- No Actual transaction is mutated by the bridge.
- Airtable records are upserted by stable ActualForge IDs.
- Secrets are never committed and the token is not logged.

## Configuration

Set these values in the deployment's untracked `.env` file or secret store:

```env
AIRTABLE_SYNC_ENABLED=true
AIRTABLE_TOKEN=pat_xxxxxxxxx
AIRTABLE_BASE_ID=appxxxxxxxxxxxxxx
AIRTABLE_SYNC_INTERVAL_MINUTES=15
```

`AIRTABLE_SYNC_INTERVAL_MINUTES=0` performs only the startup sync.

The token should be scoped only to the dedicated ActualForge Airtable base and
needs record read/write access plus schema read access.

## Data exported

The finance-engine mirrors these domains:

- contracts,
- contract price history,
- payment chains,
- transaction links,
- transaction splits,
- transfer matches,
- clarification cases,
- prediction entries,
- merchant mappings,
- recognition rules,
- credit-card profiles.

Every exported record also contains `RawJSON` so new finance-engine columns do
not silently disappear from the bridge before the Airtable schema is expanded.

Each table sync appends a row to `SyncLog`.

## Actual core data

Accounts, categories, schedules and original transactions stay authoritative
inside the opened Actual budget. ActualForge does not open the sync-server's
budget storage from the finance-engine and does not persist a second transaction
database there.

When the user starts **Airtable synchronisieren** from the ActualForge page, the
loaded budget creates a normalized snapshot through the normal Actual
application layer. The snapshot is sent through the authenticated ActualForge
same-origin route in chunks of at most 200 records. The finance-engine accepts
those chunks into an in-memory queue and mirrors them to Airtable in batches of
10 records.

The following Airtable tables are populated:

- `Accounts`,
- `Transactions`,
- `Categories`,
- `Schedules`.

Split transactions carry `IsParent`, `IsChild`, `ParentId` and
`CountInTotals`. Financial totals should use records with
`CountInTotals = true` so split children are not counted twice.

Actual tombstones are mirrored with `Deleted = true` and
`SyncState = ignored`, preventing deleted source records from looking active
inside Airtable.

The Actual core snapshot is never written back from Airtable in this release.
