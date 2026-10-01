# Finance Engine

The finance engine is the ActualForge-owned interpretation layer. It runs as a separate internal service next to the Actual sync-server and has no end-user web interface.

## Responsibilities

The engine owns ActualForge-specific metadata and future logic for:

- contracts,
- payment chains,
- transaction links and split interpretations,
- transfer matches,
- clarification cases,
- prediction entries,
- merchant mappings,
- recognition rules.

Actual remains authoritative for original account and transaction data.

## Persistence

The engine uses its own SQLite database. In Docker the default path is:

```text
/data/actualforge-finance.sqlite
```

The Compose stack stores this directory in the separate `finance-engine-data` volume.

The finance engine does not mount Actual's data volume and does not duplicate Actual's transaction table. Links to Actual are stored by transaction ID.

SQLite is configured with WAL mode, foreign keys, and a busy timeout. Schema changes are versioned through the `schema_migrations` table.

## HTTP API

The initial internal API listens on port `5010`.

Endpoints:

- `GET /health` - process liveness
- `GET /ready` - database/migration readiness
- `GET /api/v1/status` - engine and integration status
- `GET /api/v1/capabilities` - domain capabilities currently represented by the schema

There are intentionally no write endpoints in Block 2.

## Actual integration boundary

The engine is configured with:

```text
ACTUALFORGE_ACTUAL_URL=http://actualforge:5006
```

Direct SQLite access to Actual is deliberately avoided. Later blocks will integrate through explicit application/API seams.

The browser/PWA also does not connect to port 5010 directly. Block 3 will add the same-origin ActualForge UI integration/proxy path.

## Safety rules

- Original Actual transactions remain authoritative.
- Automatic mutation of Actual transactions is disabled by design.
- Uncertain matches are represented as proposed links or clarification cases.
- Secrets must not be committed or written to logs.
- The engine database must survive container replacement and upgrades.
