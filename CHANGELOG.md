# Changelog

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
