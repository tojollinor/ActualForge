# ActualForge architecture baseline

This document records the architecture decisions for the implementation baseline.

## Product shape

ActualForge keeps one primary user-facing interface: the Actual web/PWA application with ActualForge features integrated into it.

The runtime shape is:

```text
Browser / PWA
    |
    +-- Actual / ActualForge UI
    |
    +-- Actual sync-server
              |
              +-- internal network --> finance-engine
                                         |
                                         +-- separate SQLite persistence
```

The finance engine does not get a separate end-user web UI and is not published to the host by the default Compose configuration.

## Upstream structure at the pinned base

The pinned Actual v26.9.0 source is a Yarn workspace monorepo.

Important packages and files:

- `packages/desktop-client`: React web/PWA UI.
- `packages/desktop-client/src/components/FinancesApp.tsx`: central finance routes.
- `packages/loot-core`: local-first finance/application core.
- `packages/loot-core/src/server/aql/schema/index.ts`: AQL public data schema.
- `packages/loot-core/src/server/transactions`: transaction application logic.
- `packages/loot-core/src/server/sync`: local synchronization integration.
- `packages/sync-server`: synchronization/web server.
- `packages/api`: programmatic Actual API.
- `packages/finance-engine`: ActualForge-owned interpretation service.
- `sync-server.Dockerfile`: ActualForge/Actual server image build.
- `finance-engine.Dockerfile`: finance-engine image build.
- `compose.yaml`: combined ActualForge runtime stack.

## ActualForge extension boundaries

ActualForge prefers additive integration over invasive rewrites.

### UI

New ActualForge pages and navigation are integrated into the existing React application. The central routing seam is `FinancesApp.tsx`; navigation should follow the existing sidebar/mobile navigation patterns.

### Transaction access

Actual transactions remain the source records. ActualForge must not rewrite imported transaction meaning just to model higher-level concepts.

Read access should use Actual's public/query layers where possible. Mutations to Actual transactions should only occur when the user is explicitly changing Actual transaction data.

### Interpretation layer

ActualForge-specific concepts are modeled separately and reference Actual transaction IDs where needed.

The Block 2 schema includes:

- Contract
- PaymentChain
- TransactionLink / Split
- TransferMatch
- ClarificationCase
- PredictionEntry
- MerchantMapping
- RecognitionRule

This makes interpretation reversible and keeps the upstream transaction history intact.

### Finance engine

The `finance-engine` service owns ActualForge-specific interpretation, matching, clarification, and prediction data.

Its persistent data is stored in a separate SQLite database and separate Docker volume. The service has no direct mount of Actual's data volume.

The finance engine exposes health/status endpoints plus domain-specific read/write
endpoints for contracts, payment chains, transfers, credit-card interpretation,
predictions, forecasts, clarification cases and the optional Airtable bridge.
Those endpoints are internal service APIs, not a second user-facing interface.

The sync-server exposes only explicit ActualForge routes through a fixed,
authenticated same-origin bridge. It is not an open proxy. The React/PWA shell
contains the `/actualforge` routes for desktop and mobile, and the browser never
needs direct network access to the engine container.

The default development and release Compose files publish only the
ActualForge/sync-server port. The finance-engine uses Docker `expose` for port
`5010` on the internal service network and must not gain a host `ports`
mapping. CI smoke tests enforce this boundary.

## Compatibility rule

Changes to upstream Actual files should be kept small and concentrated around explicit integration seams. ActualForge-owned code should be placed in clearly named modules/directories so that future manual upstream comparisons remain understandable.

## Security/privacy baseline

Actual is local-first. ActualForge preserves that expectation: finance data must not be sent to an external cloud service as a hidden requirement. Any future external integration must be explicit and optional.
