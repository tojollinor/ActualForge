#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-compose.yaml}"
PORT="${ACTUALFORGE_PORT:-5006}"

for attempt in $(seq 1 60); do
  if curl --fail --silent --show-error "http://127.0.0.1:${PORT}/health" >/dev/null; then
    break
  fi
  if [ "$attempt" -eq 60 ]; then
    echo "ActualForge server did not become healthy" >&2
    exit 1
  fi
  sleep 2
done

docker compose -f "$COMPOSE_FILE" exec -T finance-engine node --input-type=module <<'NODE'
const base = 'http://127.0.0.1:5010';
async function json(path, init) {
  const response = await fetch(base + path, init);
  const body = await response.text();
  if (!response.ok) throw new Error(path + ' failed: ' + response.status + ' ' + body);
  return body ? JSON.parse(body) : null;
}

const health = await json('/health');
if (health.status !== 'ok') throw new Error('finance-engine health mismatch');
const ready = await json('/ready');
if (ready.status !== 'ready' || ready.schemaVersion !== 5) throw new Error('finance-engine readiness/schema mismatch');

const capabilities = await json('/api/v1/capabilities');
for (const domain of ['contracts','paymentChains','transactionLinks','transactionSplits','transferMatches','creditCards','clarificationCases','predictions','forecasts']) {
  if (capabilities.domains?.[domain] !== 'active') throw new Error('inactive capability: ' + domain);
}

let predictionId;
try {
  const created = await json('/api/v1/predictions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Release smoke payment',
      accountId: 'release-checking',
      expectedDate: '2026-10-20',
      amountMinor: -15000,
      currency: 'EUR',
    }),
  });
  predictionId = created.prediction.id;
  const forecast = await json('/api/v1/forecast/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      startDate: '2026-10-02',
      endDate: '2026-10-31',
      accounts: [{ accountId: 'release-checking', accountName: 'Release Checking', balanceMinor: 100000 }],
      scheduleEvents: [{ sourceRef: 'release-salary', accountId: 'release-checking', accountName: 'Release Checking', title: 'Salary', date: '2026-10-15', amountMinor: 200000 }],
    }),
  });
  if (forecast.summary?.totalEndBalanceMinor !== 285000) throw new Error('forecast balance mismatch');
  if (!forecast.entries?.some(entry => entry.sourceKind === 'manual' && entry.amountMinor === -15000)) throw new Error('manual prediction missing');
  if (!forecast.entries?.some(entry => entry.sourceKind === 'actual_schedule' && entry.amountMinor === 200000)) throw new Error('schedule prediction missing');
} finally {
  if (predictionId) await json('/api/v1/predictions/' + encodeURIComponent(predictionId), { method: 'DELETE' });
}
console.log('ActualForge container smoke test passed.');
NODE
