# Development baseline

## Required versions

The pinned Actual v26.9.0 repository declares:

- Node.js: `>=22.18.0`
- Yarn: `4.17.1`
- package manager: Yarn workspaces
- node linker: `node-modules`

ActualForge CI and Docker builds use Node 24.

## Clone and install

```bash
git clone https://github.com/tojollinor/ActualForge.git
cd ActualForge
git remote add upstream https://github.com/actualbudget/actual.git
corepack enable
yarn install --immutable
```

Do not merge or pull upstream automatically.

## Run

```bash
yarn start
```

Server build/run:

```bash
yarn build:server
yarn start:server
```

## Release-relevant verification

```bash
yarn verify:actualforge
```

This runs release metadata validation, finance-engine tests/typecheck, authenticated bridge tests, loot-core/web/sync-server typechecks, web and sync-server builds, and Compose validation.

Container smoke test:

```bash
docker compose up --build -d --wait
bash scripts/smoke-actualforge.sh
docker compose down -v
```

The permanent GitHub Actions CI repeats these checks on ActualForge branches, pull requests and `main`.

## Release metadata

`ACTUALFORGE_RELEASE.json` is the source for the independent ActualForge version and pinned Actual Budget base used by release automation.

A release version bump updates the manifest, release Compose defaults, release environment example, release notes and changelog. The release validator detects version/base drift.

## Upstream updates

See `UPSTREAM.md`. Updating the Actual base is deliberate and never scheduled automatically.
