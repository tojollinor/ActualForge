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

The project keeps a single user-facing web/PWA experience based on Actual's UI. ActualForge-specific finance logic is designed to live behind that UI, with a separate `finance-engine` service introduced in the next implementation block.

See [docs/ACTUALFORGE_ARCHITECTURE.md](./docs/ACTUALFORGE_ARCHITECTURE.md).

## Development

Actual v26.9.0 requires Node.js 22+ and Yarn 4.17.1. Actual's sync-server Docker build currently uses Node 24.

See [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md).

## License and attribution

ActualForge is distributed under the MIT License inherited from Actual Budget. The original copyright notice is retained in [LICENSE.txt](./LICENSE.txt).

Actual Budget: https://github.com/actualbudget/actual
