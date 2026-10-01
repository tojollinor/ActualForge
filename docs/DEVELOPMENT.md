# Development baseline

## Required versions

The pinned Actual v26.9.0 repository declares:

- Node.js: `>=22.18.0` at the repository root
- Yarn: `4.17.1`
- package manager: Yarn workspaces
- node linker: `node-modules`

The upstream sync-server Dockerfile uses Node 24.

## Clone

```bash
git clone https://github.com/tojollinor/ActualForge.git
cd ActualForge
git remote add upstream https://github.com/actualbudget/actual.git
```

Do not merge/pull upstream into ActualForge automatically.

## Install

```bash
corepack enable
yarn install
```

## Run the browser client

```bash
yarn start
```

## Build and run the server

```bash
yarn build:server
yarn start:server
```

The upstream server listens on port 5006 by default.

## Useful checks

```bash
yarn typecheck
yarn lint
yarn test
```

Run targeted checks during feature development instead of forcing the complete upstream test suite for every small edit.

## Upstream updates

See `UPSTREAM.md`. Updating the Actual base is a deliberate maintenance task and is never scheduled automatically.
