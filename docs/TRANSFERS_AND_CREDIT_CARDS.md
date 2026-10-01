# Transfers and credit cards

Block 6 adds reversible transfer matching and credit-card settlement
interpretation on top of Actual transactions.

## Internal transfers

ActualForge reads recent Actual transactions and uses the strongest available
signals first:

- Actual's own `transfer_id`,
- transfer payees and their `transfer_acct`,
- equal opposite amounts on different accounts,
- close transaction dates.

Confirmed internal transfers have an economic effect of zero. Both original
Actual transactions remain untouched and visible.

High-confidence pairs can be confirmed automatically when the relationship is
explicit or otherwise strong and unique. Medium-confidence pairs remain
proposals. Ambiguous or weaker pairs become clarification cases.

Every ActualForge transfer match can be removed again without changing either
Actual transaction.

## Credit cards

Accounts can be marked as credit-card accounts inside ActualForge and can
optionally reference the account that normally pays the card statement.

The intended economic chain is:

1. individual card purchases are expenses,
2. refunds reduce those expenses,
3. the statement payment is matched as a transfer from the funding account to
   the credit-card account,
4. that payment is economically neutral and must not become a second expense.

ActualForge stores only the account profile and transfer interpretation. Actual
accounts and transactions remain authoritative.

For configured cards, ActualForge also derives reversible settlement cycles from
the confirmed card payments. Each cycle shows the card purchases/refunds since
the previous settlement, the matching payment, and any difference. Transactions
after the latest payment form an open current cycle. These cycles are calculated
from the current Actual data and are not written back into Actual.

## Recognition safety

A transaction is used by at most one confirmed transfer match. Equal-amount
transactions are not enough for blind confirmation when multiple plausible
targets exist.

Ambiguous matches are persisted as clarification cases so the user can either
confirm or reject them.

## Authentication

Transfer and credit-card endpoints are exposed to the web/PWA only through the
existing authenticated Actual worker and sync-server bridge. The finance-engine
still has no browser-facing endpoint in the default Compose setup.
