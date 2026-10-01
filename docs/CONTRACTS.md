# Contracts

Block 4 turns the ActualForge contract schema into a usable workflow inside the existing Actual web/PWA.

## Contract fields

A contract can store:

- provider,
- contract name,
- contract type,
- Actual account,
- Actual payee,
- expected amount,
- fixed or variable amount mode,
- payment interval,
- next payment date,
- start and end dates,
- minimum term,
- cancellation notice,
- cancellation date,
- notes,
- status.

ActualForge stores these fields in the finance-engine database. It does not add them to Actual's own transaction tables.

## Transaction associations

Actual transactions remain authoritative.

The contract page reads recent transactions through Actual's own AQL/query layer and sends a reduced candidate representation to the local finance-engine:

- Actual transaction ID,
- date,
- amount,
- account ID,
- payee ID/name,
- notes.

The engine scores these candidates using provider/payee, account, amount and expected date.

High-confidence matches are stored only as `proposed` links. A user confirmation is required before a link becomes `confirmed`.

Removing a link removes only the ActualForge association. The original Actual transaction is unchanged.

## Price changes

When a confirmed transaction has an observed amount, ActualForge records that amount in `contract_price_history`.

The expected contract amount is not silently overwritten. A candidate that differs materially from the expected fixed amount is marked as a price-change review in the contract UI.

This makes price development visible while keeping the original expectation and imported transaction intact.

## Authentication

Contract metadata is not exposed by an anonymous HTTP endpoint.

The browser calls Actual's existing local worker. The worker forwards ActualForge requests to the sync-server using the existing Actual session token. The sync-server validates the session before forwarding to the internal finance-engine container.

The finance-engine remains unexposed on the host in the default Compose stack.
