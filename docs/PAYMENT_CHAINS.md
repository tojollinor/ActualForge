# Payment chains, returns, and splits

Block 5 adds a reversible interpretation layer for payment attempts, returned
payments, retries, and fees. Actual remains authoritative for every original
transaction.

## Payment-chain model

A payment chain can be attached to a contract and stores only ActualForge
metadata such as:

- expected amount and currency,
- due date,
- optional Actual account reference,
- chain status,
- links to Actual transaction IDs.

Confirmed links have an explicit role:

- `payment_attempt` - an initial debit that may later be reversed,
- `reversal` - returned direct debit / charge reversal,
- `settlement` - the final successful payment,
- `fee` - a separate fee booking,
- `failed` - a failed attempt represented by an Actual transaction.

For the economic summary, earlier attempts and reversals remain visible but do
not count as the contract payment. Only the latest confirmed `settlement`
counts as the final payment.

## Split interpretation

A linked transaction can be split into ActualForge-only components:

- contract amount,
- returned-payment fee,
- bank fee,
- dunning fee,
- other fee.

The split total must equal the linked Actual transaction amount. Splits can be
replaced or removed without editing the Actual transaction.

## Recognition

The chain workflow receives a reduced list of recent Actual transactions from
Actual's own query layer. The finance-engine can recognize the common sequence:

1. debit,
2. matching credit/reversal,
3. matching retry debit.

High-confidence results are proposed to the user, never applied automatically.

Lower-confidence results become persistent clarification cases. A user can:

- confirm the suggestion,
- change the role before confirming,
- explicitly choose not to link it.

## Safety and reversibility

- Original Actual transactions are never rewritten or deleted.
- Links and splits live only in the finance-engine SQLite database.
- Removing a link also removes its ActualForge split interpretation.
- No browser connection to the finance-engine is exposed directly.
- The existing authenticated Actual session bridge is used for all operations.
