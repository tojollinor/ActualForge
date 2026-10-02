# Forecasts and clarification cases

Block 7 adds a forward-looking finance view and a central review inbox while
keeping Actual transactions authoritative.

## Forecast inputs

ActualForge combines the following sources for the selected forecast period:

- current live account balances from Actual,
- Actual schedule forecast events, including recurring income and expenses,
- active ActualForge contracts,
- open/reversed payment chains,
- manually entered known future payments,
- credit-card settlement projections derived from the latest confirmed
  settlement cycle and the current open card cycle.

Actual schedules take precedence over equivalent contract predictions so the
same recurring payment is not counted twice. Open payment chains likewise take
precedence over the corresponding contract occurrence.

Credit-card settlements are represented as equal and opposite balance moves
between the funding account and the card account. They affect the individual
account balances but remain neutral in the combined total.

## Manual predictions

Known future one-off entries can be created with:

- title,
- account,
- date,
- signed amount,
- currency,
- optional note.

Positive amounts are forecast income and negative amounts are forecast
expenses. Manual predictions are stored only in the finance-engine and can be
removed without changing Actual.

## Result

The forecast returns:

- projected end balance per account,
- lowest projected balance and date per account,
- combined current and end balances,
- expected income and expenses,
- an ordered event timeline with source and confidence.

The first Block 7 implementation is a deterministic base forecast. Scenario
branches can be added later without changing Actual transactions.

## Central clarification inbox

The inbox unifies open clarification cases from payment chains, transfer
matching and contract amount changes.

Each case keeps:

- subject and kind,
- confidence,
- evidence/details,
- related Actual transaction or payment chain where applicable,
- resolution metadata.

The user can confirm, edit the proposed interpretation, or dismiss the case.

## Permanent contract amount changes

For fixed-price contracts, ActualForge compares confirmed observed prices with
the configured contract amount. A review case is created only when the latest
two observations agree with each other and differ from the configured amount by
more than five percent.

Confirming the case updates only the ActualForge contract amount. Dismissing it
suppresses that exact proposed amount from being recreated.

## Safety boundary

Forecasting and clarification resolutions never silently rewrite original
Actual transactions. Browser access still passes through the authenticated
same-origin Actual bridge.
