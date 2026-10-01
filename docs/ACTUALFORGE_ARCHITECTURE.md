# ActualForge architecture baseline

This document records the architecture decisions for the first implementation baseline.

## Product shape

ActualForge keeps one primary user-facing interface: the Actual web/PWA application with ActualForge features integrated into it.

The intended runtime shape is:

```text
Browser / PWA
    |
    +-- Actual / ActualForge UI
    |
    +-- Actual sync-server
    |
    +-- finance-engine (ActualForge extension service, introduced in Block 2)
```

The finance engine does not get a separate end-user web UI.

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
- `sync-server.Dockerfile`: upstream server image build.

## ActualForge extension boundaries

ActualForge should prefer additive integration over invasive rewrites.

### UI

New ActualForge pages and navigation are integrated into the existing React application. The central routing seam is `FinancesApp.tsx`; navigation should follow the existing sidebar/mobile navigation patterns.

### Transaction access

Actual transactions remain the source records. ActualForge must not rewrite imported transaction meaning just to model higher-level concepts.

Read access should use Actual's public/query layers where possible. Mutations to Actual transactions should only occur when the user is explicitly changing Actual transaction data.

### Interpretation layer

ActualForge-specific concepts are modeled separately and reference Actual transaction IDs where needed.

Planned domain objects:

- Contract
- PaymentChain
- TransactionLink / Split
- TransferMatch
- ClarificationCase
- PredictionEntry

This makes interpretation reversible and keeps the upstream transaction history intact.

### Finance engine

The planned `finance-engine` service owns ActualForge-specific interpretation, matching, clarification, and prediction logic. Its persistent data is separate from Actual's original transaction tables.

Block 2 defines its concrete API, persistence, container layout, health checks, and integration contract.

## Compatibility rule

Changes to upstream Actual files should be kept small and concentrated around explicit integration seams. ActualForge-owned code should be placed in clearly named modules/directories so that future manual upstream comparisons remain understandable.

## Security/privacy baseline

Actual is local-first. ActualForge should preserve that expectation: finance data must not be sent to an external cloud service as a hidden requirement. Any future external integration must be explicit and optional.
