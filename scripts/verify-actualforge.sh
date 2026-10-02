#!/usr/bin/env bash
set -euo pipefail

node scripts/validate-actualforge-release.mjs
yarn workspace @actualforge/finance-engine test
yarn workspace @actualforge/finance-engine typecheck
yarn workspace @actual-app/sync-server exec vitest --run src/app-actualforge.test.ts
yarn workspace @actual-app/core typecheck
yarn workspace @actual-app/web typecheck
yarn workspace @actual-app/sync-server typecheck
yarn workspace @actual-app/web build
yarn workspace @actual-app/sync-server build
docker compose -f compose.yaml config >/dev/null

echo "ActualForge verification passed."
