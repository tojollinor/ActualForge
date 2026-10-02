# ActualForge

ActualForge is an independent community fork and extension of [Actual Budget](https://github.com/actualbudget/actual), focused on richer finance interpretation on top of Actual's local-first budgeting foundation.

> **Independent project:** ActualForge is not an official Actual Budget project and is not affiliated with or endorsed by the Actual Budget maintainers.

## Foundation

ActualForge starts from the stable Actual Budget release **v26.9.0** at commit `59fe126f637d858c061e1eeedbef5436c8f2225a`.

The upstream project remains the source for the budgeting core. ActualForge adds its own extension layer for concepts such as contracts, payment chains, transaction links/splits, transfer matching, clarification cases, and forecasts.

A core design rule is that imported/original Actual transactions remain intact. ActualForge-specific interpretation is stored as a separate, reversible layer.

## Upstream policy

ActualForge does **not** automatically synchronize from Actual Budget.

Upstream changes are only reviewed and integrated when explicitly requested. Every upstream update is compared, conflict-checked, tested, and deliberately merged before a new ActualForge release is created.

See [UPSTREAM.md](./UPSTREAM.md).

## Architecture

The project keeps a single user-facing web/PWA experience based on Actual's UI.

ActualForge includes a separate internal `finance-engine` service for its own finance interpretation data and logic. The engine uses its own SQLite persistence, keeps Actual transactions authoritative, and is not exposed as a second end-user interface.

The existing Actual web/PWA contains an **ActualForge** route in desktop and mobile navigation. Browser requests reach the finance engine only through fixed same-origin endpoints on the sync-server.

See:
- [docs/ACTUALFORGE_ARCHITECTURE.md](./docs/ACTUALFORGE_ARCHITECTURE.md)
- [docs/FINANCE_ENGINE.md](./docs/FINANCE_ENGINE.md)
- [docs/AIRTABLE_BRIDGE.md](./docs/AIRTABLE_BRIDGE.md)
- [docs/DOCKER.md](./docs/DOCKER.md)

## Current release

**ActualForge 0.1.2** extends the optional Airtable bridge with explicit export of Actual accounts, transactions, categories and schedules from the opened budget. Actual remains authoritative and Airtable writeback stays disabled. The release remains based on Actual Budget **v26.9.0** at commit `59fe126f637d858c061e1eeedbef5436c8f2225a`.

For a published container deployment:

```bash
cp .env.release.example .env
docker compose -f compose.release.yaml pull
docker compose -f compose.release.yaml up -d
```

Published images:

- `ghcr.io/tojollinor/actualforge:0.1.2`
- `ghcr.io/tojollinor/actualforge-finance-engine:0.1.2`

See [docs/OPERATIONS.md](./docs/OPERATIONS.md), [CHANGELOG.md](./CHANGELOG.md), and [ACTUALFORGE_RELEASE.json](./ACTUALFORGE_RELEASE.json).

## Development

Actual v26.9.0 requires Node.js 22+ and Yarn 4.17.1. ActualForge's Docker builds use Node 24.

See [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md).

## License and attribution

ActualForge is distributed under the MIT License inherited from Actual Budget. The original copyright notice is retained in [LICENSE.txt](./LICENSE.txt).

Actual Budget: https://github.com/actualbudget/actual
