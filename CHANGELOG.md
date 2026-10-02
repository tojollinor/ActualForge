# Changelog

## 0.1.1 - 2026-10-02

### Added

- optional export-only Airtable bridge for the ActualForge finance-engine,
- batched Airtable upserts using stable ActualForge identifiers,
- Airtable sync logging and retry handling,
- dedicated Airtable environment settings for development and release stacks,
- bridge tables for finance-engine domains including contracts, payment chains, links, splits, transfers, clarifications, predictions, merchant mappings, rules, credit cards and contract price history.

### Safety boundary

- Airtable integration is disabled by default,
- Actual and the finance-engine remain authoritative,
- Airtable does not write back into ActualForge in this release,
- original Actual transactions are never mutated by the bridge,
- full Actual accounts/categories/transactions remain reserved for a later explicit Actual API bridge.

## 0.1.0 - 2026-10-02

First independent ActualForge release, based on Actual Budget v26.9.0.

### Added

- separate finance-engine service with SQLite persistence,
- integrated ActualForge UI inside the Actual web/PWA,
- contracts and reversible transaction associations,
- payment chains, reversals, retries, fees and splits,
- transfer and credit-card interpretation without double-counting,
- forward forecasts and manual planned payments,
- central clarification workflow,
- authenticated same-origin bridge,
- development and release Docker stacks,
- permanent regression CI and release automation.

### Safety boundary

Actual transactions remain authoritative. ActualForge stores interpretations separately and does not silently rewrite original Actual transactions.
