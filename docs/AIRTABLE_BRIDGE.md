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

Accounts, categories, schedules and full original transactions live in Actual,
not in the finance-engine SQLite database. They are intentionally not read by
opening Actual's database directly.

Those Airtable tables are already reserved for the next bridge step, which must
use an explicit Actual application/API seam. This preserves ActualForge's
existing local-first and reversible architecture.
